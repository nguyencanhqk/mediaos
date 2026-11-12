# S16-SOCIAL-FEGROUPBADGE-1 — badge «N bài mới» theo nhóm

## Quyết định
- Hook mới `apps/app/src/hooks/use-feed-realtime-groups.ts` (`useGroupFeedRealtime`) là phần BÙ của `useFeedRealtime`: chỉ đếm payload `audience:'group'`, khoá đếm = `groupId` của payload đã `safeParse`. Payload sai hợp đồng ⇒ log + không đếm. Hook feed chính KHÔNG sửa (vẫn bỏ bài nhóm).
- Cùng khuôn: mọi hook gọi vô điều kiện, cổng `view:feed` nằm trong effect (không đăng ký listener khi thiếu quyền), `on` đối xứng `off`, WS một chiều. Không hard-code quyền; server quyết room.
- `GroupPostsTab`: `NewFeedPostsBadge` (tái dùng) với đếm của `group.id`; bấm ⇒ `feedQuery.refetch()` của đúng khoá `{groupId, sort}` + reset đếm nhóm đó.
- `MyGroupsWidget`: chip số mỗi dòng nhóm; bấm dòng (vào nhóm) ⇒ reset nhóm đó; trang nhóm tự nạp feed mới. Không dùng QueryClient trong widget.
- i18n: `groups.widget.newPosts_one/_other` ở `vi/social-groups.ts`; tab nhóm dùng lại `newPosts.badge`.
- Docblock `GroupPostsTab` và `MyGroupsWidget` viết lại theo hiện trạng sau BE-2C.
- Hệ quả: ca cũ của `GroupPage.spec` khẳng định «không mở socket» đã sai theo thiết kế mới ⇒ bỏ vế đó.

## done_when → test
1. Đếm theo groupId đã parse · payload sai không đếm · bấm ⇒ refetch đúng nhóm: `use-feed-realtime-groups.spec.tsx` (ca 1, 3), `GroupPostsTab.badge.spec.tsx` (ca 2, lastCalledWith groupId).
2. Hai nhóm A/B + hồi quy badge feed chính: `use-feed-realtime-groups.spec.tsx` (ca 1 và ca cuối), `GroupPostsTab.badge.spec.tsx` (ca 1, bài công ty không tăng).
3. Docblock: sửa trực tiếp.
4. Loading/error/empty giữ nguyên của `FeedPostList`; không hard-code quyền: ca thiếu `view:feed` ⇒ 0 listener.

## Sổ vết
- Mutant (bỏ khoá theo groupId, gộp mọi nhóm vào một khoá) ⇒ 6 ca đỏ / 8; khôi phục ⇒ xanh. Ca hồi quy feed chính xanh cả trên mã cũ (hook cũ đã bỏ bài nhóm) — là ca bảo vệ, không phải ca đỏ-trước.
- Chạy: 10 tệp / 172 ca xanh; typecheck app xanh; eslint xanh.

## Nợ
- Widget không tự refetch khi đang đứng sẵn trong trang nhóm đó (số vẫn tăng tới khi bấm dòng). Không có đếm lúc ngoại tuyến/khởi động (chỉ từ lúc kết nối).
