# S7-CHAT-BE-8 — Presign upload own-scope cho CHAT

> **Zone:** đỏ (crown-jewel: đường tệp + cặp quyền) · **Gate:** FULL · **Migration:** KHÔNG · **Cặp quyền mới:** KHÔNG
> SPEC-15 §13.5 bước 1-2 · API-13 §5.1 · CHAT-FUNC-007
> Plan viết 04/08/2026, TRƯỚC khi code.

---

## §0. Lỗ đang đóng — đo, không đoán

`S7-CHAT-FE-2` seed WO này sau khi ĐO trên DB dev, không phải suy đoán:

- Đường upload DUY NHẤT hôm nay: `POST /foundation/files/upload` + `POST /foundation/files/:id/confirm`,
  cả hai gate `('upload','foundation-file')` ở `files.controller.ts`.
- `mig 0435:376` cấp `foundation-%` CHỈ cho role `company-admin`; **0** migration nào khác chạm cặp đó.
- Đo `role_permissions ⋈ permissions` trên DB `mediaos`: có = `SA` · `company-admin` · `QUẢN LÝ CẤP CAO`;
  **không có** = `employee` · `hr` · `manager`.

⇒ CHAT-FUNC-007 (§13.5) **chết với đa số người dùng** dù `S7-CHAT-BE-3` đã dựng xong toàn bộ đường ĐỌC
(link · resolver · presign · tab Tệp). FE-2 đã phải gate nút đính kèm bằng chính cặp FOUNDATION đó
(`FOUNDATION_FILE_UPLOAD_PAIR`) để không rơi vào "UI hứa, backend không đọc".

**Đây là CÙNG lỗ đã đóng ở ME** (`S5-ME-BE-4`, memory `avatar-own-scope-presign-wrapper`) và cách đóng
đã được FULL gate duyệt ở đó. WO này **sao khuôn**, không phát minh.

---

## §1. Chốt kiến trúc

### 1.1 Vì sao wrapper hợp lệ (điểm mấu chốt của cả WO)

Gate `*:foundation-file` nằm ở **`FilesController`**, **`FileService` KHÔNG gate**. Vì vậy một controller
own-scope có gate RIÊNG gọi thẳng `FileService.upload/confirmUpload` là hợp lệ về mặt kiến trúc — đúng
tiền lệ `MeAvatarController`. Wrapper KHÔNG:

- cấp cặp quyền mới (0 migration, 0 seed);
- nới bất kỳ vế nào của `ChatAttachmentsRepository.findOwnedFiles` (vế `owner_user_id` nằm trong SQL —
  wrapper không đụng tới, và đó là chốt chặn tại nguồn của §13.5);
- đụng `FilePolicyService`/resolver (đường ĐỌC giữ nguyên 100%).

### 1.2 Hai route mới

| Route | Cặp gate | Ghi chú |
| --- | --- | --- |
| `POST /chat/files/upload-url` | `('send','chat-message')` | đăng ký file Private owned-by-token → presigned-PUT |
| `POST /chat/files/:id/confirm` | `('send','chat-message')` | owner-check TRƯỚC → `FileService.confirmUpload` |

**Vì sao cặp `send:chat-message` chứ không phải `view:chat-room`:** đây là hai bước ĐẦU của luồng GỬI
tin (§13.5 bước 1-2). Người chỉ có quyền xem không được tạo tệp mới; người gửi được tin phải đính kèm
được. Đây cũng đúng cặp mà `ChatMessageFileResolver.canLink` hỏi lúc gắn link — ba chỗ (upload · confirm ·
canLink) cùng MỘT cặp, không đẻ role "tải lên được mà gắn không được".

**Vì sao KHÔNG nhận `roomId` để `assertMember`:** file chưa gắn vào tin nào ⇒ chưa thuộc phòng nào; §13.5
bước 3 mới là lúc kiểm (và `sendMessage` ĐÃ `assertMember` + `findOwnedFiles`). Bắt `roomId` ở đây tạo một
vế membership THỨ HAI cho cùng một luật, và bản sao sẽ trôi. Tệp vừa register là **inert**: 0 link ⇒
`ChatAttachmentPresignService.signOne` chặn ở `links.length === 0`, và đường tải FOUNDATION vẫn đòi
`download:foundation-file` mà người dùng thường không có.

### 1.3 Ranh giới CỐ Ý không làm

- **KHÔNG** ép MIME `image/*` (khác ME): CHAT đính kèm cả tài liệu. Allowlist MIME · trần dung lượng ·
  blocklist extension · nhất quán extension↔MIME đều do `FileService.upload` ép sẵn từ `system_settings`.
- **KHÔNG** nhận `visibility`/`moduleCode`/`entityType`/`entityId` từ client. Schema input HẸP
  (`originalName` · `declaredMimeType` · `sizeBytes`), `visibility: 'Private'` server-set. Nhận
  `visibility` từ client là để client tự khai `Public`; nhận `entityId` là để client tự gắn tệp vào
  entity module khác trong dòng audit.
