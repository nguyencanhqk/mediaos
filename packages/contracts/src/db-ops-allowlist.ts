/**
 * AC-9 data-browser ALLOWLIST — default-DENY, defense-in-depth (BẤT BIẾN #3 không secret/PII).
 *
 * Data-browser CHỈ đọc bảng + cột khai TƯỜNG MINH ở đây. Mọi bảng/cột ngoài object này → 400 (KHÔNG
 * passthrough). Đặt ở contracts để CẢ api (validate + project) LẪN admin (table/col picker) dùng chung 1
 * nguồn — không drift.
 *
 * LOẠI TRỪ TUYỆT ĐỐI (KHÔNG BAO GIỜ vào allowlist / projection / DTO / log / audit):
 *   - platform_accounts.secret_ciphertext (+ mọi cột envelope/dek)
 *   - payslips / payslip_items (mọi cột tiền lương) · salary_profiles (mọi cột)
 *   - users two-factor / *_totp secret (user_totp.*, user_recovery_codes.*)
 *   - webhook_endpoints secret envelope cols
 *   - encryption_keys (TOÀN BẢNG — không liệt kê)
 *   - api_keys.token_hash
 *   - break_glass*.reason · db_ops*.reason (lý do nghiệp vụ nhạy cảm)
 *
 * Mỗi bảng → CHỈ cột non-sensitive (id/khoá nghiệp vụ/timestamp/status/tên hiển thị). KHÔNG cột tự do
 * chứa PII (email/phone/địa chỉ) trừ khi cần thật. `classify`: bảng tenant-RLS (đọc qua withTenant(target),
 * project cột allowlist) vs bảng GLOBAL no-RLS (đọc trực tiếp — KHÔNG có ở đây vì data-browser TENANT-scoped).
 *
 * Tất cả bảng dưới đây CÓ company_id (RLS tenant_isolation 0003+) ⇒ đọc qua withTenant(target) an toàn.
 */

/**
 * Allowlist: bảng → cột non-sensitive cho phép project. KHÔNG cột secret/PII (xem header).
 * Cột PHẢI tồn tại thật trong schema (verify: drizzle schema + int-spec runQuery). Mọi bảng đều có
 * created_at + id (orderBy tất định data-browser dựa vào 2 cột này).
 */
export const DB_BROWSER_ALLOWLIST = {
  // companies = bảng escape-hatch (no company_id); withTenant(target) ⇒ RLS lọc id=current ⇒ chỉ row target.
  companies: ["id", "name", "slug", "status", "timezone", "created_at", "updated_at"],
  users: ["id", "company_id", "email", "full_name", "status", "created_at", "updated_at"],
  org_units: ["id", "company_id", "name", "parent_id", "type", "code", "status", "created_at", "updated_at"],
  teams: ["id", "company_id", "name", "org_unit_id", "code", "status", "created_at", "updated_at"],
  projects: ["id", "company_id", "name", "code", "org_unit_id", "priority", "status", "created_at", "updated_at"],
  channels: ["id", "company_id", "name", "platform", "code", "niche", "health_status", "status", "created_at", "updated_at"],
  content_items: ["id", "company_id", "title", "code", "project_id", "production_status", "status", "created_at", "updated_at"],
  tasks: [
    "id",
    "company_id",
    "title",
    "task_type",
    "status",
    "assignee_user_id",
    "project_id",
    "created_at",
    "updated_at",
  ],
} as const satisfies Record<string, readonly string[]>;

export type DbBrowserTable = keyof typeof DB_BROWSER_ALLOWLIST;

/** Bảng có hợp lệ không (∈ allowlist). */
export function isAllowedTable(table: string): table is DbBrowserTable {
  return Object.prototype.hasOwnProperty.call(DB_BROWSER_ALLOWLIST, table);
}

/** Cột có thuộc allowlist của bảng không (default-DENY). */
export function isAllowedColumn(table: DbBrowserTable, column: string): boolean {
  return (DB_BROWSER_ALLOWLIST[table] as readonly string[]).includes(column);
}

/** Cột allowlist của 1 bảng (copy mảng — gọi nơi cần default projection). */
export function allowedColumns(table: DbBrowserTable): string[] {
  return [...DB_BROWSER_ALLOWLIST[table]];
}
