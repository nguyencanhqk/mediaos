# S16-SOCIAL-FE-2D — FE nợ nội dung SOCIAL: đính kèm (054/055) · @mention thành link · `droppedMentions` của bình luận

> Trạng thái: **plan v1 (02/10/2026)** — chờ `plan-reviewer` + owner ký §6. Nhánh `feat/s16-social-fe-2d` cắt từ
> master `14afbb5f`. Zone amber, gate **LIGHT** (`typescript-reviewer` + `react-reviewer` + `quality-gate`).
> FE-only: KHÔNG migration, KHÔNG cặp quyền mới, KHÔNG sửa `apps/api`. Quyền chỉ qua `useCan`/`PermissionGate`.
> Nguồn: nợ N1 plan FE-1 (đính kèm) · nợ R3 plan BE-1D (mention link) · nợ «droppedMentions bình luận» FE-1 §9 ·
> plan-reviewer FE-2 M9. Đề xuất **hai lát**: **A** đính kèm (composer + bình luận + vẽ) · **B** mention link +
> `droppedMentions` bình luận + ghim ngữ nghĩa cache `006`.

## 1. Bối cảnh — cái gì đang sai (code HIỆN TẠI, `14afbb5f`)

**Đính kèm — ghi:**

- `FeedComposer.tsx:19-20` và `CommentComposer.tsx:7-8` còn docblock «KHÔNG có nút đính kèm … giao FE-2D»; `buildDto`
  (`FeedComposer.tsx:156-183`) và `submit` (`CommentComposer.tsx:84-106`) không bao giờ gửi `attachmentIds`.
- Cửa vào đã có từ BE-1C: `POST /social/files/upload-url` (054) · `POST /social/files/{id}/confirm` (055)
  (`social-files.controller.ts:64-89`); body `socialFileUploadUrlInputSchema` `{target, originalName, declaredMimeType,
  sizeBytes}.strict()` và `socialFileConfirmInputSchema` `{target}.strict()` (`contracts social-api.ts:688-707`) —
  **KHÁC chat** (`/chat/files/:id/confirm` body `{}`). Response = `RegisterFileResponse`/`ConfirmUploadResponse` của
  FOUNDATION (`social-files.service.ts:2-6,109,141`). 0 client trong `packages/web-core` (grep `social/files` = 0).

**Đính kèm — đọc:**

- `PostCard.tsx:70,159-180` CHỈ vẽ lưới ẢNH (`buildImageGrid` lọc `url !== null`, `feed-format.ts:63-71`). Đính kèm
  `kind:'video'`/`'file'` **không được vẽ ở đâu cả** (biến mất im lặng).
- `CommentList.tsx:62-79` (`CommentRow`) **không vẽ đính kèm nào** dù `feedCommentSchema.attachments` luôn có mặt.
- `NewsPage.tsx:272` vẽ tin bằng `PostBody` trần — không ảnh, không mention.
- `<img>` lưới ảnh không có `onError` (`PostCard.tsx:166-171`); URL ký GET sống **300 s** (`object-storage.service.ts:92`
  `S3_PRESIGN_TTL_SEC ?? 300`) ⇒ ảnh `loading="lazy"` cuộn tới sau 5 phút = ô ảnh VỠ dù `url` khác null.

**Mention:**

- `PostBody.tsx:58-68` vẽ token `mention` thành SPAN; docblock `parse-feed-body.ts:12-23` nói «contract không trả
  mảng mention» — **đã SAI từ BE-1D**: `feedPostSchema.mentions?`/`feedCommentSchema.mentions?` =
  `discriminatedUnion("withheld", [{withheld:false, employeeId, label}, {withheld:true}])` (`social-api.ts:168-175,217,249`).
- `MENTION_RE` (`parse-feed-body.ts:67`) chỉ bắt MỘT chữ: `@Nguyễn Văn An` ⇒ token `@Nguyễn` + text ` Văn An` (đo P2a).
- `PostCard.tsx:136`, `CommentList.tsx:78`, `NewsPage.tsx:272` không truyền `mentions` xuống `PostBody`.

**`droppedMentions` bình luận:** `PostDetailPage.tsx:95-104` `createComment.onSuccess` vứt response; bài thì đã có
(`use-create-post.ts:79` + `CreatePostNotices.tsx:33-53`).

**Cache `006`:** `use-feed-actions.ts:132-140` `moderateMutation.onSuccess` CHỈ `invalidatePostLists(post.id)` — không
`setQueryData`. Response `006` dựng riêng, KHÔNG mang `mentions`/`kudos`/`poll`/`idea`
(`social-posts-moderation.service.ts:73-92`).

## 2. Phép đo (02/10/2026, worktree `MediaOS-fe2d` @ `14afbb5f`)

Probe ở `scratchpad/probes/fe2d/` (config vitest riêng, resolve qua `apps/app`): `pnpm exec vitest run --config
<probe>/vitest.probe.config.mts` ⇒ **Test Files 2 passed · Tests 13 passed** (lượt cuối).

