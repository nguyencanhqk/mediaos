# S16-SOCIAL-FEMODPAYLOAD-1 — menu ẩn/hiện bài gửi body sai hợp đồng `006`

> 🟡 Amber (FE, không đổi quyền/DB/API). Nhánh `fix/s16-social-femodpayload-1`, base master `fa498aa9`.
> Nguồn: Critic workflow Understand của `S16-SOCIAL-BE-2D` (C9, 29/09/2026) — xác nhận TĨNH.

## 0. Đo trước (done_when #1) — 30/09/2026

Cấy TẠM một ca vào `apps/api/test/integration/social-be1-scope.int-spec.ts` (đã gỡ, file về nguyên trạng),
chạy trên lane DB cô lập `mediaos_femodpay` với actor `manage:feed-post` (`tPostManager`):

| Body gửi `PATCH /social/posts/:id/moderation` | HTTP | Kết quả |
| --- | --- | --- |
| `{status:"hidden"}` (body FE đang gửi) | **400** | `VALIDATION-ERR-001` · `Unrecognized key(s) in object: 'status'` + refine «cần ít nhất một trường» · bài VẪN `published` |
| `{status:"published"}` (bỏ ẩn) | **400** | `VALIDATION-ERR-001` |
| `{hidden:true}` (đúng hợp đồng) | 200 | `status:"hidden"` |
| `{hidden:false}` | 200 | `status:"published"` |

⇒ **Lỗi THẬT**: trên master mọi lượt «Ẩn bài» / «Bỏ ẩn» của người kiểm duyệt đều 400 (FE hiện lỗi
kiểm duyệt). «Khoá bình luận» và «Ghim» không hỏng (ánh xạ `locked → commentsLocked` / `pinned` đúng).
API-19 §5.1c ghi đúng `{hidden?, pinned?, commentsLocked?}` — lệch CHỈ nằm ở FE; spec FE cũ ghim chính
body sai và docblock của nó khai ngược («gửi thẳng `hidden` là 400»).

## 1. Vá

- `apps/app/src/routes/social/feed/lib/use-feed-actions.ts`: `FeedActions.moderate(postId, patch)` nhận
  THẲNG `ModerateFeedPostDto` và chuyển nguyên xuống `socialApi.moderatePost` — **xoá lớp ánh xạ** (nơi
  lỗi sống) và phép ép `as Parameters<…>`. `buildPostMenuActions` gửi `{hidden}` · `{commentsLocked}` ·
  `{pinned}`. Chỗ gọi duy nhất ngoài spec là `buildPostMenuActions`.
- Lợi ích phụ: literal ở chỗ gọi được TypeScript kiểm excess-property ⇒ khoá lạ là lỗi `tsc`.

## 2. Bằng chứng

- **RED trên code cũ**: 3 ca ẩn/bỏ ẩn đỏ với ĐÚNG thông điệp server trả thật (`unrecognized_keys
  ["status"]`); spec mới đi trọn menu ⋯ → hook THẬT → `moderatePost` (mock), kiểm
  `moderateFeedPostSchema.safeParse(body).success` + body chính xác, cho 7 thao tác menu.
- **GREEN**: `use-feed-actions.spec.tsx` 23/23 · `@mediaos/app typecheck` sạch.
- **Mutant compile-time**: cấy `{status: …}` vào `onToggleHidden` ⇒ `TS2353 'status' does not exist in type
  '{ hidden?…; pinned?…; commentsLocked?… }'`. Đã khôi phục từ bản sao lưu.
- Ca đối chứng trong spec: schema THẬT SỰ từ chối `{status:"hidden"|"published"}` (chống xanh-rỗng).

## 3. Gộp thêm (owner 30/09/2026) — gate «Ghim» của `PostCardMenu`

Review LIGHT (workflow 3 reviewer × 2 skeptic/phát hiện) bắt: mục «Ghim / bỏ ghim» chỉ xét
`manage:feed-news` ⇒ hiện trên MỌI bài chia sẻ/bình chọn/sáng kiến/vinh danh của vai hr + company-admin,
bấm là **422 `SOCIAL-ERR-PIN-NEWS-ONLY`** (CHECK `chk_feed_posts_pinned_news`). Đọc thêm: route `006` có
SÀN tầng 1 `manage:feed-post` cho MỌI trường (`postModerate: pair("manage","feed-post", true)`) ⇒ vai tuỳ
biến chỉ có `feed-news` bấm là 403.

- Vá: `canPin = canManageNews && canManagePost && post.type === "news"` (`PostCardMenu.tsx`).
- Spec `PostCard.spec.tsx` C5: 2 ALLOW (tin chưa/đang ghim) + DENY gỡ ĐÚNG MỘT vế mỗi ca (thiếu
  `feed-news` · thiếu sàn `feed-post` · 4 loại bài không phải tin), mỗi ca DENY có đối chứng menu không rỗng.
  Ca ALLOW cũ dựng đúng trạng thái hỏng (bài `share`, không `feed-post`) — đã thay.
- Mutant gate cũ (`canPin = canManageNews`) ⇒ 5 ca DENY mới ĐỎ; GREEN 28/28 sau khôi phục.

## 4. Tách WO (review LIGHT, LOW, 2/2 skeptic xác nhận)

- `S16-SOCIAL-FESEARCHBOUNDS-1` — `q`/`tag`/`type` từ URL không theo biên hợp đồng ⇒ 400 màn bảng tin.
- `S16-SOCIAL-FEMODERRMSG-1` — lỗi kiểm duyệt không-403 hiện «Vui lòng thử lại» dù vô ích.
- `S18-FE-LEAVEDRAFTCAST-1` — form nghỉ phép dùng cùng khuôn `as Parameters<…>` (hôm nay body đúng).
- Bác (2/2 skeptic): `MasterDataCrudScreen` `as never` — mọi mapper khai đúng DTO, không lỗi.
