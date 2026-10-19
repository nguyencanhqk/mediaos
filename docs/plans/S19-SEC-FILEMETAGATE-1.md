# S19-SEC-FILEMETAGATE-1 — tên/cỡ tệp chỉ đi theo quyết định xem từng tệp: danh sách tệp FOUNDATION + DTO đính kèm CHAT + đường giám sát CHAT

> Plan v2 · 19/10/2026 · mã đo trên `68f8719b` · plan v1 `630d245d` · worktree `MediaOS-fmg` nhánh `fix/s19-sec-filemetagate-1` · 🔴 FULL gate.
> v2 = áp plan-review F1–F8 + quyết định owner O-2 · O-3 · O-6 · O-7 (owner chốt 19/10).
> Số đo chi tiết (census, ví dụ cụ thể) ở kênh owner ngoài repo — repo PUBLIC, plan này chỉ ghi bất biến đích.
> Viết tắt: `F/` = `apps/api/src/foundation/files/` · `C/` = `packages/contracts/src/` · `T/` = `apps/api/test/` · `H/` = `apps/api/src/chat/`.
> [ĐO] = đã đọc mã ở `68f8719b` · [SUY RA] = chưa đo, L1 đo.

## 1. Phạm vi + nguồn

- WO: `harness/backlog.mjs` mục `S19-SEC-FILEMETAGATE-1` (done_when ba vế: đo trước · một bất biến mỗi đường · RED deny-path + ALLOW đứng cạnh).
- Tiền lệ đã ship: `docs/plans/S16-SOCIAL-ATTMETAMASK-1.md` (#591) — một vị từ · GIỮ phần tử, `null` tên/cỡ · WS giữ khoá.
- Ba đường đọc trong phạm vi: (1) `GET /foundation/files` (danh sách) · (2) DTO đính kèm CHAT (REST tin/tab Tệp + WS `chat:message`) ·
  (3) đường giám sát CHAT `GET /chat/oversight/rooms/:id/messages` (CHAT-API-018c).

### 1.1 Mọi đường đọc trả tên/cỡ tệp `files` (done_when #1)

Grep `toMetadataDto|originalName|original_name|sizeBytes|size_bytes|fileName|name: row\.name` trong `apps/api/src` (bỏ `*.spec.ts`,
`db/schema`), phân loại từng dòng khớp. Dòng khớp KHÔNG phải đường đọc trả tên cho người dùng (re-review L3): tên tệp import multipart ghi
vào `audit_logs.after` (`employees/hr-import.repository.ts:142-151` · `employees/hr-employee-import.service.ts` · `payroll/payroll-adjustments-import.service.ts:87,161`
— không phải bảng `files`) · `F/temp-file-cleanup.job-handler.ts:208` (ảnh chụp khi dọn tệp tạm — [SUY RA] đi qua cổng audit) ·
`F/server-file.repository.ts:181-241` (nội bộ của #4/#9) · `storage/*` + `F/file-content-guard.ts` (nội bộ content-disposition của URL ký).

| #   | Đường                                                                                                           | Nguồn tên/cỡ [ĐO]                                                                                                                                                                                                                                                                                                                    | Bất biến                                                                      | WO này            |
| --- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------- |
| 1   | `GET /foundation/files` (danh sách)                                                                             | `F/files.service.ts:468-487` → `toMetadataDto` `:1098-1122`                                                                                                                                                                                                                                                                          | đích: vị từ D-1 (= `GET /:id`)                                                | **L2**            |
| 2   | `GET /foundation/files/:id`                                                                                     | `F/files.service.ts:433-462` (quyết định View trước `:461`)                                                                                                                                                                                                                                                                          | quyết định xem từng tệp                                                       | không đổi         |
| 3   | tải tệp FOUNDATION (`fileName` trong URL ký)                                                                    | `F/files.service.ts:497-549`                                                                                                                                                                                                                                                                                                         | tên ⇔ có URL ký (quyết định Download)                                         | không đổi         |
| 4   | URL ký tệp máy chủ · avatar · ảnh bìa · avatar phòng                                                            | `F/server-file.service.ts:184` · `F/avatar-presign.service.ts:119` · `F/cover-presign.service.ts:82` · `H/chat-room-avatar-presign.service.ts:71`                                                                                                                                                                                    | tên ⇔ có URL ký                                                               | không đổi         |
| 5   | CHAT REST tin / tab Tệp + WS `chat:message`                                                                     | `H/chat-attachments.repository.ts:239-241,321-323` → `H/chat-attachments.service.ts:329-343`                                                                                                                                                                                                                                         | phạm vi «chủ tệp chia sẻ vào phòng» (D-2, O-2)                                | neo C-1/C-2       |
| 6   | giám sát CHAT (CHAT-API-018c)                                                                                   | `H/chat-oversight.controller.ts:101-103` → `H/chat-oversight.service.ts:152-183` → `H/chat-oversight.mapper.ts:95-103`                                                                                                                                                                                                               | phạm vi toàn tenant qua cặp nhạy cảm, audit mỗi lần đọc, 0 URL ký (D-2b, O-7) | neo C-3           |
| 7   | đính kèm SOCIAL (REST + WS)                                                                                     | `social/social-attachments.service.ts:595,647-648` · `social/social-ws-payload.ts:22`                                                                                                                                                                                                                                                | tên/cỡ ⇔ có URL ký (#591)                                                     | không đổi         |
| 8   | danh sách tệp module (HR hồ sơ · TASK · RECRUIT CV)                                                             | `employees/employee-file.service.ts:190-192` · `tasks/task-file.service.ts:469-471` · `recruit/recruit-candidate-file.service.ts:225-227`                                                                                                                                                                                            | theo cổng thực thể của module                                                 | WO theo dõi (O-6) |
| 9   | phiếu lương PDF (tệp máy chủ, trả kèm URL)                                                                      | `payroll/payroll-payslip-pdf.service.ts:128` · `payroll/payroll-payslip-pdf-batch.service.ts:191`                                                                                                                                                                                                                                    | tên ⇔ có URL ký                                                               | không đổi         |
| 10  | ảnh chụp `audit_logs.before` khi xoá tệp                                                                        | `F/files.service.ts:838`                                                                                                                                                                                                                                                                                                             | đọc qua cổng audit                                                            | ngoài             |
| —   | Không phải đường đọc: trả lại input của chính người tải lên                                                     | `F/files.service.ts:227,310,388` · `me/me-avatar.service.ts:86` · `employees/hr-employee-avatar.service.ts:125` · `H/chat-room-avatar.service.ts:122` · `H/chat-files.service.ts:65` · `social/social-files.service.ts:116` · `recruit/recruit-candidate-file.service.ts:111` · `foundation/company/company-branding.service.ts:107` | —                                                                             | —                 |
| —   | Không phải bảng `files`: `task_attachments` (bảng riêng)                                                        | `tasks/tasks.repository.ts:855,889,918` → `tasks/task-attachments.service.ts:244-262`                                                                                                                                                                                                                                                | theo cổng TASK                                                                | ngoài             |
| —   | `name: row.name` là tên thực thể khác (phòng · nhóm · khoá API · tài sản · ca · loại phép · mục tiêu · dự án …) | api-keys · assets · attendance · `H/chat-access.service.ts` · `H/chat.mapper.ts:108` · `H/chat-oversight.mapper.ts:51` · company · holidays · goals · leave · rooms · social-groups · social-kudos · projects · task-core                                                                                                            | —                                                                             | —                 |

## 2. Bất biến đích

1. **Một vị từ cho danh sách FOUNDATION:** `originalName` · `fileExtension` · `sizeBytes` · `ownerUserId` của một hàng khác `null` ⇔ quyết
   định XEM của CHÍNH người gọi cho đúng tệp đó là ALLOW — cùng hàm, cùng đầu vào với `GET /foundation/files/:id` (MỘT nguồn: hàm export ở
   `F/file-view-decision.ts`). Hệ quả kiểm được: hàng có tên ⇔ `GET /:id` cùng người gọi = 200.
2. Hàng không bị bỏ (phân trang + `total` giữ nguyên nghĩa). Hàng bị che không điều hướng sang trang chi tiết.
3. CHAT: metadata đính kèm = nội dung tin do CHỦ TỆP chia sẻ vào phòng — phạm vi có chủ đích (D-2, owner chốt 19/10).
4. Giám sát CHAT: tên/cỡ đính kèm trong phạm vi toàn tenant cho người giữ cặp nhạy cảm `view:chat-oversight`, mỗi lần đọc có audit,
   KHÔNG mang khoá `url` — phạm vi có chủ đích (D-2b, owner chốt 19/10).
5. Không đường nào trong phạm vi ghi tên tệp vào log khi từ chối. `deny-no-resolver` ⇒ danh sách ghi đúng MỘT `logger.error` mỗi
   request; `deny-error` ⇒ chỉ dòng log của policy (`F/file-policy.service.ts:263-264`), danh sách KHÔNG ghi thêm; không dòng nào mang tên tệp.

## 3. Phép đo đã có [ĐO]

- Route: `F/files.controller.ts:78-85` (list, gate `view:foundation-file`) · `:87-92` (theo id).
- `F/files.service.ts` (1.132 dòng): `getMetadata` `:433-462` — `loadLinkContext` (`:988-996`) rồi `decideForLinkedFile(View)` `:441-447`;
  `list` `:468-487` — `listTx`+`countTx` trong một `withTenant`; `policyInputForFile` `:998-1010` (gọi `policyInput` `:1013-1032`) ·
  `toLinkRef` `:1038-1044` — cả ba `private`; `toMetadataDto` `:1098-1122`.
- `F/file.repository.ts:323-348` `listTx`/`countTx` (lọc `company_id` · `deleted_at` · `visibility`).
- `F/file-link.repository.ts:49-56` `hasEverBeenLinkedTx` (`eq(companyId)` + `eq(fileId)`, KHÔNG lọc `deleted_at`) · `:59-70` `listByFileTx`
  (thêm `isNull(deletedAt)`). Schema `apps/api/src/db/schema/files.ts:114`: `file_links.file_id` FK MỘT cột tới `files.id`.
- `F/file-policy.service.ts:199-267` `decideForLinkedFile`: 0 link ⇒ `everLinked` ? `deny-links-revoked` : fallback `FOUNDATION.FILE.*`
  (`:215-228`); link thiếu resolver ⇒ `deny-no-resolver`; AND mọi link; ném ⇒ `deny-error` và policy ĐÃ log (`:263-264`). Không truy cập DB.
- CHAT: `H/chat-attachments.service.ts:49-55` (fail-soft có chủ ý) · `:193-215` link cả lô MỘT truy vấn + quyết định TUẦN TỰ · `:79-83`
  (cấm lồng `withTenant` — treo trên PgBouncer) · `:329-343` `toDto`. Tiền đề chủ tệp: `H/chat-attachments.repository.ts:78-108`
  (`owner_user_id = người gửi`) · `H/chat-message-file.resolver.ts:110-111` (`canLinkFile → canAttach`, `:180`).
- Giám sát CHAT: `H/chat-oversight.controller.ts:101-103` (`ChatOversightAuditGuard` + `view:chat-oversight`, `isSensitive`) ·
  `H/chat-oversight.service.ts:152-183` (không gọi presign) · `H/chat-oversight.mapper.ts:95-103` (`fileId` · `name` · `mimeType` · `sizeBytes` ·
  `isImage`). Int-spec có sẵn `T/integration/chat-be7-oversight.int-spec.ts`: ca 16 `:277-282` (thiếu cặp ⇒ 403, route phòng) · ca 20
  `:397-411` (route `/messages`: `name` có, `url`/`thumbnailUrl` vắng; `sizeBytes` chưa ghim).
- Contracts: `C/files.ts:156-184` `fileMetadataSchema` (`originalName`/`sizeBytes` non-null; `ownerUserId` `.nullable().optional()` `:167`) ·
  `:127-144` query · `:67` `PAGE_LIMIT_MAX = 100` · `C/files.spec.ts:177-221` `it.each(FORBIDDEN_KEYS)` + strip khoá lạ ·
  `C/chat.ts:176-204` `chatAttachmentSchema` (`name`/`sizeBytes` non-null; cảnh báo «bỏ nullable = trắng trang») · `C/realtime.ts:100-108`
  `wsChatAttachmentSchema` (`name`/`sizeBytes`).
- FE: duy nhất `apps/app/src/routes/system/files/FilesPage.tsx` gọi list (`:32` `z.array(fileMetadataSchema)` · `:56-77` cột tên/cỡ · nút Xem
  `:96` · điều hướng `:134`); phân trang heuristic «trang đầy ⇒ còn trang sau» (`:11-12`). `FileDetailPage.tsx:83-93` đã có trạng thái 403
  (`file-detail-forbidden`, spec `FileDetailPage.spec.tsx:122`). `apps/app/src/routes/recruit/candidate-file-api.ts:9` comment mô tả hành vi
  list — sửa cho khớp bất biến 1 sau vá. `apps/console` không gọi.
- Spec đang gọi list chỉ kiểm status: `T/integration/s14-recruit-filegrant1-cv.int-spec.ts:456,468` · `s15-payroll-be5b-pdf.int-spec.ts:352`.
  Unit: `F/files.controller.spec.ts:22,32,57` · `F/files.service.spec.ts:642-644`.
- Realtime FOUNDATION: `grep originalName apps/api/src/realtime` = 0 ⇒ không có payload WS tệp FOUNDATION.
- Kit: `T/helpers/social-qa1-kit.ts:64-68` (`view:foundation-file` trong cặp cho phép) · `:191` `bootQa1World` (`applyMainPipeline` `:210`) ·
  `createGroup` `:717` · `joinAsActiveMember` `:756`. Tiền lệ seed tệp bằng SQL (không PUT storage):
  `T/integration/s16-social-attmetamask-1.int-spec.ts:80-101`.

## 4. Quyết định

**D-1 — Danh sách FOUNDATION: GIỮ hàng, `originalName`/`fileExtension`/`sizeBytes`/`ownerUserId` = `null` khi quyết định xem là DENY.**
Vị từ = `decideForLinkedFile(fileSelfPolicyInput(user, id, View), liveLinks.map(toFileLinkRef), View, everLinked).allow` — hai hàm thuần
EXPORT từ tệp MỚI `F/file-view-decision.ts` (thay `policyInputForFile` · `policyInput` · `toLinkRef` private của `files.service.ts`), dùng
CHUNG cho `FileService.getMetadata` và `FileListService.list` ⇒ một nguồn, `files.service.ts` ngắn đi. Lý do giữ hàng (không lọc): lọc sau
`LIMIT/OFFSET` làm trang hụt ⇒ FE heuristic dừng sớm ⇒ tệp được phép ở trang sau không với tới; lọc trong SQL không làm được (quyết định đi
qua resolver). `fileExtension` che cùng vì là đuôi của tên; `ownerUserId` che cùng (owner chốt 19/10 — O-3; contract đã nullable). Các trường
còn lại giữ nguyên.

**D-1b — Theo lô, không N+1.** `F/file-link.repository.ts` thêm `listAllByFileIdsTx(companyId, ids, tx)` =
`where(and(eq(fileLinks.companyId, companyId), inArray(fileLinks.fileId, ids)))`, KHÔNG lọc `deletedAt`; `ids` rỗng ⇒ trả `[]`, không truy vấn
⇒ tách `live` (`deletedAt` null) + `everLinked` (có bất kỳ hàng) — tương đương `listByFileTx` + `hasEverBeenLinkedTx`. Đọc hàng + `total` + link
trong CÙNG MỘT `withTenant` với `listTx`/`countTx`; quyết định chạy TUẦN TỰ SAU khi tx xong (khuôn `H/chat-attachments.service.ts:193-215`).
Chi phí đã biết: ≤ 100 dispatch/trang, màn quản trị.

**D-2 — CHAT: không đổi mã; phạm vi «chủ tệp chia sẻ vào phòng» — owner chốt 19/10 (O-2: GIỮ).** Lý do: (a) tiền đề chủ tệp ở cả hai
đường gắn (§3) ⇒ tên/cỡ là thứ chủ tệp tự đưa vào tin, người nhận đã qua `assertMember`; luật AND chặn BYTE, không chặn lời chủ tệp; (b) che
⇒ `chatAttachmentSchema.name`/`sizeBytes` nullable ⇒ bundle FE cũ ZodError trắng trang tin (`C/chat.ts:176-181`), WS phát cả phòng phải ép
`null` cho mọi người. Hai ca NEO ghim quyết định và tiền đề (C-1, C-2).

**D-2b — Giám sát CHAT: không đổi mã; phạm vi toàn tenant có chủ đích — owner chốt 19/10 (O-7: GIỮ).** Đường này là chức năng quản trị
qua cặp nhạy cảm `view:chat-oversight`, mỗi lần đọc có audit (`ChatOversightAuditGuard`), payload là metadata thuần, 0 URL ký
(`H/chat-oversight.service.ts:145-151`). Ca NEO C-3 + DENY đứng cạnh C-3d; dẫn ca 16/ca 20 của `chat-be7-oversight.int-spec.ts` vào sổ vết,
chỉ viết MỚI phần chưa ghim (`sizeBytes` có · không có khoá `url` · 403 trên chính route `/messages`).

**D-3 — Contract + FE tương thích.** `fileMetadataSchema` KHÔNG đổi (theo id · HR · TASK giữ non-null). THÊM `fileListItemSchema =
fileMetadataSchema.extend({ originalName: z.string().nullable(), sizeBytes: z.number().int().nonnegative().nullable() })` + type
`FileListItemDto` ở `C/files.ts`, docblock ghi bất biến 1. FE `FilesPage.tsx` dùng schema mới + ô che (i18n `files.masked.*`); hàng che KHÔNG
hiện nút Xem (không điều hướng); vào thẳng URL chi tiết ⇒ trạng thái 403 có sẵn (`FileDetailPage.tsx:83-93`) — không đổi trang chi tiết.
Cửa sổ deploy: FE mới + API cũ ⇒ bình thường; API mới + FE cũ ⇒ trang Tệp báo lỗi (fail-closed) cho tới khi tải bundle mới ⇒ deploy API SAU
khi Pages xanh (§8).

**D-4 — Audit/log.** Không đổi `audit_logs`/`file_access_logs` (list chưa từng ghi; ghi DENY mỗi lần tải trang = nhấn chìm bảng append-only
dùng chung — cùng lý do `H/chat-attachments.service.ts:88-90`). KHÔNG log mỗi hàng: MỘT `logger.error` mỗi request khi ≥ 1 hàng có lý do
`deny-no-resolver` — mang số hàng + tập `(moduleCode, entityType)` + ≤ 5 `fileId`, KHÔNG tên tệp. KHÔNG log lại `deny-error` (policy đã log
`F/file-policy.service.ts:263-264`). DENY thường không log.

**D-5 — Vị trí mã (không phình `files.service.ts`).** MỚI `F/file-view-decision.ts` (hàm thuần export: `fileSelfPolicyInput` ·
`filePolicyInput` · `toFileLinkRef`) · MỚI `F/file-metadata.mapper.ts` (`toFileMetadataDto` chuyển từ `:1098-1122` + `toFileListItemDto(row,
canView): FileListItemDto`) · MỚI `F/file-list.service.ts` (`FileListService.list` khai kiểu trả `{ data: FileListItemDto[] }` + phân trang
như cũ) · `F/file-link.repository.ts` thêm `listAllByFileIdsTx` · `F/files.controller.ts` tiêm `FileListService` cho list · `F/files.module.ts`
provider · `F/files.service.ts` BỎ `list()` + ba hàm private + thân `toMetadataDto` ⇒ số dòng GIẢM. Sửa 2 unit spec cũ (ctor controller;
chuyển ca list `:642-644` sang spec mới) — không đụng int-spec storage nào.

## 5. Ca test viết TRƯỚC

Int-spec MỚI `T/integration/s19-sec-filemetagate-1.int-spec.ts` qua `bootQa1World` (⇒ `applyMainPipeline`, tenant tươi); tệp seed bằng
SQL ⇒ không PUT storage (không cần `resolveStorageTestTarget`; lát nào cần PUT thì đi qua helper đó). Actor tenant A: `fileViewer`
(`view:feed`+`view:foundation-file` @Company, KHÔNG thuộc nhóm kín G) · `member` (ACTIVE trong G + `view:foundation-file`) · `admin`
(`company-admin`) · `noFilePair` (`view:feed`) · `overseer` (`view:chat-oversight`) · `plain` (không cặp giám sát). Tenant B: `viewerB`.
Tệp: F_grp (đính kèm bài trong G) · F_pub (bài audience company) · F_free (0 link) · F_rev (link đã gỡ mềm) · F_nores (link module không
resolver) · F_B (tenant B).

| Ca   | Actor                       | Kỳ vọng                                                                                                                          | Mã cũ    |
| ---- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------- |
| R-1  | fileViewer                  | hàng F_grp CÓ, `id` đúng, `originalName`/`fileExtension`/`sizeBytes`/`ownerUserId` = `null`; thân response không chứa tên F_grp  | ĐỎ       |
| R-1a | fileViewer                  | cùng response: F_pub + F_free đủ trường (ALLOW đứng cạnh)                                                                        | xanh     |
| R-2  | member                      | F_grp đủ trường                                                                                                                  | xanh     |
| R-3  | fileViewer · member · admin | duyệt HẾT trang (hoặc `limit=PAGE_LIMIT_MAX`) trên tenant tươi: MỌI hàng `originalName !== null` ⇔ `GET /:id` cùng actor = 200   | ĐỎ       |
| R-4  | fileViewer                  | F_rev che (`deny-links-revoked`)                                                                                                 | ĐỎ       |
| R-5  | fileViewer                  | F_nores che (`deny-no-resolver`)                                                                                                 | ĐỎ       |
| R-6  | fileViewer                  | `limit` < tổng: trang đầu ĐẦY `limit` hàng, trang cuối hụt đúng phần dư, `pagination.total` = tổng — hàng che không bị bỏ        | xanh/neo |
| R-7  | fileViewer · viewerB        | A không thấy id F_B; B không thấy id tệp A; link `company_id` = B gieo bằng SQL trỏ F_free ⇒ F_free với A vẫn đủ trường          | xanh/neo |
| R-8  | noFilePair                  | 403 guard                                                                                                                        | xanh/neo |
| C-1  | thành viên phòng, ngoài G   | tin kèm F_c (của người gửi, thêm link tới bài G) ⇒ `url` null, `name`/`sizeBytes` còn (D-2)                                      | xanh/neo |
| C-2  | thành viên phòng            | gửi tin kèm `fileId` không phải của mình ⇒ bị từ chối, 0 link mới                                                                | xanh/neo |
| C-2b | thành viên phòng            | `POST /foundation/files/:id/links` {CHAT, tin của CHÍNH mình} với tệp không phải của mình ⇒ 403, 0 link mới; tệp của mình ⇒ được | xanh/neo |
| C-3  | overseer                    | `GET /chat/oversight/rooms/:id/messages`: đính kèm có `name` + `sizeBytes`, `not.toHaveProperty("url")` (D-2b)                   | xanh/neo |
| C-3d | plain                       | cùng route `/messages` ⇒ 403 (DENY đứng cạnh C-3)                                                                                | xanh/neo |

Unit MỚI `F/file-list.service.spec.ts`: U-1 mapper che đúng bốn trường, giữ phần còn lại · U-2 policy chỉ gọi SAU khi tx resolve ·
U-3 tách live/`everLinked` từ một lô · U-4 action = View, input = `fileSelfPolicyInput` · U-5 N hàng `deny-no-resolver` ⇒ đúng MỘT
`logger.error` (đếm + tập `(moduleCode, entityType)` + ≤ 5 `fileId`, không tên tệp); `deny-error` ⇒ list KHÔNG log thêm; DENY thường ⇒ không
log · U-6 MỘT truy vấn link cho N hàng, điều kiện có `company_id`; 0 hàng ⇒ 0 truy vấn · U-8 một nguồn: `getMetadata` và `list` cùng gọi
hàm export của `F/file-view-decision.ts` (spy), và `F/file-list.service.ts` không chứa literal `FOUNDATION_ENTITY`. Contracts U-7:
`it.each(FORBIDDEN_KEYS)` cho `fileListItemSchema` + khoá lạ bị strip · `fileListItemSchema` nhận `null` và nhận đủ · `fileMetadataSchema` vẫn
từ chối `null`. FE: `FilesPage.spec.tsx` thêm ca hàng che (ô che hiện, không vỡ trang, KHÔNG có nút Xem trên hàng che; hàng đủ vẫn có).
Trạng thái 403 trang chi tiết: ca có sẵn `FileDetailPage.spec.tsx:122` giữ nguyên.

Mutant ★ phải đỏ: View→Download (U-4) · `everLinked` cứng `false` (R-4) · lọc hàng thay vì che (R-1/R-6) · chỉ che tên (R-1) · bỏ che
`ownerUserId` (R-1/U-1) · policy trong tx (U-2) · truy vấn link mỗi tệp (U-6) · bỏ `eq(companyId)` trong `listAllByFileIdsTx` (U-6) · log mỗi
hàng (U-5) · list tự dựng input thay vì hàm chung (U-8) · lỗi quyết định thành ALLOW (U-5/R-5) · hàng che vẫn có nút Xem (FE).

## 6. Phép đo còn phải làm

- L1 [SUY RA]: bài trong nhóm kín G với `fileViewer` ⇒ `GET /:id` 403 (nếu kit không dựng được nhóm kín rẻ ⇒ dùng khuôn «bài ẩn» của
  ATTMETAMASK `:136-160`, ghi vào sổ vết) · `admin` với F_grp: kỳ vọng R-3 suy từ `GET /:id`, KHÔNG viết cứng · fixture CHAT cho C-1/C-2/C-3
  (nếu tốn > 1 lượt dựng ⇒ dẫn ca có sẵn ghim cùng điều, ghi khoảng trống vào sổ vết; RIÊNG C-3d luôn viết MỚI trên
  `/chat/oversight/rooms/:id/messages`, không thay bằng ca 16 — guard quyền chặn trước khi nạp phòng nên rẻ) · F_nores: đo migration có CHECK trên
  `file_links.module_code` không — chọn `(moduleCode, entityType)` NẰM TRONG CHECK mà không có resolver đăng ký · R-7 vế link chéo tenant:
  FK một cột (§3) ⇒ kỳ vọng gieo được bằng SQL; RLS/FK chặn từ gốc ⇒ ghi sổ «RLS/FK chặn từ gốc». Mutant bỏ `eq(companyId)` chỉ đỏ ở R-7
  khi vai test bỏ qua RLS — ghi kết quả thật, U-6 là lưới chính.
- RED chạy trên mã CŨ trước với `bash harness/check.sh --lane-db=fmg` (deny-path thực thi thật); chép nguyên dòng
  «Tests N passed | M failed | 0 skipped» vào §9.3.
- Verify: `bash harness/check.sh --all --lane-db=fmg` · typecheck api + app + contracts · gitleaks nhánh.

## 7. Lát thi công

- **L0** — commit `chore(docs)` riêng chỉ `harness/backlog.mjs`: thêm vào `paths` của WO `apps/app/src/routes/system/files/**` +
  `apps/app/src/i18n/locales/vi/system.ts` + `apps/app/src/routes/recruit/candidate-file-api.ts` (FE D-3). Tệp mới ở `F/` đã nằm trong
  `apps/api/src/foundation/files/**`.
- **L1 RED** — int-spec + unit + contracts spec ở §5 trên mã cũ; ghi ca đỏ/xanh vào §9.3.
- **L2 GREEN** — D-5: `file-view-decision.ts` → mapper → repo `listAllByFileIdsTx` → `FileListService` → controller/module → bỏ
  `FileService.list` + ba hàm private; 2 unit spec cũ.
- **L3 contracts** — `fileListItemSchema` + docblock bất biến 1.
- **L4 FE** — `FilesPage.tsx` schema mới + ô che + ẩn nút Xem hàng che + i18n + spec · `candidate-file-api.ts:9` sửa comment một dòng cho
  khớp bất biến 1.
- **L5 docs API** — `docs/API Design/API-09_FOUNDATION_API_Design.md` mục route tệp (`:137-141`): list trả `fileListItem`, bốn trường
  nullable theo quyết định xem từng tệp; CHAT + giám sát CHAT giữ nguyên (D-2, D-2b).
- **L6 gate** — FULL: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` + `santa-method` một vòng có trần (hội tụ trên
  «một vị từ = `GET /:id`» · «giữ hàng» · «không N+1, không lồng tx») + `typescript-reviewer` + `react-reviewer` (L4) + `quality-gate`
  (coverage ≥ 80% cho tệp mới).

## 8. [OWNER]

| #   | Việc                                                                                                                                    | Chốt                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| O-1 | Ưu tiên theo số đo kênh owner                                                                                                           | Đã chọn: tới PR hôm nay                                                            |
| O-2 | CHAT giữ phạm vi «chủ tệp chia sẻ vào phòng» (D-2)?                                                                                     | **Owner chốt 19/10: GIỮ** — không đổi mã; neo C-1/C-2                              |
| O-3 | Trường còn lại trên hàng che                                                                                                            | **Owner chốt 19/10:** che thêm `ownerUserId`; hàng che không điều hướng            |
| O-4 | Push nhánh / mở PR / merge đều là công bố ⇒ push sát giờ; merge `--admin` ⇒ chờ Pages xanh ⇒ `m prod-update api` liền mạch (cửa sổ D-3) | Luồng chính quyết giờ push ~17:50–18:15                                            |
| O-5 | Smoke PROD sau deploy: Hệ thống › Tệp — hàng không xem được hiện ô che, không có nút Xem; `GET /:id` hàng đó 403                        | Sau deploy; kỳ vọng số hàng ở kênh owner                                           |
| O-6 | Biên GHI link tệp — rà theo cùng bất biến                                                                                               | **Owner chốt 19/10:** gieo WO theo dõi (luồng chính, lượt sổ tối nay)              |
| O-7 | Giám sát CHAT (CHAT-API-018c) trả tên/cỡ đính kèm toàn tenant qua cặp nhạy cảm, audit mỗi lần đọc, 0 URL ký                             | **Owner chốt 19/10: phạm vi toàn tenant CÓ CHỦ ĐÍCH** — không đổi mã; neo C-3/C-3d |

## 9. Ngoài phạm vi · nợ · rủi ro

- Ngoài phạm vi: `GET /foundation/files/:id` (đã có quyết định, không đổi) · CHAT (D-2) · giám sát CHAT (D-2b) · danh sách tệp module
  (§1.1 #8) và biên GHI link tệp — rà theo cùng bất biến ở WO theo dõi (O-6, luồng chính gieo).
- Nợ: `F/files.service.ts` vẫn > 800 dòng sau WO (giảm, chưa đạt — FILEDEBT) · filter `moduleCode`/`entityType`/`entityId` của
  `listFilesQuerySchema` (`C/files.ts:140-142`) FE có gửi nhưng `listTx` chưa áp — giữ nguyên, ghi nhận.
- Rủi ro: (a) dispatch tuần tự ≤ 100/trang ⇒ độ trễ màn quản trị tăng — chấp nhận, đo ở verify; (b) cửa sổ D-3 — đường lùi:
  `m prod-rollback` API (FE mới đọc được API cũ); (c) [SUY RA] §6 — đường lùi ghi sẵn.

### 9.3 Sổ vết

| Mốc              | Lúc              | Ghi                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1          | 19/10/2026 13:58 | Trên `68f8719b`. D-1 giữ hàng, che ba trường theo vị từ của `GET /:id` · D-2 CHAT giữ phạm vi chủ tệp (chờ O-2) · D-3 schema list riêng + FE (L0) · D-5 tách tệp.                                                                                                                                                                                                                                                                                                                                                                                        |
| Plan-review      | 19/10/2026 14:17 | Verdict BLOCK, 8 finding — kiểm từng cái bằng mã, ÁP HẾT, từ chối 0. F1 thêm đường giám sát CHAT (§1, §1.1 #6, D-2b, C-3/C-3d) + bảng §1.1 đủ · F2 `F/file-view-decision.ts` một nguồn (U-8) · F3 một log mỗi request, không log lại `deny-error` (U-5) · F4 `listAllByFileIdsTx` có `company_id`, R-7 vế link chéo tenant · F5 che `ownerUserId` + không điều hướng · F6 U-7 `FORBIDDEN_KEYS` + kiểu trả · F7 R-3 hết trang, R-6 hai trang, RED `--lane-db=fmg`, CHECK `module_code` · F8 O-4 push = công bố, `candidate-file-api.ts` vào L0.           |
| Plan v2          | 19/10/2026 14:17 | Owner chốt 19/10: O-2 GIỮ · O-3 che `ownerUserId` + không điều hướng · O-6 gieo WO theo dõi · O-7 giám sát CHAT phạm vi toàn tenant có chủ đích.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Re-review        | 19/10/2026 14:28 | Áp M1 (thêm C-2b — đường gắn thứ hai qua `POST /foundation/files/:id/links`) · L1 (C-3d luôn viết mới trên `/messages`) · L2 (câu chữ bất biến 5 khớp D-4) · L3 (mẫu grep thêm `fileName`/`original_name`/`size_bytes`, phân loại các dòng import/dọn tệp tạm/nội bộ URL ký).                                                                                                                                                                                                                                                                            |
| L1 RED — fixture | 19/10/2026 14:28 | Đo mã khi viết ca: (a) F_grp dựng theo đường lùi §6 = đính kèm bài bị ẨN của tác giả (khuôn ATTMETAMASK), đặt tên F_hid trong spec; `member` = tác giả. (b) `file_links.module_code` KHÔNG có CHECK (grep `migrations/*.sql`) ⇒ F_nores = `(LEAVE, leave_request)` — không resolver đăng ký. (c) mig 0535 đổi FK `file_links.file_id` sang FK tenant ghép ⇒ R-7 vế link chéo tenant kỳ vọng DB TỪ CHỐI (23503) — spec ghi nhận cả hai nhánh, U-6 là lưới chính. (d) CHAT dựng bằng `helpers/seed` trong tenant A của cùng world (kit chỉ nhận cặp feed). |