- **KHÔNG** tạo `file_links` ở đây. Link do `chat-messages.service.ts` tạo trong CÙNG tx với INSERT tin
  (§13.5 bước 3). Client gắn tay = bỏ qua kiểm "tệp thuộc người gửi".

---

## §2. Điểm chèn (KHÔNG viết lại thân hàm nào có sẵn)

| File | Thao tác |
| --- | --- |
| `packages/contracts/src/chat.ts` | **APPEND** khối cuối: `chatFileUploadUrlInputSchema` + type. Response TÁI DÙNG `registerFileResponseSchema` / `confirmUploadResponseSchema` của `files.ts` — 0 schema mới. |
| `apps/api/src/chat/chat.dto.ts` | **APPEND** `ChatFileUploadUrlDto`. |
| `apps/api/src/chat/chat-files.service.ts` | **MỚI** — `createUploadUrl` + `confirmOwnUpload`. |
| `apps/api/src/chat/chat-files.controller.ts` | **MỚI** — 2 route, `@UseGuards(PermissionGuard)` per-route. |
| `apps/api/src/chat/chat.module.ts` | **APPEND** khối additive: 1 controller + 1 provider. `FilesModule` đã import sẵn (cấp `FileService` + `FileRepository`). |
| `apps/api/src/chat/chat.permissions.spec.ts` | thêm `ChatFilesController` vào `CHAT_CONTROLLERS` + 2 dòng `ROUTE_GATES`. |
| `apps/api/test/integration/chat-be8-file-upload.int-spec.ts` | **MỚI** — deny-path RED-trước. |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | regen (`ROUTE_CENSUS_WRITE=1`). |
| `apps/app/src/components/chat/chat-upload.ts` | đổi ĐÚNG 2 URL + viết lại docblock. |
| `apps/app/src/components/chat/MessageComposer.tsx` | bỏ gate `canUpload`. |
| `apps/app/src/routes/chat/constants.ts` | xoá `FOUNDATION_FILE_UPLOAD_PAIR` (chết sau WO này). |
| `apps/app/src/components/chat/MessageComposer.spec.tsx` | 3 ca gate foundation → viết lại theo cặp CHAT. |

---

## §3. Rủi ro đã lường + đai chặn

| # | Rủi ro | Đai |
| --- | --- | --- |
| R1 | Quên `@UseGuards(PermissionGuard)` ⇒ route MỞ cho mọi user đăng nhập (guard là **opt-in per-controller**, memory `s1-fnd-module-metadata-seed-drift`) | ca "được bọc bởi PermissionGuard" trong `chat.permissions.spec.ts` + ca "0 route CHAT thiếu `@RequirePermission`" |
| R2 | Route mới đứng ngoài lưới census ⇒ ĐỎ `route-guard-coverage` (memory `route-census-runtime-gate`) | regen artifact; route CÓ gate nên KHÔNG cần ký phán quyết mới |
| R3 | Controller mới đứng ngoài `CHAT_CONTROLLERS` ⇒ ba ca cấp-module mù với nó (đúng lỗi `S7-CHAT-BE-4` đã gặp) | thêm vào hằng — chính docblock của spec đó cảnh báo |
| R4 | Thiếu owner-check ở confirm ⇒ ai cũng confirm hộ tệp người khác | owner-check TRƯỚC, và int-spec IDOR chứng minh 403 xảy ra TRƯỚC khi chạm storage |
| R5 | "Xanh giả" vì chủ thể test là SA (`*:*`) | chủ thể int-spec chỉ có 9 cặp CHAT, **0** cặp foundation-file (memory `superadmin-not-a-canonical-role`) |
| R6 | Test không chứng minh được lỗ có thật | RED-trước: CÙNG token gọi `/foundation/files/upload` phải **403**, rồi `/chat/files/upload-url` phải **200** |
| R7 | Không có MinIO ⇒ không chạy được confirm | `confirmUpload` trả 200 **trước khi chạm storage** khi row đã `Uploaded` (idempotent). Int-spec flip row qua direct pool thay cho bước PUT bytes — mọi vế còn lại (gate · owner-check · route) chạy đường THẬT. Ghi rõ giới hạn này trong spec. |
| R8 | FE gỡ gate nhưng người dùng vẫn 403 | nút đính kèm đi theo `canSend` (đã có sẵn qua `disabled`), tức CÙNG cặp mà route mới đòi |

---

## §4. Nghiệm thu (done_when)

1. 2 route mới, gate `('send','chat-message')`, 0 cặp quyền mới, 0 migration.
2. confirm kiểm `files.owner_user_id = actor` TRƯỚC `FileService.confirmUpload`.
3. Đăng ký ở `chat.module.ts` + ROUTE_CENSUS regen.
4. int-spec deny-path RED-trước: tài khoản chỉ 9 cặp CHAT chạy trọn upload→confirm→gửi tin kèm `fileIds`;
   và KHÔNG confirm được tệp của người khác.
5. FE đổi đúng 2 lời gọi + bỏ gate `upload:foundation-file` ở nút đính kèm.
6. FULL gate PASS.
