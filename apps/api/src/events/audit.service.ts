import { Injectable } from "@nestjs/common";
import type { TenantTx } from "../db/db.service";
import { auditLogs, type AuditObjectType } from "../db/schema";
import { AuditMaskerService } from "./audit-masker.service";

/**
 * 1 bản ghi audit. company_id KHÔNG truyền — lấy từ ngữ cảnh tenant (DB DEFAULT current_setting).
 *
 * v1 (GIỮ NGUYÊN — >100 caller phụ thuộc): action/objectType/objectId/actorUserId/before/after/ip/userAgent.
 * `objectType` BẮT BUỘC + giữ union `AuditObjectType` (KHÔNG nới — bất biến).
 *
 * v2 (FOUNDATION-BE-3, DB-08 §8.5 — TẤT CẢ OPTIONAL, additive): caller mới có thể điền cột DB-08; caller cũ
 * bỏ trống → cột v2 = null (nullable hợp lệ). Writer ghi ĐỒNG THỜI cặp v1 và v2 khi được cung cấp.
 */
export interface AuditEntry {
  action: string;
  objectType: AuditObjectType;
  objectId?: string;
  actorUserId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  // ── DB-08 §8.5 (optional, additive) ──
  moduleCode?: string;
  entityType?: string;
  entityId?: string;
  actorType?: string;
  oldValues?: unknown;
  newValues?: unknown;
  sensitivityLevel?: string;
  resultStatus?: string;
  requestId?: string;
  correlationId?: string;
  ipAddress?: string;
}

/**
 * Ghi audit append-only (BẤT BIẾN #2). PHẢI gọi BÊN TRONG cùng transaction nghiệp vụ (`withTenant`)
 * để audit và thay đổi nghiệp vụ cùng commit/rollback — không ghi nửa vời.
 *
 * BẤT BIẾN #3: before/after/oldValues/newValues được MASK (AuditMaskerService) TRƯỚC insert — khóa nhạy cảm
 * (password/token/secret/secret_ref/identity_number/bank_account/storage_path/signed_url) → "***". changed_fields
 * tính TỪ giá trị đã mask ⇒ chỉ chứa TÊN field, không lộ value.
 */
@Injectable()
export class AuditService {
  private readonly masker: AuditMaskerService;

  // masker optional ở chữ ký để KHÔNG vỡ >40 call-site `new AuditService()` trong test/legacy. Nest DI
  // luôn truyền AuditMaskerService thật (đã đăng ký EventsModule); thiếu → tự dựng default (cùng hàm mask).
  constructor(masker?: AuditMaskerService) {
    this.masker = masker ?? new AuditMaskerService();
  }

  /**
   * Tên field có giá trị khác nhau giữa `oldValues` và `newValues` (UNION key 2 vế; so sánh bằng JSON
   * stringify để bắt cả thay đổi object lồng nhau). KHÔNG trả value — chỉ TÊN field (an toàn, bất biến #3).
   * Cả 2 vế nên là dữ liệu ĐÃ MASK để field nhạy cảm (đã thành "***" hai bên) không bị tính là "đổi".
   */
  computeChangedFields(oldValues: unknown, newValues: unknown): string[] {
    const oldObj = this.asRecord(oldValues);
    const newObj = this.asRecord(newValues);
    const keys = new Set<string>([...Object.keys(oldObj), ...Object.keys(newObj)]);
    const changed: string[] = [];
    for (const key of keys) {
      if (!this.deepEqual(oldObj[key], newObj[key])) changed.push(key);
    }
    return changed;
  }

  async record(tx: TenantTx, entry: AuditEntry): Promise<void> {
    // Mask diff TRƯỚC insert (mask-at-write). undefined → null để cột nullable nhận giá trị tường minh.
    const before = entry.before === undefined ? null : this.masker.mask(entry.before);
    const after = entry.after === undefined ? null : this.masker.mask(entry.after);

    const hasV2 = entry.oldValues !== undefined || entry.newValues !== undefined;
    const oldValues = entry.oldValues === undefined ? null : this.masker.mask(entry.oldValues);
    const newValues = entry.newValues === undefined ? null : this.masker.mask(entry.newValues);
    // changed_fields chỉ tính khi có cặp v2 (tránh ghi [] vô nghĩa cho writer chỉ-v1).
    const changedFields = hasV2 ? this.computeChangedFields(oldValues, newValues) : null;

    await tx.insert(auditLogs).values({
      // ── v1 (GIỮ) ──
      action: entry.action,
      objectType: entry.objectType,
      objectId: entry.objectId,
      actorUserId: entry.actorUserId,
      before,
      after,
      ip: entry.ip,
      userAgent: entry.userAgent,
      // ── v2 (DB-08 §8.5 — null khi caller cũ không cung cấp) ──
      moduleCode: entry.moduleCode ?? null,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      actorType: entry.actorType ?? null,
      oldValues,
      newValues,
      changedFields,
      sensitivityLevel: entry.sensitivityLevel ?? null,
      resultStatus: entry.resultStatus ?? null,
      requestId: entry.requestId ?? null,
      correlationId: entry.correlationId ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }
}
