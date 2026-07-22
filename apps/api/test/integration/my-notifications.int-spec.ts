/**
 * S4-NOTI-BE-1 — My-Notification API (HTTP, real permission engine + real DB). Own-scope TUYỆT ĐỐI:
 * MyNotificationsController/Service/Repository (src/notifications/my-notifications.*).
 *
 * done_when (RED-first — deny-path đi đầu):
 *   - noPerm (không role nào) → GET list/dropdown/unread-count/:id + POST mark-read/mark-all-read +
 *     DELETE → 403 (PermissionGuard fail-closed, KHÔNG chạm DB).
 *   - cross-user: userA1 (role employee, company A) đọc/mark/xoá notification của userA2 (CÙNG company)
 *     → 404 (own-scope tuyệt đối — recipient_user_id filter, KHÔNG lộ tồn tại).
 *   - cross-tenant: userA1 đọc notification của company B → 404 (RLS + own-scope filter).
 *   - list mặc định loại Hidden/Archived/Deleted; unread-count đúng SAU mark-read/mark-all-read; mark-read
 *     idempotent; DELETE soft (deleted_at set, KHÔNG hard-delete) → biến mất khỏi list mặc định.
 *   - partial index `idx_notifications_unread` tồn tại đúng định nghĩa (pg_indexes) + unread-count query
 *     index-servable (EXPLAIN với enable_seqscan=off KHÔNG rơi về Seq Scan) = "không scan bảng".
 *
 * Gate hasDb && LANE_DB (memory integration-test-lane-db-gate): .env trỏ DATABASE_URL vào DB dev chung
 * (hasDb=true) → CHỈ chạy trên DB cô lập lane, nếu không sẽ đỏ-giả/xanh-giả.
 */

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
import { appPool, directPool, hasDb, withClient } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const PASSWORD = "Passw0rd!test99";
const hasLaneDb = hasDb && !!process.env.LANE_DB;

let _pwHash: string | undefined;
async function hashedPw(): Promise<string> {
  if (!_pwHash) _pwHash = await new PasswordService().hash(PASSWORD);
  return _pwHash;
}

function api(app: INestApplication) {
  return request(app.getHttpServer());
}