| # | Khẳng định | Cách đo | Kết quả |
| --- | --- | --- | --- |
| M1 | Baseline spec sẽ chạm | `pnpm --filter @mediaos/app exec vitest run` 11 file (FeedComposer · CommentComposer · CommentList · PostCard · PostBody · parse-feed-body · PostDetailPage · FeedPage · use-create-post · use-feed-actions · GroupPage) `--reporter=verbose` | **11 file · 220 ca XANH** (34·6·22·28·9·13·27·22·10·23·26) |
| M2 | `setQueryData` thay NGUYÊN object | probe P1a: seed detail có `mentions` → `setQueryData(detail, dto006)` | data sau = `{"id":"p1","body":…,"status":"hidden"}` — **`mentions` MẤT** ⇒ mọi merge tương lai phải giữ khoá vắng |
| M3 | `invalidateQueries` trên query KHÔNG observer | probe P1b | `isInvalidated:true`, queryFn 0 lần, **data cũ GIỮ NGUYÊN** (mentions còn) |
| M4 | `invalidateQueries` trên query CÓ observer | probe P1c (đợi `status:'success'` trước) | refetch, data = kết quả queryFn MỚI. ⚠️ Lượt đầu của probe invalidate KHI lượt fetch đầu còn bay ⇒ không thấy lượt gọi thứ 2 trong 1 s — ca test phải đợi `success` rồi mới invalidate |
| M5 | Hiện trạng `006` trong cache | đọc `use-feed-actions.ts:132-140` + grep `setQueryData` `routes/social` (bỏ spec) | chỉ 2 chỗ: `PollBlock.tsx:69` (kết quả 043) · `GroupSettingsTab.tsx:84` (nhóm) — **KHÔNG chỗ nào ghi DTO bài vào cache** ⇒ hôm nay `006` không thể làm mất `mentions` |
| M6 | Tokenizer hiện tại | probe P2a/P2b/P2c | `"@Nguyễn Văn An"` ⇒ `mention "@Nguyễn"` + text; `a@b.com` ⇒ không mention (lookbehind); `"Cảm ơn @An."` ⇒ token `"@An."` (dấu chấm DÍNH vào token) |
| M7 | Ai sinh ra mention trên web? | `grep -rn mentionedUserIds apps/app/src packages/web-core/src` (bỏ dòng comment) | **0 call-site**. Composer SOCIAL KHÔNG có ô chọn mention; mọi SOCIAL DTO cố ý KHÔNG trả `userId` (grep `userId` contracts `social-api*.ts` — chỉ ngoại lệ nhóm `037`) ⇒ web KHÔNG tạo được mention ⇒ `mentions` luôn `[]` và `droppedMentions` luôn `[]` với nội dung đăng từ web |
| M8 | Nhãn mention | đọc `social-mentions.ts:426-503` | `label = users.full_name.trim()`, thứ tự `(created_at,id)` (KHÔNG theo vị trí trong body); TK đổi tên ⇒ `label` ≠ chữ trong body ⇒ không khớp (an toàn: rơi về span) |
| M9 | Trần đính kèm phía BE | đọc `social-attachments.service.ts:305-334,626-631` | trên TẬP TỆP MỚI của lượt: `kindOf` theo tiền tố MIME (`image/`·`video/`, lowercase); ảnh >10 hoặc video >1 ⇒ 422 `ATTACHMENT_LIMIT`; tệp >20 MB ⇒ 422 `ATTACHMENT_LIMIT`; thiếu/không phải của mình/chưa `Uploaded`/đã từng link ⇒ 422 `ATTACHMENT_INVALID`. **Cả hai cùng mã `SOCIAL-ERR-007`** (`contracts social-errors.ts:30-31`) ⇒ FE KHÔNG phân biệt được bằng `code` |
| M10 | Trần tổng ở Zod | probe P5b: `createFeedPostSchema` 11 vs 12 `attachmentIds` | `FEED_MAX_ATTACHMENTS=11`; 11 ⇒ OK · 12 ⇒ **400 vô danh** (không phải 422) ⇒ FE PHẢI chặn tổng >11 phía client |
| M11 | Body bắt buộc | probe P5c | bình luận `body:""` + 1 tệp ⇒ từ chối; bài `share` không body ⇒ từ chối ⇒ **không có bài/bình luận CHỈ ảnh** |
| M12 | Thứ tự `attachmentIds` & idempotency | probe P5a `idempotencyKeyFor("social-post", …)` đảo thứ tự 2 id | khoá KHÁC ⇒ giữ thứ tự CHỌN ổn định; không sắp xếp lại giữa các lượt thử |
| M13 | Tầng FOUNDATION ở 054 | đọc `files.service.ts:123-161,225-229` | MIME ∉ allowlist ⇒ 415 `FOUNDATION-FILE-ERR-MIME` · đuôi bị chặn ⇒ 415 `-BLOCKED` · đuôi≠MIME ⇒ 415 `-EXTENSION` · >`file.max_upload_size_mb` (mặc định **25**) ⇒ 413 `-SIZE`; presign PUT ký KÈM `ContentType` + `ContentLength` (`object-storage.service.ts:150-157`) ⇒ PUT phải gửi đúng `Content-Type` đã khai. Mã nằm ở `error.code` — đo TĨNH: int-spec `files-e2e-confirm.int-spec.ts:243,258` + `me-preferences-avatar.int-spec.ts:410` (xanh trên CI master, KHÔNG chạy lại ở plan này) |
| M14 | Allowlist MIME thực tế | đọc `0435_…seed_modules.sql:316` + `setting-defaults.ts:41-56` | `png·jpeg·webp·pdf·docx·xlsx·csv·txt` — **KHÔNG có `video/*`, KHÔNG `image/gif`** ⇒ với cấu hình mặc định MỌI video ăn 415 ở 054; trần «1 video» chỉ chạm được khi công ty tự mở allowlist |
| M15 | Cổng tầng-2 054/055 | đọc `social-access.service.ts:333-339` | `create:feed-post`/`create:feed-comment` phải ở scope **Company**, thiếu ⇒ 403 `SOCIAL-ERR-FILE-TARGET-POST-DENIED`/`-COMMENT-DENIED`; tầng-1 (`view:feed`) thiếu ⇒ 403 `PermissionGuard` câu cố định, KHÔNG mã SOCIAL. `useCan` mù scope ⇒ vai tuỳ biến @Department thấy nút rồi ăn 403 |
| M16 | jsdom | probe P4a/P4b/P4c | `new File([...],"x.heic").type === ""`; **`URL.createObjectURL` = `undefined`** (phải stub — tiền lệ `MessageComposer.attach.spec.tsx:70`); `accept` KHÔNG lọc khi dispatch `change` ⇒ kiểm client phải ở JS, không dựa `accept` |
| M17 | Khuôn upload sẵn có | đọc `chat-upload.ts:45-81`, `storage-upload.ts:24-40`, `use-attachment-previews.ts` | 3 pha register→PUT→confirm, ném ngay ở pha lỗi; `putBytesToStorage(url,file,contentType)` `credentials:'omit'`, **KHÔNG nhận `signal`**; `useAttachmentPreviews` (sổ thu hồi blob URL) generic, tái dùng được |
| M18 | Response `006` | đọc `social-posts-moderation.service.ts:73-92` | dựng `toFeedPostDto` với `tags`+`attachments`+`myReaction`+`savedByMe` — KHÔNG `mentions`/`kudos`/`poll`/`idea` |
| M19 | Bề mặt vẽ thân bài | `grep -rn "<PostBody\|<PostCard" routes/social` (bỏ spec) | 3 chỗ: `PostCard.tsx:136` · `CommentList.tsx:78` · `NewsPage.tsx:272`. Mọi màn khác đi qua `FeedPostList → PostCard` |
| M20 | Va chạm nhánh đang mở | `git diff --stat master...feat/s16-social-feblockseed-1` (PR #559) | chạm `PostCard.tsx` (+34/-) · `PostCard.spec.tsx` · `social-test-doubles.tsx` · `FeedPage.spec.tsx` — TRÙNG file với lát A/B |
| M21 | `apiFetch` + env test web-core | đọc `packages/web-core/vitest.config.ts`; `node -e "typeof File"` | env `node`, `File` global có (Node v24.15.0 máy này; CI Node ≥20); spec mock `./api-client` (khuôn `social-kudos-api.spec.ts:12-15`) |

## 3. Bất biến phải giữ

- **company_id / RLS**: FE không gửi `companyId`; tenant do server lấy từ token (`social-files.service.ts:110-121`).
- **Masking ở SERVER**: đính kèm `url:null` (presign bị từ chối) ⇒ **KHÔNG vẽ gì** cho tệp đó (ảnh · video · tệp) — một ô
  «có tệp mà bạn không xem được» là rò sự tồn tại (luật `buildImageGrid`, `feed-format.ts:55-62`), mở rộng cho cả video/tệp.
- **Mention chỉ link khi server nói `withheld:false`**; đích link lấy từ `employeeId` của SERVER, chữ hiển thị là chữ trong
  `body`. `withheld:true` ⇒ SPAN, không tra theo tên ở FE (oracle `ERR-009`).
- **WS = DTO**: FE không đọc thân bài từ payload WS (`use-feed-realtime` chỉ đếm) — không đổi.
- **Permission fail-closed**: nút đính kèm sống TRONG ô soạn đã gác `create:feed-post` / `create:feed-comment` (ẩn hẳn khi
  thiếu); 403 của 054 đọc theo `error.code`, không theo câu chữ.
- **Không mất dữ liệu người dùng** (hợp đồng H2 FE-1): ô soạn chỉ dọn chữ + tệp khi Promise RESOLVE; REJECT giữ nguyên.
- **Không XSS**: không `dangerouslySetInnerHTML`; link tệp `target=_blank rel="noopener noreferrer"`; URL tệp chỉ từ server.
- **Không rò storage credential**: PUT lên storage qua `putBytesToStorage` (`credentials:'omit'`), không qua `apiFetch`.

## 4. Thiết kế

### Lát A — đính kèm

- **A1 · web-core `storage-upload.ts`**: `putBytesToStorage(url, file, contentType, signal?)` — tham số CUỐI tuỳ chọn,
  truyền vào `fetch`; abort ⇒ ném `Error` riêng (không nuốt). 4 call-site cũ không đổi.
- **A2 · web-core `social-files-api.ts` (MỚI)**: `socialFilesApi.requestUploadUrl(input)` → `POST /social/files/upload-url`
  parse `registerFileResponseSchema`; `.confirm(fileId, target)` → `POST /social/files/${id}/confirm` body `{target}` parse
  `confirmUploadResponseSchema`; `uploadSocialAttachment(file, target, {signal})` = 3 pha (khuôn `uploadChatAttachment`):
  `declaredMimeType = file.type || DEFAULT_UPLOAD_MIME` → register → PUT (cùng `Content-Type`) → confirm → trả
  `{fileId, kind, name, sizeBytes, mimeType}`. Pha nào lỗi ⇒ NÉM, không confirm/không trả `fileId`. `signal` đi vào cả 3 pha.
  Export ở `index.ts` (khối additive cạnh `socialKudosApi`).
- **A3 · thuần `routes/social/feed/lib/attachment-draft.ts` (MỚI)**:
  - `attachmentKindOf(mime)` — mirror `kindOf` BE (`toLowerCase().startsWith("image/"|"video/")`, rỗng ⇒ `file`).
  - `planAttachmentAdds(items, files)` ⇒ `{accepted: File[], rejected: {name, reason}[]}`; đếm trên item CHƯA lỗi; luật
    theo thứ tự: `tooLarge` (> `FEED_MAX_ATTACHMENT_BYTES`) · `tooManyImages` (>`FEED_MAX_IMAGES_PER_POST`) ·
    `tooManyVideos` (>`FEED_MAX_VIDEOS_PER_POST`) · `tooManyFiles` (>`FEED_MAX_ATTACHMENTS` — M10). Chỉ hằng contracts.
  - `attachmentSubmitState(items)` ⇒ `{ready:true, ids}` (thứ tự CHỌN — M12) | `{ready:false, reason:"uploading"|"hasErrors"}`.
  - `attachmentUploadErrorReason(err)` theo `ApiError.code`: `FOUNDATION-FILE-ERR-MIME|-EXTENSION|-BLOCKED` ⇒
    `unsupportedType` · `-SIZE` ⇒ `tooLargeServer` · `SOCIAL-ERR-FILE-TARGET-*-DENIED` ⇒ `attachDenied` · còn lại (PUT hỏng,
    `-CONFIRM-*`, mạng) ⇒ `uploadFailed`.
- **A4 · hook `routes/social/feed/lib/use-attachment-uploads.ts` (MỚI)** `({target})` ⇒ `{items, add(FileList), remove(id),
  retry(id), reset(), submitState, rejections}`: tải TUẦN TỰ (khuôn chat); mỗi item một `AbortController`; `remove` hủy +
  thu hồi preview; unmount ⇒ abort hết + `revokeAll` (dùng lại `@/components/chat/composer/use-attachment-previews` — chỉ
  IMPORT); `isMountedRef` chặn `setState` sau unmount.
- **A5 · `components/ComposerAttachmentTray.tsx` (MỚI)**: input `type=file multiple` ẩn + nút «Đính kèm» (icon `Paperclip`,
  `aria-label`), `accept` = gợi ý theo D2; khay ô: ảnh ⇒ `<img src=blob:>`, khác ⇒ chip tên + dung lượng; trạng thái
  «Đang tải…» / lỗi (chữ theo reason) + «Thử lại» / nút gỡ. Một alert `composer-attach-error` cho các tệp bị từ chối trước
  khi tải (tên + lý do, `{{max}}` = 20 MB / 10 / 1 / 11).
- **A6 · `FeedComposer`**: mount khay cho MỌI loại bài (D5) + `target:"post"`; `canSubmit &&= submitState.ready`; dòng lý do
  khi `uploading`/`hasErrors`; `buildDto` thêm `attachmentIds` CHỈ khi khác rỗng (vắng khoá ⇒ payload + khoá idempotency
  của bài không tệp y như hôm nay); resolve ⇒ `reset()`; reject ⇒ giữ. Sửa docblock `:19-20`.
- **A7 · `CommentComposer`**: như A6 với `target:"comment"`; body vẫn bắt buộc (M11); sửa docblock `:7-8`.
- **A8 · `components/PostAttachments.tsx` (MỚI)** + `feed-format.ts` `splitAttachments(atts)` ⇒ `{grid, videos, files}` —
  CẢ BA lọc `url !== null` (§3). Lưới ảnh giữ `buildImageGrid`; ảnh `onError` ⇒ thay bằng ô trung tính
  `attachment-image-unavailable` (không icon vỡ — M ở §1, TTL 300 s); video ⇒ `<video controls preload="metadata">`;
  tệp ⇒ `<a href target=_blank rel="noopener noreferrer">` tên + dung lượng. Biến thể `compact` cho bình luận.
  `PostCard` thay khối `:159-180` bằng `<PostAttachments>`; `CommentRow` + `NewsPage` row thêm `<PostAttachments compact>`.
- **A9 · lỗi gửi**: `ACTION_ERROR_REASONS` + `attachmentRejected` (`SOCIAL-ERR-007` — một câu cho cả LIMIT lẫn INVALID,
  M9) · `attachDenied`. `use-create-post.ts` onError: `kudosErrorReason ?? attachmentErrorReason ?? group…`;
  `PostDetailPage` `LocalActionError` thêm `reason` (khuôn `CreatePostError`) cho `createComment`.
- **A10 · i18n** file mới `i18n/locales/vi/social-attachments.ts` mount `attachment` trong `social.ts` (khuôn kudos);
  reason vào `actionError.reason.*`.

### Lát B — mention + `droppedMentions` + cache `006`

- **B1 · `parse-feed-body.ts`**: `parseFeedBody(body, mentions?)`; token mới `{kind:"mentionLink", value, employeeId}`.
  Bảng nhãn = phần tử `withheld === false` (đọc qua narrowing, không đọc `label` ở nhánh rút); nhãn trùng mà `employeeId`
  KHÁC ⇒ loại (mơ hồ ⇒ span). Ứng viên = `"@" + label` dò bằng `indexOf` (không regex — nhãn có `(`,`.`), biên trái giống
  `MENTION_RE` (không sau `[\p{L}\p{N}_]`), biên phải: ký tự kế KHÔNG phải `[\p{L}\p{N}_]`. Cùng vị trí ⇒ nhãn DÀI hơn
  thắng, `mentionLink` thắng `mention`. `mentions` vắng/`[]` ⇒ token y hệt hôm nay (C14 giữ xanh). Viết lại docblock `:12-23`, `:57-66`.
- **B2 · `PostBody`** prop `mentions?: readonly FeedMentionDto[]`; `mentionLink` ⇒ `<Link to="/feed/profiles/$employeeId">`;
  `mention` vẫn span. `PostCard.tsx:136` · `CommentList.tsx:78` · `NewsPage.tsx:272` truyền `x.mentions`.
- **B3 · `droppedMentions` bình luận**: tách `components/DroppedMentionsNotice.tsx` từ `CreatePostNotices.tsx:33-53`
  (giữ `data-testid="dropped-mentions-notice"` cho bài); `PostDetailPage` giữ `droppedCount` từ `createComment.onSuccess`,
  dọn ở `onMutate`, vẽ notice testid `comment-dropped-mentions-notice` cạnh ô soạn.
- **B4 · cache `006` (D3)**: KHÔNG thêm merge — giữ invalidate-only (M3/M5). Ghim bằng ca K1 + docblock cảnh báo tại
  `moderateMutation` («`006` không mang `mentions`/`kudos`/`poll`/`idea` — muốn cập nhật cache tức thì thì PHẢI merge giữ khoá vắng, M2»).

## 5. Test RED trước (deny-path trước, mỗi ca DENY đứng cạnh ca ALLOW)

> Spec mới đặt trong glob được nạp: `apps/app/src/**/*.spec.{ts,tsx}` · `packages/web-core/src/**/*.spec.{ts,tsx}`.
> RED do «module chưa tồn tại» là **lỗi NẠP FILE** (đọc dòng `Test Files … failed` + 0 `Tests`), không phải assert — ghi rõ
> trong sổ thi công; mọi ca khác phải đỏ ĐÚNG thông điệp ghi dưới.

### Ca test lát A

| # | Ca | Đỏ trên code hiện tại vì |
| --- | --- | --- |
| W2 | `uploadSocialAttachment` — register ném `ApiError(415,"FOUNDATION-FILE-ERR-MIME")` ⇒ `fetch` 0 lần, confirm 0 lần, reject ĐÚNG lỗi đó | load fail (module mới) |
| W3 | PUT trả 403 ⇒ confirm 0 lần, reject | load fail |
| W4 | confirm ném ⇒ reject, không trả `fileId` | load fail |
| W5 | `signal` abort giữa PUT ⇒ reject, confirm 0 lần; `fetch` nhận đúng `signal` | load fail |
| W1 | ALLOW: thứ tự gọi `054` body `{target:"post",originalName,declaredMimeType:"image/png",sizeBytes}` → PUT `Content-Type:image/png` + `credentials:"omit"` → `055` body `{target:"post"}`; chạy schema đã truyền trên payload hình BE | load fail |
| W6 | `file.type===""` ⇒ khai + PUT `application/octet-stream` | load fail |
| S1 | `putBytesToStorage(…, signal)` chuyển `signal` vào `fetch` | `expected undefined to be <signal>` |
| C1 | `planAttachmentAdds`: 11 ảnh ⇒ 10 nhận + `tooManyImages`; video thứ 2 ⇒ `tooManyVideos`; `20MB+1` ⇒ `tooLarge`, đúng `20MB` ⇒ nhận; 10 ảnh+1 video+1 pdf ⇒ pdf `tooManyFiles`; item `error` không tính; `IMAGE/PNG` ⇒ image | load fail |
| C2 | `attachmentSubmitState`: có `uploading` ⇒ not ready; có `error` ⇒ `hasErrors`; ids theo thứ tự chọn | load fail |
| F1 | **DENY** FeedComposer chọn tệp `20MB+1` ⇒ spy `uploadSocialAttachment` 0 lần + alert lý do `tooLarge` | `Unable to find … [data-testid="composer-attach-input"]` |
| F2 | 11 ảnh ⇒ spy đúng 10 lần (target `"post"`) + 1 dòng từ chối | như F1 |
| F3 | **DENY** upload ném `ApiError(403,"SOCIAL-ERR-FILE-TARGET-POST-DENIED")` ⇒ ô lỗi chữ `attachDenied`, nút Đăng KHOÁ; gỡ ô ⇒ mở; `415 MIME` ⇒ `unsupportedType` | như F1 |
| F4 | đang tải ⇒ nút Đăng khoá; xong ⇒ payload `attachmentIds:[f1,f2]` đúng thứ tự; KHÔNG tệp ⇒ `"attachmentIds" in dto === false` | như F1 |
| F5 | `onSubmit` reject ⇒ khay giữ; resolve ⇒ khay rỗng + `URL.revokeObjectURL` gọi đúng blob URL (stub `createObjectURL` — M16) | như F1 |
| F6 | unmount khi đang tải ⇒ `signal.aborted === true` | như F1 |
| F7 | composer NHÓM (`groupId`) có nút đính kèm, target `"post"` | như F1 |
| K1c | CommentComposer: target `"comment"`; có tệp mà body rỗng ⇒ nút KHOÁ (M11); payload `attachmentIds` | `Unable to find … [data-testid="comment-attach-input"]` |
| E1 | `use-create-post`: `ApiError(422,"SOCIAL-ERR-007")` ở bảng tin ⇒ `reason:"attachmentRejected"` (cạnh ca ERR-012 bảng tin vẫn `null`) | `expected null to be 'attachmentRejected'` |
| E2 | `PostDetailPage`: `createComment` ném `ApiError(422,"SOCIAL-ERR-007")` ⇒ banner `data-reason="attachmentRejected"` | `expected null to be 'attachmentRejected'` (`getAttribute`) |
| R1 | `PostAttachments`/PostCard: `[ảnh url, ảnh null, video url, video null, tệp url, tệp null]` ⇒ 1 `img` · 1 `video` (src đúng) · 1 `a[href=url]` tên tệp, `rel` đủ, `target=_blank` · tên tệp `null` KHÔNG xuất hiện ở đâu | `expected 0 to be 1` (`querySelectorAll("video")`) |
| R2 | `fireEvent.error(img)` ⇒ không còn `img`, có `attachment-image-unavailable` | `Unable to find … attachment-image-unavailable` |
| R3 | CommentList: bình luận có ảnh ⇒ `comment-attachments` chứa `img` | `Unable to find … comment-attachments` |
| R4 | NewsPage: tin có ảnh ⇒ `img` trong `news-row` | `expected null not to be null` |
| I1 | `ActionErrorBanner.spec` (lặp tập reason) với 2 reason mới — chữ ≠ khoá thô | xanh tự động sau A9/A10 (đỏ nếu quên i18n) |

### Ca test lát B

| # | Ca | Đỏ trên code hiện tại vì |
| --- | --- | --- |
| P2 | **DENY** chỉ `{withheld:true}` ⇒ KHÔNG `mentionLink`; phần tử bị nhét lậu `{withheld:true, employeeId, label}` (cast) ⇒ vẫn không link | xanh-giả trên code cũ (không có link nào) ⇒ chỉ có giá trị cạnh P1 + mutant mB1 |
| P3 | **DENY** 2 phần tử `withheld:false` cùng nhãn, KHÁC `employeeId` ⇒ span | như P2 |
| P4 | **DENY** biên phải: `"@Nguyễn Văn Anh"` với nhãn `"Nguyễn Văn An"` ⇒ không link; `"x@Nguyễn Văn An"` ⇒ không link | như P2 |
| P1 | ALLOW: `parseFeedBody("Chào @Nguyễn Văn An!", [{withheld:false, employeeId:E1, label:"Nguyễn Văn An"}])` ⇒ `[text "Chào ", {mentionLink "@Nguyễn Văn An", E1}, text "!"]` | `toEqual` lệch: nhận `{kind:"mention", value:"@Nguyễn"}` (M6) |
| P5 | nhãn `"An"` + `"An Nguyễn"`: `"@An Nguyễn và @An."` ⇒ link E(An Nguyễn) rồi link E(An), `"."` là text | `toEqual` lệch |
| P6 | nhãn có ký tự regex `"Lê (HR)"` ⇒ khớp nguyên văn | `toEqual` lệch |
| P7 | `mentions` vắng / `[]` ⇒ token y hệt bản cũ (13 ca C14 cũ giữ xanh, chạy lại nguyên file) | xanh (lưới hồi quy) |
| B1 | PostBody: có mentions ⇒ `a[href="/feed/profiles/E1"]` chữ `@Nguyễn Văn An`; `withheld` ⇒ span, 0 `a`. ⚠️ Mock `Link` hiện tại (`PostBody.spec.tsx:18-30`) BỎ `params` ⇒ href thành `/feed/profiles/$employeeId` với MỌI id — sửa mock cho NỘI SUY params (bài học H2 FE-2C) TRƯỚC khi viết ca, nếu không link sai người vẫn xanh | `Unable to find role link` |
| B2 | PostCard truyền `post.mentions` ⇒ link; bài KHÔNG khoá `mentions` (006/WS) ⇒ span | `Unable to find role link` |
| B3 | CommentList / NewsPage truyền `mentions` ⇒ link | `Unable to find role link` |
| D1 | PostDetailPage: `createComment` resolve `{…, droppedMentions:[a,b]}` ⇒ `comment-dropped-mentions-notice` chữ `count:2`; lượt gửi mới dọn; `[]` ⇒ vắng | `Unable to find … comment-dropped-mentions-notice` |
| D2 | `FeedPage.spec` M7 cũ (`dropped-mentions-notice` của bài) xanh sau khi tách component | xanh (hồi quy) |
| K1 | `use-feed-actions`: seed `posts.detail(p1)` có `mentions`; `moderatePost` resolve DTO hình `006` (không `mentions`) ⇒ sau `onSuccess`: `getQueryData(detail).mentions` NGUYÊN + `isInvalidated:true` | **xanh trên code hiện tại (ghim)** — giá trị nằm ở mutant mK |

**Mutant (sao lưu → cấy → khôi phục bằng bản sao, KHÔNG `git checkout --`; đỏ ĐÚNG ca, ĐÚNG thông điệp):**
mA1 bỏ `planAttachmentAdds` trước khi tải ⇒ F1 (`expected spy to not be called`) · mA2 bỏ lọc `url!==null` cho video ⇒ R1
(`expected 2 to be 1`) · mA3 bỏ pha confirm ⇒ W1 · mA4 gửi `attachmentIds:[]` khi rỗng ⇒ F4 · mA5 bỏ `submitState.ready` khỏi
`canSubmit` ⇒ F4/F3 · mA6 bỏ ánh xạ `007` ⇒ E1+E2 · mA7 không nối `signal` ⇒ F6/W5 · mA8 bỏ `onError` ảnh ⇒ R2 ·
mB1 bỏ vế `withheld===false` (đọc `label` qua cast) ⇒ P2 · mB2 bỏ biên phải ⇒ P4 · mB3 bỏ loại nhãn mơ hồ ⇒ P3 ·
mB4 nhãn NGẮN trước ⇒ P5 · mB5 `PostCard` không truyền `mentions` ⇒ B2 · mB6 bỏ notice bình luận ⇒ D1 ·
mK thêm `queryClient.setQueryData(socialKeys.posts.detail(post.id), post)` vào `moderateMutation.onSuccess` ⇒ K1
(`expected undefined to deeply equal [...]`).

## 6. Quyết định owner

| # | Câu hỏi | Phương án | Khuyến nghị · lý do | Chặn? |
| --- | --- | --- | --- | --- |
| **D1** | Lát B «ngủ»: web KHÔNG sinh được mention (M7) ⇒ link + `droppedMentions` chỉ sáng khi có nguồn khác | (a) làm render-only như done_when + seed WO BE «danh bạ nhắc tên» · (b) hoãn lát B tới khi có ô chọn mention · (c) mở rộng WO dựng ô chọn (không làm được: không route SOCIAL nào trả `userId` cho bài công ty) | **(a)** — rẻ (~400 LOC gồm test), đúng done_when, tự sáng khi BE có danh bạ; seed **`S16-SOCIAL-MENTIONDIR-1`** (BE: 002/015 nhận `mentionedEmployeeIds` hoặc danh bạ nhắc tên kiểu 059 — quyết định oracle `ERR-009` là của WO đó) | **Có — chỉ lát B** |
| **D2** | Video: allowlist mặc định KHÔNG có `video/*` (M14) | (a) `accept` mời cả `video/*`, server 415 ⇒ «định dạng chưa hỗ trợ» · (b) `accept` = allowlist mặc định (không video), trần 1 video vẫn kiểm client · (c) dựng `accept` động từ `GET /foundation/settings/public?category=File` | **(b)** + seed WO cấu hình (thêm `video/mp4` vào allowlist + `MIME_TO_EXTENSIONS`, có migration seed). (c) đúng nhất nhưng thêm phụ thuộc FOUNDATION + map `Record<string,unknown>` không kiểu — ghi nợ | Không |
| **D3** | done_when «006 không mang mentions ⇒ giữ mảng cũ khi merge cache» — hôm nay KHÔNG có merge (M5) | (a) giữ invalidate-only, ghim K1 + mutant mK · (b) thêm `mergeModeratedPost(old,fresh)` giữ `mentions/kudos/poll/idea` + `setQueryData` để UI đổi tức thì | **(a)** — vế done_when thoả bằng thiết kế, có lưới chống ai đó thêm `setQueryData` trần; (b) thêm một đường ghi cache cần chống cũ-đè-mới (memory TanStack) cho lợi ích vài trăm ms | Không |
| **D4** | Đính kèm `url:null` loại video/tệp | (a) ẩn hẳn như ảnh · (b) chip «không xem được» | **(a)** — (b) rò sự tồn tại (cùng lý do `buildImageGrid`) | Không |
| **D5** | Loại bài có nút đính kèm | (a) cả 5 loại (server nhận mọi loại — `social-posts.service.ts:300`) · (b) chỉ share/news/idea | **(a)** — một đường mã, không đặc cách | Không |
| **D6** | `SOCIAL-ERR-007` chung cho LIMIT và INVALID (M9) | (a) một câu gộp ở FE · (b) đọc `message` | **(a)** (cấm so câu chữ) + ghi nợ BE tách sentinel `ATTACHMENT_INVALID` | Không |
| **D7** | Va chạm PR #559 FEBLOCKSEED-1 (M20) | (a) thi công SAU khi #559 merge, rebase master · (b) làm song song, giải xung đột lúc PR | **(a)** — 4 file trùng, `PostCard.tsx` cả hai lát đều sửa | Không (khuyến nghị thứ tự) |
| **D8** | Tiến độ tải | (a) «Đang tải…» không % (dùng `putBytesToStorage`) · (b) XHR có % (khuôn `employee-file-api`) | **(a)** — trần 20 MB, KISS; % ghi nợ | Không |
| **D9** | Tách PR | (a) 1 PR 2 commit (A rồi B) · (b) 2 PR — **B trước** (nhỏ, ít rủi ro) rồi A | **(b)** nếu D1=(a); nếu D1=(b) thì chỉ còn lát A | Không |

## 7. Ngoài phạm vi / nợ (ghi vào PR; KHÔNG sửa BE trong WO này)

- **G1 (BE)** không có danh bạ nhắc tên: `mentionedUserIds` đòi `users.id` mà SOCIAL không phơi `userId` (M7) ⇒ D1.
- **G2 (BE/cấu hình)** allowlist thiếu `video/*` dù SPEC-16 SC-01 hứa video (M14) ⇒ D2.
- **G3 (BE)** `SOCIAL-ERR-007` gộp LIMIT + INVALID (M9) ⇒ D6.
- **G4 (BE)** đường SỬA `004`/`016` chỉ đếm trần trên tệp MỚI (`assertLinkableFilesTx(toAdd)`, `social-attachments.service.ts:445`)
  ⇒ 10 ảnh cũ + 1 ảnh mới = 11 ảnh lọt. FE chưa có UI sửa nên chưa chạm.
- **G5 (BE)** tệp `Pending`/`Uploaded` mồ côi khi người dùng gỡ/bỏ nháp — job dọn chưa có (`files.service.ts:59-64`, TODO S2-FND-JOBS-1).
- **G6 (BE)** TTL ký GET 300 s ⇒ FE chỉ giảm nhẹ bằng ô trung tính (A8); sửa gốc là TTL/refetch.
- **G7 (sản phẩm)** không có bài/bình luận CHỈ ảnh (M11).
- **FE**: UI sửa bài/bình luận kèm tệp (chưa có UI sửa — grep `updatePost` app = 0) · kéo-thả/dán tệp · lightbox ảnh ·
  % tiến độ (D8) · `accept` động (D2c) · avatar `src` thô (`S16-SOCIAL-AVATARPRESIGN-1`, không đụng).

## 8. Thứ tự thi công + lệnh verify

0. (D7) chờ #559 merge → `git rebase master` trong worktree. Lane DB: `bash scripts/lane-db-setup.sh fe2d` (chỉ cho `--all`).
1. **Lát B** (D9b): RED P1–P7 · B1–B3 · D1 · K1 → B1–B4 → GREEN → mutant mB1–mB6 + mK.
2. **Lát A**: A1–A2 + spec web-core (RED W/S) → rebuild web-core → A3–A4 + spec C → A5–A7 + spec F/K1c → A8 + spec R →
   A9–A10 + spec E/I1 → mutant mA1–mA8.
3. Lệnh (mọi lệnh bắt đầu `cd "/c/dev 2/MediaOS-fe2d"`; đọc dòng `Test Files` + `Tests`):
   - `pnpm --filter @mediaos/web-core exec vitest run src/lib/social-files-api.spec.ts src/lib/storage-upload.spec.ts`
   - `pnpm --filter @mediaos/contracts build && pnpm --filter @mediaos/web-core build` (web-core `exports` trỏ `dist`)
   - `pnpm --filter @mediaos/app exec vitest run src/routes/social` — **TẤT CẢ spec module trong MỘT lượt** (ERR_IPC ⇒ `--no-file-parallelism`)
   - `pnpm --filter @mediaos/app test:social-cov` — đọc 4 số, sàn 80
   - `pnpm typecheck && pnpm lint` · `bash harness/check.sh --quick`
   - Gate LIGHT: `typescript-reviewer` + `react-reviewer` + `quality-gate` trên diff
   - Trước PR: `bash harness/check.sh --all --lane-db=fe2d` (FE-only, nhưng thiếu `LANE_DB` ⇒ «XANH KHÔNG ĐỦ BẰNG CHỨNG» exit 1)
4. Bẫy đã kiểm: withTenant lồng · timestamptz thô · RETURNING · resigned — **không áp** (FE-only, không chạm `apps/api`).
   **Áp**: `PermissionGuard` câu cố định (403 tầng-1 của 054 không mã SOCIAL ⇒ rơi về `uploadFailed`/forbidden chung) ·
   mã SOCIAL ở `error.code` (E1/E2/F3) · spec đúng glob · chạy cả module một lượt · `ActionErrorBanner.spec` là lưới
   ratchet reason (thêm, không nới).

## 9. Rủi ro + kích thước

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | Xung đột #559 (M20) | D7 — rebase sau merge |
| R2 | Lát B ngủ (M7) | D1 — nói rõ trong PR; seed MENTIONDIR-1 |
| R3 | Sửa chữ sau một lượt gửi mà server đã tạo bài (mất response) ⇒ khoá idempotency mới ⇒ tệp đã link ⇒ 422 `007` | câu `attachmentRejected` nói «tệp đã dùng / không hợp lệ»; ghi PR |
| R4 | `useCan` mù scope (M15) ⇒ vai @Department thấy nút rồi 403 ở 054 | reason `attachDenied` nói đúng lý do |
| R5 | jsdom thiếu `createObjectURL` (M16), cảnh báo `act` với tải bất đồng bộ | stub trong spec; chờ trạng thái ô trước khi kết thúc ca |
| R6 | Trùng tên người: phần tử `withheld` vô danh + phần tử link cùng nhãn ⇒ có thể link nhầm người cùng tên | chấp nhận có ghi — không lộ thêm gì (người được link vốn hiện được); nhãn trùng giữa 2 phần tử link ⇒ span (P3) |
| R7 | Import chéo `@/components/chat/composer/use-attachment-previews` | chỉ import; TS bắt khi chat dời file |
| R8 | 20 MB trên mạng chậm, không timeout PUT | nút gỡ = abort (F6) |

**Kích thước ước lượng:** Lát A ≈ 15 file (7 mới: `social-files-api.ts`+spec · `storage-upload.spec.ts` · `attachment-draft.ts`+spec ·
`use-attachment-uploads.ts` · `ComposerAttachmentTray.tsx` · `PostAttachments.tsx`+spec · `social-attachments.ts` i18n), ~**+1.150/−40 LOC**
(~650 test), **~40 ca**. Lát B ≈ 9 file (1 mới `DroppedMentionsNotice.tsx`), ~**+420/−30 LOC** (~260 test), **~22 ca**.
Tổng ≈ 24 file · ~1.550 LOC · ~62 ca mới; `FeedComposer.tsx` 360→~420, `PostDetailPage.tsx` 292→~330 (dưới trần 800).
