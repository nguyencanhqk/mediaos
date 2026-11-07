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

/** `http(s)://` CHỮ THƯỜNG ở ĐẦU chuỗi, không khoảng trắng (dịch vụ ký chỉ phát dạng này). */
const AVATAR_URL_RE = /^https?:\/\/\S+$/;
/** Chữ ký SigV4 TRONG query (trước `#`), đúng 64 hex thường — dấu của URL presign. */
const SIGV4_SIGNATURE_RE = /^[^#]*[?&]X-Amz-Signature=[0-9a-f]{64}(?:[&#]|$)/;

/**
 * S16-SOCIAL-AVATARPRESIGN-1 (owner D8) — `src` cho `Avatar` từ `avatarUrl`/`avatar` của SOCIAL.
 *
 * Server trả URL ĐÃ KÝ hoặc `null` (che dữ liệu là việc của SERVER — hàm này KHÔNG phải lớp che). Đây là
 * vệ sinh render: CHỈ hình dạng API phát ra cho avatar SOCIAL — URL presign SigV4 của `ObjectStorageService`
 * (owner D2-b: server bỏ mọi URL http(s) khác) — mới thành `src`; mọi thứ khác ⇒ `undefined` ⇒ chữ cái đầu.
 *
 * Lý do tồn tại: FE tự deploy khi merge còn API PROD deploy tay — trong khe đó API CŨ trả NGUYÊN cột
 * `employee_profiles.avatar_url`: fileId (`<img src="<uuid>">` = URL tương đối ⇒ ảnh vỡ) hoặc URL http(s)
 * NGOÀI (beacon ghi IP/UA người xem — đúng thứ D2-b chặn). Chỉ nhận hình dạng presign ⇒ cả hai thành chữ
 * cái đầu (FULL gate lượt 1 sửa nhận định cũ «thứ tự deploy nào cũng vô hại» — chỉ đúng với fileId).
 * ⚠️ Còn sót có ghi: một giá trị CỐ Ý dựng giả hình dạng presign vẫn qua tới khi API ≥ WO này được deploy
 * ⇒ deploy API PROD TRƯỚC hoặc CÙNG đợt FE (ghi ở notes WO).
 */
export function avatarSrc(value: string | null | undefined): string | undefined {
  return value && AVATAR_URL_RE.test(value) && SIGV4_SIGNATURE_RE.test(value) ? value : undefined;
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

/**
 * Số ảnh nhiều nhất vẽ trong lưới MẶC ĐỊNH (thẻ bảng tin · bình luận · tin); phần dư hiện dưới dạng «+N» trên
 * ô cuối. Trang chi tiết bài truyền trần riêng qua `max` của `buildImageGrid`.
 */
export const IMAGE_GRID_MAX = 4;

/** Đính kèm VẼ được: `url` có mặt VÀ là `http(s)` (xem `isSafeAttachmentUrl`). */
export type RenderableAttachment = FeedAttachmentDto & { url: string };

export interface FeedImageGrid {
  /** Ảnh thực sự được vẽ (≤ `max` của `buildImageGrid` — mặc định `IMAGE_GRID_MAX`). */
  shown: RenderableAttachment[];
  /** Số ảnh còn lại, hiện đè lên ô cuối. `0` ⇒ không vẽ lớp phủ. */
  overflow: number;
  /** Số cột Tailwind cho lưới — 1 ảnh thì tràn khung, từ 2 trở lên thì 2 cột. */
  columns: 1 | 2;
}

/** S16-SOCIAL-FE-2D — chỉ `http`/`https` (không phân biệt hoa thường — cùng tư thế `URL_RE` của thân bài). */
const SAFE_ATTACHMENT_URL_RE = /^https?:\/\//i;

/**
 * URL đính kèm có VẼ được không (S16-SOCIAL-FE-2D, plan §3 + §4 A8 · ca R5).
 *
 * Bất biến: CHỈ URL `http(s)` mới thành `src` / `href`. `feedAttachmentSchema.url` là `z.string()` trần — hợp
 * đồng không kiểm lược đồ (đo M32) — và React vẽ `src` NGUYÊN VĂN (đo M33), nên vị từ này là chốt ở phía render:
 * mọi lược đồ khác, kể cả URL tương đối giao thức (`//host`), coi như `url:null` ⇒ KHÔNG vẽ.
 * Vị từ chỉ lo LƯỢC ĐỒ của URL; tệp được trả về ra sao là việc của server (ảnh / video hiển thị trực tiếp, mọi
 * loại khác về dạng tải xuống — xem docblock `PostAttachments.tsx`).
 * Lỏng hơn `avatarSrc` có chủ ý: URL đính kèm LUÔN do server ký hoặc `null`; `avatarSrc` còn phải loại URL không ký.
 */
export function isSafeAttachmentUrl(url: string): boolean {
  return SAFE_ATTACHMENT_URL_RE.test(url);
}

/** MỘT vị từ cho cả ảnh · video · tệp: `url:null` (presign bị từ chối) hoặc lược đồ lạ ⇒ không vẽ. */
function isRenderableAttachment(a: FeedAttachmentDto): a is RenderableAttachment {
  return a.url !== null && isSafeAttachmentUrl(a.url);
}

/**
 * Chuẩn bị lưới ảnh từ danh sách đính kèm.
 *
 * ⚠️ **LỌC `url === null` RA TRƯỚC.** `feedAttachmentSchema.url` nullable vì `FilePolicyService` quyết
 * định presign **theo từng người nhận** và từ chối thì trả `null` (fail-soft, khuôn
 * `chat-attachments.service.ts`). Vẽ một `<img src={null}>` cho ra ô ảnh vỡ — tệ hơn là nó **rò thông
 * tin**: người xem biết "có một ảnh ở đây mà tôi không được xem". Đếm `overflow` vì vậy cũng phải đếm
 * trên tập ĐÃ LỌC, không trên `attachments.length`. S16-SOCIAL-FE-2D: cùng vị từ lọc luôn URL không phải
 * `http(s)` (`isRenderableAttachment`).
 *
 * Thứ tự cố định: LỌC → rồi mới CẮT theo `max` (mặc định `IMAGE_GRID_MAX`).
 */
export function buildImageGrid(
  attachments: readonly FeedAttachmentDto[],
  max: number = IMAGE_GRID_MAX,
): FeedImageGrid {
  const images = attachments.filter(
    (a): a is RenderableAttachment => a.kind === "image" && isRenderableAttachment(a),
  );
  const shown = images.slice(0, max);
  return {
    shown,
    overflow: Math.max(0, images.length - shown.length),
    columns: shown.length <= 1 ? 1 : 2,
  };
}

export interface FeedAttachmentGroups {
  grid: FeedImageGrid;
  /** Video VẼ được (`url` http(s)) — ẩn HẲN video `url:null` như ảnh (owner ký D4 (a)). */
  videos: RenderableAttachment[];
  /** Tệp khác VẼ được — cùng luật. */
  files: RenderableAttachment[];
}

/**
 * S16-SOCIAL-FE-2D (plan §4 A8) — tách đính kèm thành lưới ảnh · video · tệp. CẢ BA đi qua MỘT vị từ
 * (`isRenderableAttachment`): một ô video/tệp «có mà bạn không xem được» rò sự tồn tại y như ảnh (D4).
 */
export function splitAttachments(
  attachments: readonly FeedAttachmentDto[],
  maxImages: number = IMAGE_GRID_MAX,
): FeedAttachmentGroups {
  return {
    grid: buildImageGrid(attachments, maxImages),
    videos: attachments.filter(
      (a): a is RenderableAttachment => a.kind === "video" && isRenderableAttachment(a),
    ),
    files: attachments.filter(
      (a): a is RenderableAttachment => a.kind === "file" && isRenderableAttachment(a),
    ),
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
