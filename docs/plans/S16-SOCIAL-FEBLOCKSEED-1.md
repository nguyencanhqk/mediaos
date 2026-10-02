# S16-SOCIAL-FEBLOCKSEED-1 — thẻ bài đọc khối BE-2D: `PollBlock` seed cache `043` từ `post.poll` · pill trạng thái sáng kiến

> 🟡 Amber (FE, không đổi quyền/DB/API). Nhánh `feat/s16-social-feblockseed-1`, base master `14afbb5f`,
> worktree `C:\dev 2\MediaOS-feblockseed`. Nguồn: plan FE-2C §7 N2 · contract `social-feed-blocks.ts:77-78`
> («FE seed cache 043 thẳng từ thẻ») · BE-2D D5/D6.

## 0. Đo trước — «ĐO trước khi chọn luật» (done_when #2), 02/10/2026

Probe vitest+jsdom TẠM trong `apps/app` (`@tanstack/react-query` 5.101.0 của kho, 27/27 ca, đã gỡ — cây
sạch) + probe node trên `query-core`. Chỉ ghi các số quyết định luật:

| #       | Đo                                                                  | Kết quả                                                                                                                                                                        |
| ------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1a/M1b | `initialData` khi entry ĐÃ có data (tươi / cũ hơn seed 60s)         | BỊ BỎ QUA — hiện data của entry; entry cũ ⇒ refetch 1 lần, không lấy seed                                                                                                      |
| M3a     | Re-render với `initialData` KHÁC sau khi mutation đã `setQueryData` | Bỏ qua — giữ kết quả mutation, 0 lần gọi                                                                                                                                       |
| M3c     | Entry tồn tại nhưng CHƯA có data (043 lỗi / đang bay)               | Seed lấp vào (`query.ts` seed khi `state.data === undefined`)                                                                                                                  |
| M2      | Refetch-on-mount với seed                                           | Client `staleTime` 0 (= client test) ⇒ **1 lần gọi**; `staleTime` 30s cấp query ⇒ **0 lần** dù client 0                                                                        |
| M4a-d   | `initialData: undefined` / `() => undefined`                        | Y HỆT không có `initialData` (pending → fetch)                                                                                                                                 |
| M4e     | `initialData: null`                                                 | Coi là DATA thật, không bao giờ fetch ⇒ `PollBlock` vẽ hộp lỗi. Không chạm được: `apiFetch` parse bằng `feedPostSchema` (`poll` là `.optional()`, `null` ⇒ lỗi parse cả trang) |
| M5a     | `setQueryData(k, d, {updatedAt})` với `updatedAt` CŨ HƠN            | VẪN ĐÈ data và kéo `dataUpdatedAt` lùi — không có lưới sẵn                                                                                                                     |
| M6a     | `useInfiniteQuery` sau `fetchNextPage`                              | Một `dataUpdatedAt` chung nhảy lên giờ trang N (+141 ms) trong khi object trang 1 giữ nguyên ⇒ trang 1 TRÔNG tươi như trang N                                                  |
| E6      | GET danh sách gửi TRƯỚC lượt bỏ phiếu, về SAU                       | `dataUpdatedAt` của danh sách mới hơn kết quả bỏ phiếu 47 ms ⇒ «so thời điểm tới» xếp sai thứ tự đọc của server                                                                |
| M7      | Hết `gcTime` của `results(postId)` rồi mount lại                    | Seed lại từ `initialData`, 0 lần gọi                                                                                                                                           |

Server KHÔNG có mốc phiên bản cho kết quả bình chọn (`FeedPollResultsDto` không `updatedAt`; bỏ phiếu không
đụng mốc nào của `feed_polls`/`feed_posts`) ⇒ luật «bản mới hơn thắng» không chứng minh được an toàn.

## 1. Luật seed (chốt)

- `PollBlock` nhận `seed?: FeedPollResultsDto`; `PostCard` truyền `seed={post.poll}`. `useQuery` thêm
  `initialData: seed` + `staleTime: POLL_RESULTS_STALE_MS` (30 000 — bằng mặc định `main.tsx`, FRONTEND-04
  §16.1). KHÔNG `setQueryData` từ thẻ, KHÔNG `enabled`, KHÔNG `initialDataUpdatedAt`.
