/**
 * S10-FND-PARAMUUID-2 · lane L1-LEAVE-PARAM (KI-078) — biên HTTP THẬT cho kênh **PARAM** của module LEAVE.
 *
 * ─── MỨC ĐỘ (phát biểu TRƯỚC mọi số đo — đừng để reviewer phải tự suy) ──────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: `:id` rác vẫn bị TỪ CHỐI, không hàng nào rò, không quyền nào bị vượt
 * (guard + scope chạy TRƯỚC, và câu SQL với uuid rác chỉ nổ `22P02` chứ không trả dữ liệu).
 * ⇒ **KHÔNG phải lỗ bảo mật.** Giá trị của bản vá đúng hai điều:
 *   (a) hợp đồng API — client nhận 400 có mã thay vì 500 vô nghĩa;
 *   (b) chấm dứt việc payload rác bơm **500 GIẢ** vào giám sát, làm loãng tín hiệu 500 THẬT.
 * Y hệt KI-068 (kênh BODY) và KI-077 (kênh PARAM của foundation/files).
 *
 * ─── PHẠM VI: 15 tham số `:id` của LeaveController (SPEC-05, workflow phê duyệt FSM) ────────────
 *   1  PATCH /leave/types/:id                       [updateType]                    manage:leave
 *   2  GET   /leave/me/requests/:id                 [getMyRequest]                  view-own:leave
 *   3  GET   /leave/balances/:id/transactions       [listBalanceTransactionsCanonical] view-transaction:leave-balance
 *   4  PATCH /leave/requests/:id                    [updateRequestDraft]            update-draft:leave
 *   5  POST  /leave/requests/:id/submit             [submitRequest]                 submit:leave
 *   6  POST  /leave/requests/:id/approve            [approveRequest]                approve:leave
 *   7  POST  /leave/requests/:id/reject             [rejectRequest]                 reject:leave
 *   8  POST  /leave/requests/:id/cancel             [cancelRequest]                 cancel-own:leave
 *   9  POST  /leave/requests/:id/revoke             [revokeRequest]                 revoke:leave
 *   10 PATCH /leave/admin/types/:id                 [updateTypeAdmin]               update:leave-type
 *   11 POST  /leave/admin/types/:id/delete          [deleteTypeAdmin]               delete:leave-type
 *   12 PATCH /leave/admin/policies/:id              [updatePolicy]                  update:leave-policy
 *   13 POST  /leave/admin/policies/:id/delete       [deletePolicy]                  delete:leave-policy
 *   14 GET   /leave/admin/balances/:id/transactions [listBalanceTransactions]       view-transaction:leave-balance
 *   15 POST  /leave/admin/balances/:id/adjust       [adjustBalance]                 adjust:leave-balance
 *
 * ─── SỐ ĐO HTTP TRƯỚC BẢN VÁ (chạy 26/08/2026 trên `mediaos_paramuuid2a`, KHÔNG suy luận) ───────
 * Trường `before` của mỗi dòng trong bảng `ROUTES` giữ ĐÚNG status + `error.type` đo được cho route đó
 * với `:id` = "khong-phai-uuid". Số đo nằm TRONG code (không phải comment rời) để nó đi CÙNG spec, và
 * ca "bảng đo phủ đúng 15 tham số" ép mọi dòng phải có số — không dòng nào được để trống rồi suy ra.
 *
 * Đo được (`:id` = "khong-phai-uuid", actor đã đăng nhập, body hợp lệ, KHÔNG Idempotency-Key):
 *    1 PATCH types/:id                       → 500 · error.type="InternalServerErrorException"
 *    2 GET   me/requests/:id                 → 500 · error.type="Error"
 *    3 GET   balances/:id/transactions       → 500 · error.type="Error"
 *    4 PATCH requests/:id                    → 500 · error.type="InternalServerErrorException"
 *    5 POST  requests/:id/submit             → 500 · error.type="InternalServerErrorException"
 *    6 POST  requests/:id/approve            → 500 · error.type="InternalServerErrorException"
 *    7 POST  requests/:id/reject             → 500 · error.type="InternalServerErrorException"
 *    8 POST  requests/:id/cancel             → 500 · error.type="Error"
 *    9 POST  requests/:id/revoke             → 500 · error.type="InternalServerErrorException"
 *   10 PATCH admin/types/:id                 → 500 · error.type="InternalServerErrorException"
 *   11 POST  admin/types/:id/delete          → 500 · error.type="InternalServerErrorException"
 *   12 PATCH admin/policies/:id              → 500 · error.type="InternalServerErrorException"
 *   13 POST  admin/policies/:id/delete       → 500 · error.type="InternalServerErrorException"
 *   14 GET   admin/balances/:id/transactions → 500 · error.type="Error"
 *   15 POST  admin/balances/:id/adjust       → 500 · error.type="InternalServerErrorException"
 *
 * 15/15 tham số HỎNG — KHÔNG có phản-ví-dụ nào trong nhóm LEAVE (khác auth `sessions/:id/revoke` = 404,
 * đo ở `auth-session-selfregistration`… xem lane L3). Hai hình dạng `error.type` là hai đường lọt khác
 * nhau: `"Error"` = lỗi PG `22P02` thô nổi lên tới filter; `"InternalServerErrorException"` = service đã
 * bắt rồi bọc lại (`mapError`). Cả hai đều là 500 GIẢ do payload rác.
 *
 * ĐỐI CHIẾU cùng lần chạy: 15 ca ALLOW (UUID hợp lệ không tồn tại) đều 404 và 20 ca ALLOW-200/
 * literal-sibling đều XANH ⇒ 500 ở trên đến từ ĐÚNG hình dạng `:id`, không phải từ body/quyền/fixture.
 *
 * ─── LUẬT ĐO (mỗi dòng là một cái bẫy đã sập ở WO trước) ────────────────────────────────────────
 * · Actor ĐÃ đăng nhập — guard chạy TRƯỚC pipe, probe không token chỉ ra 401 = **số 0 đội lốt**.
 * · ĐÚNG cặp quyền lấy từ catalog THẬT (`leave-permissions.const.ts` = nguồn sự thật, đồng bộ mig 0455).
 *   KHÔNG super-admin ([[superadmin-not-a-canonical-role]]), KHÔNG seed `*:*` — `permissions` là catalog
 *   TOÀN CỤC, `cleanupTenants` KHÔNG dọn nó ([[test-fixture-stamps-global-permission-catalog]]).
 * · BODY HỢP LỆ ở mọi ca. Body sai ăn 400 của `ZodValidationPipe` và **ngụy trang thành "route đã đúng"**.
 * · TUYỆT ĐỐI KHÔNG gửi header `Idempotency-Key`. `common/idempotency/idempotency.interceptor.ts:69-70`:
 *   header RỖNG ⇒ `return next.handle()` (bỏ header là an toàn); GỬI thì interceptor chạy TRƯỚC pipe và
 *   phát lại/409 làm hỏng số đo — `requests/:id/approve` + `/reject` có `@Idempotent()`.
 * · Assert DENY là **400 ĐƠN TRỊ** + neo hiện vật `error.type ∉ {'Error','ZodError'}`.
 *   `expect([400,500]).toContain(...)` là ghim lỗ MỞ trong khi sổ ghi ĐÓNG ([[tests-can-pin-a-hole-open]]).
 * · Assert ALLOW (UUID hợp lệ KHÔNG tồn tại) là status ĐƠN TRỊ đo được (404), đối xứng luật DENY —
 *   chỉ đòi `≠400` là XANH-RỖNG (route vẫn 500/429 mà lưới vẫn xanh).
 * · ALLOW-200 trên **HÀNG THẬT** cho ĐỦ 4 LOẠI KHOÁ của lane: `leave_type` · `leave_request` ·
 *   `leave_balance` · `leave_policy`. Đây là vế DUY NHẤT bắt được ca `:id` hoá ra là mã nghiệp vụ bị
 *   `ParseUUIDPipe` chặn OAN ([[deny-cases-vacuous-without-allow-case]]).
 *
 * ─── `leave_types.id` là UUID hay `code`? TRẢ LỜI BẰNG HÀNG THẬT ────────────────────────────────
 * `leave_types` có PK `uuid` (`db/schema/hr.ts:328`) NHƯNG cũng có cột `code` (mã nghiệp vụ). Nếu route
 * nhận `code` thì gắn `ParseUUIDPipe` là CHẶN OAN đường sống. Ca "types/:id nhận UUID chứ KHÔNG nhận
 * code" dựng một loại nghỉ thật rồi PATCH bằng CẢ HAI giá trị: UUID → 200, `code` → bị từ chối.
 *
 * ─── FSM: ca ALLOW-200 của đường phê duyệt cần tiền điều kiện ĐÚNG ──────────────────────────────
 * approve/reject cần đơn ở trạng thái `Pending` và approver **KHÁC** người nộp (self-approval → 422
 * `LEAVE-ERR-APPROVER-INVALID`, `leave.controller.ts:307-308`). Vì vậy fixture có HAI actor: `emp`
 * (self-service, người nộp) và `adm` (quản trị/phê duyệt @Company, KHÔNG giữ create/submit). Ca ALLOW
 * rơi 422 ⇒ SỬA FIXTURE, TUYỆT ĐỐI không "chữa" bằng nới assert.
 *
 * ─── LITERAL-SIBLING (đọc từ file, không đoán) ──────────────────────────────────────────────────
 * `types`(144) · `me/requests`(199) · `balances`(215) · `requests`(247) · `requests/calculate`(270) ·
 * `admin/types`(397) · `admin/policies`(436) · `admin/balances`(475) — mỗi cái có ca 200 sau khi gắn pipe,
 * để chứng minh `ParseUUIDPipe` không nuốt route tĩnh cùng tiền tố.
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5). DB phát triển: `mediaos_paramuuid2a`.
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
const LOGIN_PW = loginPasswordFixture("s10lvpu");

/** Giá trị KHÔNG phải UUID dùng chung mọi ca — một hình dạng, để so sánh giữa các route có nghĩa. */
const JUNK = "khong-phai-uuid";

