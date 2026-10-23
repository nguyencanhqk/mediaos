# S19-SEC-FILELINKPATHS-1 — các đường ghi liên kết tệp ngoài lõi gắn chung theo cùng quyết định xem từng tệp

> Plan v2 (vá plan-review F1–F10) · 23/10/2026 · mã đo trên `c687b55d` · worktree `MediaOS-flp` nhánh `fix/s19-sec-filelinkpaths-1` · lane `mediaos_flp` ·
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

| #   | Đường                                       | Ghi ở                                                                                             | Điều kiện module trước khi gắn                        | Đi qua hàm quyết định chung |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------- |
| L1  | `POST /chat/rooms/:id/messages` (`fileIds`) | `S/chat/chat-messages.service.ts:150` `resolveAttachments` `:418-434` → `:449-476` (trong tx gửi) | thành viên · chủ tệp · `Uploaded` · không Infected    | chưa                        |
| L2  | `POST /chat/rooms/:id/avatar`               | `S/chat/chat-room-avatar.service.ts:142-172`, kiểm `:324-343`, ghi `:383-`                        | tư cách đặt ảnh · chủ tệp · trạng thái · ảnh          | chưa                        |
| L3  | `POST /hr/employees/:id/avatar`             | `S/employees/hr-employee-avatar.service.ts:144-187`, kiểm `:196-231`, ghi `:298-`                 | scope ghi Company/System · chủ tệp · trạng thái · ảnh | chưa                        |
| L4  | đính kèm SOCIAL (bài · bình luận)           | `S/social/social-attachments.service.ts:296-327` (vế 5 `:319-327`), ghi `:447`                    | chủ · `Uploaded` · scan · cỡ · chưa từng có liên kết  | tương đương, SQL riêng      |
| L5  | tệp hệ thống sinh (PAYROLL xuất)            | `F/server-file.repository.ts:50-84`                                                               | tệp tạo trong cùng tx, chủ = người gọi, tạm           | không áp dụng (D-9)         |

- CHAT **không** gỡ liên kết khi thu hồi tin — liên kết giữ sống, resolver từ chối vì `recalled_at` (có chủ đích, ĐỪNG viết lại
  việc gỡ: `S/chat/chat-messages.repository.ts:431-441`, `S/chat/chat-message-file.resolver.ts:47-60`). Thu hồi vì thế KHÔNG phải
  cách dựng tệp «0 liên kết sống» (§6).

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
  PgBouncer transaction-mode — `S/chat/chat-messages.service.ts:439-441`). Trong tx ghi:
  `FileService.recheckLinkerViewTx(companyId, fileId, decided, tx)` trả kết quả PHÂN LOẠI, đúng thứ tự của `link()` hiện tại
  (`F/files.service.ts:543-549`): (1) `findByIdForUpdateTx` (khoá hàng) — vắng ⇒ `{kind:"missing"}`; (2) trạng thái gắn được qua vị từ
  thuần `isLinkableFile(row)` export từ `F/file-link-guard.ts` (`assertLinkableFile` gọi lại chính vị từ này — một luật) — không đạt ⇒
  `{kind:"unlinkable", row}`; (3) đọc lại ảnh chụp + `assertSameLinkSnapshot` (lệch ⇒ ném 409 `FOUNDATION-FILE-ERR-LINK`); đạt ⇒
  `{kind:"ok", row}`. `link()` của lõi dùng chính hàm này và ánh xạ về ĐÚNG lỗi hiện tại (`missing` ⇒ `linkFileMissing` 400 · `unlinkable`
  ⇒ `assertLinkableFile(row)` ném INFECTED/LINK 400 như cũ) — lớp chặn Infected/tệp tạm TRONG tx giữ nguyên. L1–L3 ánh xạ mọi kết quả
  khác `ok` về mã lỗi của route mình (D-4…D-6), 0 ghi.
- **D-3 Thứ tự khoá: tệp TRƯỚC thực thể.** L2: `recheckLinkerViewTx` đứng trước `assertCanSetAvatarTx` trong tx atomic; L3: trước
  `findForAvatarUpdateTx`; L1: trong `resolveAttachments` (trước `allocateRoomSeq`). Nhiều tệp: CHỈ việc lấy khoá đi theo thứ tự id đã sắp;
  mảng trả về của `resolveAttachments` và thứ tự chèn liên kết GIỮ thứ tự client gửi (FE hiển thị theo thứ tự người dùng chọn —
  `S/chat/chat-messages.service.ts:411-413`). Lý do: một trật tự toàn cục tệp → phòng/NV, tránh deadlock khi gửi tin và đổi ảnh phòng
  cùng tệp cùng lúc.
