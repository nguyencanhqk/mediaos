/**
 * S6-LEAVE-ACCRUAL-1 — Integration (Postgres THẬT, DB CÔ LẬP) cho engine cộng dồn phép.
 *
 * Đây là vùng ĐỎ: mỗi dòng sổ cái thừa = một ngày phép có giá trị tiền cấp sai cho người thật. Nên spec
 * này không dừng ở "chạy được", mà chứng minh 4 thứ TỰ NÓ KHÔNG THỂ SAI:
 *
 *   IDEMPOTENT   · chạy job 1 → N lần trên cùng kỳ: lần đầu cấp, các lần sau cấp 0, số dư/sổ cái ĐỨNG YÊN
 *   CHỐT Ở DB    · INSERT tay dòng ACCRUAL trùng kỳ ⇒ VỠ unique (mig 0536) — chứng minh lớp bảo vệ cuối
 *                  thật sự sống, không phải chỉ nhờ logic app cẩn thận
 *   APPEND-ONLY  · role app UPDATE/DELETE sổ cái ⇒ bị chặn (BẤT BIẾN #2)
 *   CÔ LẬP TENANT· chạy cho A không đẻ một dòng nào của B (BẤT BIẾN #1)
 *
 * Cộng các ca nghiệp vụ chốt số: người nghỉ việc chỉ nhận phần tháng ĐÃ làm, hồ sơ thiếu `start_date` bị
 * bỏ qua CÓ LÝ DO và được bù đủ sau khi HR điền, audit chỉ ghi khi thực sự cấp.
 *
 * CÔNG TY MỚI CHO MỖI CA (`beforeEach`) thay vì dọn dẹp giữa chừng: `audit_logs` và
 * `leave_balance_transactions` là bảng APPEND-ONLY (BẤT BIẾN #2) — fixture dọn dẹp quen tay sẽ phải xoá
 * đúng hai bảng KHÔNG được phép xoá (hook guard-immutability chặn, và chặn đúng). Tenant sạch cho ngưỡng
 * đo bằng 0 mà không cần đụng vào chúng.
 *
 * Gate cứng `hasDb && LANE_DB` (memory integration-test-lane-db-gate). Colocated src/leave → vitest include.
 */

