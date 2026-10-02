/**
 * S16-SOCIAL-FE-1 — tham số URL của `/feed` và bộ lọc/chuẩn hoá chúng.
 *
 * ┌─ VÌ SAO TÁCH KHỎI `router.tsx` ──────────────────────────────────────────────────────────────┐
 * │ 1. **Để test được.** Nằm trong `router.tsx` thì nó không export, và muốn chạm tới phải nạp cả  │
 * │    một file 3.500+ dòng cùng toàn bộ cây route lazy — không ca nào đo trực tiếp được trần của  │
 * │    `wish` (xem dưới), thứ vừa là một quyết định an toàn.                                       │
 * │ 2. **Vì `FeedRouteSearch` từng khai HAI LẦN và lệch nhau**: `router.tsx` chép tay literal      │
 * │    `sort?: "active" | "latest"`, còn `FeedPage.tsx` dùng `FeedSortDto`. Thêm một giá trị thứ   │
 * │    ba vào `feedSortSchema` thì bộ lọc ở đây **âm thầm nuốt nó** trong khi màn hình tưởng là    │
 * │    hợp lệ. Một nguồn duy nhất thì không có chỗ cho sự lệch đó.                                 │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ KHÔNG nhầm với `lib/feed-search-params.ts` (đã xoá ở WO này vì là mã chết) — file đó dựng tham
 * số gửi LÊN API, file này lọc tham số ĐỌC TỪ URL.
 *
 * ┌─ S16-SOCIAL-FESEARCHBOUNDS-1 — «KHÔNG NÉM» CHƯA ĐỦ, còn phải «KHÔNG 400» ─────────────────────┐
 * │ `tag`/`type`/`q` đọc từ URL được `FeedPage` CHUYỂN TIẾP lên `001`/`023`. Chuyển nguyên xi thì   │
 * │ `?tag=%20` · thẻ > trần · `type` > trần · `q` > `FEED_SEARCH_QUERY_MAX` đều là **400 ⇒ bảng tin │
 * │ ra màn LỖI** — đúng cái kết cục mà luật «không ném» (C17) dựng ra để tránh, chỉ dời xuống một   │
 * │ tầng. Mỗi trường giờ đi qua CHÍNH schema trường của hợp đồng (`listFeedQuerySchema.shape.*` ·    │
 * │ `searchFeedQuerySchema.shape.q`) — không chép con số trần nào vào FE, hợp đồng nới/siết thì     │
 * │ bộ lọc này theo cùng lúc.                                                                       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import {
  FEED_SEARCH_QUERY_MAX,
  feedPostTypeSchema,
  listFeedQuerySchema,
  searchFeedQuerySchema,
  type FeedPostTypeDto,
} from "@mediaos/contracts";
import type { ZodType } from "zod";

/**
 * Trần cho `wish`.
 *
 * `wish` là văn bản do **người khác kiểm soát**: widget Sinh nhật dựng link `/feed?wish=<tên>` và ai
 * cũng gửi được link đó cho đồng nghiệp. Giá trị chảy thẳng vào `prefillBody` của ô soạn bài
 * (`FeedPage` → `FeedComposer`).
 *
 * KHÔNG phải XSS — nó nằm ở `value` của `<textarea>` và không chỗ nào trong module dùng
 * `dangerouslySetInnerHTML`. Rủi ro là **xã hội**: không có trần thì một link dựng sẵn cả một bài
 * viết trong ô soạn của nạn nhân, và một cú bấm «Đăng» là bài đăng toàn công ty đứng tên họ.
 *
 * 120 đủ rộng cho tên dài nhất và còn cách rất xa `FEED_BODY_MAX` (4000) — tức link không thể chở
 * nổi một bài viết. Chặn ở đây là chỗ RẺ nhất: tầng dưới đã bọc khuôn i18n quanh giá trị rồi.
 */
export const FEED_WISH_MAX = 120;

/** Tham số URL của `/feed` — bộ lọc (D6) + hai tham số CHỈ của FE (`q` tìm kiếm, `wish` lời chúc). */
export interface FeedRouteSearch {
  sort?: "active" | "latest";
  /** ĐÃ trim, nằm trong trần của `listFeedQuerySchema.tag` — gửi thẳng lên `001` được. */
  tag?: string;
  /** Chỉ giá trị của enum loại bài (`feedPostTypeSchema` = mirror `chk_feed_posts_type`). */
  type?: FeedPostTypeDto;
  /** ĐÃ trim, ĐÃ cắt về `FEED_SEARCH_QUERY_MAX` — gửi thẳng lên `023` được. */
  q?: string;
  wish?: string;
}