- **D-4 (H2) L1 CHAT tin.** Khi `fileIds` không rỗng: (a) tx ngắn `assertMember` + chặn phòng lưu trữ (giữ thứ tự lỗi: ngoài phòng 404,
  lưu trữ 409 đứng TRƯỚC lỗi tệp) + `findByClientMessageId` — đã có tin cùng `clientMessageId` ⇒ BỎ QUA (b), đi thẳng vào tx gửi, nhánh
  idempotent `:119-128` không đổi (gửi lại không bị preflight chặn, kể cả khi tin gốc đã thu hồi) → (b) `preflightLinkerView` từng tệp đã
  khử trùng (`logTarget` = CHAT/message, không `entityId` — tin chưa có) → mọi kết quả khác `allow` ⇒ 403 `CHAT_ERR.ATTACHMENT_INVALID`
  (một thông điệp, không oracle) → (c) tx gửi như cũ; trong `resolveAttachments` thêm `recheckLinkerViewTx` từng tệp (kết quả khác `ok`
  ⇒ 403 cùng mã; lệch ảnh chụp ⇒ 409, N2). Tất-cả-hoặc-không: một tệp từ chối ⇒ 0 tin, 0 liên kết. Kiểm riêng của CHAT
  (`findOwnedFiles` + `isAttachableFile`) giữ nguyên.
- **D-5 (H2) L2 ảnh phòng.** Sau `confirmAndValidateOwnImageTx` (giữ nguyên), gọi `preflightLinkerView` (`logTarget` = CHAT/room-avatar,
  `roomId`) ⇒ khác `allow` ⇒ 403 `CHAT_ERR.ROOM_AVATAR_FILE_INVALID` (`CHAT-ERR-015`). Tx atomic: recheck (D-3) rồi như cũ.
- **D-6 (H2) L3 avatar NV do HR.** Sau `confirmAndValidateOwnImageFile` (giữ nguyên thứ tự + mã lỗi hiện có), gọi `preflightLinkerView`
  (`logTarget` = cặp avatar NV, `employeeId`) ⇒ khác `allow` ⇒ 403 `AUTH-ERR-FORBIDDEN` (mã route đang dùng cho «tệp không thuộc người
  gọi»). Tx atomic: recheck trước khoá NV. Từ chối xảy ra TRƯỚC khi gỡ liên kết cũ ⇒ avatar hiện hành giữ nguyên.
- **D-7 Đổi hành vi được chấp nhận (LP-2, ghim bằng ca test):** tệp «đã từng gắn, 0 liên kết sống» và tệp có liên kết sống mà người gắn
  không còn xem được ⇒ từ chối ở L1–L3, kể cả chủ tệp. Hệ quả L3 [SUY RA từ resolver avatar NV]: HR đặt LẠI đúng tệp đang là avatar của
  NV đó ⇒ 403 (HR không phải NV chủ ảnh); FE luôn tải tệp mới nên không chạm. Không thêm nhánh no-op (KISS) — ghi rủi ro R-3. Lệch
  tiền lệ luồng ME (`S/me/me-avatar.service.ts:191-210` giữ liên kết khi đặt lại đúng ảnh) ⇒ ghi rõ vào tóm tắt gửi owner khi mở PR
  (§8 W-5; plan-review F8 phương án b).
- **D-8 (H3) L4 SOCIAL — hàm thuần chung, không đổi hành vi.** Export `isOwnerOfUnlinkedFile` (`F/file-access-decision.ts`) + chuyển
  `groupLinksByFile` sang `F/file-link-context.ts` (export, `file-list.service.ts` dùng lại). Vế 5 (`:319-327`) đổi thành:
  `FileLinkRepository.listAllByFileIdsTx(unique)` (truyền mảng ĐÃ khử trùng; cùng vị từ SQL: công ty + id, không lọc `deleted_at` —
  `F/file-link.repository.ts:65-75`) → `groupLinksByFile` → tệp vắng trong map nhận ctx mặc định `{live: [], everLinked: false}` (như
  `F/file-list.service.ts:96`) → tệp nào `!isOwnerOfUnlinkedFile` ⇒ 422 `SOCIAL-ERR-007`, đúng vị trí cũ (sau vòng kiểm cỡ, TRƯỚC kiểm
  giới hạn theo loại `:329`). Tương đương [SUY RA]: vế 2 đã ép chủ ⇒ hàm thuần chỉ còn «chưa từng có liên kết» = điều kiện cũ. KHÔNG
  dùng `decideFileAccess` (sẽ mở nhánh AND trên liên kết sống = nới lỏng + gọi resolver trong tx). Ca hồi quy SOCIAL đỏ ⇒ vá khung gọi cho
  tương đương; KHÔNG lùi về SQL riêng (trái LP-1 và census D-10).
