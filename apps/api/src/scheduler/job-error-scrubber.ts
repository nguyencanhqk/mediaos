/**
 * job-error-scrubber (S2-FND-JOBS-1, BẤT BIẾN #3) — che (redact) secret khỏi `error_message` TRƯỚC khi ghi
 * `system_job_runs`. Nhật ký job hay chứa lỗi kết nối DB/HTTP mang credential (vd
 * `"connect failed password=abc123"`, `"postgres://user:pass@host"`). `error_message` là CHUỖI tự do ⇒
 * KHÔNG dùng được `AuditMaskerService` (che theo TÊN KHOÁ của jsonb) — cần scrubber CHUỖI riêng, che theo
 * MẪU nhúng-trong-chuỗi (key=value + credential-in-URL). Triết lý FAIL-TOWARD-REDACTION: thà che dư còn
 * hơn lộ 1 secret vào nhật ký (append-only, không sửa được sau).
 */

const REDACTED = "***";

/**
 * key=value / key: value — password / passwd / pwd / secret / token / access_token / refresh_token /
 * api_key / apikey. Value chạy tới ranh giới an toàn (whitespace hoặc dấu phân cách `"' ,;&`). Che PHẦN
 * VALUE, giữ tên khoá để còn ngữ cảnh chẩn đoán. `g`+`i` (mọi lần xuất hiện, không phân biệt hoa/thường).
 */
const SECRET_KV =
  /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|pwd|secret|token)\b(\s*[=:]\s*)("?)([^\s"',;&]+)\3/gi;

/**
 * Credential nhúng trong URL: `scheme://user:pass@host` → che phần `pass` (giữ scheme+user+host để chẩn
 * đoán). Đây là token EMBEDDED (không ở dạng key=value) — vẫn PHẢI che.
 */
const URL_CRED = /\b([a-z][a-z0-9+.-]*:\/\/[^\s/:@]+):([^\s/@]+)@/gi;

/** Che secret trong 1 chuỗi tự do. Idempotent (chạy lại trên chuỗi đã che không đổi thêm). */
export function scrubSecrets(input: string): string {
  if (!input) return input;
  return input
    .replace(URL_CRED, (_match, prefix: string) => `${prefix}:${REDACTED}@`)
    .replace(SECRET_KV, (_match, key: string, sep: string) => `${key}${sep}${REDACTED}`);
}

/**
 * Rút message từ `unknown` error (Error → `.message`, khác → String()) rồi scrub. Trả `null` khi không có
 * lỗi (null/undefined) — map thẳng vào cột `error_message` NULL.
 */
export function scrubErrorMessage(err: unknown): string | null {
  if (err === null || err === undefined) return null;
  const raw = err instanceof Error ? err.message : String(err);
  return scrubSecrets(raw);
}
