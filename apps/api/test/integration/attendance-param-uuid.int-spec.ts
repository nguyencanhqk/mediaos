/**
 * S10-FND-PARAMUUID-2 · lane L2-ATT-PARAM (KI-078) — biên HTTP THẬT cho kênh **PARAM** của ATTENDANCE.
 *
 * 14 tham số `:id` / 4 controller (SPEC-04). Nhóm đợt-1 vì: workflow phê duyệt (FSM điều chỉnh công +
 * làm việc từ xa) · module nhạy cảm SPEC-04 · route GHI.
 *
 *   GET   /attendance/adjustment-requests/:id             [AttendanceAdjustmentController#getDetail]
 *   POST  /attendance/adjustment-requests/:id/approve     [                       …#approve]
 *   POST  /attendance/adjustment-requests/:id/reject      [                       …#reject]
 *   POST  /attendance/records/:id/adjust-direct           [                       …#adjustDirect]
 *   POST  /attendance/remote-work-requests/:id/submit     [RemoteWorkRequestController#submit]
 *   GET   /attendance/remote-work-requests/:id            [                       …#getDetail]
 *   POST  /attendance/remote-work-requests/:id/approve    [                       …#approve]
 *   POST  /attendance/remote-work-requests/:id/reject     [                       …#reject]
 *   POST  /attendance/remote-work-requests/:id/cancel     [                       …#cancelOwn]
 *   GET   /attendance/records/:id/logs                    [AttendanceController#getRecordLogs]
 *   GET   /attendance/records/:id                         [                  …#getRecordDetail]
 *   PATCH /attendance/schedules/:id                       [                  …#updateSchedule]
 *   PATCH /attendance/shifts/:id                          [AttendanceShiftController#updateShift]
 *   PATCH /attendance/rules/:id                           [                       …#updateRule]
 *
 * ─── MỨC ĐỘ (phát biểu TRƯỚC mọi số đo — đừng để reviewer tự suy) ───────────────────────────────
 * Hỏng ĐÚNG CHIỀU AN TOÀN: request vẫn bị TỪ CHỐI, không hàng nào rò, không quyền nào bị vượt.
 * ⇒ **KHÔNG phải lỗ bảo mật.** Giá trị của bản vá là (a) hợp đồng API — client nhận 400 có mã thay vì
 * 500 vô nghĩa; (b) chấm dứt việc payload rác bơm **500 GIẢ** vào giám sát, làm loãng tín hiệu 500
 * THẬT. Y hệt KI-068 (kênh BODY) và KI-077 (kênh PARAM của foundation/files).
 *
 * ─── SỐ ĐO TRƯỚC BẢN VÁ (RED, lane DB `mediaos_paramuuid2b`) ────────────────────────────────────
 * Xem ô "ĐO 26/08/2026" ở TỪNG ca. Ghi SỐ THẬT (status + `error.type`), kể cả khi nó KHÁC mô tả
 * KI-078 — `done_when` nói rõ: route nào hoá ra không trả 500 thì ghi lại sự thật đó.
 *
 * ─── ĐÃ KIỂM: SHADOWING XUYÊN FILE (ghi lại để lần sau khỏi phải đọc lại) ───────────────────────
 * NĂM controller cùng base `@Controller("attendance")`: AttendanceController · AttendanceAdjustment ·
 * AttendanceShift · AttendanceReport · AttendanceAudit. Express giải route theo THỨ TỰ ĐĂNG KÝ trong
 * `attendance.module.ts` (khối `controllers:` — Attendance → Adjustment → Shift → Internal →
 * RemoteWorkRequest → Report → Audit), **KHÔNG** theo thứ tự khai trong MỘT file. Đã đọc cả hai
 * controller còn lại: `AttendanceReportController` chỉ khai `reports/team` + `reports`;
 * `AttendanceAuditController` chỉ khai `audit-logs` ⇒ KHÔNG va chạm với BẤT KỲ `:id` nào ở đây.
 * `RemoteWorkRequestController` có base RIÊNG (`attendance/remote-work-requests`) nên cũng tách bạch.
 *
 * ⚠️ Guard chạy TRƯỚC pipe ⇒ probe không kèm token chỉ ra 401 và không đo được gì. Mọi ca dưới đây
 * dùng actor ĐÃ đăng nhập với ĐÚNG cặp quyền lấy từ catalog THẬT (`attendance-permissions.const`).
 *
 * ⚠️ ACTOR KHÔNG PHẢI super-admin ([[superadmin-not-a-canonical-role]]). KHÔNG seed `*:*`:
 * `permissions` là catalog TOÀN CỤC và `cleanupTenants` không dọn nó
 * ([[test-fixture-stamps-global-permission-catalog]]). `is_sensitive` lấy ĐÚNG catalog, không đoán —
 * `seedPermissionCatalog()` sẽ NÉM nếu khai sai cờ.
 *
 * ⚠️ BODY PHẢI HỢP LỆ ở mọi ca DENY — 400 do body-pipe là số đo GIẢ (nó xanh cả khi `:id` vẫn hỏng).
 *
 * ⚠️ KHÔNG gửi header `Idempotency-Key`: `common/idempotency/idempotency.interceptor.ts` chạy TRƯỚC
 * pipe; header rỗng thì `return next.handle()` nên BỎ header là an toàn, còn GỬI thì phát lại/409 làm
 * hỏng số đo.
 *
 * ⚠️ NGƯỠNG CHỐNG NỚI: assert DENY ở lại `400` ĐƠN TRỊ + neo hiện vật `error.type`.
 * `expect([400, 500]).toContain(...)` là mở lại lỗ trong khi sổ ghi ĐÓNG ([[tests-can-pin-a-hole-open]]).
 *
 * GATE CỨNG `hasDb && LANE_DB` (CLAUDE.md §9.5).
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
const LOGIN_PW = loginPasswordFixture("s10attpu2");

const uniq = () => randomUUID().slice(0, 8);

function dayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Giá trị KHÔNG phải UUID dùng chung mọi ca — một hình dạng, để so sánh giữa các route có nghĩa. */
const JUNK = "khong-phai-uuid";