- **D-9 (H4) L5 giữ ngoài lõi có chủ đích.** `F/server-file.repository.ts` tạo hàng `files` MỚI trong cùng tx với liên kết, chủ = người
  gọi, tệp tạm — không có tệp người dùng chọn để quyết định «xem được»; quyền thuộc quyền xuất của PAYROLL ở nơi gọi. Không sửa.
- **D-10 Ratchet đường ghi — khoá theo ký hiệu, không theo tên hàm.** Unit census `T/foundation/file-link-writers.census.unit-spec.ts`
  quét `S/**/*.ts` (trừ `*.spec.ts`, bỏ comment như `S/employees/avatar-write-sink-structure.spec.ts`): (i) mọi tệp có `.insert(fileLinks)`
  hoặc `INSERT INTO file_links` phải nằm trong allowlist; (ii) mọi tệp import `FileLinkRepository` VÀ gọi `.insertTx(` phải nằm trong
  allowlist (không bắt `insertTx(` của kho khác); (iii) mọi `.update(fileLinks)` mà `.set({…})` chứa `deletedAt: null`, `fileId` hoặc
  `entityId` (hồi sinh / trỏ lại liên kết) ⇒ đỏ. Allowlist ghi theo CẶP {tệp ghi → tệp gọi phải chứa ký hiệu}: lõi
  `F/file-link.repository.ts` + `F/files.service.ts` (gọi `recheckLinkerViewTx(`) · L1 `S/chat/chat-attachments.repository.ts` →
  `S/chat/chat-messages.service.ts` (chứa `preflightLinkerView(` + `recheckLinkerViewTx(`) · L2 `S/chat/chat-room-avatar.service.ts` (tự
  chứa cả hai) · L3 `S/employees/hr-employee-avatar.service.ts` (tự chứa cả hai) · L4 `S/social/social-attachments.service.ts` (chứa
  `isOwnerOfUnlinkedFile(`) · L5-miễn `F/server-file.repository.ts` (lý do D-9). Đường ghi mới ⇒ đỏ tới khi phân loại. Đo cổng bằng VI
  PHẠM thật: thêm tạm một tệp ghi giả (và một `update(fileLinks)` hồi sinh) ⇒ census đỏ; gỡ ⇒ xanh (ghi §9.3).
- **D-11 (H7) Không migration · không đổi contracts · không đổi FE.** `F/files.service.ts` không dài thêm: dời `readLinkContextTx` +
  `loadFileAccessContext` sang `F/file-link-context.ts` (hàm nhận repo). `logDeny` nới tham số người gọi từ `RequestUser` sang
  `FileDecisionActor` (`F/file-view-decision.ts:18`) để `preflightLinkerView` dùng chung. Gate FULL: security · silent-failure · typescript
  · database (đổi truy vấn SOCIAL + khoá hàng) · quality-gate · santa ×2.
- **D-12 (H6)** Repo public: commit/PR/spec trung tính (bất biến + phép đo). PUSH nhánh / MỞ PR = công bố (int-spec deny-path lên công khai
  từ lúc đó, không đợi merge) ⇒ giữ khoảng «PR mở → deploy API» ngắn nhất: owner merge + deploy trong ngày mở PR nếu được. Commit plan
  này CHỈ nằm trên nhánh `fix/`, KHÔNG đẩy lên master theo kiểu docs-only trước khi deploy. Tên ca test + commit message dùng ngôn ngữ bất
  biến.

## 6. Ca test (int-spec MỚI `T/integration/s19-sec-filelinkpaths-1.int-spec.ts`, dựng qua `applyMainPipeline` như `s19-sec-filelinkgate-1`)

