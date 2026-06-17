import { ForbiddenException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import {
  DB_BROWSER_MAX_ROWS,
  type DbBrowserQuery,
  type DbBrowserResult,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { OperatorActionAuditService } from "../platform/operator-action-audit.service";
import {
  assertColumnsAllowed,
  assertTableAllowed,
  isAllowedColumn,
  type DbBrowserTable,
} from "./db-ops-allowlist";
import { AUDIT_DB_READ } from "./db-ops.constants";
import { DbOpsGrantRepository } from "./db-ops-grant.repository";

/** Operator identity (platform-admin). */
export interface OperatorUser {
  id: string;
  companyId: string;
}

/**
 * DataBrowserService (🔴 AC-9 P2 — core crown) — đọc rows của 1 TARGET tenant qua Tầng 1
 * withTenant(targetCompanyId) (ADR-0020). RLS company_id=current ÉP khi current=target ⇒ KHÔNG rò chéo
 * tenant (KHÔNG GUC mới / KHÔNG BYPASSRLS). Bảng + cột CHỈ từ allowlist (default-DENY → 400). Pagination
 * BẮT BUỘC + ROW CAP [1..100]. orderBy tất định.
 *
 * GATE: assertGrantActive — operator PHẢI có 1 grant break-glass 'active' CÒN HẠN cho target (hoặc all),
 * ÉP Ở DB (expires_at > now()). Fail-closed nếu vắng/hết hạn (403).
 *
 * AUDIT fail-closed (§8.3 — mirror AuditReadService.listCrossTenant): MỖI read ghi 1 operator-action audit
 * (actor + target + table + filter + returned count) TRONG tx withTenant(target) RIÊNG. Audit lỗi ⇒ throw
 * ⇒ client KHÔNG nhận data (KHÔNG mất forensic). after KHÔNG chứa row data (chỉ metadata).
 *
 * BẤT BIẾN #3: project CHỈ cột allowlist (KHÔNG secret/PII). table/cols là giá trị allowlist tường minh
 * (KHÔNG nhận từ client tự do) ⇒ an toàn interpolate identifier; filter value qua bind-param.
 */
@Injectable()
export class DataBrowserService {
  constructor(
    private readonly db: DatabaseService,
    private readonly grants: DbOpsGrantRepository,
    private readonly operatorAudit: OperatorActionAuditService,
  ) {}

  async browse(operator: OperatorUser, query: DbBrowserQuery): Promise<DbBrowserResult> {
    const table = assertTableAllowed(query.table);
    const columns = assertColumnsAllowed(table, query.cols);
    // Validate filter columns ∈ allowlist (default-DENY — filter cột secret/PII bị chặn).
    const filters = (query.filters ?? []).map((f) => {
      if (!isAllowedColumn(table, f.column)) {
        // Dùng cùng 400 default-deny.
        return assertFilterColumn(table, f.column, f.value);
      }
      return { column: f.column, value: f.value };
    });

    await this.assertGrantActive(operator, query.targetCompanyId);

    const limit = clampLimit(query.limit);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));

    // Tầng 1: withTenant(target) — RLS ÉP company_id=current. Đọc CHỈ rows của target.
    const { rows, total } = await this.db.withTenant(query.targetCompanyId, async (tx) =>
      this.runQuery(tx, table, columns, filters, limit, offset),
    );

    // Audit fail-closed: ghi MỖI read TRONG tx withTenant(target) RIÊNG. Lỗi ⇒ throw ⇒ client không nhận data.
    await this.db.withTenant(query.targetCompanyId, async (tx) => {
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: query.targetCompanyId,
        action: AUDIT_DB_READ,
        after: {
          table,
          columns,
          filters: filters.map((f) => f.column), // CHỈ tên cột — KHÔNG value (có thể PII).
          filterCount: filters.length,
          returned: rows.length,
        },
      });
    });

    return {
      table,
      targetCompanyId: query.targetCompanyId,
      columns,
      rows,
      meta: { total, limit, offset },
    };
  }

  /** 🔒 Gate: operator PHẢI có grant 'active' còn hạn cho target (hoặc all-tenant). Fail-closed 403. */
  private async assertGrantActive(operator: OperatorUser, targetTenantId: string): Promise<void> {
    const grant = await this.db.withTransaction((tx) =>
      this.grants.findActiveGrantForTargetTx(tx, operator.id, targetTenantId),
    );
    if (!grant) {
      throw new ForbiddenException(
        "Data-browser yêu cầu 1 break-glass grant đang ACTIVE còn hạn cho tenant này.",
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

    // orderBy tất định: created_at desc, id desc (cả 2 ∈ allowlist mọi bảng). Fallback id nếu thiếu.
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

/** Filter cột ngoài allowlist → 400 default-deny (reuse assertColumnsAllowed throw shape). */
function assertFilterColumn(
  table: DbBrowserTable,
  column: string,
  value: string,
): { column: string; value: string } {
  assertColumnsAllowed(table, [column]); // throws 400 nếu cột ngoài allowlist
  return { column, value };
}