/**
 * `[action, resource, is_sensitive]` — cờ lấy ĐÚNG `attendance-permissions.const` (nguồn sự thật của
 * mig 0454) cho cặp ATT, và từ catalog lane DB cho hai cặp legacy `read`/`manage:attendance`.
 */
const ATT_PAIRS: ReadonlyArray<readonly [string, string, boolean]> = [
  // legacy (schedules/periods/list tháng) — mig 0005, non-sensitive
  ["read", "attendance", false],
  ["manage", "attendance", false],
  // attendance
  ["view-own", "attendance", true],
  ["view-team", "attendance", true],
  ["view-company", "attendance", true],
  ["view-detail", "attendance", true],
  ["adjust-direct", "attendance", true],
  ["export", "attendance", true],
  // adjustment
  ["create-own", "adjustment", false],
  ["view-own", "adjustment", true],
  ["view-team", "adjustment", true],
  ["view-company", "adjustment", true],
  ["approve", "adjustment", true],
  ["reject", "adjustment", true],
  // remote-request
  ["create-own", "remote-request", false],
  ["view-own", "remote-request", true],
  ["view-team", "remote-request", true],
  ["view-company", "remote-request", true],
  ["approve", "remote-request", true],
  ["reject", "remote-request", true],
  ["cancel-own", "remote-request", false],
  // shift / shift-assignment / attendance-rule
  ["view", "shift", false],
  ["create", "shift", true],
  ["update", "shift", true],
  ["view", "shift-assignment", true],
  ["update", "shift-assignment", true],
  ["view", "attendance-rule", true],
  ["config", "attendance-rule", true],
];

type Method = "get" | "post" | "patch";