Fixture «đã từng gắn, 0 sống» dựng bằng đường THẬT SỰ soft-delete liên kết (KHÔNG dùng thu hồi tin — CHAT giữ liên kết sống khi thu hồi,
§2.2): L1/L2 = U đặt ảnh X làm ảnh phòng A (`POST /chat/rooms/A/avatar`) rồi gỡ (`DELETE /chat/rooms/A/avatar` — `unlinkStaleAvatarLinksTx`
soft-delete, `S/chat/chat-room-avatar.service.ts:353-380`); L3 = HR đặt Y làm avatar NV1 rồi đặt Z (thay thế soft-delete liên kết của Y).
Mỗi fixture đo trước khi dùng: tệp có ≥ 1 hàng `file_links` và 0 hàng `deleted_at IS NULL`. Mỗi ca DENY đếm `file_links` theo tệp
trước/sau (Δ = 0) + trạng thái thực thể không đổi.

| Ca      | Đường · actor                         | Tệp                                             | Kỳ vọng                                                                | Mã cũ |
| ------- | ------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| P1-D1   | L1 · U gửi vào phòng A                | X của U: từng là ảnh phòng A rồi gỡ (0 sống)    | 403 `CHAT-ERR-015` · Δliên kết 0 · 0 tin mới · seq phòng giữ           | ĐỎ    |
| P1-D2   | L1 · U                                | của U, sống ở tin phòng B mà U đã rời           | 403 · Δ0                                                               | ĐỎ    |
| P1-D3   | L1 · U, `[mới, X của P1-D1]`          | lô trộn                                         | 403 · Δ0 cho CẢ HAI tệp (không gửi một phần)                           | ĐỎ    |
| P1-D4   | L1 · U gửi vào phòng A                | của U, liên kết SỐNG tới tin phòng A đã thu hồi | 403 · Δ0 (lớp «liên kết sống mà người gắn không xem được»)             | ĐỎ    |
| P1-A1   | L1 · U                                | mới tải, chưa gắn                               | 2xx (route trả 200) · +1 liên kết                                      | XANH  |
| P1-A2   | L1 · U                                | của U, sống ở tin phòng A (U còn là thành viên) | 2xx · +1                                                               | XANH  |
| P1-A3   | L1 · U gửi lại cùng `clientMessageId` | như P1-A1                                       | cùng tin · tổng liên kết không đổi                                     | XANH  |
| P1-A4 ★ | L1 · U gửi lại cùng `clientMessageId` | tệp của tin gốc, tin gốc đã thu hồi             | trả lại tin cũ như nhánh idempotent hiện tại (không 403) · Δ0 (D-4a)   | XANH  |
| P1-O ★  | L1 · người ngoài phòng X              | X của P1-D1                                     | lỗi thành viên như hiện tại (404 [SUY RA]) — đứng trước lỗi tệp (D-4a) | XANH  |
| P2-D1   | L2 · U đặt ảnh phòng A                | ảnh của U, từng là ảnh phòng rồi gỡ             | 403 `CHAT-ERR-015` · Δ0 · `avatar_file_id` giữ                         | ĐỎ    |
| P2-D2   | L2 · U                                | ảnh của U, sống ở tin phòng B U đã rời          | 403 · Δ0                                                               | ĐỎ    |
| P2-A1/2 | L2 · U                                | ảnh mới · đặt lại đúng ảnh đang dùng            | 2xx (route trả 201) · liên kết ảnh phòng = 1 sống                      | XANH  |
| P3-D1   | L3 · HR đặt cho NV2                   | ảnh của HR đang là avatar sống của NV1          | 403 `AUTH-ERR-FORBIDDEN` · Δ0 · cột NV2 giữ · liên kết NV1 sống        | ĐỎ    |
| P3-D2   | L3 · HR cho NV1                       | Y của HR: từng là avatar NV1, đã thay bằng Z    | 403 · Δ0                                                               | ĐỎ    |
| P3-R ★  | L3 · HR đặt lại cho NV1               | ảnh đang là avatar sống của NV1                 | 403 · liên kết cũ GIỮ sống (D-7, ghim đổi hành vi)                     | ĐỎ    |
| P3-A1   | L3 · HR                               | ảnh mới                                         | 2xx (route trả 201) · liên kết mới sống, liên kết cũ gỡ                | XANH  |

