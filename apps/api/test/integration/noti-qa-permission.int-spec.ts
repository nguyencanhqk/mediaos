/**
 * S4-QA-NOTI-1 — QA sign-off HỢP NHẤT cho NOTI permission / own-scope / deny-path (RED-first).
 * Nest app THẬT (JwtAuthGuard→CompanyGuard→PermissionGuard→controller) + Postgres cô lập — KHÔNG mock
 * guard/service. Ma trận nghiệm thu (Đội 3 đối chiếu) — truy vết NOTI-QA-Cxx:
 *
 *  DENY-PATH (RED-first — đi ĐẦU file, chặn TRƯỚC khi chạm DB):
 *   C01 own-scope noPerm         — user KHÔNG role → 403 mọi route My-Notification (PermissionGuard fail-closed).
 *   C02 own-scope cross-user     — userA đọc/mark/xoá notification của userA khác → 404 NOTI-ERR-NOTIFICATION-
 *                                  NOT-FOUND, KHÔNG lộ tồn tại, KHÔNG đổi state nạn nhân.
 *   C03 own-scope cross-tenant   — userA đọc notification company B → 404 (RLS + own-scope filter).
 *   C04 admin deny (module)      — employee (KHÔNG cặp config/template/delivery-log) → 403 CẢ GET events/
 *                                  templates/:id/delivery-logs + PATCH events/:id/templates/:id.
 *   C05 deny per-pair mảnh (GAP) — user CÓ view:notification-config nhưng THIẾU view:notification-template →
 *                                  GET /templates/:id vẫn 403 (quyền theo TỪNG cặp engine, KHÔNG blanket module);
 *                                  đồng thời GET /events 200 (chứng minh grant có hiệu lực, 403 là per-pair).
 *   C06 deny update per-pair     — user CÓ view:* (config/template/delivery-log) nhưng THIẾU update:* →
 *                                  PATCH /events/:id + /templates/:id → 403.
 *
 *  IDEMPOTENCY:
 *   C07 mark-read x2             — POST /:id/mark-read lần 2 (đã Read) → 200 status=Read; unread-count đúng
 *                                  (giảm 1 lần đầu, KHÔNG đổi/không âm lần sau).
 *   C08 mark-all-read x2 (GAP)   — POST /mark-all-read lần 2 → 200 updated_count=0, unread_count giữ 0.
 *
 *  ENGINE (event intake — trust-boundary + pipeline):
 *   C09 dedupe retry            — cùng eventCode+sourceEntityId+recipient 2 lần → created=1 rồi 0, deduped≥1,
 *                                  CHỈ 1 notification tồn tại (outbox retry KHÔNG nhân đôi).
 *   C10 actor-exclusion         — non-system: actor∈recipients → actor created=0; system-event → actor VẪN nhận.
 *
 *  CROSS-TENANT (BẤT BIẾN §1, 2-tenant):
 *   C11 admin cross-tenant      — admin B KHÔNG thấy delivery-log của A và ngược lại (withTenant + RLS).
 *
 * Gate CỨNG hasDb && LANE_DB (memory integration-test-lane-db-gate): .env chung → hasDb=true nhưng band NOTI
 * (mig 0479/0481/0483/0487) chỉ áp sạch trên DB cô lập lane → CHỈ chạy khi LANE_DB set (tránh xanh/đỏ-giả).
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
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-".padEnd(40, "0");

const runDb = hasDb && Boolean(process.env.LANE_DB);
const PASSWORD = "Passw0rd!test99";
// Ghép chuỗi để KHÔNG lọt secret-scan (gitleaks generic-api-key) — đây là internal-key test ephemeral,
// KHÔNG phải secret thật (chỉ dùng trong int-spec để giả header x-internal-key).
const INTERNAL_KEY = ["test-internal-key", "noti-qa-1"].join("-");
const COMPANY_ADMIN_ROLE = "00000000-0000-0000-0000-000000000001";
const EMPLOYEE_ROLE = "00000000-0000-0000-0000-000000000008";
const NOT_FOUND_CODE = "NOTI-ERR-NOTIFICATION-NOT-FOUND";

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

function internalAuth(token: string, key = INTERNAL_KEY) {
  return { Authorization: `Bearer ${token}`, "x-internal-key": key };
}

/** Grant 1 cặp (action,resourceType) từ catalog THẬT cho role tuỳ biến — KHÔNG upsert catalog (giữ is_sensitive). */
async function grantPairToRole(
  direct: Pool,
  roleId: string,
  action: string,
  resourceType: string,
): Promise<void> {
  const p = await direct.query<{ id: string }>(
    `SELECT id FROM permissions WHERE action = $1 AND resource_type = $2 LIMIT 1`,
    [action, resourceType],
  );
  if (!p.rows[0]) {
    throw new Error(`permission catalog thiếu cặp: ${action}:${resourceType} (mig 0481 phải chạy)`);
  }
  await seedRolePermission(direct, roleId, p.rows[0].id, "ALLOW", "Company");
}

