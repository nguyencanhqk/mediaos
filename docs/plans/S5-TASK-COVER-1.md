# S5-TASK-COVER-1 — Ảnh bìa công việc (chọn từ tệp đã đính kèm)

> Vùng: 🔴 red (chạm file-link + presign = kiểm soát truy cập tệp) → FULL gate.
> Base: nhánh `feat/s5-task-ux-batch` (COVER-1 `depends_on` S5-TASK-AVATAR-1 — code avatar CHƯA lên master).

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
3. **Không đụng ngữ nghĩa cũ.** Trong TASK, `is_primary` hiện chỉ được GHI ở đúng một chỗ
   (`task-file.service.ts:130`, hằng `false`) và **không nơi nào ĐỌC** → không có consumer nào diễn giải khác.
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

Thêm 2 method (giữ khuôn hiện có: nhận `tx` + `companyId`, AND `company_id` tường minh dù đã có RLS):

```
findPrimaryLinkTx(tx, companyId, taskId): Promise<{ linkId, fileId } | undefined>
  WHERE company_id, module_code='TASK', entity_type='task', entity_id=taskId,
        link_type='Attachment', is_primary = true, file_links.deleted_at IS NULL

setPrimaryTx(tx, companyId, linkId, isPrimary): Promise<void>
  UPDATE file_links SET is_primary = $isPrimary, updated_at = now()
  WHERE id = linkId AND company_id = companyId AND deleted_at IS NULL
```

### 2.2 Service (`apps/api/src/tasks/task-file.service.ts`)

```
setCover(user, taskId, fileId): Promise<TaskFileDto>
  1. assertScope(user, taskId, ACTION_UPLOAD)          // 404 nếu task ngoài scope / cross-tenant
  2. row = loadLinkedFileOr404(user, taskId, fileId)    // 404 nếu file KHÔNG thuộc task này (cross-task IDOR)
  3. validate row:
       - !row.mimeType.startsWith('image/')  → 400 (UnsupportedMediaType 415? xem §7 Quyết định mở)
       - row.uploadStatus !== 'Uploaded'     → 409 NOT_PENDING
       - row.scanStatus === 'Infected'       → 409 INFECTED
         (dùng lại DOWNLOADABLE_SCAN? KHÔNG — xem §7)
  4. TRONG MỘT withTenant tx duy nhất:
       cũ = findPrimaryLinkTx(tx, companyId, taskId)
       nếu cũ?.linkId === row.linkId → no-op, trả luôn (idempotent, tránh UPDATE thừa)
       nếu cũ → setPrimaryTx(tx, ..., cũ.linkId, false)
       setPrimaryTx(tx, ..., row.linkId, true)
     ⇒ hạ bìa cũ + nâng bìa mới trong CÙNG tx: unique index không bao giờ thấy 2 primary.
  5. recordActivity(TASK_COVER_SET, targetType 'File', targetId fileId)
  6. trả toDto(row)

clearCover(user, taskId): Promise<void>
  1. assertScope(user, taskId, ACTION_UPLOAD)
  2. cũ = findPrimaryLinkTx(...) — không có → no-op idempotent (KHÔNG 404)
  3. setPrimaryTx(cũ.linkId, false)
  4. recordActivity(TASK_COVER_CLEARED)
```

⚠️ **Bước 4 phải nằm trong MỘT tx.** Tách 2 tx (hạ cũ rồi nâng mới) tạo cửa sổ 0-bìa; nâng-trước-hạ-sau
vi phạm unique index ⇒ 23505.

### 2.3 Controller (`apps/api/src/tasks/task-files.controller.ts`)

```
POST   /tasks/:taskId/files/:fileId/cover   @RequirePermission('file-upload', 'task')
DELETE /tasks/:taskId/cover                  @RequirePermission('file-upload', 'task')
```

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
  AND files.scan_status <> 'Infected'
  AND files.mime_type LIKE 'image/%'