type Scope = "Own" | "Team" | "Company";
type Pair = readonly [action: string, resource: string, scope: Scope, sensitive: boolean];

/**
 * `emp` — người NỘP đơn. Đúng bộ cặp self-service mà mig 0455 cấp @Own cho cả 4 vai chính tắc.
 * KHÔNG giữ approve/reject/revoke ⇒ ca ALLOW của đường phê duyệt buộc phải dùng actor khác (chống
 * self-approval 422).
 */
const EMP_PAIRS: readonly Pair[] = [
  ["view-own", "leave", "Own", false],
  ["create", "leave", "Own", false],
  ["submit", "leave", "Own", false],
  ["update-draft", "leave", "Own", false],
  ["cancel-own", "leave", "Own", false],
  ["view-own", "leave-balance", "Own", false],
  ["view", "leave-type", "Company", false],
];

/**
 * `adm` — mặt quản trị/phê duyệt @Company. `manage:leave` + `read:leave` là cặp của HAI route legacy
 * (`PATCH /leave/types/:id`, `GET /leave/balances`) — lấy `is_sensitive` ĐÚNG như catalog thật
 * (cả hai = false; xác nhận bằng `SELECT` trên lane DB, không đoán).
 */
const ADM_PAIRS: readonly Pair[] = [
  ["manage", "leave", "Company", false],
  ["read", "leave", "Company", false],
  ["view", "leave", "Company", true],
  ["approve", "leave", "Company", false],
  ["reject", "leave", "Company", true],
  ["revoke", "leave", "Company", true],
  ["view", "leave-type", "Company", false],
  ["update", "leave-type", "Company", true],
  ["delete", "leave-type", "Company", true],
  ["view", "leave-policy", "Company", true],
  ["update", "leave-policy", "Company", true],
  ["delete", "leave-policy", "Company", true],
  ["view", "leave-balance", "Company", true],
  ["view-transaction", "leave-balance", "Company", true],
  ["adjust", "leave-balance", "Company", true],
];

