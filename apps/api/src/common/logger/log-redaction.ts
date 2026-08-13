/**
 * log-redaction.ts — S10-FND-JSONLOG-1 · BẤT BIẾN #3 (không secret plaintext) áp cho log JSON.
 *
 * Log có cấu trúc (object) rò secret DỄ HƠN log văn xuôi cũ: một `catch (err) { logger.error(err) }`
 * bất cẩn có thể mang theo header request/response, object config đọc thẳng từ `process.env`, hay
 * message lỗi driver DB in nguyên `postgres://user:pass@host`. `redactValue` là lớp chắn ÁP DỤNG BẮT
 * BUỘC trước khi bất kỳ message/stack nào rời tiến trình qua `JsonConsoleLogger`.
 *
 * Hai cơ chế, cả hai đều cần (một mình không đủ):
 *   1. Chặn theo TÊN KHOÁ — object có field tên `password`/`token`/`x-internal-key`/… bị thay
 *      nguyên giá trị bằng `[REDACTED]`, bất kể giá trị là gì (kể cả object lồng nhau).
 *   2. Chặn theo MẪU trong GIÁ TRỊ CHUỖI — message dạng chuỗi (vd lỗi driver DB, URL có `?token=`)
 *      không đi qua field nào để chặn theo tên; phải quét chuỗi tìm connection-string/Bearer/JWT.
 */

const REDACTED = "[REDACTED]";

/** Tên field coi là nhạy cảm — so khớp KHÔNG phân biệt hoa/thường, khớp CẢ substring có dấu `-`/`_`. */
const SENSITIVE_KEY_RE =
  /password|passwd|pwd|secret|token|api[-_]?key|authorization|cookie|x-internal-key|internal[-_]?api[-_]?key|private[-_]?key|client[-_]?secret|connection[-_]?string|database[-_]?url|dsn/i;

/** `scheme://user:pass@host[...]` — Postgres/Redis/MySQL/Mongo/AMQP/SMTP đều theo dạng này. */
const CONNECTION_STRING_RE = /\b([a-z][a-z0-9+.-]*):\/\/[^\s:@/'"]+:[^\s@/'"]+@[^\s/'"]+/gi;

/** Header `Authorization: Bearer <token>` lọt vào một chuỗi message tự do. */
const BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._-]+/gi;

/** JWT (3 phần base64url cách nhau dấu chấm) — access/refresh token thường ở dạng này. */
const JWT_RE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4,}\b/g;

/**
 * `key=value`/`key: value` nhạy cảm nằm TỰ DO trong message (không qua field object nào để chặn
 * theo tên) — vd query-string `?token=…`, dump header dạng text `x-internal-key=…`, log driver in
 * `password=…`. Giữ lại `key<sep>` để còn đọc được LOẠI thông tin gì đã bị che, chỉ xoá giá trị.
 */
const INLINE_KEY_VALUE_RE =
  /\b(x-internal-key|internal[-_]?api[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|api[-_]?key|password|passwd|secret|token|dsn)([:=])([^\s&"'`,;]+)/gi;

/** Quét MỘT chuỗi tìm các mẫu giống-secret và thay bằng `[REDACTED]` — giữ phần vô hại (scheme/host). */
export function redactString(value: string): string {
  return value
    .replace(INLINE_KEY_VALUE_RE, (_match, key: string, sep: string) => `${key}${sep}${REDACTED}`)
    .replace(CONNECTION_STRING_RE, (match) => {
      const schemeSepIdx = match.indexOf("://");
      const atIdx = match.lastIndexOf("@");
      const scheme = match.slice(0, schemeSepIdx + 3);
      const afterAt = match.slice(atIdx);
      return `${scheme}${REDACTED}${afterAt}`;
    })
    .replace(BEARER_TOKEN_RE, `Bearer ${REDACTED}`)
    .replace(JWT_RE, REDACTED);
}

/**
 * Redact ĐỆ QUY một giá trị log tuỳ ý trước khi serialize ra JSON.
 *
 * An toàn với cấu trúc vòng (circular) qua `seen` — một object lồng nhau tự tham chiếu KHÔNG được
 * làm hàm này treo tiến trình log.
 */
export function redactValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: typeof value.stack === "string" ? redactString(value.stack) : undefined,
    };
  }

  if (seen.has(value)) return "[REDACTED:circular]";
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redactValue(item, seen));

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? REDACTED : redactValue(entry, seen);
  }
  return out;
}
