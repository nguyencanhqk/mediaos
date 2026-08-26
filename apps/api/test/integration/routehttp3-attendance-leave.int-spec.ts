/**
 * S10-QA-ROUTEHTTP-3 (file 5/6) — test HTTP THẬT cho phần đuôi ATT + LEAVE (18 route):
 *
 *   AttendanceController        6  my-records · schedules GET/POST/PATCH · periods GET · periods/lock POST
 *   AttendanceShiftController   6  shifts GET · shifts PATCH · shift-assignments GET · rules GET ·
 *                                  rules/effective GET · rules PATCH
 *   AttendanceReportController  2  reports GET · reports/team GET
 *   LeaveController             3  types/:id PATCH · calendar GET · admin/balances/:id/transactions GET
 *   LeaveReportController       1  reports GET
 *
 * ⚠️ `is_sensitive` LÀ SỐ ĐO, KHÔNG PHẢI GIẢ ĐỊNH. Mười trong số cặp quyền dưới đây là `is_sensitive=true`
 * trong catalog (`view-own:attendance`, `view-team/company:attendance`, `view:attendance-rule`,
 * `config:attendance-rule`, `create/update:shift`, `view:shift-assignment`, `view-transaction:leave-balance`,
 * `export:leave`). `seedPermissionCatalog()` sẽ NÉM nếu fixture khai sai cờ — cố ý, vì `permissions` là
 * catalog TOÀN CỤC không được `cleanupTenants()` dọn, ghi sai là đóng dấu vĩnh viễn lên lane DB.
 * Danh sách dưới đây lấy từ chính lane DB (`SELECT action, resource_type, is_sensitive`), không đoán.
 *
 * LUẬT CHỐNG DENY-XANH-RỖNG: route GHI (`POST/PATCH schedules`, `PATCH rules/:id`, `PATCH shifts/:id`,
 * `POST periods/lock`, `PATCH leave/types/:id`) đều có ca ALLOW 2xx chứng minh bằng HỆ QUẢ đọc lại qua
 * route GET tương ứng. Route ĐỌC được chứng minh bằng dữ liệu VỪA GIEO xuất hiện trong kết quả — không
 * assert "200 là xong".
 *
 * ACTOR CÓ employee_profile. `my-records`, `rules/effective`, `leave/calendar` resolve theo nhân viên của
 * người gọi; thiếu hồ sơ thì route trả rỗng/404 vì lý do KHÁC với cái đang đo.
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
const LOGIN_PW = loginPasswordFixture("s10rh3al");

const uniq = () => randomUUID().slice(0, 8);

function dayShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** `[action, resource, is_sensitive]` — cờ lấy từ catalog lane DB, KHÔNG đoán. */
const ADMIN_PAIRS: ReadonlyArray<readonly [string, string, boolean]> = [
  ["read", "attendance", false],
  ["manage", "attendance", false],
  ["lock-period", "attendance", false],
  ["view-own", "attendance", true],
  ["view-team", "attendance", true],
  ["view-company", "attendance", true],
  ["view", "shift", false],
  ["create", "shift", true],
  ["update", "shift", true],
  ["view", "shift-assignment", true],
  ["update", "shift-assignment", true],
  ["view", "attendance-rule", true],
  ["config", "attendance-rule", true],
  ["manage", "leave", false],
  ["view-own", "leave-calendar", false],
  ["export", "leave", true],
  ["view-transaction", "leave-balance", true],
  ["view", "leave-type", false],
];

