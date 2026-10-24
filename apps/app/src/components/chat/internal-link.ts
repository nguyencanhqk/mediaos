/**
 * S20-CHAT-INTERNALLINK-1 (US-X-11) — bộ phân loại THUẦN: một link trong tin nhắn có phải đích NỘI BỘ
 * của ứng dụng không, và nếu phải thì mở bằng cách nào.
 *
 * `href` là chuỗi NGƯỜI DÙNG GÕ (đã qua `splitTextWithLinks`, nên chỉ còn `http`/`https`). Hàm chỉ trả
 * DỮ LIỆU; component quyết định điều hướng. Link nào không chắc chắn nội bộ ⇒ `null` ⇒ giữ đường cũ
 * (tab mới, `rel` đã chốt) — sai theo hướng này chỉ tốn một tab, sai theo hướng kia là app tự đi tới
 * một đích người gửi dựng ra.
 *
 * Luật (đều là allowlist, không có blocklist):
 * - có `\` hoặc `%5C` ở BẤT KỲ đâu trong chuỗi thô ⇒ không nội bộ. Phải xét chuỗi THÔ: `new URL` đổi
 *   `\` thành `/` với scheme đặc biệt, nên sau khi parse không còn thấy dấu này nữa;
 * - `new URL(href)` không kèm base ⇒ href tương đối / không parse được bị loại ngay;
 * - scheme phải là `http:`/`https:`, origin phải TRÙNG `appOrigin` (so cả scheme + host + cổng), không
 *   có phần người dùng trước host; origin trang là `"null"` (khung sandbox) ⇒ không gì là nội bộ;
 * - `pathname` phải khớp MỘT mẫu neo `^…$` trong `INTERNAL_ROUTES` (nên `//…` đầu đường, đuôi thừa,
 *   id không phải UUID đều rơi ra ngoài).
 */

export type InternalLinkTarget =
  /** `/tasks/<uuid>` — drawer việc tại chỗ (`?task=`). */
  | { kind: "task"; taskId: string }
  /** `/chat/<uuid>[?msg=<uuid>]` — luật mở phòng theo liên kết của S20-CHAT-DEEPLINK-1. */
  | { kind: "chat-room"; roomId: string; messageId: string | null }
  /** Trang khác trong allowlist — router điều hướng tới `pathname + search` (bỏ `#`). */
  | { kind: "route"; href: string };

type RouteKind = InternalLinkTarget["kind"];

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const BACKSLASH_RE = /\\|%5c/i;

/** Allowlist đường dẫn nội bộ. Thêm đích mới = thêm MỘT dòng neo `^…$`; nhóm bắt 1 (nếu có) là id. */
const INTERNAL_ROUTES: readonly { pattern: RegExp; kind: RouteKind }[] = [
  { pattern: new RegExp(`^/tasks/(${UUID})/?$`), kind: "task" },
  { pattern: new RegExp(`^/chat/(${UUID})/?$`), kind: "chat-room" },
  { pattern: new RegExp(`^/tasks/projects/${UUID}/?$`), kind: "route" },
  { pattern: new RegExp(`^/goals/${UUID}/?$`), kind: "route" },
  { pattern: /^\/notifications\/?$/, kind: "route" },
  { pattern: new RegExp(`^/notifications/${UUID}/?$`), kind: "route" },
];

function parseAbsoluteHttpUrl(href: string): URL | null {
  try {
    const url = new URL(href);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function toTarget(kind: RouteKind, id: string | undefined, url: URL): InternalLinkTarget | null {
  if (kind === "task") return id ? { kind, taskId: id } : null;
  if (kind === "chat-room") {
    if (!id) return null;
    const msg = url.searchParams.get("msg");
    return { kind, roomId: id, messageId: msg !== null && UUID_RE.test(msg) ? msg : null };
  }
  return { kind, href: `${url.pathname}${url.search}` };
}

/** Đích nội bộ của `href`, hoặc `null` khi phải giữ đường link ngoài (tab mới). */
export function classifyInternalLink(href: string, appOrigin: string): InternalLinkTarget | null {
  if (BACKSLASH_RE.test(href)) return null;
  const url = parseAbsoluteHttpUrl(href);
  if (url === null || appOrigin === "null" || url.origin !== appOrigin) return null;
  if (url.username !== "" || url.password !== "") return null;
  for (const { pattern, kind } of INTERNAL_ROUTES) {
    const match = pattern.exec(url.pathname);
    if (match) return toTarget(kind, match[1], url);
  }
  return null;
}
