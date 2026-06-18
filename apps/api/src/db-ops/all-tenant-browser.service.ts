import { ForbiddenException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  DB_BROWSER_MAX_ROWS,
  type DbAllTenantBrowseQuery,
  type DbAllTenantBrowseResult,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { OperatorActionAuditService } from "../platform/operator-action-audit.service";
import {
  assertColumnsAllowed,
  assertTableAllowed,
  isAllowedColumn,
  type DbBrowserTable,
} from "./db-ops-allowlist";
import { AUDIT_DB_ALL_TENANT_READ } from "./db-ops.constants";
import { DbOpsGrantRepository } from "./db-ops-grant.repository";

/** Operator identity (platform-admin). */
export interface OperatorUser {
  id: string;
  companyId: string;
}

/** Cột định danh tenant — luôn có trong projection (trừ bảng companies, nơi id = tenant). */
const TENANT_COLUMN = "company_id";
const COMPANIES_TABLE = "companies";

/**
 * AllTenantBrowserService (🔴 WAVE 3 C1 — ADR-0021 Tầng 3) — đọc rows XUYÊN MỌI TENANT (operator KHÔNG biết
 * target id trước) trên bảng allowlist, qua role DB read-only `mediaos_readonly` (withAllTenantReadContext →
 * SET LOCAL ROLE). RLS policy `<bảng>_all_tenant_read` (USING(true), mig 0346) cho thấy mọi tenant; column-
 * GRANT hẹp ⇒ secret/PII ungettable Ở DB. KHÔNG BYPASSRLS, KHÔNG GUC mới.
 *
 * GATE (blast-radius cao hơn tenant-scoped): assertAllTenantGrantActive — operator PHẢI có 1 grant break-glass
 * 'active' CÒN HẠN với target_tenant_id IS NULL (ALL-TENANT). Grant tenant-scoped KHÔNG đủ. Fail-closed 403.
 * (Step-up sentinel + PermissionGuard read:db-all-tenant ép ở controller.)
 *
 * AUDIT fail-closed (mirror AuditReadService.listCrossTenant): MỖI read ghi 1 operator-action audit
 * (operator.all_tenant_read + metadata) qua withTenant(operator.companyId) RIÊNG — KHÔNG ghi trong ngữ cảnh
 * all-tenant-read (role read-only + audit_logs WITH CHECK keyed company_id ⇒ INSERT ở đó FAIL). Audit lỗi ⇒
 * throw ⇒ client KHÔNG nhận data (forensic gap=0). after KHÔNG chứa row data/filter value (chỉ metadata).
 *
 * BẤT BIẾN #3: project CHỈ cột allowlist + ép thêm company_id (định danh tenant). table/cols là giá trị
 * allowlist tường minh (KHÔNG nhận tự do từ client) ⇒ an toàn interpolate identifier; filter value bind-param.
 *
 * NOTE: query builder song song có chủ đích với DataBrowserService.runQuery (gate/ngữ cảnh/audit-tenant KHÁC
 * nhau) — KHÔNG refactor file AC-9 đã land để giữ blast-radius tối thiểu.
 */
@Injectable()
export class AllTenantBrowserService {
  constructor(
    private readonly db: DatabaseService,
    private readonly grants: DbOpsGrantRepository,
    private readonly operatorAudit: OperatorActionAuditService,
  ) {}

  async browseAllTenants(
    operator: OperatorUser,
    query: DbAllTenantBrowseQuery,
  ): Promise<DbAllTenantBrowseResult> {
    const table = assertTableAllowed(query.table);
    const columns = this.effectiveColumns(table, query.cols);
    // Validate filter columns ∈ allowlist (default-DENY — filter cột secret/PII bị chặn 400).
    const filters = (query.filters ?? []).map((f) => {
      if (!isAllowedColumn(table, f.column)) {
        assertColumnsAllowed(table, [f.column]); // throws 400
      }
      return { column: f.column, value: f.value };
    });

    await this.assertAllTenantGrantActive(operator);

    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));

    // Tầng 3: SET LOCAL ROLE mediaos_readonly — policy all_tenant_read USING(true) ⇒ đọc MỌI tenant.
    const { rows, total } = await this.db.withAllTenantReadContext(async (tx) =>
      this.runQuery(tx, table, columns, filters, limit, offset),
    );

    // Audit fail-closed: ghi MỖI read TRONG tx withTenant(home) RIÊNG (KHÔNG trong ngữ cảnh role read-only).
    await this.db.withTenant(operator.companyId, async (tx) => {
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: operator.companyId,
        action: AUDIT_DB_ALL_TENANT_READ,
        after: {
          table,
          columns,
          filters: filters.map((f) => f.column), // CHỈ tên cột — KHÔNG value (có thể PII).
          filterCount: filters.length,
          returned: rows.length,
          scope: "all-tenant",
        },
      });
    });

    return { table, columns, rows, meta: { total, limit, offset } };
  }

  /**
   * Cột hiệu lực: subset allowlist (default-DENY) + ÉP thêm company_id để định danh tenant (mọi bảng trừ
   * companies, nơi id = tenant). company_id ∈ allowlist mọi bảng tenant ⇒ thêm an toàn.
   */
  private effectiveColumns(table: DbBrowserTable, cols?: string[]): string[] {
    const base = assertColumnsAllowed(table, cols);
    if (table === COMPANIES_TABLE) return base;
    return base.includes(TENANT_COLUMN) ? base : [TENANT_COLUMN, ...base];
  }

  /** 🔒 Gate: operator PHẢI có grant 'active' còn hạn với target IS NULL (ALL-TENANT). Fail-closed 403. */
  private async assertAllTenantGrantActive(operator: OperatorUser): Promise<void> {
    const grant = await this.db.withTransaction((tx) =>
      this.grants.findActiveAllTenantGrantTx(tx, operator.id),
    );
    if (!grant) {
      throw new ForbiddenException(
        "All-tenant data-browser yêu cầu 1 break-glass grant ALL-TENANT đang ACTIVE còn hạn (target null).",
      );
    }
  }

  /** Dựng + chạy SELECT cột allowlist + filter = (bind-param) + count. table/columns là identifier allowlist. */
  private async runQuery(
    tx: TenantTx,
    table: DbBrowserTable,
    columns: string[],
    filters: Array<{ column: string; value: string }>,
    limit: number,
    offset: number,
  ): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
    const colList = sql.join(
      columns.map((c) => sql.identifier(c)),
      sql`, `,
    );
    const tableId = sql.identifier(table);

    const whereParts = filters.map((f) => sql`${sql.identifier(f.column)} = ${f.value}`);
    const whereClause =
      whereParts.length > 0 ? sql` WHERE ${sql.join(whereParts, sql` AND `)}` : sql``;

    // orderBy tất định: created_at desc, id desc (cả 2 ∈ allowlist mọi bảng).
    const orderBy = sql` ORDER BY ${sql.identifier("created_at")} DESC, ${sql.identifier("id")} DESC`;

    const dataQuery = sql`SELECT ${colList} FROM ${tableId}${whereClause}${orderBy} LIMIT ${limit} OFFSET ${offset}`;
    const countQuery = sql`SELECT count(*)::int AS c FROM ${tableId}${whereClause}`;

    const dataRes = await tx.execute(dataQuery);
    const countRes = await tx.execute(countQuery);
    const total = (countRes.rows[0] as { c: number } | undefined)?.c ?? 0;
    return { rows: dataRes.rows as Array<Record<string, unknown>>, total };
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DB_BROWSER_MAX_ROWS;
  return Math.min(DB_BROWSER_MAX_ROWS, Math.max(1, Math.trunc(limit)));
}
