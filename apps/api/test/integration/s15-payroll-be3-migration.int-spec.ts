import fs from "node:fs";
import path from "node:path";
import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PAYROLL_SYSTEM_COMPONENTS } from "../../src/payroll/payroll-master-data.seeder";
import { directPool, hasDb } from "../helpers/integration-db";
import { seedPayrollCatalog } from "../helpers/payroll-v2-fixtures";
import { cleanupTenants, seedCompany, seedUser } from "../helpers/seed";

/**
 * S15-PAYROLL-BE-3 (mig 0575) — (1) hàng hệ thống `NGHI_KHONG_LUONG` → `earning` công thức ÂM (owner O-5) · (2) CHECK
 * `bonus_penalties_four_eyes_check` (plan §4.1 · §6.2).
 *
 * Replay khối DO của CHÍNH file migration trong `BEGIN … ROLLBACK` cho cả nhánh IF (có hàng hình dạng cũ) lẫn ELSE.
 * Khối preflight (0) chạy với vế (0c) — đếm dòng v2 có fingerprint TOÀN LANE — được GỠ bằng thay chuỗi đã neo: vế đó phụ
 * thuộc spec khác đang chạy song song trên lane, còn nó là một câu đếm hiển nhiên (ca M0 ghim nó CÓ trong file).
 */

type PgErr = { code?: string; constraint?: string; message: string };

const V_OLD = "SYS_BASE_SALARY * SYS_PAY_RATIO / 100 * SYS_UNPAID_LEAVE_DAYS / SYS_WORK_DAYS";
const V_NEW = `-(${V_OLD})`;
const SQL = fs.readFileSync(
  path.join(__dirname, "..", "..", "migrations", "0575_s15payrollbe3_nghi_earning_bp_four_eyes.sql"),
  "utf8",
);
const [PREFLIGHT, PATCH, CHECK, VERIFY] = SQL.split("--> statement-breakpoint");
const FINGERPRINT_GATE = / {2}-- \(0c\)[\s\S]*?END IF;\n/;
/**
 * Vế (0e) đếm ghi đè `NGHI_KHONG_LUONG` TOÀN LANE và đứng TRƯỚC (0f): chạy chunk song song, spec gates (G10) đang ghi đè
 * đúng mã đó trên một mẫu sao chép ⇒ (0e) bắn trước và ca (0f) nhận nhầm thông điệp (đo ở check.sh 15/09).
 */
const OVERRIDE_GATE = / {2}-- \(0e\)[\s\S]*?END IF;\n/;

