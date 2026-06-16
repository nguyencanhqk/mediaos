import { Injectable, Logger } from "@nestjs/common";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { securityAlerts, type SecurityAlertSeverity, type SecurityAlertType } from "../db/schema";
import { AuditService } from "../events/audit.service";

/**
 * Tín hiệu để phát 1 security alert. `detail` PHẢI non-sensitive (count, reason code, ip) — TUYỆT ĐỐI
 * KHÔNG password/secret/recovery-code/token (BẤT BIẾN #3). `subject` là định danh trừu tượng (userId/email),
 * KHÔNG giá trị nhạy cảm.
 */
export interface SecurityAlertSignal {
  alertType: SecurityAlertType;
  severity?: SecurityAlertSeverity;
  subject?: string | null;
  subjectUserId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * SecurityAlertService — phát alert an ninh APPEND-ONLY (G16-1b). CROWN-JEWEL: alert là sự thật bất biến
 * (BẤT BIẾN #2) ghi vào `security_alerts` + audit_logs cùng tx. Phát khi: re-auth fail lặp, cross-scope
 * deny lặp, đăng nhập bất thường.
 *
 * Hai đường gọi:
 *  - `emitTx` (in-tx): dùng khi đã ở trong `withTenant` của một luồng khác để alert + nghiệp vụ atomic.
 *  - `emit` (standalone): tự mở `withTenant` — cho caller không có sẵn tx (vd post-failure hook).
 *
 * Best-effort tuyệt đối: alert là tín hiệu phòng thủ-theo-chiều-sâu, KHÔNG được phép biến 1 deny/fail
 * an ninh thành một lỗi KHÁC. Mọi lỗi ghi alert được log (KHÔNG nuốt im) và NUỐT để caller giữ nguyên
 * outcome an ninh ban đầu (deny vẫn là deny, fail vẫn là fail).
 */
@Injectable()
export class SecurityAlertService {
  private readonly logger = new Logger(SecurityAlertService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** Ghi alert + audit TRONG tx có sẵn (atomic với nghiệp vụ gọi). KHÔNG nuốt lỗi — caller quyết. */
  async emitTx(tx: TenantTx, companyId: string, signal: SecurityAlertSignal): Promise<void> {
    const severity = signal.severity ?? "medium";
    await tx.insert(securityAlerts).values({
      companyId,
      alertType: signal.alertType,
      severity,
      subject: signal.subject ?? null,
      subjectUserId: signal.subjectUserId ?? null,
      detail: this.sanitizeDetail(signal.detail),
    });
    await this.audit.record(tx, {
      action: `security.alert.${signal.alertType}`,
      objectType: "security_alert",
      actorUserId: signal.subjectUserId ?? undefined,
      after: { alert_type: signal.alertType, severity },
    });
  }

  /**
   * Ghi alert standalone (tự mở `withTenant`). BEST-EFFORT: lỗi ghi được LOG (không nuốt im) rồi NUỐT để
   * KHÔNG đổi outcome an ninh của caller. Trả `true` nếu ghi thành công, `false` nếu thất bại (đã log).
   */
  async emit(companyId: string, signal: SecurityAlertSignal): Promise<boolean> {
    try {
      await this.db.withTenant(companyId, (tx) => this.emitTx(tx, companyId, signal));
      return true;
    } catch (err) {
      this.logger.error("Failed to persist security alert (caller outcome unchanged)", {
        companyId,
        alertType: signal.alertType,
        error: err instanceof Error ? (err.stack ?? err.message) : String(err),
      });
      return false;
    }
  }

  /**
   * Phòng ngừa rò secret vào `detail`: loại các khoá có tên gợi ý nhạy cảm (password/secret/token/code/…).
   * Đây là DEFENSE-IN-DEPTH — caller VẪN không được truyền secret; lớp này chặn lỗi vô ý cuối cùng.
   */
  private sanitizeDetail(detail?: Record<string, unknown>): Record<string, unknown> {
    if (!detail) return {};
    const BLOCKED = /(password|secret|token|code|otp|dek|cipher|hash|key)/i;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(detail)) {
      if (BLOCKED.test(k)) continue;
      out[k] = v;
    }
    return out;
  }
}
