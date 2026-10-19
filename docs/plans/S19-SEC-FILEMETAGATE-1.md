# S19-SEC-FILEMETAGATE-1 — tên/cỡ tệp chỉ đi theo quyết định xem từng tệp: danh sách tệp FOUNDATION + DTO đính kèm CHAT

> Plan v1 · 19/10/2026 · trên `68f8719b` · worktree `MediaOS-fmg` nhánh `fix/s19-sec-filemetagate-1` · 🔴 FULL gate.
> Số đo chi tiết (census, ví dụ cụ thể) ở kênh owner ngoài repo — repo PUBLIC, plan này chỉ ghi bất biến đích.
> Viết tắt: `F/` = `apps/api/src/foundation/files/` · `C/` = `packages/contracts/src/` · `T/` = `apps/api/test/` · `H/` = `apps/api/src/chat/`.
> [ĐO] = đã đọc mã ở `68f8719b` · [SUY RA] = chưa đo, L1 đo.

## 1. Phạm vi + nguồn

- WO: `harness/backlog.mjs` mục `S19-SEC-FILEMETAGATE-1` (done_when ba vế: đo trước · một bất biến mỗi đường · RED deny-path + ALLOW đứng cạnh).
- Tiền lệ đã ship: `docs/plans/S16-SOCIAL-ATTMETAMASK-1.md` (#591) — một vị từ · GIỮ phần tử, `null` tên/cỡ · WS giữ khoá.
- Hai đường đọc trong phạm vi: (1) `GET /foundation/files` (danh sách) · (2) DTO đính kèm CHAT (REST tin/tab Tệp + WS `chat:message`).

## 2. Bất biến đích

1. **Một vị từ cho danh sách FOUNDATION:** `originalName` · `fileExtension` · `sizeBytes` của một hàng khác `null` ⇔ quyết định XEM của
   CHÍNH người gọi cho đúng tệp đó là ALLOW — cùng hàm, cùng đầu vào với `GET /foundation/files/:id`. Hệ quả kiểm được: hàng có tên ⇔
   `GET /:id` cùng người gọi = 200.
2. Hàng không bị bỏ (phân trang + `total` giữ nguyên nghĩa).
3. CHAT: metadata đính kèm = nội dung tin do CHỦ TỆP chia sẻ vào phòng (phạm vi chốt có chủ đích — D-2, cần owner O-2).
4. Không đường nào trong phạm vi ghi tên tệp vào log khi từ chối.

## 3. Phép đo đã có [ĐO]

- Route: `F/files.controller.ts:78-85` (list, gate `view:foundation-file`) · `:87-92` (theo id).
- `F/files.service.ts` (1.132 dòng): `getMetadata` `:433-462` — `loadLinkContext` (`:988-996`) rồi `decideForLinkedFile(View)` `:441-447`;
  `list` `:468-487` — `listTx`+`countTx` trong một `withTenant`; `policyInputForFile` `:998-1010`;
  `toMetadataDto` `:1098-1122`.
- `F/file.repository.ts:323-348` `listTx`/`countTx` (lọc `company_id` · `deleted_at` · `visibility`).
- `F/file-link.repository.ts:49-56` `hasEverBeenLinkedTx` (KHÔNG lọc `deleted_at`) · `:59-70` `listByFileTx` (link sống).
- `F/file-policy.service.ts:199-267` `decideForLinkedFile`: 0 link ⇒ `everLinked` ? `deny-links-revoked` : fallback `FOUNDATION.FILE.*`
  (`:215-228`); link thiếu resolver ⇒ `deny-no-resolver`; AND mọi link; ném ⇒ `deny-error` (`:263-266`). Không truy cập DB.
- CHAT: `H/chat-attachments.service.ts:49-55` (fail-soft có chủ ý) · `:193-215` link cả lô MỘT truy vấn + quyết định TUẦN TỰ · `:79-83`
  (cấm lồng `withTenant` — treo trên PgBouncer) · `:329-343` `toDto`. Tiền đề chủ tệp: `H/chat-attachments.repository.ts:78-108`
  (`owner_user_id = người gửi`) · `H/chat-message-file.resolver.ts:110-111` (`canLinkFile → canAttach`, `:180`).
- Contracts: `C/files.ts:156-184` `fileMetadataSchema` (`originalName`/`sizeBytes` non-null) · `:127-144` query · `:67` `PAGE_LIMIT_MAX = 100` ·
  `C/chat.ts:176-204` `chatAttachmentSchema` (`name`/`sizeBytes` non-null; cảnh báo «bỏ nullable = trắng trang») · `C/realtime.ts:100-108`
  `wsChatAttachmentSchema` (`name`/`sizeBytes`).
- FE: duy nhất `apps/app/src/routes/system/files/FilesPage.tsx` gọi list (`:32` `z.array(fileMetadataSchema)` · `:56-77` cột tên/cỡ ·
  `:128`); phân trang heuristic «trang đầy ⇒ còn trang sau» (`:11-12`). `FileDetailPage.tsx:168-170` dùng `GET /:id` (không đổi).
  `apps/console` không gọi.
- Spec đang gọi list chỉ kiểm status: `T/integration/s14-recruit-filegrant1-cv.int-spec.ts:456,468` · `s15-payroll-be5b-pdf.int-spec.ts:352`.
  Unit: `F/files.controller.spec.ts:22,32,57` · `F/files.service.spec.ts:642-644`.
- Realtime FOUNDATION: `grep originalName apps/api/src/realtime` = 0 ⇒ không có payload WS tệp FOUNDATION.
- Kit: `T/helpers/social-qa1-kit.ts:64-68` (`view:foundation-file` trong cặp cho phép) · `:191` `bootQa1World` (`applyMainPipeline` `:210`) ·
  `createGroup` `:717` · `joinAsActiveMember` `:756`. Tiền lệ seed tệp bằng SQL (không PUT storage):
  `T/integration/s16-social-attmetamask-1.int-spec.ts:80-101`.

## 4. Quyết định

**D-1 — Danh sách FOUNDATION: GIỮ hàng, `originalName`/`fileExtension`/`sizeBytes` = `null` khi quyết định xem là DENY.**
Vị từ = `decideForLinkedFile(policyInputForFile(user, id, View), liveLinks, View, everLinked).allow`. Lý do giữ hàng (không lọc): lọc
sau `LIMIT/OFFSET` làm trang hụt ⇒ FE heuristic dừng sớm ⇒ tệp được phép ở trang sau không với tới; lọc trong SQL không làm được
(quyết định đi qua resolver). `fileExtension` che cùng vì là đuôi của tên. Các trường còn lại giữ nguyên (O-3).

**D-1b — Theo lô, không N+1.** MỘT truy vấn link cho cả trang (`file_id = ANY(ids)`, KHÔNG lọc `deleted_at`) ⇒ tách `live` +
`everLinked` — tương đương `listByFileTx` + `hasEverBeenLinkedTx`. Đọc hàng + `total` + link trong MỘT `withTenant`; quyết định chạy
TUẦN TỰ SAU khi tx xong (khuôn `H/chat-attachments.service.ts:193-215`). Chi phí đã biết: ≤ 100 dispatch/trang, màn quản trị.

**D-2 — CHAT: không đổi mã; phạm vi «chủ tệp chia sẻ vào phòng» chốt có chủ đích (O-2).** Lý do: (a) tiền đề chủ tệp ở cả hai đường
gắn (§3) ⇒ tên/cỡ là thứ chủ tệp tự đưa vào tin, người nhận đã qua `assertMember`; luật AND chặn BYTE, không chặn lời chủ tệp; (b) che
⇒ `chatAttachmentSchema.name`/`sizeBytes` nullable ⇒ bundle FE cũ ZodError trắng trang tin (`C/chat.ts:176-181`), WS phát cả phòng phải
ép `null` cho mọi người. Owner bác ⇒ tách WO riêng (contracts + FE chat + WS hai tầng), KHÔNG vào PR này. Hai ca NEO ghim quyết định
và tiền đề (C-1, C-2).

**D-3 — Contract + FE tương thích.** `fileMetadataSchema` KHÔNG đổi (theo id · HR · TASK giữ non-null). THÊM `fileListItemSchema =
fileMetadataSchema.extend({ originalName: z.string().nullable(), sizeBytes: z.number().int().nonnegative().nullable() })` + type
`FileListItemDto` ở `C/files.ts`, docblock ghi bất biến 1. FE `FilesPage.tsx` dùng schema mới + ô che (i18n `files.masked.*`).
Cửa sổ deploy: FE mới + API cũ ⇒ bình thường; API mới + FE cũ ⇒ trang Tệp báo lỗi (fail-closed, không lộ) cho tới khi tải bundle mới
⇒ deploy API SAU khi Pages xanh (§8).

**D-4 — Audit/log.** Không đổi `audit_logs`/`file_access_logs` (list chưa từng ghi; ghi DENY mỗi lần tải trang = nhấn chìm bảng
append-only dùng chung — cùng lý do `H/chat-attachments.service.ts:88-90`). Thêm `logger.error` khi lý do `deny-no-resolver`/`deny-error`
(fileId + reason, KHÔNG tên) — resolver rơi khỏi đăng ký không được che im lặng cả bảng.

**D-5 — Vị trí mã (không phình `files.service.ts`).** MỚI `F/file-metadata.mapper.ts` (hàm thuần `toFileMetadataDto` chuyển từ
`:1098-1122` + `toFileListItemDto(row, canView)`) · MỚI `F/file-list.service.ts` (`FileListService.list`, ~110 dòng) · `F/file-link.repository.ts`
thêm `listAllByFileIdsTx` (0 id ⇒ không truy vấn) · `F/files.controller.ts` tiêm `FileListService` cho list · `F/files.module.ts` provider ·
`F/files.service.ts` BỎ `list()` + thân `toMetadataDto` (gọi mapper) ⇒ số dòng GIẢM. Sửa 2 unit spec cũ (ctor controller; chuyển ca list
`:642-644` sang spec mới) — không đụng int-spec storage nào.

## 5. Ca test viết TRƯỚC

Int-spec MỚI `T/integration/s19-sec-filemetagate-1.int-spec.ts` qua `bootQa1World` (⇒ `applyMainPipeline`); tệp seed bằng SQL ⇒ không
PUT storage (không cần `resolveStorageTestTarget`; nếu lát nào cần PUT thì đi qua helper đó). Actor tenant A: `fileViewer`
(`view:feed`+`view:foundation-file` @Company, KHÔNG thuộc nhóm kín G) · `member` (ACTIVE trong G + `view:foundation-file`) · `admin`
(`company-admin`) · `noFilePair` (`view:feed`). Tenant B: `viewerB`. Tệp: F_grp (đính kèm bài trong G) · F_pub (bài audience company) ·
F_free (0 link) · F_rev (link đã gỡ mềm) · F_nores (link module không resolver) · F_B (tenant B).

| Ca   | Actor                       | Kỳ vọng                                                                                     | Mã cũ    |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------- | -------- |
| R-1  | fileViewer                  | hàng F_grp CÓ, `id` đúng, ba trường `null`; thân response không chứa tên F_grp              | ĐỎ       |
| R-1a | fileViewer                  | cùng response: F_pub + F_free đủ trường (ALLOW đứng cạnh)                                   | xanh     |
| R-2  | member                      | F_grp đủ trường                                                                             | xanh     |
| R-3  | fileViewer · member · admin | MỌI hàng: `originalName !== null` ⇔ `GET /:id` cùng actor = 200                             | ĐỎ       |
| R-4  | fileViewer                  | F_rev che (`deny-links-revoked`)                                                            | ĐỎ       |
| R-5  | fileViewer                  | F_nores che (`deny-no-resolver`)                                                            | ĐỎ       |
| R-6  | fileViewer                  | số hàng = min(limit, tổng) và `pagination.total` = tổng — hàng che không bị bỏ              | xanh/neo |
| R-7  | fileViewer · viewerB        | A không thấy id F_B; B không thấy id tệp A                                                  | xanh/neo |
| R-8  | noFilePair                  | 403 guard                                                                                   | xanh/neo |
| C-1  | thành viên phòng, ngoài G   | tin kèm F_c (của người gửi, thêm link tới bài G) ⇒ `url` null, `name`/`sizeBytes` còn (D-2) | xanh/neo |
| C-2  | thành viên phòng            | gửi tin kèm `fileId` không phải của mình ⇒ bị từ chối, 0 link mới                           | xanh/neo |

Unit MỚI `F/file-list.service.spec.ts`: U-1 mapper che đúng ba trường, giữ phần còn lại · U-2 policy chỉ gọi SAU khi tx resolve ·
U-3 tách live/`everLinked` từ một lô · U-4 action = View, input đúng khuôn `policyInputForFile` · U-5 `deny-no-resolver`/`deny-error` ⇒
`logger.error` không chứa tên; DENY thường ⇒ không log · U-6 MỘT truy vấn link cho N hàng; 0 hàng ⇒ 0 truy vấn.
Contracts U-7: `fileListItemSchema` nhận `null` và nhận đủ; `fileMetadataSchema` vẫn từ chối `null`. FE: `FilesPage.spec.tsx` thêm ca
hàng che (ô che hiện, không vỡ trang).

Mutant ★ phải đỏ: View→Download (U-4) · `everLinked` cứng `false` (R-4) · lọc hàng thay vì che (R-1/R-6) · chỉ che tên (R-1) · policy
trong tx (U-2) · truy vấn link mỗi tệp (U-6) · lỗi quyết định thành ALLOW (U-5/R-5).

## 6. Phép đo còn phải làm

- L1 [SUY RA]: bài trong nhóm kín G với `fileViewer` ⇒ `GET /:id` 403 (nếu kit không dựng được nhóm kín rẻ ⇒ dùng khuôn «bài ẩn» của
  ATTMETAMASK `:136-160`, ghi vào sổ vết) · `admin` với F_grp: kỳ vọng R-3 suy từ `GET /:id`, KHÔNG viết cứng · fixture CHAT cho C-1/C-2
  (nếu tốn > 1 lượt dựng ⇒ dẫn ca có sẵn ghim luật chủ tệp, ghi vào sổ vết) · RED chạy trên mã CŨ trước, ghi số ca đỏ.
- Verify: `bash harness/check.sh --all --lane-db=fmg` (deny-path chạy thật) · typecheck api + app + contracts · gitleaks nhánh.

## 7. Lát thi công

- **L0** — commit `chore(docs)` riêng chỉ `harness/backlog.mjs`: thêm vào `paths` của WO `apps/app/src/routes/system/files/**` +
  `apps/app/src/i18n/locales/vi/system.ts` (FE D-3).
- **L1 RED** — int-spec + unit + contracts spec ở §5 trên mã cũ; ghi ca đỏ/xanh vào §9.3.
- **L2 GREEN** — D-5: mapper → repo `listAllByFileIdsTx` → `FileListService` → controller/module → bỏ `FileService.list`; 2 unit spec cũ.
- **L3 contracts** — `fileListItemSchema` + docblock bất biến 1.
- **L4 FE** — `FilesPage.tsx` schema mới + ô che + i18n + spec.
- **L5 docs API** — `docs/API Design/API-09_FOUNDATION_API_Design.md` mục route tệp (`:137-141`): list trả `fileListItem`, ba trường
  nullable theo quyết định xem từng tệp; CHAT giữ nguyên (D-2).
- **L6 gate** — FULL: `security-reviewer` + `database-reviewer` + `silent-failure-hunter` + `santa-method` một vòng có trần (hội tụ trên
  «một vị từ = `GET /:id`» · «giữ hàng» · «không N+1, không lồng tx») + `typescript-reviewer` + `react-reviewer` (L4) + `quality-gate`
  (coverage ≥ 80% cho tệp mới). PR trước 18:15.

## 8. [OWNER]

| #   | Việc                                                                                                        | Mặc định đề xuất        |
| --- | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| O-1 | Ưu tiên theo số đo kênh owner                                                                               | Đã chọn: tới PR hôm nay |
| O-2 | CHAT giữ phạm vi «chủ tệp chia sẻ vào phòng» (D-2)? Bác ⇒ WO riêng                                          | Đồng ý D-2              |
| O-3 | Chấp nhận các trường còn lại trên hàng che (`id` · MIME · trạng thái · thời điểm · chủ tệp · `total`)?      | Chấp nhận               |
| O-4 | Merge `--admin` ⇒ CHỜ Pages xanh ⇒ `m prod-update api` (cửa sổ D-3); merge = công bố ⇒ deploy trong ngày    | 18:40–19:00 tối nay     |
| O-5 | Smoke PROD: vai không phải admin mở Hệ thống › Tệp — hàng không xem được hiện ô che; `GET /:id` hàng đó 403 | Sau deploy              |
| O-6 | Đề xuất rà tiếp ở kênh owner (ngoài phạm vi) — có seed WO không?                                            | Owner chốt              |

## 9. Ngoài phạm vi · nợ · rủi ro

- Ngoài phạm vi: `GET /foundation/files/:id` (đã có quyết định, không đổi) · CHAT (D-2) · các DTO module khác compose tên tệp từ
  `files` — rà theo cùng bất biến ở WO riêng nếu owner chốt (O-6, số đo kênh owner).
- Nợ: `F/files.service.ts` vẫn > 800 dòng sau WO (giảm, chưa đạt — FILEDEBT) · filter `moduleCode`/`entityType`/`entityId` của
  `listFilesQuerySchema` (`C/files.ts:140-142`) FE có gửi nhưng `listTx` chưa áp — giữ nguyên, ghi nhận.
- Rủi ro: (a) dispatch tuần tự ≤ 100/trang ⇒ độ trễ màn quản trị tăng — chấp nhận, đo ở verify; (b) cửa sổ D-3 — đường lùi:
  `m prod-rollback` API (FE mới đọc được API cũ); (c) [SUY RA] §6 — đường lùi ghi sẵn.

### 9.3 Sổ vết

| Mốc     | Lúc              | Ghi                                                                                                                                                               |
| ------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan v1 | 19/10/2026 13:58 | Trên `68f8719b`. D-1 giữ hàng, che ba trường theo vị từ của `GET /:id` · D-2 CHAT giữ phạm vi chủ tệp (chờ O-2) · D-3 schema list riêng + FE (L0) · D-5 tách tệp. |
