import { Injectable } from "@nestjs/common";
import { SECURITY_EVENT_SEVERITY, type SecurityEventType } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { userSecurityEvents } from "../db/schema/auth-logs";
import { AuditMaskerService } from "../events/audit-masker.service";

/**
 * 1 sự kiện bảo mật (SPEC-02 §22.2). `companyId` KHÔNG truyền — lấy từ ngữ cảnh tenant (DB DEFAULT
 * current_setting('app.current_company_id') qua `withTenant`, BẤT BIẾN #1). `userId` = subject (NOT NULL).
 * `actorUserId` = người thực hiện, null = hệ thống (vd reuse-detection). `payload` = ngữ cảnh non-sensitive
 * (scope/count/reason) — được MASK trước khi ghi (BẤT BIẾN #3).
 */
export interface SecurityEventEntry {
  /** ∈ SECURITY_EVENT_TYPES (contracts) — validate fail-closed trong record(). */
  eventType: SecurityEventType;
  userId: string;
  actorUserId?: string | null;
  ip?: string;
  userAgent?: string;
  /** jsonb tự do — MASK (mask-at-write) TRƯỚC insert; undefined → {} (cột NOT NULL default). */
  payload?: unknown;
}

/**
 * SecurityEventWriter (S2-AUTH-BE-8) — writer DÙNG CHUNG cho timeline `user_security_events` (append-only,
 * BẤT BIẾN #2). Mirror `AuditService.record`: PHẢI gọi BÊN TRONG cùng transaction nghiệp vụ (`withTenant`)
 * để event + thay đổi nghiệp vụ CÙNG commit/rollback — KHÔNG mở `withTenant` mới (không có orphan khi rollback).
 * DÙNG song song `audit.record` (dual-write: audit_logs = nhật ký hành động, user_security_events = timeline
 * bảo mật per-account cho viewer AUTH-API-402).
 *
 * 3 BẤT BIẾN ép ở đây:
 *   #1 company_id KHÔNG set — DB DEFAULT current_setting qua withTenant (RLS+FORCE cô lập tenant).
 *   #2 CHỈ INSERT (0 UPDATE/DELETE) — bảng append-only, app role GRANT SELECT,INSERT (mig 0443).
 *   #3 payload MASK qua AuditMaskerService (@Global) — khóa nhạy cảm (password/token/secret/*_hash…) → "***".
 * severity LẤY từ SECURITY_EVENT_SEVERITY (contracts) — KHÔNG hard-code rải rác ⇒ ∈ allowlist, không vỡ
 * CHECK `user_security_events_severity_check` (mig 0443).
 */
@Injectable()
export class SecurityEventWriter {
  private readonly masker: AuditMaskerService;

  // masker optional ở chữ ký để KHÔNG vỡ call-site `new SecurityEventWriter()` (hand-built int-spec/legacy).
  // Nest DI luôn truyền AuditMaskerService thật (@Global từ EventsModule); thiếu → tự dựng default (cùng hàm
  // mask). Mirror AuditService(masker?).
  constructor(masker?: AuditMaskerService) {
    this.masker = masker ?? new AuditMaskerService();
  }

  /**
   * Ghi 1 security-event append-only vào CHÍNH `tx` được truyền (KHÔNG mở transaction mới). event_type
   * validate ∈ contracts union (fail-closed — sai ⇒ throw TRƯỚC insert, không lọt row severity mặc định vỡ
   * CHECK). payload MASK trước insert. company_id KHÔNG set (DB DEFAULT current_setting).
   */
  async record(tx: TenantTx, entry: SecurityEventEntry): Promise<void> {
    const severity = SECURITY_EVENT_SEVERITY[entry.eventType];
    // Fail-closed: event_type ngoài SECURITY_EVENT_TYPES (bypass TS bằng `as`) → không có severity → throw
    // TRƯỚC insert (validation input, DoD §8). Không để row rác/severity undefined chạm CHECK Postgres.
    if (!severity) {
      throw new Error(
        `Unknown security event_type "${String(entry.eventType)}" — must be one of SECURITY_EVENT_TYPES`,
      );
    }

    // MASK-at-write (BẤT BIẾN #3): payload có thể chứa token/secret vô ý → che theo TÊN KHÓA. undefined → {}
    // (cột jsonb NOT NULL default {}). Kết quả PHẢI là object (cột $type Record<string, unknown>).
    const payload = this.toJsonRecord(
      entry.payload === undefined ? {} : this.masker.mask(entry.payload),
    );

    await tx.insert(userSecurityEvents).values({
      // company_id: KHÔNG set — DB DEFAULT current_setting('app.current_company_id') qua withTenant (BẤT BIẾN #1).
      userId: entry.userId,
      eventType: entry.eventType,
      severity,
      actorUserId: entry.actorUserId ?? null,
      ipAddress: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
      payload,
    });
  }

  /** Ép giá trị đã mask về Record cho cột jsonb NOT NULL. Object thường → giữ; khác (array/scalar) → bọc. */
  private toJsonRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return value === null || value === undefined ? {} : { value };
  }
}