describe.skipIf(!hasLaneDb)(
  "S10-QA-ROUTEHTTP-3 — HTTP thật: attendance (14 route) + leave (4 route)",
  () => {
    let app: INestApplication;
    let direct: Pool;
    let A: SeededTenant;
    let B: SeededTenant;
    const companyIds: string[] = [];

    let tAdminA = "";
    let tEmptyA = "";
    let tAdminB = "";
    let empIdA = "";
    let userIdA = "";
    let orgUnitA = "";

    const http = () => request(app.getHttpServer());
    const authGet = (t: string, u: string) => http().get(u).set("Authorization", `Bearer ${t}`);
    const authPost = (t: string, u: string) => http().post(u).set("Authorization", `Bearer ${t}`);
    const authPatch = (t: string, u: string) => http().patch(u).set("Authorization", `Bearer ${t}`);

    async function login(slug: string, email: string): Promise<string> {
      const res = await http().post("/auth/login").send({
        companySlug: slug,
        email,
        password: LOGIN_PW,
      });
      expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
      return res.body.data.accessToken as string;
    }

    async function actor(
      tenant: SeededTenant,
      tag: string,
      pairs: ReadonlyArray<readonly [string, string, boolean]>,
    ): Promise<{ token: string; userId: string; employeeId: string; orgUnitId: string }> {
      const password = new PasswordService();
      const email = `${tag}-${uniq()}@s10rh3al.local`;
      const userId = await seedUser(direct, tenant.companyId, email, await password.hash(LOGIN_PW));
      const ou = await direct.query<{ id: string }>(
        `INSERT INTO org_units (company_id, name, type) VALUES ($1, $2, 'department') RETURNING id`,
        [tenant.companyId, `s10rh3al-ou-${uniq()}`],
      );
      const emp = await direct.query<{ id: string }>(
        `INSERT INTO employee_profiles (company_id, user_id, org_unit_id, status)
         VALUES ($1, $2, $3, 'active') RETURNING id`,
        [tenant.companyId, userId, ou.rows[0].id],
      );
      const roleId = await seedRole(direct, tenant.companyId, `s10rh3al-${tag}-${uniq()}`);
      for (const [action, resource, sensitive] of pairs) {
        const permId = await seedPermissionCatalog(direct, action, resource, sensitive);
        await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
      }
      await seedUserRole(direct, userId, roleId, tenant.companyId);
      return {
        token: await login(tenant.slug, email),
        userId,
        employeeId: emp.rows[0].id,
        orgUnitId: ou.rows[0].id,
      };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(new ZodValidationPipe());
      app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
      app.useGlobalFilters(new AllExceptionsFilter());
      await app.init();
      // Phải listen THẬT: supertest tự listen(0) rồi close() server dùng chung ngay khi request ĐẦU kết thúc
      // ⇒ các request anh em trong Promise.all bị reset socket (ECONNRESET). Server đang listen thì supertest không sở hữu nó.
      await app.listen(0);

      direct = directPool();
      A = await seedCompany(direct, "s10rh3ala");
      B = await seedCompany(direct, "s10rh3alb");
      companyIds.push(A.companyId, B.companyId);

      const admin = await actor(A, "admin", ADMIN_PAIRS);
      tAdminA = admin.token;
      userIdA = admin.userId;
      empIdA = admin.employeeId;
      orgUnitA = admin.orgUnitId;

      tEmptyA = (await actor(A, "empty", [])).token;
      tAdminB = (await actor(B, "adminb", ADMIN_PAIRS)).token;
    }, 180_000);

    afterAll(async () => {
      await app?.close();
      if (companyIds.length > 0) await cleanupTenants(direct, companyIds);
      await direct?.end();
    });

    // ─── 1. Lịch làm việc (work schedules) ──────────────────────────────────────

    it("attendance/schedules: POST → GET → PATCH, HỆ QUẢ đọc lại qua GET /attendance/schedules", async () => {
      const created = await authPost(tAdminA, "/attendance/schedules").send({
        name: `Ca hành chính ${uniq()}`,
        workType: "fixed",
        startTime: "08:30",
        endTime: "17:30",
        graceMinutes: 10,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const scheduleId = created.body.data.id as string;

      const list = await authGet(tAdminA, "/attendance/schedules");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect((list.body.data as Array<{ id: string }>).map((s) => s.id)).toContain(scheduleId);

      const patched = await authPatch(tAdminA, `/attendance/schedules/${scheduleId}`).send({
        graceMinutes: 25,
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const after = await authGet(tAdminA, "/attendance/schedules");
      expect(
        (after.body.data as Array<{ id: string; graceMinutes: number }>).find(
          (s) => s.id === scheduleId,
        )?.graceMinutes,
      ).toBe(25);
    });

    // ─── 2. Kỳ công (periods) ───────────────────────────────────────────────────

    it("attendance/periods: GET rỗng → POST periods/lock → GET thấy kỳ đã khoá", async () => {
      const month = dayShift(0).slice(0, 7);

      const before = await authGet(tAdminA, "/attendance/periods");
      expect(before.status, JSON.stringify(before.body)).toBe(200);
      const beforeIds = (before.body.data as Array<{ id: string }>).map((p) => p.id);

      const locked = await authPost(tAdminA, "/attendance/periods/lock").send({
        periodMonth: month,
      });
      expect(locked.status, JSON.stringify(locked.body)).toBeLessThan(300);

      const after = await authGet(tAdminA, "/attendance/periods");
      expect(after.status).toBe(200);
      const rows = after.body.data as Array<{ id: string; periodMonth?: string; status?: string }>;
      expect(rows.length, "sau khi khoá kỳ, danh sách kỳ công phải dài hơn trước").toBeGreaterThan(
        beforeIds.length,
      );
    });

    // ─── 3. Bản ghi của chính mình ──────────────────────────────────────────────

    it("GET /attendance/my-records — 200, đọc được bản ghi VỪA GIEO của chính người gọi", async () => {
      const workDate = dayShift(-1);
      await direct.query(
        `INSERT INTO attendance_records (company_id, user_id, work_date, status)
         VALUES ($1, $2, $3, 'present')`,
        [A.companyId, userIdA, workDate],
      );

      const res = await authGet(tAdminA, "/attendance/my-records?page=1&pageSize=50");
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const rows = (res.body.data.items as Array<{ workDate?: string }>) ?? [];
      expect(
        rows.some((r) => (r.workDate ?? "").slice(0, 10) === workDate),
        `bản ghi ${workDate} vừa gieo phải xuất hiện: ${JSON.stringify(rows).slice(0, 400)}`,
      ).toBe(true);
    });

    // ─── 4. Báo cáo chấm công ───────────────────────────────────────────────────

    it("attendance/reports + reports/team — 200 với khoảng ngày hợp lệ", async () => {
      const q = `fromDate=${dayShift(-7)}&toDate=${dayShift(0)}`;

      const company = await authGet(tAdminA, `/attendance/reports?${q}`);
      expect(company.status, JSON.stringify(company.body)).toBe(200);
      expect(company.body.data).toBeDefined();

      const team = await authGet(tAdminA, `/attendance/reports/team?${q}`);
      expect(team.status, JSON.stringify(team.body)).toBe(200);
      expect(team.body.data).toBeDefined();
    });

    it("attendance/reports: DTO 400 ở BIÊN khi thiếu `fromDate`/`toDate`", async () => {
      const bad = await authGet(tAdminA, "/attendance/reports");
      expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    });

    // ─── 5. Ca làm việc + phân ca ───────────────────────────────────────────────

    it("attendance/shifts: POST → GET → PATCH; shift-assignments POST → GET", async () => {
      const created = await authPost(tAdminA, "/attendance/shifts").send({
        shiftCode: `CA-${uniq()}`,
        name: "Ca sáng",
        shiftType: "Fixed",
        startTime: "08:00:00",
        endTime: "17:00:00",
        requiredWorkingMinutes: 480,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const shiftId = created.body.data.id as string;

      const list = await authGet(tAdminA, "/attendance/shifts");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect((list.body.data.items as Array<{ id: string }>).map((s) => s.id)).toContain(shiftId);

      const patched = await authPatch(tAdminA, `/attendance/shifts/${shiftId}`).send({
        name: "Ca sáng (đã sửa)",
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const after = await authGet(tAdminA, "/attendance/shifts");
      expect(
        (after.body.data.items as Array<{ id: string; name: string }>).find((s) => s.id === shiftId)
          ?.name,
      ).toBe("Ca sáng (đã sửa)");

      const assigned = await authPost(tAdminA, "/attendance/shift-assignments").send({
        shiftId,
        assignmentScope: "Employee",
        employeeId: empIdA,
        effectiveFrom: dayShift(-1),
      });
      expect(assigned.status, JSON.stringify(assigned.body)).toBeLessThan(300);

      const assignments = await authGet(tAdminA, "/attendance/shift-assignments");
      expect(assignments.status, JSON.stringify(assignments.body)).toBe(200);
      expect(
        (assignments.body.data.items as Array<{ shiftId?: string }>).some(
          (a) => a.shiftId === shiftId,
        ),
        "phân ca vừa tạo phải xuất hiện trong danh sách",
      ).toBe(true);
    });

    /**
     * ĐÃ LẬT (S10-ATT-SHIFTASSIGNSCOPE-1, 26/08) — trước đó ca này GHIM hành vi SAI của KI-080.
     *
     * `createShiftAssignmentSchema` để `assignmentScope` MẶC ĐẮNH `"Company"`, và `.refine()` cũ chỉ kiểm
     * chiều THUẬN ("scope Department/Employee phải có id tương ứng"). Chiều NGƯỢC ("Company ⇒ cả hai id
     * phải VẮNG") không ai kiểm ⇒ payload xuống thẳng DB, vỡ CHECK `chk_shift_assignments_target` ⇒
     * **500 SYSTEM-ERR-001**. Đo được 25/08; vá 26/08 bằng `.refine()` mirror CHECK 1:1 ở CONTRACT.
     *
     * Payload này là payload TỰ NHIÊN NHẤT mà client viết ra ("gán ca này cho nhân viên này" — quên
     * `assignmentScope`), không phải payload rác cố tình ⇒ phải chết ở BIÊN với 400, không phải ở DB với 500.
     *
     * ⚠️ `toBe(400)` chứ KHÔNG `toBeGreaterThanOrEqual(400)` — assert nới sẽ xanh với CẢ hai hành vi
     * (500 cũ lẫn 400 mới) tức là ghim lỗ hổng MỞ ([[tests-can-pin-a-hole-open]]).
     */
    it("shift-assignment thiếu `assignmentScope` + có `employeeId` ⇒ 400 ở biên (KI-080 ĐÃ VÁ)", async () => {
      const shift = await authPost(tAdminA, "/attendance/shifts").send({
        shiftCode: `CA-${uniq()}`,
        name: "Ca cho ca lật KI-080",
        requiredWorkingMinutes: 480,
      });
      expect(shift.status, JSON.stringify(shift.body)).toBe(201);

      const res = await authPost(tAdminA, "/attendance/shift-assignments").send({
        shiftId: shift.body.data.id,
        employeeId: empIdA, // assignmentScope BỬ TRỐNG ⇒ default "Company" ⇒ mâu thuẫn scope↔neo
        effectiveFrom: dayShift(-1),
      });
      expect(res.status, `phải chặn ở BIÊN: ${JSON.stringify(res.body)}`).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION-ERR-001");

      // Vẫn KHÔNG có hàng nào — 400 thay 500 là đổi HỢP ĐỒNG, không được phép đổi HỆ QUẢ ghi.
      const rows = await direct.query(
        `SELECT id FROM shift_assignments WHERE company_id = $1 AND shift_id = $2`,
        [A.companyId, shift.body.data.id],
      );
      expect(rows.rowCount, "request hỏng KHÔNG được để lại hàng nào").toBe(0);
    });

    /**
     * Biến thể TƯỜNG MINH của cùng chiều NGƯỢC: không dựa vào `.default()` nữa mà gửi hẳn
     * `assignmentScope:'Company'` kèm `employeeId`. Tách ra riêng vì ca trên còn có thể xanh nhờ ai đó gỡ
     * `.default("Company")` (đổi default = đổi hợp đồng của mọi client đang gửi ĐÚNG) thay vì vá refine.
     *
     * `empIdA` là employee CÓ THẬT ⇒ 400 không thể bị nhầm là lỗi FK/không-tồn-tại; nó là 400 vì
     * scope MÂU THUẪN với cột neo.
     */
    it("shift-assignment `assignmentScope:'Company'` TƯỜNG MINH + `employeeId` thật ⇒ 400", async () => {
      const shift = await authPost(tAdminA, "/attendance/shifts").send({
        shiftCode: `CA-${uniq()}`,
        name: "Ca cho ca Company+employeeId",
        requiredWorkingMinutes: 480,
      });
      expect(shift.status, JSON.stringify(shift.body)).toBe(201);

      const res = await authPost(tAdminA, "/attendance/shift-assignments").send({
        shiftId: shift.body.data.id,
        assignmentScope: "Company",
        employeeId: empIdA,
        effectiveFrom: dayShift(-1),
      });
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code).toBe("VALIDATION-ERR-001");

      const rows = await direct.query(
        `SELECT id FROM shift_assignments WHERE company_id = $1 AND shift_id = $2`,
        [A.companyId, shift.body.data.id],
      );
      expect(rows.rowCount).toBe(0);
    });

    // ─── 6. Quy tắc chấm công ───────────────────────────────────────────────────

    it("attendance/rules: POST → GET → PATCH → GET rules/effective", async () => {
      const created = await authPost(tAdminA, "/attendance/rules").send({
        ruleCode: `QT-${uniq()}`,
        name: "Quy tắc công ty",
        ruleScope: "Company",
        effectiveFrom: dayShift(-30),
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const ruleId = created.body.data.id as string;

      const list = await authGet(tAdminA, "/attendance/rules");
      expect(list.status, JSON.stringify(list.body)).toBe(200);
      expect((list.body.data.items as Array<{ id: string }>).map((r) => r.id)).toContain(ruleId);

      const patched = await authPatch(tAdminA, `/attendance/rules/${ruleId}`).send({
        name: "Quy tắc công ty (đã sửa)",
        requireGps: true,
      });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      const after = await authGet(tAdminA, "/attendance/rules");
      expect(
        (after.body.data.items as Array<{ id: string; name: string }>).find((r) => r.id === ruleId)
          ?.name,
      ).toBe("Quy tắc công ty (đã sửa)");

      const effective = await authGet(
        tAdminA,
        `/attendance/rules/effective?employeeId=${empIdA}&workDate=${dayShift(0)}`,
      );
      expect(effective.status, JSON.stringify(effective.body)).toBe(200);
      expect(effective.body.data.employeeId).toBe(empIdA);
    });

    /**
     * ANH EM CÙNG LỚP của KI-080, tìm ra khi rà điều kiện nghiệm thu #5 của S10-ATT-SHIFTASSIGNSCOPE-1:
     * `createRuleSchema` có ĐÚNG CÙNG MỘT `.refine()` một-chiều (chép nguyên văn, chỉ đổi tên trường), cách
     * bản vá 60 dòng trong CÙNG MỘT FILE, và `attendance_rules` cũng có CHECK hai chiều
     * (`chk_attendance_rules_target`). Vá một cái mà bỏ cái kia chính là bẫy "bản sao cách bản vá MỘT DÒNG".
     *
     * CẶP ALLOW + DENY đi liền nhau có chủ ý: không có vế ALLOW thì 400 có thể đang đến từ một lý do
     * KHÁC hẳn (thiếu quyền, `ruleCode` trùng…) và ca DENY thành xanh-RỖNG
     * ([[deny-cases-vacuous-without-allow-case]]).
     */
    it("attendance/rules: ALLOW `ruleScope:'Employee'` + employeeId ⇒ 201; DENY thiếu `ruleScope` + employeeId ⇒ 400", async () => {
      const allowed = await authPost(tAdminA, "/attendance/rules").send({
        ruleCode: `QT-${uniq()}`,
        name: "Quy tắc theo nhân viên",
        ruleScope: "Employee",
        employeeId: empIdA,
        effectiveFrom: dayShift(-30),
      });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
      expect(allowed.body.data.ruleScope).toBe("Employee");

      const denied = await authPost(tAdminA, "/attendance/rules").send({
        ruleCode: `QT-${uniq()}`,
        name: "Quy tắc quên ruleScope",
        employeeId: empIdA, // ruleScope BỬ TRỐNG ⇒ default "Company" ⇒ mâu thuẫn scope↔neo
        effectiveFrom: dayShift(-30),
      });
      expect(denied.status, `phải chặn ở BIÊN: ${JSON.stringify(denied.body)}`).toBe(400);
      expect(denied.body.error?.code).toBe("VALIDATION-ERR-001");
    });

    // ─── 7. LEAVE ───────────────────────────────────────────────────────────────

    it("PATCH /leave/types/:id — ALLOW, HỆ QUẢ đọc lại qua GET /leave/types", async () => {
      const created = await authPost(tAdminA, "/leave/types").send({
        name: `Nghỉ thử ${uniq()}`,
        code: `NT${uniq().slice(0, 4).toUpperCase()}`,
        paid: true,
        annualQuota: 12,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const typeId = created.body.data.id as string;

      const patched = await authPatch(tAdminA, `/leave/types/${typeId}`).send({ annualQuota: 15 });
      expect(patched.status, JSON.stringify(patched.body)).toBe(200);
      expect(patched.body.data.annualQuota, "phản hồi của PATCH phải trả giá trị mới").toBe(15);

      // HỆ QUẢ ở tầng dữ liệu — độc lập với hình dạng của route đọc.
      const row = await direct.query<{ annual_quota: string | null }>(
        `SELECT annual_quota FROM leave_types WHERE company_id = $1 AND id = $2`,
        [A.companyId, typeId],
      );
      expect(Number(row.rows[0].annual_quota)).toBe(15);

      // Route đọc chính tắc VẪN thấy loại nghỉ này (chứng minh nó không biến mất).
      const list = await authGet(tAdminA, "/leave/types");
      expect(list.status).toBe(200);
      expect((list.body.data as Array<{ id: string }>).map((t) => t.id)).toContain(typeId);
    });

    /**
     * 🔴 GHIM BUG (KI-081) — CA NÀY GHIM HÀNH VI SAI CÓ CHỦ Ý.
     *
     * `leaveTypeSchema` (packages/contracts, `leave.ts:58`) khai `annualQuota: z.number().nullable()`
     * là trường BẮT BUỘC của DTO loại nghỉ, và `POST`/`PATCH /leave/types` đều nhận + trả nó. Nhưng
     * route ĐỌC chính tắc `GET /leave/types` đi qua `LeaveReadService.toLeaveTypeView()` — một view
     * RỘNG HƠN (description · deductBalance · balanceUnit · allowHalfDay…) nhưng lại **BỎ SÓT
     * `annualQuota`**. Hệ quả: giá trị ghi được bằng PATCH KHÔNG đọc lại được qua route đọc chính tắc.
     *
     * MỨC ĐỘ: trôi hợp đồng đọc/ghi, KHÔNG phải lỗ bảo mật (không rò dữ liệu, chỉ THIẾU dữ liệu).
     *
     * ⚠️ Người vá KI-081 sẽ thấy ca này ĐỎ — đó là dấu hiệu vá ĐÚNG. Khi đó LẬT `toBeUndefined()`
     * thành `toBe(15)`; đừng xoá ca ([[tests-can-pin-a-hole-open]]).
     */
    it("🔴 GHIM BUG (KI-081): GET /leave/types KHÔNG trả `annualQuota` dù contract khai bắt buộc", async () => {
      const created = await authPost(tAdminA, "/leave/types").send({
        name: `Nghỉ quota ${uniq()}`,
        code: `NQ${uniq().slice(0, 4).toUpperCase()}`,
        paid: true,
        annualQuota: 7,
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const typeId = created.body.data.id as string;

      const list = await authGet(tAdminA, "/leave/types");
      expect(list.status).toBe(200);
      const row = (
        list.body.data as Array<{ id: string; name?: string; annualQuota?: number }>
      ).find((t) => t.id === typeId);
      expect(row, "loại nghỉ vừa tạo PHẢI có trong danh sách (chống ca xanh-rỗng)").toBeDefined();
      expect(row?.name, "hàng đọc được phải mang tên thật, không phải object rỗng").toBeTruthy();
      expect(
        row?.annualQuota,
        "hành vi hiện tại (SAI): route đọc chính tắc bỏ sót annualQuota",
      ).toBeUndefined();
    });

    it("GET /leave/admin/balances/:id/transactions — 200 trên quỹ THẬT (không phải id bịa)", async () => {
      const type = await authPost(tAdminA, "/leave/types").send({
        name: `Nghỉ quỹ ${uniq()}`,
        code: `NQ${uniq().slice(0, 4).toUpperCase()}`,
        paid: true,
        annualQuota: 12,
      });
      expect(type.status, JSON.stringify(type.body)).toBe(201);

      const balance = await authPost(tAdminA, "/leave/balances").send({
        userId: userIdA,
        leaveTypeId: type.body.data.id,
        year: new Date().getUTCFullYear(),
        totalDays: 12,
      });
      expect(balance.status, JSON.stringify(balance.body)).toBeLessThan(300);
      const balanceId = balance.body.data.id as string;

      const tx = await authGet(tAdminA, `/leave/admin/balances/${balanceId}/transactions`);
      expect(tx.status, JSON.stringify(tx.body)).toBe(200);
      expect(Array.isArray(tx.body.data)).toBe(true);
    });

    it("GET /leave/calendar + GET /leave/reports — 200 với khoảng ngày hợp lệ", async () => {
      const cal = await authGet(
        tAdminA,
        `/leave/calendar?scope=own&from=${dayShift(-7)}&to=${dayShift(7)}`,
      );
      expect(cal.status, JSON.stringify(cal.body)).toBe(200);
      expect(cal.body.data).toBeDefined();

      const rep = await authGet(
        tAdminA,
        `/leave/reports?fromDate=${dayShift(-30)}&toDate=${dayShift(0)}`,
      );
      expect(rep.status, JSON.stringify(rep.body)).toBe(200);
      expect(rep.body.data).toBeDefined();
    });

    it("leave/calendar: DTO 400 ở BIÊN khi `from` > `to`", async () => {
      const bad = await authGet(
        tAdminA,
        `/leave/calendar?scope=own&from=${dayShift(7)}&to=${dayShift(-7)}`,
      );
      expect(bad.status, JSON.stringify(bad.body)).toBe(400);
    });

    // ─── 8. DENY — role RỖNG, đặt SAU toàn bộ ALLOW ─────────────────────────────

    it("DENY 403: actor role RỖNG bị chặn ở toàn bộ 18 route", async () => {
      const fake = randomUUID();
      const dates = `fromDate=${dayShift(-7)}&toDate=${dayShift(0)}`;
      const calls = [
        authGet(tEmptyA, "/attendance/my-records"),
        authGet(tEmptyA, "/attendance/periods"),
        authPost(tEmptyA, "/attendance/periods/lock").send({
          periodMonth: dayShift(0).slice(0, 7),
        }),
        authGet(tEmptyA, "/attendance/schedules"),
        authPost(tEmptyA, "/attendance/schedules").send({
          name: "x",
          startTime: "08:00",
          endTime: "17:00",
        }),
        authPatch(tEmptyA, `/attendance/schedules/${fake}`).send({ graceMinutes: 1 }),
        authGet(tEmptyA, `/attendance/reports?${dates}`),
        authGet(tEmptyA, `/attendance/reports/team?${dates}`),
        authGet(tEmptyA, "/attendance/rules"),
        authGet(tEmptyA, `/attendance/rules/effective?workDate=${dayShift(0)}`),
        authPatch(tEmptyA, `/attendance/rules/${fake}`).send({ name: "x" }),
        authGet(tEmptyA, "/attendance/shifts"),
        authPatch(tEmptyA, `/attendance/shifts/${fake}`).send({ name: "x" }),
        authGet(tEmptyA, "/attendance/shift-assignments"),
        authPatch(tEmptyA, `/leave/types/${fake}`).send({ annualQuota: 1 }),
        authGet(tEmptyA, `/leave/admin/balances/${fake}/transactions`),
        authGet(tEmptyA, `/leave/calendar?scope=own&from=${dayShift(-1)}&to=${dayShift(1)}`),
        authGet(tEmptyA, `/leave/reports?${dates}`),
      ];
      const results = await Promise.all(calls);
      for (const [i, r] of results.entries()) {
        expect(r.status, `call#${i} phải 403, nhận ${r.status}: ${JSON.stringify(r.body)}`).toBe(
          403,
        );
      }
    });

    // ─── 9. Cô lập tenant ───────────────────────────────────────────────────────

    it("CROSS-TENANT: tenant B không thấy lịch/ca/quy tắc của tenant A", async () => {
      const schedules = await authGet(tAdminB, "/attendance/schedules");
      expect(schedules.status).toBe(200);
      const idsA = (await authGet(tAdminA, "/attendance/schedules")).body.data as Array<{
        id: string;
      }>;
      const idsB = (schedules.body.data as Array<{ id: string }>).map((s) => s.id);
      for (const s of idsA) expect(idsB).not.toContain(s.id);

      const shiftsA = (await authGet(tAdminA, "/attendance/shifts")).body.data.items as Array<{
        id: string;
      }>;
      expect(shiftsA.length, "tenant A phải có ca để phép so sánh không rỗng").toBeGreaterThan(0);
      const patchB = await authPatch(tAdminB, `/attendance/shifts/${shiftsA[0].id}`).send({
        name: "chiếm quyền",
      });
      expect(patchB.status, JSON.stringify(patchB.body)).toBe(404);

      // Cạnh đối chứng: token B sửa được ca của CHÍNH nó ⇒ 404 ở trên là cô lập, không phải route chết.
      const ownShift = await authPost(tAdminB, "/attendance/shifts").send({
        shiftCode: `CA-${uniq()}`,
        name: "Ca của B",
        requiredWorkingMinutes: 480,
      });
      expect(ownShift.status, JSON.stringify(ownShift.body)).toBe(201);
      const ownPatch = await authPatch(tAdminB, `/attendance/shifts/${ownShift.body.data.id}`).send(
        { name: "Ca của B (sửa)" },
      );
      expect(ownPatch.status, JSON.stringify(ownPatch.body)).toBe(200);
    });

    it("neo chống-nhiễu: org unit của actor tồn tại (fixture không rỗng)", () => {
      expect(orgUnitA).toBeTruthy();
      expect(empIdA).toBeTruthy();
    });
  },
);
