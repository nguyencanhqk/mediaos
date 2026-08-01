/**
 * S6-LEAVE-CARRYOVER-1 — Integration (Postgres THẬT, DB CÔ LẬP) cho engine chuyển tiếp + hết hạn phép.
 *
 * Vùng ĐỎ, và đỏ hơn engine cộng dồn một bậc: engine này có hướng **XOÁ** ngày phép (hết hạn), mà sổ cái
 * là append-only nên không có đường hoàn tác. Spec này không dừng ở "chạy được", nó chứng minh:
 *
 *   BẢO TOÀN     · chuyển = 1 dòng NỢ năm cũ + 1 dòng CÓ năm mới; tổng sổ cái khớp `total_days` từng dòng
 *   CHỐT SỐ Ở DB · xin ghi nợ quá phần khả dụng ⇒ UPDATE đổi 0 dòng, KHÔNG dòng sổ cái nào ra đời
 *   GHI BÙ ĐƯỢC  · từ chối đơn SAU khi đã chuyển ⇒ phần trả về được chuyển nốt ở nhịp sau (đây là ca
 *                  giết thiết kế "một dòng/kỳ" mà vòng review đối kháng đã bác)
 *   APPEND-ONLY  · role app UPDATE/DELETE sổ cái ⇒ bị chặn (BẤT BIẾN #2)
 *   CÔ LẬP TENANT· chạy cho A không đẻ một dòng nào của B (BẤT BIẾN #1)
 *
 * CÔNG TY MỚI CHO MỖI CA (`beforeEach`): `audit_logs` và `leave_balance_transactions` là bảng APPEND-ONLY —
 * fixture "dọn dẹp" sẽ phải xoá đúng hai bảng KHÔNG được phép xoá. Tenant sạch cho ngưỡng đo bằng 0 mà
 * không cần đụng vào chúng.
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
import { DatabaseService } from "../db/db.service";
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
import { LeaveCarryoverRepository } from "./leave-carryover.repository";
import { LeaveCarryoverService } from "./leave-carryover.service";
import { LEAVE_CARRYOVER_JOB_CODE, LeaveCarryoverJobHandler } from "./leave-carryover.job-handler";

const runDb = hasDb && Boolean(process.env.LANE_DB);
const LOGIN_PW = "Passw0rd!test99";

/** Mốc CHỐT SỔ của năm 2026 (01/02/2027) — ngày đầu tiên engine được phép đụng vào số dư năm cũ. */
const SETTLE = "2027-02-01";
/** Một ngày SAU mốc hết hạn mặc định 31/03. */
const AFTER_DEADLINE = "2027-04-01";
/**
 * Năm nguồn mà route dry-run sẽ quét. Route KHÔNG nhận `today` (ngày mốc do server quyết — cùng lý do
 * bảo mật với dry-run của accrual), nên fixture phải bám đồng hồ thật để preview có dòng để soi.
 */
const PREVIEW_SOURCE_YEAR = new Date().getUTCFullYear() - 1;

