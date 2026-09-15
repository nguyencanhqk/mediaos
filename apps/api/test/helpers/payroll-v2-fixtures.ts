import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { DatabaseService } from "../../src/db/db.service";
import { MasterDataSeedRunner } from "../../src/foundation/seed/master-data-seed-runner.service";
import { MasterDataSeederRegistry } from "../../src/foundation/seed/master-data-seeder.registry";
import { SeedTrackingService } from "../../src/foundation/seed/seed-tracking.service";
import {
  PAYROLL_DEFAULT_TEMPLATE_CODE,
  PayrollMasterDataSeeder,
} from "../../src/payroll/payroll-master-data.seeder";
import {
  PAYROLL_ROUTE_PAIRS,
  type PayrollRouteKey,
} from "../../src/payroll/payroll-route-pairs.const";
import { seedPermissionCatalog, seedRole, seedRolePermission, seedUserRole } from "./seed";

/**
 * S15-PAYROLL-BE-3 — owner O-1 (15/09/2026): kỳ CHƯA gắn mẫu ⇒ `calculate` 409 PAYROLL-ERR-023 `template-missing`,
 * KHÔNG còn đường công thức v1. Mọi int-spec gọi `calculate` PHẢI (1) seed catalog PAYROLL cho công ty — seeder chạy
 * RUNTIME và bootstrap tắt khi `NODE_ENV=test` — rồi (2) gắn `MAU_MAC_DINH` vào kỳ.
 */

let runner: MasterDataSeedRunner | null = null;

function payrollSeedRunner(): MasterDataSeedRunner {
  if (!runner) {
    const dbsvc = new DatabaseService();
    const registry = new MasterDataSeederRegistry();
    registry.register(new PayrollMasterDataSeeder());
    runner = new MasterDataSeedRunner(dbsvc, new SeedTrackingService(dbsvc), registry);
  }
  return runner;
}

/**
 * Seed catalog + bản tỉ lệ + mẫu mặc định cho MỘT công ty; trả id `MAU_MAC_DINH` do seeder tạo. Runner NUỐT throw
 * của seeder (batch Failed) ⇒ ở đây NÉM tường minh, kẻo fixture «đã seed» mà thật ra rỗng (xanh-rỗng ở ca tính).
 */
export async function seedPayrollCatalog(direct: Pool, companyId: string): Promise<string> {
  const outcomes = await payrollSeedRunner().reconcileCompany(companyId);
  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length > 0) {
    throw new Error(
      `seedPayrollCatalog: seeder PAYROLL lỗi cho company=${companyId} — ${failed
        .map((o) => o.error ?? o.seedKey)
        .join(" | ")}`,
    );
  }
  const r = await direct.query<{ id: string }>(
    `SELECT id FROM payroll_templates
      WHERE company_id = $1 AND code = $2 AND deleted_at IS NULL AND created_by IS NULL`,
    [companyId, PAYROLL_DEFAULT_TEMPLATE_CODE],
  );
  if (r.rows.length !== 1) {
    throw new Error(
      `seedPayrollCatalog: không thấy đúng MỘT mẫu ${PAYROLL_DEFAULT_TEMPLATE_CODE} (company=${companyId})`,
    );
  }
  return r.rows[0].id;
}

/**
 * Đặt định mức MỘT item hồ sơ (`component_code`) cho hồ sơ lương SỐNG của nhân sự — thay cho `allowances` jsonb của v1
 * (mã `PC_nnn` mirror ngoài mẫu ⇒ 422 018 `profile-item-unknown-component` ở v2, plan §3.8). Item cũ cùng mã xoá MỀM.
 */
export async function setProfileItem(
  direct: Pool,
  companyId: string,
  userId: string,
  componentCode: string,
  amount: string,
): Promise<void> {
  await direct.query(
    `UPDATE salary_profile_items spi
        SET deleted_at = now()
       FROM salary_profiles sp
      WHERE sp.company_id = $1 AND sp.user_id = $2 AND sp.deleted_at IS NULL
        AND spi.company_id = sp.company_id AND spi.salary_profile_id = sp.id
        AND spi.component_code = $3 AND spi.deleted_at IS NULL`,
    [companyId, userId, componentCode],
  );
  const r = await direct.query(
    `INSERT INTO salary_profile_items (company_id, salary_profile_id, component_code, amount, is_active)
     SELECT sp.company_id, sp.id, $3, $4::numeric, true
       FROM salary_profiles sp
      WHERE sp.company_id = $1 AND sp.user_id = $2 AND sp.deleted_at IS NULL`,
    [companyId, userId, componentCode, amount],
  );
  if ((r.rowCount ?? 0) === 0) {
    throw new Error(
      `setProfileItem: nhân sự ${userId} không có hồ sơ lương sống (company=${companyId})`,
    );
  }
}

