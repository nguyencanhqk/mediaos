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
/**
 * `syscall` của lỗi net/dns/tls của Node — TẬP LIỆT KÊ, không phải regex: `^[a-z]{2,16}$` khớp cả hình dạng
 * mật khẩu ứng dụng Gmail (16 chữ thường) — an toàn chỉ nhờ nguồn gốc trường thì không phải allowlist.
 */
const SYSCALLS = new Set([
  "connect",
  "read",
  "write",
  "shutdown",
  "getaddrinfo",
  "queryA",
  "queryAaaa",
]);
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
    `syscall=${typeof e.syscall === "string" && SYSCALLS.has(e.syscall) ? e.syscall : MISSING}`,
    `tlsReason=${matching(e.reason, TLS_REASON)}`,
  ].join(" ");
}

/**
 * CHỈ các dòng frame `at …` của stack. Dòng đầu của `err.stack` LẶP LẠI `err.message` — và V8 dựng chuỗi stack
 * MUỘN (lần đọc đầu), nên cả phần nodemailer nối thêm (`err.message += ': ' + response`) cũng có mặt; lỗi
 * `ERR_INVALID_ARG_*` của Node còn mang tới 25 ký tự của giá trị. Lọc theo `at`, KHÔNG `slice(1)`: message
 * có thể nhiều dòng.
 */
export function stackFramesOf(err: Error): string {
  return (err.stack ?? "")
    .split("\n")
    .filter((line) => /^\s+at /.test(line))
    .join("\n");
}

/** TypeError/RangeError/ReferenceError — lỗi code của mình hoặc của thư viện, không phải lỗi SMTP. */
export function isProgrammerError(err: unknown): err is Error {
  return err instanceof Error && PROGRAMMER_ERRORS.has(err.name);
}

/**
 * Giá trị do CLIENT/tenant chọn (host…) trước khi vào log: `JSON.stringify` thoát CR/LF/nháy, rồi mọi ký tự ngoài
 * ASCII in được ⇒ `\uXXXX` — chặn giả dòng log bằng ký tự bidi (U+202E), U+2028/2029, NEL. Dùng chung cho route
 * test (từ chối đích) và lời mời (lỗi gửi) — S19-SEC-MAILCREDEXFIL-1 / S19-SEC-MAILAADBIND-1 FULL gate LOW.
 */
export function logSafe(value: string): string {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Câu trả cho admin ở "Kiểm tra kết nối" — S19-SEC-MAILCREDEXFIL-1.
 *
 * Đo trước WO: route test trả nguyên `err.message`, mà nodemailer nối phản hồi server vào đó ⇒ trỏ test vào
 * BẤT KỲ cổng TCP nào API với tới là đọc được dòng đầu banner (phiên bản SSH, hostname/IP relay nội bộ, chuỗi
 * và đường dẫn file OpenSSL). Từ nay thông điệp là HẰNG theo loại lỗi; các trường chỉ được XÉT (có/không,
 * thuộc tập hằng), không bao giờ được nối vào kết quả — trừ `responseCode` đã qua `replyCode` (số 200–599).
 *
 * Hình dạng lỗi là ĐO THẬT trên nodemailer 10.0.12 (docs/plans/S19-SEC-MAILCREDEXFIL-1.md §2):
 *   - TLS lệch cổng: `ESOCKET` + `reason`; sai altname: `ESOCKET` + `reason` (có `:`/`.`); cert tự ký:
 *     `ESOCKET` TRẦN — không `reason`/`errno`/`syscall` (nodemailer ghi đè mã gốc của Node) ⇒ suy ra TLS
 *     từ việc THIẾU trường mạng, vì lỗi socket thật luôn mang `errno` + `syscall`;
 *   - `530`/`538` ở AUTH = máy chủ đòi mã hoá trước khi đăng nhập, không phải sai mật khẩu.
 */
const TEST_MESSAGES = {
  internal: "Lỗi nội bộ khi kiểm tra kết nối — xem log máy chủ.",
  auth: "Xác thực SMTP thất bại",
  authNeedsTls:
    "Máy chủ yêu cầu kết nối mã hoá trước khi đăng nhập — bật «Dùng TLS» hoặc dùng cổng hỗ trợ STARTTLS.",
  timeout: "Hết thời gian chờ máy chủ SMTP — kiểm tra máy chủ, cổng và tường lửa.",
  dns: "Không phân giải được tên máy chủ SMTP.",
  refused: "Máy chủ từ chối kết nối — kiểm tra máy chủ và cổng.",
  network: "Lỗi mạng khi kết nối tới máy chủ SMTP — kiểm tra mạng, máy chủ và cổng.",
  tls: "Lỗi TLS/chứng chỉ — kiểm tra tuỳ chọn «Dùng TLS», cổng (465 dùng TLS, 587 dùng STARTTLS) và chứng chỉ máy chủ.",
  protocol: "Máy chủ không trả lời theo giao thức SMTP — kiểm tra cổng.",
  generic: "Kiểm tra kết nối thất bại.",
} as const;

/** `responseCode` ở AUTH nghĩa là "mã hoá trước đã" (RFC 3207 530 · RFC 4954 538). */
const AUTH_NEEDS_TLS_REPLIES = new Set(["530", "538"]);

const isPresent = (value: unknown): boolean => typeof value === "string" && value.length > 0;

/** Một câu cố định theo loại lỗi `verify()` — an toàn để trả cho client (không byte nào của server). */
export function classifySmtpTestError(err: unknown): string {
  // Lỗi lập trình (TypeError… khi nâng major thư viện) KHÔNG phải lỗi SMTP — câu riêng để admin không sửa
  // cấu hình vô ích; chi tiết (stack) chỉ ở log máy chủ (MailTransportService log `error`).
  if (isProgrammerError(err)) return TEST_MESSAGES.internal;
  const e = fieldsOf(err);
  const code = matching(e.code, ERROR_CODE);
  const reply = replyCode(e.responseCode);
  const errno = systemErrorName(e.errno);
  const hasSyscall = typeof e.syscall === "string" && SYSCALLS.has(e.syscall);

  if (code === "EAUTH") {
    return AUTH_NEEDS_TLS_REPLIES.has(reply) ? TEST_MESSAGES.authNeedsTls : TEST_MESSAGES.auth;
  }
  if (code === "ETIMEDOUT" || errno === "ETIMEDOUT") return TEST_MESSAGES.timeout;
  if (code === "EDNS" || e.syscall === "getaddrinfo") return TEST_MESSAGES.dns;
  if (errno === "ECONNREFUSED") return TEST_MESSAGES.refused;
  if (errno !== MISSING) return TEST_MESSAGES.network;
  if (code === "ETLS" || isPresent(e.reason) || (code === "ESOCKET" && !hasSyscall)) {
    return TEST_MESSAGES.tls;
  }
  if (reply !== MISSING) return `Máy chủ SMTP từ chối (mã ${reply}).`;
  if (code === "EPROTOCOL") return TEST_MESSAGES.protocol;
  return TEST_MESSAGES.generic;
}
