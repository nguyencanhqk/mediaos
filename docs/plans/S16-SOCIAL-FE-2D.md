# S16-SOCIAL-FE-2D — FE nợ nội dung SOCIAL: đính kèm (054/055) · @mention thành link · `droppedMentions` của bình luận

> Trạng thái: **plan v2 (02/10/2026)** — đã vá `plan-reviewer` lượt 1 (PASS, 3 MAJOR + 7 MINOR — §10); owner ký §6
> 02/10/2026 (mọi khuyến nghị). FULL gate lượt 1 (typescript-reviewer + security-reviewer, cả hai PASS) — xử lý ở §11.
> FULL gate lượt 2 (security-reviewer 1 HIGH + 1 MEDIUM: tiền đề «tải về an toàn với cấu hình mặc định» SAI) — xử lý ở §12.
> Nhánh `feat/s16-social-fe-2d` cắt từ master `14afbb5f`. Zone amber. Gate: lát **B** = LIGHT (`typescript-reviewer` +
> `react-reviewer` + `quality-gate`); lát **A** = LIGHT **+ `security-reviewer`** (tệp người dùng + PUT ra storage ngoài —
> luật kích hoạt security chung, §10 #10). FE-only: KHÔNG migration, KHÔNG cặp quyền mới, KHÔNG sửa `apps/api`. Quyền chỉ
> qua `useCan`/`PermissionGate`. Nguồn: nợ N1 plan FE-1 (đính kèm) · nợ R3 plan BE-1D (mention link) · nợ «droppedMentions
> bình luận» FE-1 §9 · plan-reviewer FE-2 M9. Đề xuất **hai lát**: **A** đính kèm (composer + bình luận + vẽ) · **B** mention
> link + `droppedMentions` bình luận + ghim ngữ nghĩa cache `006`. **Điều kiện MERGE: PROD API đủ mới (D11, §8 bước 0b);
> lát A thêm: API PROD có `S16-SOCIAL-FILEDISPOSITION-1` (§12 H1).**

## 1. Bối cảnh — cái gì đang sai (code HIỆN TẠI, `14afbb5f`)

**Đính kèm — ghi:**

- `FeedComposer.tsx:19-20` và `CommentComposer.tsx:7-8` còn docblock «KHÔNG có nút đính kèm … giao FE-2D»; `buildDto`
  (`FeedComposer.tsx:156-183`) và `submit` (`CommentComposer.tsx:84-106`) không bao giờ gửi `attachmentIds`.
- Cửa vào đã có từ BE-1C: `POST /social/files/upload-url` (054) · `POST /social/files/{id}/confirm` (055)
  (`social-files.controller.ts:64-89`); body `socialFileUploadUrlInputSchema` `{target, originalName, declaredMimeType,
  sizeBytes}.strict()` và `socialFileConfirmInputSchema` `{target}.strict()` (`contracts social-api.ts:688-707`) —
  **KHÁC chat** (`/chat/files/:id/confirm` body `{}`). Response = `RegisterFileResponse`/`ConfirmUploadResponse` của
  FOUNDATION (`social-files.service.ts:2-6,109,141`). 0 client trong `packages/web-core` (grep `social/files` = 0).
- Ô soạn chỉ khoá NÚT GỬI khi đang gửi: `busy` (`FeedComposer.tsx:135`) đi vào `PollComposerFields`/`KudosComposerFields
  disabled={busy}` (`:282,310`) và nút (`:354`); `textarea` KHÔNG khoá (`:288-295`; `CommentComposer.tsx:126-133`). Khay
  đính kèm mới mà làm theo khuôn textarea thì thêm được tệp GIỮA lượt gửi (§10 #1).
- Cả hai ô soạn có lệnh `return` sớm SAU khối hook: `FeedComposer.tsx:131` (`!canCreatePost ⇒ null`), `CommentComposer.tsx:71-78`
  (`locked` / `!canComment`) — hook tải tệp phải đặt TRƯỚC các lệnh này (M24).

**Đính kèm — đọc:**

- `PostCard.tsx:70,159-180` CHỈ vẽ lưới ẢNH (`buildImageGrid` lọc `url !== null`, `feed-format.ts:63-71`). Đính kèm
  `kind:'video'`/`'file'` **không được vẽ ở đâu cả** (biến mất im lặng). `buildImageGrid` KHÔNG kiểm lược đồ URL —
  `javascript:`/`data:` lọt nguyên văn (M33).
- `CommentList.tsx:62-79` (`CommentRow`) **không vẽ đính kèm nào** dù `feedCommentSchema.attachments` luôn có mặt.
- `NewsPage.tsx:272` vẽ tin bằng `PostBody` trần — không ảnh, không mention.
- `<img>` lưới ảnh không có `onError` (`PostCard.tsx:166-171`); URL ký GET sống **300 s** (`object-storage.service.ts:92`
  `S3_PRESIGN_TTL_SEC ?? 300`) ⇒ ảnh `loading="lazy"` cuộn tới sau 5 phút = ô ảnh VỠ dù `url` khác null. Video cũng
  vậy khi phát/tua sau 300 s (§10 #6).
- URL ký GET không kèm `ResponseContentDisposition` (`object-storage.service.ts:199-206`) ⇒ tệp phục vụ INLINE theo
  Content-Type đã khai (M32).

**Mention:**

- `PostBody.tsx:58-68` vẽ token `mention` thành SPAN; docblock `parse-feed-body.ts:12-23` nói «contract không trả
  mảng mention» — **đã SAI từ BE-1D**: `feedPostSchema.mentions?`/`feedCommentSchema.mentions?` =
  `discriminatedUnion("withheld", [{withheld:false, employeeId, label}, {withheld:true}])` (`social-api.ts:168-175,217,249`).
- `MENTION_RE` (`parse-feed-body.ts:67`) chỉ bắt MỘT chữ: `@Nguyễn Văn An` ⇒ token `@Nguyễn` + text «␠Văn An» (đo P2a).
- Tokenizer cắt `rest` sau mỗi token (`parse-feed-body.ts:119-136`) ⇒ lookbehind mất ngữ cảnh trái: `#tag@An` ⇒ mention
  `@An` trong khi `tag@An` ⇒ text (M27).
- `PostCard.tsx:136`, `CommentList.tsx:78`, `NewsPage.tsx:272` không truyền `mentions` xuống `PostBody`.

**`droppedMentions` bình luận:** `PostDetailPage.tsx:95-104` `createComment.onSuccess` vứt response; bài thì đã có
(`use-create-post.ts:79` + `CreatePostNotices.tsx:33-53`).

**Cache `006`:** `use-feed-actions.ts:132-140` `moderateMutation.onSuccess` CHỈ `invalidatePostLists(post.id)` — không
`setQueryData`. Response `006` dựng riêng, KHÔNG mang `mentions`/`kudos`/`poll`/`idea`
(`social-posts-moderation.service.ts:73-92`).

## 2. Phép đo (02/10/2026, worktree `MediaOS-fe2d` @ `14afbb5f`)

Probe ở `scratchpad/probes/fe2d/` (config vitest riêng, resolve qua `apps/app`): `pnpm exec vitest run --config
<probe>/vitest.probe.config.mts` ⇒ v1: **Test Files 2 passed · Tests 13 passed**; lượt 1 plan-review thêm
`review1.probe.spec.tsx` (**9 passed**) · `msg2.probe.spec.ts` (**1 passed**) · `scheme.probe.spec.tsx` (**1 passed**).

| # | Khẳng định | Cách đo | Kết quả |
| --- | --- | --- | --- |
| M1 | Baseline spec sẽ chạm | `pnpm --filter @mediaos/app exec vitest run` 11 file (FeedComposer · CommentComposer · CommentList · PostCard · PostBody · parse-feed-body · PostDetailPage · FeedPage · use-create-post · use-feed-actions · GroupPage) `--reporter=verbose` | **11 file · 220 ca XANH** (34·6·22·28·9·13·27·22·10·23·26) |
| M2 | `setQueryData` thay NGUYÊN object | probe P1a: seed detail có `mentions` → `setQueryData(detail, dto006)` | data sau = `{"id":"p1","body":…,"status":"hidden"}` — **`mentions` MẤT** ⇒ mọi merge tương lai phải giữ khoá vắng |
| M3 | `invalidateQueries` trên query KHÔNG observer | probe P1b | `isInvalidated:true`, queryFn 0 lần, **data cũ GIỮ NGUYÊN** (mentions còn) |
| M4 | `invalidateQueries` trên query CÓ observer | probe P1c (đợi `status:'success'` trước) | refetch, data = kết quả queryFn MỚI. ⚠️ Lượt đầu của probe invalidate KHI lượt fetch đầu còn bay ⇒ không thấy lượt gọi thứ 2 trong 1 s — ca test phải đợi `success` rồi mới invalidate |
| M5 | Hiện trạng `006` trong cache | đọc `use-feed-actions.ts:132-140` + grep `setQueryData` `routes/social` (bỏ spec) | chỉ 2 chỗ: `PollBlock.tsx:69` (kết quả 043) · `GroupSettingsTab.tsx:84` (nhóm) — **KHÔNG chỗ nào ghi DTO bài vào cache** ⇒ hôm nay `006` không thể làm mất `mentions`. Đo lại trên #559: M30 |
| M6 | Tokenizer hiện tại | probe P2a/P2b/P2c | `"@Nguyễn Văn An"` ⇒ `mention "@Nguyễn"` + text; `a@b.com` ⇒ không mention (lookbehind); `"Cảm ơn @An."` ⇒ token `"@An."` (dấu chấm DÍNH vào token) |
| M7 | Ai sinh ra mention trên web? | `grep -rn mentionedUserIds apps/app/src packages/web-core/src` (bỏ dòng comment) | **0 call-site**. Composer SOCIAL KHÔNG có ô chọn mention; mọi SOCIAL DTO cố ý KHÔNG trả `userId` (grep `userId` contracts `social-api*.ts` — chỉ ngoại lệ nhóm `037`) ⇒ web KHÔNG tạo được mention ⇒ `mentions` luôn `[]` và `droppedMentions` luôn `[]` với nội dung đăng từ web |
| M8 | Nhãn mention | đọc `social-mentions.ts:426-503` | `label = users.full_name.trim()`, thứ tự `(created_at,id)` (KHÔNG theo vị trí trong body); TK đổi tên ⇒ `label` ≠ chữ trong body ⇒ không khớp (an toàn: rơi về span) |
| M9 | Trần đính kèm phía BE | đọc `social-attachments.service.ts:305-334,626-631` | trên TẬP TỆP MỚI của lượt: `kindOf` theo tiền tố MIME (`image/`·`video/`, lowercase); ảnh >10 hoặc video >1 ⇒ 422 `ATTACHMENT_LIMIT`; tệp >20 MB ⇒ 422 `ATTACHMENT_LIMIT`; thiếu/không phải của mình/chưa `Uploaded`/đã từng link ⇒ 422 `ATTACHMENT_INVALID`. **Cả hai cùng mã `SOCIAL-ERR-007`** (`contracts social-errors.ts:30-31`) ⇒ FE KHÔNG phân biệt được bằng `code` |
| M10 | Trần tổng ở Zod | probe P5b: `createFeedPostSchema` 11 vs 12 `attachmentIds` | `FEED_MAX_ATTACHMENTS=11`; 11 ⇒ OK · 12 ⇒ **400 vô danh** (không phải 422) ⇒ FE PHẢI chặn tổng >11 phía client |
| M11 | Body bắt buộc | probe P5c | bình luận `body:""` + 1 tệp ⇒ từ chối; bài `share` không body ⇒ từ chối ⇒ **không có bài/bình luận CHỈ ảnh** |
| M12 | Thứ tự `attachmentIds` & idempotency | probe P5a `idempotencyKeyFor("social-post", …)` đảo thứ tự 2 id | khoá KHÁC ⇒ giữ thứ tự CHỌN ổn định; không sắp xếp lại giữa các lượt thử |
| M13 | Tầng FOUNDATION ở 054 | đọc `files.service.ts:123-161,225-229` | MIME ∉ allowlist ⇒ 415 `FOUNDATION-FILE-ERR-MIME` · đuôi bị chặn ⇒ 415 `-BLOCKED` · đuôi≠MIME ⇒ 415 `-EXTENSION` · >`file.max_upload_size_mb` (mặc định **25**) ⇒ 413 `-SIZE`; presign PUT ký `ContentLength` nhưng **KHÔNG ký `Content-Type`** (sửa ở FULL gate lượt 2 — M36; bản trước ghi «ký KÈM `ContentType`» theo `object-storage.service.ts:150-157` là SAI) ⇒ FE vẫn gửi đúng `Content-Type` đã khai (ý định thiết kế), nhưng storage KHÔNG ép. Mã nằm ở `error.code` — đo TĨNH: int-spec `files-e2e-confirm.int-spec.ts:243,258` + `me-preferences-avatar.int-spec.ts:410` (xanh trên CI master, KHÔNG chạy lại ở plan này) |
| M14 | Allowlist MIME thực tế | đọc `0435_…seed_modules.sql:316` + `setting-defaults.ts:41-56` | `png·jpeg·webp·pdf·docx·xlsx·csv·txt` — **KHÔNG có `video/*`, KHÔNG `image/gif`** ⇒ với cấu hình mặc định MỌI video ăn 415 ở 054; trần «1 video» chỉ chạm được khi công ty tự mở allowlist |
| M15 | Cổng tầng-2 054/055 | đọc `social-access.service.ts:333-339` | `create:feed-post`/`create:feed-comment` phải ở scope **Company**, thiếu ⇒ 403 `SOCIAL-ERR-FILE-TARGET-POST-DENIED`/`-COMMENT-DENIED`; tầng-1 (`view:feed`) thiếu ⇒ 403 `PermissionGuard` câu cố định, KHÔNG mã SOCIAL. `useCan` mù scope ⇒ vai tuỳ biến @Department thấy nút rồi ăn 403 |
| M16 | jsdom | probe P4a/P4b/P4c | `new File([...],"x.heic").type === ""`; **`URL.createObjectURL` = `undefined`** (phải stub — tiền lệ `MessageComposer.attach.spec.tsx:70`); `accept` KHÔNG lọc khi dispatch `change` ⇒ kiểm client phải ở JS, không dựa `accept` |
| M17 | Khuôn upload sẵn có | đọc `chat-upload.ts:45-81`, `storage-upload.ts:24-40`, `use-attachment-previews.ts` | 3 pha register→PUT→confirm, ném ngay ở pha lỗi; `putBytesToStorage(url,file,contentType)` `credentials:'omit'`, **KHÔNG nhận `signal`**, và **bọc MỌI lỗi mạng thành `Error` chung** (`storage-upload.ts:36-38`) ⇒ một `try/catch` đi tiếp sang confirm là dạng hồi quy thực tế nhất (mA9); `useAttachmentPreviews` (sổ thu hồi blob URL) generic, tái dùng được |
| M18 | Response `006` | đọc `social-posts-moderation.service.ts:73-92` | dựng `toFeedPostDto` với `tags`+`attachments`+`myReaction`+`savedByMe` — KHÔNG `mentions`/`kudos`/`poll`/`idea` |
| M19 | Bề mặt vẽ thân bài | `grep -rn "<PostBody\|<PostCard" routes/social` (bỏ spec) | 3 chỗ: `PostCard.tsx:136` · `CommentList.tsx:78` · `NewsPage.tsx:272`. Mọi màn khác đi qua `FeedPostList → PostCard` |
| M20 | Va chạm nhánh đang mở | `git diff --stat master...feat/s16-social-feblockseed-1` (PR #559) | chạm `PostCard.tsx` (+34/-) · `PostCard.spec.tsx` · `social-test-doubles.tsx` · `FeedPage.spec.tsx` — TRÙNG file với lát A/B |
| M21 | `apiFetch` + env test web-core | đọc `packages/web-core/vitest.config.ts`; `node -e "typeof File"` | env `node`, `File` global có (Node v24.15.0 máy này; CI Node ≥20); spec mock `./api-client` (khuôn `social-kudos-api.spec.ts:12-15`) |
| M22 | Khoá ô soạn khi đang gửi | đọc `FeedComposer.tsx:135,282,288-295,310,354` · `CommentComposer.tsx:81,126-133,141` | `busy` chỉ khoá nút gửi + `PollComposerFields`/`KudosComposerFields`; textarea KHÔNG khoá ⇒ khay mới KHÔNG tự khoá nếu không truyền `disabled` |
| M23 | React 19 + `fireEvent` trên phần tử `disabled` | probe P9 (`review1`) | `fireEvent.change` trên `<input type=file disabled>` ⇒ **`onChange` CHẠY 1 lần**; `fireEvent.click` trên `<button disabled>` ⇒ 0 lần ⇒ thuộc tính `disabled` chặn người dùng thật (nút mở hộp chọn bị khoá) nhưng KHÔNG chặn đường jsdom ⇒ handler phải TỰ kiểm `disabled` thì ca hành vi mới cắn |
| M24 | Lệnh `return` sớm vs hook | đọc `FeedComposer.tsx:96-131` · `CommentComposer.tsx:65-78` | hook cuối ở `:120-124` rồi `return null` `:131`; `CommentComposer` hook `:65-69` rồi `return` `:71-78` ⇒ hook tải phải gọi TRƯỚC. Khi `locked` lật, component VẪN mount (chỉ đổi JSX) ⇒ tải tiếp NGẦM nếu không xử lý (D10) |
| M25 | Thông điệp vitest (để mutant khai đúng chữ) | probe P8 (`review1`) + P8b (`msg2`) | `expected "spy" to not be called at all, but actually been called 1 times` · `promise resolved "{ fileId: 'f1' }" instead of rejecting` · `promise rejected "Error: chưa thi công" instead of resolving` · `expected Error: … to be Error: … // Object.is equality` · `expected [Function] to throw error matching /HTTP 403/ but got 'chưa thi công'` · `expected undefined to deeply equal [ { a: 1 } ]` · `expected [ 1, 2, 3 ] to have a length of 2 but got 3` · `expected "spy" to be called 2 times, but got 1 times` · `expected false to be true // Object.is equality` · jest-dom: `expect(element).toBeDisabled()` |
| M26 | Biên Unicode của nhãn | probe P6a/P6b (`review1`) | U+0309 ∉ `[\p{L}\p{N}_]`, ∈ `\p{M}`; thân **NFD toàn phần** + nhãn NFC ⇒ `indexOf` = **-1** (không link — an toàn nhưng mất link); dạng **TRỘN** (dựng sẵn tới `A` + U+0309 rời — kiểu gõ «Unicode tổ hợp») ⇒ `indexOf` = **0**, ký tự kế U+0309 LỌT lớp biên `[\p{L}\p{N}_]` ⇒ nhãn `Nguyễn Văn A` link lên thân hiển thị `@Nguyễn Văn Ả` (NGƯỜI KHÁC); lớp `[\p{L}\p{M}\p{N}_]` ⇒ chặn; NFC của dạng trộn = NFC của `@Nguyễn Văn Ả` |
| M27 | Tokenizer hiện tại với NFD + ngữ cảnh trái | probe P6c/P6d (`review1`) | thân NFD `Chào @Nguyễn Văn An` ⇒ `[text 6cp, mention 6cp, text 11cp]` — span `@Nguye` cắt GIỮA chữ (dấu rời sang text; lỗi CÓ SẴN của nhánh span); `#tag@An` ⇒ `[tag, mention "@An"]` còn `tag@An` ⇒ `[text]` — lookbehind chạy trên `rest` |
| M28 | BE có chuẩn hoá thẻ không | đọc `social-mentions.ts:37,55-56`; grep `\.normalize(` trong `apps/api/src/social` + `routes/social` (bỏ spec) | thẻ BE = `HASHTAG_RE` trên body THÔ + `toLowerCase()`, **0** lệnh `normalize` ⇒ FE KHÔNG được NFC cả luồng token (thẻ NFD sẽ thành link lọc NFC ≠ thẻ BE lưu). Chỉ PHÉP SO nhãn mới chuẩn hoá (B1) |
| M29 | `setQueryData` vs `isInvalidated` | probe P7a/P7b (`review1`) | invalidate RỒI `setQueryData` ⇒ `isInvalidated:false`; `setQueryData` RỒI invalidate ⇒ `true`; `mentions` MẤT ở cả hai ⇒ thông điệp mK phụ thuộc thứ tự assert (K1 ghim `mentions` TRƯỚC) |
| M30 | Đo lại M5 trên PR #559 | `git grep -nE "(setQueryData\|setQueriesData)[^;]*posts\.\|initialData"` trên `feat/s16-social-feblockseed-1` @ `d88f7270` và `master`, `apps/app/src` + `packages/web-core/src`, bỏ spec | master: 0 dòng; #559: chỉ `initialData: seed` của `polls.results` (`PollBlock.tsx:86` nhánh) — **0 ghi `socialKeys.posts.*`**. WS bỏ `mentions` (contracts `realtime.ts:350-377`) ⇒ tiền đề D3(a) đứng trên head #559 hiện tại; **PHẢI đo lại sau rebase** (§8 bước 0) |
| M31 | Chuỗi phụ thuộc BE (điều kiện merge) | `git log --oneline master -- social-files.controller.ts social-files.service.ts social-access.service.ts`; `git log -S withheld` / `-S droppedMentions` contracts; `git show --stat a1dbe7f0` | 054/055 = **#538** `188d6404`; cổng gắn 004/016 = #539 `87e04955` + #541 `0f3103ec`; `mentions[]`/`withheld` = **#545** `7bfb3f96`; `droppedMentions` có từ #530; mã SOCIAL lên `error.code` = **#554** `a1dbe7f0` — commit ghi RED cũ «expected 'RESOURCE-ERR-…' to be 'SOCIAL-ERR-…'» ⇒ API < #554 thì `attachDenied`/`attachmentRejected` rơi về chung. **Commit API PROD: KHÔNG đo** (luật không chạm PROD) — lệnh cho owner: `GET /api/v1/health` → `data.build.commit` (`apps/api/src/health/build-info.ts`) rồi `git merge-base --is-ancestor <sha-PR> <commit>` |
| M32 | Tải về đính kèm phục vụ thế nào | đọc `object-storage.service.ts:199-206`; `social-api.ts:136-142`; `setting-defaults.ts:69-97`; `mime-extension.ts` (`isExtensionConsistentWithMime`) | `GetObjectCommand({Bucket,Key})` KHÔNG `ResponseContentDisposition` ⇒ inline theo Content-Type đã khai; `feedAttachmentSchema.url = z.string().nullable()` — không kiểm lược đồ; blocklist mặc định có `html`·`svg` nhưng tệp KHÔNG đuôi được thả lỏng (`extension===null ⇒ true`) ⇒ an toàn hôm nay dựa vào allowlist mặc định (M14) + storage KHÁC origin app (giả định — không đo được, env PROD). ⚠️ **Sửa ở FULL gate lượt 2 (M36):** vế «an toàn nhờ allowlist» SAI — kiểu PHỤC VỤ là Content-Type LƯU lúc PUT, mà PUT không ký kiểu ⇒ tệp khai `application/pdf` (qua allowlist) vẫn lưu được `text/html`; allowlist chỉ chặn MIME KHAI |
| M33 | Lưới ảnh hiện tại với URL không http(s) | probe P11 (`scheme`) | `buildImageGrid` giữ cả `javascript:alert(1)` lẫn `data:image/svg+xml,…` (`shown.length=2`); React 19 vẽ `src` NGUYÊN VĂN ⇒ R5 đỏ trên code cũ |
| M34 | `.csv` trên Windows | **KHÔNG đo** (phụ thuộc trình duyệt/registry — lời reviewer) | code: allowlist chỉ `text/csv` (`setting-defaults.ts:49`), `MIME_TO_EXTENSIONS` không có `application/vnd.ms-excel` (`mime-extension.ts:18-27`) ⇒ NẾU trình duyệt báo MIME đó thì 054 ⇒ 415 MIME ⇒ `unsupportedType`. Ghi nợ G9, không chặn |
| M35 | `<video onError>` trong jsdom | probe P10 (`review1`) | `fireEvent.error(video)` ⇒ `onError` 1 lần ⇒ ca R2b dựng được |
| M36 | (FULL gate lượt 2) Header nào được KÝ trong URL presign; confirm có so kiểu không | probe `presign-headers.probe.cjs` (scratchpad — ký URL bằng đúng SDK của worktree, `@aws-sdk/s3-request-presigner` 3.1068.0, KHÔNG mạng); đọc `dist-cjs/index.js:49` · `files.service.ts:276-294` · `object-storage.service.ts:138,199-206,217-225` | PUT như `createUploadUrl` ⇒ `X-Amz-SignedHeaders=content-length;host` (`prepareRequest` gọi `unsignableHeaders.add("content-type")`); thêm `signableHeaders: new Set(['content-type'])` ⇒ `content-length;content-type;host`. GET như `createDownloadUrl` ⇒ 0 tham số `response-*`; thêm `ResponseContentType`/`ResponseContentDisposition` ⇒ có trong query đã ký. Confirm chỉ kiểm tồn tại · cỡ · checksum; `statObject` bỏ `ContentType`. Docblock `:138` («pins content-type») SAI. Phía storage (kiểu lưu = header của PUT) là ngữ nghĩa S3 chuẩn — KHÔNG đo (không chạm storage; owner kiểm trên bucket lane/dev, §12) |

## 3. Bất biến phải giữ

- **company_id / RLS**: FE không gửi `companyId`; tenant do server lấy từ token (`social-files.service.ts:110-121`).
- **Ẩn ở CLIENT — server CHƯA che metadata** (sửa lời ở FULL gate lượt 1, §11): đính kèm `url:null` (presign bị từ chối)
  ⇒ **KHÔNG vẽ gì** cho tệp đó (ảnh · video · tệp) — một ô «có tệp mà bạn không xem được» là rò sự tồn tại (luật
  `buildImageGrid`, `feed-format.ts:55-62`), mở rộng cho cả video/tệp. ⚠️ Bản v2 ghi «Masking ở SERVER» là SAI: server vẫn
  trả `fileId`/`kind`/`fileName`/`sizeBytes` của phần tử `url:null` (`social-attachments.service.ts:541-550`) và payload
  WS phát metadata đính kèm cho cả công ty (`social-posts.service.ts:848`, `social-comments.service.ts:544`) ⇒ lọc của FE
  là lưới DUY NHẤT hôm nay; che ở server = nợ BE `S16-SOCIAL-ATTMETAMASK-1`.
- **Mention chỉ link khi server nói `withheld:false`**; đích link lấy từ `employeeId` của SERVER, chữ hiển thị là chữ NGUYÊN
  VĂN trong `body` (không chuẩn hoá chuỗi hiển thị, M28). `withheld:true` ⇒ SPAN, không tra theo tên ở FE (oracle `ERR-009`).
- **WS = DTO**: FE không đọc thân bài từ payload WS (`use-feed-realtime` chỉ đếm) — không đổi.
- **Permission fail-closed**: nút đính kèm sống TRONG ô soạn đã gác `create:feed-post` / `create:feed-comment` (ẩn hẳn khi
  thiếu); 403 của 054 đọc theo `error.code`, không theo câu chữ.
- **Không mất dữ liệu người dùng** (hợp đồng H2 FE-1): ô soạn chỉ dọn chữ + tệp khi Promise RESOLVE; REJECT giữ nguyên.
  **Bổ sung v2:** (i) khay **KHOÁ** (thêm · gỡ · thử lại) suốt `busy`, và handler `onChange` TỰ kiểm `disabled` (M23) —
  không có tệp nào vào khay giữa lượt gửi; (ii) resolve ⇒ `clear(ids)` CHỈ gỡ đúng các id đã vào DTO, không `reset()` mù
  — lưới thứ hai nếu sau này ai mở khoá khay.
- **Không XSS**: không `dangerouslySetInnerHTML`; link tệp `target=_blank rel="noopener noreferrer"`; URL tệp chỉ từ server
  **VÀ** phải khớp `^https?://` (không phân biệt hoa thường — cùng tư thế `URL_RE`, `parse-feed-body.ts:52`) — lệch ⇒ coi
  như `url:null` (không vẽ). **Tải về KHÔNG an toàn với cấu hình mặc định (sửa ở FULL gate lượt 2, §12 H1 — v2 và lượt 1
  ghi SAI):** v2 giả định (a) allowlist MIME không có `text/html`/`image/svg+xml` là đủ — SAI: storage phục vụ theo
  Content-Type LƯU lúc PUT, mà PUT ký sẵn KHÔNG ký `Content-Type` (M36) ⇒ tệp khai `application/pdf` (qua allowlist) vẫn lưu
  được `text/html`, bấm link tệp ⇒ HTML chạy trên origin storage; (b) storage ở origin KHÁC app chỉ hạ mức (không chiếm
  phiên), không chặn. FE không ép được kiểu storage phục vụ ⇒ vá ở BE `S16-SOCIAL-FILEDISPOSITION-1` (ký `Content-Type` PUT ·
  confirm so kiểu · `ResponseContentType` + `Content-Disposition: attachment` ở GET; seed lượt 1, mở rộng lượt 2) — **điều
  kiện MERGE của lát A** (D11 bổ sung) và phải lên PROD trước khi storage mở cho trình duyệt.
- **Không rò storage credential**: PUT lên storage qua `putBytesToStorage` (`credentials:'omit'`), không qua `apiFetch`.
- **Không tải ngầm khi ô soạn không dùng được** (v2, D10): `locked`/mất quyền lật ⇒ huỷ lượt tải đang bay + dọn khay.

## 4. Thiết kế

### Lát A — đính kèm

- **A1 · web-core `storage-upload.ts`**: `putBytesToStorage(url, file, contentType, signal?)` — tham số CUỐI tuỳ chọn,
  truyền vào `fetch`; abort ⇒ ném `Error` riêng (không nuốt). 4 call-site cũ không đổi.
- **A2 · web-core `social-files-api.ts` (MỚI)**: `socialFilesApi.requestUploadUrl(input)` → `POST /social/files/upload-url`
  parse `registerFileResponseSchema`; `.confirm(fileId, target)` → `POST /social/files/${id}/confirm` body `{target}` parse
  `confirmUploadResponseSchema`; `uploadSocialAttachment(file, target, {signal})` = 3 pha (khuôn `uploadChatAttachment`):
  `declaredMimeType = file.type || DEFAULT_UPLOAD_MIME` → register → PUT (cùng `Content-Type`) → confirm → trả
  `{fileId, kind, name, sizeBytes, mimeType}`. Pha nào lỗi ⇒ NÉM **nguyên lỗi** (không bọc lại — `ApiError.code` phải tới
  được `attachmentUploadErrorReason`), không confirm/không trả `fileId`; KHÔNG `try/catch` quanh PUT. `signal` đi vào cả
  3 pha. Export ở `index.ts` (khối additive cạnh `socialKudosApi`).
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
  retry(id), clear(ids), reset(), submitState, rejections}`:
  - tải TUẦN TỰ (khuôn chat) qua hàng đợi; mỗi item một `AbortController`; **`remove(id)` trên item CÒN XẾP HÀNG (chưa
    bắt đầu) ⇒ gỡ khỏi hàng đợi, KHÔNG bao giờ khởi động nó** (vòng tải đọc lại tập item sống trước mỗi lượt — ca U2);
    `remove` item đang tải ⇒ abort + thu hồi preview.
  - **`clear(ids)`** = gỡ ĐÚNG các id truyền vào (abort nếu lỡ còn bay + thu hồi preview), item khác GIỮ NGUYÊN — đường dọn
    sau resolve (§3 H2-ii); `reset()` = abort hết + `revokeAll` + rỗng — CHỈ cho unmount và gate lật (D10).
  - unmount ⇒ abort hết + `revokeAll` (dùng lại `@/components/chat/composer/use-attachment-previews` — chỉ IMPORT);
    `isMountedRef` chặn `setState` sau unmount. `reset`/`clear` ổn định (`useCallback`) để làm deps của effect.
- **A5 · `components/ComposerAttachmentTray.tsx` (MỚI)**: prop **`disabled`**; input `type=file multiple` ẩn + nút «Đính
  kèm» (icon `Paperclip`, `aria-label`), `accept` = gợi ý theo D2; khay ô: ảnh ⇒ `<img src=blob:>`, khác ⇒ chip tên + dung
  lượng; trạng thái «Đang tải…» / lỗi (chữ theo reason) + «Thử lại» / nút gỡ. `disabled` ⇒ nút đính kèm · input · gỡ ·
  thử lại đều `disabled`, **và `onChange` trả về sớm khi `disabled`** (M23 — `fireEvent.change` vẫn tới handler). Một alert
  `composer-attach-error` cho các tệp bị từ chối trước khi tải (tên + lý do, `{{max}}` = 20 MB / 10 / 1 / 11).
- **A6 · `FeedComposer`**: gọi `useAttachmentUploads({target:"post"})` **ngay sau `useState(sending)` (`:108`), TRƯỚC
  `return null` (`:131`)** (M24); effect gate-lật `useEffect(() => { if (!canCreatePost) uploads.reset(); }, [canCreatePost,
  uploads.reset])` cũng đặt trước `:131` (D10). Mount khay cho MỌI loại bài (D5) + **`disabled={busy}`** (khuôn
  `:282,310`); `canSubmit &&= submitState.ready`; dòng lý do khi `uploading`/`hasErrors`; `buildDto` thêm `attachmentIds`
  CHỈ khi khác rỗng (vắng khoá ⇒ payload + khoá idempotency của bài không tệp y như hôm nay); `submit` CHỤP `ids` vào
  biến cục bộ cùng lúc dựng DTO; resolve ⇒ `uploads.clear(ids)`; reject ⇒ giữ. Sửa docblock `:19-20`.
- **A7 · `CommentComposer`**: như A6 với `target:"comment"`; hook + effect `useEffect(() => { if (locked || !canComment)
  uploads.reset(); }, [locked, canComment, uploads.reset])` đặt **sau `useState(sending)` (`:69`), TRƯỚC `if (locked)`
  (`:71`)**; body vẫn bắt buộc (M11); `body` GIỮ khi `locked` lật (hành vi hôm nay, không đổi). Sửa docblock `:7-8`.
- **A8 · `components/PostAttachments.tsx` (MỚI)** + `feed-format.ts` `splitAttachments(atts)` ⇒ `{grid, videos, files}` —
  CẢ BA lọc `url !== null` **VÀ `isSafeAttachmentUrl(url)` (`/^https?:\/\//i`)** (§3); `buildImageGrid` nhận cùng vị từ
  (một hàm, không nhân bản). Lưới ảnh giữ `buildImageGrid`; ảnh `onError` ⇒ thay bằng ô trung tính
  `attachment-image-unavailable` (không icon vỡ — TTL 300 s); video ⇒ `<video controls preload="metadata" onError>` —
  `onError` ⇒ ô trung tính `attachment-video-unavailable` (M35; phủ cả hết hạn lúc phát/tua — vị trí phát mất, chấp nhận,
  gốc ở G6); tệp ⇒ `<a href target=_blank rel="noopener noreferrer">` tên + dung lượng. Biến thể `compact` cho bình luận.
  `PostCard` thay khối `:159-180` bằng `<PostAttachments>`; `CommentRow` + `NewsPage` row thêm `<PostAttachments compact>`.
- **A9 · lỗi gửi**: `ACTION_ERROR_REASONS` + `attachmentRejected` (`SOCIAL-ERR-007` — một câu cho cả LIMIT lẫn INVALID,
  M9) · `attachDenied`. `use-create-post.ts` onError: `kudosErrorReason ?? attachmentErrorReason ?? group…`;
  `PostDetailPage` `LocalActionError` thêm `reason` (khuôn `CreatePostError`) cho `createComment`.
- **A10 · i18n** file mới `i18n/locales/vi/social-attachments.ts` mount `attachment` trong `social.ts` (khuôn kudos);
  reason vào `actionError.reason.*`.

### Lát B — mention + `droppedMentions` + cache `006`

- **B1 · `parse-feed-body.ts`**: `parseFeedBody(body, mentions?)`; token mới `{kind:"mentionLink", value, employeeId}`.
  - Bảng nhãn = phần tử `withheld === false` (đọc qua narrowing, không đọc `label` ở nhánh rút), nhãn chuẩn hoá
    `label.normalize("NFC")`; nhãn (NFC) trùng mà `employeeId` KHÁC ⇒ loại (mơ hồ ⇒ span). Bảng rỗng ⇒ đường code y hệt
    hôm nay (P7).
  - **Lớp ký tự chữ** `WORD = /[\p{L}\p{M}\p{N}_]/u` (thêm `\p{M}` — M26) dùng cho CẢ HAI biên.
  - **Dò trên CHUỖI GỐC với offset TUYỆT ĐỐI** (vòng lặp giữ `base` = vị trí đầu `rest` trong `body`): ứng viên tại mỗi
    `@` ở offset `i ≥ base` có **biên trái** `i === 0 || !WORD.test(body[i-1])` — đọc `body`, KHÔNG đọc `rest` (M27).
  - **So nhãn không phụ thuộc dạng chuẩn, KHÔNG chuẩn hoá chuỗi hiển thị** (M28: thẻ BE không NFC): với nhãn `L` (NFC, dài
    trước), tìm `j` trong `[i+1+|L|, i+1+3·|L|]` sao cho `body.slice(i+1, j).normalize("NFC") === L` **và biên phải**
    `j === body.length || !WORD.test(body[j])`. Vì `WORD` có `\p{M}`, `j` cắt giữa một chuỗi kết hợp sẽ trượt biên ⇒ dạng
    trộn (M26) không link. Token `value = body.slice(i, j)` — NGUYÊN VĂN (NFD vẫn hiển thị NFD).
  - Cùng vị trí ⇒ nhãn DÀI hơn thắng, `mentionLink` thắng `mention`. Không regex dựng từ nhãn (nhãn có `(`,`.`). Kích thước:
    thân ≤ 4000, nhãn ≤ vài chục ⇒ O(n·k·|L|) không đáng kể.
  - Nhánh span (`MENTION_RE`) GIỮ NGUYÊN — lỗi NFD/ngữ cảnh trái của span là nợ FE (§7), không sửa để P7 giữ nghiêm.
  - Viết lại docblock `:12-23`, `:57-66`.
- **B2 · `PostBody`** prop `mentions?: readonly FeedMentionDto[]`; `mentionLink` ⇒ `<Link to="/feed/profiles/$employeeId">`;
  `mention` vẫn span. `PostCard.tsx:136` · `CommentList.tsx:78` · `NewsPage.tsx:272` truyền `x.mentions`.
- **B3 · `droppedMentions` bình luận**: tách `components/DroppedMentionsNotice.tsx` từ `CreatePostNotices.tsx:33-53`
  (giữ `data-testid="dropped-mentions-notice"` cho bài); `PostDetailPage` giữ `droppedCount` từ `createComment.onSuccess`,
  dọn ở `onMutate`, vẽ notice testid `comment-dropped-mentions-notice` cạnh ô soạn.
- **B4 · cache `006` (D3)**: KHÔNG thêm merge — giữ invalidate-only (M3/M5/M30). Ghim bằng ca K1 + docblock cảnh báo tại
  `moderateMutation` («`006` không mang `mentions`/`kudos`/`poll`/`idea` — muốn cập nhật cache tức thì thì PHẢI merge giữ khoá vắng, M2»).

## 5. Test RED trước (deny-path trước, mỗi ca DENY đứng cạnh ca ALLOW)

> Spec mới đặt trong glob được nạp: `apps/app/src/**/*.spec.{ts,tsx}` · `packages/web-core/src/**/*.spec.{ts,tsx}`.
> **v2 — STUB TRƯỚC, không đỏ bằng lỗi nạp:** trước khi viết W/C/U, tạo khung module trong cây làm việc (KHÔNG commit
> riêng): `social-files-api.ts` — `uploadSocialAttachment`/`requestUploadUrl`/`confirm` đều `throw new Error("chưa thi
> công")`; `attachment-draft.ts` — `planAttachmentAdds ⇒ {accepted:[], rejected:[]}`, `attachmentSubmitState ⇒ {ready:true,
> ids:[]}`, `attachmentKindOf ⇒ "file"`, `attachmentUploadErrorReason ⇒ "uploadFailed"`; `use-attachment-uploads.ts` — hook
> trả item rỗng, mọi hàm no-op. ⇒ mọi ca W/C/U đỏ trên **ASSERT** với thông điệp ghi dưới (M25). Ca nào vẫn chỉ đỏ được
> bằng lỗi nạp thì ghi rõ trong sổ thi công (đọc dòng `Test Files … failed` + 0 `Tests`).
> **Thứ tự assert trong ca điều phối tải:** W2/W3/W5 dùng `const settled = await p.then(() => "resolved", (e) => e)` ⇒
> assert SPY trước (`fetch`/confirm), assert LỖI sau (`expect(settled).toBe(err)` hoặc `expect(() => { throw settled;
> }).toThrow(/…/)`) — để mutant «đi tiếp sau lỗi» đỏ ở đúng spy, không ở dòng lỗi. W5 assert `fetch` nhận đúng `signal`
> TRƯỚC khi abort. W4 dùng thẳng `await expect(p).rejects.toBe(confirmErr)`. W1 assert confirm `toHaveBeenCalledTimes(1)`
> trước `resolves.toEqual`.

### Ca test lát A

| # | Ca | Đỏ trên code hiện tại (sau STUB) vì |
| --- | --- | --- |
| W2 | **DENY** `uploadSocialAttachment` — register ném `ApiError(415,"FOUNDATION-FILE-ERR-MIME")` ⇒ `fetch` 0 lần, confirm 0 lần, lỗi ngã ngũ LÀ (`toBe`) đúng `ApiError` đó | `expected Error: chưa thi công to be … // Object.is equality` |
| W3 | **DENY** PUT trả 403 ⇒ confirm 0 lần; lỗi khớp `/HTTP 403/` | `expected [Function] to throw error matching /HTTP 403/ but got 'chưa thi công'` (spy confirm 0 lần xanh-giả trên stub ⇒ giá trị ở mA9) |
| W4 | **DENY** confirm ném ⇒ promise REJECT (không trả `fileId`), lỗi `toBe` lỗi confirm | `expected Error: chưa thi công to be … // Object.is equality` (giá trị ở mA10) |
| W5 | **DENY** `signal` abort giữa PUT ⇒ reject, confirm 0 lần; `fetch` nhận đúng `signal` | `… but got 'chưa thi công'` (assert lỗi abort) |
| W1 | ALLOW: thứ tự gọi `054` body `{target:"post",originalName,declaredMimeType:"image/png",sizeBytes}` → PUT `Content-Type:image/png` + `credentials:"omit"` → `055` body `{target:"post"}`; chạy schema đã truyền trên payload hình BE; `resolves.toEqual({fileId,…})` | `promise rejected "Error: chưa thi công" instead of resolving` |
| W6 | `file.type===""` ⇒ khai + PUT `application/octet-stream` | `promise rejected "Error: chưa thi công" instead of resolving` |
| S1 | `putBytesToStorage(…, signal)` chuyển `signal` vào `fetch` | `expected undefined to be <signal>` |
| C1 | `planAttachmentAdds`: 11 ảnh ⇒ 10 nhận + `tooManyImages`; video thứ 2 ⇒ `tooManyVideos`; `20MB+1` ⇒ `tooLarge`, đúng `20MB` ⇒ nhận; 10 ảnh+1 video+1 pdf ⇒ pdf `tooManyFiles`; item `error` không tính; `IMAGE/PNG` ⇒ image | `expected [] to have a length of 10 but got 0` |
| C2 | `attachmentSubmitState`: có `uploading` ⇒ not ready; có `error` ⇒ `hasErrors`; ids theo thứ tự chọn | `expected true to be false // Object.is equality` |
| U1 | hook `clear(ids)`: A xong, chụp `[A]`, thêm B (đang tải) ⇒ `clear([A])` ⇒ `items` = `[B]`, `signal` của B `aborted === false` | `expected [] to have a length of 1 but got 0` (stub item rỗng) |
| U2 | **DENY** hook xoá item XẾP HÀNG: thêm A (tải treo bằng deferred) + B; `remove(B)`; resolve A ⇒ spy tải đúng **1** lần, `items` = `[A done]` | `expected "spy" to be called 1 times, but got 0 times` |
| F1 | **DENY** FeedComposer chọn tệp `20MB+1` ⇒ spy `uploadSocialAttachment` 0 lần + alert lý do `tooLarge` | `Unable to find … [data-testid="composer-attach-input"]` |
| F2 | 11 ảnh ⇒ spy đúng 10 lần (target `"post"`) + 1 dòng từ chối | như F1 |
| F3 | **DENY** upload ném `ApiError(403,"SOCIAL-ERR-FILE-TARGET-POST-DENIED")` ⇒ ô lỗi chữ `attachDenied`, nút Đăng KHOÁ; gỡ ô ⇒ mở; `415 MIME` ⇒ `unsupportedType` | như F1 |
| F4 | đang tải ⇒ nút Đăng khoá; xong ⇒ payload `attachmentIds:[f1,f2]` đúng thứ tự; KHÔNG tệp ⇒ `"attachmentIds" in dto === false` | như F1 |
| F5 | `onSubmit` reject ⇒ khay giữ; resolve ⇒ khay rỗng + `URL.revokeObjectURL` gọi đúng blob URL (stub `createObjectURL` — M16) | như F1 |
| F6 | unmount khi đang tải ⇒ `signal.aborted === true` | như F1 |
| F7 | composer NHÓM (`groupId`) có nút đính kèm, target `"post"` | như F1 |
| **F8** | **DENY (§10 #1)** 1 tệp xong; `onSubmit` trả deferred CHƯA resolve; bấm Đăng ⇒ `composer-attach-button` + `composer-attach-input` **`toBeDisabled()`**; `fireEvent.change(input, 1 tệp mới)` ⇒ spy tải **KHÔNG** gọi thêm (M23); resolve ⇒ khay rỗng | như F1 |
| K1c | CommentComposer: target `"comment"`; có tệp mà body rỗng ⇒ nút KHOÁ (M11); payload `attachmentIds` | `Unable to find … [data-testid="comment-attach-input"]` |
| **K2c** | **DENY (§10 #1)** như F8 trên CommentComposer (`comment-attach-*`) | như K1c |
| **K3c** | **DENY (§10 #8, D10)** CommentComposer tải treo; `rerender` với `locked` ⇒ `signal.aborted === true`; `rerender` mở khoá ⇒ 0 `comment-attach-item`; `body` cũ còn trong textarea | như K1c |
| E1 | `use-create-post`: `ApiError(422,"SOCIAL-ERR-007")` ở bảng tin ⇒ `reason:"attachmentRejected"` (cạnh ca ERR-012 bảng tin vẫn `null`) | `expected null to be 'attachmentRejected'` |
| E2 | `PostDetailPage`: `createComment` ném `ApiError(422,"SOCIAL-ERR-007")` ⇒ banner `data-reason="attachmentRejected"` | `expected null to be 'attachmentRejected'` (`getAttribute`) |
| R1 | `PostAttachments`/PostCard: `[ảnh url, ảnh null, video url, video null, tệp url, tệp null]` ⇒ 1 `img` · 1 `video` (src đúng) · 1 `a[href=url]` tên tệp, `rel` đủ, `target=_blank` · tên tệp `null` KHÔNG xuất hiện ở đâu | `expected 0 to be 1` (`querySelectorAll("video")`) |
| R2 | `fireEvent.error(img)` ⇒ không còn `img`, có `attachment-image-unavailable` | `Unable to find … attachment-image-unavailable` |
| **R2b** | **(§10 #6)** `fireEvent.error(video)` ⇒ không còn `video`, có `attachment-video-unavailable` (M35) | `Unable to find … attachment-video-unavailable` |
| R3 | CommentList: bình luận có ảnh ⇒ `comment-attachments` chứa `img` | `Unable to find … comment-attachments` |
| R4 | NewsPage: tin có ảnh ⇒ `img` trong `news-row` | `expected null not to be null` |
| **R5** | **DENY (§10 #5)** PostCard: `[ảnh "javascript:alert(1)", tệp "data:text/html,x", video "//evil/x.mp4", ảnh "HTTPS://ok/a.png"]` ⇒ đúng 1 `img` (src `HTTPS://ok/a.png`), 0 `a` tệp, 0 `video`, tên tệp `data:` không xuất hiện | `expected 2 to be 1` (`img` — M33: lưới hiện tại giữ cả `javascript:`) |
| I1 | `ActionErrorBanner.spec` (lặp tập reason) với 2 reason mới — chữ ≠ khoá thô | xanh tự động sau A9/A10 (đỏ nếu quên i18n) |

### Ca test lát B

| # | Ca | Đỏ trên code hiện tại vì |
| --- | --- | --- |
| P2 | **DENY** chỉ `{withheld:true}` ⇒ KHÔNG `mentionLink`; phần tử bị nhét lậu `{withheld:true, employeeId, label}` (cast) ⇒ vẫn không link | xanh-giả trên code cũ (không có link nào) ⇒ chỉ có giá trị cạnh P1 + mutant mB1 |
| P3 | **DENY** 2 phần tử `withheld:false` cùng nhãn, KHÁC `employeeId` ⇒ span | như P2 |
| P4 | **DENY** biên phải: `"@Nguyễn Văn Anh"` với nhãn `"Nguyễn Văn An"` ⇒ không link; `"x@Nguyễn Văn An"` ⇒ không link | như P2 |
| **PU1** | **DENY (§10 #4)** dạng TRỘN: nhãn `"Nguyễn Văn A"`, thân `"@Nguyễn Văn Ả ơi"` ⇒ KHÔNG `mentionLink` | như P2 (giá trị ở mB7) |
| **PU3** | **DENY (§10 #4)** ngữ cảnh trái: `"#tag@Nguyễn Văn An"` (nhãn khớp) ⇒ KHÔNG `mentionLink`; cạnh ALLOW `"#tag @Nguyễn Văn An"` ⇒ link | vế DENY xanh-giả (giá trị ở mB9); vế ALLOW: `toEqual` lệch |
| P1 | ALLOW: `parseFeedBody("Chào @Nguyễn Văn An!", [{withheld:false, employeeId:E1, label:"Nguyễn Văn An"}])` ⇒ `[text "Chào ", {mentionLink "@Nguyễn Văn An", E1}, text "!"]` | `toEqual` lệch: nhận `{kind:"mention", value:"@Nguyễn"}` (M6) |
| **PU2** | **ALLOW (§10 #4)** thân NFD `"Chào @Nguyễn Văn An!".normalize("NFD")`, nhãn NFC ⇒ `mentionLink` với `value` = chuỗi con NFD NGUYÊN VĂN (`value === body.slice(i,j)`), `employeeId` E1 | `toEqual` lệch: nhận `mention` `@Nguye` (M27) |
| P5 | nhãn `"An"` + `"An Nguyễn"`: `"@An Nguyễn và @An."` ⇒ link E(An Nguyễn) rồi link E(An), `"."` là text | `toEqual` lệch |
| P6 | nhãn có ký tự regex `"Lê (HR)"` ⇒ khớp nguyên văn | `toEqual` lệch |
| P7 | `mentions` vắng / `[]` ⇒ token y hệt bản cũ (13 ca C14 cũ giữ xanh, chạy lại nguyên file) | xanh (lưới hồi quy) |
| B1 | PostBody: có mentions ⇒ `a[href="/feed/profiles/E1"]` chữ `@Nguyễn Văn An`; `withheld` ⇒ span, 0 `a`. ⚠️ Mock `Link` hiện tại (`PostBody.spec.tsx:18-30`) BỎ `params` ⇒ href thành `/feed/profiles/$employeeId` với MỌI id — sửa mock cho NỘI SUY params (bài học H2 FE-2C) TRƯỚC khi viết ca, nếu không link sai người vẫn xanh | `Unable to find role link` |
| B2 | PostCard truyền `post.mentions` ⇒ link; bài KHÔNG khoá `mentions` (006/WS) ⇒ span | `Unable to find role link` |
| B3 | CommentList / NewsPage truyền `mentions` ⇒ link | `Unable to find role link` |
| D1 | PostDetailPage: `createComment` resolve `{…, droppedMentions:[a,b]}` ⇒ `comment-dropped-mentions-notice` chữ `count:2`; lượt gửi mới dọn; `[]` ⇒ vắng | `Unable to find … comment-dropped-mentions-notice` |
| D2 | `FeedPage.spec` M7 cũ (`dropped-mentions-notice` của bài) xanh sau khi tách component | xanh (hồi quy) |
| K1 | `use-feed-actions`: seed `posts.detail(p1)` có `mentions`; `moderatePost` resolve DTO hình `006` (không `mentions`) ⇒ sau `onSuccess`, **THỨ TỰ ASSERT GHIM**: (1) `getQueryData(detail).mentions` `toEqual` seed — TRƯỚC; (2) `getQueryState(detail).isInvalidated` `toBe(true)` — SAU (M29) | **xanh trên code hiện tại (ghim)** — giá trị nằm ở mutant mK |

**Mutant (sao lưu → cấy → khôi phục bằng bản sao, KHÔNG `git checkout --`; đỏ ĐÚNG ca, ĐÚNG thông điệp — M25):**

| # | Cấy | Đỏ ca · thông điệp |
| --- | --- | --- |
| mA1 | bỏ `planAttachmentAdds` trước khi tải | F1 · `expected "spy" to not be called at all, but actually been called 1 times` |
| mA2 | bỏ lọc `url!==null` cho video | R1 · `expected 2 to be 1` |
| mA3 | bỏ pha confirm | W1 · `expected "spy" to be called 1 times, but got 0 times` |
| mA4 | gửi `attachmentIds:[]` khi rỗng | F4 · `expected true to be false` (`"attachmentIds" in dto`) |
| mA5 | bỏ `submitState.ready` khỏi `canSubmit` | F4/F3 · `expect(element).toBeDisabled()` |
| mA6 | bỏ ánh xạ `007` | E1+E2 · `expected null to be 'attachmentRejected'` |
| mA7 | không nối `signal` | F6 · `expected false to be true // Object.is equality` · W5 · `expected undefined to be … // Object.is equality` (assert `signal` trước abort) |
| mA8 | bỏ `onError` ảnh | R2 · `Unable to find … attachment-image-unavailable` |
| **mA9** | `try { await putBytesToStorage(…) } catch { /* đi tiếp */ }` rồi confirm | W3 · `expected "spy" to not be called at all, but actually been called 1 times` (spy confirm) |
| **mA10** | `try { await confirm(…) } catch { return {fileId: reg.fileId, …} }` | W4 · `promise resolved "{ fileId: … }" instead of rejecting` (W4 dùng `rejects.toBe` — M25) |
| **mA11** | bọc cả 3 pha `try/catch` rồi `throw new Error("Tải tệp thất bại")` (xoá `ApiError.code`) | W2 · `expected Error: Tải tệp thất bại to be … // Object.is equality`; F3 · `Unable to find …` chữ `unsupportedType` |
| **mA12** | bỏ `disabled={busy}` khỏi khay (cả hai ô soạn) | F8/K2c · `expect(element).toBeDisabled()` |
| **mA13** | bỏ dòng `if (disabled) return` trong `onChange` (giữ thuộc tính) | F8/K2c · `expected "spy" to not be called at all, but actually been called 1 times` |
| **mA14** | resolve gọi `reset()` thay `clear(ids)` | U1 · `expected [] to have a length of 1 but got 0` |
| **mA15** | vòng tải không đọc lại tập item sống (khởi động item đã gỡ) | U2 · `expected "spy" to be called 1 times, but got 2 times` |
| **mA16** | bỏ effect gate-lật (A7) | K3c · `expected false to be true // Object.is equality` |
| **mA17** | bỏ `isSafeAttachmentUrl` | R5 · `expected 2 to be 1` |
| **mA18** | bỏ `onError` video | R2b · `Unable to find … attachment-video-unavailable` |
| mB1 | bỏ vế `withheld===false` (đọc `label` qua cast) | P2 · `toEqual` lệch (có `mentionLink`) |
| mB2 | bỏ biên phải | P4 · `toEqual` lệch |
| mB3 | bỏ loại nhãn mơ hồ | P3 · `toEqual` lệch |
| mB4 | nhãn NGẮN trước | P5 · `toEqual` lệch |
| mB5 | `PostCard` không truyền `mentions` | B2 · `Unable to find role link` |
| mB6 | bỏ notice bình luận | D1 · `Unable to find … comment-dropped-mentions-notice` |
| **mB7** | lớp biên bỏ `\p{M}` (về `[\p{L}\p{N}_]`) | PU1 · `toEqual` lệch (có `mentionLink`) |
| **mB8** | so `body.slice(i+1,j) === L` không `normalize("NFC")` | PU2 · `toEqual` lệch (không `mentionLink`) |
| **mB9** | biên trái đọc `rest[idx-1]` thay `body[i-1]` | PU3 vế DENY · `toEqual` lệch (có `mentionLink`) |
| mK | thêm `queryClient.setQueryData(socialKeys.posts.detail(post.id), post)` vào `moderateMutation.onSuccess` — **TRƯỚC hay SAU `invalidatePostLists` đều được** | K1 · `expected undefined to deeply equal [ { withheld: false, … } ]` — assert (1) chạy trước nên thông điệp KHÔNG phụ thuộc vị trí cấy; cấy SAU thì `isInvalidated` cũng lật `false` (M29) nhưng assert (2) không tới |

## 6. Quyết định owner

| # | Câu hỏi | Phương án | Khuyến nghị · lý do | Chặn? |
| --- | --- | --- | --- | --- |
| **D1** | Lát B «ngủ»: web KHÔNG sinh được mention (M7) ⇒ link + `droppedMentions` chỉ sáng khi có nguồn khác | (a) làm render-only như done_when + seed WO BE «danh bạ nhắc tên» · (b) hoãn lát B tới khi có ô chọn mention · (c) mở rộng WO dựng ô chọn (không làm được: không route SOCIAL nào trả `userId` cho bài công ty) | **(a)** — rẻ (~450 LOC gồm test), đúng done_when, tự sáng khi BE có danh bạ; seed **`S16-SOCIAL-MENTIONDIR-1`** (BE: 002/015 nhận `mentionedEmployeeIds` hoặc danh bạ nhắc tên kiểu 059 — quyết định oracle `ERR-009` là của WO đó) | **Có — chỉ lát B** |
| **D2** | Video: allowlist mặc định KHÔNG có `video/*` (M14) | (a) `accept` mời cả `video/*`, server 415 ⇒ «định dạng chưa hỗ trợ» · (b) `accept` = allowlist mặc định (không video), trần 1 video vẫn kiểm client · (c) dựng `accept` động từ `GET /foundation/settings/public?category=File` | **(b)** + seed WO cấu hình (thêm `video/mp4` vào allowlist + `MIME_TO_EXTENSIONS`, có migration seed). (c) đúng nhất nhưng thêm phụ thuộc FOUNDATION + map `Record<string,unknown>` không kiểu — ghi nợ. Cùng lớp: `.csv` báo `application/vnd.ms-excel` (M34, chưa đo) ⇒ nợ G9 | Không |
| **D3** | done_when «006 không mang mentions ⇒ giữ mảng cũ khi merge cache» — hôm nay KHÔNG có merge (M5, M30) | (a) giữ invalidate-only, ghim K1 + mutant mK · (b) thêm `mergeModeratedPost(old,fresh)` giữ `mentions/kudos/poll/idea` + `setQueryData` để UI đổi tức thì | **(a)** — vế done_when thoả bằng thiết kế, có lưới chống ai đó thêm `setQueryData` trần; (b) thêm một đường ghi cache cần chống cũ-đè-mới (memory TanStack) cho lợi ích vài trăm ms. **Mở lại D3 nếu đo lại M30 sau rebase thấy ghi `socialKeys.posts.*`** | Không |
| **D4** | Đính kèm `url:null` loại video/tệp | (a) ẩn hẳn như ảnh · (b) chip «không xem được» | **(a)** — (b) rò sự tồn tại (cùng lý do `buildImageGrid`) | Không |
| **D5** | Loại bài có nút đính kèm | (a) cả 5 loại (server nhận mọi loại — `social-posts.service.ts:300`) · (b) chỉ share/news/idea | **(a)** — một đường mã, không đặc cách | Không |
| **D6** | `SOCIAL-ERR-007` chung cho LIMIT và INVALID (M9) | (a) một câu gộp ở FE · (b) đọc `message` | **(a)** (cấm so câu chữ) + ghi nợ BE tách sentinel `ATTACHMENT_INVALID` | Không |
| **D7** | Va chạm PR #559 FEBLOCKSEED-1 (M20) | (a) thi công SAU khi #559 merge, rebase master · (b) làm song song, giải xung đột lúc PR | **(a)** — 4 file trùng, `PostCard.tsx` cả hai lát đều sửa; sau rebase đo lại M30 TRƯỚC khi viết K1 | Không (khuyến nghị thứ tự) |
| **D8** | Tiến độ tải | (a) «Đang tải…» không % (dùng `putBytesToStorage`) · (b) XHR có % (khuôn `employee-file-api`) | **(a)** — trần 20 MB, KISS; % ghi nợ | Không |
| **D9** | Tách PR | (a) 1 PR 2 commit (A rồi B) · (b) 2 PR — **B trước** (nhỏ, ít rủi ro) rồi A | **(b)** nếu D1=(a); nếu D1=(b) thì chỉ còn lát A | Không |
| **D10** (v2) | Ô soạn bình luận bị KHOÁ (`locked`) hoặc mất quyền (`!canComment`/`!canCreatePost`) khi đang có tệp tải dở/đã tải (M24) | (a) huỷ lượt tải đang bay + dọn khay (`reset()`), GIỮ `body` như hôm nay · (b) giữ khay ngầm, tải tiếp (mở khoá lại thì còn) · (c) tách ô soạn thành vỏ-gate + ruột-form (ruột unmount ⇒ mất cả `body`) | **(a)** — không tải ngầm cho thứ không gửi được; tệp `Uploaded` mồ côi là G5 sẵn có; (b) tốn băng thông vô hình; (c) đổi hành vi `body` hiện có | Không |
| **D11** (v2) | Điều kiện MERGE theo bản API PROD (FE auto-deploy, API deploy tay — M31) | (a) chỉ merge khi `data.build.commit` của PROD chứa: lát **A** ≥ **#554** `a1dbe7f0` (054/055 #538 + cổng #539/#541 + mã `error.code` #554), lát **B** ≥ **#545** `7bfb3f96` · (b) merge ngay, chấp nhận suy biến: API < #538 ⇒ MỌI tệp thành ô `uploadFailed` (404) sau một nút hiện rõ; #538–#553 ⇒ `attachDenied`/`attachmentRejected` rơi về chữ chung | **(a)** — khuôn FE-2C (`backlog.mjs:17840` «Điều kiện MERGE: PROD API ≥ #555»); chép vào `notes` của WO lúc mở PR | **Có — chặn MERGE** (không chặn thi công) |

## 7. Ngoài phạm vi / nợ (ghi vào PR; KHÔNG sửa BE trong WO này)

- **G1 (BE)** không có danh bạ nhắc tên: `mentionedUserIds` đòi `users.id` mà SOCIAL không phơi `userId` (M7) ⇒ D1.
- **G2 (BE/cấu hình)** allowlist thiếu `video/*` dù SPEC-16 SC-01 hứa video (M14) ⇒ D2.
- **G3 (BE)** `SOCIAL-ERR-007` gộp LIMIT + INVALID (M9) ⇒ D6.
- **G4 (BE)** đường SỬA `004`/`016` chỉ đếm trần trên tệp MỚI (`assertLinkableFilesTx(toAdd)`, `social-attachments.service.ts:445`)
  ⇒ 10 ảnh cũ + 1 ảnh mới = 11 ảnh lọt. FE chưa có UI sửa nên chưa chạm.
- **G5 (BE)** tệp `Pending`/`Uploaded` mồ côi khi người dùng gỡ/bỏ nháp/khoá bình luận (D10). Sửa lời ở FULL gate lượt 1
  (§11): `TEMP_FILE_CLEANUP` CÓ (S2-FND-JOBS-1 done) nhưng chỉ dọn `Pending` quá TTL + tệp tạm hết hạn
  (`temp-file-cleanup.repository.ts:115-133`); tệp `Uploaded` chưa bao giờ link KHÔNG ai dọn ⇒ `S16-SOCIAL-ORPHANUPLOAD-1`.
- **G6 (BE)** TTL ký GET 300 s ⇒ FE chỉ giảm nhẹ bằng ô trung tính cho ẢNH **và VIDEO** (A8); video hết hạn GIỮA lúc phát/tua
  (range request 403) ⇒ ô trung tính thay trình phát, mất vị trí phát — sửa gốc là TTL/refetch-on-error ở BE.
- **G7 (sản phẩm)** không có bài/bình luận CHỈ ảnh (M11).
- **G8 (BE, v2 — nâng ở FULL gate lượt 2)** byte phục vụ inline theo Content-Type LƯU lúc PUT; PUT không ký kiểu (M36),
  confirm không so kiểu, URL ký GET không `ResponseContentType`/`ResponseContentDisposition` (M32) ⇒ khai thác được với
  cấu hình MẶC ĐỊNH, không cần mở allowlist. Cần: ký `Content-Type` PUT + confirm so kiểu + `ResponseContentType` = MIME đã
  đăng ký + `attachment` (+ `nosniff` nếu storage hỗ trợ) cho loại KHÔNG phải ảnh/video + chặn MIME nội dung chủ động không
  phụ thuộc đuôi. WO đỏ riêng `S16-SOCIAL-FILEDISPOSITION-1` (seed lượt 1 §11, mở rộng lượt 2 §12) — **điều kiện MERGE của
  lát A**, và phải lên PROD TRƯỚC khi storage mở cho trình duyệt (chat có sẵn đường bấm); `S16-SOCIAL-VIDEOMIME-1` chờ WO đó.
- **G9 (UX, v2)** `.csv` có thể bị trình duyệt Windows báo `application/vnd.ms-excel` (M34, CHƯA đo) ⇒ 415 `unsupportedType`
  dù CSV nằm trong allowlist. Sửa ở BE (thêm alias MIME) hoặc FE ánh xạ theo đuôi — quyết định của WO sau, kèm phép đo thật.
- **FE**: UI sửa bài/bình luận kèm tệp (chưa có UI sửa — grep `updatePost` app = 0) · kéo-thả/dán tệp · lightbox ảnh ·
  % tiến độ (D8) · `accept` động (D2c) · avatar `src` thô (`S16-SOCIAL-AVATARPRESIGN-1`, không đụng) · **(v2)** textarea
  KHÔNG khoá khi `busy` (`FeedComposer.tsx:288-295`, `CommentComposer.tsx:126-133`) ⇒ chữ gõ thêm GIỮA lượt gửi bị
  `setBody("")` xoá khi resolve — lỗi H2 CÓ SẴN, cùng lớp §10 #1 nhưng ngoài phạm vi · **(v2)** nhánh span `MENTION_RE`
  cắt giữa chữ với thân NFD + mất ngữ cảnh trái (M27) — không sửa để P7 giữ nghiêm.

## 8. Thứ tự thi công + lệnh verify

0. (D7) chờ #559 merge → `git rebase master` trong worktree → **đo lại M30** (`git grep -nE
   "(setQueryData|setQueriesData)[^;]*posts\.|initialData" -- apps/app/src packages/web-core/src`, bỏ spec) TRƯỚC khi viết
   K1; thấy ghi `socialKeys.posts.*` (vd seed `posts.detail` từ dòng danh sách/WS thiếu `mentions`) ⇒ DỪNG, mở lại D3.
   Lane DB: `bash scripts/lane-db-setup.sh fe2d` (chỉ cho `--all`).
0b. (D11) **Điều kiện MERGE** — owner: `GET /api/v1/health` PROD → `data.build.commit` = `<c>`; trên master
   `git merge-base --is-ancestor 7bfb3f96 <c>` (lát B) và `git merge-base --is-ancestor a1dbe7f0 <c>` (lát A) phải exit 0.
   Chép thành dòng `notes` «Điều kiện MERGE: PROD API ≥ #545 (lát B) / ≥ #554 (lát A)» vào WO lúc mở PR.
   **Bổ sung FULL gate lượt 2 (lát A, §12 H1):** `git merge-base --is-ancestor <sha merge của S16-SOCIAL-FILEDISPOSITION-1>
   <c>` cũng phải exit 0.
1. **Lát B** (D9b): RED P1–P7 · PU1–PU3 · B1–B3 · D1 · K1 → B1–B4 → GREEN → mutant mB1–mB9 + mK.
2. **Lát A**: STUB (§5) → A1–A2 + spec web-core (RED W/S trên assert) → rebuild web-core → A3–A4 + spec C/U → A5–A7 + spec
   F/K1c–K3c → A8 + spec R/R2b/R5 → A9–A10 + spec E/I1 → mutant mA1–mA18.
3. Lệnh (mọi lệnh bắt đầu `cd "/c/dev 2/MediaOS-fe2d"`; đọc dòng `Test Files` + `Tests`):
   - `pnpm --filter @mediaos/web-core exec vitest run src/lib/social-files-api.spec.ts src/lib/storage-upload.spec.ts`
   - `pnpm --filter @mediaos/contracts build && pnpm --filter @mediaos/web-core build` (web-core `exports` trỏ `dist`)
   - `pnpm --filter @mediaos/app exec vitest run src/routes/social` — **TẤT CẢ spec module trong MỘT lượt** (ERR_IPC ⇒ `--no-file-parallelism`)
   - `pnpm --filter @mediaos/app test:social-cov` — đọc 4 số, sàn 80
   - `pnpm typecheck && pnpm lint` · `bash harness/check.sh --quick`
   - Gate lát B: `typescript-reviewer` + `react-reviewer` + `quality-gate`; gate lát A: như B **+ `security-reviewer`**
     (đầu vào tệp người dùng · PUT ra storage ngoài · bất biến `credentials:'omit'` · lược đồ URL)
   - Trước PR: `bash harness/check.sh --all --lane-db=fe2d` (FE-only, nhưng thiếu `LANE_DB` ⇒ «XANH KHÔNG ĐỦ BẰNG CHỨNG» exit 1)
4. Bẫy đã kiểm: withTenant lồng · timestamptz thô · RETURNING · resigned — **không áp** (FE-only, không chạm `apps/api`).
   **Áp**: `PermissionGuard` câu cố định (403 tầng-1 của 054 không mã SOCIAL ⇒ rơi về `uploadFailed`/forbidden chung) ·
   mã SOCIAL ở `error.code` (E1/E2/F3 — và chỉ trên API ≥ #554, D11) · spec đúng glob · chạy cả module một lượt ·
   `ActionErrorBanner.spec` là lưới ratchet reason (thêm, không nới) · RED do lỗi nạp ≠ RED do assert (STUB §5).

## 9. Rủi ro + kích thước

| # | Rủi ro | Xử lý |
| --- | --- | --- |
| R1 | Xung đột #559 (M20) | D7 — rebase sau merge; đo lại M30 |
| R2 | Lát B ngủ (M7) | D1 — nói rõ trong PR; seed MENTIONDIR-1 |
| R3 | Sửa chữ sau một lượt gửi mà server đã tạo bài (mất response) ⇒ khoá idempotency mới ⇒ tệp đã link ⇒ 422 `007` | câu `attachmentRejected` nói «tệp đã dùng / không hợp lệ»; ghi PR |
| R4 | `useCan` mù scope (M15) ⇒ vai @Department thấy nút rồi 403 ở 054 | reason `attachDenied` nói đúng lý do (API ≥ #554) |
| R5 | jsdom thiếu `createObjectURL` (M16), cảnh báo `act` với tải bất đồng bộ | stub trong spec; chờ trạng thái ô trước khi kết thúc ca |
| R6 | Trùng tên người: phần tử `withheld` vô danh + phần tử link cùng nhãn ⇒ có thể link nhầm người cùng tên | chấp nhận có ghi — không lộ thêm gì (người được link vốn hiện được); nhãn trùng giữa 2 phần tử link ⇒ span (P3). **FULL gate lượt 1:** cùng lớp với TIỀN TỐ — `@Nguyễn Văn An Bình` mà tên trọn là của phần tử rút (không nhãn) thì nhãn `Nguyễn Văn An` của người khác vẫn link nửa tên (probe R-B1): FE KHÔNG chặn được vì server không gửi nhãn cho phần tử rút (và không được gửi — oracle `ERR-009`) ⇒ chấp nhận có ghi. Tên trọn MƠ HỒ giữa hai phần tử link thì CHẶN được (R-B2 — ca P3b, §11) |
| R7 | Import chéo `@/components/chat/composer/use-attachment-previews` | chỉ import; TS bắt khi chat dời file |
| R8 | 20 MB trên mạng chậm, không timeout PUT | nút gỡ = abort (F6) |
| R9 (v2) | FE lên PROD trước API (M31) ⇒ nút đính kèm hiện mà 054 404, hoặc lý do lỗi rơi về chung | D11 — điều kiện merge theo `data.build.commit` |
| R10 (v2) | Thân gõ kiểu «Unicode tổ hợp» (NFD/trộn) | B1 so nhãn qua NFC + biên `\p{M}` (PU1/PU2); hiển thị nguyên văn |
| R11 (v2 · nâng lượt 2) | Tải về phục vụ theo kiểu do người tải lên chọn (PUT không ký `Content-Type` — M36) ⇒ XSS lưu trữ trên origin storage với cấu hình MẶC ĐỊNH | guard `^https?://` (R5) chỉ chặn lược đồ; chặn thật = BE `S16-SOCIAL-FILEDISPOSITION-1`, điều kiện MERGE lát A (§12 H1) |

**Kích thước ước lượng (v2):** Lát A ≈ 16 file (8 mới: `social-files-api.ts`+spec · `storage-upload.spec.ts` ·
`attachment-draft.ts`+spec · `use-attachment-uploads.ts`+spec (U1/U2) · `ComposerAttachmentTray.tsx` · `PostAttachments.tsx`+spec
· `social-attachments.ts` i18n), ~**+1.330/−45 LOC** (~770 test), **~47 ca**. Lát B ≈ 9 file (1 mới `DroppedMentionsNotice.tsx`),
~**+480/−30 LOC** (~300 test), **~25 ca**. Tổng ≈ 25 file · ~1.810 LOC · ~72 ca mới; `FeedComposer.tsx` 360→~435,
`CommentComposer.tsx` 149→~200, `PostDetailPage.tsx` 292→~330 (dưới trần 800).

## 10. plan-review lượt 1 — xử lý (verdict PASS · 3 MAJOR + 7 MINOR · cả 10 XÁC NHẬN, 0 bác)

| # | Mức · mục | Phát hiện (tóm) | Kiểm lại trên code | Xử lý trong v2 |
| --- | --- | --- | --- | --- |
| 1 | MAJOR · §4 A4–A7, §3 H2 | Khay đổi được giữa lượt gửi ⇒ `reset()` khi resolve nuốt tệp thêm sau, để lại `Pending` mồ côi | **Xác nhận.** `busy` chỉ vào nút + Poll/Kudos (`FeedComposer.tsx:135,282,310,354`), textarea không khoá (M22); v1 không có `disabled` cho khay. Đo thêm: `fireEvent.change` trên input `disabled` VẪN gọi `onChange` (M23) ⇒ chỉ thuộc tính là chưa đủ để ca hành vi cắn | §3 H2 (i)(ii); A5 prop `disabled` + `onChange` tự kiểm; A6/A7 `disabled={busy}` + chụp `ids` + `clear(ids)`; A4 `clear(ids)`; ca F8 · K2c · U1; mutant mA12 · mA13 · mA14. Lỗi cùng lớp ở textarea (có sẵn) ghi nợ §7 |
| 2 | MAJOR · §5 W2–W6/C1–C2 | W/C chỉ đỏ bằng lỗi nạp; W2/W3/W4 không có mutant chứng minh assert cắn | **Xác nhận.** v1 tự ghi «load fail»; `putBytesToStorage` bọc mọi lỗi mạng thành `Error` chung (`storage-upload.ts:36-38`, M17) ⇒ `try/catch` đi tiếp là hồi quy thực tế | §5 STUB TRƯỚC (W/C/U đỏ trên assert, thông điệp đo ở M25); thứ tự assert `settled` → spy → lỗi; mutant mA9 (W3) · mA10 (W4) · mA11 (W2+F3); A2 cấm bọc lại lỗi |
| 3 | MAJOR · §8/§9 | Không có điều kiện merge theo bản API PROD | **Xác nhận + nâng ngưỡng.** Tiền lệ `backlog.mjs:17840`. Đo chuỗi phụ thuộc (M31): ngoài #541/#545 reviewer nêu, ánh xạ lý do lỗi cần mã SOCIAL trên `error.code` — chỉ có từ **#554** (`a1dbe7f0`; trước đó dây mang `RESOURCE-ERR-…`) | D11 (chặn MERGE): A ≥ #554, B ≥ #545; §8 bước 0b lệnh `data.build.commit` + `merge-base --is-ancestor`; R9. **Không sửa `backlog.mjs` ở pha plan** (luật lane) — chép vào `notes` lúc mở PR, báo trong kết quả trả về |
| 4 | MINOR · §4 B1 | Biên phải thiếu `\p{M}`, không chuẩn hoá; biên trái đọc `rest` | **Xác nhận một phần, sửa theo đo.** P6b: NFD TOÀN PHẦN không link nhầm (`indexOf` −1 — chỉ mất link); dạng TRỘN thì link NHẦM người (M26). Biên trái mất ngữ cảnh thật (P6d, M27). **Điều chỉnh đề xuất:** KHÔNG NFC cả thân — thẻ BE không chuẩn hoá (M28) nên NFC luồng token làm hỏng link thẻ NFD | B1 viết lại: `WORD=[\p{L}\p{M}\p{N}_]` hai biên; dò trên `body` offset tuyệt đối; so `slice.normalize("NFC") === nhãnNFC`, token giữ nguyên văn; ca PU1 · PU2 · PU3; mutant mB7 · mB8 · mB9; nợ span §7 |
| 5 | MINOR · §3/§4 A8 | Link tệp mở byte người dùng inline; giả định ngầm | **Xác nhận.** `object-storage.service.ts:199-206` không `ResponseContentDisposition`; `url` là `z.string()` trần; blocklist có html/svg nhưng tệp không đuôi được thả lỏng (M32); lưới hiện tại giữ `javascript:` (M33) | §3 ghi 2 giả định + guard `^https?://`; A8 `isSafeAttachmentUrl` dùng chung cho lưới/video/tệp; ca R5 (đỏ trên code cũ `expected 2 to be 1`); mutant mA17; nợ G8; R11 |
| 6 | MINOR · §4 A8/G6 | Giảm nhẹ TTL chỉ cho ảnh; video vỡ sau 300 s | **Xác nhận** (`object-storage.service.ts:92`; `onError` video chạy được trong jsdom — M35) | A8 `<video onError>` ⇒ `attachment-video-unavailable`; ca R2b; mutant mA18; G6 ghi rõ hết hạn giữa lúc phát là nợ BE |
| 7 | MINOR · §5 K1/mK | Thông điệp mK phụ thuộc thứ tự assert vì `setQueryData` xoá `isInvalidated` | **Xác nhận** bằng đo P7a/P7b (M29) | K1 ghim thứ tự assert (`mentions` trước, `isInvalidated` sau); mK khai rõ cấy trước/sau đều cho cùng thông điệp |
| 8 | MINOR · §4 A6/A7 | Không nói hook đặt đâu; `return` sớm | **Xác nhận** (`FeedComposer.tsx:131`, `CommentComposer.tsx:71-78`, M24) | A6/A7 chỉ chỗ đặt (sau `useState(sending)`, trước `return`); effect gate-lật; D10 (khuyến nghị huỷ + dọn khay, giữ `body`); ca K3c; mutant mA16 |
| 9 | MINOR · §2 M5/D7 | M5 đo trên master, thi công sau #559 | **Xác nhận.** Đo trước trên head #559 `d88f7270` (M30): 0 ghi `socialKeys.posts.*`, chỉ `initialData` của `polls.results` ⇒ tiền đề đứng **hôm nay** | M30; §8 bước 0 đo lại sau rebase, thấy ghi `posts.*` ⇒ dừng, mở lại D3 |
| 10 | MINOR · §4 A3/A4 | Thiếu ca: gỡ item xếp hàng; MIME csv Windows; security-reviewer | (1) **Xác nhận** — v1 không nói vòng tải xử lý item đã gỡ. (2) **Ghi nhận, CHƯA đo được** (phụ thuộc trình duyệt) — chỉ suy từ code (M34). (3) **Chấp nhận** — luật security chung phủ tệp/API ngoài | (1) A4 hàng đợi đọc lại tập sống; ca U2; mutant mA15. (2) nợ G9 + chú thích D2. (3) gate lát A thêm `security-reviewer` (đầu trang, §8) — zone giữ amber |

## 11. FULL gate lượt 1 — xử lý (02/10/2026)

> Reviewer: `typescript-reviewer` (PASS — 3 MEDIUM + 4 LOW) · `security-reviewer` (PASS — 3 MEDIUM + 1 LOW). Trùng: «Thử
> lại vượt trần» do CẢ HAI nêu ⇒ 10 phát hiện riêng. Mỗi dòng đã kiểm lại trên code trước khi xử lý; vá hành vi đều có ca
> RED đo trên code CŨ + mutant đỏ đúng thông điệp (sao lưu → cấy → khôi phục bằng bản sao + `cmp`). Lát B
> (`S16-SOCIAL-MENTIONLINK-1`) vá trên `feat/s16-social-fe-2d`; lát A rebase lên đó rồi vá trên `feat/s16-social-fe-2d-a`.

| # | Nguồn · mức | Phát hiện (tóm) | Kiểm lại | Xử lý |
| --- | --- | --- | --- | --- |
| G1 | ts + sec · MEDIUM | `retry(id)` đưa ô lỗi về hàng đợi KHÔNG kiểm lại trần; `planAttachmentAdds` không đếm ô lỗi ⇒ 11 tệp, 1 lỗi, thêm 1, «Thử lại» ⇒ 12 id (400 vô danh — M10) / 11 ảnh (422) | **Xác nhận** (`use-attachment-uploads.ts:170-177`, `attachment-draft.ts:96`) | **Lát A — ĐÃ VÁ:** `retry` kiểm lại trần bằng `planAttachmentAdds` như một lượt chọn MỚI (luật 5 của hook); bị từ chối ⇒ ô GIỮ lỗi + báo lý do (`tooManyFiles`/`tooManyImages`) — người dùng gỡ bớt rồi thử lại; được nhận ⇒ dọn danh sách từ chối cũ. Ca G1 (2 DENY: 11 tệp · 10 ảnh + 1 ALLOW đối chứng: còn chỗ ⇒ tải lại, 11 id đúng thứ tự chọn) + 1 ca dọn từ chối. RED code cũ: `expected "spy" to not be called at all, but actually been called 1 times` (cả 2 DENY) · `expected [ { name: 'lon.pdf', …(1) } ] to deeply equal []`. Mutant bỏ kiểm trần ⇒ 2 DENY đỏ đúng thông điệp; mutant giữ từ chối cũ ⇒ ca dọn đỏ đúng thông điệp |
| G2 | ts · MEDIUM | `<video src>` nhận URL ký MỚI mỗi lần refetch (`getSignedUrl` không ghim `signingDate`) ⇒ phần tử giữ nguyên, `src` đổi ⇒ trình duyệt nạp lại, mất vị trí phát | **Xác nhận** (`PostAttachments.tsx:85`; `invalidatePostLists` sau thả cảm xúc/lưu/bình luận…) — ngủ tới khi mở `video/*` | **Lát A — ĐÃ VÁ:** `useSignedMediaUrl` (`PostAttachments.tsx`) GIỮ URL đầu suốt vòng đời ô — cho cả ẢNH (thôi tải lại mọi ảnh trên mọi trang đã nạp sau mỗi lần thả cảm xúc). Ca G2 (video: cùng phần tử + `src` giữ · ảnh) ở `PostAttachments.spec.tsx` mới. RED code cũ: `expected 'https://cdn.invalid/v1.mp4?sig=2' to be 'https://cdn.invalid/v1.mp4?sig=1'` (ảnh tương tự). Mutant «`src` đi theo prop» ⇒ 2 ca G2 đỏ đúng thông điệp |
| G3 | ts · MEDIUM | `failed` là boolean dính chặt — refetch mang URL mới vẫn không hồi ô ảnh/video | **Xác nhận** (`PostAttachments.tsx:51,74`) | **Lát A — ĐÃ VÁ:** cùng hook — URL đang dùng lỗi ⇒ ô trung tính; prop mang URL KHÁC (server ký lại trước hay sau lúc lỗi) ⇒ nhận URL đó, vẽ lại; URL mới lỗi tiếp ⇒ trung tính, KHÔNG quay về URL cũ; cùng URL ⇒ không nạp lại URL đã chết. 3 ca G3. RED code cũ: `expected <div …(2)>…(1)</div> to be null`. Mutant «không nhận URL mới sau lỗi» ⇒ 3 ca đỏ đúng thông điệp |
| G4 | ts · LOW | Nhãn mơ hồ bị LOẠI HẲN ⇒ nhãn ngắn của người thứ ba khớp nửa tên trọn (probe R-B2) | **Xác nhận** — `buildMentionLabels` bỏ nhãn `null` | **Lát B — ĐÃ VÁ:** nhãn mơ hồ giữ trong bảng làm CHẶN (`employeeId: null`; khớp đầu tiên mơ hồ ⇒ không link, không thử nhãn ngắn hơn). Ca **P3b** (DENY + 2 đối chứng). RED code cũ: `expected [ …(3) ] to deeply equal [ …(3) ]` (nhận link «@Nguyễn Văn An» → E3). Mutant lọc lại nhãn mơ hồ ⇒ P3b đỏ đúng thông điệp. Biến thể phần tử RÚT (R-B1): không chặn được — ghi R6 |
| G5 | ts · LOW | a11y: (a) `trayAria` nói «bài» cả ở ô bình luận · (b) mọi «Thử lại» cùng tên · (c) `<video>` không tên · (d) vùng `role=status` mount CÙNG chữ | **Xác nhận** cả 4 (`ComposerAttachmentTray.tsx:76,121,155-163`, `PostAttachments.tsx:85`) | **Lát A — ĐÃ VÁ cả 4:** (a) `attachment.trayAria.{composer,comment}` theo tiền tố khay · (b) nút «Thử lại» `aria-label` «Thử lại tải lên «tên»» (chứa chữ hiển thị — WCAG 2.5.3) · (c) `<video aria-label>` = tên tệp, vô danh ⇒ «Tệp đính kèm» · (d) `<p role=status>` LUÔN mount, chỉ đổi chữ (`sr-only` khi rỗng; testid giữ nguyên). RED code cũ: (a) `expected 'Tệp đính kèm của bài đang soạn' to match /bình luận/` · (b) `toHaveAccessibleName()` nhận «Thử lại» · (c) `expected null to be 'hop-giao-ban.mp4'` · (d) `Unable to find an accessible element with the role "status"`. 4 mutant, mỗi cái đỏ đúng ca của nó |
| G6 | ts · LOW | Câu `attachmentRejected` chép cứng «10 ảnh · 1 video · 20 MB» — bản thứ hai không nối với hằng contracts | **Xác nhận** (`social.ts:484`) | **Lát A — ĐÃ VÁ:** `feed/lib/attachment-limits.ts` (CHỈ import contracts — `ActionErrorBanner` dùng ở mọi màn) = MỘT nguồn cho `{{max}}` của khay và tham số `{{images}}`/`{{videos}}`/`{{maxSize}}` mà `ActionErrorBanner` truyền cho câu 422. Ca mới `ActionErrorBanner.limits.spec.tsx` (mock hằng contracts 7 · 2 · 5 MB) + lưới `not.toContain("{{")` cho MỌI reason ở `ActionErrorBanner.spec`. RED code cũ: `expected 'Tệp đính kèm không được chấp nhận: vư…' to contain '7 ảnh'`. Mutant «dải không truyền tham số» ⇒ 3 ca đỏ (limits · lưới `{{` · E2 của PostDetailPage); mutant «chép cứng lại số» ⇒ limits đỏ đúng thông điệp |
| G7 | ts · LOW | `findMentionLink(base)` dò lại MỌI `@` còn lại sau MỖI token ⇒ O(token × @) (probe R-B4 ~74 ms/lượt) | **Xác nhận** + đo lại (Node 24, `@A` × 2000 + 50 nhãn): **59,7 ms** trung vị; nhánh không `mentions` 1,6 ms | **Lát B — ĐÃ VÁ:** con trỏ (lượt dò trước còn hiệu lực tới khi `from` vượt match) ⇒ mỗi `@` đi qua một lần: **1,8 ms**. Ca **P8** đếm `indexOf("@")` (tất định). RED code cũ: `expected 80600 to be less than or equal to 800`. Mutant tắt con trỏ ⇒ P8 đỏ đúng thông điệp, đầu ra không đổi |
| G8 | sec · MEDIUM | Tải về không `Content-Disposition` + allowlist MIME đổi được THEO CÔNG TY lúc chạy ⇒ XSS lưu trữ trên origin storage khi admin mở `text/html`/`image/svg+xml` | **Xác nhận** (`files.service.ts:889-893` `resolveMany(companyId…)`; `mime-extension.ts:37-41` thả lỏng khi không đuôi / MIME ngoài map); mặc định an toàn (`setting-defaults.ts:41-56`) — ⚠️ **SAI** (FULL gate lượt 2, §12 H1: khai thác được với cấu hình MẶC ĐỊNH vì Content-Type của PUT không được ký — M36) | Ngoài phạm vi FE ⇒ seed 🔴 **`S16-SOCIAL-FILEDISPOSITION-1`** (BE) + ghi điều kiện merge vào notes FE-2D; `S16-SOCIAL-VIDEOMIME-1` chờ nó |
| G9 | sec · MEDIUM | Phần tử `url:null` vẫn mang `fileName`/`sizeBytes`/`kind`/`fileId`; WS phát metadata cho cả công ty ⇒ «masking ở server» của §3 là sai | **Xác nhận** (`social-attachments.service.ts:541-550`; `social-posts.service.ts:848`; `social-comments.service.ts:544`) | Ngoài phạm vi FE ⇒ seed 🔴 **`S16-SOCIAL-ATTMETAMASK-1`** (BE); §3 sửa lời |
| G10 | sec · LOW | Gỡ ô sau khi 055 xong ⇒ bytes + hàng `files` `Uploaded` ở lại mãi | **Xác nhận** + đo lại: `TEMP_FILE_CLEANUP` (S2-FND-JOBS-1 done) chỉ dọn `Pending` quá TTL + tệp tạm (`temp-file-cleanup.repository.ts:115-133`) | Ngoài phạm vi FE ⇒ seed **`S16-SOCIAL-ORPHANUPLOAD-1`** (BE, LOW); G5 §7 sửa lời |

Ghi chú không phải phát hiện: (1) security-reviewer — DEVOPS-03 §13.3 ghi PROD/dev-online `S3_ENDPOINT=http://localhost:9000`;
nếu đúng, URL ký PUT/GET trỏ về localhost của MÁY NGƯỜI DÙNG ⇒ ghi thành mục kiểm lúc merge (D11) trong notes FE-2D.
(2) typescript-reviewer — tên tệp có ký tự đảo chiều (RTLO) hiển thị không cô lập ⇒ lát A bọc tên tệp của link trong
`<bdi>` (ca trong `PostAttachments.spec.tsx`, ký tự dựng bằng `String.fromCharCode` — KHÔNG để ký tự điều khiển hướng
chữ thô trong mã; RED code cũ: link không có `<bdi>`; mutant `<span>` ⇒ đỏ).

## 12. FULL gate lượt 2 — xử lý (02/10/2026)

> Re-gate sau lượt 1. `security-reviewer`: 1 HIGH + 1 MEDIUM, cùng một gốc — tiền đề «tải về an toàn với cấu hình mặc định»
> của §3 (M32 (a)) và §11 G8 SAI. Kiểm lại trên code + đo (M36) trước khi xử lý. Gốc ở BE (kiểu storage phục vụ), FE không ép
> được ⇒ KHÔNG vá BE trong WO FE; chọn đường (a) của reviewer: WO BE thành điều kiện MERGE của lát A (lý do ở H1).

| # | Nguồn · mức | Phát hiện (tóm) | Kiểm lại | Xử lý |
| --- | --- | --- | --- | --- |
| H1 | sec · HIGH | Nhân viên bất kỳ làm link tệp của bảng tin phục vụ HTML của mình INLINE từ storage với cấu hình mặc định: PUT không ký `Content-Type`, confirm không so kiểu, GET không `response-*`; link `<a target=_blank>` của lát A là đường bấm cho CẢ công ty (chat đã có cùng gốc) | **Xác nhận** — M36 (SDK 3.1068.0: `X-Amz-SignedHeaders=content-length;host`; `signableHeaders` ⇒ thêm `content-type`); `files.service.ts:276-294`; `object-storage.service.ts:199-206,217-225`; chat `MessageBubble.tsx:144,161` · `RoomFilesTab.tsx:128,145`. Phía storage (kiểu lưu = header của PUT) là ngữ nghĩa S3 — không đo (không chạm storage) | **Đường (a):** `S16-SOCIAL-FILEDISPOSITION-1` mở rộng (ký `Content-Type` PUT · confirm so kiểu · `ResponseContentType` = MIME đã đăng ký + `attachment` cho loại không phải media · sửa docblock `:138`) và thành **điều kiện MERGE D11 bổ sung của lát A** (`notes` FE-2D + §8 bước 0b). Không `depends_on`: harness dùng nó cho READY lúc BẮT ĐẦU (`gen-status.mjs:91`), không chặn merge. Lát A: luật 3 trong docblock `PostAttachments.tsx` ghi tiền đề đúng + điều kiện MERGE (chỉ chú thích, không đổi hành vi). **Không chọn (b) vá FE tạm:** chỉ phủ `kind=file` — ảnh khai `image/png` mà PUT `image/svg+xml` vẫn vẽ trong `<img>` (script tắt) rồi CHẠY script khi «mở ảnh trong tab mới» (lưới `object-cover`, không lightbox); fetch→blob lại cần CORS GET của bucket (repo chưa có — `task-file-api.ts:29-36`). Giá của (a) ≈ 0: lát A chỉ chạy được khi storage tới được từ trình duyệt (mục kiểm D11), mà storage không được mở trước WO BE đó (chat) |
| H2 | sec · MEDIUM | Kiểm soát G8 ghi ở lượt 1 không chặn merge lát A; done_when của WO seed bỏ ngỏ (chặn MIME lúc register không chống kiểu chọn lúc PUT, không dòng nào gắn kiểu lưu/phục vụ với MIME đã đăng ký); §3 M32 (a) + §11 G8 lặp tiền đề sai; docblock `object-storage.service.ts:138` sai | **Xác nhận** cả 4 (`backlog.mjs` notes FE-2D + `S16-SOCIAL-FILEDISPOSITION-1`; §3; §11 G8; `:138` đối chiếu M36). Cùng niềm tin sai ở 7 docblock FE («lệch ⇒ 403 SignatureDoesNotMatch» — `storage-upload.ts:17` · `chat-upload.ts:64` · …): ý định thiết kế là KÝ, SDK lặng lẽ không ký | `backlog.mjs`: notes FE-2D sửa vế «mặc định an toàn» + dòng FULL gate lượt 2 (đường tấn công · điều kiện MERGE · kiểm owner); `S16-SOCIAL-FILEDISPOSITION-1` — tiêu đề, src lượt 2, done_when 1–3 (ký PUT · confirm so kiểu · GET `ResponseContentType`; đều RED trước, ca trên bucket lane/dev) + 6 (docblock `:138`; 7 docblock FE chỉ đúng SAU khi ký), notes điều kiện siết (trước khi mở storage cho trình duyệt · trước merge lát A · trước mở allowlist); `S16-SOCIAL-VIDEOMIME-1` done_when 1 + src theo phạm vi mới. Plan: đầu trang · M13 · M32 · M36 mới · §3 · §7 G8 · §8 bước 0b · R11 · §11 G8 sửa lời |

Phép đo cho owner (KHÔNG PROD): trên bucket lane/dev, presign PUT `application/pdf` rồi PUT kèm `Content-Type: text/html`
⇒ HEAD phải thấy `text/html` (xác nhận vế storage của H1); sau `S16-SOCIAL-FILEDISPOSITION-1` ⇒ 403. Nếu storage PROD ĐÃ tới
được từ trình duyệt (khác DEVOPS-03 §13.3) thì chat phơi NGAY HÔM NAY ⇒ WO đó đi trước mọi việc khác.