async function login(app: INestApplication, slug: string, email: string): Promise<string> {
  const res = await api(app)
    .post("/auth/login")
    .send({ companySlug: slug, email, password: PASSWORD });
  expect(res.status, `login failed for ${email}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.data.accessToken as string;
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

interface SeedNotificationOpts {
  status?: string;
  priority?: string;
  title?: string;
  shortBody?: string;
  body?: string;
  notificationType?: string;
  moduleCode?: string;
  eventCode?: string;
  isRead?: boolean;
  targetUrl?: string;
}

/** Insert 1 hàng `notifications` — cột LEGACY (user_id/type/body/is_read NOT NULL) + cột MỚI song song
 *  (recipient_user_id/status/priority/title/short_body/notification_type/module_code/event_code/target_url)
 *  — mirror thực tế 2 bộ cột (S4-NOTI-DB-1 mig 0479). Dùng direct pool (superuser, bypass RLS). */
async function seedNotification(
  direct: Pool,
  companyId: string,
  recipientUserId: string,
  opts: SeedNotificationOpts = {},
): Promise<string> {
  const r = await direct.query(
    `INSERT INTO notifications
       (company_id, user_id, type, body, is_read,
        recipient_user_id, status, priority, title, short_body, notification_type, module_code, event_code,
        target_url)
     VALUES ($1, $2, 'general', $3, $4,
             $2, $5, $6, $7, $8, $9, $10, $11,
             $12)
     RETURNING id`,
    [
      companyId,
      recipientUserId,
      opts.body ??
        "Nội dung thông báo test đủ dài để kiểm tra fallback short_content khi cần thiết",
      opts.isRead ?? false,
      opts.status ?? "Unread",
      opts.priority ?? "Normal",
      opts.title ?? "Test notification",
      opts.shortBody ?? null,
      opts.notificationType ?? "Task",
      opts.moduleCode ?? "TASK",
      opts.eventCode ?? "TASK_ASSIGNED",
      opts.targetUrl ?? null,
    ],
  );
  return r.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)(
  "S4-NOTI-BE-1 My-Notification API (HTTP, real permission engine)",
  () => {
    const direct = directPool();
    const app = appPool();
    let nest: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let a1Email = "";
    let a2Email = "";
    let noPermEmail = "";
    let bEmail = "";
    let userA1 = "";
    let userA2 = "";
    let userB = "";

    let notifA1Unread1 = "";
    let notifA1Unread2High = "";
    let notifA1Read = "";
    let notifA1Hidden = "";
    let notifA2 = "";
    let notifB = "";

    async function canonicalRoleId(name: string): Promise<string> {
      const r = await direct.query(
        "SELECT id FROM roles WHERE name = $1 AND company_id IS NULL AND deleted_at IS NULL",
        [name],
      );
      if (r.rows.length === 0) {
        throw new Error(
          `[S4-NOTI-BE-1] canonical role không tồn tại: ${name} (mig 0005/0444 phải chạy trước)`,
        );
      }
      return r.rows[0].id as string;
    }

    beforeAll(async () => {
      const hash = await hashedPw();
      A = await seedCompany(direct, "notibe1a");
      B = await seedCompany(direct, "notibe1b");
      companyIds.push(A.companyId, B.companyId);

      const roleEmployeeId = await canonicalRoleId("employee");

      a1Email = `a1@${A.slug}.test`;
      a2Email = `a2@${A.slug}.test`;
      noPermEmail = `noperm@${A.slug}.test`;
      bEmail = `b1@${B.slug}.test`;

      userA1 = await seedUser(direct, A.companyId, a1Email, hash);
      userA2 = await seedUser(direct, A.companyId, a2Email, hash);
      await seedUser(direct, A.companyId, noPermEmail, hash); // KHÔNG gán role nào — deny-path
      userB = await seedUser(direct, B.companyId, bEmail, hash);

      await seedUserRole(direct, userA1, roleEmployeeId, A.companyId);
      await seedUserRole(direct, userA2, roleEmployeeId, A.companyId);
      await seedUserRole(direct, userB, roleEmployeeId, B.companyId);

      notifA1Unread1 = await seedNotification(direct, A.companyId, userA1, {
        status: "Unread",
        priority: "Normal",
        title: "A1 unread 1",
      });
      notifA1Unread2High = await seedNotification(direct, A.companyId, userA1, {
        status: "Unread",
        priority: "High",
        title: "A1 unread 2 (High)",
      });
      notifA1Read = await seedNotification(direct, A.companyId, userA1, {
        status: "Read",
        isRead: true,
        title: "A1 already read",
      });
      notifA1Hidden = await seedNotification(direct, A.companyId, userA1, {
        status: "Hidden",
        title: "A1 hidden — should NOT appear in default list",
      });
      notifA2 = await seedNotification(direct, A.companyId, userA2, {
        status: "Unread",
        title: "A2 own — cross-user probe target",
      });
      notifB = await seedNotification(direct, B.companyId, userB, {
        status: "Unread",
        title: "B own — cross-tenant probe target",
      });

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app.end();
      if (nest) await nest.close();
    });

    // ── deny-path (PermissionGuard fail-closed — KHÔNG role nào) ──────────────────────────────────────

    it("deny: noPerm (không role nào) → GET/POST/DELETE mọi route My-Notification → 403", async () => {
      const token = await login(nest, A.slug, noPermEmail);
      const h = bearer(token);

      expect((await api(nest).get("/notifications").set(h)).status).toBe(403);
      expect((await api(nest).get("/notifications/dropdown").set(h)).status).toBe(403);
      expect((await api(nest).get("/notifications/unread-count").set(h)).status).toBe(403);
      expect((await api(nest).get(`/notifications/${notifA1Unread1}`).set(h)).status).toBe(403);
      expect(
        (await api(nest).post(`/notifications/${notifA1Unread1}/mark-read`).set(h)).status,
      ).toBe(403);
      expect((await api(nest).post("/notifications/mark-all-read").set(h).send({})).status).toBe(
        403,
      );
      expect((await api(nest).delete(`/notifications/${notifA1Unread1}`).set(h)).status).toBe(403);
    });

    // ── cross-user / cross-tenant IDOR deny (own-scope tuyệt đối) ──────────────────────────────────────

    it("deny cross-user: userA1 (role employee) đọc notification của userA2 (cùng company) → 404", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).get(`/notifications/${notifA2}`).set(bearer(token));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOTI-ERR-NOTIFICATION-NOT-FOUND");
    });

    it("deny cross-tenant: userA1 đọc notification của company B → 404 (RLS + own-scope)", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).get(`/notifications/${notifB}`).set(bearer(token));
      expect(res.status).toBe(404);
    });

    it("deny cross-user: userA1 mark-read notification của userA2 → 404 (KHÔNG đổi trạng thái A2)", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).post(`/notifications/${notifA2}/mark-read`).set(bearer(token));
      expect(res.status).toBe(404);
    });

    it("deny cross-user: userA1 DELETE notification của userA2 → 404", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).delete(`/notifications/${notifA2}`).set(bearer(token));
      expect(res.status).toBe(404);
    });

    it("userA2 vẫn đọc được notification của chính mình (chứng minh 404 ở trên KHÔNG phải do hỏng row)", async () => {
      const token = await login(nest, A.slug, a2Email);
      const res = await api(nest).get(`/notifications/${notifA2}`).set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.data.notification_id).toBe(notifA2);
    });

    it("userB (company B) list KHÔNG thấy notification của company A", async () => {
      const token = await login(nest, B.slug, bEmail);
      const res = await api(nest).get("/notifications").set(bearer(token));
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ notification_id: string }>).map(
        (n) => n.notification_id,
      );
      expect(ids).toContain(notifB);
      expect(ids).not.toContain(notifA1Unread1);
    });

    // ── happy path — list mặc định loại Hidden; unread-count đúng; mark-read/mark-all-read/delete ──────

    it("GET /notifications: list của userA1 gồm Unread×2 + Read×1, KHÔNG gồm Hidden/của-A2/của-B", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).get("/notifications").set(bearer(token));
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ notification_id: string }>).map(
        (n) => n.notification_id,
      );
      expect(ids).toContain(notifA1Unread1);
      expect(ids).toContain(notifA1Unread2High);
      expect(ids).toContain(notifA1Read);
      expect(ids).not.toContain(notifA1Hidden);
      expect(ids).not.toContain(notifA2);
      expect(ids).not.toContain(notifB);
      expect(res.body.pagination).toMatchObject({ page: 1, per_page: 20 });
    });

    it("GET /notifications/unread-count: unread=2, high_priority=1, urgent=0 (TRƯỚC mark-read)", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).get("/notifications/unread-count").set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        unread_count: 2,
        high_priority_unread_count: 1,
        urgent_unread_count: 0,
      });
    });

    it("POST /notifications/:id/mark-read: đổi Unread→Read; unread-count giảm còn 1", async () => {
      const token = await login(nest, A.slug, a1Email);
      const h = bearer(token);

      const markRes = await api(nest).post(`/notifications/${notifA1Unread1}/mark-read`).set(h);
      expect(markRes.status).toBe(200);
      expect(markRes.body.data.status).toBe("Read");
      expect(markRes.body.data.read_at).toBeTruthy();

      const countRes = await api(nest).get("/notifications/unread-count").set(h);
      expect(countRes.body.data.unread_count).toBe(1);
    });

    it("POST /notifications/:id/mark-read LẦN 2 (đã Read) → idempotent, vẫn 200/status=Read", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest)
        .post(`/notifications/${notifA1Unread1}/mark-read`)
        .set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("Read");
    });

    it("POST /notifications/mark-all-read: updated_count=1 (notifA1Unread2High còn lại), unread_count=0", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).post("/notifications/mark-all-read").set(bearer(token)).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.updated_count).toBe(1);
      expect(res.body.data.unread_count).toBe(0);
    });

    it("DELETE /notifications/:id: soft-delete (204) — biến mất khỏi list mặc định, row VẪN CÒN (deleted_at set)", async () => {
      const token = await login(nest, A.slug, a1Email);
      const h = bearer(token);

      const delRes = await api(nest).delete(`/notifications/${notifA1Read}`).set(h);
      expect(delRes.status).toBe(204);

      const listRes = await api(nest).get("/notifications").set(h);
      const ids = (listRes.body.data as Array<{ notification_id: string }>).map(
        (n) => n.notification_id,
      );
      expect(ids).not.toContain(notifA1Read);

      const raw = await direct.query("SELECT deleted_at, status FROM notifications WHERE id = $1", [
        notifA1Read,
      ]);
      expect(raw.rows[0].deleted_at).not.toBeNull();
      expect(raw.rows[0].status).toBe("Deleted");
    });

    it("DELETE lần 2 trên notification đã xoá → 404 (KHÔNG hard-delete, KHÔNG xoá lại)", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).delete(`/notifications/${notifA1Read}`).set(bearer(token));
      expect(res.status).toBe(404);
    });

    it("GET /notifications/dropdown: trả unread_count + items, KHÔNG lộ Hidden/Deleted", async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).get("/notifications/dropdown?limit=10").set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.body.data.unread_count).toBe(0);
      const ids = (res.body.data.items as Array<{ notification_id: string }>).map(
        (n) => n.notification_id,
      );
      expect(ids).not.toContain(notifA1Hidden);
      expect(ids).not.toContain(notifA1Read);
    });

    // ── unread-count query hit đúng partial index (WO done_when: "không scan bảng") ────────────────────

    // ⚠️ KHÔNG assert planner chọn ĐÍCH DANH `idx_notifications_unread`. Bảng notifications có 8 index
    // mà (company_id, recipient_user_id) là tiền tố khớp; ở cardinality test (~6 hàng) chi phí chênh
    // nhau ~5% ⇒ index nào thắng là XỔ SỐ theo thống kê/phiên bản PG. Bài test cũ vì thế xanh ở local
    // nhưng ĐỎ trên CI (PR #255: planner chọn plan cost 7.72 thay vì 8.15) dù schema HOÀN TOÀN đúng.
    // Tách thành 2 khẳng định TẤT ĐỊNH, mỗi cái canh đúng một thứ:
    //   (1) index CÒN SỐNG & đúng định nghĩa — đọc thẳng pg_indexes, không qua planner;
    //   (2) query index-servable — không rơi về Seq Scan ở quy mô thật.
    // Cần CẢ HAI: kiểm chứng bằng cách DROP index rồi chạy lại — (2) vẫn xanh vì index anh em phục vụ
    // thay, chỉ (1) bắt được. Ngược lại (2) bắt được trường hợp WHERE đổi làm mất khả năng dùng index.
    it("partial index idx_notifications_unread TỒN TẠI đúng định nghĩa (cột + predicate)", async () => {
      const res = await direct.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
        ["idx_notifications_unread"],
      );
      expect(res.rows).toHaveLength(1);
      const def = res.rows[0].indexdef;
      expect(def).toMatch(/\(company_id, recipient_user_id\)/); // đúng cột + đúng thứ tự
      expect(def).toMatch(/WHERE \(\(status\)::text = 'Unread'::text\)/); // đúng predicate partial
    });

    it("unread-count query INDEX-SERVABLE — không rơi về Seq Scan khi có index dùng được", async () => {
      // enable_seqscan=off chỉ PHẠT seq scan (cost ~1e10) chứ không cấm: plan vẫn ra Seq Scan nghĩa là
      // KHÔNG index nào phục vụ được WHERE này ⇒ ở quy mô thật sẽ scan bảng. SET LOCAL + ROLLBACK để
      // KHÔNG rò setting sang connection khác trong pool.
      const text = await withClient(direct, async (client) => {
        await client.query("BEGIN");
        await client.query("SET LOCAL enable_seqscan = off");
        const plan = await client.query(
          `EXPLAIN SELECT count(*) FROM notifications
          WHERE company_id = $1 AND recipient_user_id = $2 AND status = 'Unread'`,
          [A.companyId, userA1],
        );
        await client.query("ROLLBACK");
        return plan.rows.map((r) => r["QUERY PLAN"] as string).join("\n");
      });
      expect(text).toMatch(/Index (Only )?Scan/);
      expect(text).not.toMatch(/Seq Scan/);
    });

    it("noPerm không tạo được rác trong DB qua route bị 403 (notifA1Unread2High vẫn Read, không đổi state)", async () => {
      const row = await direct.query("SELECT status FROM notifications WHERE id = $1", [
        notifA1Unread2High,
      ]);
      expect(row.rows[0].status).toBe("Read"); // đã bị mark-all-read ở test trước, KHÔNG bị noPerm đụng vào
    });

    it(`smoke: dùng randomUUID() cho id không tồn tại → 404 (không 500/leak)`, async () => {
      const token = await login(nest, A.slug, a1Email);
      const res = await api(nest).get(`/notifications/${randomUUID()}`).set(bearer(token));
      expect(res.status).toBe(404);
    });
  },
);
