import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import type { TenantTx } from "../../db/db.service";
import { auditLogs } from "../../db/schema";

/**
 * Bộ lọc audit list/detail. Mọi field optional. `companyId` CHỈ có nghĩa ở đường SYSTEM
 * (withPlatformReadContext mở chéo tenant → operator có thể khoanh 1 tenant); đường COMPANY đã bị
 * withTenant + RLS ép sẵn nên KHÔNG truyền companyId vào filter (tránh nhầm/no-op).
 */
export interface AuditFilter {
  action?: string;
  objectType?: string;
  objectId?: string;
  actorUserId?: string;
  moduleCode?: string;
  entityType?: string;
  entityId?: string;
  actorType?: string;
  requestId?: string;
  companyId?: string;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * AuditRepository — đọc append-only `audit_logs`. Mọi truy vấn nhận `tx` từ withTenant (Company scope)
 * HOẶC withPlatformReadContext (System scope, SELECT-only) — KHÔNG tự mở context (giữ ranh giới tenant
 * ở tầng service). Chỉ SELECT/COUNT (append-only #2 — KHÔNG có path UPDATE/DELETE ở repo này).
 */
@Injectable()
export class AuditRepository {
  /** Dựng điều kiện WHERE từ filter (eq từng field + between created_at). companyId chỉ áp ở System path. */
  private buildWhere(filter: AuditFilter): SQL | undefined {
    const conds: SQL[] = [];
    if (filter.action) conds.push(eq(auditLogs.action, filter.action));
    if (filter.objectType) conds.push(eq(auditLogs.objectType, filter.objectType));
    if (filter.objectId) conds.push(eq(auditLogs.objectId, filter.objectId));
    if (filter.actorUserId) conds.push(eq(auditLogs.actorUserId, filter.actorUserId));
    if (filter.moduleCode) conds.push(eq(auditLogs.moduleCode, filter.moduleCode));
    if (filter.entityType) conds.push(eq(auditLogs.entityType, filter.entityType));
    if (filter.entityId) conds.push(eq(auditLogs.entityId, filter.entityId));
    if (filter.actorType) conds.push(eq(auditLogs.actorType, filter.actorType));
    if (filter.requestId) conds.push(eq(auditLogs.requestId, filter.requestId));
    if (filter.companyId) conds.push(eq(auditLogs.companyId, filter.companyId));
    if (filter.dateFrom) conds.push(gte(auditLogs.createdAt, new Date(filter.dateFrom)));
    if (filter.dateTo) conds.push(lte(auditLogs.createdAt, new Date(filter.dateTo)));
    return conds.length ? and(...conds) : undefined;
  }

  /** 1 trang audit theo filter, mới nhất trước (created_at desc), kẹp limit/offset (đã validate ở DTO). */
  async findManyTx(tx: TenantTx, filter: AuditFilter, limit: number, offset: number) {
    return tx
      .select()
      .from(auditLogs)
      .where(this.buildWhere(filter))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset);
  }

  /** Tổng số dòng khớp filter (cho meta.total). */
  async countTx(tx: TenantTx, filter: AuditFilter): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(this.buildWhere(filter));
    return row?.n ?? 0;
  }

  /**
   * 1 dòng theo id. Company scope: RLS ép (id của tenant khác → 0 row). System scope: truyền companyId
   * tường minh để khoanh tenant nếu cần (GUC mở chéo nên không có RLS auto-scope).
   */
  async findByIdTx(tx: TenantTx, id: string, companyId?: string) {
    const conds: SQL[] = [eq(auditLogs.id, id)];
    if (companyId) conds.push(eq(auditLogs.companyId, companyId));
    const [row] = await tx
      .select()
      .from(auditLogs)
      .where(and(...conds))
      .limit(1);
    return row;
  }
}