describe.skipIf(!runDb)("S6-LEAVE-CARRYOVER-1 chuyển tiếp + hết hạn phép (DB cô lập)", () => {
  let app: INestApplication;
  let direct: Pool;
  let carryover: LeaveCarryoverService;
  let repo: LeaveCarryoverRepository;
  let db: DatabaseService;
  let handler: LeaveCarryoverJobHandler;
  /** Tenant CỐ ĐỊNH cho 2 ca HTTP — engine KHÔNG chạy trên nó. */
  let http: SeededTenant;
  let co = "";
  let leaveTypeId = "";
  const companyIds: string[] = [];

  let hrToken = "";
  let noviewToken = "";
  /** Tài khoản có update:leave-policy — dùng cho ca PATCH bán phần (#M5). */
  let adminToken = "";
  let httpTypeId = "";

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
    over: {
      allowCarryForward?: boolean;
      maxCarryForwardDays?: number | null;
      expiryMonth?: number;
      expiryDay?: number;
      accrualMethod?: string;
      quota?: number | null;
      reserveBalanceOnPending?: boolean;
    } = {},
  ): Promise<string> {
    const r = await direct.query(
      `INSERT INTO leave_policies
         (company_id, leave_type_id, policy_code, name, policy_scope, yearly_quota_days,
          accrual_method, effective_from, status, priority,
          allow_carry_forward, max_carry_forward_days, carry_forward_expiry_month,
          carry_forward_expiry_day, reserve_balance_on_pending)
       VALUES ($1,$2,$3,$4,'Company',$5,$6,'2020-01-01','Active',0,$7,$8,$9,$10,$11) RETURNING id`,
      [
        companyId,
        typeId,
        `POL-${randomUUID().slice(0, 8)}`,
        "Chính sách phép năm",
        over.quota === undefined ? 12 : over.quota,
        // Mặc định 'None': engine cộng dồn KHÔNG có kỳ nào chờ ⇒ carry không bị hoãn ACCRUAL_PENDING.
        over.accrualMethod ?? "None",
        over.allowCarryForward ?? true,
        over.maxCarryForwardDays ?? null,
        over.expiryMonth ?? 3,
        over.expiryDay ?? 31,
        over.reserveBalanceOnPending ?? true,
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
      `cry-${randomUUID().slice(0, 8)}@test.local`,
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

  /**
   * Dòng số dư + dòng sổ cái OPENING đối ứng. Có OPENING thì phép đối soát "tổng sổ cái == total_days"
   * (ca #18 của plan) mới có nghĩa — số dư mọc ra từ hư không sẽ làm phép đối soát đó thành vô dụng.
   */
  async function plantBalance(
    companyId: string,
    e: { userId: string; employeeId: string },
    typeId: string,
    year: number,
    over: {
      total?: number;
      used?: number;
      pending?: number;
      carried?: number | null;
      expired?: number | null;
      /** Ngày ghi CÓ của dòng CARRY_OVER giả lập (để test hết hạn mà không phải chạy carry trước). */
      carriedCreditDate?: string;
      /** Bỏ dòng OPENING khi ca test tự dựng lịch sử sổ cái riêng (vd ACCRUAL từng tháng). */
      skipOpening?: boolean;
    } = {},
  ): Promise<string> {
    const total = over.total ?? 12;
    const r = await direct.query(
      `INSERT INTO leave_balances
         (company_id, user_id, employee_id, leave_type_id, year, balance_year, period_start, period_end,
          total_days, used_days, pending_days, carried_over_days, expired_days, granted_days, status)
       VALUES ($1,$2,$3,$4,$5,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Active') RETURNING id`,
      [
        companyId,
        e.userId,
        e.employeeId,
        typeId,
        year,
        `${year}-01-01`,
        `${year}-12-31`,
        total,
        over.used ?? 0,
        over.pending ?? 0,
        over.carried ?? null,
        over.expired ?? null,
        total,
      ],
    );
    const balanceId = r.rows[0].id as string;
    const opening = total - (over.carried ?? 0);
    if (opening !== 0 && over.skipOpening !== true) {
      await direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
            transaction_date, amount_days, created_by_type)
         VALUES ($1,$2,$3,$4,'OPENING',$5,$6,'System')`,
        [companyId, balanceId, e.employeeId, typeId, `${year}-01-01`, opening],
      );
    }
    if (over.carried != null && over.carried > 0) {
      await direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
            transaction_date, amount_days, created_by_type)
         VALUES ($1,$2,$3,$4,'CARRY_OVER',$5,$6,'Job')`,
        [
          companyId,
          balanceId,
          e.employeeId,
          typeId,
          over.carriedCreditDate ?? `${year}-02-01`,
          over.carried,
        ],
      );
    }
    return balanceId;
  }

  async function ledgerRows(companyId: string, type?: string) {
    const r = await direct.query(
      `SELECT leave_balance_id, employee_id, transaction_date::text AS d, amount_days::float AS amt,
              balance_before_days::float AS before_d, balance_after_days::float AS after_d,
              transaction_type, created_by_type, reason
         FROM leave_balance_transactions
        WHERE company_id=$1 ${type ? "AND transaction_type=$2" : ""}
        ORDER BY transaction_date, amount_days`,
      type ? [companyId, type] : [companyId],
    );
    return r.rows as {
      leave_balance_id: string;
      employee_id: string;
      d: string;
      amt: number;
      before_d: number;
      after_d: number;
      transaction_type: string;
      created_by_type: string;
      reason: string;
    }[];
  }

  async function balanceOf(companyId: string, userId: string, typeId: string, year: number) {
    const r = await direct.query(
      `SELECT id, total_days::float AS total, used_days::float AS used,
              pending_days::float AS pending, remaining_days::float AS remaining,
              carried_over_days::float AS carried, expired_days::float AS expired
         FROM leave_balances
        WHERE company_id=$1 AND user_id=$2 AND leave_type_id=$3 AND year=$4`,
      [companyId, userId, typeId, year],
    );
    return r.rows[0] as
      | {
          id: string;
          total: number;
          used: number;
          pending: number | null;
          remaining: number;
          carried: number | null;
          expired: number | null;
        }
      | undefined;
  }

  async function countAudit(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM audit_logs WHERE company_id=$1 AND action='leave_carryover_run'`,
      [companyId],
    );
    return r.rows[0].n as number;
  }

  async function countLedger(companyId: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int n FROM leave_balance_transactions WHERE company_id=$1`,
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
    return { companyId: t.companyId, typeId };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    carryover = app.get(LeaveCarryoverService);
    repo = app.get(LeaveCarryoverRepository);
    db = app.get(DatabaseService);
    handler = app.get(LeaveCarryoverJobHandler);

    direct = directPool();
    http = await seedCompany(direct, "lvcryhttp");
    companyIds.push(http.companyId);
    // Tenant HTTP phải có DỮ LIỆU THẬT để dry-run trả về dòng: một preview rỗng làm mọi assertion về
    // "không lộ userId" thành vô nghĩa (mảng rỗng thì xoá hẳn đoạn strip đi test vẫn xanh).
    const httpType = await plantType(http.companyId, `ANNUAL-HTTP-${randomUUID().slice(0, 6)}`);
    httpTypeId = httpType;
    await plantPolicy(http.companyId, httpType);
    const httpEmp = await plantEmployee(http.companyId);
    await plantBalance(http.companyId, httpEmp, httpType, PREVIEW_SOURCE_YEAR, { total: 12 });

    const hrId = await seedUser(direct, http.companyId, `hr@${http.slug}.test`, await hash());
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3)`,
      [http.companyId, hrId, `HR-${hrId.slice(0, 8)}`],
    );
    const roleId = await seedRole(direct, http.companyId, `cry-hr-${hrId.slice(0, 8)}`);
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

    const adminId = await seedUser(direct, http.companyId, `padm@${http.slug}.test`, await hash());
    await direct.query(
      `INSERT INTO employee_profiles (company_id, user_id, employee_code) VALUES ($1,$2,$3)`,
      [http.companyId, adminId, `PA-${adminId.slice(0, 8)}`],
    );
    const adminRole = await seedRole(direct, http.companyId, `cry-padm-${adminId.slice(0, 8)}`);
    const updPerm = await seedPermissionCatalog(direct, "update", "leave-policy", true);
    await seedRolePermission(direct, adminRole, updPerm, "ALLOW", "Company");
    await seedUserRole(direct, adminId, adminRole, http.companyId);
    adminToken = await login(http.slug, `padm@${http.slug}.test`);
  }, 90_000);

  beforeEach(async () => {
    const t = await freshTenant("lvcry");
    co = t.companyId;
    leaveTypeId = t.typeId;
  });

  afterAll(async () => {
    await app?.close();
    if (direct) await cleanupTenants(direct, companyIds);
  }, 60_000);

  // ── CHUYỂN TIẾP: bảo toàn + idempotent ─────────────────────────────────────

  it("#1 chuyển đúng: NỢ năm cũ + CÓ năm mới, tổng bảo toàn, sổ cái khớp từng dòng số dư", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    const run = await carryover.runCompany(co, SETTLE);
    expect(run.carried).toBe(1);
    expect(run.carriedDays).toBe(12);
    expect(run.failed).toBe(0);

    const before = await balanceOf(co, e.userId, leaveTypeId, 2026);
    const after = await balanceOf(co, e.userId, leaveTypeId, 2027);
    expect(before?.total).toBe(0);
    expect(after?.total).toBe(12);
    expect(after?.carried).toBe(12);
    // `remaining_days` là cột GENERATED — đây là con số đường đặt đơn thật sự đọc.
    expect(after?.remaining).toBe(12);

    const rows = await ledgerRows(co, "CARRY_OVER");
    expect(rows).toHaveLength(2);
    const debit = rows.find((r) => r.amt < 0);
    const credit = rows.find((r) => r.amt > 0);
    expect(debit?.leave_balance_id).toBe(src);
    expect(credit?.leave_balance_id).toBe(after?.id);
    // Hai chân CÙNG NGÀY (ngày phát hiện), KHÁC dòng số dư ⇒ không đụng khoá uq_..._carryover_daily.
    expect(debit?.d).toBe(SETTLE);
    expect(credit?.d).toBe(SETTLE);
    expect(debit?.amt).toBe(-12);
    expect(credit?.amt).toBe(12);
    expect(debit?.reason).toBe("CARRY_OVER 2026→2027");
    expect(rows.every((r) => r.created_by_type === "Job")).toBe(true);

    // Đối soát: tổng sổ cái của MỖI dòng số dư phải bằng đúng `total_days` của nó.
    for (const balanceId of [src, after?.id]) {
      const sum = await direct.query(
        `SELECT COALESCE(SUM(amount_days),0)::float s FROM leave_balance_transactions
          WHERE company_id=$1 AND leave_balance_id=$2`,
        [co, balanceId],
      );
      const bal = await direct.query(`SELECT total_days::float t FROM leave_balances WHERE id=$1`, [
        balanceId,
      ]);
      expect(sum.rows[0].s).toBe(bal.rows[0].t);
    }
  });

  it("#2 chạy N lần trong CÙNG ngày ⇒ chỉ lần đầu chuyển; số dư và sổ cái ĐỨNG YÊN", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    expect((await carryover.runCompany(co, SETTLE)).carried).toBe(1);
    const ledgerAfterFirst = await countLedger(co);

    for (let i = 0; i < 4; i += 1) {
      const again = await carryover.runCompany(co, SETTLE);
      expect(again.carried, `lần chạy ${i + 2}`).toBe(0);
      expect(again.failed, `lần chạy ${i + 2}`).toBe(0);
    }
    expect(await countLedger(co)).toBe(ledgerAfterFirst);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(12);
  });

  it("#3 CHỐT SỐ Ở DB: xin ghi nợ quá phần khả dụng ⇒ UPDATE đổi 0 dòng (app sai cũng không lọt)", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 12, used: 4, pending: 3 });

    await db.withTenant(co, async (tx) => {
      // khả dụng = 12 − 4 − 3 = 5
      const tooMuch = await repo.applyCarryDebitTx(co, src, "5.1", tx);
      expect(tooMuch).toHaveLength(0);
      // Số lẻ 2 chữ số bị chặn TRƯỚC khi chạm DB: `total_days` là numeric(5,1) nên nó sẽ làm tròn trong
      // khi cột phân rã numeric(8,2) thì không ⇒ sổ và số dư lệch dần mà không ai báo.
      await expect(repo.applyCarryDebitTx(co, src, "5.01", tx)).rejects.toThrow(
        /1 chữ số thập phân/,
      );
      const ok = await repo.applyCarryDebitTx(co, src, "5.0", tx);
      expect(ok).toHaveLength(1);
    });
    // Ràng buộc chặn TRƯỚC khi có bất kỳ dòng sổ cái nào — số dư giảm đúng phần hợp lệ.
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(7);
    expect(await ledgerRows(co, "CARRY_OVER")).toHaveLength(0);
  });

  it("#4 CHỐT TRÙNG-TRONG-NGÀY: INSERT tay dòng CARRY_OVER/EXPIRE trùng (company,balance,ngày) ⇒ vỡ unique", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });
    await carryover.runCompany(co, SETTLE);

    await expect(
      direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
            transaction_date, amount_days, created_by_type)
         VALUES ($1,$2,$3,$4,'CARRY_OVER',$5,-1,'Job')`,
        [co, src, e.employeeId, leaveTypeId, SETTLE],
      ),
    ).rejects.toThrow(/uq_leave_balance_tx_carryover_daily|duplicate key/i);

    await direct.query(
      `INSERT INTO leave_balance_transactions
         (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
          transaction_date, amount_days, created_by_type)
       VALUES ($1,$2,$3,$4,'EXPIRE',$5,-1,'Job')`,
      [co, src, e.employeeId, leaveTypeId, AFTER_DEADLINE],
    );
    await expect(
      direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
            transaction_date, amount_days, created_by_type)
         VALUES ($1,$2,$3,$4,'EXPIRE',$5,-1,'Job')`,
        [co, src, e.employeeId, leaveTypeId, AFTER_DEADLINE],
      ),
    ).rejects.toThrow(/uq_leave_balance_tx_expire_daily|duplicate key/i);
  });

  it("#5 GHI BÙ: từ chối đơn SAU khi đã chuyển ⇒ phần trả về được chuyển nốt ở nhịp sau", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 12, pending: 3 });

    // Lần 1: pending 3 bị loại ⇒ chỉ chuyển 9.
    expect((await carryover.runCompany(co, SETTLE)).carriedDays).toBe(9);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(3);

    // Quản lý TỪ CHỐI đơn ⇒ `pending_days` được trả về (leave-approval.service.ts releaseReserve).
    await direct.query(`UPDATE leave_balances SET pending_days = 0 WHERE id=$1`, [src]);

    const second = await carryover.runCompany(co, "2027-02-02");
    expect(second.carriedDays).toBe(3);
    expect(second.failed).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(12);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.carried).toBe(12);
    // 4 dòng CARRY_OVER: 2 chân lần đầu + 2 chân dòng bù, ngày khác nhau ⇒ không đụng khoá.
    expect(await ledgerRows(co, "CARRY_OVER")).toHaveLength(4);
  });

  it("#5b GHI BÙ TRONG NGÀY: hoãn sang mai, KHÔNG đâm khoá và KHÔNG đếm failed", async () => {
    // Ca này giết cách vá ngây thơ: nếu engine cứ lên kế hoạch khi số khả dụng tăng lại trong ngày, mỗi
    // nhịp 60 giây sẽ vỡ `uq_..._carryover_daily` ⇒ ~1440 run 'Failed' + 1440 dòng ERROR tới nửa đêm UTC.
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 12, pending: 3 });

    expect((await carryover.runCompany(co, SETTLE)).carriedDays).toBe(9);
    await direct.query(`UPDATE leave_balances SET pending_days = 0 WHERE id=$1`, [src]);

    const sameDay = await carryover.runCompany(co, SETTLE);
    expect(sameDay.failed).toBe(0);
    expect(sameDay.carried).toBe(0);
    expect(sameDay.preview.skipped.map((s) => s.reason)).toContain("ALREADY_WROTE_TODAY");
    expect(await ledgerRows(co, "CARRY_OVER")).toHaveLength(2);

    // Hôm sau: chuyển nốt, đúng như cơ chế ghi bù.
    expect((await carryover.runCompany(co, "2027-02-02")).carriedDays).toBe(3);
  });

  it("#H2 carried_over_days có số mà KHÔNG có dòng sổ cái ⇒ BÁO CARRIED_NO_LEDGER, không xoá liều", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    // Nhập tay/import: có `carried_over_days` nhưng KHÔNG dòng CARRY_OVER nào ⇒ engine không biết ngày
    // ghi có, nên không biết mốc nào áp dụng. Đoán = xoá nhầm quyền lợi vĩnh viễn.
    await direct.query(
      `INSERT INTO leave_balances
         (company_id, user_id, employee_id, leave_type_id, year, balance_year,
          total_days, used_days, carried_over_days, status)
       VALUES ($1,$2,$3,$4,2027,2027,17,0,5,'Active')`,
      [co, e.userId, e.employeeId, leaveTypeId],
    );

    const run = await carryover.runCompany(co, AFTER_DEADLINE);
    expect(run.expired).toBe(0);
    expect(run.preview.skipped.map((s) => s.reason)).toContain("CARRIED_NO_LEDGER");
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(17);
  });

  it("#H1 dòng số dư NGOÀI cửa sổ quét được ĐẾM ra (không im lặng biến mất)", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2024, { total: 8 });
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    const run = await carryover.runCompany(co, SETTLE);
    // 2024 nằm ngoài [2026, 2027] ⇒ engine không xử lý được, nhưng PHẢI hiện ra thành một con số.
    expect(run.preview.strandedBalances).toBe(1);
    expect(run.preview.policiesWithCarryForward).toBe(1);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2024))?.total).toBe(8);
  });

  it("#H4 MỌI dòng đều hỏng ⇒ VẪN ghi 1 dòng audit (lần chạy hỏng toàn bộ không được im lặng)", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });
    // Dòng số dư năm ĐÍCH đã soft-delete ⇒ ghi có không thể thực hiện ⇒ dòng kế hoạch duy nhất HỎNG.
    await direct.query(
      `INSERT INTO leave_balances
         (company_id, user_id, employee_id, leave_type_id, year, balance_year, total_days, used_days, status, deleted_at)
       VALUES ($1,$2,$3,$4,2027,2027,0,0,'Active', now())`,
      [co, e.userId, e.employeeId, leaveTypeId],
    );

    const run = await carryover.runCompany(co, SETTLE);
    expect(run.failed).toBe(1);
    expect(run.carried).toBe(0);
    expect(await countAudit(co)).toBe(1);
    const r = await direct.query(
      `SELECT result_status FROM audit_logs WHERE company_id=$1 AND action='leave_carryover_run'`,
      [co],
    );
    expect(r.rows[0].result_status).toBe("Failure");
    // Không ghi nợ nửa vời: số dư nguồn phải NGUYÊN VẸN sau khi SAVEPOINT rollback.
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(12);
    expect(await ledgerRows(co, "CARRY_OVER")).toHaveLength(0);
  });

  it("#6 APPEND-ONLY: role app UPDATE/DELETE dòng CARRY_OVER ⇒ bị chặn; số dòng chỉ TĂNG", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });
    const beforeCount = await countLedger(co);
    await carryover.runCompany(co, SETTLE);
    expect(await countLedger(co)).toBeGreaterThan(beforeCount);

    const client = await appPool().connect();
    try {
      await client.query(`SELECT set_config('app.current_company_id', $1, false)`, [co]);
      await expect(
        client.query(
          `UPDATE leave_balance_transactions SET amount_days = 99 WHERE company_id=$1 AND transaction_type='CARRY_OVER'`,
          [co],
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        client.query(
          `DELETE FROM leave_balance_transactions WHERE company_id=$1 AND transaction_type='CARRY_OVER'`,
          [co],
        ),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      client.release();
    }
  });

  it("#7 TRẦN: max_carry_forward_days = 3 với khả dụng 7 ⇒ chuyển 3, năm cũ giữ 4", async () => {
    await plantPolicy(co, leaveTypeId, { maxCarryForwardDays: 3 });
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 7 });

    expect((await carryover.runCompany(co, SETTLE)).carriedDays).toBe(3);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(4);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(3);
  });

  it("#7b TRẦN không được cấp lại ở dòng bù", async () => {
    await plantPolicy(co, leaveTypeId, { maxCarryForwardDays: 3 });
    const e = await plantEmployee(co);
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 12, pending: 9 });

    expect((await carryover.runCompany(co, SETTLE)).carriedDays).toBe(3);
    await direct.query(`UPDATE leave_balances SET pending_days = 0 WHERE id=$1`, [src]);
    // Còn 9 ngày khả dụng nhưng TRẦN đã dùng hết ⇒ nhịp sau chuyển 0.
    expect((await carryover.runCompany(co, "2027-02-02")).carriedDays).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(3);
  });

  // ── HẾT HẠN ────────────────────────────────────────────────────────────────

  it("#8 ĐÚNG ngày mốc chưa hết hạn; SAU mốc mới xoá, và số khả dụng giảm theo", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2027, { total: 17, carried: 5 });

    expect((await carryover.runCompany(co, "2027-03-31")).expired).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(17);

    const run = await carryover.runCompany(co, AFTER_DEADLINE);
    expect(run.expired).toBe(1);
    expect(run.expiredDays).toBe(5);
    const bal = await balanceOf(co, e.userId, leaveTypeId, 2027);
    expect(bal?.total).toBe(12);
    expect(bal?.expired).toBe(5);
    expect(bal?.remaining).toBe(12);

    const rows = await ledgerRows(co, "EXPIRE");
    expect(rows).toHaveLength(1);
    expect(rows[0].amt).toBe(-5);
    expect(rows[0].d).toBe(AFTER_DEADLINE);
    expect(rows[0].reason).toBe("EXPIRE 2027-03-31");
  });

  it("#8b FIFO: đã dùng nhiều hơn phần chuyển ⇒ KHÔNG có gì hết hạn", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2027, { total: 17, carried: 5, used: 6 });

    expect((await carryover.runCompany(co, AFTER_DEADLINE)).expired).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(17);
  });

  it("#9 HAI năm số dư quá hạn trong MỘT nhịp ⇒ 2 dòng EXPIRE, không đụng khoá", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, {
      total: 3,
      carried: 3,
      carriedCreditDate: "2026-02-01",
    });
    await plantBalance(co, e, leaveTypeId, 2027, {
      total: 5,
      carried: 5,
      carriedCreditDate: "2027-02-01",
    });

    const run = await carryover.runCompany(co, AFTER_DEADLINE);
    expect(run.expired).toBe(2);
    expect(run.expiredDays).toBe(8);
    expect(run.failed).toBe(0);
    // Năm cũ đã bị dọn sạch ⇒ KHÔNG còn gì để chuyển tiếp (hai bước không đá nhau trên cùng ảnh chụp).
    expect(run.carried).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(0);
    expect(await ledgerRows(co, "EXPIRE")).toHaveLength(2);
  });

  it("#10 NĂM NHUẬN: mốc 29/02 ⇒ 29/02/2028 chưa hết hạn, 01/03/2028 thì có", async () => {
    await plantPolicy(co, leaveTypeId, { expiryMonth: 2, expiryDay: 29 });
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2028, {
      total: 5,
      carried: 5,
      carriedCreditDate: "2028-01-05",
    });

    expect((await carryover.runCompany(co, "2028-02-29")).expired).toBe(0);
    const run = await carryover.runCompany(co, "2028-03-01");
    expect(run.expiredDays).toBe(5);
    expect((await ledgerRows(co, "EXPIRE"))[0].reason).toBe("EXPIRE 2028-02-29");
  });

  it("#10b BẬT CÔNG TẮC MUỘN: ngày chuyển vào SAU mốc KHÔNG bị mốc đó xoá", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    // Owner bật chuyển tiếp ngày 01/06/2027 — đã qua mốc 31/03/2027 từ lâu.
    const run = await carryover.runCompany(co, "2027-06-01");
    expect(run.carriedDays).toBe(12);
    expect(run.expiredDays).toBe(0);
    // Nhịp kế (60 giây sau) KHÔNG được xoá sạch 12 ngày vừa chuyển.
    const next = await carryover.runCompany(co, "2027-06-01");
    expect(next.expiredDays).toBe(0);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2027))?.total).toBe(12);
  });

  it("#17 tắt công tắc SAU khi đã chuyển ⇒ hết hạn VẪN chạy (không để ngày sống mãi)", async () => {
    const policyId = await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2027, { total: 17, carried: 5 });
    await direct.query(`UPDATE leave_policies SET allow_carry_forward = false WHERE id=$1`, [
      policyId,
    ]);

    expect((await carryover.runCompany(co, AFTER_DEADLINE)).expiredDays).toBe(5);
  });

  // ── ĐIỀU KIỆN VÀO / BỎ QUA ─────────────────────────────────────────────────

  it("#BS chưa tới mốc chốt sổ (tháng 1) ⇒ KHÔNG đụng số dư năm cũ, báo BEFORE_SETTLEMENT", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    const run = await carryover.runCompany(co, "2027-01-31");
    expect(run.carried).toBe(0);
    expect(run.preview.skipped.map((s) => s.reason)).toContain("BEFORE_SETTLEMENT");
    // Đơn nghỉ lùi ngày tháng 12 vẫn còn nguyên số dư để tiêu.
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(12);
  });

  it("#11 duyệt đơn SAU khi chuyển vẫn thành công (không vỡ CHECK used_days <= total_days)", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 12, pending: 3 });

    await carryover.runCompany(co, SETTLE);
    // Đơn 3 ngày được duyệt: pending → used trên dòng năm cũ.
    await expect(
      direct.query(
        `UPDATE leave_balances SET used_days = used_days + 3, pending_days = 0 WHERE id=$1`,
        [src],
      ),
    ).resolves.toBeTruthy();
    const bal = await balanceOf(co, e.userId, leaveTypeId, 2026);
    expect(bal?.total).toBe(3);
    expect(bal?.used).toBe(3);
    expect(bal?.remaining).toBe(0);
  });

  it("#12 nghỉ việc TRƯỚC năm mới ⇒ EMPLOYEE_LEFT, không chuyển", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co, { endDate: "2026-06-30", status: "resigned" });
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    const run = await carryover.runCompany(co, SETTLE);
    expect(run.carried).toBe(0);
    expect(run.preview.skipped.map((s) => s.reason)).toContain("EMPLOYEE_LEFT");
    expect(await balanceOf(co, e.userId, leaveTypeId, 2027)).toBeUndefined();
  });

  it("#RD reserve_balance_on_pending = false ⇒ RESERVE_DISABLED (số khả dụng không đáng tin)", async () => {
    await plantPolicy(co, leaveTypeId, { reserveBalanceOnPending: false });
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    const run = await carryover.runCompany(co, SETTLE);
    expect(run.carried).toBe(0);
    expect(run.preview.skipped.map((s) => s.reason)).toContain("RESERVE_DISABLED");
  });

  it("#13 ACCRUAL_PENDING: engine cộng dồn còn nợ tháng 12 ⇒ HOÃN; cấp xong rồi mới chuyển ĐỦ", async () => {
    // Đúng cuộc đua ở giao thừa: 11 tháng đã cấp, THÁNG 12 CHƯA. Chuyển ngay lúc này sẽ ra số THIẾU 1
    // ngày, và ngày đó nằm lại dòng năm cũ. Engine phải tự hoãn tới khi accrual xong.
    await plantPolicy(co, leaveTypeId, { accrualMethod: "Monthly", quota: 12 });
    const e = await plantEmployee(co, { startDate: "2020-05-10" });
    const src = await plantBalance(co, e, leaveTypeId, 2026, { total: 11, skipOpening: true });
    for (const d of [
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
    ]) {
      await direct.query(
        `INSERT INTO leave_balance_transactions
           (company_id, leave_balance_id, employee_id, leave_type_id, transaction_type,
            transaction_date, amount_days, created_by_type)
         VALUES ($1,$2,$3,$4,'ACCRUAL',$5,1,'Job')`,
        [co, src, e.employeeId, leaveTypeId, d],
      );
    }

    const held = await carryover.runCompany(co, SETTLE);
    expect(held.carried).toBe(0);
    expect(held.preview.skipped.map((s) => s.reason)).toContain("ACCRUAL_PENDING");
    expect(await ledgerRows(co, "CARRY_OVER")).toHaveLength(0);

    // Engine cộng dồn cấp nốt tháng 12/2026 rồi mới tới lượt chuyển tiếp.
    const accrual = app.get((await import("./leave-accrual.service")).LeaveAccrualService);
    await accrual.runCompany(co, SETTLE);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(12);

    const done = await carryover.runCompany(co, SETTLE);
    // ĐỦ 12 — gồm cả ngày của tháng 12 suýt bị bỏ lại.
    expect(done.carriedDays).toBe(12);
    expect((await balanceOf(co, e.userId, leaveTypeId, 2026))?.total).toBe(0);
  });

  it("#14 CÔ LẬP TENANT: chạy cho A không đẻ một dòng nào của B", async () => {
    await plantPolicy(co, leaveTypeId);
    const ea = await plantEmployee(co);
    await plantBalance(co, ea, leaveTypeId, 2026, { total: 12 });

    const b = await freshTenant("lvcryB");
    await plantPolicy(b.companyId, b.typeId);
    const eb = await plantEmployee(b.companyId);
    await plantBalance(b.companyId, eb, b.typeId, 2026, { total: 12 });
    const bLedgerBefore = await countLedger(b.companyId);

    await carryover.runCompany(co, SETTLE);

    expect(await countLedger(b.companyId)).toBe(bLedgerBefore);
    expect(await balanceOf(b.companyId, eb.userId, b.typeId, 2027)).toBeUndefined();
    expect((await balanceOf(b.companyId, eb.userId, b.typeId, 2026))?.total).toBe(12);
  });

  // ── AUDIT · JOB · HTTP ─────────────────────────────────────────────────────

  it("#16 audit: không có gì đổi ⇒ 0 dòng; có đổi ⇒ đúng 1 dòng, metadata CHỈ số đếm", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    await carryover.runCompany(co, "2027-01-15"); // chưa chốt sổ ⇒ không đổi gì
    expect(await countAudit(co)).toBe(0);

    await carryover.runCompany(co, SETTLE);
    expect(await countAudit(co)).toBe(1);

    const r = await direct.query(
      `SELECT metadata FROM audit_logs WHERE company_id=$1 AND action='leave_carryover_run'`,
      [co],
    );
    const meta = r.rows[0].metadata as Record<string, unknown>;
    expect(meta.carried).toBe(1);
    expect(meta.carriedDays).toBe(12);
    // BẤT BIẾN #3 — không PII: không tên, không mã nhân viên, không danh sách người.
    const asText = JSON.stringify(meta);
    expect(asText).not.toContain(e.employeeId);
    expect(asText).not.toContain(e.userId);

    await carryover.runCompany(co, SETTLE); // no-op ⇒ KHÔNG đẻ thêm dòng audit
    expect(await countAudit(co)).toBe(1);
  });

  it("job handler đăng ký đúng jobCode và trả metadata đếm được", async () => {
    await plantPolicy(co, leaveTypeId);
    const e = await plantEmployee(co);
    await plantBalance(co, e, leaveTypeId, 2026, { total: 12 });

    // Hai nửa của hợp đồng đăng ký. Thiếu metadata ⇒ DiscoveryService không gom ⇒ job KHÔNG BAO GIỜ
    // chạy mà cũng không có lỗi nào — đúng kiểu im lặng WO này đi vá, chỉ dịch xuống tầng hạ tầng.
    expect(handler.jobCode).toBe(LEAVE_CARRYOVER_JOB_CODE);
    expect(Reflect.getMetadata(SYSTEM_JOB_HANDLER, LeaveCarryoverJobHandler)).toBe(true);

    // `run()` KHÔNG nhận ngày (ngày mốc do server quyết) ⇒ ở đây chỉ chứng minh phần NỐI DÂY: chạy sạch,
    // không lỗi, và trả metadata đọc được. Nghiệp vụ theo mốc thời gian đã do các ca bơm `today` phía
    // trên phủ — thà nói rõ ranh giới còn hơn giả vờ ca này kiểm được cả hai.
    const res = await handler.run({ companyId: co });
    expect(res.failed).toBe(0);
    const meta = res.metadata as { sourceYear: number; targetYear: number; today: string };
    expect(meta.targetYear).toBe(Number(meta.today.slice(0, 4)));
    expect(meta.sourceYear).toBe(meta.targetYear - 1);
  });

  it("#M5 PATCH bán phần KHÔNG lách được luật mốc: validate trên TRẠNG THÁI ĐÃ HOÀ", async () => {
    // Chính sách đã bật chuyển tiếp với mốc 31/03. PATCH chỉ đổi THÁNG sang 2 ⇒ hoà lại thành 31/02 —
    // qua được cả refine ở Zod (body không có `allowCarryForward`) lẫn CHECK ở DB (31 vẫn BETWEEN 1 AND 31),
    // rồi engine lặng lẽ cắt về 28/02. HR khai một mốc, hệ thống xoá phép theo mốc khác.
    const policyId = await plantPolicy(http.companyId, httpTypeId, {
      allowCarryForward: true,
      expiryMonth: 3,
      expiryDay: 31,
    });
    const res = await request(app.getHttpServer())
      .patch(`/leave/admin/policies/${policyId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ carryForwardExpiryMonth: 2 });
    expect(res.status).toBe(422);
    expect(res.body.error?.code ?? res.body.code).toBe("LEAVE-ERR-CARRY-FORWARD-INVALID");

    // Dòng trong DB KHÔNG được đổi.
    const after = await direct.query(
      `SELECT carry_forward_expiry_month m, carry_forward_expiry_day d FROM leave_policies WHERE id=$1`,
      [policyId],
    );
    expect(after.rows[0]).toMatchObject({ m: 3, d: 31 });
  });

  it("#15 DENY-PATH: GET /leave/admin/carryover/preview không có view:leave-balance ⇒ 403", async () => {
    const res = await request(app.getHttpServer())
      .get("/leave/admin/carryover/preview")
      .set("Authorization", `Bearer ${noviewToken}`);
    expect(res.status).toBe(403);
  });

  it("HTTP dry-run: có quyền ⇒ 200, KHÔNG ghi gì, và KHÔNG lộ userId ra ngoài", async () => {
    const before = await countLedger(http.companyId);
    const res = await request(app.getHttpServer())
      .get("/leave/admin/carryover/preview")
      .set("Authorization", `Bearer ${hrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty("sourceYear");
    expect(res.body.data).toHaveProperty("skippedTotal");
    // Có dòng THẬT trong `pending` thì assertion dưới mới có gì để hỏng (xem fixture ở beforeAll).
    expect(res.body.data.pendingTotal).toBeGreaterThan(0);
    expect(JSON.stringify(res.body.data)).not.toContain("userId");
    expect(await countLedger(http.companyId)).toBe(before);
    expect(await countAudit(http.companyId)).toBe(0);
  });
});
