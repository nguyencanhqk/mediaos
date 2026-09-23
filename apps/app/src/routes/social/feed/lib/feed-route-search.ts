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
 */

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
  tag?: string;
  type?: string;
  q?: string;
  wish?: string;
}

/**
 * ⚠️ KHÔNG dùng `listFeedQuerySchema.parse` ở đây dù nó là nguồn sự thật DTO: schema đó `.strict()`
 * và có `z.coerce`, nên một URL người dùng sửa tay (`?limit=abc`) sẽ NÉM — và một `validateSearch`
 * ném là **màn hình lỗi thay cho bảng tin** (ca C17 vế deny). Lọc tay từng khoá rồi bỏ khoá lạ: URL
 * rác thì mất bộ lọc, chứ không mất cả trang. `q`/`wish` cũng không nằm trong schema đó và KHÔNG
 * được gửi lên API — `FeedPage` lọc chúng ra trước khi gọi.
 */
export function validateFeedRouteSearch(raw: Record<string, unknown>): FeedRouteSearch {
  const str = (k: string): string | undefined =>
    typeof raw[k] === "string" && (raw[k] as string).length > 0 ? (raw[k] as string) : undefined;
  const sort = raw.sort === "latest" || raw.sort === "active" ? raw.sort : undefined;
  const wish = str("wish");
  return {
    ...(sort ? { sort } : {}),
    ...(str("tag") ? { tag: str("tag") } : {}),
    ...(str("type") ? { type: str("type") } : {}),
    ...(str("q") ? { q: str("q") } : {}),
    ...(wish ? { wish: wish.slice(0, FEED_WISH_MAX) } : {}),
  };
}
