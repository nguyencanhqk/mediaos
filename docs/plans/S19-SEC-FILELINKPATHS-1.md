# S19-SEC-FILELINKPATHS-1 — các đường ghi liên kết tệp ngoài lõi gắn chung theo cùng quyết định xem từng tệp

> Plan v1 · 23/10/2026 · mã đo trên `c687b55d` · worktree `MediaOS-flp` nhánh `fix/s19-sec-filelinkpaths-1` · lane `mediaos_flp` ·
> 🔴 FULL gate + santa ×2. Số đo chi tiết (bảng đường ghi, ví dụ cụ thể) ở kênh owner ngoài repo — repo PUBLIC, plan chỉ ghi bất biến
> và phép đo tổng hợp. Viết tắt: `F/` = `apps/api/src/foundation/files/` · `S/` = `apps/api/src/` · `T/` = `apps/api/test/`.
> [ĐO] = đã đọc mã ở `c687b55d` · [SUY RA] = suy từ mã, lát thi công đo.

## 1. Bối cảnh + quyết định owner

- WO: `harness/backlog.mjs` mục `S19-SEC-FILELINKPATHS-1`. Mẹ: `docs/plans/S19-SEC-FILELINKGATE-1.md` (#595) — dựng biên gắn chung
  `FileService.checkLink` + `F/file-access-decision.ts`; §9 N1 gieo WO này. Đầu vào quyết định chung: `S19-SEC-FILEMETAGATE-1.md` (#594).
- **Bất biến đích:** mọi đường tạo một hàng `file_links` cho tệp X (do người dùng chọn) chỉ ghi khi quyết định XEM của chính người gắn trên
  X là ALLOW — cùng một hàm với biên gắn chung và `GET /foundation/files/:id`; điều kiện riêng của module (chủ tệp, trạng thái, ảnh…) giữ
  nguyên và AND thêm, không thay.
- Owner chốt 23/10/2026 (phiếu đợt 23/10, phương án khuyến nghị — không mở lại):
  - **LP-1** chuyển 3 đường gắn (đính kèm tin CHAT · ảnh phòng CHAT · avatar NV do HR đặt) về hàm quyết định chung «người gắn xem được
    tệp»; đường đính kèm SOCIAL đổi sang hàm thuần chung, KHÔNG đổi hành vi.
  - **LP-2** chấp nhận đổi hành vi CHAT cho khớp vị từ lõi: từ chối ⇒ 403 `CHAT-ERR-015`.
  - **LP-3** tệp do server sinh (PDF/ZIP phiếu lương) giữ ngoài lõi có chủ đích — ghi lý do (D-9).
  - Thứ tự: WO này làm TRƯỚC, dựng hàm chung mà `S19-SEC-FILEPOINTER-1` dùng lại; `S19-SEC-FILELINKPARAMS-1` chạy sau (cùng `F/`).
- Song song: chuỗi `S17-CHAT-RTROOMOPS-1` sửa `S/realtime/**` + docs API CHAT — WO này KHÔNG chạm hai chỗ đó.

## 2. Số đo [ĐO]

### 2.1 Lõi gắn chung

- `F/files.service.ts:626-647` `checkLink`: (1) cặp đích đăng ký (400) → (2) `policy.canLink` (403) → (3) `loadFileAccessContext` hàng +
  `{live, everLinked}` một ảnh chụp (`:921-929`, `:931-940`) → (4) `decideLinkAccess` (`F/file-access-decision.ts:87-99`) → (5)
  `assertLinkableFile` (`F/file-link-guard.ts:67-75`). Chạy NGOÀI tx: resolver tự mở `withTenant` (`F/files.service.ts:620-625`).
- `link()` `F/files.service.ts:539-570`: tx ghi khoá hàng tệp `findByIdForUpdateTx` (`F/file.repository.ts:101`) → đọc lại ảnh chụp →
  `assertSameLinkSnapshot` (`F/file-link-guard.ts:81-97`, lệch ⇒ 409 `FOUNDATION-FILE-ERR-LINK`).
- Log từ chối: `logLinkDeny` `:649-666` → `logDeny` `:964-1000` (tx riêng; chỉ ghi khi hàng tệp có trong công ty). Không log cho bước (3)
  vắng hàng và bước (5).
- Vế chủ `isOwnerOfUnlinkedFile` `F/file-access-decision.ts:37-45` — chưa export. Gom liên kết theo tệp `groupLinksByFile`
  `F/file-list.service.ts:129-138` — chưa export.
- `F/files.service.ts` = 1000 dòng (> 800) ⇒ WO này không làm dài thêm (ratchet `wc -l` ≤ 1000).

### 2.2 Các đường ghi liên kết ngoài lõi

| #   | Đường                                       | Ghi ở                                                                                             | Đang hỏi trước khi gắn                                | Hỏi quyết định xem của lõi?            |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------- |
| L1  | `POST /chat/rooms/:id/messages` (`fileIds`) | `S/chat/chat-messages.service.ts:150` `resolveAttachments` `:418-434` → `:449-476` (trong tx gửi) | thành viên · chủ tệp · `Uploaded` · không Infected    | KHÔNG                                  |
| L2  | `POST /chat/rooms/:id/avatar`               | `S/chat/chat-room-avatar.service.ts:142-172`, kiểm `:324-343`, ghi `:383-`                        | tư cách đặt ảnh · chủ tệp · trạng thái · ảnh          | KHÔNG                                  |
| L3  | `POST /hr/employees/:id/avatar`             | `S/employees/hr-employee-avatar.service.ts:144-187`, kiểm `:196-231`, ghi `:298-`                 | scope ghi Company/System · chủ tệp · trạng thái · ảnh | KHÔNG                                  |
| L4  | đính kèm SOCIAL (bài · bình luận)           | `S/social/social-attachments.service.ts:296-327` (vế 5 `:319-327`), ghi `:447`                    | chủ · `Uploaded` · scan · cỡ · chưa từng có liên kết  | tương đương vế chủ, viết lại SQL riêng |
| L5  | tệp hệ thống sinh (PAYROLL xuất)            | `F/server-file.repository.ts:50-84`                                                               | tệp tạo trong cùng tx, chủ = người gọi, tạm           | không áp dụng (D-9)                    |

- Khoá hàng [ĐO]: `assertMember` là `SELECT` thường (`S/chat/chat-messages.repository.ts:447`); `allocateRoomSeq` ghi hàng phòng; ảnh
  phòng khoá phòng `FOR UPDATE` (`S/chat/chat-room-avatar.repository.ts:55`); HR khoá NV `findForAvatarUpdateTx` (`:164`).
- Resolver XEM: tin CHAT = thành viên + mốc nhìn thấy (`S/chat/chat-message-file.resolver.ts:87,152`); ảnh phòng = thành viên
  (`S/chat/chat-room-avatar-file.resolver.ts:52,102`); avatar NV = chính NV đó (`S/me/me-avatar-file.resolver.ts:34,72`).
- Module: `ChatModule`, `SocialModule` đã import `FilesModule` (export `FileService` · `FileRepository` · `FileLinkRepository`) ⇒ không
  đổi `*.module.ts` [ĐO `chat.module.ts:115`, `social.module.ts:94`].
- FE [ĐO]: composer CHAT tải tệp MỚI mỗi lần (`apps/app/src/components/chat/chat-upload.ts`), lỗi gửi ⇒ bong bóng `failed` + nút gửi
  lại (`use-chat-conversation.ts:172-177`, không nuốt im). Ảnh phòng hiện lỗi (`RoomAvatarEditor.tsx:107,116`). HR hiện lỗi chung
  (`EmployeeDetailPage.tsx:168-171`). Luồng FE bình thường dùng tệp vừa tải (chưa từng gắn) ⇒ vế chủ ⇒ không đổi trải nghiệm.

## 3. Quyết định

- **D-1 (H1) Hàm chung = bước (3)–(5) của `checkLink`, KHÔNG gồm (1)–(2).** Tệp mới `F/file-linker-view.ts`:
  ```ts
  type LinkerViewOutcome =
    | { kind: "allow"; row: FileRecord; ctx: FileAccessContext }
    | { kind: "missing" }                               // RLS 0 hàng / không tồn tại
    | { kind: "forbidden"; reason: string; action: FileAccessAction }
    | { kind: "unlinkable"; row: FileRecord };          // Infected | tệp tạm — SAU quyết định xem
  function decideLinkerViewFromSnapshot(policy, actor, row | undefined, ctx): Promise<LinkerViewOutcome>
  ```
  `FileService` (public): `decideLinkerView(actor: FileDecisionActor, fileId)` — chỉ đọc (một ảnh chụp `loadFileAccessContext` +
  `decideLinkAccess`); `preflightLinkerView(actor, fileId, logTarget)` = `decideLinkerView` + log từ chối cho `forbidden` (đúng hành vi
  `logLinkDeny` hiện tại, `logTarget = {moduleCode, entityType, entityId?}`). `checkLink` = (1)–(2) rồi gọi `preflightLinkerView` và ánh
  xạ về ĐÚNG lỗi hiện tại (`missing` ⇒ `linkFileMissing` 400 · `forbidden` ⇒ `fileForbidden` 403 · `unlinkable` ⇒ `assertLinkableFile`
  400). Lý do: một nguồn quyết định cho lõi + L1–L3 + FILEPOINTER; trả giá trị (không ném) để mỗi module giữ mã lỗi của route mình.
- **D-2 Ngoài tx + so lại trong tx (như lõi).** Quyết định chạy NGOÀI tx ghi của module (resolver mở `withTenant` riêng, lồng sẽ treo
  PgBouncer transaction-mode — `S/chat/chat-messages.service.ts:439-441`). Trong tx ghi: `FileService.recheckLinkerViewTx(companyId,
fileId, decided, tx)` = `findByIdForUpdateTx` + đọc lại ảnh chụp + `assertSameLinkSnapshot` (409 `FOUNDATION-FILE-ERR-LINK`, không mã
  mới); trả hàng hoặc `undefined`. `link()` của lõi dùng chính hàm này (thay 3 dòng `:543-549`).
- **D-3 Thứ tự khoá: tệp TRƯỚC thực thể.** L2: `recheckLinkerViewTx` đứng trước `assertCanSetAvatarTx` trong tx atomic; L3: trước
  `findForAvatarUpdateTx`; L1: trong `resolveAttachments` (trước `allocateRoomSeq`), khoá theo thứ tự id đã sắp (nhiều tệp). Lý do: một trật
  tự toàn cục tệp → phòng/NV, tránh deadlock khi gửi tin và đổi ảnh phòng cùng tệp cùng lúc.
- **D-4 (H2) L1 CHAT tin.** Khi `fileIds` không rỗng: (a) tx ngắn `assertMember` + chặn phòng lưu trữ (giữ thứ tự lỗi: ngoài phòng 404,
  lưu trữ 409 đứng TRƯỚC lỗi tệp) → (b) `preflightLinkerView` từng tệp đã khử trùng (`logTarget` = CHAT/message, không `entityId` — tin
  chưa có) → mọi kết quả khác `allow` ⇒ 403 `CHAT_ERR.ATTACHMENT_INVALID` (một thông điệp, không oracle) → (c) tx gửi như cũ; trong
  `resolveAttachments` thêm `recheckLinkerViewTx` từng tệp (hàng vắng ⇒ 403 cùng mã). Tất-cả-hoặc-không: một tệp từ chối ⇒ 0 tin, 0 liên
  kết. Kiểm riêng của CHAT (`findOwnedFiles` + `isAttachableFile`) giữ nguyên.
- **D-5 (H2) L2 ảnh phòng.** Sau `confirmAndValidateOwnImageTx` (giữ nguyên), gọi `preflightLinkerView` (`logTarget` = CHAT/room-avatar,
  `roomId`) ⇒ khác `allow` ⇒ 403 `CHAT_ERR.ROOM_AVATAR_FILE_INVALID` (`CHAT-ERR-015`). Tx atomic: recheck (D-3) rồi như cũ.
- **D-6 (H2) L3 avatar NV do HR.** Sau `confirmAndValidateOwnImageFile` (giữ nguyên thứ tự + mã lỗi hiện có), gọi `preflightLinkerView`
  (`logTarget` = cặp avatar NV, `employeeId`) ⇒ khác `allow` ⇒ 403 `AUTH-ERR-FORBIDDEN` (mã route đang dùng cho «tệp không thuộc người
  gọi»). Tx atomic: recheck trước khoá NV. Từ chối xảy ra TRƯỚC khi gỡ liên kết cũ ⇒ avatar hiện hành giữ nguyên.
- **D-7 Đổi hành vi được chấp nhận (LP-2, ghim bằng ca test):** tệp «đã từng gắn, 0 liên kết sống» và tệp có liên kết sống mà người gắn
  không còn xem được ⇒ từ chối ở L1–L3, kể cả chủ tệp. Hệ quả L3 [SUY RA từ resolver avatar NV]: HR đặt LẠI đúng tệp đang là avatar của
  NV đó ⇒ 403 (HR không phải NV chủ ảnh); FE luôn tải tệp mới nên không chạm. Không thêm nhánh no-op (KISS) — ghi rủi ro R-3.
- **D-8 (H3) L4 SOCIAL — hàm thuần chung, không đổi hành vi.** Export `isOwnerOfUnlinkedFile` (`F/file-access-decision.ts`) + chuyển
  `groupLinksByFile` sang `F/file-link-context.ts` (export, `file-list.service.ts` dùng lại). Vế 5 (`:319-327`) đổi thành:
  `FileLinkRepository.listAllByFileIdsTx` (cùng vị từ SQL: công ty + id, không lọc `deleted_at` — `F/file-link.repository.ts:65-75`) →
  `groupLinksByFile` → tệp nào `!isOwnerOfUnlinkedFile` ⇒ 422 `SOCIAL-ERR-007`, đúng vị trí cũ (sau kiểm cỡ). Tương đương [SUY RA]: vế 2
  đã ép chủ ⇒ hàm thuần chỉ còn «chưa từng có liên kết» = điều kiện cũ. KHÔNG dùng `decideFileAccess` (sẽ mở nhánh AND trên liên kết sống
  = nới lỏng + gọi resolver trong tx). Nếu ca hồi quy SOCIAL đỏ ⇒ giữ SQL cũ, ghi lý do §9.3.
- **D-9 (H4) L5 giữ ngoài lõi có chủ đích.** `F/server-file.repository.ts` tạo hàng `files` MỚI trong cùng tx với liên kết, chủ = người
  gọi, tệp tạm — không có tệp người dùng chọn để quyết định «xem được»; quyền thuộc quyền xuất của PAYROLL ở nơi gọi. Không sửa.
- **D-10 Ratchet đường ghi.** Unit census `T/foundation/file-link-writers.census.unit-spec.ts`: quét `S/**/*.ts` (trừ spec) tìm
  `insert(fileLinks)` và `insertTx(` trên kho liên kết; tập tệp ghi phải bằng danh sách phân loại {lõi · L1 · L2 · L3 · L4 · L5-miễn}; L1–L3
  phải chứa `preflightLinkerView(` + `recheckLinkerViewTx(`, L4 chứa `isOwnerOfUnlinkedFile(`. Đường ghi mới ⇒ đỏ tới khi phân loại.
- **D-11 (H7) Không migration · không đổi contracts · không đổi FE.** `F/files.service.ts` không dài thêm: dời `readLinkContextTx` +
  `loadFileAccessContext` sang `F/file-link-context.ts` (hàm nhận repo). Gate FULL: security · silent-failure · typescript · database
  (đổi truy vấn SOCIAL + khoá hàng) · santa ×2.
- **D-12 (H6)** Repo public: commit/PR/spec trung tính (bất biến + phép đo); merge = công bố ⇒ owner deploy API trong ngày merge.

## 6. Ca test (int-spec MỚI `T/integration/s19-sec-filelinkpaths-1.int-spec.ts`, dựng qua `applyMainPipeline` như `s19-sec-filelinkgate-1`)

Fixture «đã từng gắn, 0 sống» dựng bằng API: gửi tệp trong tin rồi thu hồi tin (gỡ liên kết) · đặt ảnh phòng/avatar rồi gỡ. Mỗi ca DENY
đếm `file_links` theo tệp trước/sau (Δ = 0) + trạng thái thực thể không đổi.

| Ca      | Đường · actor                         | Tệp                                             | Kỳ vọng                                                                | Mã cũ |
| ------- | ------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| P1-D1   | L1 · U gửi vào phòng A                | của U, đã từng gắn, 0 sống                      | 403 `CHAT-ERR-015` · Δliên kết 0 · 0 tin mới · seq phòng giữ           | ĐỎ    |
| P1-D2   | L1 · U                                | của U, sống ở tin phòng B mà U đã rời           | 403 · Δ0                                                               | ĐỎ    |
| P1-D3   | L1 · U, `[mới, P1-D1]`                | lô trộn                                         | 403 · Δ0 cho CẢ HAI tệp (không gửi một phần)                           | ĐỎ    |
| P1-A1   | L1 · U                                | mới tải, chưa gắn                               | 201 · +1 liên kết                                                      | XANH  |
| P1-A2   | L1 · U                                | của U, sống ở tin phòng A (U còn là thành viên) | 201 · +1                                                               | XANH  |
| P1-A3   | L1 · U gửi lại cùng `clientMessageId` | như P1-A1                                       | cùng tin · tổng liên kết không đổi                                     | XANH  |
| P1-O ★  | L1 · người ngoài phòng X              | P1-D1                                           | lỗi thành viên như hiện tại (404 [SUY RA]) — đứng trước lỗi tệp (D-4a) | XANH  |
| P2-D1   | L2 · U đặt ảnh phòng A                | ảnh của U, từng là ảnh phòng rồi gỡ             | 403 `CHAT-ERR-015` · Δ0 · `avatar_file_id` giữ                         | ĐỎ    |
| P2-D2   | L2 · U                                | ảnh của U, sống ở tin phòng B U đã rời          | 403 · Δ0                                                               | ĐỎ    |
| P2-A1/2 | L2 · U                                | ảnh mới · đặt lại đúng ảnh đang dùng            | 200 · liên kết ảnh phòng = 1 sống                                      | XANH  |
| P3-D1   | L3 · HR đặt cho NV2                   | ảnh của HR đang là avatar sống của NV1          | 403 `AUTH-ERR-FORBIDDEN` · Δ0 · cột NV2 giữ · liên kết NV1 sống        | ĐỎ    |
| P3-D2   | L3 · HR cho NV1                       | ảnh của HR, từng là avatar NV1 rồi gỡ           | 403 · Δ0                                                               | ĐỎ    |
| P3-R ★  | L3 · HR đặt lại cho NV1               | ảnh đang là avatar sống của NV1                 | 403 · liên kết cũ GIỮ sống (D-7, ghim đổi hành vi)                     | ĐỎ    |
| P3-A1   | L3 · HR                               | ảnh mới                                         | 200 · liên kết mới sống, liên kết cũ gỡ (thay thế như cũ)              | XANH  |

- Hồi quy SOCIAL (H3, không đổi tệp spec): `T/integration/social-be1-attachments.int-spec.ts` (DENY tệp người khác `:169` · ALLOW `:187` ·
  DENY đã từng gắn `:202`) + `social-attgate-1-update-attach.int-spec.ts` + `S/social/social-attachments.service.spec.ts` — xanh trước và
  sau. Thêm ca unit: tệp của chính người gọi đang có liên kết SỐNG mà người gọi xem được ⇒ vẫn 422 (giết mutant M9).
- Hồi quy lõi: `F/files.service.link-gate.spec.ts` · `F/file-access-decision.spec.ts` · `T/integration/s19-sec-filelinkgate-1.int-spec.ts`
  · `F/file-access-hardening.int.spec.ts` — xanh, không đổi kỳ vọng.
- Hồi quy module: `chat-be3-attachments` · `chat-be2-messages` · `chat-s8-be2-room-avatar` · `hr-employee-avatar` · `s19-hr-avatarwrite-1`
  · `chat-qa1-acceptance` (≤ 3 tệp/lượt). Ca nào đỏ: thuộc đúng lớp D-7 ⇒ sửa kỳ vọng kèm mã WO; khác lớp ⇒ lỗi, sửa mã.
- Unit mới `F/files.service.linker-view.spec.ts`: 4 loại kết quả · log từ chối CHỈ cho `forbidden` (một dòng `Link` + mã quyền
  `FOUNDATION.FILE.VIEW|DOWNLOAD`) · `recheckLinkerViewTx` gọi `findByIdForUpdateTx` (ghim mệnh đề khoá) · lệch ảnh chụp ⇒ 409. Unit
  service hiện có đổi khởi tạo (thêm `FileService` mock): `S/chat/*.spec.ts` liên quan · `hr-employee-avatar.service.spec.ts`.
- Census D-10 đỏ trên mã cũ (L1–L3 chưa gọi hàm chung).

**Mutant ★** (mỗi cái một lượt, cây sạch sau mỗi lượt): M1 bỏ preflight L1 · M2 bỏ L2 · M3 bỏ L3 · M4 coi `forbidden` là cho phép · M5
`recheck` dùng `findByIdTx` (bỏ khoá) · M6 bỏ `assertSameLinkSnapshot` trong recheck · M7 L1 gắn phần tệp được phép (gửi một phần) · M8 bỏ
tx ngắn thành viên ở L1 · M9 vế 5 SOCIAL dùng `decideFileAccess` · M10 bỏ log từ chối `forbidden` · M11 HR preflight đặt SAU gỡ liên kết
cũ ngoài tx · M12 `checkLink` ánh xạ `unlinkable` thành 403 (đổi mã lõi). Tiêu chí: 12/12 chết.

## 7. Lát thi công

| Lát | Việc                                                                                                                                                        | Đo / xong khi                                                                |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| L0  | `paths` mở ở master `c687b55d` (5 glob)                                                                                                                     | ĐÃ XONG                                                                      |
| L1  | RED: int-spec §6 + unit linker-view + census D-10; chạy trên mã cũ qua wrapper khoá chung (lane `mediaos_flp`)                                              | các ca «ĐỎ» đỏ đúng lý do, «XANH» xanh; ghi số §9.3; commit `test(files): …` |
| L2  | Lõi: `F/file-link-context.ts` · `F/file-linker-view.ts` · `decideLinkerView`/`preflightLinkerView`/`recheckLinkerViewTx`; `checkLink` + `link()` dùng chúng | unit lõi + `s19-sec-filelinkgate-1` xanh · `wc -l F/files.service.ts` ≤ 1000 |
| L3  | L1 CHAT tin (D-4)                                                                                                                                           | P1-\* xanh · chat-be3/be2 xanh                                               |
| L4  | L2 ảnh phòng (D-5)                                                                                                                                          | P2-\* xanh · chat-s8-be2-room-avatar xanh                                    |
| L5  | L3 HR (D-6)                                                                                                                                                 | P3-\* xanh · hr-employee-avatar + s19-hr-avatarwrite-1 xanh                  |
| L6  | L4 SOCIAL (D-8) + `groupLinksByFile` dùng chung                                                                                                             | social-be1 + attgate + unit SOCIAL + file-list xanh                          |
| L7  | Mutant §6 · `T/foundation/pipeline-parity.unit-spec.ts` · typecheck api · eslint tệp đã sửa                                                                 | 12/12 chết · xanh                                                            |
| L8  | Gate FULL (security · silent-failure · typescript · database) + santa ×2; vá; `bash harness/check.sh --all --lane-db=flp`                                   | PASS · «XANH» đủ bằng chứng (luồng chính mở PR)                              |

## 8. [OWNER]

| #   | Việc                                                                                                                                                                            | Chốt                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| W-1 | Duyệt chạy tới PR (không merge/deploy trong chuỗi)                                                                                                                              | Đã chọn 23/10 ~09:25 (A+B+C+D+E) |
| W-2 | Merge `--admin` ⇒ deploy API trong ngày (`m prod-update api`); không migration/contracts/FE ⇒ không cửa sổ thứ tự                                                               | Sau PR                           |
| W-3 | Đo sau deploy: `/health` build.commit = SHA merge · gửi tin kèm tệp mới 201 · đặt ảnh phòng bằng ảnh mới 200 · HR đặt avatar bằng ảnh mới 200 · đăng bài SOCIAL kèm ảnh mới 201 | Sau deploy                       |
| W-4 | Đường lùi: `m prod-rollback` API (không đổi schema)                                                                                                                             | Khi cần                          |

## 9. Ngoài phạm vi · nợ · rủi ro

- Ngoài phạm vi: con trỏ tệp không qua liên kết (`S19-SEC-FILEPOINTER-1`, dùng lại D-1) · tham số liên kết ở route FOUNDATION
  (`S19-SEC-FILELINKPARAMS-1`) · `S/realtime/**` · `apps/app` · docs API CHAT.
- Nợ (luồng chính gieo sau merge, tiêu đề trung tính): N1 FE hiện lỗi chung (bong bóng «gửi lỗi» CHAT · HR «tải ảnh lỗi») — không nuốt
  im, không cần sửa ở WO này · N2 thông điệp `CHAT-ERR-015` chưa nêu điều kiện mới (cố ý một thông điệp) — cập nhật docs API CHAT sau khi
  chuỗi RTROOMOPS xong · N3 `F/files.service.ts` vẫn > 800 dòng (FILEDEBT).
- Rủi ro: R-1 TOCTOU như lõi — so lại ảnh chụp liên kết, không so lại phán quyết resolver (chấp nhận theo O-9 của WO mẹ) · R-2 L1 tốn thêm
  ≤ 10 lần quyết định/tin có tệp (mỗi lần một tx + resolver) · R-3 HR đặt lại đúng ảnh đang dùng ⇒ 403 (D-7) · R-4 gửi lại tin
  (`clientMessageId` cũ) có thể 403 nếu liên kết của tệp đổi giữa hai lần gửi · R-5 deadlock nếu một đường sau này khoá thực thể trước tệp
  — D-3 ghi trật tự, reviewer database soát.

### 9.3 Sổ vết

| Mốc     | Lúc              | Ghi                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1 | 23/10/2026 10:51 | Trên `c687b55d`. LP-1…LP-3 owner chốt 23/10. D-1 hàm chung bước (3)–(5) trả kết quả 4 loại · D-2 ngoài tx + so lại ảnh chụp có khoá · D-3 khoá tệp trước thực thể · D-4…D-6 L1–L3 · D-7 đổi hành vi ghim · D-8 SOCIAL hàm thuần không đổi hành vi · D-9 L5 giữ · D-10 census đường ghi · D-11 không migration/contracts/FE. 14 ca int + census + unit; 12 mutant ★. |