- **Đảm bảo chính xác:** 0×`043` lúc mount khi thẻ chở `post.poll` VÀ `results(postId)` chưa có data. Entry
  đã có data ⇒ entry THẮNG (kể cả khi thẻ mới hơn): tươi ⇒ 0 lần gọi; cũ ⇒ refetch 1 lần như hôm nay.
  ⇒ kết quả `041..044` (ghi bằng `applyResult`, không đổi) KHÔNG bao giờ bị seed đè (done_when #2).
- **`staleTime` cấp khối là bắt buộc:** hợp đồng «0×043» phải sống trong component, không phụ thuộc client
  bọc nó (client test `staleTime` 0 — M2). Ở PROD con số trùng mặc định ⇒ đường fallback không đổi.
- **Không `initialDataUpdatedAt`** ⇒ TanStack đóng dấu `Date.now()` lúc tạo entry. Đúng với cả 5 nơi vẽ thẻ
  hôm nay (FeedPage · SavedPage · ProfilePostsPage · GroupPostsTab qua `FeedPostList`, PostDetailPage): thẻ
  chỉ mount CÙNG LÚC dữ liệu nguồn vừa về (danh sách unmount thẻ khi loading/lỗi; không `placeholderData`/
  prefetch/`removeQueries` trên khoá bài hay khoá poll; `results` và danh sách cùng `gcTime` 5'). Truyền
  `dataUpdatedAt` của trang sẽ tốn 3 prop + 5 chỗ gọi mà VẪN khai tươi quá mức ở danh sách vô hạn (M6a), và
  `dataUpdatedAt` 0 của `placeholderData` sẽ làm mọi seed cũ ngay. **Xét lại** khi `PollBlock` mount MUỘN
  hơn dữ liệu nguồn (danh sách ảo hoá, thẻ gập/lười, widget rail đọc danh sách cache).
- Fallback: `post.poll` vắng (006 · WS · API trước #555 · hàng mồ côi) ⇒ `initialData` undefined ⇒ y hệt
  hôm nay (skeleton → tự gọi `043`).

**Bác:** (a) re-seed bằng effect/`setQueryData` có so thời điểm — thời điểm TỚI không xếp được thứ tự đọc
(E6, M6a) và `setQueryData` không tự chặn (M5a): trang 1 lúc T1 · bỏ phiếu T2 · trang 2 lúc T3 ⇒ T3 > T2 ⇒
`post.poll` trước-bỏ-phiếu đè phiếu; (b) seed trong `queryFn`/`select` của 5 danh sách — biến thể an toàn
duy nhất (`prev ?? poll`) = `initialData` nhưng chép 5 nơi, sót một nơi là N request quay lại im lặng;
(c) `enabled: false` khi có seed — `invalidateQueries` bỏ qua observer tắt ⇒ `onFail` hết tải lại sau
409/403/500, `invalidatePostLists` hết làm tươi khối; (d) `refetchOnMount: false` — entry cũ không bao giờ
tự tươi; (e) dựa `staleTime` toàn cục — hợp đồng nằm ngoài component, client test là 0.

## 2. Pill trạng thái sáng kiến

- Tách `ideas/components/IdeaStatusPill.tsx` (khuôn `kudos/components/KudosBlock`): chuyển nguyên
  `PILL_CLASS: Record<FeedIdeaStatusDto, string>` + span `data-testid="idea-status-pill"` từ `IdeasPage`,
  nhãn `idea.status.*` sẵn có (không thêm khoá i18n). Màn 008 dùng component ⇒ không đổi giao diện.
- Thẻ `idea`: hàng `flex` giữ NGUYÊN link «Sáng kiến · Xem danh sách» (`/feed/ideas`) và thêm pill làm ANH EM
  (không lồng trong link — tên truy cập của link giữ nguyên). Khối vắng ⇒ chỉ nhãn + link như cũ.
- Không gate (BE-2D D6: `status` không bị mask dưới `view:feed`). Đọc `post.idea.status`, KHÔNG BAO GIỜ
  `post.status` (trường kiểm duyệt). Không `reviewNote`/người duyệt (mặt nạ D19 sống ở `045`).
- **Đổi dòng H5 của plan FE-2 §8:** `IdeaReviewDialog` (046 thành công VÀ lỗi — 409 ERR-019 = người khác vừa
  đổi trạng thái) invalidate thêm `feed.allOf()` · `saved()` · `posts.detail(postId)`. Thiếu nó, người duyệt
  quay lại `/feed` trong 30s thấy pill cũ (`staleTime` 30s, tắt refetch khi focus). Trên màn 008 các cache
  đó không có observer ⇒ chỉ bị đánh dấu, 0 request thừa.

## 3. Test — RED trước, mỗi lưới có mutant

| Ca                                                                                                  | File             | Đỏ trên code cũ vì                                         | Mutant phải làm đỏ                                             |
| --------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------- |
| S1 seed vẽ ngay lượt render đầu, 0×043 (client `staleTime` 0)                                       | `PollBlock.spec` | khối không có `seed` ⇒ skeleton + 1×043                    | bỏ `initialData` · bỏ `staleTime` cấp khối                     |
| S2 entry đã có data MỚI hơn thắng seed CŨ, 0×043                                                    | `PollBlock.spec` | không `staleTime` ⇒ entry 0 ms đã cũ ⇒ 1×043               | seed bằng `setQueryData` (render/effect) ⇒ hiện số cũ          |
| S3 kết quả bỏ phiếu sống qua re-render với seed CŨ                                                  | `PollBlock.spec` | khối chờ 043 không bao giờ về ⇒ không có ô chọn            | re-seed bằng effect ⇒ 100% tụt về 0%                           |
| S4 có seed + bỏ phiếu 409 ⇒ banner + đúng 1 lần tải lại 043                                         | `PollBlock.spec` | mount gọi 043 ⇒ hiện trạng thái server, không nút bỏ phiếu | `enabled: seed === undefined` ⇒ 0 lần tải lại                  |
| S5 `PostCard` có `post.poll` ⇒ vẽ từ thẻ, 0×043                                                     | `PostCard.spec`  | thẻ chỉ truyền `postId`/`isMine`                           | thẻ thôi truyền `seed`                                         |
| S6 `it.each` 4 trạng thái: pill + link giữ nguyên, chỉ `view:feed`                                  | `PostCard.spec`  | không có pill                                              | bọc `PermissionGate` · gán cứng 1 trạng thái · pill trong link |
| S7 pill đọc `post.idea.status`, không `post.status`                                                 | `PostCard.spec`  | không có pill                                              | đọc `post.status`                                              |
| S8 `FeedPage` 2 bài poll có khối ⇒ 0×043 (nghiệm thu N→0)                                           | `FeedPage.spec`  | mỗi thẻ tự gọi ⇒ 2×043                                     | như S5                                                         |
| S9/S10 xét duyệt thành công / 409 ⇒ invalidate cache thẻ                                            | `IdeasPage.spec` | chỉ `ideas.allOf()`                                        | bỏ invalidate ở `onSuccess` / `onError`                        |
| G1–G4 lưới hồi quy (fallback 043 · thẻ poll KHÔNG khối · thẻ idea KHÔNG khối không pill · pill 008) | các spec cũ      | XANH trên code cũ                                          | `enabled: !!seed` · seed rỗng bịa · pill mặc định · mất testid |

Hạ tầng test (additive): `renderWithProviders(node, client?)` render qua `wrapper` ⇒ `rerender` giữ provider
(gỡ bẫy ghi ở `KudosPage.spec`), trả thêm `client`; `makeTestQueryClient()`; fixture `makePollResults`.

## 4. Kết quả

_(điền sau GREEN: số RED/GREEN, mutant, gate LIGHT, `check.sh`)_

## 5. Nợ tách WO / câu hỏi owner

- FE `S16-SOCIAL-FEPOLLRACE-1`: 043 đang bay (vd do `invalidatePostLists` sau một lượt thích) về SAU lượt
  bỏ phiếu ⇒ đè phiếu bằng ảnh chụp trước (E5, có từ trước WO này; seed chỉ thu hẹp cửa sổ). Vá:
  `cancelQueries(resultsKey)` ở `onMutate` (tiền lệ `use-task-action-mutation.ts`).
- FE `S16-SOCIAL-FESTALELISTS-1`: `invalidatePostLists` + `IdeaReviewDialog` không chạm `search({q})` và
  `profilePosts(id)` ⇒ pill/số poll/`savedByMe` ở hai danh sách đó lệch tới khi mount lại.
- BE `S16-SOCIAL-IDEALABEL-1`: nhãn NOTI-032 (`social-idea-fsm.ts` `IDEA_STATUS_LABEL`) lệch i18n FE 3/4
  trạng thái («Đang xét duyệt»/«Đang xem xét» · «Được duyệt»/«Được chấp nhận» · «Từ chối»/«Không được chấp
  nhận») ⇒ thông báo và pill gọi cùng một trạng thái bằng hai tên.
- ❓ Owner: có muốn mốc phiên bản kết quả bình chọn ở BE (bump `feed_polls.updated_at` ở 041/042/044, chiếu
  vào DTO)? Có nó FE mới an toàn ưu tiên `post.poll` mới hơn entry cũ và thu hẹp `polls.allOf()` trong
  `invalidatePostLists` (hôm nay mỗi lượt thích/lưu làm MỌI khối poll đang mount gọi lại 043). Không chặn WO này.
