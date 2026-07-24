import "reflect-metadata";

import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../../src/auth/password.service";
import { directPool, directUrl, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

/**
 * S5-SEC-1 · G1 — NEG-PERM-004 / IMPLEMENTATION-08 §14.3-#9: notification deep-link vẫn bị route/API guard
 * chặn khi recipient MẤT quyền module nguồn.
 *
 * Kịch bản: user click 1 notification (TASK_ASSIGNED, `target_url = /tasks/{id}`). Sau đó recipient bị
 * THU HỒI quyền `read:task`. Điều PHẢI xảy ra: (a) notification VẪN đọc/list được (own-scope, quyền
 * `read:notification` còn) — không mất dữ liệu của chính mình; (b) đi theo deep-link `GET /tasks/{id}`
 * → 403 (PermissionGuard chặn dù có link hợp lệ); (c) body notification KHÔNG rò field record nguồn.
 *
 * HTTP đầy đủ qua chuỗi guard THẬT (JwtAuthGuard → CompanyGuard → PermissionGuard). Gate `hasDb && LANE_DB`
 * (DB cô lập `mediaos_sec1`): thiếu LANE_DB → SKIP (lane-db-guard đếm), KHÔNG chạy trên `mediaos` dùng chung
 * (là PROD trên máy dev). Xem CLAUDE.md §9 + memory integration-test-lane-db-gate.
 *
 * PermissionGuard resolve quyền từ DB theo TỪNG request (không bake vào JWT) ⇒ revoke ở DB có hiệu lực ngay
 * request kế — đó là điều test này chứng minh (cùng route: có quyền → 200, mất quyền → 403).
 */

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const PASSWORD = "Passw0rd!sec1g1";
// Tiêu đề task DUY NHẤT: dùng làm sentinel "không nhúng" — deep-link chỉ là CON TRỎ (target_url), notification
// KHÔNG được nhúng field record nguồn ⇒ chuỗi này TUYỆT ĐỐI không xuất hiện trong bất kỳ payload notification.
const TASK_TITLE = "sec1g1-task-title-MUST-NOT-embed-in-notification";

type Pair = readonly [action: string, resourceType: string, sensitive: boolean];
const READ_NOTIFICATION: Pair = ["read", "notification", false];
const READ_TASK: Pair = ["read", "task", false];

/** Chuỗi con KHÔNG được xuất hiện trong payload notification (BẤT BIẾN #3). So khớp lower-case. */
const SECRET_PII_SUBSTRINGS = [
  "password_hash",
  "salary",
  "identity_number",
  "identitynumber",
  "bank_account",
  "bankaccount",
  "refresh_token",
  "refreshtoken",
  "secret_ciphertext",
];

interface SeededUser {
  userId: string;
  email: string;
  token: string;
}

describe.skipIf(!hasLaneDb)(
  "S5-SEC-1 G1 — notification deep-link bị guard chặn khi mất quyền module nguồn (NEG-PERM-004)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    const companyIds: string[] = [];

    let A: SeededTenant;
    let userU: SeededUser; // recipient — có read:notification + read:task (roles TÁCH BẠCH để revoke sạch)
    let taskRoleId: string; // role chỉ chứa read:task → revoke = xoá user_role này
    let taskId: string; // task trong company A mà deep-link trỏ tới
    let notificationId: string; // notification TASK_ASSIGNED của userU

    function http() {
      return request(app.getHttpServer());
    }

    function authGet(token: string, url: string) {
      return http().get(url).set("Authorization", `Bearer ${token}`);
    }

    function assertNoSecrets(body: unknown): void {
      const raw = JSON.stringify(body).toLowerCase();
      for (const s of SECRET_PII_SUBSTRINGS) expect(raw, `leak "${s}"`).not.toContain(s);
    }

    /** Deep-link là CON TRỎ, KHÔNG nhúng record nguồn: tiêu đề task DUY NHẤT không được lọt vào notification. */
    function assertNoTaskEmbed(body: unknown): void {
      expect(JSON.stringify(body), "notification KHÔNG được nhúng field task nguồn").not.toContain(
        TASK_TITLE,
      );
    }

    async function login(slug: string, email: string): Promise<string> {
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: slug, email, password: PASSWORD });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    /** Cấp 1 cặp quyền cho user qua 1 role RIÊNG (trả roleId để có thể revoke riêng cặp đó). */
    async function grantViaOwnRole(
      companyId: string,
      userId: string,
      label: string,
      pair: Pair,
      scope: "Own" | "Company" = "Company",
    ): Promise<string> {
      const roleId = await seedRole(direct, companyId, `sec1g1-${label}-${userId.slice(0, 8)}`);
      const permId = await seedPermissionCatalog(direct, pair[0], pair[1], pair[2]);
      await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      await seedUserRole(direct, userId, roleId, companyId);
      return roleId;
    }

    beforeAll(async () => {
      // Belt (defense-in-depth): TỪ CHỐI chạy nếu DB resolve ra `mediaos` DÙNG CHUNG trên MÁY DEV (là PROD
      // trên host này — memory pgdata-bloat: 122 company test từng lọt PROD). CHỈ khi KHÔNG ở CI: trong CI
      // (.github/workflows/api.yml) `mediaos` là DB container EPHEMERAL + step "Test" cố ý set LANE_DB=mediaos
      // (line ~198) để BẬT gate — DB đó throwaway, migrate 0000→head, ZERO secret prod. GitHub Actions luôn
      // set CI=true ⇒ bỏ qua guard ở CI, chỉ chặn nhầm-PROD ở local dev.
      const dbName = directUrl ? new URL(directUrl).pathname.replace(/^\//, "") : "";
      if (!process.env.CI && dbName === "mediaos") {
        throw new Error(
          `refuse-shared-mediaos(local): int-test trỏ DB 'mediaos' dùng chung (PROD trên host dev). ` +
            `Set LANE_DB=mediaos_sec1 + DATABASE_* trỏ DB cô lập. (CI dùng mediaos ephemeral thì set CI=1.)`,
        );
      }

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      direct = directPool();

      A = await seedCompany(direct, "sec1g1-a");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(PASSWORD);
      const email = `sec1g1-u-${randomUUID().slice(0, 8)}@x.test`;
      const userId = await seedUser(direct, A.companyId, email, hash);
      // read:notification (Own) + read:task (Company, để thấy task đã seed) — HAI role TÁCH BẠCH.
      await grantViaOwnRole(A.companyId, userId, "noti", READ_NOTIFICATION, "Own");
      taskRoleId = await grantViaOwnRole(A.companyId, userId, "task", READ_TASK, "Company");
      const token = await login(A.slug, email);
      userU = { userId, email, token };

      // Task trong company A — deep-link trỏ tới (read:task Company-scope cho userU thấy).
      taskId = (
        await direct.query(
          `INSERT INTO tasks (company_id, task_type, title, status, origin, revision_round)
           VALUES ($1, 'meeting_action', $2, 'not_started', 'initial', 0)
           RETURNING id`,
          [A.companyId, TASK_TITLE],
        )
      ).rows[0].id as string;

      // Notification TASK_ASSIGNED cho userU với target_url = deep-link. Title/body cố ý benign (chứng minh
      // notification KHÔNG chứa field record nguồn — deep-link chỉ là con trỏ, không nhúng dữ liệu task).
      notificationId = (
        await direct.query(
          `INSERT INTO notifications
             (company_id, user_id, recipient_user_id, type, notification_type, module_code, event_code,
              status, priority, title, short_body, body, target_url, is_read)
           VALUES ($1, $2, $2, 'general', 'Task', 'TASK', 'TASK_ASSIGNED',
              'Unread', 'Normal', 'Bạn được giao một công việc', 'Xem chi tiết công việc',
              'Bạn được giao một công việc mới, bấm để xem chi tiết.', $3, false)
           RETURNING id`,
          [A.companyId, userU.userId, `/tasks/${taskId}`],
        )
      ).rows[0].id as string;
    });

    afterAll(async () => {
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await app?.close();
      await direct?.end();
    });

    describe("BASELINE — còn read:task: deep-link hoạt động + notification đọc được", () => {
      it("GET /tasks/:id (có read:task) → 200 (deep-link tới được record nguồn)", async () => {
        const res = await authGet(userU.token, `/tasks/${taskId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.id).toBe(taskId);
      });

      it("GET /notifications → thấy notification của mình, target_url = deep-link", async () => {
        const res = await authGet(userU.token, "/notifications");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const items = res.body.data as Array<Record<string, unknown>>;
        const n = items.find((i) => i.notification_id === notificationId);
        expect(n, "notification của recipient phải xuất hiện").toBeTruthy();
        expect(n!.target_url).toBe(`/tasks/${taskId}`);
      });

      it("GET /notifications/:id → 200, không rò secret/PII", async () => {
        const res = await authGet(userU.token, `/notifications/${notificationId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        expect(res.body.data.notification_id).toBe(notificationId);
        expect(res.body.data.target.target_url).toBe(`/tasks/${taskId}`);
        assertNoSecrets(res.body);
        assertNoTaskEmbed(res.body); // deep-link là con trỏ, KHÔNG nhúng tiêu đề task nguồn
      });
    });

    describe("REVOKE read:task → deep-link bị guard chặn, nhưng notification KHÔNG mất", () => {
      it("thu hồi read:task (xoá user_role) → GET /tasks/:id → 403 (module guard, không phải 404)", async () => {
        // Xoá user_role gắn role read:task → PermissionGuard (resolve per-request) mất grant read:task.
        await direct.query(`DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2`, [
          userU.userId,
          taskRoleId,
        ]);
        const res = await authGet(userU.token, `/tasks/${taskId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(403);
        expect(res.body.success).toBe(false);
      });

      it("notification VẪN list được (own-scope, read:notification còn) — không mất dữ liệu của chính mình", async () => {
        const res = await authGet(userU.token, "/notifications");
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        const items = res.body.data as Array<Record<string, unknown>>;
        expect(items.some((i) => i.notification_id === notificationId)).toBe(true);
      });

      it("notification detail VẪN 200 + không rò field record nguồn dù đã mất quyền task", async () => {
        const res = await authGet(userU.token, `/notifications/${notificationId}`);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
        // Deep-link vẫn còn (con trỏ) nhưng KHÔNG nhúng dữ liệu task nhạy cảm; body benign như seed.
        expect(res.body.data.target.target_url).toBe(`/tasks/${taskId}`);
        assertNoSecrets(res.body);
        assertNoTaskEmbed(res.body); // mất quyền task cũng KHÔNG làm lộ field task qua notification
      });
    });
  },
);