- Hồi quy SOCIAL (H3, không đổi tệp spec): `T/integration/social-be1-attachments.int-spec.ts` (DENY tệp người khác `:169` · ALLOW `:187` ·
  DENY đã từng gắn `:202`) + `social-attgate-1-update-attach.int-spec.ts` + `S/social/social-attachments.service.spec.ts` — xanh trước và
  sau. Thêm ca unit: tệp của chính người gọi đang có liên kết SỐNG mà người gọi xem được ⇒ vẫn 422 (giết mutant M9).
- Hồi quy lõi: `F/files.service.link-gate.spec.ts` · `F/file-access-decision.spec.ts` · `T/integration/s19-sec-filelinkgate-1.int-spec.ts`
  · `F/file-access-hardening.int.spec.ts` — xanh, không đổi kỳ vọng.
- Hồi quy module: `chat-be3-attachments` · `chat-be2-messages` · `chat-s8-be2-room-avatar` · `hr-employee-avatar` · `s19-hr-avatarwrite-1`
  · `chat-qa1-acceptance` (≤ 3 tệp/lượt). Ca nào đỏ: thuộc đúng lớp D-7 ⇒ sửa kỳ vọng kèm mã WO; khác lớp ⇒ lỗi, sửa mã.
- Unit mới `F/files.service.linker-view.spec.ts`: 4 loại kết quả · log từ chối CHỈ cho `forbidden` (một dòng `Link` + mã quyền
  `FOUNDATION.FILE.VIEW|DOWNLOAD`) · `recheckLinkerViewTx` gọi `findByIdForUpdateTx` (ghim mệnh đề khoá) · lệch ảnh chụp ⇒ 409 ·
  `findByIdForUpdateTx` trả hàng Infected (và hàng tạm) ⇒ `recheckLinkerViewTx` = `unlinkable`, `link()` ⇒ 400 đúng mã cũ, 0 insert (giết
  M13) · cùng một fixture (chủ/không chủ × 0 sống chưa gắn/đã gắn × sống cho phép/từ chối) ⇒ `decideLinkerView` và `getMetadata`
  (`GET /:id`) cho CÙNG phán quyết xem — một nguồn quyết định, không bản viết lại thứ hai. Unit service hiện có đổi khởi tạo (thêm
  `FileService` mock cho `ChatMessagesService` — tham số mới, KHÔNG làm optional để né): `S/chat/chat-realtime-after-commit.spec.ts:257`
  (`new ChatMessagesService(` theo vị trí) + mọi tệp do lát L3 grep `new ChatMessagesService(` / `new ChatRoomAvatarService(` /
  `new HrEmployeeAvatarService(` chốt ra. `ChatRoomAvatarService` + `HrEmployeeAvatarService` đã inject `FileService` [ĐO].
- Census D-10 đỏ trên mã cũ (L1–L3 chưa gọi hàm chung) + đỏ khi thêm tệp ghi giả.

**Mutant ★** (mỗi cái một lượt, cây sạch sau mỗi lượt): M1 bỏ preflight L1 · M2 bỏ L2 · M3 bỏ L3 · M4 coi `forbidden` là cho phép · M5
`recheck` dùng `findByIdTx` (bỏ khoá) · M6 bỏ `assertSameLinkSnapshot` trong recheck · M7 L1 gắn phần tệp được phép (gửi một phần) · M8 bỏ
tx ngắn thành viên ở L1 · M9 vế 5 SOCIAL dùng `decideFileAccess` · M10 bỏ log từ chối `forbidden` · M11 HR preflight đặt SAU gỡ liên kết
cũ ngoài tx · M12 `checkLink` ánh xạ `unlinkable` thành 403 (đổi mã lõi) · M13 `recheckLinkerViewTx`/`link()` bỏ kiểm `isLinkableFile`
trong tx — chết ở unit Infected/tạm ⇒ 400 · M14 `decideLinkerViewFromSnapshot` truyền `ctx.live = []` — chết ở P1-A2 + P2-A2 (ALLOW thành 403) · M15 coi `everLinked = false` — chết ở P1-D1 + P2-D1 + P3-D2 (DENY thành 2xx, vế chủ mở lại) · M16 hàm chung bỏ vế AND liên kết
sống (chủ tệp ⇒ cho phép bất kể liên kết) — chết ở P1-D2 + P1-D4 + P2-D2 + P3-D1 · M17 L1 bỏ tra `clientMessageId` ở tx ngắn — chết ở
P1-A4. Tiêu chí: 17/17 chết.