interface SeedNotificationOpts {
  status?: string;
  priority?: string;
  title?: string;
  isRead?: boolean;
}

/** Chèn 1 hàng `notifications` (cột legacy + cột mới song song, mirror mig 0479) qua direct pool (bypass RLS). */
async function seedNotification(
  direct: Pool,
  companyId: string,
  recipientUserId: string,
  opts: SeedNotificationOpts = {},
): Promise<string> {
  const r = await direct.query<{ id: string }>(
    `INSERT INTO notifications
       (company_id, user_id, type, body, is_read,
        recipient_user_id, status, priority, title, notification_type, module_code, event_code)
     VALUES ($1, $2, 'general', $3, $4,
             $2, $5, $6, $7, 'Task', 'TASK', 'TASK_ASSIGNED')
     RETURNING id`,
    [
      companyId,
      recipientUserId,
      "Nội dung thông báo QA test đủ dài cho fallback short_content khi cần",
      opts.isRead ?? false,
      opts.status ?? "Unread",
      opts.priority ?? "Normal",
      opts.title ?? "QA notification",
    ],
  );
  return r.rows[0].id;
}

describe.skipIf(!runDb)(
  "S4-QA-NOTI-1 NOTI permission + own-scope + deny-path (unified sign-off)",
  () => {
    const direct = directPool();
    let nest: INestApplication;

    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    // Company A actors
    let noPermEmail = "";
    let ownerEmail = "";
    let probeEmail = "";
    let markEmail = "";
    let allEmail = "";
    let adminEmail = "";
    let configViewEmail = "";
    let viewNoUpdateEmail = "";
    let actorEmail = "";
    let filterEmail = "";
    // Company B actors
    let ownerBEmail = "";
    let adminBEmail = "";

    let ownerId = "";
    let actorId = "";
    let recip1Id = "";
    let allUserId = "";
    let filterUserId = "";
    let adminUserId = "";
    let filterArchivedId = "";

    // Notifications
    let notifOwnUnread1 = "";
    let notifOwnUnread2High = "";
    let notifOwnRead = "";
    let notifVictim = ""; // của probe? no — của owner, probed by probe user
    let notifMarkTarget = "";
    let notifB = "";

    // Admin config anchors
    let globalTemplateId = "";
    let globalEventId = "";
    // Delivery logs (cross-tenant)
    let logIdA = "";
    let logIdB = "";

    async function unreadCount(token: string): Promise<number> {
      const res = await api(nest).get("/notifications/unread-count").set(bearer(token));
      expect(res.status).toBe(200);
      return res.body.data.unread_count as number;
    }

    beforeAll(async () => {
      process.env.INTERNAL_API_KEY = INTERNAL_KEY;
      const hash = await hashedPw();

      A = await seedCompany(direct, "notiqaa");
      B = await seedCompany(direct, "notiqab");
      companyIds.push(A.companyId, B.companyId);

      noPermEmail = `noperm@${A.slug}.test`;
      ownerEmail = `owner@${A.slug}.test`;
      probeEmail = `probe@${A.slug}.test`;
      markEmail = `mark@${A.slug}.test`;
      allEmail = `all@${A.slug}.test`;
      adminEmail = `admin@${A.slug}.test`;
      configViewEmail = `cfgview@${A.slug}.test`;
      viewNoUpdateEmail = `viewnoup@${A.slug}.test`;
      actorEmail = `actor@${A.slug}.test`;
      filterEmail = `filter@${A.slug}.test`;
      ownerBEmail = `ownerb@${B.slug}.test`;
      adminBEmail = `adminb@${B.slug}.test`;

      await seedUser(direct, A.companyId, noPermEmail, hash); // KHÔNG role → deny-path
      ownerId = await seedUser(direct, A.companyId, ownerEmail, hash);
      const probeId = await seedUser(direct, A.companyId, probeEmail, hash);
      const markUserId = await seedUser(direct, A.companyId, markEmail, hash);
      allUserId = await seedUser(direct, A.companyId, allEmail, hash);
      const adminId = await seedUser(direct, A.companyId, adminEmail, hash);
      adminUserId = adminId;
      const configViewId = await seedUser(direct, A.companyId, configViewEmail, hash);
      const viewNoUpdateId = await seedUser(direct, A.companyId, viewNoUpdateEmail, hash);
      actorId = await seedUser(direct, A.companyId, actorEmail, hash);
      recip1Id = await seedUser(direct, A.companyId, `recip1@${A.slug}.test`, hash);
      filterUserId = await seedUser(direct, A.companyId, filterEmail, hash);
      const ownerBId = await seedUser(direct, B.companyId, ownerBEmail, hash);
      const adminBId = await seedUser(direct, B.companyId, adminBEmail, hash);

      // Roles: employee (own-scope My-Notification) + company-admin (admin config).
      await seedUserRole(direct, ownerId, EMPLOYEE_ROLE, A.companyId);
      await seedUserRole(direct, probeId, EMPLOYEE_ROLE, A.companyId);
      await seedUserRole(direct, markUserId, EMPLOYEE_ROLE, A.companyId);
      await seedUserRole(direct, allUserId, EMPLOYEE_ROLE, A.companyId);
      await seedUserRole(direct, adminId, COMPANY_ADMIN_ROLE, A.companyId);
      await seedUserRole(direct, actorId, EMPLOYEE_ROLE, A.companyId);
      await seedUserRole(direct, filterUserId, EMPLOYEE_ROLE, A.companyId);
      await seedUserRole(direct, ownerBId, EMPLOYEE_ROLE, B.companyId);
      await seedUserRole(direct, adminBId, COMPANY_ADMIN_ROLE, B.companyId);

      // Custom role C05: CHỈ view:notification-config (per-pair mảnh — thiếu template/delivery-log).
      const configViewRole = await seedRole(direct, A.companyId, "qa-noti-config-view-only");
      await grantPairToRole(direct, configViewRole, "view", "notification-config");
      await seedUserRole(direct, configViewId, configViewRole, A.companyId);

      // Custom role C06: view CẢ 3 (config/template/delivery-log) NHƯNG KHÔNG update:* → PATCH 403.
      const viewNoUpdateRole = await seedRole(direct, A.companyId, "qa-noti-view-no-update");
      await grantPairToRole(direct, viewNoUpdateRole, "view", "notification-config");
      await grantPairToRole(direct, viewNoUpdateRole, "view", "notification-template");
      await grantPairToRole(direct, viewNoUpdateRole, "view", "notification-delivery-log");
      await seedUserRole(direct, viewNoUpdateId, viewNoUpdateRole, A.companyId);

      // Notifications — own-scope grid.
      notifOwnUnread1 = await seedNotification(direct, A.companyId, ownerId, {
        status: "Unread",
        title: "owner unread 1",
      });
      notifOwnUnread2High = await seedNotification(direct, A.companyId, ownerId, {
        status: "Unread",
        priority: "High",
        title: "owner unread 2 (High)",
      });
      notifOwnRead = await seedNotification(direct, A.companyId, ownerId, {
        status: "Read",
        isRead: true,
        title: "owner already read",
      });
      notifVictim = await seedNotification(direct, A.companyId, ownerId, {
        status: "Unread",
        title: "owner — cross-user probe victim",
      });
      notifMarkTarget = await seedNotification(direct, A.companyId, markUserId, {
        status: "Unread",
        title: "mark idempotency target",
      });
      // mark-all-read idempotency (C08): allUser có ĐÚNG 2 unread, không route khác chạm.
      await seedNotification(direct, A.companyId, allUserId, { status: "Unread", title: "all 1" });
      await seedNotification(direct, A.companyId, allUserId, { status: "Unread", title: "all 2" });
      // C12 filter-branch grid (own-scope list predicates): Unread Normal + Unread High + Archived.
      await seedNotification(direct, A.companyId, filterUserId, {
        status: "Unread",
        priority: "Normal",
        title: "filter unread normal",
      });
      await seedNotification(direct, A.companyId, filterUserId, {
        status: "Unread",
        priority: "High",
        title: "filter unread high",
      });
      filterArchivedId = await seedNotification(direct, A.companyId, filterUserId, {
        status: "Archived",
        title: "filter archived",
      });
      notifB = await seedNotification(direct, B.companyId, ownerBId, {
        status: "Unread",
        title: "B own — cross-tenant probe target",
      });

      // Admin config anchors (global catalog seed) + delivery-log 1/tenant (cross-tenant C11).
      const tpl = await direct.query<{ id: string }>(
        `SELECT id FROM notification_templates
          WHERE template_code = 'TASK_ASSIGNED__IN_APP__vi-VN' AND company_id IS NULL LIMIT 1`,
      );
      if (!tpl.rows[0]) throw new Error("seed global template TASK_ASSIGNED__IN_APP__vi-VN thiếu");
      globalTemplateId = tpl.rows[0].id;

      const ev = await direct.query<{ id: string }>(
        `SELECT id FROM notification_events
          WHERE event_code = 'TASK_ASSIGNED' AND company_id IS NULL LIMIT 1`,
      );
      if (!ev.rows[0]) throw new Error("seed global event TASK_ASSIGNED thiếu");
      globalEventId = ev.rows[0].id;

      logIdA = await seedDeliveryLog(direct, A.companyId, adminId);
      logIdB = await seedDeliveryLog(direct, B.companyId, adminBId);

      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      nest = moduleRef.createNestApplication();
      nest.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      nest.useGlobalFilters(new AllExceptionsFilter());
      await nest.init();
    });

    afterAll(async () => {
      // delivery_logs FK → notifications → xoá TRƯỚC cleanupTenants (helper chỉ xoá notifications).
      await direct.query(
        `DELETE FROM notification_delivery_logs WHERE company_id = ANY($1::uuid[])`,
        [companyIds],
      );
      await cleanupTenants(direct, companyIds);
      await direct.end();
      if (nest) await nest.close();
      delete process.env.INTERNAL_API_KEY;
    });

    async function seedDeliveryLog(
      d: Pool,
      companyId: string,
      recipientUserId: string,
    ): Promise<string> {
      const notif = await d.query<{ id: string }>(
        `INSERT INTO notifications (company_id, user_id, body) VALUES ($1, $2, $3) RETURNING id`,
        [companyId, recipientUserId, "delivery-log anchor"],
      );
      const log = await d.query<{ id: string }>(
        `INSERT INTO notification_delivery_logs
           (company_id, notification_id, recipient_user_id, channel, delivery_status)
         VALUES ($1, $2, $3, 'IN_APP', 'Sent') RETURNING id`,
        [companyId, notif.rows[0].id, recipientUserId],
      );
      return log.rows[0].id;
    }

    // ── C01 own-scope noPerm — fail-closed 403 mọi route ─────────────────────────────────────────────
    it("C01 deny: noPerm (KHÔNG role) → 403 mọi route My-Notification (fail-closed, KHÔNG chạm DB)", async () => {
      const h = bearer(await login(nest, A.slug, noPermEmail));
      expect((await api(nest).get("/notifications").set(h)).status).toBe(403);
      expect((await api(nest).get("/notifications/dropdown").set(h)).status).toBe(403);
      expect((await api(nest).get("/notifications/unread-count").set(h)).status).toBe(403);
      expect((await api(nest).get(`/notifications/${notifOwnUnread1}`).set(h)).status).toBe(403);
      expect(
        (await api(nest).post(`/notifications/${notifOwnUnread1}/mark-read`).set(h)).status,
      ).toBe(403);
      expect((await api(nest).post("/notifications/mark-all-read").set(h).send({})).status).toBe(
        403,
      );
      expect((await api(nest).delete(`/notifications/${notifOwnUnread1}`).set(h)).status).toBe(403);
    });

    // ── C02 own-scope cross-user — 404, KHÔNG lộ tồn tại, KHÔNG đổi state nạn nhân ───────────────────
    it("C02 deny cross-user: probe (employee) GET notification của owner → 404 NOTI-ERR-NOTIFICATION-NOT-FOUND", async () => {
      const res = await api(nest)
        .get(`/notifications/${notifVictim}`)
        .set(bearer(await login(nest, A.slug, probeEmail)));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(NOT_FOUND_CODE);
    });

    it("C02 deny cross-user: probe mark-read + DELETE notification owner → 404; row nạn nhân KHÔNG đổi", async () => {
      const token = await login(nest, A.slug, probeEmail);
      const mark = await api(nest)
        .post(`/notifications/${notifVictim}/mark-read`)
        .set(bearer(token));
      expect(mark.status).toBe(404);
      const del = await api(nest).delete(`/notifications/${notifVictim}`).set(bearer(token));
      expect(del.status).toBe(404);

      const raw = await direct.query<{ status: string; deleted_at: Date | null }>(
        `SELECT status, deleted_at FROM notifications WHERE id = $1`,
        [notifVictim],
      );
      expect(raw.rows[0].status).toBe("Unread"); // KHÔNG bị mark-read
      expect(raw.rows[0].deleted_at).toBeNull(); // KHÔNG bị xoá
    });

    it("C02 owner đọc được notification của CHÍNH MÌNH (chứng minh 404 ở trên do own-scope, KHÔNG do hỏng row)", async () => {
      const res = await api(nest)
        .get(`/notifications/${notifVictim}`)
        .set(bearer(await login(nest, A.slug, ownerEmail)));
      expect(res.status).toBe(200);
      expect(res.body.data.notification_id).toBe(notifVictim);
    });

    // ── C03 own-scope cross-tenant — 404 ─────────────────────────────────────────────────────────────
    it("C03 deny cross-tenant: probe (company A) GET notification company B → 404 (RLS + own-scope)", async () => {
      const res = await api(nest)
        .get(`/notifications/${notifB}`)
        .set(bearer(await login(nest, A.slug, probeEmail)));
      expect(res.status).toBe(404);
    });

    it("C03 cross-tenant list: probe (A) KHÔNG thấy notification company B", async () => {
      const res = await api(nest)
        .get("/notifications")
        .set(bearer(await login(nest, A.slug, probeEmail)));
      expect(res.status).toBe(200);
      const ids = (res.body.data as Array<{ notification_id: string }>).map(
        (n) => n.notification_id,
      );
      expect(ids).not.toContain(notifB);
    });

    // ── C04 admin deny (module-level) — employee thiếu CẢ 3 cặp config → 403 GET + PATCH ─────────────
    it("C04 deny admin: employee → 403 GET events/templates/:id/delivery-logs + PATCH events/templates", async () => {
      const h = bearer(await login(nest, A.slug, ownerEmail)); // employee = KHÔNG cặp admin config
      expect((await api(nest).get("/notifications/events").set(h)).status).toBe(403);
      expect(
        (await api(nest).get(`/notifications/templates/${globalTemplateId}`).set(h)).status,
      ).toBe(403);
      expect((await api(nest).get("/notifications/delivery-logs").set(h)).status).toBe(403);
      expect(
        (
          await api(nest)
            .patch(`/notifications/events/${globalEventId}`)
            .set(h)
            .send({ is_enabled: false })
        ).status,
      ).toBe(403);
      expect(
        (
          await api(nest)
            .patch(`/notifications/templates/${globalTemplateId}`)
            .set(h)
            .send({ title_template: "x" })
        ).status,
      ).toBe(403);
    });

    // ── C05 deny per-pair mảnh (GAP) — view:config CÓ, view:template THIẾU ──────────────────────────
    it("C05 per-pair (GAP): configView CÓ view:notification-config → GET /events 200 (grant có hiệu lực)", async () => {
      const res = await api(nest)
        .get("/notifications/events")
        .query({ per_page: 100 })
        .set(bearer(await login(nest, A.slug, configViewEmail)));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("C05 per-pair (GAP): configView THIẾU view:notification-template → GET /templates/:id vẫn 403 (per-pair, KHÔNG blanket module)", async () => {
      const res = await api(nest)
        .get(`/notifications/templates/${globalTemplateId}`)
        .set(bearer(await login(nest, A.slug, configViewEmail)));
      expect(res.status).toBe(403);
    });

    it("C05 per-pair (GAP): configView THIẾU view:notification-delivery-log → GET /delivery-logs 403", async () => {
      const res = await api(nest)
        .get("/notifications/delivery-logs")
        .set(bearer(await login(nest, A.slug, configViewEmail)));
      expect(res.status).toBe(403);
    });

    // ── C06 deny update per-pair — có view:* nhưng thiếu update:* → PATCH 403 ────────────────────────
    it("C06 per-pair: viewNoUpdate có view:* nhưng THIẾU update:notification-config → PATCH /events/:id 403", async () => {
      const token = await login(nest, A.slug, viewNoUpdateEmail);
      // Chứng minh grant view có hiệu lực (GET template 200) — 403 PATCH là per-pair, không blanket.
      const getTpl = await api(nest)
        .get(`/notifications/templates/${globalTemplateId}`)
        .set(bearer(token));
      expect(getTpl.status, JSON.stringify(getTpl.body)).toBe(200);

      const patchEv = await api(nest)
        .patch(`/notifications/events/${globalEventId}`)
        .set(bearer(token))
        .send({ is_enabled: false });
      expect(patchEv.status).toBe(403);
    });

    it("C06 per-pair: viewNoUpdate THIẾU update:notification-template → PATCH /templates/:id 403", async () => {
      const res = await api(nest)
        .patch(`/notifications/templates/${globalTemplateId}`)
        .set(bearer(await login(nest, A.slug, viewNoUpdateEmail)))
        .send({ title_template: "x" });
      expect(res.status).toBe(403);
    });

    // ── C07 mark-read idempotent ────────────────────────────────────────────────────────────────────
    it("C07 mark-read x2: lần 1 giảm unread; lần 2 (đã Read) → 200 status=Read, unread-count KHÔNG đổi", async () => {
      const token = await login(nest, A.slug, markEmail);
      const before = await unreadCount(token);
      expect(before).toBe(1);

      const first = await api(nest)
        .post(`/notifications/${notifMarkTarget}/mark-read`)
        .set(bearer(token));
      expect(first.status).toBe(200);
      expect(first.body.data.status).toBe("Read");
      expect(await unreadCount(token)).toBe(0);

      const second = await api(nest)
        .post(`/notifications/${notifMarkTarget}/mark-read`)
        .set(bearer(token));
      expect(second.status).toBe(200);
      expect(second.body.data.status).toBe("Read");
      expect(await unreadCount(token)).toBe(0); // KHÔNG âm, KHÔNG đổi
    });

    // ── C08 mark-all-read idempotent (GAP) ──────────────────────────────────────────────────────────
    it("C08 mark-all-read x2 (GAP): lần 1 updated_count=2 unread=0; lần 2 → updated_count=0, unread giữ 0", async () => {
      const token = await login(nest, A.slug, allEmail);
      expect(await unreadCount(token)).toBe(2);

      const first = await api(nest)
        .post("/notifications/mark-all-read")
        .set(bearer(token))
        .send({});
      expect(first.status).toBe(200);
      expect(first.body.data.updated_count).toBe(2);
      expect(first.body.data.unread_count).toBe(0);

      const second = await api(nest)
        .post("/notifications/mark-all-read")
        .set(bearer(token))
        .send({});
      expect(second.status).toBe(200);
      expect(second.body.data.updated_count).toBe(0); // GAP: idempotent — KHÔNG mark lại
      expect(second.body.data.unread_count).toBe(0); // giữ 0, KHÔNG âm
      expect(await unreadCount(token)).toBe(0);
    });

    // ── C09 intake dedupe retry ─────────────────────────────────────────────────────────────────────
    it("C09 dedupe retry: cùng eventCode+sourceEntityId+recipient 2 lần → created=1 rồi 0, deduped≥1, 1 notification", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const sourceEntityId = randomUUID();
      const payload = {
        eventCode: "TASK_COMMENT_CREATED",
        sourceModule: "TASK",
        sourceEntityType: "task",
        sourceEntityId,
        recipient: { mode: "UserIds", userIds: [recip1Id] },
        // S5-NOTI-FIX-1: template global TASK_COMMENT_CREATED có target_url_template '/tasks/{taskId}' (mig 0497).
        // Payload PHẢI có taskId (producer THẬT commentPayload luôn có) — thiếu ⇒ renderer giữ literal {taskId} →
        // assertInternalTargetUrl 422. sourceEntityId CHÍNH là task id (sourceEntityType='task') ⇒ dùng lại.
        payload: { taskId: sourceEntityId, taskTitle: "QA dedupe" },
      };

      const r1 = await api(nest)
        .post("/internal/v1/notifications/events")
        .set(internalAuth(token))
        .send(payload);
      expect(r1.status, JSON.stringify(r1.body)).toBe(200);
      expect(r1.body.data.createdCount).toBe(1);

      const r2 = await api(nest)
        .post("/internal/v1/notifications/events")
        .set(internalAuth(token))
        .send(payload);
      expect(r2.status).toBe(200);
      expect(r2.body.data.createdCount).toBe(0);
      expect(r2.body.data.dedupedCount).toBeGreaterThanOrEqual(1);

      const n = await direct.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM notifications
         WHERE company_id=$1 AND recipient_user_id=$2 AND event_code='TASK_COMMENT_CREATED'
           AND deleted_at IS NULL`,
        [A.companyId, recip1Id],
      );
      expect(n.rows[0].n).toBe(1);
    });

    // ── C10 actor-exclusion (điều kiện, KHÔNG nuốt) ─────────────────────────────────────────────────
    it("C10 actor-exclusion: non-system TASK_ASSIGNED actor∈recipients → actor created=0", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const res = await api(nest)
        .post("/internal/v1/notifications/events")
        .set(internalAuth(token))
        .send({
          eventCode: "TASK_ASSIGNED",
          sourceModule: "TASK",
          actorUserId: actorId,
          recipient: { mode: "UserIds", userIds: [actorId] },
          // S5-NOTI-FIX-1: taskId bắt buộc — template TASK_ASSIGNED '/tasks/{taskId}' (0497) render TRƯỚC vòng
          // recipient; thiếu taskId ⇒ 422 dù recipient rỗng sau actor-exclusion. Producer THẬT luôn có taskId.
          payload: { taskId: randomUUID(), taskTitle: "self-exclude" },
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.createdCount).toBe(0);
    });

    it("C10 actor-exclusion: system-event SYSTEM_ERROR_DETECTED actor∈recipients → actor VẪN nhận (created=1)", async () => {
      const token = await login(nest, A.slug, actorEmail);
      const res = await api(nest)
        .post("/internal/v1/notifications/events")
        .set(internalAuth(token))
        .send({
          eventCode: "SYSTEM_ERROR_DETECTED",
          sourceModule: "SYSTEM",
          actorUserId: actorId,
          recipient: { mode: "UserIds", userIds: [actorId] },
          payload: {},
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.createdCount).toBe(1);
    });

    // ── C11 admin cross-tenant delivery-log isolation (BẤT BIẾN §1) ─────────────────────────────────
    it("C11 cross-tenant admin: admin A thấy delivery-log A, KHÔNG thấy B; admin B ngược lại", async () => {
      const resA = await api(nest)
        .get("/notifications/delivery-logs")
        .set(bearer(await login(nest, A.slug, adminEmail)));
      expect(resA.status).toBe(200);
      const idsA = (resA.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(idsA).toContain(logIdA);
      expect(idsA).not.toContain(logIdB);

      const resB = await api(nest)
        .get("/notifications/delivery-logs")
        .set(bearer(await login(nest, B.slug, adminBEmail)));
      expect(resB.status).toBe(200);
      const idsB = (resB.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(idsB).toContain(logIdB);
      expect(idsB).not.toContain(logIdA);
    });

    // ── C12 filter-branch coverage — own-scope list predicates giữ ĐÚNG scope khi áp filter ──────────
    // Mọi filter LUÔN nằm trong own-scope (recipient_user_id=filterUser) + tenant A — chứng minh predicate
    // filter KHÔNG nới scope; đồng thời phủ nhánh listWhere/statusVisibility/dropdown/markAllRead repo.
    it("C12 own-scope list filters (status/type/module/event/priority/date/include_*) → 200, KHÔNG rò scope", async () => {
      const token = await login(nest, A.slug, filterEmail);
      const from = new Date(Date.now() - 86_400_000).toISOString();
      const to = new Date(Date.now() + 86_400_000).toISOString();

      const unread = await api(nest)
        .get("/notifications")
        .query({ status: "Unread", priority: "High" })
        .set(bearer(token));
      expect(unread.status, JSON.stringify(unread.body)).toBe(200);
      const highRows = unread.body.data as Array<{ priority: string; status: string }>;
      expect(highRows.length).toBeGreaterThan(0);
      for (const r of highRows) {
        expect(r.priority).toBe("High");
        expect(r.status).toBe("Unread");
      }

      const combo = await api(nest)
        .get("/notifications")
        .query({
          notification_type: "Task",
          source_module: "TASK",
          event_code: "TASK_ASSIGNED",
          created_from: from,
          created_to: to,
        })
        .set(bearer(token));
      expect(combo.status, JSON.stringify(combo.body)).toBe(200);
      expect((combo.body.data as unknown[]).length).toBeGreaterThan(0);

      const archived = await api(nest)
        .get("/notifications")
        .query({ include_archived: true, include_hidden: true })
        .set(bearer(token));
      expect(archived.status).toBe(200);
      const archivedIds = (archived.body.data as Array<{ notification_id: string }>).map(
        (n) => n.notification_id,
      );
      expect(archivedIds).toContain(filterArchivedId);
    });

    it("C12 dropdown unread_only=true → chỉ Unread (own-scope)", async () => {
      const res = await api(nest)
        .get("/notifications/dropdown")
        .query({ unread_only: true, limit: 10 })
        .set(bearer(await login(nest, A.slug, filterEmail)));
      expect(res.status).toBe(200);
      for (const it of res.body.data.items as Array<{ status: string }>) {
        expect(it.status).toBe("Unread");
      }
    });

    it("C12 admin delivery-log filters (recipient/channel/status/notification_id/date) → 200, own tenant", async () => {
      const token = await login(nest, A.slug, adminEmail);
      const notifRow = await direct.query<{ notification_id: string }>(
        `SELECT notification_id FROM notification_delivery_logs WHERE id = $1`,
        [logIdA],
      );
      const notifId = notifRow.rows[0].notification_id;
      const res = await api(nest)
        .get("/notifications/delivery-logs")
        .query({
          recipient_user_id: adminUserId,
          channel: "IN_APP",
          delivery_status: "Sent",
          notification_id: notifId,
          created_from: new Date(Date.now() - 86_400_000).toISOString(),
          created_to: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .set(bearer(token));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const ids = (res.body.data as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(logIdA);
      expect(ids).not.toContain(logIdB);
    });

    it("C12 admin event filters (enabled/search/event_code) → 200, TASK_ASSIGNED enabled", async () => {
      const res = await api(nest)
        .get("/notifications/events")
        .query({
          enabled: true,
          search: "task_assigned",
          event_code: "TASK_ASSIGNED",
          per_page: 100,
        })
        .set(bearer(await login(nest, A.slug, adminEmail)));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const items = res.body.data as Array<{ event_code: string; is_enabled: boolean }>;
      expect(items.every((e) => e.is_enabled)).toBe(true);
      expect(items.some((e) => e.event_code === "TASK_ASSIGNED")).toBe(true);
    });

    it("C12 mark-all-read with filters (source_module/notification_type/created_before) → idempotent, own-scope", async () => {
      const token = await login(nest, A.slug, filterEmail);
      const res = await api(nest)
        .post("/notifications/mark-all-read")
        .set(bearer(token))
        .send({
          source_module: "TASK",
          notification_type: "Task",
          created_before: new Date(Date.now() + 86_400_000).toISOString(),
        });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.updated_count).toBe(2); // 2 unread TASK (Archived KHÔNG bị đụng)
      expect(res.body.data.unread_count).toBe(0);
    });
  },
);
