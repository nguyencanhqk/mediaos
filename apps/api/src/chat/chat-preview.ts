import type { ChatRoomLastMessageDto } from "@mediaos/contracts";

/**
 * S17-CHAT-UX2-BE-1 — dựng `chatRoomSchema.lastMessage` (CHAT-DEC-022 · SPEC-15 §15b · API-13 §5.1d(1)).
 *
 * ┌─ ĐÂY LÀ LỚP CHE, KHÔNG PHẢI LỚP ĐỊNH DẠNG ────────────────────────────────────────────────────┐
 * │ Cắt và che ở ĐÂY (server) chứ không ở FE — cắt ở client là không cắt gì cả: toàn bộ nội dung   │
 * │ tin vẫn đi qua dây, vào DevTools, vào cache của trình duyệt. Cùng lớp với `toChatMessageDto`   │
 * │ (`chat.mapper.ts`) che `body` của tin đã thu hồi (SPEC-15 §13.6).                              │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Hàm THUẦN, 0 I/O: caller (`ChatRoomsService.listRooms`) đã có sẵn hàng từ LATERAL của
 * `listRoomsForUser`. Tách khỏi mapper vì luật `kind` có 5 nhánh và mỗi nhánh cần một ca test riêng.
 */

/**
 * Trần preview — **grapheme**, không phải code unit (API-13 §5.1d(1)).
 *
 * `String.prototype.slice(0, 120)` cắt theo UTF-16 code unit ⇒ chẻ đôi một emoji (surrogate pair), một
 * cụm ZWJ (👨‍👩‍👧), hay một ký tự Việt tổ hợp NFD từ máy Mac — kết quả là ký tự thay thế U+FFFD trên UI
 * của người dùng. `Intl.Segmenter` có sẵn trong Node ≥18, không thêm dependency.
 */
export const CHAT_PREVIEW_MAX_GRAPHEMES = 120;

/**
 * ⚠️ Strip `\p{Cc}` (ký tự điều khiển C0/C1 — gồm `\n`, `\r`, `\t`) + `\p{Zl}`/`\p{Zp}` (U+2028/U+2029).
 *
 * **CỐ Ý KHÔNG strip `\p{Cf}`**: lớp đó chứa ZWJ (U+200D) và các selector biến thể — chính là thứ GẮN
 * một cụm emoji lại với nhau. Strip nó sẽ biến 👨‍👩‍👧 thành ba emoji rời, đúng cái lỗi mà việc cắt theo
 * grapheme ở dưới tồn tại để tránh.
 */
const CONTROL_OR_LINE_SEPARATOR = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

const segmenter = new Intl.Segmenter("vi", { granularity: "grapheme" });

/**
 * Ép nội dung nhiều dòng về MỘT dòng preview: điều khiển → khoảng trắng, gom khoảng trắng liên tiếp,
 * cắt hai đầu. Chạy **TRƯỚC** khi cắt độ dài — nếu không, 120 grapheme đầu có thể toàn `\n` và dòng
 * preview ra trống trong khi tin có nội dung.
 */
function flattenToSingleLine(body: string): string {
  return body.replace(CONTROL_OR_LINE_SEPARATOR, " ").replace(/\s+/gu, " ").trim();
}

/** Cắt theo cụm ký tự (grapheme cluster), không bao giờ chẻ giữa một cụm. */
export function truncateByGrapheme(text: string, max: number): string {
  let out = "";
  let count = 0;
  for (const { segment } of segmenter.segment(text)) {
    if (count >= max) return out;
    out += segment;
    count += 1;
  }
  return out;
}

/**
 * Hàng tin cuối lấy từ LATERAL. Mọi trường nullable vì `LEFT JOIN LATERAL` trả NULL cho phòng chưa có
 * tin nào — và "chưa có tin" phải ra `lastMessage: null`, không phải một object rỗng.
 */
export interface ChatLastMessageRow {
  senderId: string | null;
  senderName: string | null;
  body: string | null;
  messageType: string | null;
  attachmentCount: number | null;
  recalledAt: Date | string | null;
}

/**
 * Luật `kind` — thứ tự nhánh LÀ hợp đồng, không phải sở thích:
 *
 *  1. **thu hồi thắng tất cả** ⇒ `kind:'recalled'` + `excerpt: null` (SPEC-15 §13.6). Đặt đầu tiên để
 *     không nhánh nào phía dưới có cơ hội trả nội dung ra ngoài.
 *  2. **`system`** — tin do SERVER sinh (thêm/bớt thành viên, đổi tên phòng). Nội dung của nó không phải
 *     lời người dùng nên vẫn hiện được, nhưng FE cần biết để vẽ chữ nghiêng/xám.
 *  3. **có chữ ⇒ `'text'`, KỂ CẢ khi có đính kèm** — chữ là thứ người đọc được trong một dòng preview.
 *     `attachmentCount` VẪN được trả > 0 trong cùng bản ghi để FE vẽ kẹp giấy: hai trường KHÔNG loại trừ
 *     nhau (API-13 §5.1d(1)). Ai đọc `kind === 'file'` để suy "có tệp" sẽ bỏ sót đúng ca phổ biến nhất.
 *  4. **không chữ mà có tệp ⇒ `'file'`** — FE hiện «📎 2 tệp», `excerpt: null`.
 *  5. còn lại (`body` rỗng, 0 tệp — `chat_messages.body` NOT NULL nên chuỗi rỗng là giá trị hợp lệ ở DB)
 *     ⇒ `'text'` + `excerpt: null`. FE để dòng preview TRỐNG.
 *
 * `senderName` KHÔNG bị ẩn khi người gửi đã rời phòng / bị vô hiệu hoá — nhất quán với roster
 * `CHAT-API-007a`, vốn cố ý giữ người đã rời kèm `leftAt` thay vì ẩn tên.
 */
export function buildLastMessagePreview(
  row: ChatLastMessageRow | null | undefined,
): ChatRoomLastMessageDto | null {
  if (!row || row.senderId === null) return null;

  const attachmentCount = row.attachmentCount ?? 0;
  const base = { senderId: row.senderId, senderName: row.senderName, attachmentCount };

  if (row.recalledAt !== null && row.recalledAt !== undefined) {
    return { ...base, kind: "recalled", excerpt: null };
  }

  const flat = flattenToSingleLine(row.body ?? "");
  const excerpt = flat === "" ? null : truncateByGrapheme(flat, CHAT_PREVIEW_MAX_GRAPHEMES);

  if (row.messageType === "system") return { ...base, kind: "system", excerpt };
  if (excerpt !== null) return { ...base, kind: "text", excerpt };
  if (attachmentCount > 0) return { ...base, kind: "file", excerpt: null };
  return { ...base, kind: "text", excerpt: null };
}