## 7. Lát thi công

| Lát | Việc                                                                                                                                                         | Đo / xong khi                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| L0  | `paths` mở ở master `c687b55d` (5 glob) · THÊM `apps/api/src/chat/chat-realtime-after-commit.spec.ts` (plan-review F4; commit backlog riêng của luồng chính) | 5 glob ĐÃ XONG · path F4 chờ luồng chính                                     |
| L1  | RED: int-spec §6 + unit linker-view + census D-10; chạy trên mã cũ qua wrapper khoá chung (lane `mediaos_flp`)                                               | các ca «ĐỎ» đỏ đúng lý do, «XANH» xanh; ghi số §9.3; commit `test(files): …` |
| L2  | Lõi: `F/file-link-context.ts` · `F/file-linker-view.ts` · `decideLinkerView`/`preflightLinkerView`/`recheckLinkerViewTx`; `checkLink` + `link()` dùng chúng  | unit lõi + `s19-sec-filelinkgate-1` xanh · `wc -l F/files.service.ts` ≤ 1000 |
| L3  | L1 CHAT tin (D-4); trước khi sửa grep `new ChatMessagesService(` / `new ChatRoomAvatarService(` / `new HrEmployeeAvatarService(` chốt danh sách spec         | P1-\* xanh · chat-be3/be2 + chat-realtime-after-commit xanh                  |
| L4  | L2 ảnh phòng (D-5)                                                                                                                                           | P2-\* xanh · chat-s8-be2-room-avatar xanh                                    |
| L5  | L3 HR (D-6)                                                                                                                                                  | P3-\* xanh · hr-employee-avatar + s19-hr-avatarwrite-1 xanh                  |
| L6  | L4 SOCIAL (D-8) + `groupLinksByFile` dùng chung                                                                                                              | social-be1 + attgate + unit SOCIAL + file-list xanh                          |
| L7  | Mutant §6 · `T/foundation/pipeline-parity.unit-spec.ts` · typecheck api · eslint tệp đã sửa                                                                  | 17/17 chết · xanh                                                            |
| L8  | Gate FULL (security · silent-failure · typescript · database · quality-gate) + santa ×2; vá; `bash harness/check.sh --all --lane-db=flp`                     | PASS · «XANH» đủ bằng chứng (luồng chính mở PR)                              |

## 8. [OWNER]

| #   | Việc                                                                                                                                                                            | Chốt                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| W-1 | Duyệt chạy tới PR (không merge/deploy trong chuỗi)                                                                                                                              | Đã chọn 23/10 ~09:25 (A+B+C+D+E) |
| W-2 | Mở PR = công bố (D-12) ⇒ merge `--admin` + deploy API (`m prod-update api`) cùng ngày mở PR nếu được; không migration/contracts/FE ⇒ không cửa sổ thứ tự                        | Sau PR                           |
| W-3 | Đo sau deploy: `/health` build.commit = SHA merge · gửi tin kèm tệp mới 201 · đặt ảnh phòng bằng ảnh mới 200 · HR đặt avatar bằng ảnh mới 200 · đăng bài SOCIAL kèm ảnh mới 201 | Sau deploy                       |
| W-4 | Đường lùi: `m prod-rollback` API (không đổi schema)                                                                                                                             | Khi cần                          |
| W-5 | Tóm tắt gửi owner khi mở PR ghi rõ: HR đặt lại đúng ảnh đang dùng ⇒ 403, khác luồng ME (D-7/R-3) · đề nghị xếp `S19-SEC-FILEPOINTER-1` P1 deploy sát sau WO này (R-6)           | Khi mở PR                        |

## 9. Ngoài phạm vi · nợ · rủi ro

- Ngoài phạm vi: con trỏ tệp không qua liên kết (`S19-SEC-FILEPOINTER-1`, dùng lại D-1) · tham số liên kết ở route FOUNDATION
  (`S19-SEC-FILELINKPARAMS-1`) · `S/realtime/**` · `apps/app` · docs API CHAT.
