/**
 * Trải chuỗi `Error.cause` thành object log được.
 *
 * Vì sao cần: Drizzle bọc lỗi PG và GIẤU mã lỗi (SQLSTATE) trong `cause`
 * (memory `drizzle-wraps-pg-error-code-in-cause`). Log mỗi `error.message` là vứt đúng thứ duy nhất
 * phân biệt được 42501 với cạn connection pool.
 *
 * BẤT BIẾN: hai hàm ở đây KHÔNG BAO GIỜ ném. Chúng chạy TRONG khối `catch` của `getCapabilities` /
 * `getCapabilityScopes` (nhánh trả `{}`) và trong `onError` của hai ảnh chụp catalog (nhánh fail-closed
 * của `can()`) — hàm quan sát mà ném ở đó thì chính đường suy biến an toàn hỏng theo. Giá trị ném ra
 * trong JS là BẤT KỲ: `String(Object.create(null))` ném TypeError, `toString`/`Symbol.toPrimitive`/getter
 * có thể ném, `instanceof` trên Proxy có thể ném ⇒ mọi lần đọc/ép kiểu đều đi qua `attempt`.
 *
 * Chặn vòng (`seen`) + TRẦN ĐỘ SÂU: chuỗi `cause` có thể tự tham chiếu; không chặn thì hàm quan sát này
 * tự đệ quy vô hạn — tức một hàm sinh ra để chẩn đoán sự cố lại thành sự cố.
 *
 * Quy ước log của `PermissionService`: `{ error: serializeErrorChain(error), stack: safeErrorStack(error) }`
 * — Nest chỉ nhận stack khi nó là CHUỖI ở trường riêng, nên stack không nằm trong object này.
 * Tách khỏi `permission.service.ts` (S14-SEC-CAPWILDCARD-1, gate F4) để tệp đó không dài thêm.
 */
const MAX_CAUSE_DEPTH = 4;
const TRUNCATED = "[cause chain truncated]";
const CYCLE = "[cause cycle]";
const UNREADABLE = "[unreadable]";

/** Chạy `read`; ném thì trả `fallback`. Không có nhánh nào để lọt ngoại lệ ra người gọi. */
function attempt<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** `typeof` không bao giờ ném (kể cả Proxy đã revoke) ⇒ là dự phòng cuối cùng an toàn. */
function safeString(value: unknown): string {
  return attempt(() => String(value), `[unstringifiable ${typeof value}]`);
}

function isError(value: unknown): value is Error {
  return attempt(() => value instanceof Error, false);
}

/** Mã lỗi giữ nguyên nếu là string/number (SQLSTATE, errno); kiểu khác ép chuỗi để object log in được. */
function safeCode(error: Error): unknown {
  const code = attempt(() => (error as { code?: unknown }).code, UNREADABLE);
  if (code === undefined || typeof code === "string" || typeof code === "number") return code;
  return safeString(code);
}

function serializeNode(error: unknown, depth: number, seen: Set<unknown>): unknown {
  if (depth >= MAX_CAUSE_DEPTH) return TRUNCATED;
  if (!isError(error)) return error === undefined ? undefined : safeString(error);
  if (seen.has(error)) return CYCLE;
  seen.add(error);

  const cause = attempt(() => error.cause, UNREADABLE);
  return {
    name: safeString(attempt(() => error.name, UNREADABLE)),
    message: safeString(attempt(() => error.message, UNREADABLE)),
    code: safeCode(error),
    cause: cause === undefined ? undefined : serializeNode(cause, depth + 1, seen),
  };
}

export function serializeErrorChain(error: unknown): unknown {
  return attempt(() => serializeNode(error, 0, new Set()), UNREADABLE);
}

/** `stack` cho trường riêng của dòng log; không phải Error / getter ném / không phải chuỗi ⇒ `undefined`. */
export function safeErrorStack(error: unknown): string | undefined {
  if (!isError(error)) return undefined;
  const stack = attempt<unknown>(() => error.stack, undefined);
  return typeof stack === "string" ? stack : undefined;
}
