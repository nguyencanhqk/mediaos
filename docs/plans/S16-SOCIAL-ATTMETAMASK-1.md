# S16-SOCIAL-ATTMETAMASK-1 — trên các đường đọc SOCIAL, metadata đính kèm (`fileName`/`sizeBytes`) chỉ trả khi ký được URL cho CHÍNH người xem; payload WS không mang tên/cỡ tệp

> Trạng thái: **plan v2 (18/10/2026 — vá plan-review PASS_WITH_FIXES, §9.3)**. Đo tĩnh trên `0bb31eeb` (worktree `MediaOS-qa1`, nhánh `fix/s16-social-attmetamask-1`).
> Zone ĐỎ · FULL gate · KHÔNG migration · KHÔNG dependency · KHÔNG đổi SQL/repository · KHÔNG đổi HÌNH DẠNG DTO REST (hai trường vốn
> đã nullable) · WS giữ nguyên tập khoá ⇒ **MỘT PR** (§5). KHÔNG sửa FE (done_when #3).
> Nguồn: mục WO `S16-SOCIAL-ATTMETAMASK-1` (`harness/backlog.mjs`, seed 02/10 từ FULL gate lượt 1 của `S16-SOCIAL-FE-2D`,
> security-reviewer MEDIUM — hành vi BE có sẵn, không do diff FE).
> Thẩm quyền: owner chọn «ATTMETAMASK tới PR (Recommended)» qua AskUserQuestion ~11:57 ngày 18/10 (đã đối chiếu bằng lệnh chỉ-đọc trên
> transcript phiên chính lúc lập plan), khung ngân sách 16/10 (WO đỏ ≤ 400 USD; ước WO này 150–300 USD). Hook ECC in «COST
> CRITICAL/WARNING» với tổng ảnh chụp luỹ kế — không phải chi phí thật.
> **Kho PUBLIC:** plan/commit/PR mô tả bất biến + cách che + phép đo; không dữ liệu PROD, không công thức khai thác.
> Merge = công bố ⇒ owner deploy API **trong ngày merge**, và **TRƯỚC khi merge #580** (§8).

Viết tắt: `S/` = `apps/api/src/social/` · `T/` = `apps/api/test/` · `C/` = `packages/contracts/src/` · «ký được» = `signOne` trả URL
khác `null` · «bị từ chối» = `signOne` trả `null` (mọi lý do) · `001` feed · `003` một bài · `006` kiểm duyệt · `014` bình luận ·
`020` tin.

## 1. Bối cảnh + phép đo

- [ĐO] `S/social-attachments.service.ts:466-553` `decorateMany`: một truy vấn lô (`:475-501`), một truy vấn MỌI link của tệp kể cả module
  khác (`:504-530`), một `signOne` mỗi tệp (`:532-539`), rồi `:541-551` đẩy `{fileId, kind, fileName: row.originalName, sizeBytes:
row.fileSizeBytes, url}` — **tên + cỡ trả nguyên văn kể cả khi `url` = `null`**.
- [ĐO] `signOne` `:556-608` trả `null` cho: 0 link (`:564`) · policy DENY (`:581-591`; `deny-no-resolver`/`deny-error` có
  `logger.error` `:584-589`, `deny-resolver` im lặng) · lỗi storage (`catch` `:599-607`, `logger.warn` chỉ mang `fileId` + thông điệp lỗi).
- [ĐO] Người gọi `decorateMany` — đúng 3 chỗ, và đó là nơi DUY NHẤT dựng `FeedAttachmentDto` (grep `toFeedPostDto(`/`toFeedCommentDto(`
  trên `S/` không kể spec): `S/social-posts.service.ts:784` (trong `decorate` `:730`; dùng bởi `:161` 003 · `:340` 002 · `:468` 004 ·
  `:599` các danh sách 001/tìm kiếm/hồ sơ/đã lưu/bài nhóm · `decorateForViewer` `:715` ← `S/social-news.service.ts:130` 020) ·
  `S/social-comments.service.ts:437` (`decorate` `:400`; 014/015/016) · `S/social-posts-moderation.service.ts:96-100` (006).
- [ĐO] Trong `S/`, đường đọc đính kèm KHÔNG qua `decorateMany`: không có. `originalName`/`fileSizeBytes` trên `S/` chỉ xuất hiện ở
  `social-attachments.service.ts` (`:290-315` cổng gắn — không trả ra · `:480-547` decorate · `:596` tên cho Content-Disposition của
  presign). Báo cáo/snapshot (`social-reports.*`) và payload NOTI (`social-noti.payload.ts`) không đụng đính kèm (grep `attach`).
- [ĐO] Phạm vi: WO này phủ các đường đọc SOCIAL (REST `decorateMany` + WS). Các cửa metadata tệp của FOUNDATION là module khác, có
  cổng cặp riêng (`view:foundation-file`) — ngoài diff này, xem O6.
- [ĐO] WS: `S/social-ws-payload.ts:46-80` `buildWsPostCreatedEvent` bóc `url` ở `:71` (giữ tên/cỡ); `S/social-comments.service.ts:543-559`
  `emitCommentCreated` bóc `url` ở `:556`. Emitter `.parse()` trước khi phát: `apps/api/src/realtime/realtime-emitter.service.ts:633` (bài)
  · `:650` (bình luận). Schema `C/realtime.ts:352-353` `wsFeedAttachmentSchema = feedAttachmentSchema.omit({url})`, dùng ở `:411` ·
  `:423` · `:442`. Tiền lệ «giữ khoá, ép giá trị» = `wsFeedAuthorSchema` `:356-374` (`avatarUrl` `.transform((): null => null)`).
- [ĐO] Contracts REST `C/social-api.ts:136-149`: `fileName`/`sizeBytes` đã `.nullable()` (`:145-146`), không `.optional()`.
- [ĐO] FE: master `apps/app/src/routes/social/feed/lib/feed-format.ts:87` chỉ vẽ ảnh `url !== null`; nhánh #580 `feed-format.ts:144`
  `splitAttachments` lọc cả ba loại. `apps/app/src/hooks/use-feed-realtime.ts:69` `safeParse(wsFeedPostCreatedEventSchema)` — trượt ⇒
  `warnBadPayload` + bỏ sự kiện; chỉ ĐẾM. Không có listener `feed:comment.created` nào ở FE (grep `apps/app/src` + `packages/web-core`).
- [ĐO] Sửa đính kèm: `C/social-api.ts:617-618` «`attachmentIds` VẮNG = giữ, `[]` = gỡ hết», có mặt = allowlist ĐẦY ĐỦ;
  `S/social-attachments.service.ts:376` gỡ mềm mọi link không nằm trong danh sách gửi lên, và gỡ là **một chiều** (`:380-384` — vế 5 «đã
  TỪNG link» chặn gắn lại). FE hôm nay KHÔNG có đường sửa đính kèm: master 0 lần `attachmentIds` trong `apps/app/src`; #580 chỉ ở composer
  TẠO (`FeedComposer.tsx:182`, `CommentComposer.tsx:111`).
- [ĐO] Module CHAT dựng metadata đính kèm theo luật riêng của nó — ngoài phạm vi (§9, O3).
- [ĐO] `file_links` cho phép một tệp có link sống tới nhiều thực thể (`apps/api/src/db/schema/files.ts:144-145` unique theo
  `(entity, file)`), nên luật AND của `decideForLinkedFile` có thể từ chối người xem thấy được bài chứa tệp.

## 2. Quyết định owner đã có

- FE-2D D4 (owner ký): FE ẩn hẳn đính kèm `url: null`; plan FE-2D §3 ghi rõ đó chỉ là lưới CLIENT cho tới khi WO này xong.
- Owner 18/10: làm tới khi mở PR. done_when chừa cho plan chốt MỘT trong «VẮNG» / «`null`» — chốt ở D-2.

## 3. Bất biến phải giữ (phạm vi: các đường đọc SOCIAL — REST qua `decorateMany` + WS bài/bình luận)

1. **Một vị từ:** `fileName`/`sizeBytes` của một phần tử REST SOCIAL khác `null` ⇔ `url` của CHÍNH phần tử đó khác `null`. Không biểu thức thứ hai.
2. **Một nơi dựng:** `FeedAttachmentDto` chỉ được dựng bởi hàm thuần `toFeedAttachmentDto` (§4.1); `decorateMany` là đường duy nhất gọi nó.
3. **WS không mang tên/cỡ** ở HAI tầng độc lập: nguồn (helper thuần) + schema (`.transform`). Tập khoá WS KHÔNG đổi.
4. Người xem ký được ⇒ đủ trường như hôm nay (không hồi quy chiều CHO PHÉP).
5. Không thêm log mới mang tên tệp; log hiện có (`:585`, `:602`) giữ nguyên ngữ nghĩa.

## 4. Thiết kế — quyết định

**D-1 (H1) — che theo `url === null`, KHÔNG tách DENY khỏi lỗi storage.** Lý do: (a) FE ở cả master (`feed-format.ts:87`) lẫn #580
(`:144`) không vẽ phần tử `url: null` ⇒ giữ tên khi lỗi storage không mang giá trị UI nào; (b) tách ba trạng thái buộc `signOne` đổi kiểu
trả, và một nhánh DENY mới bị xếp nhầm vào «lỗi» là lộ lại đúng thứ WO này đóng — một vị từ là fail-closed theo cấu trúc; (c) server dùng
CÙNG vị từ với FE (`url !== null`). Tác động log: không đổi — lỗi storage vẫn `warn` (`:602`), DENY bất thường vẫn `error` (`:585`), DENY
thường vẫn im; không thêm dòng log nào. Dòng `warn` `:602` mang `fileId` + `err.message`: [ĐO] khoá lưu trữ =
`{companyId}/files/{fileId}` (`apps/api/src/storage/file-storage-key.ts:64`; `SEGMENT_RE` cấm `.` — `storage-key.ts:22`) nên lỗi
khoá không chứa tên tệp, và thông điệp kiểm presign chỉ nêu TÊN tham số, không giá trị (`object-storage.service.ts:204-205`). Lỗi
SDK bên thứ ba chưa chứng minh được ⇒ R-6 assert dòng `warn` không chứa tên tệp. Cái giá: khi storage sập, người được phép mất cả tên — giao diện vốn đã ẩn phần tử đó.

**D-2 (H2) — GIỮ phần tử, `fileName`/`sizeBytes` = `null` (KHÔNG làm VẮNG).** Lý do: (a) lượt sửa nhận allowlist ĐẦY ĐỦ và gỡ là một chiều
(§1) ⇒ client dựng `attachmentIds` từ danh sách đang thấy sẽ GỠ VĨNH VIỄN tệp bị ẩn mà không ai biết — tác giả/kiểm duyệt có thể bị từ
chối ký trên chính bài mình (link sang thực thể khác, tệp bị cách ly), nên đây không phải ca lý thuyết; giữ `fileId` cho phép gửi lại
nguyên vẹn; (b) không đổi hình dạng contracts (`:145-146` đã nullable) ⇒ bundle FE cũ/mới đều parse được; (c) UI không đổi (FE ẩn
`url: null`). Phần còn lộ, CHẤP NHẬN có ghi (O4), trên REST VÀ WS (WS phát cho cả room): `fileId` (UUID mờ; cửa đọc tệp THEO ID
đi qua `FilePolicy` — `files.controller.ts:87-92` `canView`, ca R-8 đo), `kind` (3 giá trị suy từ MIME), SỐ LƯỢNG tệp. Ẩn sự tồn tại
vẫn là việc của lưới client D4.

**Luật hợp đồng đi kèm D-2:** khi sửa bài/bình luận, client PHẢI gửi lại `fileId` của MỌI phần tử `attachments`, KỂ CẢ phần tử
`url: null` — lọc theo danh sách đang vẽ là gỡ vĩnh viễn tệp bị ẩn (gỡ một chiều, §1). Ghi vào docblock helper `attachmentIds`
(`C/social-api.ts:114`, dùng chung 004/016) + docblock `:617-618` + API-19 §6.1 ở L3. Phía API (R-7) chỉ chứng minh link được giữ khi
client gửi đủ; phía FE là nợ §9.

**D-3 (H3) — WS: GIỮ khoá, ép GIÁ TRỊ `null` ở hai tầng.** Đo cửa sổ deploy: FE `use-feed-realtime.ts:69` parse bằng schema contracts;
schema cũ đòi khoá `fileName`/`sizeBytes` (nullable, KHÔNG optional) ⇒ bỏ khoá làm bundle FE cũ (tab mở trước deploy) bỏ MỌI
`feed:post.created` có đính kèm. Vì vậy:

- Tầng nguồn: helper thuần `wsAttachmentsOf(attachments)` trong `S/social-ws-payload.ts` trả `{fileId, kind, fileName: null, sizeBytes:
null}`; `buildWsPostCreatedEvent` (`:71`) và `emitCommentCreated` (`S/social-comments.service.ts:556`) cùng gọi nó (thay một dòng).
- Tầng schema: `wsFeedAttachmentSchema = feedAttachmentSchema.omit({url}).extend({fileName: …nullable().transform((): null => null),
sizeBytes: …nullable().transform((): null => null)})` — khuôn `wsFeedAuthorSchema`. Kiểu ĐẦU RA `null` ⇒ nguồn chép tên là TS đỏ lúc biên
  dịch; emitter `.parse()` ⇒ kể cả nguồn hồi quy, dây vẫn `null`.
- `fileId`/`kind` giữ trên WS = đúng thứ một người bị từ chối thấy ở REST (WS phát cho cả room ⇒ phải là góc nhìn hẹp nhất).
- Thứ tự deploy FE/API cho WO này: hai chiều đều an toàn (API mới + FE cũ: khoá có, giá trị `null` hợp lệ; FE mới + API cũ: transform ép
  `null` lúc parse). Ràng buộc duy nhất: API lên PROD trước khi merge #580.

**D-4 (H4) — KHÔNG sửa `realtime-emitter.service.ts`** (`.parse()` đã có ở `:633`/`:650`, transform tự áp) ⇒ KHÔNG cần L0, mọi tệp đổi
nằm trong `paths` hiện có.

**D-5 — Vị trí mã.** `toFeedAttachmentDto(row, url)` export thuần trong `S/social-attachments.service.ts` (633 → ~655 dòng), `decorateMany`
gọi nó ở `:541-551`. `S/social-posts.service.ts` (891, nợ POSTSSPLIT) KHÔNG đổi. `S/social-comments.service.ts` đổi một dòng + import.
Docblock `decorateMany`/`signOne` ghi vị từ D-1; docblock `C/social-api.ts:136-141` + `C/realtime.ts:352` ghi luật mới.

**D-6 — Test.** Int-spec MỚI `T/integration/s16-social-attmetamask-1.int-spec.ts` dựng qua `bootQa1World` (`T/helpers/social-qa1-kit.ts:185,
:210` — `applyMainPipeline` + `listen(0)` ⇒ ratchet pipeline-parity/supertest-listen xanh). Không mở rộng `social-be1-attachments`: khuôn
cũ không qua `applyMainPipeline` (`:142-146`) và bộ cặp của nó là phép đo đã ghim (`:41-52`). Mở rộng W-1/W-2 của
`T/integration/s16-social-qa1-ws.int-spec.ts` (721 dòng, +~12). Unit: `S/social-ws-payload.spec.ts`, `C/social-ws.spec.ts`, structure spec
mới `S/social-attachments-mask-structure.spec.ts` (khuôn `social-reports-mask-structure.spec.ts`).

## 5. Triển khai — MỘT PR

Một PR, các commit theo lát §7. Không migration ⇒ không có cửa sổ schema; DTO cùng hình dạng ⇒ revert một commit `fix(social)` là lùi
được. FE không đổi; contracts đổi ⇒ Pages có thể tự build lại FE — vô hại (D-3).

## 6. Ca test viết TRƯỚC (TỪ CHỐI đứng cạnh CHO PHÉP) + mutant ★

Fixture (công ty A của `bootQa1World`): `author` = `FEED_PAIRS` (có `manage:feed-post`, `manage:feed-news`); `peer` = `view:feed` +
`create:feed-comment` (KHÔNG cặp tệp FOUNDATION nào — R-1..R-7 không bị đường FOUNDATION làm nhiễu); `fileViewer` (chỉ dùng cho R-8) =
`view:feed` + `view:foundation-file` (`Qa1Pair` có cặp này — `T/helpers/social-qa1-kit.ts:66`).
Tệp gieo SQL như `qa1-ws` `:227-243` (khoá lưu trữ có tiền tố `<companyId>/`). Ba nguồn «bị từ chối», gieo bằng `direct` pool:

- **F_hid** — tệp gắn bài công ty P (thấy được) + một link sống phụ tới bài `hidden` của `author` (006 `hidden:true`) ⇒ `peer` bị từ
  chối (luật AND, `deny-resolver`), `author` ký được ⇒ ALLOW đứng cạnh trên CÙNG bài. [SUY RA] `author` thấy bài `hidden` của chính
  mình: vị từ visibility cho `hidden` với tác giả HOẶC `manage:feed-post` (`S/social-access.service.ts:483`, `:496-498`), và quyết định
  tải đi `canReadOwner` → `ownerContent` (`S/social-file.resolver.ts:111-115`, `:200-209`). L1 đo trên mã CŨ: `url` của `author` cho
  F_hid khác `null` (nếu không, R-1a đỏ ngay trên mã cũ và ★2 mất neo). Đường lùi: link phụ tới một bài nhóm kín mà `author` là
  thành viên active còn `peer` thì không.
- **F_gone** — link sống phụ tới `(SOCIAL, feed_post, <uuid không tồn tại>)` ⇒ từ chối MỌI người kể cả kiểm duyệt (dùng cho 006).
  [SUY RA] resolver trả `false` («không tồn tại ⇄ không thấy», `S/social-file.resolver.ts:186`) ⇒ không `logger.error`; L1 đo.
- **F_store** — khoá lưu trữ KHÔNG có tiền tố tenant ⇒ policy cho qua, `storage.get` ném (`T/integration/social-be1-attachments.int-spec.ts:105-107`)
  ⇒ `catch` ⇒ `null` (D-1). [SUY RA] L1 đo; nếu không ném trong `signOne` ⇒ chuyển ca sang unit với storage giả.
- **F_ok** — tệp thường, đi cùng bài với tệp bị từ chối (neo ALLOW).

| Ca   | Đường                                         | Người xem           | Kỳ vọng sau vá                                                                                                                                                                                   | Mã CŨ                 |
| ---- | --------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| R-1  | 003                                           | peer                | 2 phần tử (neo D-2); F_hid: `fileId`+`kind` đúng, `fileName`/`sizeBytes`/`url` = `null`; F_ok: đủ trường, `url` chuỗi                                                                            | ĐỎ (tên/cỡ khác null) |
| R-1a | 003                                           | author              | cả hai đủ trường, `url` chuỗi                                                                                                                                                                    | xanh (neo ALLOW)      |
| R-2  | 001 (feed)                                    | peer / author       | như R-1 / R-1a trên phần tử của P                                                                                                                                                                | ĐỎ / xanh             |
| R-3  | 014 (bình luận)                               | peer / author       | bình luận mang F_hid′: che / đủ                                                                                                                                                                  | ĐỎ / xanh             |
| R-4  | 020 (tin)                                     | peer / author       | bài `news` mang F_hid″ (gắn qua 002, hoặc gieo link SQL nếu 002 không nhận đính kèm cho `news`): che / đủ                                                                                        | ĐỎ / xanh             |
| R-5  | 006 (phản hồi)                                | author (kiểm duyệt) | bài [F_gone, F_ok], đổi `commentsLocked`: F_gone che, F_ok đủ                                                                                                                                    | ĐỎ                    |
| R-6  | 003                                           | author              | F_store: `url` null ⇒ `fileName`/`sizeBytes` null (D-1); dòng `warn` presign không chứa tên tệp                                                                                                  | ĐỎ                    |
| R-7  | 004 rồi 003                                   | author              | bài [F_gone, F_ok]: gửi lại `attachmentIds` = các `fileId` đang thấy ⇒ 200, link F_gone CÒN sống (SQL), 003 vẫn 2 phần tử                                                                        | xanh (neo D-2)        |
| R-8  | FOUNDATION `GET /foundation/files/:id`        | fileViewer          | F_hid ⇒ không 200, thân lỗi không chứa tên tệp (chỉ neo cửa THEO ID; phạm vi các cửa FOUNDATION khác — O6)                                                                                       | xanh (neo)            |
| W-1  | WS `feed:post.created` (qa1-ws)               | listener            | tập khoá như cũ; `fileId`/`kind` = REST; `fileName`/`sizeBytes` = `null` trên dây + neo dương REST của listener có tên/cỡ khác null và `url` chuỗi                                               | ĐỎ (dây mang tên)     |
| W-2  | WS `feed:comment.created` (qa1-ws)            | listener            | như W-1                                                                                                                                                                                          | ĐỎ                    |
| U-1  | `toFeedAttachmentDto`                         | —                   | `url` null ⇒ hai trường null; `url` chuỗi ⇒ nguyên văn                                                                                                                                           | (hàm mới)             |
| U-2  | `buildWsPostCreatedEvent` / `wsAttachmentsOf` | —                   | đầu vào có tên/cỡ ⇒ đầu ra `null`, khoá còn                                                                                                                                                      | ĐỎ                    |
| U-3  | `C/social-ws.spec.ts`                         | —                   | `wsFeedAttachmentSchema.parse({…fileName:"a.png", sizeBytes:10})` ⇒ `null`; schema REST cũ `omit(url)` vẫn nhận payload mới (tương thích bundle cũ)                                              | ĐỎ                    |
| S-1  | structure spec                                | —                   | (a) `fileName:` gán từ `originalName` chỉ trong `toFeedAttachmentDto`; (b) `social-comments.service.ts` + `social-ws-payload.ts` không còn `attachments.map(` tự dựng, chỉ gọi `wsAttachmentsOf` | ĐỎ                    |

Mọi ca DENY có neo dương trên CHÍNH phản hồi (phần tử tồn tại, `fileId` đúng) — tránh «rỗng xanh».

| ★   | Mutant                                                | Bị giết bởi                            |
| --- | ----------------------------------------------------- | -------------------------------------- |
| ★1  | Bỏ che REST (luôn trả tên/cỡ)                         | R-1…R-6, U-1                           |
| ★2  | Che cả người ký được (luôn `null`)                    | R-1a, phần F_ok của R-1/R-5, U-1       |
| ★3  | Che một trường (chỉ `fileName`)                       | R-1…R-6 vế `sizeBytes`, U-1            |
| ★4  | VẮNG thay cho `null` (lọc phần tử bị từ chối)         | R-1 neo số phần tử, R-5, R-7           |
| ★5  | Che chỉ khi DENY, giữ tên khi lỗi storage (ngược D-1) | R-6                                    |
| ★6  | Builder WS bài chép tên (bỏ tầng nguồn)               | typecheck (kiểu ra `null`) + U-2 + S-1 |
| ★7  | Bỏ `.transform` ở schema WS (bỏ tầng schema)          | U-3                                    |
| ★8  | Bình luận WS tự `map` lại, bỏ helper                  | S-1b (+ typecheck nếu chép tên)        |

Ghi nhận: W-1/W-2 một mình KHÔNG giết ★6/★7 (tầng kia vẫn che) — đúng thiết kế hai tầng, mỗi tầng có ca riêng.

## 7. Lát thi công · verify · gate

- **L0** — KHÔNG cần (D-4). Nếu lát nào buộc chạm tệp ngoài `paths` ⇒ dừng, thêm ĐÚNG path vào WO bằng commit `chore(docs)` riêng chỉ backlog.
- **L1 RED** — int-spec mới + W-1/W-2 + U-1 (gọi hàm chưa có ⇒ đỏ biên dịch là chấp nhận được; hoặc viết U-1 ở L2) + U-2 + U-3 + S-1.
  Lane `mediaos_attmeta` (đã dựng sạch; chỉ `lane-db-setup --reset` nếu lane hỏng, ghi lý do). Từ gốc worktree:
  `. scripts/lib/db-secrets.sh && db_secrets_load >/dev/null 2>&1; LANE_DB=mediaos_attmeta pnpm --filter @mediaos/api exec vitest run
test/integration/s16-social-attmetamask-1.int-spec.ts test/integration/s16-social-qa1-ws.int-spec.ts` (KHÔNG `pnpm test -- <path>`;
  KHÔNG int-spec thiếu `LANE_DB`). Ghi số đỏ ĐÚNG lý do (tên/cỡ khác null) và kết quả đo bốn [SUY RA] của §6 (`author` ký được F_hid
  trên mã cũ · F_gone không log error · F_store ném trong `signOne` · 002 nhận đính kèm cho `news`). Commit `test(social): S16-SOCIAL-ATTMETAMASK-1 — …`.
- **L2 GREEN BE** — `toFeedAttachmentDto` + `decorateMany` + docblock; `wsAttachmentsOf` + hai call-site. R-_, W-_, U-1/U-2, S-1 xanh;
  int-spec liên quan xanh trên lane: `social-be1-attachments` · `social-attgate-1-update-attach` · `social-be1c-file-door` ·
  `social-be1b-news` · `s16-social-qa1-ws`. Coverage đích TRƯỚC (commit L1) và SAU:
  `… exec vitest run <các int-spec trên + s16-social-attmetamask-1> --coverage --coverage.include='src/social/social-attachments.service.ts'
--coverage.reporter=text` ⇒ ghi % vào sổ vết. **Ngưỡng:** SAU ≥ 80% dòng cho `social-attachments.service.ts`; thấp hơn ⇒ CHẶN PR
  tới khi thêm ca hoặc owner ký lý do. Commit `fix(social): …`.
- **L3 contracts + docs** — `C/realtime.ts` transform + docblock; `C/social-api.ts:136-141` docblock; luật hợp đồng D-2 vào docblock
  helper `attachmentIds` (`:114`) + `:617-618` («client PHẢI gửi lại `fileId` của MỌI phần tử `attachments`, kể cả `url: null`»);
  `C/social-ws.spec.ts` U-3. API-19: §6.1 (`:476-488`) thêm câu «`fileName`/`sizeBytes` = `null` khi `url` = `null`» + câu luật hợp
  đồng D-2; §7 (`:640-650`) thêm gạch «đính kèm trên WS:
  `fileName`/`sizeBytes` LUÔN `null`, giữ khoá». API-19 vốn lệch prettier — chỉ sửa dòng của mình. Build contracts + typecheck api/app
  (app phải xanh KHÔNG sửa FE). Commit `docs/feat(contracts)` theo nội dung.
- **L4 mutant** — 8 mutant §6 bằng script giữ ở thư mục kept (không vào repo), cây sạch sau mỗi lượt; kỳ vọng 8/8 bị giết đúng ca.
- **FULL gate** (song song, chỉ đọc, có trần lượt): `security-reviewer` (câu hỏi: còn đường trả metadata tệp SOCIAL nào không qua
  `decorateMany`? phần lộ còn lại của D-2 trên REST + WS có chấp nhận được? — câu hỏi phạm vi ngoài SOCIAL truyền qua prompt của gate,
  không ghi vào tệp trong repo) + `silent-failure-hunter` (D-1: mọi `null` đều có log tương xứng chưa?) + `typescript-reviewer` +
  `quality-gate` (kèm kiểm ngưỡng coverage L2).
  `database-reviewer`: **N/A — lệch có chủ ý** khỏi danh sách FULL gate CLAUDE.md §6, diff không chạm SQL/repository/migration; ghi vào PR.
  **santa-method MẶC ĐỊNH CHẠY** một vòng có trần (đường lộ dữ liệu, vùng đỏ): hội tụ trên ba mệnh đề — «một vị từ `url === null`» ·
  «không đường đọc `FeedAttachmentDto` thứ hai» · «WS không mang tên/cỡ ở cả hai tầng, tập khoá không đổi».
- **Vá** CRITICAL/HIGH; MEDIUM rẻ thì sửa, còn lại thành nợ có WO.
- **Verify** (luồng chính): `bash harness/check.sh --all --lane-db=attmeta` + gitleaks trên net diff nhánh so với `origin/master`.
- **PR** — tiêu đề trung tính «fix(social): S16-SOCIAL-ATTMETAMASK-1 — metadata đính kèm trên các đường đọc SOCIAL theo đúng quyết
  định ký URL cho người xem; WS không mang tên/cỡ tệp»; body: bất biến (phạm vi SOCIAL) + phép đo + bảng ca, mục [OWNER] ở đầu; KHÔNG
  nêu O6; KHÔNG tự merge. Body chỉ khẳng định «ẩn trên các đường đọc SOCIAL (REST + WS)», KHÔNG viết «metadata đính kèm đã ẩn
  hoàn toàn»; ghi rằng gate FULL phải chạy với `LANE_DB` (`REQUIRE_LANE_DB=1`) vì int-spec là `skipIf(!LANE_DB)` (gate FULL 18/10).

## 8. Bảng [OWNER]

| #   | Việc / câu hỏi                                                                                                                                                                                    | Mặc định nếu không trả lời                                | Chặn?              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------ |
| O1  | Merge `--admin` rồi deploy API **ngay trong ngày**: pull `--ff-only` checkout chính → `m prod-update api` (WO không đổi deps)                                                                     | Bắt buộc — merge mà chưa deploy = công bố khi PROD còn hở | **Có** (sau merge) |
| O2  | Thứ tự: WO này lên PROD **TRƯỚC** khi merge #580 (FE-2D lát A)                                                                                                                                    | Bắt buộc — #580 giữ chờ tới khi O1 đo xong                | **Có**             |
| O3  | Rà luật metadata đính kèm của CHAT theo cùng bất biến §3? Chi tiết đo đi kênh owner, lời seed trong backlog trung tính                                                                            | Ghi nợ §9, chưa seed — owner quyết                        | Không              |
| O4  | Chấp nhận phần còn lộ của D-2: `fileId` · `kind` · số lượng tệp trên REST VÀ WS (phát cho cả room)? Đổi sang VẮNG = chấp nhận rủi ro mất đính kèm khi có màn sửa                                  | Chấp nhận D-2 (giữ phần tử)                               | Không              |
| O5  | Bỏ `santa-method`?                                                                                                                                                                                | KHÔNG bỏ                                                  | Không              |
| O6  | Seed WO đỏ riêng rà các cửa metadata tệp ngoài SOCIAL (FOUNDATION) theo cùng bất biến §3, kèm int-spec deny-path; owner chốt thứ tự. Chi tiết đo đi kênh owner, lời seed trong backlog trung tính | Chưa seed — owner quyết                                   | Không (ngoài diff) |

**Bằng chứng deploy (đo, không tin lời «đã deploy»).** Không migration ⇒ `migrationHead` không đổi; dùng tem build.

- **Chính:** (a) `git rev-parse HEAD` của checkout chính = SHA merge; (b) grep `apps/api/dist/social/social-attachments.service.js` thấy
  `toFeedAttachmentDto` và grep `apps/api/dist/social/social-ws-payload.js` thấy `wsAttachmentsOf` (hiện trạng: cả hai ×0); (c)
  `GET /api/v1/health` trả `build.commit` = SHA merge (⇒ tiến trình đã khởi động lại bằng bản mới).
- **Phụ:** tầng schema WS nằm ở dist của contracts — nếu `m prod-update api` không build lại contracts thì tầng nguồn (b) vẫn che; ghi
  lại việc contracts có được build lại không, không coi là chặn.
- **Tuỳ chọn:** tài khoản sẵn có mở một bài có ảnh — ảnh vẫn hiện (chiều CHO PHÉP không hồi quy). Chiều TỪ CHỐI đã đo trên lane.

## 9. Ngoài phạm vi / nợ · rủi ro + đường lùi

- Ngoài phạm vi: sửa FE (done_when #3 — `splitAttachments`/`buildImageGrid` giữ lọc `url !== null` làm lưới thứ hai); ẩn sự tồn tại
  phần tử (D4 ở client); tách `S/social-posts.service.ts` (POSTSSPLIT); CHAT (O3); các cửa metadata tệp FOUNDATION (O6).
- Nợ cần ghi khi rebase #580: câu ở plan FE-2D §3 «ẩn `url:null` là ở CLIENT cho tới khi WO này xong» ⇒ cập nhật thành đã có lưới server.
- Nợ FE (luật hợp đồng D-2): FE lọc `url: null` khi vẽ (`feed-format.ts:87` master · `:144` #580). Mọi WO thêm màn SỬA đính kèm
  bài/bình luận PHẢI có test FE: `attachmentIds` gửi lại `fileId` của MỌI phần tử, kể cả `url: null`, không dựng từ danh sách đang vẽ.
  Gate FULL 18/10 (silent-failure F2): điều kiện bắt buộc của WO đó = một hàm chung dựng allowlist từ `post.attachments` (KHÔNG lọc theo
  `url`) kèm test. KHÔNG thêm 422 ở server cho «allowlist làm mất link mà người sửa không ký được»: gỡ đính kèm khi không có quyền gắn
  là quyền kiểm duyệt đã chốt (S16-SOCIAL-ATTGATE-1 D-1, unit «DENY + KHÔNG tệp mới ⇒ KHÔNG ném»).
- Nợ gate FULL 18/10 (LOW, không chặn — đều có sẵn từ trước diff hoặc là phòng thủ thêm):
  - FE: phần tử `url: null` hiện vẽ thành «không có gì», tệp không phải ảnh không hiện. Nên có dòng đếm «N tệp không xem được» (không
    kèm tên) + test `PostCard.spec` — gộp vào WO FE kế tiếp của feed (silent-failure F3).
  - Emitter: lỗi parse của sự kiện bình luận ghi `warn`, của bài ghi `error` — nâng lỗi PARSE của `emitToFeed` lên `error` (giữ `warn`
    cho lỗi mạng) + ca emitter ép payload sai hình dạng (silent-failure F4, `realtime-emitter.service.ts`).
  - Structure-spec: `stripComments` cắt phần dòng sau `//` không đứng sau `:` (vd. trong chuỗi) ⇒ có thể bỏ sót một lối đọc cùng dòng.
    S-1c/S-1e đã chặt hơn (vá trong gate); bộ tách token thật để lại (silent-failure F5 phần còn lại).
  - Int-spec: R-5 và R-7 chung bài `postQ` (hôm nay không phụ thuộc thứ tự); ca GHI mới trên bài đó phải gieo bài riêng (typescript F2).
  - Structure-spec S-1c vẫn là lưới regex: chưa bắt `query.files` (drizzle relational), alias import bảng `files`, SQL thô
    `select * from files` — hôm nay không tệp SOCIAL nào dùng các dạng đó; thêm regex hoặc chuyển sang quét AST khi tách POSTSSPLIT
    (review hẹp vòng 2, SEC-R2-2).
- Rủi ro: (a) bốn [SUY RA] của fixture §6 — đo ở L1, có đường lùi ghi sẵn; (b) storage sập ⇒ người được phép mất tên tệp (D-1, giao diện
  vốn ẩn); (c) cửa sổ merge→deploy — O1; (d) #580 merge trước O1 ⇒ UI mới chạy trên BE còn lộ — O2.
- Đường lùi: revert commit `fix(social)` (+ contracts) ⇒ `m prod-update api`; dữ liệu không đổi, hình dạng DTO không đổi.

### 9.3 Sổ vết

| Bước              | Ngày       | Kết quả                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1           | 18/10/2026 | Trên `0bb31eeb`. Chốt D-1 (một vị từ `url === null`) · D-2 (giữ phần tử, che hai trường) · D-3 (WS giữ khoá, `null` hai tầng) · D-4 (không L0).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Plan-review       | 18/10/2026 | PASS_WITH_FIXES, 8 finding đều đối chiếu mã. Áp: F1 (phạm vi bất biến/tiêu đề/PR thu về đường đọc SOCIAL · O6 · R-8 dùng actor `fileViewer`, bỏ câu kết luận) · F2 (bỏ câu hỏi phạm vi ngoài SOCIAL khỏi §7, chuyển qua prompt gate + kênh owner) · F3 (luật hợp đồng D-2 vào L3 + nợ FE §9) · F4 ([SUY RA] thứ tư + đường lùi) · F6 (`quality-gate` + ngưỡng coverage 80%) · F7 (`social-qa1-kit.ts:66` có `view:foundation-file`) · F8 (O4 nêu REST VÀ WS). F5 đúng MỘT PHẦN: khoá lưu trữ không mang tên tệp (`apps/api/src/storage/file-storage-key.ts:64`, `storage-key.ts:22`) ⇒ không đổi log; nới lời D-1 + thêm assert vào R-6. Không cần L0 (mọi tệp mới nhắc tới nằm trong `paths`). |
| Plan (gộp)        | 18/10/2026 | Ba commit plan (v1 · vá plan-review · vá gate) gộp thành `58129e29` trước khi push — lịch sử nhánh chỉ còn bản trung tính cuối.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| L1 RED            | 18/10/2026 | `4d6cce91`. Lane `mediaos_attmeta`, mã CŨ: 8 ca int-spec đỏ đúng lý do (`fileName: expected '…' to be null`) — R-1 003 · R-2 001 · R-3 014 · R-4 020 · R-5 006 · R-6 lỗi kho lưu trữ · QA1-W-1/W-2 trên dây; unit U-1 ×3 · U-2 ×3 · structure S-1a/S-1b/S-1d ×4 đỏ. Xanh như kỳ vọng: R-1a (ALLOW) · R-7 (neo D-2) · R-8 (neo cửa theo id).                                                                                                                                                                                                                                                                                                                                                     |
| L2 GREEN          | 18/10/2026 | `eeeb3a41`. 6 int-spec trên lane 100/100; unit `src/social` + `src/realtime` 893 ca; spec mới 33/33; typecheck + eslint + prettier sạch. Coverage `social-attachments.service.ts`: Branch 78,49 → 81 % · Lines 94,1 → 94,2 %.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| L3                | 18/10/2026 | `1243df86`. `wsFeedAttachmentSchema` `.transform` null · docblock luật D-2 · API-19 §6.1/§7. Contracts 743/743; typecheck api + app sạch (FE không đổi).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| L4 mutant         | 18/10/2026 | 9/9 bị giết, khớp plan (★1–★8 + ★8′); script ngoài repo. Chạy lại sau vá gate: 9/9, cây sạch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Gate FULL + santa | 18/10/2026 | security PASS_WITH_FINDINGS · silent-failure PASS_WITH_FINDINGS · typescript PASS · santa A PASS_WITH_FINDINGS · santa B PASS ⇒ không BLOCK, santa hội tụ vòng 1. Vá `c746043b` (log lỗi resolver khoá bằng unit · URL rỗng/không phải chuỗi vẫn che · S-1c/S-1e chặt hơn), mỗi vá có RED đo thật; LOW + finding ngoài diff ⇒ §9 / kênh owner. Review hẹp vòng 2: không BLOCK (một LOW ⇒ §9).                                                                                                                                                                                                                                                                                                   |
| Verify            | 18/10/2026 | `check.sh --all --lane-db=attmeta`: 8/9 xanh; test api 855/855 file chạy, 1 ĐỎ THẬT = `social-be2c-group-fanout` W2 ghim hành vi cũ (WS room nhóm = REST trừ `url`) — plan sót spec này. Cập nhật theo D-3 ở `f9c5bf19` ⇒ spec 10/10 trên lane; app 398 · auth 4 · console 22 · contracts 45 · ui 24 · web-core 50 tệp xanh. gitleaks v8.30.1 trên nhánh: không leak.                                                                                                                                                                                                                                                                                                                           |
| PR + deploy       | 19/10/2026 | #591 mở 18/10 13:17 (CI xanh; `update-branch` 19/10 sau commit seed `c4ba1813`) · owner merge `--admin` 12:33:43 = `d5bd37e8` · checkout chính ff lên SHA merge · owner `m prod-update api` · ĐO 12:38: dist `build-info` `d5bd37e8` · `toFeedAttachmentDto` ×3 · `wsAttachmentsOf` ×3 · contracts dist build lại (tầng `.transform`) · `/health` build.commit `d5bd37e8` · `/health/db` 200 ⇒ PROD vá ≈ 4 phút sau merge. Lane DROP, nhánh xoá. Lỗ ngoài diff (O6) đã gieo thành WO riêng.                                                                                                                                                                                                     |
