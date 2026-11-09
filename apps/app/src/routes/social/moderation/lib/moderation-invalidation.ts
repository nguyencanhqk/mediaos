/**
 * S16-SOCIAL-FE-3 (L2) — làm mới cache sau khi màn Kiểm duyệt làm một BÀI đổi trạng thái hiển thị:
 * `SOCIAL-API-029` kèm hành động (ẩn · khoá bình luận · xoá) và `SOCIAL-API-006` «Hiện lại».
 *
 * S16-SOCIAL-FEMODINVAL-1 — tập khoá KHÔNG còn chép tay ở đây: nó là MỘT nguồn với menu ⋯ của thẻ bài và
 * hộp thoại xét duyệt sáng kiến (`feed/lib/post-list-invalidation.ts`). File này chỉ chọn mức `"hidden"`:
 * thêm `moderation.hiddenPosts()` — nhánh riêng, không nằm dưới `feed.allOf()`.
 *
 * Rail của khung portal LUÔN mount tin nổi bật · bình chọn · vinh danh ngay cạnh màn này, và observer đang
 * mount không tự đọc lại (`refetchOnWindowFocus` tắt ở `main.tsx`) ⇒ không invalidate thì bài còn đó tới
 * khi rail mount lại. Chi tiết / bình luận của MỘT bài do nơi gọi tự làm mới.
 */
import type { QueryClient } from "@tanstack/react-query";
import { invalidatePostLists } from "../../feed/lib/post-list-invalidation";

export function invalidatePostSurfaces(queryClient: QueryClient): void {
  invalidatePostLists(queryClient, { moderation: "hidden" });
}
