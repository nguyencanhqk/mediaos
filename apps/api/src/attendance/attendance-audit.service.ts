import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AuditLogDto, AuditLogListResponse, AuditLogQuery } from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { PermissionService } from "../permission/permission.service";
import { AuditMaskerService } from "../events/audit-masker.service";
import { AuditRepository } from "../foundation/audit/audit.repository";
import type { AuditLog } from "../db/schema/audit";
import { ATT_RESOURCES } from "./attendance-permissions.const";

const AUDIT_LOG = ATT_RESOURCES.AUDIT_LOG;

/**
 * S3-ATT-BE-6 — ATT audit viewer (READ-ONLY). TÁI DÙNG AuditRepository (SELECT-only, append-only #2) +
 * AuditMaskerService (SAME redact-at-read layer as foundation audit — BẤT BIẾN #3) nhưng gate BẰNG CẶP
 * (view,'attendance-audit-log') RIÊNG của ATT — KHÔNG dùng chung route/guard/permission-pair với
 * foundation AuditController's (view,'audit-log'). Nếu tái dùng thẳng route/guard foundation, một user
 * chỉ có (view,'audit-log') nhưng KHÔNG có (view,'attendance-audit-log') sẽ đọc lọt audit ATT
 * (over-grant) — done_when yêu cầu tách bạch route/controller/guard.
 *
 * The read is bounded server-side to the ATT object-type allowlist (objectTypes filter, NOT a client
 * param) — attendance_record/attendance_adjustment_request/attendance_period/shift/attendance_rule/
 * shift_assignment/remote_work_request (mig 0452/0457/0464 CHECK). company_id via withTenant (RLS+FORCE,
 * BẤT BIẾN #1); is_sensitive:true → wildcard *:* grant does NOT satisfy the gate (mirrors
 * AttendanceReadService.canViewSensitive / foundation AuditController isSensitive:true).
 */
const ATT_AUDIT_OBJECT_TYPES = [
  "attendance_record",
  "attendance_adjustment_request",
  "attendance_period",
  "shift",
  "attendance_rule",
  "shift_assignment",
  "remote_work_request",
] as const;

@Injectable()
export class AttendanceAuditService {
  constructor(
    private readonly db: DatabaseService,
    private readonly permission: PermissionService,
    private readonly repo: AuditRepository,
    private readonly masker: AuditMaskerService,
  ) {}

  async list(
    user: { id: string; companyId: string },
    query: AuditLogQuery,
  ): Promise<AuditLogListResponse> {
    const decision = await this.permission.can({
      userId: user.id,
      companyId: user.companyId,
      action: "view",
      resourceType: AUDIT_LOG,
      isSensitive: true,
    });
    if (!decision.allow) {
      throw new ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope");
    }

    const filter = {
      action: query.action,
      objectType: query.objectType,
      objectTypes: [...ATT_AUDIT_OBJECT_TYPES],
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
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
    };

    return this.db.withTenant(user.companyId, async (tx) => {
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

  /** Redact-at-read (BẤT BIẾN #3) — SAME masker as foundation AuditQueryService.toDto. */
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
