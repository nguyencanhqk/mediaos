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
import { PAYROLL_ROUTE_PAIRS } from "../../src/payroll/payroll-route-pairs.const";
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

/** `count` tháng liên tiếp từ `fromYear-01` có ĐÚNG 22 ngày T2–T6 — mẫu số pro-rate của bảng tay (evidence) = 22. */
export function monthsWith22Weekdays(fromYear: number, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; out.length < count && i < 600; i++) {
    const month = `${fromYear + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    if (weekdaysOf(month).length === 22) out.push(month);
  }
  return out;
}
