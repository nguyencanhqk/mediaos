/**
 * S20-CHAT-MSGTOTASK-1 (US-CHAT-NV-10) — điền sẵn form Tạo việc từ MỘT tin nhắn. Hàm thuần, không React.
 *
 * ┌─ CHỈ ĐỌC `body` ──────────────────────────────────────────────────────────────────────────────────┐
 * │ Mọi hàm ở đây nhận CHUỖI văn bản của tin, không nhận cả `StoredChatMessage`. Cố ý: đính kèm mang URL │
 * │ ký (hết hạn, cấp riêng từng người nhận), objectKey và tên tệp — chép chúng vào mô tả việc là phát   │
 * │ lại cho mọi người xem được việc một thứ server chỉ ký cho thành viên phòng (Q4 = A).                │
 * └────────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Trần tiêu đề điền sẵn (story US-CHAT-NV-10) — người dùng vẫn gõ dài hơn được tới trần của form. */
export const MESSAGE_TO_TASK_TITLE_MAX = 120;

/**
 * Dòng đầu KHÔNG rỗng của tin, cắt ≤ 120 ký tự. Đếm theo code point (`Array.from`) để không cắt đôi một
 * emoji/ký tự ngoài BMP thành nửa cặp surrogate. Tin chỉ có tệp (`null`/rỗng) ⇒ `""` — form bắt nhập.
 */
export function titleFromMessageBody(body: string | null): string {
  const firstLine = (body ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "";
  const chars = Array.from(firstLine);
  return chars.length <= MESSAGE_TO_TASK_TITLE_MAX
    ? firstLine
    : chars.slice(0, MESSAGE_TO_TASK_TITLE_MAX).join("").trimEnd();
}

/** Link mở lại đúng tin trong phòng — `ChatPage` đọc `?msg=` (S20-CHAT-DEEPLINK-1). */
export function chatMessageUrl(origin: string, roomId: string, messageId: string): string {
  return `${origin}/chat/${encodeURIComponent(roomId)}?msg=${encodeURIComponent(messageId)}`;
}

/** Link việc gửi vào phòng khi người dùng bật tuỳ chọn — CHỈ URL, không kèm tiêu đề hay mô tả. */
export function taskUrl(origin: string, taskId: string): string {
  return `${origin}/tasks/${encodeURIComponent(taskId)}`;
}

/** Mô tả = văn bản tin (nếu có) · dòng trống · dòng nguồn · link về tin. */
export function descriptionFromMessageBody(
  body: string | null,
  sourceLine: string,
  messageUrl: string,
): string {
  const text = (body ?? "").trim();
  const footer = `${sourceLine}\n${messageUrl}`;
  return text.length > 0 ? `${text}\n\n${footer}` : footer;
}
