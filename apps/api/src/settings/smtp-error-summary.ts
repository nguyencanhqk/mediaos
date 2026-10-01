import { getSystemErrorName } from "node:util";

/**
 * Tóm tắt lỗi SMTP để LOG — S19-OPS-AUDITHIGH-1.
 *
 * ALLOWLIST, KHÔNG phải redact: chỉ lấy các trường MÁY SINH, mỗi trường phải khớp đúng hình dạng của nó,
 * lệch ⇒ `-`. KHÔNG bao giờ đọc `err.message`/`err.response`: nodemailer NỐI phản hồi server vào message
 * (`smtp-connection` `_formatError`: `err.message += ': ' + response`), và server có thể echo token kích
 * hoạt / link / username / blob AUTH PLAIN — kể cả ở dạng đã mã hoá (QP cắt token làm đôi, base64) nên
 * redact theo danh sách giá trị đã biết luôn sót (đo: trước WO, log mời chứa NGUYÊN token + username).
 *
 * Trường lấy:
 *   - `code` · `command` · `responseCode` — nodemailer đặt (`EAUTH`/`AUTH PLAIN`/`535`, `EENVELOPE`/`RCPT TO`…);
 *   - `errno` → tên hệ thống (`ECONNREFUSED`, `ECONNRESET`, `EAI_NONAME`) + `syscall` — nodemailer GHI ĐÈ
 *     `code` gốc của Node thành `ESOCKET`, nên không có hai trường này thì mọi lỗi mạng/TLS đọc y hệt nhau;
 *   - `reason` của OpenSSL (`wrong version number`) — chỉ chữ thường/số, nên lời văn có tên host bị loại;
 *   - `name` — để lỗi KHÔNG đến từ nodemailer (TypeError khi nâng major) không ra `- - -` vô dụng.
 */

const ERROR_NAME = /^[A-Za-z]{1,40}$/;
/** `code` của nodemailer (`EAUTH`, `EENVELOPE`, `ESOCKET`, `EOAUTH2`…). */
const ERROR_CODE = /^E[A-Z0-9]{2,24}$/;
/** `command` của nodemailer là hằng (`CONN`, `API`, `AUTH PLAIN`, `AUTH CRAM-MD5`, `MAIL FROM`, `RCPT TO`, `DATA`…). */
const ERROR_COMMAND = /^[A-Z]{2,12}(?: [A-Z0-9-]{2,12})?$/;
const SYSCALL = /^[a-z]{2,16}$/;
/** `reason` của OpenSSL — chữ thường, không dấu `:`/`.` ⇒ không lọt tên host hay chứng chỉ. */
const TLS_REASON = /^[a-z0-9 ,_-]{1,64}$/;
const SMTP_REPLY_MIN = 200;
const SMTP_REPLY_MAX = 599;
const MISSING = "-";

/** Lỗi lập trình (không mang chữ của server) — đáng `error` + stack thay vì `warn`. */
const PROGRAMMER_ERRORS = new Set(["TypeError", "RangeError", "ReferenceError"]);

type ErrorFields = Record<string, unknown>;

const fieldsOf = (err: unknown): ErrorFields =>
  typeof err === "object" && err !== null ? (err as ErrorFields) : {};

const matching = (value: unknown, shape: RegExp): string =>
  typeof value === "string" && shape.test(value) ? value : MISSING;

function replyCode(value: unknown): string {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= SMTP_REPLY_MIN &&
    value <= SMTP_REPLY_MAX
    ? String(value)
    : MISSING;
}

function systemErrorName(errno: unknown): string {
  if (typeof errno !== "number" || !Number.isInteger(errno) || errno >= 0) return MISSING;
  try {
    return matching(getSystemErrorName(errno), /^[A-Z_0-9]{2,32}$/);
  } catch {
    // errno không thuộc bảng của libuv ⇒ không có tên — trả `-` như mọi trường lệch hình dạng.
    return MISSING;
  }
}

/** Một dòng `key=value` chỉ gồm trường máy-sinh — an toàn để log. */
export function describeSmtpError(err: unknown): string {
  const e = fieldsOf(err);
  const name = err instanceof Error ? matching(err.name, ERROR_NAME) : MISSING;
  return [
    `name=${name}`,
    `code=${matching(e.code, ERROR_CODE)}`,
    `responseCode=${replyCode(e.responseCode)}`,
    `command=${matching(e.command, ERROR_COMMAND)}`,
    `errno=${systemErrorName(e.errno)}`,
    `syscall=${matching(e.syscall, SYSCALL)}`,
    `tlsReason=${matching(e.reason, TLS_REASON)}`,
  ].join(" ");
}

/** TypeError/RangeError/ReferenceError — lỗi code của mình hoặc của thư viện, không phải lỗi SMTP. */
export function isProgrammerError(err: unknown): err is Error {
  return err instanceof Error && PROGRAMMER_ERRORS.has(err.name);
}
