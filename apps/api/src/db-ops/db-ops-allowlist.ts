import { BadRequestException } from "@nestjs/common";
import {
  DB_BROWSER_ALLOWLIST,
  type DbBrowserTable,
  allowedColumns,
  isAllowedColumn,
  isAllowedTable,
} from "@mediaos/contracts";

/**
 * AC-9 data-browser allowlist GUARD (api-side) — default-DENY. Re-export allowlist từ contracts (nguồn
 * sự thật chung) + helper throw-400. Mọi bảng/cột ngoài allowlist → BadRequestException (KHÔNG passthrough).
 *
 * BẤT BIẾN #3: allowlist KHÔNG chứa bảng/cột secret/PII (xem contracts db-ops-allowlist header). Guard này
 * là ranh giới cuối: kể cả query qua mọi tầng, table/col chạm DB CHỈ là giá trị allowlist tường minh.
 */

export { DB_BROWSER_ALLOWLIST, isAllowedTable, isAllowedColumn, allowedColumns };
export type { DbBrowserTable };

/** Ép bảng ∈ allowlist (default-DENY). Trả về bảng đã narrow type. */
export function assertTableAllowed(table: string): DbBrowserTable {
  if (!isAllowedTable(table)) {
    throw new BadRequestException(`Bảng '${table}' không nằm trong allowlist data-browser.`);
  }
  return table;
}

/**
 * Ép tập cột ∈ allowlist của bảng (default-DENY). cols vắng/rỗng = toàn bộ cột allowlist (default projection).
 * Trả về danh sách cột đã verify (an toàn để dựng SELECT — KHÔNG có cột tự do/SQL).
 */
export function assertColumnsAllowed(table: DbBrowserTable, cols?: string[]): string[] {
  if (!cols || cols.length === 0) return allowedColumns(table);
  const rejected = cols.filter((c) => !isAllowedColumn(table, c));
  if (rejected.length > 0) {
    throw new BadRequestException(
      `Cột không nằm trong allowlist của '${table}': ${rejected.join(", ")}.`,
    );
  }
  // Dedup giữ thứ tự.
  return [...new Set(cols)];
}