/** Cấp MỌI cặp route PAYROLL (đúng cờ `isSensitive` của bảng route) ở scope Company cho một người dùng. */
export async function grantAllPayrollPairs(
  direct: Pool,
  companyId: string,
  userId: string,
  label: string,
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `${label}-${randomUUID().slice(0, 6)}`);
  const pairs = new Map(
    Object.values(PAYROLL_ROUTE_PAIRS).map((p) => [`${p.action}:${p.resourceType}`, p] as const),
  );
  for (const p of pairs.values()) {
    const permId = await seedPermissionCatalog(direct, p.action, p.resourceType, p.isSensitive);
    await seedRolePermission(direct, roleId, permId, "ALLOW", "Company");
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

/** Bản sao mẫu (hàng + link thành phần) — `created_by` khác NULL nên seeder coi là mẫu NGƯỜI DÙNG, không đụng tới. */
export async function cloneTemplate(
  direct: Pool,
  companyId: string,
  sourceTemplateId: string,
  code: string,
  createdBy: string,
): Promise<string> {
  const t = await direct.query<{ id: string }>(
    `INSERT INTO payroll_templates (company_id, code, name, scope, is_active, created_by, updated_by)
     VALUES ($1, $2, $2, 'company', true, $3, $3) RETURNING id`,
    [companyId, code, createdBy],
  );
  await direct.query(
    `INSERT INTO payroll_template_components
       (company_id, template_id, component_id, column_label, formula_override, is_visible, sort_order)
     SELECT company_id, $2, component_id, column_label, formula_override, is_visible, sort_order
       FROM payroll_template_components
      WHERE company_id = $1 AND template_id = $3`,
    [companyId, t.rows[0].id, sourceTemplateId],
  );
  return t.rows[0].id;
}

/** Gỡ link một thành phần (theo MÃ) khỏi mẫu — ghi thẳng DB, không qua 053 (mô phỏng dữ liệu lách tiền-kiểm). */
export async function unlinkTemplateComponent(
  direct: Pool,
  companyId: string,
  templateId: string,
  code: string,
): Promise<void> {
  const r = await direct.query(
    `DELETE FROM payroll_template_components ptc
      USING salary_components sc
      WHERE ptc.company_id = $1 AND ptc.template_id = $2
        AND sc.company_id = ptc.company_id AND sc.id = ptc.component_id AND sc.code = $3`,
    [companyId, templateId, code],
  );
  if ((r.rowCount ?? 0) !== 1) throw new Error(`unlinkTemplateComponent: mẫu không có ${code}`);
}

/** Đặt/gỡ `formula_override` của một thành phần (theo MÃ) trong mẫu — ghi thẳng DB. */
export async function setTemplateOverride(
  direct: Pool,
  companyId: string,
  templateId: string,
  code: string,
  formula: string | null,
): Promise<void> {
  const r = await direct.query(
    `UPDATE payroll_template_components ptc
        SET formula_override = $4
       FROM salary_components sc
      WHERE ptc.company_id = $1 AND ptc.template_id = $2
        AND sc.company_id = ptc.company_id AND sc.id = ptc.component_id AND sc.code = $3`,
    [companyId, templateId, code, formula],
  );
  if ((r.rowCount ?? 0) !== 1) throw new Error(`setTemplateOverride: mẫu không có ${code}`);
}

/** Kỳ công ĐÃ KHOÁ của một tháng — nguồn kiểm 002 của `calculate`. */
export async function lockedAttendancePeriod(
  direct: Pool,
  companyId: string,
  month: string,
): Promise<string> {
  const r = await direct.query<{ id: string }>(
    `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
    [companyId, month],
  );
  return r.rows[0].id;
}

/** Các ngày T2–T6 (UTC) của `YYYY-MM`. */
export function weekdaysOf(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const out: string[] = [];
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) break;
    const dow = dt.getUTCDay();
    if (dow !== 0 && dow !== 6) out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
// S15-PAYROLL-BE-4 — fixture track C (đợt chi trả · tạm ứng · ngân sách · import)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Cấp MỘT TẬP cặp route (theo key của bảng hằng, dedupe theo cặp) ở `scope` cho một người dùng. */
export async function grantPayrollPairs(
  direct: Pool,
  companyId: string,
  userId: string,
  label: string,
  keys: readonly PayrollRouteKey[],
  scope: "Own" | "Department" | "Company" = "Company",
): Promise<void> {
  const roleId = await seedRole(direct, companyId, `${label}-${randomUUID().slice(0, 6)}`);
  const pairs = new Map(
    keys
      .map((k) => PAYROLL_ROUTE_PAIRS[k])
      .map((p) => [`${p.action}:${p.resourceType}`, p] as const),
  );
  for (const p of pairs.values()) {
    const permId = await seedPermissionCatalog(direct, p.action, p.resourceType, p.isSensitive);
    await seedRolePermission(direct, roleId, permId, "ALLOW", scope);
  }
  await seedUserRole(direct, userId, roleId, companyId);
}

export interface PublishedPeriodOpts {
  month: string;
  /** Mỗi người MỘT phiếu; `net`/`gross` chuỗi numeric. */
  payees: ReadonlyArray<{ userId: string; net: string; gross?: string }>;
  /** calculated/submitted/published/payslips_generated by. */
  officerId: string;
  /** approved_by — PHẢI khác `officerId` (CHECK `payroll_periods_four_eyes_check` sống ở DB). */
  approverId: string;
  /** Mặc định `Published`. `Locked` = kỳ DI SẢN O-1 lối A: `paid_* := published_*` (cùng `now()` của câu). */
  status?: "Approved" | "Published" | "Locked";
  templateId?: string | null;
}

/**
 * Kỳ ở `Published` (mặc định) INSERT THẲNG với đủ vết duyệt + phiếu lương (append-only) cho từng người — nguồn của mọi ca
 * đợt chi trả (067–072). KHÔNG đi qua máy tính lương: BE-4 đo luật PHỦ/snapshot TK, không đo số tiền của phiếu.
 */
export async function publishedPeriodWithPayslips(
  direct: Pool,
  companyId: string,
  opts: PublishedPeriodOpts,
): Promise<{ periodId: string; payslipIdByUser: Map<string, string> }> {
  const status = opts.status ?? "Published";
  const ap = await direct.query<{ id: string }>(
    `INSERT INTO attendance_periods (company_id, period_month, status) VALUES ($1, $2, 'locked') RETURNING id`,
    [companyId, opts.month],
  );
  const published = status === "Published" || status === "Locked";
  const locked = status === "Locked";
  const p = await direct.query<{ id: string }>(
    `INSERT INTO payroll_periods
       (company_id, period_month, status, attendance_period_id, template_id,
        calculated_by, calculated_at, submitted_by, submitted_at, approved_by, approved_at,
        payslips_generated_by, payslips_generated_at,
        published_by, published_at, paid_by, paid_at, locked_by, locked_at)
     VALUES ($1, $2, $3, $4, $5,
        $6, now(), $6, now(), $7, now(),
        $6, now(),
        CASE WHEN $8::boolean THEN $6::uuid END, CASE WHEN $8::boolean THEN now() END,
        CASE WHEN $9::boolean THEN $6::uuid END, CASE WHEN $9::boolean THEN now() END,
        CASE WHEN $9::boolean THEN $6::uuid END, CASE WHEN $9::boolean THEN now() END)
     RETURNING id`,
    [
      companyId,
      opts.month,
      status,
      ap.rows[0].id,
      opts.templateId ?? null,
      opts.officerId,
      opts.approverId,
      published,
      locked,
    ],
  );
  const periodId = p.rows[0].id;
  const payslipIdByUser = new Map<string, string>();
  for (const payee of opts.payees) {
    const gross = payee.gross ?? payee.net;
    const r = await direct.query<{ id: string }>(
      `INSERT INTO payslips
         (company_id, payroll_period_id, user_id, base_salary, gross, net, created_by, input_snapshot_json)
       VALUES ($1, $2, $3, $4::numeric, $4::numeric, $5::numeric, $6, '{"workDays":22}'::jsonb) RETURNING id`,
      [companyId, periodId, payee.userId, gross, payee.net, opts.officerId],
    );
    payslipIdByUser.set(payee.userId, r.rows[0].id);
  }
  return { periodId, payslipIdByUser };
}

/** Thiết lập TK ngân hàng (upsert theo unique partial `(company, user) WHERE deleted_at IS NULL`); `null` = xoá TK. */
export async function bankSettings(
  direct: Pool,
  companyId: string,
  userId: string,
  account: string | null,
  bankName = "VCB",
  accountHolder = "CHU TAI KHOAN",
): Promise<void> {
  await direct.query(
    `INSERT INTO payroll_employee_settings (company_id, user_id, bank_account_number, bank_name, account_holder)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (company_id, user_id) WHERE deleted_at IS NULL
     DO UPDATE SET bank_account_number = EXCLUDED.bank_account_number,
                   bank_name = EXCLUDED.bank_name, account_holder = EXCLUDED.account_holder, updated_at = now()`,
    [companyId, userId, account, account ? bankName : null, account ? accountHolder : null],
  );
}

/** Hồ sơ nhân sự tối thiểu với `employee_code` (nguồn mã NV cho import 076 + tên/mã ở tệp UNC). */
export async function employeeProfile(
  direct: Pool,
  companyId: string,
  userId: string,
  employeeCode: string,
  orgUnitId: string | null = null,
): Promise<void> {
  await direct.query(
    `INSERT INTO employee_profiles (company_id, user_id, employee_code, org_unit_id, status)
     VALUES ($1, $2, $3, $4, 'active')`,
    [companyId, userId, employeeCode, orgUnitId],
  );
}

/** `count` tháng liên tiếp từ `fromYear-01` có ĐÚNG 22 ngày T2–T6 — mẫu số pro-rate của bảng tay (evidence) = 22. */
export function monthsWith22Weekdays(fromYear: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count && i < 600; i++) {
    const month = `${fromYear + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    if (weekdaysOf(month).length === 22) out.push(month);
  }
  return out;
}
