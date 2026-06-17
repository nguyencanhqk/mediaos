import type { AuditObjectType } from "../db/schema";

/**
 * AC-8 mask-by-server (BẤT BIẾN #3). audit_logs.before/after CÓ THỂ chứa payload nhạy cảm
 * (secret/PII) cho một số object_type. Cross-tenant operator view khuếch đại blast-radius ⇒ phải REDACT
 * trước khi vào AuditLogDto, cho CẢ đường tenant-self lẫn operator.
 *
 * Thiết kế: DEFAULT-REDACT theo allowlist object_type nhạy cảm (conservative). before/after của các
 * object_type này → thay bằng `{ redacted: true }` (KHÔNG trả nguyên payload). Object_type còn lại giữ
 * nguyên (metadata nghiệp vụ công khai cho admin). Mở rộng = thêm vào SENSITIVE_AUDIT_OBJECT_TYPES.
 *
 * Lưu ý: hầu hết domain ghi audit ĐÃ tránh nhét secret vào before/after (G6-2/payroll/api_key tự kỷ luật),
 * nhưng đây là HÀNG RÀO CUỐI fail-safe — nếu một payload nhạy cảm lọt vào audit, viewer KHÔNG lộ nó.
 */
export const SENSITIVE_AUDIT_OBJECT_TYPES: ReadonlySet<AuditObjectType> = new Set<AuditObjectType>([
  // Lương / phiếu lương (tiền + thông tin cá nhân nhạy cảm).
  "salary_profile",
  "payslip",
  "payslip_item",
  "payslip_acknowledgement",
  "bonus_penalty",
  // Bí mật / khoá (token / envelope material — KHÔNG bao giờ lộ).
  "api_key",
  "platform_account",
  "channel_account",
  "encryption_key",
  "webhook_endpoint",
  // Truy cập khẩn cấp (lý do/đối tượng nhạy cảm).
  "break_glass_access",
]);

/** Giá trị thay thế khi redact (KHÔNG trả nguyên payload nhạy cảm). */
export const REDACTED_MARKER = { redacted: true } as const;

/**
 * Trả before/after đã mask cho 1 dòng audit theo object_type. Nếu object_type nhạy cảm → cả before/after
 * thành marker (KHÔNG lộ field con). Nếu KHÔNG nhạy cảm → giữ nguyên.
 */
export function redactAuditPayload(
  objectType: string,
  before: unknown,
  after: unknown,
): { before: unknown; after: unknown } {
  if (SENSITIVE_AUDIT_OBJECT_TYPES.has(objectType as AuditObjectType)) {
    return {
      before: before == null ? null : { ...REDACTED_MARKER },
      after: after == null ? null : { ...REDACTED_MARKER },
    };
  }
  return { before: before ?? null, after: after ?? null };
}