describe.skipIf(!hasDb)("S15-PAYROLL-BE-3 · mig 0575 — NGHI_KHONG_LUONG earning âm + four-eyes thưởng/phạt", () => {
  const direct = directPool();
  const companies: string[] = [];

  afterAll(async () => {
    await cleanupTenants(direct, companies);
    await direct.end();
  });

  async function company(label: string): Promise<string> {
    const t = await seedCompany(direct, label);
    companies.push(t.companyId);
    return t.companyId;
  }

  /** Chạy `fn` trong transaction LUÔN rollback — replay migration không để lại gì. */
  async function inRollback<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await direct.connect();
    try {
      await c.query("BEGIN");
      return await fn(c);
    } finally {
      await c.query("ROLLBACK").catch(() => undefined);
      c.release();
    }
  }

  async function errorOf(p: Promise<unknown>): Promise<PgErr | null> {
    try {
      await p;
      return null;
    } catch (err) {
      return err as PgErr;
    }
  }

  async function insertSystemNghi(c: PoolClient, companyId: string, kind: string, formula: string): Promise<string> {
    const r = await c.query<{ id: string }>(
      `INSERT INTO salary_components (company_id, code, name, kind, value_type, formula, is_system, is_active, sort_order)
       VALUES ($1, 'NGHI_KHONG_LUONG', 'Nghỉ không lương', $2, 'formula', $3, true, true, 50) RETURNING id`,
      [companyId, kind, formula],
    );
    return r.rows[0].id;
  }

  it("M0 — file có ĐÚNG 4 khối; preflight chứa vế (0c) đếm dòng v2 có fingerprint", () => {
    expect(SQL.split("--> statement-breakpoint")).toHaveLength(4);
    expect(PREFLIGHT).toMatch(FINGERPRINT_GATE);
    expect(PREFLIGHT).toMatch(OVERRIDE_GATE);
    expect(PATCH).toContain("DISABLE TRIGGER salary_component_system_freeze");
    expect(CHECK).toContain("bonus_penalties_four_eyes_check");
    expect(VERIFY).toContain("[0575] verify");
  });

  it("M1 — hằng seeder v4 + công ty seed mới + TOÀN LANE: NGHI_KHONG_LUONG hệ thống = (earning, công thức âm)", async () => {
    const nghi = PAYROLL_SYSTEM_COMPONENTS.find((c) => c.code === "NGHI_KHONG_LUONG");
    expect(nghi).toMatchObject({ kind: "earning", formula: V_NEW });
    const c = await company("be3mig1");
    await seedPayrollCatalog(direct, c);
    const own = await direct.query(
      `SELECT kind, formula FROM salary_components WHERE company_id = $1 AND code = 'NGHI_KHONG_LUONG' AND is_system`,
      [c],
    );
    expect(own.rows).toEqual([{ kind: "earning", formula: V_NEW }]);
    const drift = await direct.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM salary_components
        WHERE is_system AND code = 'NGHI_KHONG_LUONG' AND (kind <> 'earning' OR formula IS DISTINCT FROM $1)`,
      [V_NEW],
    );
    expect(drift.rows[0].n).toBe(0);
  });

  it("M2 — trigger đóng băng BẬT lại · CHECK four-eyes đúng định nghĩa và VALIDATED", async () => {
    const trg = await direct.query(
      `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.salary_components'::regclass
          AND tgname = 'salary_component_system_freeze'`,
    );
    expect(trg.rows).toEqual([{ tgenabled: "O" }]);
    const chk = await direct.query(
      `SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
        WHERE conrelid = 'public.bonus_penalties'::regclass AND conname = 'bonus_penalties_four_eyes_check'`,
    );
    expect(chk.rows).toEqual([
      {
        def: "CHECK (((status <> 'Approved'::text) OR (decided_by IS DISTINCT FROM created_by)))",
        convalidated: true,
      },
    ]);
  });

  it("M3 — CHECK four-eyes: INSERT/UPDATE `Approved` TỰ DUYỆT ⇒ 23514 đúng TÊN; người khác duyệt ⇒ đi qua", async () => {
    const c = await company("be3mig3");
    const author = await seedUser(direct, c, `author@be3mig3.test`, "x");
    const approver = await seedUser(direct, c, `approver@be3mig3.test`, "x");
    const insertApproved = (decider: string) =>
      direct.query(
        `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status, created_by, decided_by, decided_at)
         VALUES ($1, $2, 'bonus', 1000, '2050-01', 'be3 four-eyes', 'Approved', $2, $3, now())`,
        [c, author, decider],
      );
    // ALLOW đứng trước DENY — không có nó, ca DENY xanh-RỖNG với bất kỳ lỗi nào khác của câu INSERT.
    await insertApproved(approver);
    const selfInsert = await errorOf(insertApproved(author));
    expect(selfInsert?.code, selfInsert?.message).toBe("23514");
    expect(selfInsert?.constraint).toBe("bonus_penalties_four_eyes_check");

    const pending = await direct.query<{ id: string }>(
      `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, created_by)
       VALUES ($1, $2, 'bonus', 1000, '2050-01', 'be3 four-eyes', $2) RETURNING id`,
      [c, author],
    );
    const selfUpdate = await errorOf(
      direct.query(
        `UPDATE bonus_penalties SET status = 'Approved', decided_by = $2, decided_at = now() WHERE id = $1`,
        [pending.rows[0].id, author],
      ),
    );
    expect(selfUpdate?.code, selfUpdate?.message).toBe("23514");
    expect(selfUpdate?.constraint).toBe("bonus_penalties_four_eyes_check");
  });

  it("M4 — replay nhánh ELSE (không còn hàng cũ): khối vá · CHECK · verify chạy lại sạch (idempotent)", async () => {
    await inRollback(async (c) => {
      await c.query(PATCH);
      await c.query(CHECK);
      await c.query(VERIFY);
    });
  });

  it("M5 — replay nhánh IF: hàng hệ thống mang hình dạng CŨ ⇒ vá đúng 1 hàng thành (earning, công thức âm), trigger bật lại", async () => {
    const companyId = await company("be3mig5");
    await inRollback(async (c) => {
      const id = await insertSystemNghi(c, companyId, "deduction", V_OLD);
      await c.query(PATCH);
      await c.query(VERIFY);
      const row = await c.query(`SELECT kind, formula FROM salary_components WHERE id = $1`, [id]);
      expect(row.rows).toEqual([{ kind: "earning", formula: V_NEW }]);
      const trg = await c.query(
        `SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.salary_components'::regclass
            AND tgname = 'salary_component_system_freeze'`,
      );
      expect(trg.rows).toEqual([{ tgenabled: "O" }]);
    });
  });

  const preflightWithoutFingerprintGate = PREFLIGHT.replace(FINGERPRINT_GATE, "");

  it("M6 — preflight (0d): hình dạng THỨ BA ⇒ RAISE, KHÔNG tự đè", async () => {
    const companyId = await company("be3mig6");
    await inRollback(async (c) => {
      await insertSystemNghi(c, companyId, "earning", V_OLD);
      const err = await errorOf(c.query(preflightWithoutFingerprintGate));
      expect(err?.message).toMatch(/\[0575\] DUNG: \d+ hang he thong NGHI_KHONG_LUONG mang hinh dang THU BA/);
    });
  });

  it("M7 — preflight (0e): mẫu GHI ĐÈ công thức NGHI_KHONG_LUONG hệ thống ⇒ RAISE (ghi đè dương sẽ CỘNG tiền)", async () => {
    const companyId = await company("be3mig7");
    await inRollback(async (c) => {
      const componentId = await insertSystemNghi(c, companyId, "deduction", V_OLD);
      const tpl = await c.query<{ id: string }>(
        `INSERT INTO payroll_templates (company_id, code, name, scope, is_active) VALUES ($1, 'BE3_MIG7', 'x', 'company', true) RETURNING id`,
        [companyId],
      );
      await c.query(
        `INSERT INTO payroll_template_components (company_id, template_id, component_id, formula_override, is_visible, sort_order)
         VALUES ($1, $2, $3, 'SYS_BASE_SALARY', true, 50)`,
        [companyId, tpl.rows[0].id, componentId],
      );
      const err = await errorOf(c.query(preflightWithoutFingerprintGate));
      // Số đếm là TOÀN LANE (spec khác có thể đang giữ ghi đè cùng mã) — ghim thông điệp, không ghim con số.
      expect(err?.message).toMatch(/\[0575\] DUNG: \d+ mau bang luong ghi de cong thuc NGHI_KHONG_LUONG/);
    });
  });

  it("M8 — preflight (0f): khoản Approved TỰ DUYỆT còn tồn tại ⇒ RAISE kèm số hàng (CHECK chưa thêm được)", async () => {
    const companyId = await company("be3mig8");
    const author = await seedUser(direct, companyId, `author@be3mig8.test`, "x");
    await inRollback(async (c) => {
      await c.query(`ALTER TABLE bonus_penalties DROP CONSTRAINT bonus_penalties_four_eyes_check`);
      await c.query(
        `INSERT INTO bonus_penalties (company_id, user_id, kind, amount, period_month, reason, status, created_by, decided_by, decided_at)
         VALUES ($1, $2, 'bonus', 1000, '2050-01', 'be3 mig8', 'Approved', $2, $2, now())`,
        [companyId, author],
      );
      // Gỡ thêm (0e) — nó đứng trước (0f) và đếm ghi đè TOÀN LANE (xem OVERRIDE_GATE).
      const err = await errorOf(c.query(preflightWithoutFingerprintGate.replace(OVERRIDE_GATE, "")));
      expect(err?.message).toMatch(/\[0575\] DUNG: \d+ khoan thuong\/phat Approved TU DUYET/);
    });
  });
});
