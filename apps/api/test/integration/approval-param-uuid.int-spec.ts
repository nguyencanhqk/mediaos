/**
 * S10-FND-PARAMUUID-2 · lane **L3-APPROVAL-PARAM** (KI-078) — biên HTTP THẬT cho kênh **PARAM** của
 * `approval/requests/:id/*` (2 tham số GHI của workflow phê duyệt đa cấp APR-001/002).
 *
 *   POST /approval/requests/:id/approve  [ApprovalInboxController#approve] perm=approve:approval-request
 *   POST /approval/requests/:id/reject   [ApprovalInboxController#reject]  perm=reject:approval-request
 *
 * ─── MỨC ĐỘ — PHÁT BIỂU TRƯỚC MỌI SỐ ĐO ─────────────────────────────────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác đi hết đường tới Postgres, vỡ `22P02`, filter trả **500**.
 * Request vẫn **bị từ chối**, KHÔNG hàng nào rò, KHÔNG quyền nào bị vượt, KHÔNG bước phê duyệt nào
 * được ghi ⇒ **KHÔNG phải lỗ bảo mật**. Giá trị của bản vá đúng hai điều, đừng để reviewer tự suy:
 *   (a) hợp đồng API — client nhận **400** có mã thay vì 500 vô nghĩa;
 *   (b) chấm dứt việc payload rác bơm **500 GIẢ** vào giám sát, làm loãng tín hiệu 500 THẬT.
 * Y hệt KI-068 (kênh BODY) và KI-077 (`foundation/files`).
 *
 * ─── SỐ ĐO HTTP TRƯỚC BẢN VÁ (26/08/2026, `LANE_DB=mediaos_paramuuid2c`, actor thật, body hợp lệ) ─
 *   POST /approval/requests/khong-phai-uuid/approve → **500** · `error.type='Error'` · SYSTEM-ERR-001
 *        (log: `Failed query: select … from "approval_requests" where … "id" = $2`, params `…,khong-phai-uuid`
 *         — tức tham số rác ĐI TỚI TẬN DB, `approval-multilevel.service.ts:160 loadPendingRequest`)
 *   POST /approval/requests/khong-phai-uuid/reject  → **500** · `error.type='Error'` · SYSTEM-ERR-001
 *   POST /approval/requests/<uuid hợp lệ, không tồn tại>/approve → **404** `NotFoundException`
 *   POST /approval/requests/<uuid hợp lệ, không tồn tại>/reject  → **404** `NotFoundException`
 *   POST /approval/requests/<HÀNG THẬT pending, actor = approver cấp hiện tại>/approve → **201**
 *   POST /approval/requests/<HÀNG THẬT pending, actor = approver cấp hiện tại>/reject  → **201**
 *   GET  /approval/inbox (literal-sibling) → **200**
 * ⇒ CẢ HAI tham số của lane này được VÁ. Không tham số nào là mã nghiệp vụ/slug: hàng thật khoá bằng
 *   UUID và trả 201 sau khi gắn pipe (ca ALLOW-201 dưới đây là vế chứng minh, không phải suy luận).
 *
 * ─── PHẢN-VÍ-DỤ CÙNG NHÓM, ĐO NHƯNG KHÔNG VÁ ────────────────────────────────────────────────────
 * `POST /auth/sessions/:id/revoke` (`auth.controller.ts:276`) — CHẠY LẠI `auth-session-selfservice.int-spec.ts`
 * ngày 26/08/2026 trên cùng lane DB: **11/11 PASS**, trong đó `:93-98` ghim `not-a-uuid` → **404 (KHÔNG 500)**
 * và `:85-91` ghim UUID hợp lệ không tồn tại → **404**. Nguyên nhân KHÔNG phải ngẫu nhiên:
 * `auth.service.ts:1118-1119` tự `uuidSchema.safeParse(sessionId)` rồi ném `NotFoundException` CÙNG
 * thông điệp với nhánh owner-check. Đó là hợp đồng bảo mật CỐ Ý: 404 **đơn trị** cho mọi đầu vào không
 * dẫn tới phiên của chính mình ⇒ không mở kênh dò tồn tại phiên. Gắn `ParseUUIDPipe` ở đó sẽ tách
 * không-gian-trả-lời thành 400 (sai dạng) vs 404 (không có/không phải của bạn) — **PHÁ** chính thứ
 * thiết kế đang cố xoá. ⇒ verdict `skipped` (xem `param-uuid-verdicts.ts`, lane L4).
 * ⛔ Vì vậy `apps/api/src/auth/auth.controller.ts` KHÔNG nằm trong diff của WO này (WO 🟡 LIGHT;
 * CLAUDE.md §6: chạm `auth` ⇒ FULL gate).
 *
 * ─── LUẬT ĐO (vi phạm một điều là số đo VÔ GIÁ TRỊ) ─────────────────────────────────────────────
 * • Guard chạy TRƯỚC pipe ⇒ probe không token chỉ ra 401 = số 0 đội lốt. Mọi ca dùng actor ĐÃ đăng nhập.
 * • Actor KHÔNG phải super-admin ([[superadmin-not-a-canonical-role]]); KHÔNG seed `*:*` — `permissions`
 *   là catalog TOÀN CỤC và `cleanupTenants` không dọn nó ([[test-fixture-stamps-global-permission-catalog]]).
 *   Cặp quyền lấy ĐÚNG catalog thật: `('approve'|'reject','approval-request', is_sensitive=false)`
 *   (`migrations/0082_g8_permissions_seed.sql:14-15`).
 * • Body PHẢI HỢP LỆ (`reject` đòi `description` min(1)) — 400-do-body là số đo GIẢ.
 * • TUYỆT ĐỐI KHÔNG gửi `Idempotency-Key`: interceptor (`common/idempotency/idempotency.interceptor.ts:69-70`)
 *   chạy TRƯỚC pipe; header vắng thì `return next.handle()` nên BỎ header là an toàn, GỬI thì phát lại/409
 *   làm hỏng số đo.
 * • NGƯỠNG CHỐNG NỚI: DENY ở lại **400 ĐƠN TRỊ**. `expect([400,500]).toContain(...)` là mở lại lỗ trong
 *   khi sổ ghi ĐÓNG ([[tests-can-pin-a-hole-open]]).
 *
 * ─── FIXTURE FSM cho ca ALLOW-201 (route phê duyệt cần tiền điều kiện, không chữa bằng nới assert) ──
 * Chuỗi 3 cấp: `workflow_definitions(max_approval_level=3)` → `projects` → `content_items` →
 * `workflow_instances` → `workflow_steps(status='waiting_review', reviewer_user_id=actor)` →
 * `approval_requests(status='pending', current_level=1, max_level=3)` + `approval_rules(1..3)`.
 * Actor là approver **cấp 1** (cấp hiện tại) ⇒ qua được `assertActorIsCurrentLevelApprover`; `reviewer_user_id`
 * = actor ⇒ nhánh `reject` qua được FSM consumer-transition của `ApprovalService.requestRevision`.
 * Ca ALLOW rơi 409/422 ⇒ **SỬA FIXTURE**, không nới assert ([[deny-cases-vacuous-without-allow-case]]).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid2c`.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ZodValidationPipe } from "nestjs-zod";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { PasswordService } from "../../src/auth/password.service";
import { AllExceptionsFilter } from "../../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../../src/common/interceptors/response-envelope.interceptor";
import { loginPasswordFixture } from "../helpers/fixture-secrets";
import { directPool, hasDb } from "../helpers/integration-db";
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

const hasLaneDb = hasDb && !!process.env.LANE_DB;
const LOGIN_PW = loginPasswordFixture("s10paramuuid2l3");

/** Giá trị KHÔNG phải UUID dùng chung mọi ca — một hình dạng, để so sánh giữa các route có nghĩa. */
const JUNK = "khong-phai-uuid";