/** Một tham số `:id` được đo. `path(id)` dựng URL; `body` LUÔN hợp lệ (400 phải đến từ PARAM). */
interface ParamCase {
  readonly label: string;
  readonly method: Method;
  readonly path: (id: string) => string;
  readonly body?: Record<string, unknown>;
  /** Số đo TRƯỚC vá (RED) — điền bằng lần chạy thật, không suy luận. */
  readonly measuredBefore: string;
}

describe.skipIf(!hasLaneDb)(
  "S10-FND-PARAMUUID-2 / L2-ATT-PARAM — biên HTTP kênh PARAM của ATTENDANCE (14 tham số)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    const companyIds: string[] = [];

    let token = "";
    let userId = "";
    let employeeId = "";

    // Hàng THẬT cho ca ALLOW-200 theo LOẠI KHOÁ (6 loại của lane này).
    let adjustmentRequestId = ""; // attendance_adjustment_request
    let attendanceRecordId = ""; // attendance_record
    let workScheduleId = ""; // work_schedule
    let shiftId = ""; // shift
    let attendanceRuleId = ""; // attendance_rule
    let remoteWorkRequestId = ""; // remote_work_request

    const http = () => request(app.getHttpServer());
    const auth = (method: Method, url: string) =>
      http()[method](url).set("Authorization", `Bearer ${token}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // Mirror main.ts: Zod validate ở BIÊN → envelope → filter. Thiếu một lớp thì mọi kết luận về
      // "400 hay 500" đều vô nghĩa vì nó đo một stack KHÁC với PROD.
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();

      direct = directPool();
      A = await seedCompany(direct, "s10attpu2a");
      companyIds.push(A.companyId);

      const email = `att-${uniq()}@s10attpu2.local`;
      userId = await seedUser(
        direct,
        A.companyId,
        email,
        await new PasswordService().hash(LOGIN_PW),
      );
      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [A.companyId, `s10attpu2-ou-${uniq()}`],
      );
      const emp = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [A.companyId, userId, ou.rows[0].id],
      );
      employeeId = emp.rows[0].id;

      const roleId = await seedRole(direct, A.companyId, `s10attpu2-${uniq()}`);
      for (const [action, resource, sensitive] of ATT_PAIRS) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, A.companyId);
      token = await login(A.slug, email);

      // ── HÀNG THẬT, 6 loại khoá ──────────────────────────────────────────────
      // Đơn điều chỉnh: `requested_by = actor` ⇒ detailInScope() trả true ngay (không phụ thuộc scope).
      const adj = await direct.query<{ id: string }>(
        `INSERT INTO attendance_adjustment_requests
           (company_id, user_id, employee_id, work_date, request_type, reason, status,
            requested_by, requested_check_in_at)
         VALUES ($1, $2, $3, $4, 'MISSING_CHECK_IN', 'Quên chấm công vào', 'Pending', $2,
                 $5::timestamptz)
         RETURNING id`,
        [A.companyId, userId, employeeId, dayShift(-3), `${dayShift(-3)}T02:00:00Z`],
      );
      adjustmentRequestId = adj.rows[0].id;

      const rec = await direct.query<{ id: string }>(
        `INSERT INTO attendance_records (company_id, user_id, employee_id, work_date, status)
         VALUES ($1, $2, $3, $4, 'present') RETURNING id`,
        [A.companyId, userId, employeeId, dayShift(-2)],
      );
      attendanceRecordId = rec.rows[0].id;

      // Đơn làm việc từ xa: `requested_by = actor` ⇒ cùng lối vào scope như trên.
      const rwr = await direct.query<{ id: string }>(
        `INSERT INTO remote_work_requests
           (company_id, employee_id, request_type, start_date, end_date, reason, requested_by, status)
         VALUES ($1, $2, 'Remote', $3, $3, 'Làm từ xa', $4, 'Draft') RETURNING id`,
        [A.companyId, employeeId, dayShift(3), userId],
      );
      remoteWorkRequestId = rwr.rows[0].id;

      // Ba cấu hình còn lại đi qua chính HTTP (đường ghi thật) để hàng chắc chắn hợp lệ với DTO đọc lại.
      const sched = await auth("post", "/attendance/schedules").send({
        name: `Ca hành chính ${uniq()}`,
        workType: "fixed",
        startTime: "08:30",
        endTime: "17:30",
        graceMinutes: 10,
      });
      expect(sched.status, JSON.stringify(sched.body)).toBe(201);
      workScheduleId = sched.body.data.id as string;

      const shift = await auth("post", "/attendance/shifts").send({
        shiftCode: `CA-${uniq()}`,
        name: "Ca sáng",
        shiftType: "Fixed",
        startTime: "08:00:00",
        endTime: "17:00:00",
        requiredWorkingMinutes: 480,
      });
      expect(shift.status, JSON.stringify(shift.body)).toBe(201);
      shiftId = shift.body.data.id as string;

      const rule = await auth("post", "/attendance/rules").send({
        ruleCode: `QT-${uniq()}`,
        name: "Quy tắc công ty",
        ruleScope: "Company",
        effectiveFrom: dayShift(-30),
      });
      expect(rule.status, JSON.stringify(rule.body)).toBe(201);
      attendanceRuleId = rule.body.data.id as string;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    /**
     * Oracle DENY: tham số rác phải bị chặn ở BIÊN bằng 400, và KHÔNG mang hiện vật của đường 500 cũ.
     *
     * ⚠️ `error.type` là hiện vật phân biệt: `'Error'` (lỗi PG `22P02` lọt tới DB) hoặc `'ZodError'`
     * (schema ném thô) đều là dấu của đường 500. Neo theo hiện vật chứ không chỉ theo status: một ngày
     * nào đó ai đó map 22P02 thành 400 ở filter thì status xanh mà lỗ vẫn còn nguyên vị trí — request
     * rác vẫn đi hết đường tới DB.
     */
    function expectRejectedAtBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).toBe(400);
      expect(res.body.error?.type, body).not.toBe("ZodError");
      expect(res.body.error?.type, body).not.toBe("Error");
    }

    /**
     * Oracle ALLOW: UUID HỢP LỆ (nhưng không tồn tại) phải ĐI QUA được biên và tới service ⇒ 403/404 là
     * ĐÚNG, 400 thì KHÔNG — và 500 cũng KHÔNG (chỉ đòi `≠400` là xanh RỖNG: route vẫn 500/429 mà lưới
     * vẫn xanh). Không có vế này thì mọi ca deny ở trên xanh rỗng: một bản vá chặn MỌI giá trị `:id`
     * cũng làm chúng xanh ([[deny-cases-vacuous-without-allow-case]]).
     */
    function expectPassedBoundary(res: request.Response): void {
      const body = JSON.stringify(res.body);
      expect(res.status, body).not.toBe(400);
      expect(res.status, body).not.toBe(500);
    }

    // ── Bảng 14 tham số ───────────────────────────────────────────────────────
    const CASES: ReadonlyArray<ParamCase> = [
      {
        label: "GET adjustment-requests/:id",
        method: "get",
        path: (id) => `/attendance/adjustment-requests/${id}`,
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='Error'",
      },
      {
        label: "POST adjustment-requests/:id/approve",
        method: "post",
        path: (id) => `/attendance/adjustment-requests/${id}/approve`,
        body: { note: "Duyệt" },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "POST adjustment-requests/:id/reject",
        method: "post",
        path: (id) => `/attendance/adjustment-requests/${id}/reject`,
        body: { reason: "Không đủ căn cứ" },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "POST records/:id/adjust-direct",
        method: "post",
        path: (id) => `/attendance/records/${id}/adjust-direct`,
        // recordId trong BODY chỉ để thoả `.refine()` của directAdjustSchema (service dùng `:id` của
        // ĐƯỜNG DẪN, không dùng body) — mục đích duy nhất là làm body HỢP LỆ.
        body: {
          recordId: "00000000-0000-4000-8000-000000000001",
          items: [{ fieldName: "note", newValue: "sửa ghi chú" }],
          reason: "Sửa trực tiếp",
        },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "POST remote-work-requests/:id/submit",
        method: "post",
        path: (id) => `/attendance/remote-work-requests/${id}/submit`,
        body: { currentApproverUserId: "00000000-0000-4000-8000-000000000002" },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "GET remote-work-requests/:id",
        method: "get",
        path: (id) => `/attendance/remote-work-requests/${id}`,
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='Error'",
      },
      {
        label: "POST remote-work-requests/:id/approve",
        method: "post",
        path: (id) => `/attendance/remote-work-requests/${id}/approve`,
        body: { note: "Duyệt" },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "POST remote-work-requests/:id/reject",
        method: "post",
        path: (id) => `/attendance/remote-work-requests/${id}/reject`,
        body: { rejectReason: "Không duyệt" },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "POST remote-work-requests/:id/cancel",
        method: "post",
        path: (id) => `/attendance/remote-work-requests/${id}/cancel`,
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "GET records/:id/logs",
        method: "get",
        path: (id) => `/attendance/records/${id}/logs`,
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='Error'",
      },
      {
        label: "GET records/:id",
        method: "get",
        path: (id) => `/attendance/records/${id}`,
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='Error'",
      },
      {
        label: "PATCH schedules/:id",
        method: "patch",
        path: (id) => `/attendance/schedules/${id}`,
        body: { graceMinutes: 25 },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "PATCH shifts/:id",
        method: "patch",
        path: (id) => `/attendance/shifts/${id}`,
        body: { name: "Ca sáng (đã sửa)" },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
      {
        label: "PATCH rules/:id",
        method: "patch",
        path: (id) => `/attendance/rules/${id}`,
        body: { name: "Quy tắc công ty (đã sửa)" },
        measuredBefore: "ĐO 26/08/2026 (RED, mediaos_paramuuid2b): 500 SYSTEM-ERR-001 · error.type='InternalServerErrorException'",
      },
    ];

    for (const c of CASES) {
      it(`PARAM · ${c.label} với :id rác → 400 ĐƠN TRỊ ở BIÊN — ${c.measuredBefore}`, async () => {
        const req = auth(c.method, c.path(JUNK));
        const res = c.body ? await req.send(c.body) : await req;
        expectRejectedAtBoundary(res);
      });

      it(`ALLOW · ${c.label} với UUID hợp lệ (không tồn tại) ĐI QUA được biên (≠400 VÀ ≠500)`, async () => {
        const req = auth(c.method, c.path(randomUUID()));
        const res = c.body ? await req.send(c.body) : await req;
        expectPassedBoundary(res);
      });
    }

    // ── ALLOW-200 trên HÀNG THẬT — MỘT ca cho MỖI LOẠI KHOÁ (6 loại) ──────────
    //
    // Đây là vế DUY NHẤT bắt được ca `:id` hoá ra là MÃ NGHIỆP VỤ/slug bị `ParseUUIDPipe` chặn OAN.
    // Đặc biệt `attendance_rules`: PK là `uuid` NHƯNG bảng CÓ `rule_code` — ca dưới trả lời bằng HÀNG
    // THẬT (không bằng suy luận) rằng `PATCH rules/:id` nhận UUID ⇒ VÁ được, verdict `piped`.

    it("ALLOW-200 · loại khoá `attendance_adjustment_request` — GET adjustment-requests/:id hàng thật", async () => {
      const res = await auth("get", `/attendance/adjustment-requests/${adjustmentRequestId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(adjustmentRequestId);
    });

    it("ALLOW-200 · loại khoá `attendance_record` — GET records/:id hàng thật", async () => {
      const res = await auth("get", `/attendance/records/${attendanceRecordId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(attendanceRecordId);
    });

    it("ALLOW-200 · loại khoá `work_schedule` — PATCH schedules/:id hàng thật", async () => {
      const res = await auth("patch", `/attendance/schedules/${workScheduleId}`).send({
        graceMinutes: 25,
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ALLOW-200 · loại khoá `shift` — PATCH shifts/:id hàng thật", async () => {
      const res = await auth("patch", `/attendance/shifts/${shiftId}`).send({
        name: "Ca sáng (đã sửa)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ALLOW-200 · loại khoá `attendance_rule` — PATCH rules/:id hàng thật NHẬN UUID (không phải rule_code)", async () => {
      const res = await auth("patch", `/attendance/rules/${attendanceRuleId}`).send({
        name: "Quy tắc công ty (đã sửa)",
      });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    });

    it("ALLOW-200 · loại khoá `remote_work_request` — GET remote-work-requests/:id hàng thật", async () => {
      const res = await auth("get", `/attendance/remote-work-requests/${remoteWorkRequestId}`);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.id).toBe(remoteWorkRequestId);
    });

    // ── CHỐNG HỒI QUY ĐỊNH TUYẾN — literal-sibling vẫn 200 SAU khi gắn pipe ───
    //
    // Danh sách LIỆT KÊ BẰNG ĐỌC FILE (không grep mù), gồm ba route `done_when` kê đích danh:
    // `adjustment-requests/my` · `adjustment-requests/team` · `records/export`.
    const LITERAL_SIBLINGS: ReadonlyArray<readonly [string, string]> = [
      ["adjustment-requests/my", "/attendance/adjustment-requests/my"],
      ["adjustment-requests/team", "/attendance/adjustment-requests/team"],
      ["adjustment-requests (@Get)", "/attendance/adjustment-requests"],
      ["records", "/attendance/records"],
      ["my-records", "/attendance/my-records"],
      ["team-records", "/attendance/team-records"],
      ["schedules", "/attendance/schedules"],
      ["rules/effective", ""], // dựng động (cần employeeId) — xem ca riêng bên dưới
      ["rules", "/attendance/rules"],
      ["shifts", "/attendance/shifts"],
      ["shift-assignments", "/attendance/shift-assignments"],
      ["remote-work-requests/my", "/attendance/remote-work-requests/my"],
      ["remote-work-requests/team", "/attendance/remote-work-requests/team"],
      ["remote-work-requests (@Get)", "/attendance/remote-work-requests"],
    ];

    for (const [label, url] of LITERAL_SIBLINGS) {
      if (url === "") continue;
      it(`ĐỊNH TUYẾN · GET ${label} vẫn 200 (pipe trên :id KHÔNG được nuốt route tĩnh)`, async () => {
        const res = await auth("get", url);
        expect(res.status, JSON.stringify(res.body)).toBe(200);
      });
    }

    it("ĐỊNH TUYẾN · GET rules/effective vẫn 200 (route tĩnh cùng cấp với rules/:id)", async () => {
      const res = await auth(
        "get",
        `/attendance/rules/effective?employeeId=${employeeId}&workDate=${dayShift(0)}`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.employeeId).toBe(employeeId);
    });

    /**
     * `records/export` dùng `@Res()` LIBRARY-MODE ⇒ đường THÀNH CÔNG **BỎ QUA**
     * `ResponseEnvelopeInterceptor` (trả CSV bytes, không phải envelope JSON). Vì vậy ca này CHỈ assert
     * status — assert `body.data` ở đây sẽ đỏ vì lý do KHÁC với cái đang đo.
     */
    it("ĐỊNH TUYẾN · GET records/export vẫn 200 (@Res library-mode ⇒ CHỈ assert status)", async () => {
      const res = await auth("get", "/attendance/records/export");
      expect(res.status).toBe(200);
    });
  },
);
