/**
 * S16-SOCIAL-FE-1 — hàm THUẦN của cổng thông tin: tên hiển thị · mốc thời gian · lưới ảnh.
 *
 * Tách khỏi component để test bằng gọi hàm (không dựng DOM) và để cùng một luật không có hai bản sao
 * ở thẻ bài, chi tiết bài và trang cá nhân. Khuôn: `components/chat/chat-format.ts`.
 */
import { formatDistanceToNowStrict } from "date-fns";
import { vi } from "date-fns/locale";
import type { FeedAttachmentDto, FeedAuthorDto } from "@mediaos/contracts";

/**
 * Tên tác giả để hiển thị.
 *
 * `fullName` **nullable** trong `feedAuthorSchema` — nó null khi hồ sơ nhân sự đã bị xoá mềm / người
 * đã rời công ty. Trả nhãn dự phòng do caller truyền vào (chuỗi i18n) thay vì chuỗi rỗng: một dòng
 * "  vừa đăng" không tên đọc như giao diện hỏng, còn «Người dùng đã rời công ty» là một sự thật.
 *
 * ⚠️ KHÔNG rơi về `employeeId`: phơi id ra thẻ bài biến dòng cuộn thành bản đồ id của cả công ty —
 * đúng điều `feedAuthorSchema` cố ý tránh khi không trả `userId`.
 */
export function authorDisplayName(author: FeedAuthorDto, fallback: string): string {
  const name = author.fullName?.trim();
  return name && name.length > 0 ? name : fallback;
}

/** `http://` hoặc `https://` ở đầu chuỗi — scheme duy nhất được thành `src` của ảnh đại diện. */
const AVATAR_SRC_RE = /^https?:\/\//i;

/**
 * S16-SOCIAL-AVATARPRESIGN-1 (owner D8) — `src` cho `Avatar` từ `avatarUrl`/`avatar` của SOCIAL.
 *
 * Server trả URL ĐÃ KÝ hoặc `null` (che dữ liệu là việc của SERVER — hàm này KHÔNG phải lớp che). Đây là
 * vệ sinh render: chỉ chuỗi `http(s)://` mới thành `src`, mọi thứ khác ⇒ `undefined` ⇒ chữ cái đầu.
 * Lý do tồn tại: FE tự deploy khi merge còn API PROD deploy tay — trong khe đó API cũ vẫn trả fileId
 * thô, và `<img src="<uuid>">` là URL TƯƠNG ĐỐI ⇒ ảnh vỡ (+ một request rác tới chính app). Với
 * helper, thứ tự deploy nào cũng vô hại: FE trước ⇒ chữ cái đầu, API trước ⇒ ảnh.
 */
export function avatarSrc(value: string | null | undefined): string | undefined {
  return value && AVATAR_SRC_RE.test(value) ? value : undefined;
}

/**
 * Mốc thời gian tương đối («3 phút trước»).
 *
 * `formatDistanceToNowStrict` chứ không `formatDistanceToNow`: bản không-strict thêm "khoảng"/"hơn"
 * (`about 1 hour`) làm dòng thời gian của bảng tin dài ngắn thất thường.
 *
 * Chuỗi không parse được ⇒ trả chuỗi rỗng, **không ném**. Một mốc thời gian hỏng không được phép
 * đánh sập cả thẻ bài (và qua đó cả dòng cuộn) — đây là dữ liệu hiển thị, không phải bất biến.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: vi });
}

/** Số ảnh nhiều nhất vẽ trong lưới; phần dư hiện dưới dạng «+N» trên ô cuối. */
export const IMAGE_GRID_MAX = 4;

export interface FeedImageGrid {
  /** Ảnh thực sự được vẽ (≤ `IMAGE_GRID_MAX`). */
  shown: FeedAttachmentDto[];
  /** Số ảnh còn lại, hiện đè lên ô cuối. `0` ⇒ không vẽ lớp phủ. */
  overflow: number;
  /** Số cột Tailwind cho lưới — 1 ảnh thì tràn khung, từ 2 trở lên thì 2 cột. */
  columns: 1 | 2;
}

/**
 * Chuẩn bị lưới ảnh từ danh sách đính kèm.
 *
 * ⚠️ **LỌC `url === null` RA TRƯỚC.** `feedAttachmentSchema.url` nullable vì `FilePolicyService` quyết
 * định presign **theo từng người nhận** và từ chối thì trả `null` (fail-soft, khuôn
 * `chat-attachments.service.ts`). Vẽ một `<img src={null}>` cho ra ô ảnh vỡ — tệ hơn là nó **rò thông
 * tin**: người xem biết "có một ảnh ở đây mà tôi không được xem". Đếm `overflow` vì vậy cũng phải đếm
 * trên tập ĐÃ LỌC, không trên `attachments.length`.
 */
export function buildImageGrid(attachments: readonly FeedAttachmentDto[]): FeedImageGrid {
  const images = attachments.filter((a) => a.kind === "image" && a.url !== null);
  const shown = images.slice(0, IMAGE_GRID_MAX);
  return {
    shown,
    overflow: Math.max(0, images.length - shown.length),
    columns: shown.length <= 1 ? 1 : 2,
  };
}

/**
 * Loại bài mà thẻ vẽ được THÂN (`PostBody`).
 *
 * 🔴 **R16** — `feedPostSchema.type` là `z.string()`, KHÔNG phải enum đóng. Hàm này để `PostCard` biết
 * khi nào chỉ nên vẽ phần CHUNG (tác giả · thời gian · cảm xúc · bình luận) và bỏ phần thân đặc thù —
 * **suy biến an toàn**, không ném (ca **C27**).
 *
 * S16-SOCIAL-FE-2 lát A: thêm `poll` (thân = MÔ TẢ tuỳ chọn, NULL thì `PostBody` tự không vẽ — plan
 * §8 M8) và `idea` (thân BẮT BUỘC với idea). S16-SOCIAL-FE-2C: thêm `kudos` — thân kudos tuỳ chọn (composer
 * của FE KHÔNG gửi, lời nhắn nằm trong `post.kudos.message`); client khác gửi `body` thì vẫn hiện, NULL thì
 * `PostBody` tự không vẽ. Loại lạ vẫn `false`.
 */
export function isFullyRenderableType(type: string): boolean {
  return (
    type === "share" || type === "news" || type === "poll" || type === "idea" || type === "kudos"
  );
}