import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Pool } from "pg";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module";
import { AllExceptionsFilter } from "../common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../common/interceptors/response-envelope.interceptor";
import { PasswordService } from "../auth/password.service";
import { appPool, directPool, hasDb } from "../../test/helpers/integration-db";
import {
  cleanupTenants,
  seedCompany,
  seedPermissionCatalog,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../../test/helpers/seed";
import { SYSTEM_JOB_HANDLER } from "../scheduler/job-handler";
import { LeaveAccrualService } from "./leave-accrual.service";
import { LEAVE_ACCRUAL_JOB_CODE, LeaveAccrualJobHandler } from "./leave-accrual.job-handler";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

/** Mốc thời gian CỐ ĐỊNH — bám PROD (01/08/2026: 7 tháng đã kết thúc, quota 12 ⇒ 1 ngày/tháng). */
const TODAY = "2026-08-01";
const MONTH_ENDS_2026 = [
  "2026-01-31",
  "2026-02-28",
  "2026-03-31",
  "2026-04-30",
  "2026-05-31",
  "2026-06-30",
  "2026-07-31",
];

describe.skipIf(!runDb)("S6-LEAVE-ACCRUAL-1 engine cộng dồn phép (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let accrual: LeaveAccrualService;
  let handler: LeaveAccrualJobHandler;
  /** Tenant CỐ ĐỊNH cho 2 ca HTTP — engine KHÔNG BAO GIỜ chạy trên nó ⇒ luôn sạch để đo dry-run. */
  let http: SeededTenant;
  /** Tenant MỚI mỗi ca engine. */
  let co = "";
  let leaveTypeId = "";
  const companyIds: string[] = [];

  let hrToken = "";
  let noviewToken = "";

  let _hash = "";
  async function hash(): Promise<string> {
    if (!_hash) _hash = await new PasswordService().hash(LOGIN_PW);
    return _hash;
  }

  async function plantType(companyId: string, code: string): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_types
         (company_id, code, name, paid, status, deduct_balance, balance_unit, allow_full_day,
          allow_multiple_days, sort_order, allow_negative_balance)
       VALUES ($1,$2,$3,true,'active',true,'Day',true,true,1,false) RETURNING id`,
      [companyId, code, "Phép năm"],
    );
    return r.rows[0].id as string;
  }

  async function plantPolicy(
    companyId: string,
    typeId: string,
    over: { accrualMethod?: string; quota?: number | null; effectiveFrom?: string } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_policies
         (company_id, leave_type_id, policy_code, name, policy_scope, yearly_quota_days,
          accrual_method, effective_from, status, priority)
       VALUES ($1,$2,$3,$4,'Company',$5,$6,$7,'Active',0) RETURNING id`,
      [
        companyId,
        typeId,
        `POL-${randomUUID().slice(0, 8)}`,
        "Chính sách phép năm",
        over.quota === undefined ? 12 : over.quota,
        over.accrualMethod ?? "Monthly",
        over.effectiveFrom ?? "2020-01-01",
      ],
    );
    return r.rows[0].id as string;
  }

  async function plantEmployee(
    companyId: string,
    over: { startDate?: string | null; endDate?: string | null; status?: string } = {},
  ): Promise<{ userId: string; employeeId: string }> {
    const userId = await seedUser(
      direct,
      companyId,
      `acc-${randomUUID().slice(0, 8)}@test.local`,
      await hash(),
    );
    const r = await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        companyId,
        userId,
        `E-${userId.slice(0, 8)}`,
        over.startDate === undefined ? "2020-05-10" : over.startDate,
        over.endDate ?? null,
        over.status ?? "active",
      ],
    );
    return { userId, employeeId: r.rows[0].id as string };
  }

  async function ledgerRows(companyId: string, employeeId?: string) {
    const r = await direct.query(
      `SELECT employee_id, leave_type_id, transaction_date::text AS d, amount_days::float AS amt,
              balance_before_days::float AS before_d, balance_after_days::float AS after_d,
              transaction_type, created_by_type, reason
         FROM leave_balance_transactions
        WHERE company_id=$1 ${employeeId ? "AND employee_id=$2" : ""}
        ORDER BY transaction_date`,
      employeeId ? [companyId, employeeId] : [companyId],
    );
    return r.rows as {
      employee_id: string;
      leave_type_id: string;
      d: string;
      amt: number;
      before_d: number;
      after_d: number;
      transaction_type: string;
      created_by_type: string;
      reason: string;
    }[];
  }

  async function balanceOf(companyId: string, userId: string, typeId: string, year = 2026) {
    const r = await direct.query(
      `SELECT id, total_days::float AS total, used_days::float AS used,
              remaining_days::float AS remaining, granted_days::float AS granted,
              employee_id, balance_year, last_accrual_at
         FROM leave_balances
        WHERE company_id=$1 AND user_id=$2 AND leave_type_id=$3 AND year=$4`,
      [companyId, userId, typeId, year],
    );
    return r.rows[0] as
      | {
          id: string;
          total: number;
          used: number;
          remaining: number;
          granted: number | null;
          employee_id: string | null;
          balance_year: number | null;
          last_accrual_at: Date | null;
        }
      | undefined;
  }

  async function countAudit(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action='leave_accrual_run'`,
      [companyId],
    );
    return r.rows[0].n as number;
  }

  async function login(slug: string, email: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ companySlug: slug, email, password: LOGIN_PW });
    expect(res.status, `login ${email}: ${JSON.stringify(res.body)}`).toBe(200);
    return res.body.data.accessToken as string;
  }

  async function freshTenant(label: string): Promise<{ companyId: string; typeId: string }> {
    const t = await seedCompany(direct, label);
    companyIds.push(t.companyId);
    const typeId = await plantType(t.companyId, `ANNUAL-${randomUUID().slice(0, 6)}`);
    await plantPolicy(t.companyId, typeId);
    return { companyId: t.companyId, typeId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    accrual = app.get(LeaveAccrualService);
    handler = app.get(LeaveAccrualJobHandler);

    direct = directPool();
    http = await seedCompany(direct, "lvacchttp");
    companyIds.push(http.companyId);
    const httpType = await plantType(http.companyId, `ANNUAL-HTTP-${randomUUID().slice(0, 6)}`);
    await plantPolicy(http.companyId, httpType);

    const hrId = await seedUser(direct, http.companyId, `hr@${http.slug}.test`, await hash());
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3)`,
      [http.companyId, hrId, `HR-${hrId.slice(0, 8)}`],
    );
    const roleId = await seedRole(direct, http.companyId, `acc-hr-${hrId.slice(0, 8)}`);
    const permId = await seedPermissionCatalog(direct, "view", "leave-balance", true);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
    await seedUserRole(direct, hrId, roleId, http.companyId);
    hrToken = await login(http.slug, `hr@${http.slug}.test`);

    const noviewId = await seedUser(
      direct,
      http.companyId,
      `noview@${http.slug}.test`,
      await hash(),
    );
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3)`,
      [http.companyId, noviewId, `NV-${noviewId.slice(0, 8)}`],
    );
    noviewToken = await login(http.slug, `noview@${http.slug}.test`);
  }, 90_000);

  beforeEach(async () => {
    const t = await freshTenant("lvacc");
    co = t.companyId;
    leaveTypeId = t.typeId;
  });

  afterAll(async () => {
    await app?.close();
    if (direct) await cleanupTenants(direct, companyIds);
  }, 60_000);

  // ── IDEMPOTENT ─────────────────────────────────────────────────────────────

  it("chạy 1 lần: cấp đúng 7 kỳ (T1..T7/2026), số dư 7.0, sổ cái 7 dòng ACCRUAL", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });

    const run = await accrual.runCompany(co, TODAY);
    expect(run.granted).toBe(7);
    expect(run.grantedDays).toBe(7);
    expect(run.failed).toBe(0);

    const rows = await ledgerRows(co, e.employeeId);
    expect(rows.map((r) => r.d)).toEqual(MONTH_ENDS_2026);
    expect(rows.every((r) => r.transaction_type === "ACCRUAL")).toBe(true);
    expect(rows.every((r) => r.created_by_type === "Job")).toBe(true);
    expect(rows.every((r) => r.amt === 1)).toBe(true);
    // Sổ cái phải kể được câu chuyện số dư: before/after chạy 0→1→…→7, không lỗ hổng.
    expect(rows.map((r) => r.before_d)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows.map((r) => r.after_d)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows[6].reason).toBe("ACCRUAL 2026-07");

    const bal = await balanceOf(co, e.userId, leaveTypeId);
    expect(bal?.total).toBe(7);
    expect(bal?.granted).toBe(7);
    expect(bal?.remaining).toBe(7);
    expect(bal?.employee_id).toBe(e.employeeId);
    expect(bal?.balance_year).toBe(2026);
    expect(bal?.last_accrual_at).not.toBeNull();
  });

  it("chạy N lần trên CÙNG kỳ ⇒ chỉ lần đầu cấp; số dư và sổ cái ĐỨNG YÊN", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    expect((await accrual.runCompany(co, TODAY)).granted).toBe(7);

    for (let i = 0; i < 4; i += 1) {
      const again = await accrual.runCompany(co, TODAY);
      expect(again.granted, `lần chạy ${i + 2}`).toBe(0);
      expect(again.failed).toBe(0);
      expect(again.preview.alreadyGranted).toBe(7);
    }

    expect(await ledgerRows(co, e.employeeId)).toHaveLength(7);
    expect((await balanceOf(co, e.userId, leaveTypeId))?.total).toBe(7);
  });

  it("hai lần chạy SONG SONG ⇒ tổng vẫn đúng 7 dòng, không có kỳ nào cấp đôi", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    // Một trong hai có thể vỡ vì unique/khoá hàng — đó là hàng rào LÀM VIỆC, không phải lỗi.
    await Promise.allSettled([accrual.runCompany(co, TODAY), accrual.runCompany(co, TODAY)]);

    const rows = await ledgerRows(co, e.employeeId);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.d)).size).toBe(7);
    expect((await balanceOf(co, e.userId, leaveTypeId))?.total).toBe(7);
  });

  // ── CHỐT Ở TẦNG DB (mig 0536) ──────────────────────────────────────────────

  it("INSERT tay dòng ACCRUAL TRÙNG kỳ ⇒ VỠ unique uq_leave_balance_tx_accrual_period", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    await accrual.runCompany(co, TODAY);
    const bal = await balanceOf(co, e.userId, leaveTypeId);

    await expect(
      direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
            transaction_date, amount_days, created_by_type)
         VALUES ($1,$2,$3,$4,'ACCRUAL','2026-07-31',1,'Job')`,
        [co, bal?.id, e.employeeId, leaveTypeId],
      ),
    ).rejects.toThrow(/uq_leave_balance_tx_accrual_period|duplicate key/i);
  });

  it("index PARTIAL: ADJUSTMENT/CARRY_OVER/EXPIRE cùng ngày KHÔNG bị chặn (chừa chỗ cho WO carry-over)", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    await accrual.runCompany(co, TODAY);
    const bal = await balanceOf(co, e.userId, leaveTypeId);

    for (const type of ["ADJUSTMENT", "CARRY_OVER", "EXPIRE"]) {
      await direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
            transaction_date, amount_days, created_by_type)
         VALUES ($1,$2,$3,$4,$5,'2026-07-31',1,'System')`,
        [co, bal?.id, e.employeeId, leaveTypeId, type],
      );
    }
    const rows = await ledgerRows(co, e.employeeId);
    expect(rows.filter((r) => r.transaction_type !== "ACCRUAL")).toHaveLength(3);
  });

  it("APPEND-ONLY: role app KHÔNG được UPDATE/DELETE dòng ACCRUAL (BẤT BIẾN #2)", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    await accrual.runCompany(co, TODAY);

    const client = await appPool().connect();
    try {
      await client.query(`SELECT set_config('app.current_company_id', $1, false)`, [co]);
      await expect(
        client.query(
          `UPDATE leave_balance_transactions SET amount_days = 99 WHERE company_id=$1 AND transaction_type='ACCRUAL'`,
          [co],
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        client.query(
          `DELETE FROM leave_balance_transactions WHERE company_id=$1 AND transaction_type='ACCRUAL'`,
          [co],
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
    expect(await ledgerRows(co, e.employeeId)).toHaveLength(7);
  });

  // ── CÔ LẬP TENANT ──────────────────────────────────────────────────────────

  it("chạy cho tenant A ⇒ tenant B (có chính sách + nhân viên riêng) KHÔNG sinh dòng nào", async () => {
    await plantEmployee(co, { startDate: "2020-05-10" });
    const other = await freshTenant("lvaccb");
    const eB = await plantEmployee(other.companyId, { startDate: "2020-05-10" });

    await accrual.runCompany(co, TODAY);

    expect(await ledgerRows(other.companyId)).toHaveLength(0);
    expect(await balanceOf(other.companyId, eB.userId, other.typeId)).toBeUndefined();
    expect(await countAudit(other.companyId)).toBe(0);
  });

  // ── NGHIỆP VỤ: chốt số ──────────────────────────────────────────────────────

  it("nghỉ việc giữa năm ⇒ CHỈ nhận phần tháng đã làm trọn (không cấp sau end_date)", async () => {
    const e = await plantEmployee(co, {
      startDate: "2024-01-01",
      endDate: "2026-04-21",
      status: "resigned",
    });
    await accrual.runCompany(co, TODAY);
    expect((await ledgerRows(co, e.employeeId)).map((r) => r.d)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
    ]);
    expect((await balanceOf(co, e.userId, leaveTypeId))?.total).toBe(3);
  });

  it("nghỉ việc từ NĂM TRƯỚC ⇒ 0 ngày, 0 dòng sổ cái, KHÔNG dựng dòng số dư rỗng", async () => {
    const e = await plantEmployee(co, {
      startDate: "2025-02-05",
      endDate: "2025-03-05",
      status: "resigned",
    });
    const run = await accrual.runCompany(co, TODAY);
    expect(run.granted).toBe(0);
    expect(await ledgerRows(co, e.employeeId)).toHaveLength(0);
    expect(await balanceOf(co, e.userId, leaveTypeId)).toBeUndefined();
  });

  it("thiếu start_date ⇒ BỎ QUA + báo lý do; HR điền xong chạy lại được BÙ ĐỦ, người khác KHÔNG cấp đôi", async () => {
    const ok = await plantEmployee(co, { startDate: "2020-05-10" });
    const missing = await plantEmployee(co, { startDate: null });

    const first = await accrual.runCompany(co, TODAY);
    expect(first.granted).toBe(7);
    expect(first.preview.skipped.find((s) => s.employeeId === missing.employeeId)?.reason).toBe(
      "MISSING_START_DATE",
    );
    expect(await ledgerRows(co, missing.employeeId)).toHaveLength(0);

    await direct.query(`UPDATE employee_profiles SET start_date='2026-03-15' WHERE id=$1`, [
      missing.employeeId,
    ]);
    const second = await accrual.runCompany(co, TODAY);
    expect(second.granted).toBe(4); // T4..T7
    expect(await ledgerRows(co, missing.employeeId)).toHaveLength(4);
    expect(await ledgerRows(co, ok.employeeId)).toHaveLength(7);
    expect((await balanceOf(co, ok.userId, leaveTypeId))?.total).toBe(7);
  });

  it("đã nghỉ việc mà THIẾU end_date ⇒ dừng + báo TERMINATED_WITHOUT_END_DATE (không đoán ngày)", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10", status: "resigned" });
    const run = await accrual.runCompany(co, TODAY);
    expect(run.preview.skipped.find((s) => s.employeeId === e.employeeId)?.reason).toBe(
      "TERMINATED_WITHOUT_END_DATE",
    );
    expect(await ledgerRows(co, e.employeeId)).toHaveLength(0);
  });

  it("số dư ĐANG DÙNG DỞ: cộng vào total_days, remaining tự đúng, không vỡ CHECK used<=total", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    await direct.query(
      `INSERT INTO leave_balances (company_id, user_id, employee_id, leave_type_id, year, total_days, used_days)
       VALUES ($1,$2,$3,$4,2026,3,2)`,
      [co, e.userId, e.employeeId, leaveTypeId],
    );

    await accrual.runCompany(co, TODAY);

    const bal = await balanceOf(co, e.userId, leaveTypeId);
    expect(bal?.total).toBe(10); // 3 có sẵn + 7 cấp mới
    expect(bal?.used).toBe(2);
    expect(bal?.remaining).toBe(8);
  });

  it("accrual_method='Manual' ⇒ engine KHÔNG đụng vào loại nghỉ đó (D-A4)", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    const typeManual = await plantType(co, `MANUAL-${randomUUID().slice(0, 6)}`);
    await plantPolicy(co, typeManual, { accrualMethod: "Manual" });

    await accrual.runCompany(co, TODAY);

    const rows = await ledgerRows(co, e.employeeId);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.leave_type_id === leaveTypeId)).toBe(true);
    expect(await balanceOf(co, e.userId, typeManual)).toBeUndefined();
  });

  it("HAI chính sách cùng loại nghỉ ⇒ chọn ĐÚNG cái priority cao hơn, KHÔNG cấp gộp cả hai", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    // beforeEach đã dựng 1 chính sách quota 12 priority 0. Thêm cái quota 24 priority 5 cho CÙNG loại.
    await direct.query(
      `INSERT INTO leave_policies
         (company_id, leave_type_id, policy_code, name, policy_scope, yearly_quota_days,
          accrual_method, effective_from, status, priority)
       VALUES ($1,$2,$3,'Ưu tiên cao','Company',24,'Monthly','2020-01-01','Active',5)`,
      [co, leaveTypeId, `POL-HI-${randomUUID().slice(0, 8)}`],
    );

    await accrual.runCompany(co, TODAY);

    // quota 24 ⇒ 2 ngày/tháng × 7 tháng = 14. Nếu resolve sai sẽ ra 7 (chọn nhầm) hoặc 21 (cấp cả hai).
    const rows = await ledgerRows(co, e.employeeId);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.amt === 2)).toBe(true);
    expect((await balanceOf(co, e.userId, leaveTypeId))?.total).toBe(14);
  });

  it("chính sách Monthly THIẾU hạn mức ⇒ 0 ngày nhưng CÓ lý do MISSING_QUOTA (không im lặng)", async () => {
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    const typeNoQuota = await plantType(co, `NOQ-${randomUUID().slice(0, 6)}`);
    await plantPolicy(co, typeNoQuota, { quota: null });

    const run = await accrual.runCompany(co, TODAY);
    expect(
      run.preview.skipped.some(
        (s) => s.leaveTypeId === typeNoQuota && s.reason === "MISSING_QUOTA",
      ),
    ).toBe(true);
    expect(await balanceOf(co, e.userId, typeNoQuota)).toBeUndefined();
    expect(await ledgerRows(co, e.employeeId)).toHaveLength(7); // loại có quota vẫn chạy
  });

  // ── AUDIT ──────────────────────────────────────────────────────────────────

  it("audit CHỈ ghi khi thực sự cấp: lần đầu 1 dòng, các nhịp sau KHÔNG thêm", async () => {
    await plantEmployee(co, { startDate: "2020-05-10" });
    await accrual.runCompany(co, TODAY);
    expect(await countAudit(co)).toBe(1);

    await accrual.runCompany(co, TODAY);
    await accrual.runCompany(co, TODAY);
    expect(await countAudit(co)).toBe(1);
  });

  it("không có gì để cấp ⇒ 0 dòng audit rác (nhịp 60s không đẻ audit)", async () => {
    await plantEmployee(co, { startDate: null });
    await accrual.runCompany(co, TODAY);
    expect(await countAudit(co)).toBe(0);
  });

  // ── JOB HANDLER ────────────────────────────────────────────────────────────

  it("job handler: jobCode duy nhất + metadata chỉ có SỐ ĐẾM (không PII)", async () => {
    await plantEmployee(co, { startDate: "2020-05-10" });
    await plantEmployee(co, { startDate: null });

    expect(handler.jobCode).toBe(LEAVE_ACCRUAL_JOB_CODE);
    const result = await handler.run({ companyId: co });
    expect(result.success).toBe(7);
    expect(result.failed).toBe(0);

    const meta = JSON.stringify(result.metadata);
    expect(meta).toContain("skippedByReason");
    expect(meta).toContain("MISSING_START_DATE");
    // Không uuid, không email lọt vào metadata (BẤT BIẾN #3).
    expect(meta).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    expect(meta).not.toContain("@");

    // Nhịp thứ hai: cùng chữ ký cảnh báo ⇒ không lặp WARN, và vẫn không cấp thêm gì.
    const second = await handler.run({ companyId: co });
    expect(second.success).toBe(0);
    expect(second.metadata?.alreadyGranted).toBe(7);
  });

  it("handler ĐƯỢC scheduler nhìn thấy: có metadata SYSTEM_JOB_HANDLER + resolve được từ container", () => {
    // Hai nửa của hợp đồng đăng ký. Thiếu nửa đầu ⇒ DiscoveryService không gom ⇒ job KHÔNG BAO GIỜ chạy
    // mà cũng không có lỗi nào — đúng kiểu im lặng WO này đi vá, chỉ dịch xuống tầng hạ tầng.
    expect(Reflect.getMetadata(SYSTEM_JOB_HANDLER, LeaveAccrualJobHandler)).toBe(true);
    expect(typeof handler.run).toBe("function");
  });

  it("tenant KHÔNG có chính sách cộng dồn nào ⇒ job no-op SẠCH (0 dòng, 0 audit, 0 lỗi)", async () => {
    const bare = await seedCompany(direct, "lvaccnp");
    companyIds.push(bare.companyId);
    await plantEmployee(bare.companyId, { startDate: "2020-05-10" });

    const result = await handler.run({ companyId: bare.companyId });
    expect(result.total).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.metadata?.policies).toBe(0);
    expect(await ledgerRows(bare.companyId)).toHaveLength(0);
    expect(await countAudit(bare.companyId)).toBe(0);
  });

  // ── HTTP: dry-run preview ──────────────────────────────────────────────────

  it("GET /leave/admin/accrual/preview — KHÔNG có view:leave-balance ⇒ 403 (deny-path)", async () => {
    const res = await request(app.getHttpServer())
      .get("/leave/admin/accrual/preview")
      .set("Authorization", `Bearer ${noviewToken}`);
    expect(res.status).toBe(403);
  });

  it("GET preview — CHỈ ĐỌC: trả kỳ sắp cấp + lý do bỏ qua, KHÔNG ghi dòng nào", async () => {
    await plantEmployee(http.companyId, { startDate: "2020-05-10" });
    await plantEmployee(http.companyId, { startDate: null });

    const res = await request(app.getHttpServer())
      .get("/leave/admin/accrual/preview")
      .set("Authorization", `Bearer ${hrToken}`);
    expect(res.status).toBe(200);
    const body = res.body.data as {
      pending: { transactionDate: string; userId?: string }[];
      pendingTotal: number;
      pendingTruncated: boolean;
      skipped: { reason: string }[];
      skippedTotal: number;
      skippedTruncated: boolean;
      policies: unknown[];
      employeesScanned: number;
    };
    expect(body.policies.length).toBeGreaterThan(0);
    expect(body.pending.length).toBeGreaterThan(0);
    expect(body.skipped.some((s) => s.reason === "MISSING_START_DATE")).toBe(true);
    // Trần chi tiết KHÔNG được im lặng: cờ + tổng thật luôn đi kèm.
    expect(body.pendingTotal).toBe(body.pending.length);
    expect(body.pendingTruncated).toBe(false);
    expect(body.skippedTotal).toBe(body.skipped.length);
    expect(body.skippedTruncated).toBe(false);
    // `userId` là khoá nội bộ để ghi số dư — KHÔNG đi ra ngoài HTTP.
    expect(body.pending.every((p) => p.userId === undefined)).toBe(true);
    // dry-run = KHÔNG tác dụng phụ
    expect(await ledgerRows(http.companyId)).toHaveLength(0);
    expect(await countAudit(http.companyId)).toBe(0);
  });
});
