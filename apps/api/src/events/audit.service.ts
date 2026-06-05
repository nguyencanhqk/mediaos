import { Injectable } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { auditLogs, type AuditObjectType } from "../db/schema";

/** 1 bản ghi audit. company_id KHÔNG truyền — lấy từ ngữ cảnh tenant (DB DEFAULT current_setting). */
export interface AuditEntry {
  action: string;
  objectType: AuditObjectType;
  objectId?: string;
  actorUserId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
}

/**
 * Ghi audit append-only (BẤT BIẾN #2). PHẢI gọi BÊN TRONG cùng transaction nghiệp vụ (`withTenant`)
 * để audit và thay đổi nghiệp vụ cùng commit/rollback — không ghi nửa vời. KHÔNG ghi secret/hash.
 */
@Injectable()
export class AuditService {
  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLogs).values({
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      actorUserId: entry.actorUserId,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip,
      userAgent: entry.userAgent,
    });
  }
}