/** Nửa đầu của một cặp surrogate UTF-16 (ký tự ngoài BMP, vd. emoji) — cắt sau nó là để lại nửa mồ côi. */
const HIGH_SURROGATE_FIRST = 0xd800;
const HIGH_SURROGATE_LAST = 0xdbff;

/**
 * Giá trị ĐÃ CHUẨN HOÁ (vd. đã `.trim()`) nếu schema TRƯỜNG của hợp đồng nhận nó; ngược lại
 * `undefined` = bỏ khoá. `safeParse` chứ không `parse` — luật «bỏ, không ném» (C17).
 */
function accepted<T>(schema: ZodType<T>, value: string | undefined): T | undefined {
  if (value === undefined) return undefined;
  const result = schema.safeParse(value);
  return result.success ? result.data : undefined;
}

/**
 * `q` bị CẮT về `FEED_SEARCH_QUERY_MAX`, KHÔNG bị bỏ — ngược với `tag`/`type`. Vì sao:
 *  · `q` là văn bản TỰ DO cho tìm kiếm toàn văn, cùng loại với `wish` (cũng cắt). Cắt đuôi vẫn giữ
 *    phần lớn ý định; bỏ hẳn thì người mở link thấy cả bảng tin mà không hiểu vì sao từ khoá mất.
 *  · Cùng một đầu vào cho cùng một kết quả bất kể đường vào: ô tìm kiếm có `maxLength` cùng trần, và
 *    trình duyệt CẮT chuỗi dán vào ô — link sửa tay đi qua đây cũng phải được cắt y vậy.
 *  · `tag`/`type` thì khác hẳn: đó là định danh so khớp ĐÚNG, cắt cụt là ra một thẻ/loại KHÁC và
 *    bảng tin lọc theo thứ người dùng không hề chọn — nên hai khoá đó BỎ.
 * Trim TRƯỚC khi cắt (schema 023 cũng trim trước khi đo trần) để khoảng trắng đệm không ăn mất từ
 * khoá; không cắt đôi cặp surrogate (nửa mồ côi tới server thành U+FFFD — một từ khoá khác hẳn).
 */
function boundSearchQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const cut = value.trim().slice(0, FEED_SEARCH_QUERY_MAX);
  const last = cut.charCodeAt(cut.length - 1);
  const whole =
    last >= HIGH_SURROGATE_FIRST && last <= HIGH_SURROGATE_LAST ? cut.slice(0, -1) : cut;
  // Schema trường `q` trim lần nữa (chỗ cắt có thể rơi vào khoảng trắng) và bỏ chuỗi rỗng (min 1).
  return accepted(searchFeedQuerySchema.shape.q, whole);
}

/**
 * ⚠️ KHÔNG dùng `listFeedQuerySchema.parse` cho CẢ object dù nó là nguồn sự thật DTO: schema đó
 * `.strict()` và có `z.coerce`, nên một URL người dùng sửa tay (`?limit=abc`) sẽ NÉM — và một
 * `validateSearch` ném là **màn hình lỗi thay cho bảng tin** (ca C17 vế deny). Lọc từng khoá bằng
 * `safeParse` của schema TRƯỜNG rồi bỏ khoá lạ/hỏng: URL rác thì mất bộ lọc, chứ không mất cả trang.
 * `q`/`wish` cũng không nằm trong schema đó và KHÔNG được gửi lên `001` — `FeedPage` lọc chúng ra
 * trước khi gọi (`q` đi `023`).
 */
export function validateFeedRouteSearch(raw: Record<string, unknown>): FeedRouteSearch {
  const str = (k: string): string | undefined =>
    typeof raw[k] === "string" && (raw[k] as string).length > 0 ? (raw[k] as string) : undefined;
  const sort = raw.sort === "latest" || raw.sort === "active" ? raw.sort : undefined;
  // Thẻ quá dài ⇒ BỎ, không cắt (xem `boundSearchQuery`); toàn khoảng trắng ⇒ trim ra rỗng ⇒ BỎ.
  const tag = accepted(listFeedQuerySchema.shape.tag, str("tag"));
  // Enum chặt hơn `listFeedQuerySchema.type` (chỉ `max(16)`): loại lạ server vẫn nhận nhưng trả tập
  // rỗng vĩnh viễn — bỏ để người dùng thấy bảng tin thay vì một «không có bài nào» giả.
  const type = accepted(feedPostTypeSchema, str("type"));
  const q = boundSearchQuery(str("q"));
  const wish = str("wish");
  return {
    ...(sort ? { sort } : {}),
    ...(tag ? { tag } : {}),
    ...(type ? { type } : {}),
    ...(q ? { q } : {}),
    ...(wish ? { wish: wish.slice(0, FEED_WISH_MAX) } : {}),
  };
}