```

`taskIds` rỗng → trả `[]` ngay (mirror avatar).

**KHÔNG có owner-check `files.owner_user_id = file_links.created_by`** như avatar — CÓ CHỦ ĐÍCH và
đây là điểm cần reviewer soi kỹ: attachment của task vốn là cộng tác (A upload, B gắn), owner-check sẽ
chặn nhầm case hợp lệ. Bù lại: bìa **bắt buộc** là attachment sống của chính task đó, mà attachment đó
đã qua gate `file-upload` + data_scope lúc đính kèm ⇒ không mở bề mặt đọc mới. Ai đọc được task thì
vốn đã đọc được mọi attachment của task đó qua `GET /tasks/:id/files`.

### 3.2 Ký URL

Thêm `CoverPresignService` (`apps/api/src/foundation/files/cover-presign.service.ts`) —
`resolveTaskCovers(companyId, taskIds, callerTx?): Promise<Map<taskId, url>>`.

Để **không nhân bản** khối `Promise.allSettled` + degrade-có-log của `AvatarPresignService`:
tách helper dùng chung `signStoragePaths(storage, logger, companyId, items, label)` trong
`apps/api/src/foundation/files/presign-utils.ts`, rồi cho CẢ HAI service gọi. Fail-soft giữ nguyên
ngữ nghĩa: ký lỗi ⇒ không vào map ⇒ `coverUrl: null` ⇒ thẻ không có bìa, **KHÔNG 500 board**;
kèm 1 reason mẫu vào `logger.warn` để bug thật không lẩn sau fail-soft.

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
| 5 | `reload()` sau ghi | `task-core.service.ts` |
| 6 | `respond()` — 4 route action (assign/status/priority/deadline) | `task-actions.service.ts` |

Đường 5+6 là **bắt buộc**, không phải tuỳ chọn: FE `useTaskActionMutation.onSuccess` ghi đè TOÀN BỘ
cache chi tiết bằng `result.task` ⇒ trả `coverUrl` thiếu là bìa biến mất sau mỗi thao tác.
(2 đường subtask KHÔNG cần vì §3.3 không thêm field vào DTO việc con.)

---

## 4. Frontend

### 4.1 `TaskFilePanel.tsx`
- Mỗi tệp **là ảnh** (`mimeType.startsWith('image/')`) + `uploadStatus==='Uploaded'` + `scanStatus∉{Infected,Pending,Failed}`
  → nút **"Đặt làm ảnh bìa"**; tệp đang là bìa → **"Gỡ ảnh bìa"** + nhãn đánh dấu.
- Gate: `useCan('file-upload','task')` — thiếu quyền ⇒ **không render nút** (không phải `disabled`).
- `onSuccess` invalidate: `taskKeys.files(taskId)` + `taskKeys.detail(taskId)` + **`taskKeys.kanban`**
  (⚠️ `taskKeys.kanban` KHÔNG nằm dưới prefix `tasks/list` — bẫy đã ghi trong backlog, phải invalidate tường minh).

### 4.2 Thẻ board (`TaskKanbanPage.tsx` / KanbanCard)
- `coverUrl` có → `<img>` tỉ lệ cố định trên đầu thẻ, `loading="lazy"`, `onError` → ẩn (fail-soft, không vỡ layout).
- Không có → thẻ như hiện tại (không chừa chỗ trống).

### 4.3 i18n
Khoá mới vào `apps/app/src/i18n/locales/vi/tasks.ts`.

---

## 5. Test (RED trước cho deny-path)

**int-spec** `apps/api/src/tasks/task-cover.int-spec.ts` (colocate trong `src/**` — spec ở `test/` không
chạy trong `pnpm test`; xem memory `vitest-unit-specs-must-be-colocated`). Chạy trên lane DB riêng.

| # | Kịch bản | Kỳ vọng |
| --- | --- | --- |
| 1 | đặt bìa bằng file **không thuộc task** | 404 |
| 2 | file **cross-tenant** | 404 (RLS 0-row, không lộ tồn tại) |
| 3 | task **ngoài data_scope** | 404 (không 403-sau-200) |
| 4 | file **không phải ảnh** (application/pdf) | 400/415 |
| 5 | file `scanStatus='Infected'` | 409 |
| 6 | file `uploadStatus!=='Uploaded'` | 409 |
| 7 | **thiếu `file-upload:task`** | 403 |
| 8 | đặt bìa mới khi đã có bìa cũ | 200, đúng **1** row `is_primary` |
| 9 | đặt lại chính bìa hiện tại | 200 idempotent, vẫn 1 row |
| 10 | gỡ bìa khi **không có** bìa | 204 idempotent (không 404) |
| 11 | soft-delete tệp đang là bìa → đọc task | `coverUrl: null`, **không 500** |
| 12 | `coverUrl` có mặt trên cả 6 đường đọc §3.4 | có URL đã ký |
| 13 | DTO **không bao giờ** chứa `storage_path`/fileId thô | assert vắng mặt |

**unit** `apps/app/src/routes/tasks/TaskFilePanel.spec.tsx`: nút ẩn khi thiếu quyền · chỉ hiện trên tệp ảnh ·
invalidate đủ 3 khoá.

---

## 6. Thứ tự thực hiện

1. Contracts `coverUrl` + đổi `toTaskCoreDto` sang object-param (sửa 2 call-site avatar) → typecheck.
2. `presign-utils.ts` + `CoverPresignService` + `findVerifiedTaskCoversTx`.
3. Nối 6 đường đọc §3.4.
4. Repo `findPrimaryLinkTx`/`setPrimaryTx` + service `setCover`/`clearCover` + controller.
5. int-spec RED trước (deny-path 1-7) → GREEN.
6. FE panel + thẻ board + i18n + unit spec.
7. FULL gate: `security-reviewer` + `silent-failure-hunter` (+ `database-reviewer` vì chạm file_links).

---

## 7. Quyết định mở — mời `plan-reviewer` phản biện

1. **Gate = `file-upload:task` hay `update:task`?** Lập luận ở §2.3. Nếu reviewer thấy đặt bìa là "đổi
   nội dung task" thì phải là `update:task` — cần chốt trước khi code.
2. **Mã lỗi cho "không phải ảnh"**: `me-avatar.service.ts` dùng `UnsupportedMediaTypeException` (415) +
   `FOUNDATION_FILE_ERROR_CODES.MIME`. WO `done_when` viết **400**. Đề xuất theo 415 cho nhất quán với
   avatar; cần chốt vì `done_when` là tiêu chí nghiệm thu.
3. **Có nên chặt hơn về `scanStatus`?** `TaskFileService.getDownloadUrl` đòi `Clean|NotRequired`
   (chặt hơn "≠Infected"). Bìa hiển thị cho MỌI người đọc task ⇒ nên dùng cùng ngưỡng chặt
   `DOWNLOADABLE_SCAN` thay vì `≠Infected` như WO viết? Đề xuất: **có** ở đường GHI (đặt bìa),
   và `≠Infected` ở đường ĐỌC (đã đặt rồi thì fail-soft, không đột ngột mất bìa khi scan re-run).
4. **Bỏ owner-check ở `findVerifiedTaskCoversTx`** (§3.1) — đây là khác biệt CÓ CHỦ ĐÍCH so với avatar.
   Cần reviewer xác nhận lập luận "không mở bề mặt đọc mới" đứng vững.

---

## 8. Bẫy đã biết phải né

1. **Nested-tx / PgBouncer** — gọi presign trong `withTenant` mà không truyền `callerTx` ⇒ **treo runtime**,
   typecheck mù. (AVATAR-1 đã dính, đã có khuôn `callerTx`.)
2. **Thứ tự tham số constructor** — `TaskCoreService`/`TaskActionsService` được vài unit spec dựng bằng
   `new ...(...)` theo VỊ TRÍ ⇒ dependency mới (`CoverPresignService`) phải đứng **CUỐI**.
3. **Bind mảng drizzle** — `${taskIds}` thô trong `sql` sinh record ⇒ 500 runtime; typecheck + unit mock đều mù.
   Dùng `inArray()` hoặc `sql.param()`. (memory `drizzle-array-bind-sql-param`)
4. **`taskKeys.kanban` không dưới prefix `tasks/list`** — phải invalidate tường minh (§4.1).
5. **Spec phải colocate trong `src/**`** — `test/**` không chạy trong `pnpm test` = xanh giả.
6. **Đỏ có sẵn trên master:** `test/foundation/foundation-audit.e2e-spec.ts` fail khi chạy trên DB chung
   `mediaos` (audit rows tích luỹ ⇒ count 2≠1). Đã xác minh đỏ y hệt trên master `6abcf067` — **không phải
   do WO này**. Verify trên lane DB riêng (`LANE_DB=mediaos_cover1`).
7. **Stacked PR** — nhánh này cắt từ `feat/s5-task-ux-batch` (chưa merge). Sau khi PR đó squash-merge,
   PR này thành CONFLICTING; phải rebase lên master. (memory `squash-merge-breaks-stacked-prs`)

---

## 9. Definition of Done

- [ ] `POST /tasks/:taskId/files/:fileId/cover` + `DELETE /tasks/:taskId/cover`; chỉ nhận file đã đính kèm task đó + là ảnh + Uploaded + scan sạch
- [ ] Đặt bìa mới thay bìa cũ trong **1 tx** — không vi phạm unique, không cửa sổ 2 bìa / 0 bìa
- [ ] `coverUrl` trả trên **cả 6 đường đọc** §3.4 — URL đã ký, **không bao giờ** fileId thô; không bìa ⇒ `null`
- [ ] FE: nút Đặt/Gỡ bìa trong `TaskFilePanel` (chỉ trên tệp ảnh, ẩn khi thiếu quyền); thẻ board render bìa
- [ ] int-spec deny-path 13 ca §5 xanh trên lane DB riêng
- [ ] Không migration, không đổi enum contracts (kiểm bằng `git diff --stat` — 0 file trong `apps/api/migrations/`)
- [ ] FULL gate PASS + typecheck/lint/build xanh
- [ ] Cập nhật `harness/backlog.mjs`: sửa `src[]` của WO cho khớp phương án THẬT (bỏ mô tả `linkType='Cover'` sai)
