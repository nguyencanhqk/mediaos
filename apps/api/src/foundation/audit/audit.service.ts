import { Injectable, NotFoundException } from "@nestjs/common";
import type { AuditLogDto, AuditLogListResponse, AuditLogQuery } from "@mediaos/contracts";
import { DatabaseService } from "../../db/db.service";
import { AuditMaskerService } from "../../events/audit-masker.service";
import type { AuditLog } from "../../db/schema/audit";
import { AuditRepository, type AuditFilter } from "./audit.repository";

/**
 * AuditQueryService (FOUNDATION-BE-3) — đọc audit chỉ-đọc theo 2 scope, tách bạch ở TẦNG SERVICE
 * (KHÔNG để controller tự chọn context):
 *   - COMPANY: `withTenant(companyId)` → RLS ép chỉ thấy audit của tenant hiện tại (BACKEND-04 §9.5).
 *   - SYSTEM (operator): `withPlatformReadContext()` → đọc CHÉO tenant SELECT-only (GUC hẹp, mig 0340);
 *     `?companyId` (nếu có) áp WHERE để khoanh 1 tenant, mặc định = mọi tenant.
 *
 * BẤT BIẾN #3 — redact-at-read (D5): map row→DTO che lại before/after/oldValues/newValues qua
 * AuditMaskerService (DÙNG CHUNG hàm mask với mask-at-write) ⇒ phủ cả hàng audit CŨ ghi trước khi
 * mask-at-write tồn tại. changed_fields chỉ là TÊN field nên an toàn truyền thẳng.
 *
 * Tên class CỐ Ý khác `AuditService` (events/) — service này CHỈ đọc/redact, không ghi.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AuditRepository,
    private readonly masker: AuditMaskerService,
  ) {}

  /** COMPANY scope: list audit của tenant hiện tại (RLS ép qua withTenant). */
  async listCompany(companyId: string, query: AuditLogQuery): Promise<AuditLogListResponse> {
    const filter = this.toFilter(query, false);
    return this.db.withTenant(companyId, async (tx) => {
      const [rows, total] = await Promise.all([
        this.repo.findManyTx(tx, filter, query.limit, query.offset),
        this.repo.countTx(tx, filter),
      ]);
      return {
        data: rows.map((row) => this.toDto(row)),
        meta: { total, limit: query.limit, offset: query.offset },
      };
    });
  }

  /** COMPANY scope: 1 dòng audit theo id (RLS ép — id của tenant khác → NotFound). */
  async getCompanyDetail(companyId: string, id: string): Promise<AuditLogDto> {
    const row = await this.db.withTenant(companyId, (tx) => this.repo.findByIdTx(tx, id));
    if (!row) throw new NotFoundException("Audit log không tồn tại");
    return this.toDto(row);
  }

  /** SYSTEM scope: list audit CHÉO tenant (operator). `?companyId` khoanh 1 tenant nếu truyền. */
  async listSystem(query: AuditLogQuery): Promise<AuditLogListResponse> {
    const filter = this.toFilter(query, true);
    return this.db.withPlatformReadContext(async (tx) => {
      const [rows, total] = await Promise.all([
        this.repo.findManyTx(tx, filter, query.limit, query.offset),
        this.repo.countTx(tx, filter),
      ]);
      return {
        data: rows.map((row) => this.toDto(row)),
        meta: { total, limit: query.limit, offset: query.offset },
      };
    });
  }

  /** SYSTEM scope: 1 dòng audit theo id (chéo tenant). `companyId` khoanh tenant nếu truyền. */
  async getSystemDetail(id: string, companyId?: string): Promise<AuditLogDto> {
    const row = await this.db.withPlatformReadContext((tx) =>
      this.repo.findByIdTx(tx, id, companyId),
    );
    if (!row) throw new NotFoundException("Audit log không tồn tại");
    return this.toDto(row);
  }

  /** Map query DTO → filter repo. companyId CHỈ áp ở System path (Company path đã RLS-scope). */
  private toFilter(query: AuditLogQuery, isSystem: boolean): AuditFilter {
    return {
      action: query.action,
      objectType: query.objectType,
      objectId: query.objectId,
      actorUserId: query.actorUserId,
      moduleCode: query.moduleCode,
      entityType: query.entityType,
      entityId: query.entityId,
      actorType: query.actorType,
      requestId: query.requestId,
      actionGroup: query.actionGroup,
      permissionCode: query.permissionCode,
      dataScope: query.dataScope,
      companyId: isSystem ? query.companyId : undefined,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    };
  }

  /** Map 1 row audit → DTO. before/after/oldValues/newValues ĐƯỢC redact lại tại đây (D5). */
  private toDto(row: AuditLog): AuditLogDto {
    return {
      id: row.id,
      companyId: row.companyId,
      actorUserId: row.actorUserId ?? null,
      action: row.action,
      objectType: row.objectType,
      objectId: row.objectId ?? null,
      before: this.masker.mask(row.before ?? null),
      after: this.masker.mask(row.after ?? null),
      ip: row.ip ?? null,
      userAgent: row.userAgent ?? null,
      moduleCode: row.moduleCode ?? null,
      entityType: row.entityType ?? null,
      entityId: row.entityId ?? null,
      actorType: row.actorType ?? null,
      oldValues: this.masker.mask(row.oldValues ?? null),
      newValues: this.masker.mask(row.newValues ?? null),
      changedFields: (row.changedFields as string[] | null) ?? null,
      sensitivityLevel: row.sensitivityLevel ?? null,
      resultStatus: row.resultStatus ?? null,
      requestId: row.requestId ?? null,
      correlationId: row.correlationId ?? null,
      ipAddress: row.ipAddress ?? null,
      // ── DB-08 §8.5 (v2 mig 0438). deviceInfo/metadata redact-at-read (D5) — có thể chứa token/ip. ──
      actorEmployeeId: row.actorEmployeeId ?? null,
      actionGroup: row.actionGroup ?? null,
      entityIdText: row.entityIdText ?? null,
      entityCode: row.entityCode ?? null,
      permissionCode: row.permissionCode ?? null,
      dataScope: row.dataScope ?? null,
      deviceInfo: this.masker.mask(row.deviceInfo ?? null),
      diffSummary: row.diffSummary ?? null,
      errorCode: row.errorCode ?? null,
      errorMessage: row.errorMessage ?? null,
      metadata: this.masker.mask(row.metadata ?? null),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
