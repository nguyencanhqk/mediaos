# S16-SOCIAL-FEMODINVAL-1 + S16-SOCIAL-FESTALELISTS-1 — một nguồn tập khoá «mọi bề mặt đang vẽ bài»

Gộp hai WO (cùng một nguồn tập khoá). Gate LIGHT, FE thuần. Nhánh `fix/s16-social-postinvalidation-1`.

## 1. Quyết định

1. **Helper chung** `apps/app/src/routes/social/feed/lib/post-list-invalidation.ts`:
   `postListKeys(moderation)` (thuần, để test so tập) + `invalidatePostLists(qc, {moderation, postId})`.
   Mức `moderation`: `"none"` (thích · lưu · xét duyệt sáng kiến) · `"hidden"` (+ `moderation.hiddenPosts()`) ·
   `"queues"` (+ `reports.lists()`).
2. **Bốn nơi dùng chung**: menu ⋯ (`use-feed-actions.ts`, `refreshAfter(kind)`: ẩn/khoá/xoá ⇒ `"queues"`, còn lại `"none"`) ·
   màn Kiểm duyệt (`moderation-invalidation.ts` ⇒ `"hidden"`) · `badge-invalidation.ts` (KHÔNG sửa, vẫn gọi
   `invalidatePostSurfaces` ⇒ hành vi giữ nguyên) · `IdeaReviewDialog.tsx` (`"none"` + `postId`).
3. **Đo hiện trạng trước khi sửa**: `search`/`profilePosts` ĐÃ nằm trong `invalidatePostLists` (FEMODERRMSG-1) và
   trong màn Kiểm duyệt; khe hở thật chỉ ở `IdeaReviewDialog` (thiếu cả hai) + chiều ngược của menu ⋯ (thiếu hàng đợi).
   Tiền tố `search`/`profile-posts` vẫn CẮT từ hàm khoá của web-core (không chép literal).
4. «Hiện lại» (`HiddenPostsTab`) nối `signal` của `useGuardedMutation` xuống `socialApi.moderatePost`;
   `moderatePost(postId, body, signal?)` additive — khoá `signal` chỉ có mặt khi truyền.
5. Không chạm `use-create-post.ts` (PR #580) — việc đó ở `S16-SOCIAL-FESTALELISTS-CREATEPOST-1`, dùng lại `invalidatePostLists`.
6. Ghi chú «nợ» ở `socialKeys.moderation` (query-keys.ts) đổi thành «đã trả nợ».

## 2. Ánh xạ done_when → test

| done_when | Test |
| --- | --- |
| FEMODINVAL #1: MỘT hàm; so tập khoá thay hai danh sách tay; ẩn/xoá ⋯ làm mới hiddenPosts + reports.lists | `moderation/lib/moderation-invalidation.spec.tsx` (chạy THẬT menu ⋯: ⊆ nguồn · nguồn ⊆ menu · `invalidatePostSurfaces` = `postListKeys("hidden")` · đạt hiddenPosts + reports) · `feed/lib/post-list-invalidation.surfaces.spec.tsx` (đo `isInvalidated`) |
| FEMODINVAL #2: «Hiện lại» huỷ được yêu cầu treo | `HiddenPostsTab.spec.tsx` «nối signal» (signal truyền xuống, `aborted` sau 30 s) · `packages/web-core/src/lib/social-api.spec.ts` (2 ca moderatePost) |
| FESTALELISTS #1: sau thích/lưu/xoá/kiểm duyệt/xét duyệt sáng kiến, `search`/`profilePosts` invalidated (`getQueryState().isInvalidated`, không spy) | `post-list-invalidation.surfaces.spec.tsx` (it.each 4 hành động + 2 ca IdeaReviewDialog: thành công · 409) |
| FESTALELISTS #2: MỘT helper; khoá không liên quan KHÔNG bị chạm | cùng spec: `kudos.badges()` + `birthdays()` luôn `isInvalidated === false`; thích/lưu không chạm hàng đợi kiểm duyệt |

## 3. Sổ vết

- RED (trên mã cũ): `post-list-invalidation.surfaces.spec.tsx` **4 ca đỏ / 10** (xoá + kiểm duyệt ⇒ hàng đợi/hiddenPosts;
  IdeaReviewDialog thành công + 409 ⇒ search/profilePosts). `HiddenPostsTab` signal: **1 ca đỏ** (mutant gỡ nối `signal` ⇒ «expected undefined to be an instance of AbortSignal»).
  Ca ALLOW đứng cạnh (6 ca xanh trên mã cũ: thích/lưu/xoá/kiểm duyệt đã phủ search + profilePosts; đối chứng không-liên-quan).
- Spec ratchet cũ (ca «NỢ ĐÃ BIẾT» ghim hiện trạng) đã ĐỔI theo đúng lời dặn trong chính nó.
- `HiddenPostsTab.spec.tsx`: 4 chỗ `toEqual([id, body])` ⇒ `slice(0, 2)` vì lời gọi nay có đối số thứ ba (signal).
- Verify (qua run-heavy): vitest `routes/social` 97 tệp / 1870 ca xanh · web-core `social-api.spec` 10 xanh · typecheck app xanh ·
  eslint + prettier các tệp đã chạm xanh · web-core build lại.

## 4. Nợ

- `use-create-post.ts` còn danh sách khoá chép tay ⇒ `S16-SOCIAL-FESTALELISTS-CREATEPOST-1` (sau #580).
- Hạn chờ huỷ `signal` chỉ chạy được trên `moderatePost`; các lượt ghi `useGuardedMutation` khác đã nối từ trước.
- Chưa nhìn trên trình duyệt thật (thay đổi thuần cache-key, không đổi bố cục).
- `harness/backlog.mjs` KHÔNG sửa ở chuỗi này (đóng WO do điều phối).
