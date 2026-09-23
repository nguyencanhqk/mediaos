/**
 * S16-SOCIAL-FE-1 (plan D6) — bộ lọc/sắp xếp của bảng tin sống trong **URL search**.
 *
 * ┌─ VÌ SAO URL CHỨ KHÔNG `useState` HAY `useLocalPref` ──────────────────────────────────────────┐
 * │ Lọc là **NGỮ CẢNH ĐIỀU HƯỚNG**, không phải sở thích cá nhân. Trong URL thì: link chia sẻ được  │
 * │ (gửi cho đồng nghiệp đúng cái mình đang xem), back/forward đúng, reload không mất ngữ cảnh.    │
 * │ `useState` mất khi reload. `useLocalPref` còn tệ hơn: cùng một link mở ra KHÁC NHAU trên mỗi    │
 * │ máy, và người gửi không bao giờ biết người nhận thấy gì.                                       │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **TÁI DÙNG `listFeedQuerySchema` của contracts**, không khai lại. Contracts là nguồn sự thật
 * DTO; khai một schema thứ hai ở FE là hai nguồn và chắc chắn trôi (BE thêm một bộ lọc, FE không
 * biết; FE cho qua một giá trị BE từ chối ⇒ 400 vô danh).
 *
 * ⚠️ **Bỏ `cursor` và `limit`**: chúng thuộc `useInfiniteQuery` (nó tự giữ `pageParam`), không thuộc
 * URL. Để `cursor` trong URL thì bấm chia sẻ sẽ gửi đi một con trỏ keyset đã hết hạn ngữ cảnh, và
 * người nhận mở ra giữa chừng danh sách.
 */
import { listFeedQuerySchema, type ListFeedQueryDto } from "@mediaos/contracts";

/** Bộ lọc hiển thị trên URL — tập con của `listFeedQuerySchema`, bỏ hai khoá phân trang. */
export type FeedSearch = Omit<ListFeedQueryDto, "cursor" | "limit">;

/**
 * `validateSearch` của TanStack Router.
 *
 * 🔴 **Tham số rác KHÔNG được làm vỡ trang** (ca **C17** vế deny). `listFeedQuerySchema` là
 * `.strict()` và có `z.coerce` — một URL người dùng sửa tay (`?sort=xyz&limit=abc`) sẽ làm `parse()`
 * NÉM, và một `validateSearch` ném là **màn hình lỗi thay cho bảng tin**. Dùng `safeParse` rồi rơi về
 * mặc định: URL lạ thì mất bộ lọc, chứ không mất cả trang.
 */
export function validateFeedSearch(input: Record<string, unknown>): FeedSearch {
  const parsed = listFeedQuerySchema.safeParse({ ...input, cursor: undefined, limit: undefined });
  if (!parsed.success) {
    // Mặc định = đúng mặc định của contracts (`sort: "active"`), không phải một hằng chép tay.
    return { sort: listFeedQuerySchema.parse({}).sort };
  }
  const { cursor: _cursor, limit: _limit, ...rest } = parsed.data;
  return rest;
}

/**
 * Chuẩn hoá bộ lọc thành khoá cache React Query.
 *
 * Bỏ khoá `undefined` để `?sort=active` và `?sort=active&tag=` cho ra CÙNG một khoá — nếu không, hai
 * URL hiển thị y hệt nhau lại là hai entry cache khác nhau và mỗi lần đổi qua lại là một lần gọi mạng.
 */
export function feedSearchToParams(search: FeedSearch): Record<string, unknown> {
  return Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined));
}