- Nợ (luồng chính gieo sau merge, tiêu đề trung tính): N1 FE hiện lỗi chung (bong bóng «gửi lỗi» CHAT · HR «tải ảnh lỗi») — không nuốt
  im, không cần sửa ở WO này [ĐO lại lúc thi công: composer CHAT giữ tin ở trạng thái `failed` + «Gửi lại» dùng lại đúng
  `clientMessageId` (lần gửi đầu bị 403 không tạo tin ⇒ gửi lại vẫn 403, đúng vị từ); HR hiện thông điệp lỗi tải chung] · N2 thông điệp `CHAT-ERR-015` chưa nêu điều kiện mới (cố ý một thông điệp) + 409
  `FOUNDATION-FILE-ERR-LINK` (lệch ảnh chụp khi so lại, D-2) là mã MỚI với các route CHAT/HR — cập nhật docs API CHAT/HR sau khi chuỗi
  RTROOMOPS xong · N3 `F/files.service.ts` vẫn > 800 dòng (FILEDEBT).
- Rủi ro: R-1 TOCTOU như lõi — so lại ảnh chụp liên kết, không so lại phán quyết resolver (chấp nhận theo O-9 của WO mẹ) · R-2 L1 tốn thêm
  ≤ 10 lần quyết định/tin có tệp (mỗi lần một tx + resolver) · R-3 HR đặt lại đúng ảnh đang dùng ⇒ 403 (D-7; khác luồng ME — báo owner ở
  W-5) · R-4 gửi lại tin khi lần đầu CHƯA tạo được tin (không có `clientMessageId` trong DB) mà liên kết của tệp đổi giữa hai lần ⇒ có thể
  403 — đúng vị từ; khi tin đã tồn tại thì D-4a bỏ qua preflight, trả lại tin cũ (P1-A4) · R-5 deadlock nếu một đường sau này khoá thực thể
  trước tệp — D-3 ghi trật tự, reviewer database soát · R-6 đường ký avatar NV (đọc, danh bạ) chưa có vị từ độc quyền — WO này chỉ ép
  quyết định xem của người gắn ở biên ghi, KHÔNG đóng phần đọc; phần đó thuộc `S19-SEC-FILEPOINTER-1` (FP-1), đề nghị owner xếp deploy sát
  sau WO này (W-5). Không mở rộng phạm vi WO.

### 9.3 Sổ vết

| Mốc         | Lúc              | Ghi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1     | 23/10/2026 10:51 | Trên `c687b55d`. LP-1…LP-3 owner chốt 23/10. D-1 hàm chung bước (3)–(5) trả kết quả 4 loại · D-2 ngoài tx + so lại ảnh chụp có khoá · D-3 khoá tệp trước thực thể · D-4…D-6 L1–L3 · D-7 đổi hành vi ghim · D-8 SOCIAL hàm thuần không đổi hành vi · D-9 L5 giữ · D-10 census đường ghi · D-11 không migration/contracts/FE. 14 ca int + census + unit; 12 mutant ★.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Plan-review | 23/10/2026       | Verdict v1 = BLOCK (1 BLOCKER · 1 HIGH · 5 MEDIUM · 3 LOW). Cả 10 finding xác minh ĐÚNG bằng mã ở `c687b55d` ⇒ áp hết, 0 từ chối. F1 fixture «0 sống» đổi sang gỡ ảnh phòng / thay avatar (thu hồi không gỡ liên kết — `S/chat/chat-messages.repository.ts:431-441`) + ca P1-D4 · F2 recheck trả kết quả phân loại, giữ `isLinkableFile` trong tx + M13 · F3 tx ngắn L1 tra `clientMessageId`, bỏ qua preflight khi tin đã có + P1-A4/M17 · F4 path `S/chat/chat-realtime-after-commit.spec.ts` (`:257`) ⇒ pathsNeeded · F5 census khoá theo ký hiệu + cặp tệp ghi → tệp gọi + canh hồi sinh/trỏ lại + đo bằng vi phạm thật · F6 §2.2 cột cuối trung tính, mở PR = công bố, plan chỉ trên nhánh `fix/` · F7 R-6 · F8 phương án (b): giữ D-7, báo owner ở W-5 (P3-R giữ 403) · F9 quality-gate · thứ tự khoá vs thứ tự client · ctx mặc định + `unique` · bỏ lối thoát «giữ SQL cũ» · 409 vào N2 · `logDeny` nhận `FileDecisionActor` · F10 M14–M16 + unit «cùng phán quyết với `GET /:id`». Nay 16 ca int · 17 mutant. |
