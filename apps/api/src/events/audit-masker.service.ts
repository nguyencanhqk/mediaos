import { Injectable } from "@nestjs/common";

/**
 * AuditMaskerService (FOUNDATION-BE-3, BẤT BIẾN #3) — che (redact) các trường nhạy cảm khỏi payload
 * audit diff (before/after/old_values/new_values) TRƯỚC khi ghi DB (mask-at-write) VÀ khi map row→DTO
 * lúc đọc (redact-at-read). DÙNG CHUNG 1 hàm cho cả 2 đường để danh sách field KHÔNG bao giờ lệch.
 *
 * Hợp đồng:
 *   - Match tên khóa CASE-INSENSITIVE, phủ cả snake_case lẫn camelCase (password ↔ Password,
 *     password_hash ↔ passwordHash, secret_ref ↔ secretRef, …).
 *   - Khóa khớp → VALUE thành "***" (giữ KEY, KHÔNG đệ quy vào value đó — toàn bộ subtree bị che).
 *   - Đệ quy qua object + array; KHÔNG đệ quy vào Date / primitive.
 *   - IMMUTABLE: luôn trả CẤU TRÚC MỚI, KHÔNG mutate input nghiệp vụ (tránh side-effect vào dữ liệu caller).
 *   - null/undefined/primitive → passthrough nguyên trạng.
 *
 * Lưu ý: che theo TÊN KHÓA (không quét value) → an toàn, không phụ thuộc heuristic nội dung. changed_fields
 * (chỉ TÊN field) vì vậy cũng không bao giờ lộ giá trị nhạy cảm.
 */
@Injectable()
export class AuditMaskerService {
  static readonly MASK = "***";

  /**
   * STEM khóa nhạy cảm — đã chuẩn hóa lowercase + bỏ underscore, khớp theo SUBSTRING trên tên khóa đã
   * chuẩn hóa (KHÔNG exact-match) ⇒ phủ cả biến thể GHÉP mà exact-match bỏ sót:
   *   - `token`    → token · access_token · refresh_token · token_hash · csrf_token
   *   - `secret`   → secret · secret_ref · api_secret · client_secret · secret_key
   *   - `password` → password · password_hash
   *   - `otp`      → otp · otp_secret · otpCode · totp_secret (mã/khoá OTP — BẤT BIẾN #3, phủ 2FA)
   *   - `salary`   → salary · salary_amount · salaryAmount · base_salary · salaryType (lương nhạy cảm, ADR-0010)
   *   - `health`   → health · personal_health_info · healthRecord (PII sức khỏe)
   *   - `idcard`   → id_card · idCardNumber · id_card_number (CMND/CCCD — biến thể của identity_number)
   *   - identity_number / bank_account / storage_path / signed_url (ghép đặc thù, ít false-positive).
   * Triết lý: FAIL TOWARD REDACTION (BẤT BIẾN #3) — thà che dư 1 field lành còn hơn lộ 1 secret. Mở rộng =
   * thêm stem ở đây (1 nguồn sự thật cho cả mask-at-write lẫn redact-at-read). S2-FND-BE-6 thêm otp/salary/
   * health/idcard (BE-11 §12.5) — KHÔNG sửa/bỏ stem cũ (append-only, không nới lỏng).
   */
  private static readonly SENSITIVE_STEMS: readonly string[] = [
    "password",
    "token",
    "secret",
    "identitynumber",
    "bankaccount",
    "storagepath",
    "signedurl",
    // S2-FND-BE-6 (thêm, KHÔNG bỏ stem cũ) — phủ biến thể snake_case + camelCase sau normalizeKey.
    "otp",
    "salary",
    "health",
    "idcard",
  ];

  /** Chuẩn hóa tên khóa: lowercase + bỏ underscore ⇒ khớp snake_case & camelCase cùng lúc. */
  private static normalizeKey(key: string): string {
    return key.toLowerCase().replace(/_/g, "");
  }

  private static isSensitiveKey(key: string): boolean {
    const norm = AuditMaskerService.normalizeKey(key);
    return AuditMaskerService.SENSITIVE_STEMS.some((stem) => norm.includes(stem));
  }

  /**
   * Trả bản sao đã che của `value`. KHÔNG mutate input. Khóa nhạy cảm → "***" (che cả subtree). Object
   * thường → đệ quy từng field; array → đệ quy từng phần tử; Date/primitive/null → giữ nguyên.
   */
  mask(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.mask(item));
    }
    // Date (và các object non-plain như Buffer) KHÔNG đệ quy — giữ nguyên reference value.
    if (value instanceof Date) return value;
    if (typeof value !== "object") return value;

    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(input)) {
      if (AuditMaskerService.isSensitiveKey(key)) {
        out[key] = AuditMaskerService.MASK;
        continue;
      }
      out[key] = this.mask(input[key]);
    }
    return out;
  }
}
