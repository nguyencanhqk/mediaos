/**
 * S16-SOCIAL-FE-3 (L2) — làm mới cache sau khi màn Kiểm duyệt làm một BÀI đổi trạng thái hiển thị:
 * `SOCIAL-API-029` kèm hành động (ẩn · khoá bình luận · xoá) và `SOCIAL-API-006` «Hiện lại».
 *
 * Tập khoá phải KHỚP đường menu ⋯ của thẻ bài (`feed/lib/use-feed-actions.ts`, `invalidatePostLists`):
 * cùng một việc (ẩn/hiện/xoá bài) mà hai đường làm mới hai tập khác nhau thì bài vừa ẩn từ hàng đợi vẫn
 * nằm ở các bề mặt còn lại. Rail của khung portal LUÔN mount tin nổi bật · bình chọn · vinh danh ngay cạnh
 * màn này, và observer đang mount không tự đọc lại (`refetchOnWindowFocus` tắt ở `main.tsx`) ⇒ không
 * invalidate thì bài còn đó tới khi rail mount lại.
 *
 * Thêm so với đường menu: `moderation.hiddenPosts()` — nhánh riêng, không nằm dưới `feed.allOf()`.
 *
 * ⚠️ Hai tập đang được CHÉP TAY ở hai nơi (file này và `use-feed-actions.ts`). Lưới chống trôi:
 * `moderation-invalidation.spec.tsx` chạy THẬT đường menu ⋯, thu mọi khoá nó invalidate và đòi tập ở đây
 * phủ đủ — nối thêm khoá vào `invalidatePostLists` mà quên file này là ca đó đỏ. Gộp về MỘT nguồn (để
 * `use-feed-actions.ts` đọc cùng tập) là việc của WO sau: file đó ngoài phạm vi PR này.
 * Chi tiết / bình luận của MỘT bài do nơi gọi tự làm mới (chỉ nơi gọi biết id bài).
 */
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";

/**
 * Tiền tố MỌI danh sách `025` (trang cá nhân, mọi `employeeId`) và MỌI kết quả tìm kiếm `023` (mọi `q`).
 * Web-core chưa có `allOf` cho hai nhánh này ⇒ CẮT từ chính hàm khoá (đổi tên khoá thì tiền tố đổi theo);
 * KHÔNG dùng `socialKeys.search()` trần: `[…,"search",undefined]` không khớp một phần `[…,"search",{q}]`.
 * Cùng cách suy với `PROFILE_POSTS_PREFIX` / `SEARCH_PREFIX` của `use-feed-actions.ts` (hai hằng đó không
 * export).
 */
const PROFILE_POSTS_PREFIX = socialKeys.profilePosts("").slice(0, socialKeys.all.length + 1);
const SEARCH_PREFIX = socialKeys.search().slice(0, socialKeys.all.length + 1);

/** Mọi bề mặt đang vẽ bài. `kudos.lists()` chứ không `kudos.allOf()`: catalog huy hiệu không đổi theo bài. */
function postSurfaceKeys(): readonly QueryKey[] {
  return [
    socialKeys.moderation.hiddenPosts(),
    socialKeys.feed.allOf(),
    socialKeys.saved(),
    socialKeys.news.allOf(),
    socialKeys.polls.allOf(),
    socialKeys.ideas.allOf(),
    socialKeys.kudos.lists(),
    PROFILE_POSTS_PREFIX,
    SEARCH_PREFIX,
  ];
}

export function invalidatePostSurfaces(queryClient: QueryClient): void {
  postSurfaceKeys().forEach((queryKey) => {
    void queryClient.invalidateQueries({ queryKey });
  });
}