/** Body HỢP LỆ theo `packages/contracts/src/approval.ts` — 400 quan sát được PHẢI đến từ PARAM. */
const APPROVE_BODY = { comment: "L3 param-uuid probe" } as const;
const REJECT_BODY = { description: "L3 param-uuid probe", comment: "L3" } as const;

interface ApproverTrio {
  l1: string;
  l2: string;
  l3: string;
}

/**
 * Gieo MỘT chuỗi phê duyệt 3 cấp đang `pending` ở cấp 1 và trả `approval_requests.id` THẬT.
 * Khuôn lấy từ `test/approval-inbox.e2e-spec.ts` (đã sống), khác một điểm CÓ CHỦ Ý: `reviewer_user_id`
 * = approver cấp 1 để nhánh `reject` (đi qua FSM consumer-transition) cũng chạy được đường THÀNH CÔNG.
 */
async function seedPendingApprovalRequest(
  direct: Pool,
  companyId: string,
  approvers: ApproverTrio,
): Promise<string> {
  const defRes = await direct.query(
    `INSERT INTO workflow_definitions (company_id, code, name, applies_to, max_approval_level, allow_parallel_steps)
     VALUES ($1, $2, 'S10 param-uuid L3', 'content_item', 3, false) RETURNING id`,
    [companyId, `s10pu2l3-${randomUUID().slice(0, 8)}`],
  );
  // Tên project phải DUY NHẤT trong company (`projects_company_name_active_uq`) — hai lần gieo trong
  // cùng suite sẽ vỡ unique nếu dùng tên cố định.
  const projRes = await direct.query(
    `INSERT INTO projects (company_id, name, status) VALUES ($1, $2, 'active') RETURNING id`,
    [companyId, `s10pu2l3-prj-${randomUUID().slice(0, 8)}`],
  );
  const ciRes = await direct.query(
    `INSERT INTO content_items (company_id, project_id, title, status) VALUES ($1, $2, 's10pu2l3-ci', 'draft') RETURNING id`,
    [companyId, projRes.rows[0].id],
  );
  const instRes = await direct.query(
    `INSERT INTO workflow_instances (company_id, workflow_definition_id, content_item_id, current_step_order, status)
     VALUES ($1, $2, $3, 1, 'active') RETURNING id`,
    [companyId, defRes.rows[0].id, ciRes.rows[0].id],
  );
  const stepRes = await direct.query(
    `INSERT INTO workflow_steps (company_id, workflow_instance_id, step_order, step_code, step_name, status, reviewer_user_id)
     VALUES ($1, $2, 1, 'script', 'Viết kịch bản', 'waiting_review', $3) RETURNING id`,
    [companyId, instRes.rows[0].id, approvers.l1],
  );
  const stepId = stepRes.rows[0].id as string;
  const reqRes = await direct.query(
    `INSERT INTO approval_requests (company_id, workflow_step_id, requested_by, status, current_level, max_level)
     VALUES ($1, $2, $3, 'pending', 1, 3) RETURNING id`,
    [companyId, stepId, approvers.l1],
  );
  for (const [level, approver] of [
    [1, approvers.l1],
    [2, approvers.l2],
    [3, approvers.l3],
  ] as const) {
    await direct.query(
      `INSERT INTO approval_rules (company_id, workflow_step_id, level, approver_user_id) VALUES ($1, $2, $3, $4)`,
      [companyId, stepId, level, approver],
    );
  }
  return reqRes.rows[0].id as string;
}

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-2 · L3 — biên HTTP kênh PARAM của approval/requests/:id (approve · reject)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];
    let token = "";
    let approvers: ApproverTrio;

    const http = () => request(app.getHttpServer());
    const authPost = (u: string) => http().post(u).set("Authorization", `Bearer ${token}`);

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở BIÊN → envelope → filter. Thiếu một lớp thì mọi kết luận về
      // "400 hay 500" đều đo một stack KHÁC với PROD.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10pu2l3");
      companyIds.push(A.companyId);

      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `approver-${randomUUID().slice(0, 8)}@s10pu2l3.local`;
      const l1 = await seedUser(direct, A.companyId, email, hash);
      const l2 = await seedUser(
        direct,
        A.companyId,
        `lvl2-${randomUUID().slice(0, 8)}@s10pu2l3.local`,
        hash,
      );
      const l3 = await seedUser(
        direct,
        A.companyId,
        `lvl3-${randomUUID().slice(0, 8)}@s10pu2l3.local`,
        hash,
      );
      approvers = { l1, l2, l3 };

      // Role RIÊNG của test, chỉ đúng HAI cặp quyền của hai route đang đo — không mượn company-admin,
      // không `*:*`.
      const roleId = await seedRole(direct, A.companyId, `s10pu2l3-${randomUUID().slice(0, 8)}`);
      for (const action of ["approve", "reject"] as const) {
        const permId = await seedPermissionCatalog(direct, action, "approval-request", false);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, l1, roleId, A.companyId);

      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      token = res.body.data.accessToken as string;
    }, 180_000);

    afterAll(async () => {
      await cleanupTenants(direct, companyIds);
      await direct.end();
      await app?.close();
    });

    /**
     * Oracle DENY: tham số rác phải bị chặn ở BIÊN bằng 400 ĐƠN TRỊ và KHÔNG mang hiện vật đường 500 cũ.
     * `error.type` là hiện vật phân biệt: `'Error'` (lỗi PG `22P02` lọt tới DB) hoặc `'ZodError'`
     * (schema ném thô). Neo theo hiện vật chứ không chỉ theo status: một ngày ai đó map `22P02` thành
     * 400 ở filter thì status xanh mà lỗ vẫn nguyên vị trí — request rác vẫn đi hết đường tới DB.
     */
    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    /**
     * Oracle ALLOW dùng chung — loại CẢ 400 VÀ 500. Chỉ đòi `≠400` là ca XANH-RỖNG: route vẫn
     * 500/429/401 mà lưới vẫn xanh. Ở đây còn siết thêm một bậc: mỗi ca ghim status ĐƠN TRỊ ĐO ĐƯỢC
     * (404 cho UUID không tồn tại), đối xứng với luật DENY 400 đơn trị.
     */
    function expectPassedBoundary(res: request.Response, expectedStatus: number): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
      expect(res.status, body).toBe(expectedStatus);
    }

    // ── 1. POST /approval/requests/:id/approve ────────────────────────────
    it("PARAM · POST requests/:id/approve với :id rác → 400 ở BIÊN", async () => {
      // ĐO 26/08/2026 (trước vá): 500 · error.type='Error' · SYSTEM-ERR-001 (22P02 tới tận DB).
      expectRejectedAtBoundary(
        await authPost(`/approval/requests/${JUNK}/approve`).send(APPROVE_BODY),
      );
    });

    it("ALLOW · approve với UUID hợp lệ (không tồn tại) đi qua biên → 404 đơn trị", async () => {
      // ĐO 26/08/2026 (trước vá): 404 NotFoundException — bản vá KHÔNG được đổi con số này.
      expectPassedBoundary(
        await authPost(`/approval/requests/${randomUUID()}/approve`).send(APPROVE_BODY),
        404,
      );
    });

    /**
     * ALLOW trên HÀNG THẬT — loại khoá `approval_request`.
     * Đây là vế DUY NHẤT bắt được ca `:id` hoá ra là mã nghiệp vụ/slug bị `ParseUUIDPipe` chặn OAN.
     * ⚠️ 201 (KHÔNG phải 200): `@Post` của Nest mặc định 201 và route này KHÔNG khai `@HttpCode(200)`
     * — số đo THẬT 26/08/2026, ghim đơn trị đúng như đo (mirror `approval-inbox.e2e-spec.ts`).
     */
    it("ALLOW-201 · approve trên HÀNG THẬT (approval_request pending, actor = approver cấp 1)", async () => {
      const requestId = await seedPendingApprovalRequest(direct, A.companyId, approvers);
      const res = await authPost(`/approval/requests/${requestId}/approve`).send(APPROVE_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ── 2. POST /approval/requests/:id/reject ─────────────────────────────
    it("PARAM · POST requests/:id/reject với :id rác → 400 ở BIÊN", async () => {
      // ĐO 26/08/2026 (trước vá): 500 · error.type='Error' · SYSTEM-ERR-001.
      // Body HỢP LỆ (`description` có mặt) ⇒ 400 sau bản vá KHÔNG thể đến từ body-pipe.
      expectRejectedAtBoundary(
        await authPost(`/approval/requests/${JUNK}/reject`).send(REJECT_BODY),
      );
    });

    it("ALLOW · reject với UUID hợp lệ (không tồn tại) đi qua biên → 404 đơn trị", async () => {
      // ĐO 26/08/2026 (trước vá): 404 NotFoundException.
      expectPassedBoundary(
        await authPost(`/approval/requests/${randomUUID()}/reject`).send(REJECT_BODY),
        404,
      );
    });

    it("ALLOW-201 · reject trên HÀNG THẬT (approval_request pending, actor = reviewer + approver cấp 1)", async () => {
      const requestId = await seedPendingApprovalRequest(direct, A.companyId, approvers);
      const res = await authPost(`/approval/requests/${requestId}/reject`).send(REJECT_BODY);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    });

    // ── 3. Hồi quy ĐỊNH TUYẾN — literal-sibling ───────────────────────────
    /**
     * `GET /approval/inbox` (`approval-inbox.controller.ts:27`) là literal-sibling DUY NHẤT của
     * controller này — liệt kê bằng ĐỌC FILE, không bằng lời. Gắn pipe cho `requests/:id/*` không được
     * làm nó đổi hành vi.
     */
    it("ĐỊNH TUYẾN · literal-sibling GET /approval/inbox vẫn 200 sau khi gắn pipe", async () => {
      const res = await http().get("/approval/inbox").set("Authorization", `Bearer ${token}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(Array.isArray(res.body.data), JSON.stringify(res.body)).toBe(true);
    });
  },
);
