/**
 * S20-GOAL-DECOMPOSE-1 (US-GOAL-QL-08) — `?returnTo=` của `/goals/templates`: sau khi lưu mẫu mới, trang
 * mẫu quay lại nơi gọi (wizard phân rã). Tham số đến từ URL ⇒ ai cũng soạn được ⇒ CHỈ nhận đường dẫn
 * NỘI BỘ của ứng dụng; mọi thứ khác bị bỏ (trang mẫu hoạt động như khi không có tham số).
 *
 * Quy tắc DƯƠNG (liệt kê cái được phép, không đoán cái bị cấm):
 *  1. chuỗi, dài ≤ {@link RETURN_TO_MAX_LENGTH};
 *  2. chỉ gồm ký tự hợp lệ của một URL tương đối — chữ/số ASCII và `-._~!$&'()*+,;=:@%/?#`; KHÔNG
 *     khoảng trắng, ký tự điều khiển, `\` (trình duyệt bỏ tab/xuống dòng và coi `\` như `/`);
 *  3. bắt đầu bằng ĐÚNG MỘT `/` và không chứa `//` ở đâu cả;
 *  4. giải mã phần trăm (lặp tới khi ổn định, tối đa {@link MAX_DECODE_ROUNDS} vòng) vẫn thoả 3 và
 *     không lộ `\` hay ký tự điều khiển — chặn `%2F%2F`, `%5C`, mã kép `%252F`. Giải mã hỏng ⇒ bỏ.
 * Không có scheme nào lọt được vì ký tự đầu luôn là `/` và ký tự thứ hai không phải `/`.
 */

/** Trần độ dài — đường dẫn nội bộ thật (kèm search) chưa tới vài trăm ký tự. */
export const RETURN_TO_MAX_LENGTH = 512;
/** Số vòng giải mã tối đa; sau đó còn đổi ⇒ coi là mã lồng bất thường và bỏ. */
const MAX_DECODE_ROUNDS = 3;

const URL_CHARS = /^[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/;
/** Ký tự điều khiển C0 (< 0x20) và DEL. */
const FIRST_PRINTABLE = 0x20;
const DEL = 0x7f;

function hasControlOrBackslash(value: string): boolean {
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < FIRST_PRINTABLE || code === DEL || ch === "\\") return true;
  }
  return false;
}

function isSingleSlashPath(value: string): boolean {
  return value.startsWith("/") && !value.includes("//");
}

function fullyDecoded(value: string): string | null {
  let current = value;
  for (let round = 0; round < MAX_DECODE_ROUNDS; round += 1) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) return current;
    current = next;
  }
  return null;
}

/** Đường dẫn nội bộ an toàn hoặc `null` (giá trị sai ⇒ người gọi dùng đích mặc định). */
export function sanitizeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > RETURN_TO_MAX_LENGTH) return null;
  if (!URL_CHARS.test(raw) || !isSingleSlashPath(raw)) return null;
  const decoded = fullyDecoded(raw);
  if (decoded === null || hasControlOrBackslash(decoded)) return null;
  return isSingleSlashPath(decoded) ? raw : null;
}

export interface TaskTemplateListSearch {
  returnTo?: string | undefined;
}

/**
 * `validateSearch` của `/goals/templates` — returnTo sai ⇒ `undefined`, không ném.
 *
 * ⚠️ PHẢI ghi đè khoá bằng `undefined` chứ không được BỎ khoá: TanStack trộn search THÔ với kết quả
 * validate (`{ ...raw, ...validated }`), nên bỏ khoá thì `useSearch().returnTo` vẫn là giá trị thô
 * chưa lọc (đã đo ở GoalDecomposeWizardResume.spec). Trang dùng còn lọc lại lần nữa ở chỗ dùng.
 */
export function validateTaskTemplateListSearch(
  raw: Record<string, unknown>,
): TaskTemplateListSearch {
  return { returnTo: sanitizeReturnTo(raw?.returnTo) ?? undefined };
}