type Method = "get" | "post" | "patch";

interface ParamRoute {
  /** Nhãn ngắn dùng trong tên ca test. */
  readonly label: string;
  readonly method: Method;
  /** Dựng path từ giá trị `:id`. */
  readonly path: (id: string) => string;
  /** Body HỢP LỆ theo Zod schema của route (rỗng cho GET). */
  readonly body?: Record<string, unknown>;
  /** Actor nào có ĐÚNG cặp quyền của route. */
  readonly actor: "emp" | "adm";
  /**
   * Status ĐƠN TRỊ đo được khi `:id` là UUID hợp lệ nhưng KHÔNG tồn tại. Ghim đơn trị (không phải
   * "≠400") để ca ALLOW không xanh-rỗng khi route quay ra 500/429.
   */
  readonly passStatus: number;
  /** Số đo THẬT trước bản vá (26/08/2026) khi `:id` = JUNK — status + `error.type`. */
  readonly before: { status: number; errorType: string };
}

/**
 * `leaveTypeId` phải là UUID hợp lệ ở MỌI body dùng schema draft — nếu để rác ở body thì 400 quan sát
 * được đến từ BODY chứ không từ PARAM, và cả phép đo mất nghĩa.
 */
const BODY_TYPE_ID = randomUUID();
const DRAFT_BODY = {
  leaveTypeId: BODY_TYPE_ID,
  startDate: "2027-05-03",
  endDate: "2027-05-03",
  durationType: "FullDay",
} as const;

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-2 · L1 — biên HTTP kênh PARAM của LEAVE (15 tham số :id)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    const tokens: Record<"emp" | "adm", string> = { emp: "", adm: "" };
    let empUserId = "";
    let empProfileId = "";
    let typeId = "";
    let typeCode = "";
    let balanceId = "";

    const http = () => request(app.getHttpServer());

    /**
     * Gửi request KHÔNG kèm `Idempotency-Key`. Bọc thành một hàm duy nhất để không ai vô tình thêm
     * header đó ở một ca lẻ rồi làm lệch số đo của cả bảng.
     */
    function send(
      method: Method,
      url: string,
      who: "emp" | "adm",
      body?: Record<string, unknown>,
    ): request.Test {
      const req = http()[method](url).set("Authorization", `Bearer ${tokens[who]}`);
      return method === "get" ? req : req.send(body ?? {});
    }

    async function actor(
      tag: string,
      pairs: readonly Pair[],
    ): Promise<{ token: string; userId: string }> {
      const hash = await new PasswordService().hash(LOGIN_PW);
      const email = `${tag}-${randomUUID().slice(0, 8)}@s10lvpu.local`;
      const userId = await seedUser(direct, A.companyId, email, hash);
      const roleId = await seedRole(
        direct,
        A.companyId,
        `s10lvpu-${tag}-${randomUUID().slice(0, 8)}`,
      );
      for (const [action, resource, scope, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
      }
      await seedUserRole(direct, userId, roleId, A.companyId);
      const res = await http()
        .post("/auth/login")
        .send({ companySlug: A.slug, email, password: LOGIN_PW });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return { token: res.body.data.accessToken as string, userId };
    }

    async function seedProfile(userId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO employee_profiles (company_id, user_id, employee_code)
         VALUES ($1,$2,$3) RETURNING id`,
        [A.companyId, userId, `E-${userId.slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    }

    /** Một loại nghỉ THẬT (active, trừ số dư, cho phép nghỉ nguyên ngày + nhiều ngày). */
    async function plantType(): Promise<{ id: string; code: string }> {
      const code = `LT-${randomUUID().slice(0, 8)}`;
      const r = await direct.query(
        `INSERT INTO leave_types
           (company_id, code, name, paid, status, deduct_balance, balance_unit,
            allow_full_day, allow_half_day, allow_hourly, allow_multiple_days,
            require_reason, min_notice_days, sort_order, allow_negative_balance)
         VALUES ($1,$2,$3,true,'active',true,'Day',true,true,false,true,false,0,1,false)
         RETURNING id`,
        [A.companyId, code, "Phép năm (paramuuid2)"],
      );
      return { id: r.rows[0].id as string, code };
    }

    async function plantBalance(leaveTypeId: string, total: number): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_balances
           (company_id, user_id, employee_id, leave_type_id, year, total_days, used_days, pending_days)
         VALUES ($1,$2,$3,$4,2027,$5,0,0) RETURNING id`,
        [A.companyId, empUserId, empProfileId, leaveTypeId, total],
      );
      return r.rows[0].id as string;
    }

    async function plantPolicy(leaveTypeId: string): Promise<string> {
      const r = await direct.query(
        `INSERT INTO leave_policies
           (company_id, leave_type_id, policy_code, name, policy_scope, effective_from, status)
         VALUES ($1,$2,$3,$4,'Company','2027-01-01','Active') RETURNING id`,
        [
          A.companyId,
          leaveTypeId,
          `LP-${randomUUID().slice(0, 8)}`,
          "Chính sách phép (paramuuid2)",
        ],
      );
      return r.rows[0].id as string;
    }

    /** Tạo một đơn NHÁP thật của `emp` (đi qua HTTP để đúng đường sống). */
    async function draftRequest(date: string): Promise<string> {
      const res = await send("post", "/leave/requests", "emp", {
        leaveTypeId: typeId,
        startDate: date,
        endDate: date,
        durationType: "FullDay",
        submitNow: false,
      });
      expect(res.status, `draft ${date}: ${JSON.stringify(res.body)}`).toBe(201);
      return res.body.data.id as string;
    }

    /** Tạo một đơn ĐANG CHỜ DUYỆT (Draft → Pending trong cùng một lần gọi). */
    async function pendingRequest(date: string): Promise<string> {
      const res = await send("post", "/leave/requests", "emp", {
        leaveTypeId: typeId,
        startDate: date,
        endDate: date,
        durationType: "FullDay",
        submitNow: true,
      });
      expect(res.status, `pending ${date}: ${JSON.stringify(res.body)}`).toBe(201);
      expect(res.body.data.status, JSON.stringify(res.body)).toBe("Pending");
      return res.body.data.id as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts:48-50 — Zod validate ở BIÊN → envelope → filter. Thiếu một lớp thì mọi kết luận
      // "400 hay 500" đều vô nghĩa vì nó đo một stack KHÁC với PROD.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10lvpu");
      companyIds.push(A.companyId);

      const emp = await actor("emp", EMP_PAIRS);
      tokens.emp = emp.token;
      empUserId = emp.userId;
      empProfileId = await seedProfile(empUserId);

      const adm = await actor("adm", ADM_PAIRS);
      tokens.adm = adm.token;
      await seedProfile(adm.userId);

      const planted = await plantType();
      typeId = planted.id;
      typeCode = planted.code;
      balanceId = await plantBalance(typeId, 30);
    }, 180_000);

    afterAll(async () => {
      await direct
        ?.query("DELETE FROM employee_profiles WHERE company_id = ANY($1::uuid[])", [companyIds])
        .catch(() => undefined);
      if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
      await direct?.end();
      await app?.close();
    });

    /**
     * Oracle DENY: tham số rác phải bị chặn ở BIÊN bằng 400, và KHÔNG mang hiện vật của đường 500 cũ.
     *
     * `error.type` là hiện vật phân biệt: `'Error'` (lỗi PG `22P02` lọt tới DB) hoặc `'ZodError'`
     * (schema ném thô) đều là dấu của đường 500. Neo theo hiện vật chứ không chỉ theo status: một ngày
     * nào đó ai đó map `22P02` thành 400 ở filter thì status xanh mà lỗ vẫn nguyên vị trí — request rác
     * vẫn đi hết đường tới DB.
     */
    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    // ══ BẢNG 15 THAM SỐ · số đo THẬT trước bản vá ═══════════════════════════════════════════════
    const ROUTES: readonly ParamRoute[] = [
      {
        label: "PATCH types/:id",
        method: "patch",
        path: (id) => `/leave/types/${id}`,
        body: { name: "Đổi tên" },
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "GET me/requests/:id",
        method: "get",
        path: (id) => `/leave/me/requests/${id}`,
        actor: "emp",
        passStatus: 404,
        before: { status: 500, errorType: "Error" },
      },
      {
        label: "GET balances/:id/transactions",
        method: "get",
        path: (id) => `/leave/balances/${id}/transactions`,
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "Error" },
      },
      {
        label: "PATCH requests/:id",
        method: "patch",
        path: (id) => `/leave/requests/${id}`,
        body: { ...DRAFT_BODY },
        actor: "emp",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "POST requests/:id/submit",
        method: "post",
        path: (id) => `/leave/requests/${id}/submit`,
        body: { note: "gửi duyệt" },
        actor: "emp",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "POST requests/:id/approve",
        method: "post",
        path: (id) => `/leave/requests/${id}/approve`,
        body: { note: "duyệt" },
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "POST requests/:id/reject",
        method: "post",
        path: (id) => `/leave/requests/${id}/reject`,
        body: { reason: "trùng lịch" },
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "POST requests/:id/cancel",
        method: "post",
        path: (id) => `/leave/requests/${id}/cancel`,
        body: { cancelReason: "đổi kế hoạch" },
        actor: "emp",
        passStatus: 404,
        before: { status: 500, errorType: "Error" },
      },
      {
        label: "POST requests/:id/revoke",
        method: "post",
        path: (id) => `/leave/requests/${id}/revoke`,
        body: { revokeReason: "thu hồi" },
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "PATCH admin/types/:id",
        method: "patch",
        path: (id) => `/leave/admin/types/${id}`,
        body: { name: "Đổi tên (admin)" },
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "POST admin/types/:id/delete",
        method: "post",
        path: (id) => `/leave/admin/types/${id}/delete`,
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "PATCH admin/policies/:id",
        method: "patch",
        path: (id) => `/leave/admin/policies/${id}`,
        body: { name: "Đổi tên chính sách" },
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "POST admin/policies/:id/delete",
        method: "post",
        path: (id) => `/leave/admin/policies/${id}/delete`,
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
      {
        label: "GET admin/balances/:id/transactions",
        method: "get",
        path: (id) => `/leave/admin/balances/${id}/transactions`,
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "Error" },
      },
      {
        label: "POST admin/balances/:id/adjust",
        method: "post",
        path: (id) => `/leave/admin/balances/${id}/adjust`,
        body: { amountDays: 1, reason: "cấp bù" },
        actor: "adm",
        passStatus: 404,
        before: { status: 500, errorType: "InternalServerErrorException" },
      },
    ];

    it("bảng đo phủ ĐÚNG 15 tham số :id của LeaveController (chống bỏ sót khi thêm route)", () => {
      expect(ROUTES).toHaveLength(15);
      expect(new Set(ROUTES.map((r) => r.label)).size).toBe(15);
      // Mọi dòng PHẢI mang số đo TRƯỚC-VÁ thật; không dòng nào được để trống rồi "suy ra".
      for (const r of ROUTES) {
        expect(r.before.status, r.label).toBeGreaterThanOrEqual(400);
        expect(r.before.errorType, r.label).not.toBe("");
      }
    });

    // ══ (1) DENY — `:id` rác → 400 ĐƠN TRỊ ở BIÊN ══════════════════════════════════════════════
    for (const r of ROUTES) {
      it(`PARAM · ${r.label} với :id rác → 400 ở BIÊN (trước vá: ${r.before.status}/${r.before.errorType})`, async () => {
        expectRejectedAtBoundary(await send(r.method, r.path(JUNK), r.actor, r.body));
      });
    }

    // ══ (2) ALLOW biên — UUID hợp lệ KHÔNG tồn tại → status ĐƠN TRỊ (không 400, không 500) ══════
    for (const r of ROUTES) {
      it(`ALLOW · ${r.label} với UUID hợp lệ (không tồn tại) ĐI QUA biên → ${r.passStatus}`, async () => {
        const res = await send(r.method, r.path(randomUUID()), r.actor, r.body);
        expect(res.status, JSON.stringify(res.body)).toBe(r.passStatus);
      });
    }

    // ══ (3) ALLOW-200 trên HÀNG THẬT — ĐỦ 4 LOẠI KHOÁ của lane ═════════════════════════════════

    // ── LOẠI KHOÁ `leave_type` ──────────────────────────────────────────────────────────────────
    /**
     * Ca QUYẾT ĐỊNH có được vá hay không: `:id` của `PATCH /leave/types/:id` là UUID hay là `code`?
     * `leave.service.ts:87` gọi `findTypeByIdTx(companyId, id)` — tra theo cột `id`. Nhưng suy luận từ
     * code KHÔNG đủ; ca này chứng minh bằng HÀNG THẬT: UUID → 200 và `code` → KHÔNG phải 200.
     */
    it("HÀNG THẬT · leave_type — PATCH types/:id nhận UUID → 200 (và KHÔNG nhận mã nghiệp vụ `code`)", async () => {
      const ok = await send("patch", `/leave/types/${typeId}`, "adm", {
        name: "Phép năm (đã sửa)",
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);

      // `code` là mã nghiệp vụ, KHÔNG phải khoá của route ⇒ không bao giờ trả 200. Nếu ca này đỏ vì
      // status 200 thì route NHẬN mã ⇒ gỡ ParseUUIDPipe ngay và ghi verdict `skipped`.
      const byCode = await send("patch", `/leave/types/${typeCode}`, "adm", { name: "x" });
      expect(byCode.status, JSON.stringify(byCode.body)).not.toBe(200);
    });

    it("HÀNG THẬT · leave_type — PATCH admin/types/:id → 200", async () => {
      const res = await send("patch", `/leave/admin/types/${typeId}`, "adm", {
        name: "Phép năm (admin sửa)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("HÀNG THẬT · leave_type — POST admin/types/:id/delete → 200", async () => {
      const spare = await plantType(); // loại nghỉ RIÊNG, không đơn nào tham chiếu
      const res = await send("post", `/leave/admin/types/${spare.id}/delete`, "adm");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ── LOẠI KHOÁ `leave_request` ───────────────────────────────────────────────────────────────
    it("HÀNG THẬT · leave_request — GET me/requests/:id + PATCH requests/:id + POST submit → 200", async () => {
      const id = await draftRequest("2027-05-03");

      const detail = await send("get", `/leave/me/requests/${id}`, "emp");
      expect(detail.status, JSON.stringify(detail.body)).toBe(200);

      const patched = await send("patch", `/leave/requests/${id}`, "emp", {
        leaveTypeId: typeId,
        startDate: "2027-05-04",
        endDate: "2027-05-04",
        durationType: "FullDay",
        reason: "đổi ngày",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);

      const submitted = await send("post", `/leave/requests/${id}/submit`, "emp", {
        note: "gửi duyệt",
      });
      expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
      expect(submitted.body.data.status).toBe("Pending");
    });

    /**
     * Người duyệt là `adm` (KHÁC người nộp `emp`) — self-approval sẽ ăn 422 `LEAVE-ERR-APPROVER-INVALID`.
     * Ca này rơi 422 ⇒ FIXTURE sai, KHÔNG được nới assert.
     */
    it("HÀNG THẬT · leave_request — POST requests/:id/approve → 200 (approver ≠ người nộp)", async () => {
      const id = await pendingRequest("2027-05-05");
      const res = await send("post", `/leave/requests/${id}/approve`, "adm", { note: "ok" });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("Approved");
    });

    it("HÀNG THẬT · leave_request — POST requests/:id/reject → 200", async () => {
      const id = await pendingRequest("2027-05-06");
      const res = await send("post", `/leave/requests/${id}/reject`, "adm", {
        reason: "trùng lịch team",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("Rejected");
    });

    it("HÀNG THẬT · leave_request — POST requests/:id/cancel → 200", async () => {
      const id = await draftRequest("2027-05-07");
      const res = await send("post", `/leave/requests/${id}/cancel`, "emp", {
        cancelReason: "đổi kế hoạch",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.status).toBe("Cancelled");
    });

    it("HÀNG THẬT · leave_request — POST requests/:id/revoke trên đơn ĐÃ duyệt → 200", async () => {
      const id = await pendingRequest("2027-05-10");
      const approved = await send("post", `/leave/requests/${id}/approve`, "adm", {});
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);

      const res = await send("post", `/leave/requests/${id}/revoke`, "adm", {
        revokeReason: "nhân sự đổi lịch",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ── LOẠI KHOÁ `leave_balance` ───────────────────────────────────────────────────────────────
    it("HÀNG THẬT · leave_balance — GET balances/:id/transactions + admin/balances/:id/transactions → 200", async () => {
      const canonical = await send("get", `/leave/balances/${balanceId}/transactions`, "adm");
      expect(canonical.status, JSON.stringify(canonical.body)).toBe(200);

      const admin = await send("get", `/leave/admin/balances/${balanceId}/transactions`, "adm");
      expect(admin.status, JSON.stringify(admin.body)).toBe(200);
    });

    it("HÀNG THẬT · leave_balance — POST admin/balances/:id/adjust → 200", async () => {
      const res = await send("post", `/leave/admin/balances/${balanceId}/adjust`, "adm", {
        amountDays: 1,
        reason: "cấp bù ngày phép",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    // ── LOẠI KHOÁ `leave_policy` ────────────────────────────────────────────────────────────────
    it("HÀNG THẬT · leave_policy — PATCH admin/policies/:id + POST admin/policies/:id/delete → 200", async () => {
      const policyId = await plantPolicy(typeId);
      const patched = await send("patch", `/leave/admin/policies/${policyId}`, "adm", {
        name: "Chính sách phép (đã sửa)",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);

      const spareId = await plantPolicy(typeId);
      const removed = await send("post", `/leave/admin/policies/${spareId}/delete`, "adm");
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    });

    // ══ (4) LITERAL-SIBLING — route TĨNH cùng tiền tố KHÔNG bị ParseUUIDPipe nuốt ═══════════════
    /**
     * `ParseUUIDPipe` gắn trên `:id` chỉ chạy khi Express đã CHỌN route param. Nếu thứ tự khai báo sai
     * (param trước literal) thì `GET /leave/types` sẽ rơi vào `PATCH types/:id`… — không thể xảy ra với
     * verb khác nhau, nhưng `me/requests` vs `me/requests/:id` và `requests/calculate` vs `requests/:id`
     * thì CÓ THỂ. Tám ca dưới đây ghim điều đó bằng HTTP, không bằng lập luận.
     */
    const SIBLINGS: ReadonlyArray<{
      label: string;
      method: Method;
      url: string;
      who: "emp" | "adm";
      body?: Record<string, unknown>;
    }> = [
      { label: "GET /leave/types", method: "get", url: "/leave/types", who: "emp" },
      { label: "GET /leave/me/requests", method: "get", url: "/leave/me/requests", who: "emp" },
      { label: "GET /leave/balances", method: "get", url: "/leave/balances?scope=me", who: "adm" },
      { label: "GET /leave/requests", method: "get", url: "/leave/requests", who: "adm" },
      { label: "GET /leave/admin/types", method: "get", url: "/leave/admin/types", who: "adm" },
      {
        label: "GET /leave/admin/policies",
        method: "get",
        url: "/leave/admin/policies",
        who: "adm",
      },
      {
        label: "GET /leave/admin/balances",
        method: "get",
        url: "/leave/admin/balances",
        who: "adm",
      },
    ];

    for (const s of SIBLINGS) {
      it(`LITERAL-SIBLING · ${s.label} → 200 (không bị route :id nuốt)`, async () => {
        const res = await send(s.method, s.url, s.who, s.body);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
    }

    it("LITERAL-SIBLING · POST /leave/requests/calculate → 200 (không rơi vào PATCH requests/:id)", async () => {
      const res = await send("post", "/leave/requests/calculate", "emp", {
        leaveTypeId: typeId,
        startDate: "2027-05-12",
        endDate: "2027-05-12",
        durationType: "FullDay",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });
  },
);
