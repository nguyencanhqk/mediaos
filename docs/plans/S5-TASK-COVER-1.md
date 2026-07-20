# S5-TASK-COVER-1 — Ảnh bìa công việc (chọn từ tệp đã đính kèm)

> **rev3** — bake 7 điểm BLOCKING vòng 2 (đánh dấu 🔺). rev2 đã bake 7 điểm vòng 1 (đánh dấu 🔧).
> Vòng 2 bắt được 2 **mâu thuẫn nội bộ** của rev2: bake bản vá vào một mục nhưng để nguyên văn bản
> cũ mâu thuẫn ở mục khác (§8 bẫy 5, §6 bước 2) — implementer đọc mục kia sẽ làm ngược lại bản vá.
> Bài học: sửa plan phải grep lại TOÀN file theo từ khoá vừa đổi, không chỉ sửa tại chỗ.
> Vùng: 🔴 red (chạm file-link + presign = kiểm soát truy cập tệp) → FULL gate.
> Base: nhánh `feat/s5-task-ux-batch` (COVER-1 `depends_on` S5-TASK-AVATAR-1 — code avatar CHƯA lên master; PR #248).

---

## 0. ĐÍNH CHÍNH TIỀN ĐỀ CỦA WORK ORDER (đọc trước tiên)

WO trong `harness/backlog.mjs` mô tả phương án `linkType='Cover'` + `isPrimary=true` và khẳng định
**"KHÔNG CẦN MIGRATION"**. Hai vế này **không thể cùng đúng**:

| WO nói | Thực tế đã xác minh |
| --- | --- |
| `linkType='Cover'` | `'Cover'` **không tồn tại** — 0 lần xuất hiện trong toàn repo |
| — | `chk_file_links_link_type` (mig `0433_foundation_db3_files.sql:159-160`) CHECK chỉ cho `Avatar / Attachment / Contract / Proof / Document / Import / Export / Other` |
| — | `FILE_LINK_TYPE_VALUES` (`packages/contracts/src/files.ts:37-46`) mirror đúng danh sách đó |

⇒ Dùng `'Cover'` **bắt buộc** migration ALTER CHECK + đổi enum contracts + cập nhật DB-08 §8.7.

**Owner đã chốt (2026-07-20, phiên này): phương án giữ lời hứa KHÔNG MIGRATION.**

### Phương án đã chốt — "ảnh bìa = tệp đính kèm được đánh dấu `is_primary`"

Không tạo link mới, không thêm `link_type`. Chỉ **lật cờ `is_primary`** trên CHÍNH dòng
`file_links` của tệp đã đính kèm.

Vì sao đúng và an toàn:

1. **Unique index có sẵn ép đúng 1 bìa/task, không cần thêm gì.**
   `uq_file_links_primary_per_entity_type` (0433:174-177) =
   `(company_id, module_code, entity_type, entity_id, link_type) WHERE is_primary = true AND deleted_at IS NULL`.
   Với `link_type='Attachment'` ⇒ mỗi task chỉ có tối đa MỘT attachment `is_primary`. Đó chính là ảnh bìa.
2. **Tính chất an toàn then chốt của WO trở thành CẤU TRÚC, không còn là lệnh kiểm có thể quên.**
   WO muốn "chỉ nhận fileId ĐÃ là Attachment SỐNG của CHÍNH task đó ⇒ đặt bìa KHÔNG cấp quyền đọc file mới".
   Ở phương án này ảnh bìa **chính là** dòng attachment — không tồn tại đường nào đặt bìa bằng file
   chưa đính kèm, kể cả khi ai đó sau này quên một lệnh kiểm.
3. 🔧 **`is_primary` là cột ĐA-NGƯỜI-GHI và CÓ được đọc — KHÔNG được tin nó một mình.**
   (rev1 viết sai rằng cột này chỉ ghi một chỗ và không ai đọc. Đính chính:)
   - Ghi tuỳ ý từ ngoài: `POST /foundation/files/:id/links` (`files.controller.ts:123`) nhận `isPrimary`
     **verbatim** từ body → `files.service.ts:584`. `FileService.link` chỉ kiểm tenant + `scan_status !== 'Infected'`
     — **không** kiểm `image/*`, **không** kiểm `Uploaded`, **không** owner-check. Người có
     `link:foundation-file` + `file-upload:task` đặt được bìa vòng qua toàn bộ §2.2, không sinh `TASK_COVER_SET`.
   - Xoá vòng ngoài: `DELETE /foundation/files/:id/links/:linkId` làm bìa biến mất im lặng.
   - Được đọc: `files.service.ts:1019` (`FileMetadataDto.links[].isPrimary`) và `toLinkDto` `:1034`.

   ⇒ **ĐƯỜNG ĐỌC LÀ BIÊN AN TOÀN.** `findVerifiedTaskCoversTx` (§3.1) phải tự phòng vệ đầy đủ, không
   dựa vào việc đường ghi §2.2 đã kiểm. Đây chính là học thuyết đã ghi trong docblock `AvatarPresignService`
   ("SELF-DEFENDING — KHÔNG tin cột đa-người-ghi"), nay áp cho `is_primary`.
   Chấp nhận: bìa có thể đổi qua đường foundation mà không có dòng activity — ghi nhận, không vá đợt này.
4. **Ghi được.** `GRANT SELECT, INSERT, UPDATE ON file_links TO mediaos_app` (0433:181) — có UPDATE, không cần DELETE.
5. **Activity log không cần migration.** `task_activity_logs.action` là `text` tự do; chỉ `target_type` có CHECK
   (`chk_task_activity_target_type`, 0478:218-220) và `'File'` đã nằm trong danh sách.

**Đánh đổi đã chấp nhận:** `is_primary` trên Attachment mang thêm nghĩa "là ảnh bìa". Bù lại bằng
docblock tường minh ở cả repo lẫn service (mục 8).

---

## 1. Phạm vi

**Trong phạm vi:** đặt/gỡ ảnh bìa từ tệp đã đính kèm · trả `coverUrl` (URL đã ký) trên board + chi tiết ·
nút trong `TaskFilePanel` · thẻ board render bìa · int-spec deny-path.

**Ngoài phạm vi:** luồng upload riêng cho bìa (owner đã loại) · crop/resize · bìa cho project · bìa cho subtask
(kế thừa tự nhiên vì subtask cũng là task, nhưng KHÔNG thêm UI riêng đợt này).

---

## 2. Backend — ghi (đặt / gỡ bìa)

### 2.1 Repository (`apps/api/src/tasks/task-file.repository.ts`)

Thêm **3** method (giữ khuôn hiện có: nhận `tx` + `companyId`, AND `company_id` tường minh dù đã có RLS).
⚠️ rev2 ghi "2 method" nhưng §2.2 bước 3 cần thêm một cái nữa cho vị từ độc quyền — khai luôn ở đây kẻo
lúc code lại đi query ad-hoc trong service:

```text
countOtherLiveLinksTx(tx, companyId, taskId, fileId): Promise<number>
  đếm link SỐNG của fileId ở BẤT KỲ entity nào KHÁC (task này). >0 ⇒ 409 ở setCover.
  ⚠️ phải KHỚP LOGIC với vị từ NOT EXISTS ở §3.1 — lệch nhau thì setCover cho qua mà
     đường đọc lại trả null (bìa "đặt được nhưng không hiện").

findPrimaryLinkTx(tx, companyId, taskId): Promise<{ linkId, fileId } | undefined>
  SELECT ... FROM file_links
  WHERE company_id, module_code='TASK', entity_type='task', entity_id=taskId,
        link_type='Attachment', is_primary = true, deleted_at IS NULL
  FOR UPDATE                       -- 🔧 tuần tự hoá 2 người đặt bìa cùng lúc

setPrimaryTx(tx, companyId, linkId, isPrimary): Promise<void>
  UPDATE file_links SET is_primary = $isPrimary, updated_at = now()
  WHERE id = linkId AND company_id = companyId AND deleted_at IS NULL
```

🔧 **`findPrimaryLinkTx` CHỈ truy vấn `file_links` — CẤM join `files`, cấm lọc mime/upload/scan.**
Lý do (bẫy tất định, không phải lý thuyết): `TaskFileService.delete` chỉ soft-delete **`files`**
(`files.service.ts:736`), **dòng `file_links` vẫn sống với `is_primary = true`**. Nếu implementer tiện tay
nhân bản truy vấn §3.1 (có join `files` + lọc `files.deleted_at`) thì primary "mồ côi" đó trở nên **vô hình**
⇒ đặt bìa mới không hạ được nó ⇒ đụng unique index ⇒ **23505 → 500, mọi lần**.
Đường ĐỌC lọc chặt (§3.1) để không hiển thị; đường DỌN phải thấy mọi thứ để hạ cờ.

### 2.2 Service (`apps/api/src/tasks/task-file.service.ts`)

```text
setCover(user, taskId, fileId): Promise<TaskFileDto>
  1. assertScope(user, taskId, ACTION_UPLOAD)          // 404 nếu task ngoài scope / cross-tenant
  2. row = loadLinkedFileOr404(user, taskId, fileId)    // 404 nếu file KHÔNG thuộc task này (cross-task IDOR)
  3. validate row:
       - !row.mimeType.startsWith('image/')      → 415 FOUNDATION_FILE_ERROR_CODES.MIME  🔧 (§7.2)
       - row.uploadStatus !== 'Uploaded'         → 409 NOT_PENDING
       - !DOWNLOADABLE_SCAN.has(row.scanStatus)  → 409  🔧 ngưỡng CHẶT ở đường GHI (§7.3)
       - 🔧 file còn link SỐNG ở entity KHÁC     → 409  (§3.1 vị từ độc quyền)
  4. TRONG MỘT withTenant tx duy nhất:
       🔺 pg_advisory_xact_lock(<classid hằng số module TASK>, hashtext(${taskId}::text))
          · rev2 viết `hashtextextended(taskId)` → SAI ARITY: hàm đó là (text, bigint) 2 tham số,
            và taskId là uuid nên phải ép ::text ⇒ 42883, setCover 500 **100% số lần**.
          · dạng 2 tham số (classid, objid) tránh va chạm không gian khoá TOÀN CỤC — repo đã dùng
            `pg_advisory_xact_lock(hashtext('ensure_default_company'))` ở mig 0473.
          · **xact** chứ không session-level: bắt buộc trên PgBouncer transaction-mode.
          · cần khoá vì FOR UPDATE không khoá được "hàng CHƯA tồn tại" (task chưa có bìa).
       cũ = findPrimaryLinkTx(tx, companyId, taskId)        -- FOR UPDATE
       nếu cũ?.linkId === row.linkId → no-op, trả luôn (idempotent, tránh UPDATE thừa)
       nếu cũ → setPrimaryTx(tx, ..., cũ.linkId, false)
       setPrimaryTx(tx, ..., row.linkId, true)
       🔺 audit.record(tx, { action:'FileLinkPrimaryChanged', objectType:'file_link',
                             objectId: linkId, before:{isPrimary}, after:{isPrimary} })
          TRONG CÙNG tx — xem ghi chú audit bên dưới.
  5. recordActivity(TASK_COVER_SET, targetType 'File', targetId fileId)
  6. 🔺 reload row SAU khi lật cờ rồi mới toDto — row ở bước 2 load TRƯỚC update nên
       response 200 sẽ mang `isCover:false`, sai ngay tại chính lời gọi vừa đặt bìa.
  🔺 BẮT 23505 **VÀ 40P01 (deadlock) VÀ 40001** → 409, KHÔNG BAO GIỜ để thành 500.
     Advisory lock chỉ tuần-tự-hoá các `setCover` với nhau; `POST /foundation/.../links` (isPrimary=true)
     và `unlink` KHÔNG lấy khoá đó nên vẫn chạm unique index / khoá hàng theo thứ tự ngược.
     Helper `isUniqueViolation` nằm ở **`apps/api/src/common/db-error.ts`** (rev2 trỏ nhầm
     `task-actions.service.ts:735`) — chỉ import, không cần thêm vào `paths`.

clearCover(user, taskId): Promise<void>
  1. assertScope(user, taskId, ACTION_UPLOAD)
  2. cũ = findPrimaryLinkTx(...) — không có → no-op idempotent (KHÔNG 404)
  3. setPrimaryTx(cũ.linkId, false)
  4. recordActivity(TASK_COVER_CLEARED)
```

⚠️ **Bước 4 phải nằm trong MỘT tx.** Tách 2 tx (hạ cũ rồi nâng mới) tạo cửa sổ 0-bìa; nâng-trước-hạ-sau
vi phạm unique index ⇒ 23505.

🔧 **"Một tx" chỉ chặn được 2-primary TRONG một tx — KHÔNG chặn được liên-transaction.** Hai người đặt bìa
đồng thời: cả hai đọc cùng primary cũ P → T1 hạ P + nâng F1 + commit → T2 (đã chờ khoá) hạ P + nâng F2 →
đụng unique → 23505. Vì vậy mới cần advisory lock ở bước 4 **và** bắt 23505 → 409.

🔺 **BẮT BUỘC có dòng `audit_logs`.** Mọi writer khác của `file_links` đều ghi audit:
`FileService.link` → `audit.record(objectType:'file_link', 'FileLinked')` (`files.service.ts:591`),
`unlink` → `'FileUnlinked'` (`:666`), cả hai kèm `file_access_logs`. `setCover`/`clearCover` mutate chính
bảng đó; chỉ ghi `task_activity_logs` là để lại **một đường ghi vô hình trong trail audit của `file_links`**
— FULL gate sẽ bắt, và DoD CLAUDE.md §8 đòi "audit log nếu hành động quan trọng".
**Không cần migration:** `action` là text tự do; `object_type` CHECK đã có `'file_link'` (mig
`0440_file1_audit_object_type.sql:25` — `v_new := ARRAY['file', 'file_link']`) ⇒ giữ nguyên lời hứa §9.

### 2.3 Controller (`apps/api/src/tasks/task-files.controller.ts`)

🔺 **`DELETE /tasks/:taskId/cover` KHÔNG khai được** — `TaskFilesController` là
`@Controller("tasks/:taskId/files")` (`task-files.controller.ts:39`), mọi route trong đó bắt buộc mang
tiền tố `/files`. Đường dẫn đổi thành `/files/cover`:

```text
POST   /tasks/:taskId/files/:fileId/cover   @RequirePermission('file-upload', 'task')
DELETE /tasks/:taskId/files/cover           @RequirePermission('file-upload', 'task')
```

🔺 **BẪY CHE ROUTE — `@Delete("cover")` PHẢI khai TRƯỚC `@Delete(":fileId")`.**
`@Delete(":fileId")` đã tồn tại ở `:95` và Nest khớp **theo thứ tự khai báo**: khai sau thì `"cover"` bị
bắt làm `fileId` → `loadLinkedFileOr404("cover")` → uuid không hợp lệ → 500/404 sai chỗ, và test dễ đọc
nhầm là "chưa implement". Thêm 1 ca test khẳng định `DELETE .../files/cover` **không** rơi vào `remove()`.
🔺 Sửa luôn chuỗi route trong `done_when[]` của WO (đang ghi `DELETE /tasks/:taskId/cover`).

**Chọn `file-upload:task`, KHÔNG phải `update:task`** — lý do (mời plan-reviewer phản biện, §7):
cặp `file-upload` đang gate chính việc đính kèm/gỡ tệp của task, chạy mode `'collab'` trong
`assertScope` (Viewer bị loại). Ai đã đính kèm/xoá được tệp thì chọn tệp nào làm bìa **không phải leo thang**.
Ngược lại gate bằng `update:task` sẽ kỳ quặc: người có `update:task` mà không có `file-upload` thì
không đính kèm được tệp nào, nên chẳng có gì để chọn làm bìa. Cả 2 cặp đều đã seed sẵn ⇒ không migration seed.

---

## 3. Backend — đọc (trả `coverUrl`)

### 3.1 Repository (`apps/api/src/foundation/files/file.repository.ts`)

`findVerifiedTaskCoversTx(companyId, taskIds, tx): Promise<VerifiedCoverMeta[]>` — mirror
`findVerifiedAvatarsTx`, self-defending, batch theo `taskIds`:

```
SELECT file_links.entity_id AS taskId, files.id AS fileId, files.storage_path
FROM file_links JOIN files ON files.id = file_links.file_id
WHERE file_links.company_id = $companyId
  AND file_links.module_code = 'TASK' AND file_links.entity_type = 'task'
  AND file_links.link_type  = 'Attachment'
  AND file_links.is_primary = true
  AND file_links.deleted_at IS NULL
  AND file_links.entity_id  = ANY($taskIds)     -- ⚠️ sql.param, xem §8 bẫy 3
  AND files.company_id = $companyId AND files.deleted_at IS NULL
  AND files.upload_status = 'Uploaded'
  AND files.scan_status IN ('Clean','NotRequired')   -- 🔺 xem ghi chú ngưỡng scan bên dưới
  AND files.mime_type LIKE 'image/%'
```

🔺 **Ngưỡng scan ở đường ĐỌC phải là `Clean|NotRequired`, KHÔNG phải `<> 'Infected'`** (đảo ngược §7.3 rev2).
`TaskFileService.getDownloadUrl` (`task-file.service.ts:100`) trả **409** khi `scanStatus ∉ DOWNLOADABLE_SCAN`,
docblock ghi rõ "defense against serving unscanned content". Nếu đường bìa ký cả `Pending`/`Failed` thì nó
thành **đường vòng qua chính chốt đó**: cùng một file, tải qua task thì 409, mà hiện làm ảnh bìa full-res
cho mọi người đọc board. Chốt ở đường GHI (§2.2) không cứu được — §0-3 đã chứng minh `is_primary` đặt được
qua `POST /foundation/files/:id/links` (`files.service.ts:568` chỉ chặn `Infected`).
Nguyên tắc: **biên an toàn không được lỏng hơn đường tải mà nó thay thế.**

`taskIds` rỗng → trả `[]` ngay (mirror avatar).

**KHÔNG có owner-check `files.owner_user_id = file_links.created_by`** như avatar — CÓ CHỦ ĐÍCH:
attachment của task vốn là cộng tác (A upload, B gắn), owner-check sẽ chặn nhầm case hợp lệ.

🔧 **NHƯNG bỏ owner-check TRẦN TRỤI là leo thang đọc nội dung thật — rev1 lập luận SAI về sự kiện.**
Lập luận cũ ("ai đọc được task thì đã đọc được mọi attachment qua `GET /tasks/:id/files`") sai vì
**`GET /tasks/:id/files` chỉ trả METADATA, không trả nội dung**. Đường tải nội dung thật là
`TaskFileService.getDownloadUrl` → `FileService.getDownloadUrl` (`files.service.ts:448`) →
`policy.decideForLinkedFile(...)` = **most-restrictive AND trên MỌI link sống của file**
(chứng minh: `file-policy.service.spec.ts:436` — "all links have resolvers but ONE denies → DENY").

Hệ quả nếu ký mù: một file link CẢ vào HR/Employee CẢ vào task (ảnh chụp hợp đồng / CCCD dạng
`image/jpeg`) hôm nay **403 khi tải** vì HR resolver deny — nhưng sẽ **được ký và render làm ảnh bìa cho
mọi người đọc board**. Biến thể chéo-task: file link vào task A (dự án kín) + task B ⇒ người đọc B thấy
attachment của A. Đây là rò nội dung thật, không phải giả định.

🔧 **Vá bằng vị từ ĐỘC QUYỀN** — "ảnh bìa phải là tệp CHỈ thuộc chính task này":

```sql
AND NOT EXISTS (
  SELECT 1 FROM file_links fl2
  WHERE fl2.file_id = files.id AND fl2.deleted_at IS NULL
    AND NOT (fl2.module_code = 'TASK' AND fl2.entity_type = 'task'
             AND fl2.entity_id = file_links.entity_id)
)
```

Kiểm tương đương ở `setCover` (→ 409 "tệp đang gắn ở nơi khác, không dùng làm bìa được") để người dùng
biết ngay, **nhưng ràng buộc ở đường ĐỌC mới là chốt** — self-defending, đúng học thuyết §0-3: link có
thể được thêm SAU khi đặt bìa, qua đường foundation, không đi qua `setCover`.
(Lệch TOCTOU giữa kiểm ở `setCover` và kiểm ở đường đọc là **chấp nhận được có chủ đích** — đường đọc tái
kiểm mỗi lần. Ghi ra đây để FULL gate không mở lại như một lỗ.)

🔺 **TUYỆT ĐỐI KHÔNG thêm `fl2.company_id = $companyId` vào `NOT EXISTS`.** Nhà này có phản xạ "AND
company_id tường minh dù đã có RLS" (ghi trong mọi docblock repo) — nhưng ở một `NOT EXISTS`, mỗi điều kiện
thêm vào `fl2` làm **ẩn bớt** link nhìn thấy được ⇒ **fail-OPEN**, đúng ngược hướng phản xạ. Chỉ dựa RLS.

🔺 **Xác minh trước khi code:** có luồng nào tạo link `module_code='TASK'` với `entity_type='project'` không?
Nếu có, file vừa đính kèm task vừa đính kèm dự án sẽ im lặng thành `coverUrl: null`. Nghiêng về giữ
fail-closed + 409 ở `setCover` để người dùng biết, nhưng phải quyết tường minh.
(Đã xác minh KHÔNG có false-negative với link phụ **cùng task**: mệnh đề `NOT (module='TASK' AND
entity_type='task' AND entity_id = <task này>)` cho qua mọi `link_type` khác trên chính task đó, và
`uq_file_links_entity_file_active` đã cấm 2 link active trùng `(entity, file, link_type)`.)

### 3.2 Ký URL

Thêm `CoverPresignService` (`apps/api/src/foundation/files/cover-presign.service.ts`) —
`resolveTaskCovers(companyId, taskIds, callerTx?): Promise<Map<taskId, url>>`.

🔧 **VIẾT ĐỘC LẬP — KHÔNG refactor `AvatarPresignService` trong WO này.** rev1 định tách helper dùng
chung `signStoragePaths`; bỏ. Lý do: đó là viết lại đường fail-soft/degrade của một service crown-jewel
mà **code AVATAR-1 còn chưa merge** (đang nằm ở PR #248 trên chính nhánh base này). Gộp vào sẽ khiến diff
COVER-1 trộn code AVATAR-1 chưa merge, reviewer FULL gate của COVER-1 phải gánh cả AVATAR-1, và regression
rơi vào đường COVER-1 vốn chưa có test. Chấp nhận lặp ~15 dòng `Promise.allSettled` + `logger.warn`;
mở WO dọn trùng SAU khi #248 merge.

Fail-soft giữ nguyên ngữ nghĩa: ký lỗi ⇒ không vào map ⇒ `coverUrl: null` ⇒ thẻ không có bìa,
**KHÔNG 500 board**; kèm 1 reason mẫu vào `logger.warn` để bug thật không lẩn sau fail-soft.

🔧 **KHÔNG ghi `file_access_logs` khi ký bìa** (theo tiền lệ avatar, tránh nhiễu số liệu tải). Khác avatar
ở chỗ bìa phục vụ **ảnh gốc full-res** cho mọi người thấy board — chấp nhận được VÌ có vị từ độc quyền
§3.1. Ghi quyết định ở đây để FULL gate không mở lại tranh luận.

`callerTx?: TenantTx` bắt buộc có — cùng lý do đã ghi ở AVATAR-1: gọi trong tx mà tự mở `withTenant`
sẽ **treo trên PgBouncer transaction-mode**.

### 3.3 Contracts (`packages/contracts/src/task.ts`)

```ts
// trong taskCoreResponseSchema, cạnh assigneeAvatarUrl:
coverUrl: z.string().nullable().optional(),
```

Additive `.optional()` (FE/API deploy lệch pha vẫn parse). **KHÔNG** thêm vào `subtaskListItemSchema`
(panel việc con là danh sách dòng, không hiện bìa) — quyết định có chủ đích để giảm bề mặt.

### 3.4 Thread qua mapper + MỌI đường đọc

Mirror đúng khuôn AVATAR-1 (`toTaskCoreDto(row, assigneeAvatarUrl)` → thêm tham số `coverUrl`).
Vì `assigneeAvatarUrl` + `coverUrl` giờ là 2 tham số vị trí liền nhau (dễ hoán vị nhầm mà tsc không thấy —
cả hai đều `string | null | undefined`), **đổi sang 1 object tham số**:

```ts
toTaskCoreDto(row, { assigneeAvatarUrl, coverUrl })
```

Sửa luôn 2 call-site avatar đã có. Đây là thay đổi cơ học, typecheck bắt hết.

**Danh sách đường PHẢI nối (thiếu 1 = field im lặng không tới FE — lỗi này đã xảy ra 2 lần với `parentTaskId`):**

| # | Đường | File |
| --- | --- | --- |
| 1 | `listTasks` | `task-core.service.ts` |
| 2 | `getTask` | `task-core.service.ts` |
| 3 | `getMyTasks` | `task-core.service.ts` |
| 4 | board kanban | `task-kanban.service.ts` |
| 5 | `reload()` sau ghi — phủ `createTask:510` · `updateTask:712` · 🔧 **`moveState:739`** | `task-core.service.ts` |
| 6 | `respond()` — 4 route action (assign/status/priority/deadline) | `task-actions.service.ts` |

Đường 5+6 là **bắt buộc**, không phải tuỳ chọn: FE `useTaskActionMutation.onSuccess` hợp nhất
`result.task` vào cache chi tiết ⇒ trả `coverUrl` thiếu là bìa biến mất sau mỗi thao tác.
🔧 `moveState` = **kéo-thả thẻ**, thao tác ghi thường xuyên nhất của board — nối thiếu là kéo xong bìa mất.
(2 đường subtask KHÔNG cần vì §3.3 không thêm field vào DTO việc con.)

🔧 **Đếm lại call-site `toTaskCoreDto`** (rev1 ghi "2 call-site" là thiếu): `task-core.service.ts:1228`
(private `toDto`, dùng lại ở `:171` `:187` `:293` `:1233`), `task-actions.service.ts:766`,
`task-core.mapper.ts:137`. Ở `toTaskKanbanCardDto(row, counts, assigneeAvatarUrl)` avatar là tham số
**thứ ba** (sau `counts`) — lý do "2 tham số vị trí liền nhau dễ hoán vị" KHÔNG áp dụng ở đó, nhưng vẫn
đổi sang object-param cho đồng nhất. Thêm `task-core.mapper.spec.ts` vào danh sách file phải sửa.
tsc bắt hết ⇒ rủi ro là sai ước lượng công, không phải lỗi im lặng.

---

## 4. Frontend

### 4.0 🔧 Client API trong `packages/web-core` (rev1 bỏ sót hoàn toàn)

`TaskFilePanel.tsx:20-28` gọi API qua `taskFileApi` + `taskFileInvalidation` từ `@mediaos/web-core`,
**không `fetch` thẳng** ⇒ bắt buộc thêm `setCover`/`clearCover` vào
`packages/web-core/src/lib/task-file-api.ts` + khoá/invalidation ở `query-keys.ts`.

### 4.1 `TaskFilePanel.tsx`

🔧 **`TaskFileDto` phải mang `isCover: boolean`** — nếu không, yêu cầu "tệp đang là bìa → nút Gỡ + nhãn"
là **bất khả thi**: `coverUrl` là URL ĐÃ KÝ, không đối chiếu được với `fileId` của dòng trong bảng, và
`TaskFileRow`/`toDto` (`task-file.repository.ts:25-47`, `task-file.service.ts:251`) không mang `isPrimary`.
Việc cần làm: thêm `isCover` vào `taskFileDto` (`packages/contracts/src/task-file.ts`) + map ở `toDto`.

🔺 **`isCover` là BIỂU THỨC TRONG `SELECT`, KHÔNG phải điều kiện trong `WHERE`.** rev2 viết "suy theo cùng
bộ lọc hợp lệ như đường đọc" — mơ hồ chết người: implementer thêm mime/upload/scan/độc-quyền vào `WHERE`
của `listLinkedFilesByTaskTx` là **mọi tệp không-ảnh biến mất khỏi danh sách đính kèm**. Viết đúng:

```text
FILE_COLUMNS.isCover = fileLinks.isPrimary AND <vị-từ-bìa-hợp-lệ §3.1>   -- trong SELECT
WHERE  … giữ NGUYÊN như hiện tại …                                       -- không đụng
```

Vẫn phải kèm vị từ hợp lệ (không phải `is_primary` thô), nếu không panel nói "đang là bìa" trong khi board
không hiện gì.

🔺 **Khai `z.boolean().optional()` hoặc `.default(false)`, KHÔNG phải `boolean` bắt buộc** — `coverUrl` cố ý
`.optional()` cho lệch pha deploy, để `isCover` bắt buộc là bất nhất: FE mới + API cũ ⇒ **ZodError runtime**
(đúng lớp lỗi memory `apifetch-drops-pagination-bare-array`).

- Mỗi tệp **là ảnh** (`mimeType.startsWith('image/')`) + `uploadStatus==='Uploaded'` + `scanStatus∈{Clean,NotRequired}`
  → nút **"Đặt làm ảnh bìa"**; `isCover` → **"Gỡ ảnh bìa"** + nhãn đánh dấu.
- Gate: `useCan('file-upload','task')` — thiếu quyền ⇒ **không render nút** (không phải `disabled`).
- `onSuccess` invalidate: `taskKeys.files(taskId)` + `taskKeys.detail(taskId)` + **`taskKeys.kanban(projectId)`**
  (⚠️ `taskKeys.kanban` KHÔNG nằm dưới prefix `tasks/list` — phải invalidate tường minh).
  🔧 `TaskFilePanel` props hiện chỉ `{ taskId, embedded }` (`:245-249`) ⇒ **phải luồng `projectId` xuống**
  từ trang chi tiết và xử lý `null` theo khuôn `use-task-action-mutation.ts` (`if (projectId) …`).

### 4.2 Thẻ board (`TaskKanbanPage.tsx` / KanbanCard)
- `coverUrl` có → `<img>` tỉ lệ cố định trên đầu thẻ, `loading="lazy"`, `onError` → ẩn (fail-soft, không vỡ layout).
- Không có → thẻ như hiện tại (không chừa chỗ trống).

### 4.3 i18n
Khoá mới vào `apps/app/src/i18n/locales/vi/tasks.ts`.

---

## 5. Test (RED trước cho deny-path)

🔧 **int-spec** `apps/api/test/integration/task-cover.int-spec.ts` — **KHÔNG phải `src/`**.

rev1 đặt ở `apps/api/src/tasks/task-cover.int-spec.ts` và viện memory `vitest-unit-specs-must-be-colocated`.
**Áp nhầm memory** (memory đó nói về **unit** spec). `apps/api/vitest.config.ts:47`:

```ts
include: ["src/**/*.spec.ts", "test/**/*.e2e-spec.ts", "test/**/*.int-spec.ts"],
```

`task-cover.int-spec.ts` kết thúc bằng `-spec.ts` **chứ không phải `.spec.ts`** ⇒ trượt glob 1; không nằm
dưới `test/` ⇒ trượt glob 3. **Cả 193 int-spec hiện có đều ở `apps/api/test/**`, không một file nào ở `src/**`.**
Hậu quả nếu giữ rev1: viết đủ 13 ca deny-path, chạy **0 ca**, gate PASS, WO đóng — xanh-giả hoàn hảo.

Sao khuôn `apps/api/test/integration/task-files-access.int-spec.ts`: gate
`const hasLaneDb = hasDb && !!process.env.LANE_DB` + `describe.skipIf(!hasLaneDb)`, helper
`../helpers/integration-db`. Chạy trên lane DB riêng (`LANE_DB=mediaos_cover1`).

| # | Kịch bản | Kỳ vọng |
| --- | --- | --- |
| 1 | đặt bìa bằng file **không thuộc task** | 404 |
| 2 | file **cross-tenant** | 404 (RLS 0-row, không lộ tồn tại) |
| 3 | task **ngoài data_scope** | 404 (không 403-sau-200) |
| 4 | file **không phải ảnh** (application/pdf) | **415** (§7.2 đã chốt — KHÔNG phải 400) |
| 5 | file `scanStatus='Infected'` | 409 |
| 6 | file `uploadStatus!=='Uploaded'` | 409 |
| 7 | **thiếu `file-upload:task`** | 403 |
| 8 | đặt bìa mới khi đã có bìa cũ | 200, đúng **1** row `is_primary` |
| 9 | đặt lại chính bìa hiện tại | 200 idempotent, vẫn 1 row |
| 10 | gỡ bìa khi **không có** bìa | 204 idempotent (không 404) — ⚠️ cần `@HttpCode(204)` tường minh, Nest mặc định DELETE trả 200 |
| 11 | soft-delete tệp đang là bìa → đọc task | `coverUrl: null`, **không 500** |
| 12 | `coverUrl` có mặt trên cả 6 đường đọc §3.4 (kể cả `move-state`) | 🔧 assert URL **đã ký** (có tham số chữ ký), KHÔNG chỉ `typeof === "string"` |
| 13 | DTO **không bao giờ** chứa `storage_path`/fileId thô | assert vắng mặt |
| 🔧 14 | file link thêm vào **HR/Employee** rồi đọc task | `coverUrl: null` (vị từ độc quyền §3.1) |
| 🔧 15 | file link vào **2 task** | không ký ở **cả hai** |
| 🔧 16 | `findVerifiedTaskCoversTx` với `taskIds` của **tenant khác** | 0 dòng (RLS) — rev1 chỉ phủ cross-tenant ở đường GHI |
| 🔧 17 | soft-delete tệp-đang-là-bìa → **đặt bìa mới** | 200 + đúng **1** primary (không 23505 từ primary mồ côi) |
| 🔧 18 | hai lời gọi `setCover` **đồng thời** | ⚠️ **không** lời gọi nào 500 · `COUNT(is_primary)=1` · ≥1 lời gọi 200. **409 là kết cục CHẤP NHẬN ĐƯỢC, KHÔNG bắt buộc** |

⚠️ **Ca 18 — cẩn thận assertion tự mâu thuẫn với advisory lock.** rev2 ghi "một 200 một 409"; SAI về logic:
nếu lock chạy **đúng**, T2 chờ xong sẽ đọc primary MỚI qua `FOR UPDATE` → hạ → nâng ⇒ **cả hai đều 200**.
Assert cứng "phải có một 409" sẽ **RED khi code ĐÚNG**, và cám dỗ người code đi nới lock cho hết đỏ —
tức là tự tay gỡ chính bản vá đồng thời. Assert bất biến (đúng 1 primary, không 500), không assert cơ chế.

🔧 **Bẫy dựng fixture ca 5:** `FileService.link` **từ chối** file `Infected` (`files.service.ts:568`) ⇒ không
link thẳng được. Phải link khi `Clean` rồi flip `scan_status` qua `directPool`. Ca 6 thì ổn — `link` không
kiểm `upload_status` nên `Pending` link được thẳng.

**unit** `apps/app/src/routes/tasks/TaskFilePanel.spec.tsx`: nút ẩn khi thiếu quyền · chỉ hiện trên tệp ảnh ·
invalidate đủ 3 khoá.

---

## 6. Thứ tự thực hiện

1. Contracts `coverUrl` + đổi `toTaskCoreDto` sang object-param (sửa 2 call-site avatar) → typecheck.
2. `CoverPresignService` (độc lập) + `findVerifiedTaskCoversTx`.
   🔺 **KHÔNG tạo `presign-utils.ts`** — rev2 để sót dòng này dù §3.2 đã quyết bỏ helper dùng chung
   (không trộn code AVATAR-1 chưa merge vào diff FULL gate của COVER-1).
3. Nối 6 đường đọc §3.4.
4. Repo `findPrimaryLinkTx`/`setPrimaryTx` + service `setCover`/`clearCover` + controller.
5. int-spec RED trước (deny-path 1-7) → GREEN.
6. FE panel + thẻ board + i18n + unit spec.
7. FULL gate: `security-reviewer` + `silent-failure-hunter` (+ `database-reviewer` vì chạm file_links).

---

## 7. Quyết định mở — 🔧 ĐÃ CHỐT sau plan-review vòng 1

1. **Gate = `file-upload:task`** — reviewer TÁN THÀNH. `assertScope` map mọi action ≠ `read` sang mode
   `'collab'` (`task-file.service.ts:184`) ⇒ Viewer bị loại đúng ý. `update:task` sẽ gate một hành động
   trên một grant không tạo nổi tệp để chọn.
   🔧 Còn nợ: viết một câu biện minh cho `clearCover` dùng **cùng** cặp (nghĩa là gỡ được bìa do người
   khác đặt) thay vì `file-delete:task` — đưa vào docblock service.
2. **Mã lỗi mime = 415** + `FOUNDATION_FILE_ERROR_CODES.MIME` (nhất quán `me-avatar.service.ts`).
   🔧 ⇒ **phải sửa `done_when` của WO trong backlog** (đang ghi 400) — đừng để mâu thuẫn nằm trong tiêu
   chí nghiệm thu.
3. **Ngưỡng scan: `DOWNLOADABLE_SCAN` (`Clean|NotRequired`) ở CẢ HAI đường (GHI và ĐỌC).**
   🔺 Vòng 1 tán thành `<> 'Infected'` ở đường đọc; **vòng 2 đảo lại** với căn cứ mạnh hơn: đường đọc là
   biên an toàn thay thế đường tải, mà đường tải đòi `Clean|NotRequired` (`task-file.service.ts:100`) —
   biên an toàn lỏng hơn thứ nó thay thế là một đường vòng. Xem phân tích ở §3.1.
4. **Bỏ owner-check: TÁN THÀNH, NHƯNG chỉ khi kèm vị từ độc quyền** (§3.1). Bỏ trần trụi như rev1 là
   **không chấp nhận được** — xem phân tích leo thang ở §3.1.

---

## 8. Bẫy đã biết phải né

1. **Nested-tx / PgBouncer** — gọi presign trong `withTenant` mà không truyền `callerTx` ⇒ **treo runtime**,
   typecheck mù. (AVATAR-1 đã dính, đã có khuôn `callerTx`.)
2. **Thứ tự tham số constructor** — `TaskCoreService`/`TaskActionsService` được vài unit spec dựng bằng
   `new ...(...)` theo VỊ TRÍ ⇒ dependency mới (`CoverPresignService`) phải đứng **CUỐI**.
3. **Bind mảng drizzle** — `${taskIds}` thô trong `sql` sinh record ⇒ 500 runtime; typecheck + unit mock đều mù.
   Dùng `inArray()` hoặc `sql.param()`. (memory `drizzle-array-bind-sql-param`)
4. **`taskKeys.kanban` không dưới prefix `tasks/list`** — phải invalidate tường minh (§4.1).
5. 🔺 **`*.int-spec.ts` PHẢI ở `apps/api/test/**` — KHÔNG colocate `src/**`.**
   (rev1/rev2 mục này ghi ngược lại và đó chính là điểm bị BLOCK ở vòng 1 — xem §5.)
   `vitest.config.ts:47` include 3 glob: `src/**/*.spec.ts` (unit, colocate) ·
   `test/**/*.e2e-spec.ts` · `test/**/*.int-spec.ts`. Chỉ **unit** spec mới colocate.
   File `*.int-spec.ts` đặt trong `src/` không khớp glob nào ⇒ chạy 0 ca, gate vẫn PASS.
6. **Đỏ có sẵn trên master:** `test/foundation/foundation-audit.e2e-spec.ts` fail khi chạy trên DB chung
   `mediaos` (audit rows tích luỹ ⇒ count 2≠1). Đã xác minh đỏ y hệt trên master `6abcf067` — **không phải
   do WO này**. Verify trên lane DB riêng (`LANE_DB=mediaos_cover1`).
7. **Stacked PR** — nhánh này cắt từ `feat/s5-task-ux-batch` (chưa merge). Sau khi PR đó squash-merge,
   PR này thành CONFLICTING; phải rebase lên master. (memory `squash-merge-breaks-stacked-prs`)

---

## 8b. Cảnh báo mang theo lúc code (plan-review vòng 3 — PASS kèm các mục này)

1. **Vị từ "bìa hợp lệ" sẽ tồn tại ở HAI nơi** — `foundation/files/file.repository.ts` (đường ký) và
   `tasks/task-file.repository.ts` (`isCover`). Lệch nhau ⇒ panel nói "đang là bìa" mà board trống.
   Tách thành một hằng/builder dùng chung, hoặc tối thiểu docblock trỏ chéo hai chiều.
   (Cùng lớp với `countOtherLiveLinksTx` ↔ `NOT EXISTS` ở §2.1.)
2. **Câu hỏi mở §3.1 đã có câu trả lời — đừng để lơ lửng qua FULL gate.**
   `task-file.resolver.ts:42` đăng ký `entityTypes = [TASK_ENTITY]`, và toàn bộ `apps/api/src/tasks/**`
   chỉ dùng `TASK_ENTITY` ⇒ **không có luồng nào tạo `module='TASK'` + `entity_type='project'`** ⇒ không có
   false-negative. Xác nhận lại bằng 1 query trên lane DB rồi ghi kết luận vào plan.
3. **`audit.record` cần nhiều field hơn snippet §2.2** — `actorUserId`, `moduleCode`, `entityType`,
   `entityId`, `resultStatus`, `dataScope`. Khuôn: `files.service.ts:591-604`. tsc bắt, nhưng copy đúng
   khuôn từ đầu cho nhanh.
4. **`classid` của advisory lock phải là hằng số ĐẶT TÊN RÕ trong `common/`**, không nhét magic number tại
   chỗ — không gian khoá advisory là toàn cục, module sau sẽ va.
5. **Sửa `src[]` của WO phải sửa TRỌN 3 câu sai, không chỉ câu đầu:** (a) `linkType='Cover'` ở mục phương
   án, (b) `linkType='Cover'` trong mô tả `findVerifiedTaskCoversTx`, (c) `scan≠Infected` ở **cả** mục đọc
   **lẫn** mục "tính chất an toàn". Bỏ sót một câu là để lại chính cái tiền đề sai cho phiên sau.

---

## 9. Definition of Done

- [ ] `POST /tasks/:taskId/files/:fileId/cover` + 🔺 `DELETE /tasks/:taskId/files/cover` (khai TRƯỚC `@Delete(":fileId")`); chỉ nhận file đã đính kèm task đó + là ảnh + Uploaded + `Clean|NotRequired`
- [ ] Đặt bìa mới thay bìa cũ trong **1 tx** — không vi phạm unique, không cửa sổ 2 bìa / 0 bìa
- [ ] `coverUrl` trả trên **cả 6 đường đọc** §3.4 — URL đã ký, **không bao giờ** fileId thô; không bìa ⇒ `null`
- [ ] FE: nút Đặt/Gỡ bìa trong `TaskFilePanel` (chỉ trên tệp ảnh, ẩn khi thiếu quyền); thẻ board render bìa
- [ ] 🔺 int-spec deny-path **18 ca** §5 (rev2 ghi 13 — lệch sau khi thêm ca 14-18) xanh trên lane DB riêng, file ở `apps/api/test/integration/`
- [ ] 🔺 Có dòng `audit_logs` (`object_type='file_link'`) cho mỗi lần đổi/gỡ bìa — trail của `file_links` không có đường ghi vô hình
- [ ] 🔺 Không đường nào trả 500: bắt `23505` + `40P01` + `40001` → 409
- [ ] Không migration, không đổi enum contracts (kiểm bằng `git diff --stat` — 0 file trong `apps/api/migrations/`)
- [ ] FULL gate PASS + typecheck/lint/build xanh
- [ ] 🔧 Ảnh bìa là tệp **CHỈ** thuộc task đó — file link ở entity khác KHÔNG BAO GIỜ được ký (ca 14/15)
- [ ] 🔧 Không đường nào trả 500: 23505 → 409, primary mồ côi hạ được (ca 17/18)
- [ ] 🔧 Cập nhật `harness/backlog.mjs` **cả ba**: `src[]` (bỏ mô tả `linkType='Cover'` sai) ·
      `done_when[]` (400→415, bỏ "unlink trước link") · `paths[]` (xem dưới)
- [ ] 🔧 Thêm 2 endpoint vào tài liệu **API-06** (drift doc)

### 🔧 `paths[]` phải mở rộng TRƯỚC khi code

`paths` lái `guard-scope` + review gate + scheduler (memory `wo-paths-drive-gate-and-scheduler`).
WO hiện chỉ mở `apps/api/src/foundation/files/file.repository.ts` trong khu foundation, và **không hề
nhắc `packages/web-core`** — nhưng §4.0 bắt buộc sửa ở đó. Thêm:

```text
apps/api/src/foundation/files/**      (cover-presign.service.ts + đăng ký DI ở module)
apps/api/test/integration/**          (int-spec — xem §5)
packages/web-core/src/**              (task-file-api + query-keys — xem §4.0)
```
