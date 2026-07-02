/**
 * S3-ATT-BE-1 — Integration (Postgres THẬT, DB CÔ LẬP). Chứng minh trên đường THẬT (RLS+FORCE, app-role
 * semantics qua DatabaseService.withTenant) các bất biến/luồng KHÔNG mock được:
 *   H  happy path: check-in→check-out OFFICE_8H ⇒ working/late/early đúng, attendance_status TitleCase,
 *      ĐÚNG 2 attendance_logs + 2 audit_logs (object_type='attendance_record'), calculation_snapshot có.
 *   D  0-dup: check-in lần 2 cùng ngày ⇒ Conflict (app-guard + unique backstop).
 *   L  leave-block: đơn nghỉ cả ngày ĐÃ DUYỆT (status 'approved' VÀ 'Approved') ⇒ check-in Conflict +
 *      today.canCheckIn=false + disabledReason nhắc nghỉ.
 *   X  cross-tenant: nhân sự công ty A, ngữ cảnh công ty B ⇒ check-in Forbidden, today KHÔNG rò (employee null).
 *   S  server-time: clientTime bịa ⇒ record/log time ≈ now (server), client_time lưu nhưng KHÔNG dùng calc.
 *   G  HTTP gate: nhân viên role 'employee' (view-own:attendance, mig 0454) GET /attendance/today ⇒ 200.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate): .env làm hasDb=true ⇒ đỏ-giả trên DB
 * dev chung; chỉ chạy trên DB cô lập lane. Colocated src/attendance → vitest gom qua include `src/**\/*.spec.ts`.
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { DatabaseService } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { MasterDataSeedRunner } from "../foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../foundation/seed/seed-tracking.service";
import { PasswordService } from "../auth/password.service";
import { AttMasterDataSeeder } from "./att-master-data.seeder";
import { AttendanceRepository } from "./attendance.repository";
import { AttendanceService } from "./attendance.service";
import { directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";

const runDb = hasDb && Boolean(process.env.LANE_DB);

const WD = "2024-06-03";
const CHECK_IN = new Date("2024-06-03T01:00:00Z"); // 08:00 VN — đúng giờ vào
const CHECK_OUT = new Date("2024-06-03T10:00:00Z"); // 17:00 VN — đúng giờ ra
const EMPLOYEE_ROLE_ID = "00000000-0000-0000-0000-000000000008"; // system 'employee' (view-own:attendance)
const LOGIN_PW = "Passw0rd!test99";

/** Fake CHỈ Date (toFake:['Date']) — KHÔNG đụng setTimeout/microtask ⇒ pg I/O (await) chạy bình thường. */
async function freezeDate<T>(when: Date, fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(when);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

async function insertEmployee(
  direct: Pool,
  companyId: string,
  userId: string,
  status = "active",
): Promise<string> {
  const r = await direct.query(
    "INSERT INTO employee_profiles (company_id, user_id, status) VALUES ($1,$2,$3) RETURNING id",
    [companyId, userId, status],
  );
  return r.rows[0].id as string;
}

async function insertLeaveType(direct: Pool, companyId: string): Promise<string> {
  const r = await direct.query(
    "INSERT INTO leave_types (company_id, name, code) VALUES ($1,'Nghỉ phép năm',$2) RETURNING id",
    [companyId, `AL-${Math.random().toString(36).slice(2, 8)}`],
  );
  return r.rows[0].id as string;
}

async function insertApprovedLeave(
  direct: Pool,
  opts: {
    companyId: string;
    userId: string;
    employeeId: string;
    leaveTypeId: string;
    status: string;
    workDate: string;
  },
): Promise<void> {
  await direct.query(
    `INSERT INTO leave_requests
       (company_id, user_id, employee_id, leave_type_id, start_date, end_date, total_days, status, duration_type, reason)
     VALUES ($1,$2,$3,$4,$5,$5,1,$6,'FullDay','seed leave')`,
    [opts.companyId, opts.userId, opts.employeeId, opts.leaveTypeId, opts.workDate, opts.status],
  );
}

function buildService(): AttendanceService {
  const db = new DatabaseService();
  return new AttendanceService(
    db,
    new AttendanceRepository(db),
    { can: async () => ({ allow: true }) } as never, // controller-level gate covered by HTTP test
    new AuditService(),
    new OutboxService(),
  );
}

describe.skipIf(!runDb)("S3-ATT-BE-1 Today/check-in/check-out (DB cô lập, đường thật)", () => {
  let app: INestApplication;
  let direct: Pool;
  let A: SeededTenant;
  let B: SeededTenant;
  let runner: MasterDataSeedRunner;
  let service: AttendanceService;
  const companyIds: string[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    direct = directPool();
    A = await seedCompany(direct, "attbe1a");
    B = await seedCompany(direct, "attbe1b");
    companyIds.push(A.companyId, B.companyId);

    const dbsvc = new DatabaseService();
    const registry = new MasterDataSeederRegistry();
    registry.register(new AttMasterDataSeeder());
    runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
    // Seed OFFICE_8H (is_default) + DEFAULT_OFFICE_RULE (Company) for company A.
    await runner.reconcileCompany(A.companyId);

    service = buildService();
  });

  afterAll(async () => {
    await app?.close();
    if (direct && companyIds.length) await cleanupTenants(direct, companyIds);
    await direct?.end();
  });

  // ── H: happy path check-in → check-out ─────────────────────────────────────────
  it("H — check-in→check-out OFFICE_8H: working/late/early đúng + TitleCase + 2 logs + 2 audit + snapshot", async () => {
    const userId = await seedUser(direct, A.companyId, `h-${A.slug}@x.test`);
    const empId = await insertEmployee(direct, A.companyId, userId);
    const actor = { id: userId, companyId: A.companyId };

    const ci = await freezeDate(CHECK_IN, () => service.checkIn(actor, { method: "web" }));
    expect(ci.attendanceStatus).toBe("Checked-in");
    expect(ci.lateMinutes).toBe(0);
    expect(ci.shiftId).toBeTruthy();
    expect(ci.employeeId).toBe(empId);

    const co = await freezeDate(CHECK_OUT, () => service.checkOut(actor, { method: "web" }));
    expect(co.earlyLeaveMinutes).toBe(0);
    expect(co.workingMinutes).toBe(480);
    expect(co.requiredWorkingMinutes).toBe(480);
    expect(co.missingMinutes).toBe(0);
    expect(co.attendanceStatus).toBe("Present");
    expect(co.status).toBe("present");

    const rec = await direct.query(
      `SELECT id, shift_id, employee_id, late_minutes, early_leave_minutes, working_minutes,
              required_working_minutes, missing_minutes, attendance_status, status,
              first_log_id, last_log_id, calculation_snapshot
         FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND work_date=$3 AND deleted_at IS NULL`,
      [A.companyId, userId, WD],
    );
    expect(rec.rows.length).toBe(1);
    const row = rec.rows[0];
    expect(row.attendance_status).toBe("Present");
    expect(row.first_log_id).toBeTruthy();
    expect(row.last_log_id).toBeTruthy();
    expect(row.first_log_id).not.toBe(row.last_log_id);
    expect(row.calculation_snapshot).toBeTruthy();

    const logs = await direct.query(
      `SELECT log_type, employee_id, source, is_valid FROM attendance_logs
        WHERE company_id=$1 AND employee_id=$2 AND work_date=$3 ORDER BY log_time ASC`,
      [A.companyId, empId, WD],
    );
    expect(logs.rows.map((r) => r.log_type)).toEqual(["Check-in", "Check-out"]);
    for (const l of logs.rows) {
      expect(l.employee_id).toBe(empId);
      expect(l.source).toBe("WEB");
      expect(l.is_valid).toBe(true);
    }

    const audits = await direct.query(
      `SELECT action FROM audit_logs WHERE company_id=$1 AND object_type='attendance_record'
         AND object_id=$2 ORDER BY created_at ASC`,
      [A.companyId, row.id],
    );
    expect(audits.rows.map((r) => r.action)).toEqual([
      "attendance.check_in",
      "attendance.check_out",
    ]);
  });

  // ── D: 0-dup second check-in ───────────────────────────────────────────────────
  it("D — check-in lần 2 cùng ngày ⇒ Conflict (0-dup)", async () => {
    const userId = await seedUser(direct, A.companyId, `d-${A.slug}@x.test`);
    await insertEmployee(direct, A.companyId, userId);
    const actor = { id: userId, companyId: A.companyId };
    await freezeDate(CHECK_IN, () => service.checkIn(actor, { method: "web" }));
    await expect(
      freezeDate(CHECK_IN, () => service.checkIn(actor, { method: "web" })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  // ── L: approved-leave block (status case duality) ──────────────────────────────
  it.each(["approved", "Approved"])(
    "L — đơn nghỉ cả ngày ĐÃ DUYỆT (%s) ⇒ check-in Conflict + today disabled",
    async (status) => {
      // Unique email per run — normalized_email lowercases, so 'approved'/'Approved' would collide.
      const tag = Math.random().toString(36).slice(2, 8);
      const userId = await seedUser(direct, A.companyId, `l-${tag}-${A.slug}@x.test`);
      const empId = await insertEmployee(direct, A.companyId, userId);
      const ltId = await insertLeaveType(direct, A.companyId);
      await insertApprovedLeave(direct, {
        companyId: A.companyId,
        userId,
        employeeId: empId,
        leaveTypeId: ltId,
        status,
        workDate: WD,
      });
      const actor = { id: userId, companyId: A.companyId };

      await expect(
        freezeDate(CHECK_IN, () => service.checkIn(actor, { method: "web" })),
      ).rejects.toBeInstanceOf(ConflictException);

      const today = await freezeDate(CHECK_IN, () => service.getToday(actor));
      expect(today.allowedActions.canCheckIn).toBe(false);
      expect(today.disabledReason ?? "").toContain("nghỉ");
    },
  );

  // ── X: cross-tenant isolation ──────────────────────────────────────────────────
  it("X — nhân sự công ty A trong ngữ cảnh công ty B ⇒ check-in Forbidden, today KHÔNG rò", async () => {
    const userId = await seedUser(direct, A.companyId, `x-${A.slug}@x.test`);
    await insertEmployee(direct, A.companyId, userId);
    const crossActor = { id: userId, companyId: B.companyId }; // userId thuộc A, ngữ cảnh B

    await expect(service.checkIn(crossActor, { method: "web" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const today = await service.getToday(crossActor);
    expect(today.employee).toBeNull();
    expect(today.allowedActions).toEqual({ canCheckIn: false, canCheckOut: false });
  });

  // ── S: server time authoritative; client_time stored unused ────────────────────
  it("S — clientTime bịa ⇒ record/log time ≈ now (server); client_time lưu nhưng KHÔNG dùng calc", async () => {
    const userId = await seedUser(direct, A.companyId, `s-${A.slug}@x.test`);
    const empId = await insertEmployee(direct, A.companyId, userId);
    const actor = { id: userId, companyId: A.companyId };
    const bogus = "2030-01-01T00:00:00.000Z";

    await freezeDate(CHECK_IN, () =>
      service.checkIn(actor, { method: "web", clientTime: bogus, clientTimezone: "Asia/Tokyo" }),
    );

    const rec = await direct.query(
      "SELECT check_in_at, work_date FROM attendance_records WHERE company_id=$1 AND user_id=$2 AND deleted_at IS NULL",
      [A.companyId, userId],
    );
    expect(rec.rows.length).toBe(1);
    // check_in_at ≈ frozen server now (NOT the bogus 2030 client claim).
    expect(new Date(rec.rows[0].check_in_at).getTime()).toBe(CHECK_IN.getTime());

    const log = await direct.query(
      "SELECT log_time, client_time, client_timezone FROM attendance_logs WHERE company_id=$1 AND employee_id=$2",
      [A.companyId, empId],
    );
    expect(log.rows.length).toBe(1);
    // log_time = DB now() (server-of-record clock): a real recent timestamp, NOT the bogus 2030 claim.
    const logMs = new Date(log.rows[0].log_time).getTime();
    expect(Math.abs(Date.now() - logMs)).toBeLessThan(5 * 60 * 1000);
    expect(logMs).not.toBe(new Date(bogus).getTime());
    // client_time STORED (reference) but ≠ server time → proves it never fed the calc.
    expect(new Date(log.rows[0].client_time).toISOString()).toBe(bogus);
    expect(log.rows[0].client_timezone).toBe("Asia/Tokyo");
  });

  // ── G: HTTP view-own gate lets a normal employee GET /today ────────────────────
  it("G — employee (view-own:attendance) GET /attendance/today ⇒ 200", async () => {
    const pw = await new PasswordService().hash(LOGIN_PW);
    const email = `g-${A.slug}@x.test`;
    const userId = await seedUser(direct, A.companyId, email, pw);
    await seedUserRole(direct, userId, EMPLOYEE_ROLE_ID, A.companyId);
    await insertEmployee(direct, A.companyId, userId);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: A.slug, email, password: LOGIN_PW });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const token = login.body.data.accessToken as string;

    const res = await request(app.getHttpServer())
      .get("/attendance/today")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty("allowedActions");
    expect(res.body.data.employee).toMatchObject({ status: "active" });
  });
});
