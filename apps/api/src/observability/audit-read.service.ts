import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  DEFAULT_AUDIT_PAGE_LIMIT,
  MAX_AUDIT_PAGE_LIMIT,
  type AuditLogDto,
  type AuditLogListResponse,
  type AuditLogQuery,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { auditLogs } from "../db/schema";
import { OperatorActionAuditService } from "../platform/operator-action-audit.service";
import { redactAuditPayload } from "./audit-redact.helper";

/** Operator identity (platform-admin) — home tenant = nơi forensic ghi operator-action. */
export interface OperatorUser {
  id: string;
  companyId: string;
}

type AuditRow = typeof auditLogs.$inferSelect;

/**
 * AC-8 AuditReadService — đọc CHỈ-ĐỌC audit_logs ở 2 tầng:
 *  - listOwnTenant: company-admin xem audit CỦA tenant mình (withTenant(companyId) — RLS *_tenant_iso ÉP).
 *  - listCrossTenant: platform operator xem audit MỌI tenant (withPlatformReadContext — GUC HẸP
 *    app.platform_audit_read, SELECT-only). MỖI lần đọc chéo tenant GHI 1 operator-action audit row
 *    (recordOperatorAction action='operator.audit_read') trong tx withTenant(home) RIÊNG (forensic gap=0).
 *
 * §8.3: ROW CAP + pagination BẮT BUỘC — limit kẹp [1..MAX]. orderBy tất định (created_at desc, id desc).
 * BẤT BIẾN #3: before/after redact (redactAuditPayload) trước khi vào DTO (mask-by-server).
 */
@Injectable()
export class AuditReadService {
  constructor(
    private readonly db: DatabaseService,
    private readonly operatorAudit: OperatorActionAuditService,
  ) {}

  /** Đọc audit của TENANT mình (company-admin). companyId LẤY TỪ JWT (server), KHÔNG từ client. */
  async listOwnTenant(companyId: string, query: AuditLogQuery): Promise<AuditLogListResponse> {
    return this.db.withTenant(companyId, (tx) => this.queryAndMap(tx, query, { restrictCompanyId: companyId }));
  }

  /**
   * Đọc audit CHÉO tenant (platform operator). Optional filter companyId (1 tenant) — nếu vắng = mọi tenant.
   * Ghi operator-action audit (action='operator.audit_read') vào HOME tenant của operator (hoặc tenant
   * filter nếu có) trong 1 tx withTenant RIÊNG — KHÔNG ghi trong ngữ cảnh platform-read (SELECT-only).
   */
  async listCrossTenant(operator: OperatorUser, query: AuditLogQuery): Promise<AuditLogListResponse> {
    const result = await this.db.withPlatformReadContext((tx) => this.queryAndMap(tx, query));

    // Forensic: mọi lần đọc chéo tenant để lại dấu vết (KHÔNG quên — silent-failure target). company_id
    // của audit row = tenant filter (nếu có) hoặc home tenant của operator.
    const auditTenant = query.companyId ?? operator.companyId;
    await this.db.withTenant(auditTenant, async (tx) => {
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: auditTenant,
        action: "operator.audit_read",
        after: {
          filterCompanyId: query.companyId ?? null,
          action: query.action ?? null,
          objectType: query.objectType ?? null,
          returned: result.data.length,
        },
      });
    });

    return result;
  }

  /** Build WHERE từ filter (companyId chỉ áp ở đường operator; restrictCompanyId ép thêm cho tenant-self). */
  private buildWhere(query: AuditLogQuery, restrictCompanyId?: string): SQL | undefined {
    const conds: SQL[] = [];
    // restrictCompanyId: redundant với RLS nhưng defense-in-depth cho đường tenant-self.
    if (restrictCompanyId) conds.push(eq(auditLogs.companyId, restrictCompanyId));
    if (query.companyId && !restrictCompanyId) conds.push(eq(auditLogs.companyId, query.companyId));
    if (query.action) conds.push(eq(auditLogs.action, query.action));
    if (query.objectType) conds.push(eq(auditLogs.objectType, query.objectType));
    if (query.objectId) conds.push(eq(auditLogs.objectId, query.objectId));
    if (query.actorUserId) conds.push(eq(auditLogs.actorUserId, query.actorUserId));
    if (query.dateFrom) conds.push(gte(auditLogs.createdAt, new Date(query.dateFrom)));
    if (query.dateTo) conds.push(lte(auditLogs.createdAt, new Date(query.dateTo)));
    return conds.length ? and(...conds) : undefined;
  }

  private clampLimit(limit: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_AUDIT_PAGE_LIMIT;
    return Math.min(MAX_AUDIT_PAGE_LIMIT, Math.max(1, Math.trunc(limit)));
  }

  private async queryAndMap(
    tx: TenantTx,
    query: AuditLogQuery,
    opts: { restrictCompanyId?: string } = {},
  ): Promise<AuditLogListResponse> {
    const where = this.buildWhere(query, opts.restrictCompanyId);
    const limit = this.clampLimit(query.limit);
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));

    const rows = await tx
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where);

    return {
      data: rows.map((r) => this.toDto(r)),
      meta: { total, limit, offset },
    };
  }

  private toDto(row: AuditRow): AuditLogDto {
    const { before, after } = redactAuditPayload(row.objectType, row.before, row.after);
    return {
      id: row.id,
      companyId: row.companyId,
      actorUserId: row.actorUserId ?? null,
      action: row.action,
      objectType: row.objectType,
      objectId: row.objectId ?? null,
      before,
      after,
      ip: row.ip ?? null,
      userAgent: row.userAgent ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
