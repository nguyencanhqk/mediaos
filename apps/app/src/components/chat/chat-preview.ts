/**
 * S17-CHAT-UX2-FE-1 — dựng `ChatRoomLastMessageDto` từ MỘT tin đang có trên máy (CHAT-DEC-022).
 *
 * ┌─ ĐÂY LÀ BẢN SONG SONG CỦA `apps/api/src/chat/chat-preview.ts` ────────────────────────────────┐
 * │ Nguồn sự thật của `room.lastMessage` là SERVER (`buildLastMessagePreview`, lớp CHE + CẮT).     │
 * │ Bản này chỉ để VÁ CỤC BỘ khi `chat:message` về: không có nó thì dòng preview đứng im ở tin cũ  │
 * │ cho tới lần refetch REST kế tiếp — và WS tồn tại chính là để tránh chờ đó.                     │
 * │                                                                                                │
 * │ Vá cục bộ KHÔNG phải lỗ che: `message.body` đã nằm trong RAM của tab này (nó vừa được vẽ ra     │
 * │ bong bóng tin). Cắt ở đây là để dòng preview **giống hệt** bản server, không phải để giấu.      │
 * │                                                                                                │
 * │ Hai bản phải cho ra CÙNG chuỗi, nếu không dòng phòng nhảy chữ mỗi lần refetch. Ratchet ở        │
 * │ `chat-preview.parity.spec.ts` đọc file BE và so literal — trôi một bên là ĐỎ có tên file.       │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type { ChatMessageDto, ChatRoomLastMessageDto } from "@mediaos/contracts";

/**
 * Đầu vào là một LÁT CẤU TRÚC của `ChatMessageDto`, KHÔNG phải `StoredChatMessage` của store.
 *
 * Cố ý: `chat.store.ts` import hàm này, nên import ngược kiểu từ store lại là một vòng module (chỉ
 * `import type` nên bị xoá lúc biên dịch, nhưng nó vẫn dựng một vòng cho người đọc và cho mọi công cụ
 * phân tích tĩnh). Lát mỏng còn cho phép ca test dựng đầu vào bằng 6 khoá thay vì cả DTO.
 */
export type ChatPreviewSource = Pick<
  ChatMessageDto,
  "senderId" | "senderName" | "body" | "messageType" | "attachmentCount"
> & {
  /**
   * Nới `| undefined` CÓ CHỦ ĐÍCH, dù `chatMessageSchema.recalledAt` hôm nay là `.nullable()` KHÔNG
   * `.optional()`.
   *
   * Bản BE nhận hàng LATERAL nên phải phòng cả `undefined`, và guard của nó so ĐỦ HAI vế. Ratchet
   * literal không so được điều kiện guard, nên nếu FE chỉ so `!== null` thì ngày `recalledAt` được nới
   * thành `.optional()` (khuôn mà nhiều khoá khác trong `chat.ts` đã đi để tương thích ngược), FE sẽ
   * gọi một tin CHƯA từng bị thu hồi là «đã thu hồi» — còn BE thì không. Nới kiểu ở đây làm vế thứ hai
   * của guard bên dưới có NGHĨA thay vì là code chết.
   */
  recalledAt: ChatMessageDto["recalledAt"] | undefined;
};

/** Trần preview — **grapheme**, không phải code unit. Trùng `CHAT_PREVIEW_MAX_GRAPHEMES` của BE. */
export const CHAT_PREVIEW_MAX_GRAPHEMES = 120;

/**
 * Strip `\p{Cc}` (điều khiển C0/C1 — gồm `\n`, `\r`, `\t`) + `\p{Zl}`/`\p{Zp}` (U+2028/U+2029).
 *
 * **CỐ Ý KHÔNG strip `\p{Cf}`**: lớp đó chứa ZWJ (U+200D) và selector biến thể — chính là thứ GẮN một
 * cụm emoji lại với nhau. Strip nó biến 👨‍👩‍👧 thành ba emoji rời, đúng lỗi mà việc cắt theo grapheme
 * bên dưới tồn tại để tránh. Literal này bị ratchet so với bản BE.
 */
const CONTROL_OR_LINE_SEPARATOR = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

/**
 * `Intl.Segmenter` có ở mọi trình duyệt mục tiêu (Baseline 2024) và ở Node ≥18 — không thêm dependency.
 * Dựng MỘT lần ở module scope: khởi tạo lại trong vòng lặp render là một phép cấp phát mỗi tin về.
 */
const segmenter = new Intl.Segmenter("vi", { granularity: "grapheme" });

/**
 * Ép nội dung nhiều dòng về MỘT dòng: điều khiển → khoảng trắng, gom khoảng trắng, cắt hai đầu.
 * Chạy **TRƯỚC** khi cắt độ dài — nếu không, 120 grapheme đầu có thể toàn `\n` và preview ra trống
 * trong khi tin có nội dung.
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
 * Luật `kind` — thứ tự nhánh LÀ hợp đồng, mirror `buildLastMessagePreview` của BE:
 *
 *  1. **thu hồi thắng tất cả** ⇒ `'recalled'` + `excerpt: null` (SPEC-15 §13.6);
 *  2. **`system`** — tin do server sinh, vẫn hiện chữ nhưng FE vẽ xám;
 *  3. **có chữ ⇒ `'text'`, KỂ CẢ khi có đính kèm** (`attachmentCount` vẫn > 0 để vẽ kẹp giấy);
 *  4. **không chữ mà có tệp ⇒ `'file'`**;
 *  5. còn lại ⇒ `'text'` + `excerpt: null` (FE để dòng preview TRỐNG).
 */
export function previewFromMessage(message: ChatPreviewSource): ChatRoomLastMessageDto {
  // ⚠️ CỘT `attachmentCount` (đếm lúc INSERT), **KHÔNG** `attachments.length`. Server lấy đúng cột đó
  // (`chat-rooms.repository.ts`: `lastAttachmentCount: lastMessage.attachmentCount`), và hai giá trị
  // LỆCH nhau ở tin đã thu hồi — tin đó giữ `attachmentCount: 2` nhưng `attachments: []` (lớp che
  // §13.6). Đọc mảng ở đây làm dòng preview nhảy từ «2 tệp» về «0 tệp» rồi trở lại sau refetch.
  const attachmentCount = message.attachmentCount;
  const base = { senderId: message.senderId, senderName: message.senderName, attachmentCount };

  // Hai vế, khớp NGUYÊN VĂN guard của BE (`row.recalledAt !== null && row.recalledAt !== undefined`).
  if (message.recalledAt !== null && message.recalledAt !== undefined) {
    return { ...base, kind: "recalled", excerpt: null };
  }

  const flat = flattenToSingleLine(message.body ?? "");
  const excerpt = flat === "" ? null : truncateByGrapheme(flat, CHAT_PREVIEW_MAX_GRAPHEMES);

  if (message.messageType === "system") return { ...base, kind: "system", excerpt };
  if (excerpt !== null) return { ...base, kind: "text", excerpt };
  if (attachmentCount > 0) return { ...base, kind: "file", excerpt: null };
  return { ...base, kind: "text", excerpt: null };
}
