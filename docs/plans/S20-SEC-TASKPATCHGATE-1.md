# S20-SEC-TASKPATCHGATE-1 — plan v1.1

> Zone 🔴 red · gate FULL · crown (permission / data-scope). Nhánh `fix/s20-sec-taskpatchgate-1` cắt từ `9e29fed700f1d03c79b59b8bb342293c37b2b6f8` (đầu nhánh S20-SEC-TASKLEGACYREAD-1 — PR xếp chồng, cùng `tasks.controller.ts` + `tasks.permissions.spec.ts`).
> Mọi số đo lấy trên `9e29fed7`. Nhãn: **[ĐO]** = đã đọc/đếm trên mã; **[SUY RA]** = suy luận, đo lại ở bước thi công.
> Repo PUBLIC: plan chỉ ghi bất biến + số đo tổng hợp + danh sách tệp. Bảng vai trò × trường × đường và trạng thái từng ca trên base nằm ở kênh owner (ngoài repo).
> Quyết định owner (23/10/2026, không mở lại): PATCH có trường thuộc cặp chuyên trách mà người gọi thiếu cặp ⇒ **từ chối cả request (403)**, không âm thầm bỏ trường; form Sửa khoá trường theo cặp quyền server trả.

## §0 v1.1 — theo plan-review (PASS_WITH_FIXES)

| Finding                                                                 | Xử lý                                                                                                                                                                                                                                                                                                                                           | Ở đâu                                |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| F1 HIGH — «ghi cả trường không đổi» là ghi đè đồng thời vượt cặp        | **áp** — xác minh: `raw` đọc không khoá (`task-core.service.ts:617`); khoá hàng chỉ khi `touchesTree` và đặt **sau** lần đọc (`:641-646`); ghi ở `:719`                                                                                                                                                                                         | I-3 · §3.3 `buildGatedPatch` · §5 M9 |
| F2 HIGH — A1/A2 có thể xanh rỗng; ca R chỉ ghim mã HTTP                 | **áp, chỉnh một điểm** — xác minh no-op sớm `task-actions.service.ts:118`, `:314`, `:387`. Chỉnh: assert chỉ mã `AUTH-ERR-FORBIDDEN` không phân biệt được 403 của guard (mã chung `common/errors/error-codes.ts:17` [SUY RA phong bì]) ⇒ assert thêm **thông điệp** của cổng (khác `Permission denied: …` của guard, `permission.guard.ts:140`) | §4                                   |
| F3 MEDIUM — bẫy `undefined` khi ánh xạ kết quả theo khoá                | **áp** — xác minh cảnh báo `data-scope.service.ts:123-126`, `permission.service.ts:804-809`; điều kiện hiện so lỏng `scope == null` (`data-scope.service.ts:81`)                                                                                                                                                                                | §3.2 · §3.4 · §5 M12, M13            |
| F4 MEDIUM — ca FE F2 phải chạy với người thiếu cặp; thiếu spec việc con | **áp** — xác minh `SubtaskInlineControls.spec.tsx:166` (`{assigneeEmployeeId: null}`), `:233` (`dueAt`); không có spec riêng cho `TaskSubtaskDialogs` [ĐO `ls`]                                                                                                                                                                                 | §4 FE · §6                           |
| F5 MEDIUM — việc con không được là tuỳ chọn                             | **áp** — xác minh chú thích chọn PATCH có chủ đích `SubtaskInlineControls.tsx:31-34`; 403 hiện thành `errors.forbidden` (`:45`)                                                                                                                                                                                                                 | §3.6 · §6 · §7                       |
| F6 MEDIUM — plan ghép lại thành công thức tái hiện                      | **áp** — bỏ cột trạng thái base khỏi §4, viết lại §2.2/§2.4 thành bất biến cần đạt; trạng thái base chuyển ra ngoài repo                                                                                                                                                                                                                        | §2.2 · §2.4 · §4 · §7                |
| F7 LOW — I-4 lệch văn bản, bản sao `assertAssigneeInScope`, PAT         | **áp** — xác minh `task-core.service.ts:1277-1291` ≡ `task-actions.service.ts:594-608`; PAT: `permission.guard.ts:100-115`, `ApiKeyAuthGuard` đã gỡ (`app.module.ts:141`)                                                                                                                                                                       | I-4 · R8 · §8 D8, D9                 |
| F8 LOW — tương thích FE cũ + API mới chưa đo                            | **áp một phần** — đã đo nguồn FE (§2.3); đếm hàng `due_at` lẻ giây trên DB **chưa làm** (bước plan không có quyền DB) ⇒ câu hỏi mở cho thi công                                                                                                                                                                                                 | §2.3 · §7                            |
| F9 LOW — D2/D3 thiếu hai hệ quả                                         | **áp** — xác minh refine Zod chỉ khi cả hai trường có mặt; PATCH người phụ trách chỉ ghi cột (`task-core.service.ts:699-713`), `/assign` ghi `task_assignees` (`task-actions.service.ts:122-131`)                                                                                                                                               | §3.7 · §8 D2, D3                     |

Lệch số dòng v1 (reviewer Q1, đã sửa ở dưới): priority/dueAt `:696`/`:697`; `updateTask` kết thúc `:815`; `loadMutable` của change-priority `:313`, của change-deadline `:376`.

## §1 Bất biến + phạm vi

Ba trường và cặp chuyên trách tương ứng: hạn `dueAt` ↔ `update-deadline:task` · ưu tiên `priority` ↔ `update-priority:task` · người phụ trách `assigneeEmployeeId` ↔ `assign:task`.

- **I-1 (cùng thay đổi, cùng quyết định quyền):** một `PATCH /tasks/:taskId` làm giá trị của trường F **đổi** so với bản ghi hiện tại chỉ thành công khi người gọi có cặp P(F). Thiếu ⇒ 403 cho cả request: không cột nào đổi, không dòng activity/audit nào được ghi.
- **I-2 (cùng phạm vi):** phần đổi F bị buộc theo phạm vi của chính P(F), không mượn phạm vi `update:task`: việc phải nằm trong phạm vi ghi của P(F) (ngoài ⇒ 404, như route chuyên trách); người phụ trách mới phải nằm trong phạm vi `assign` (ngoài ⇒ 403 `ASSIGNEE_OUT_OF_SCOPE`). Cùng khuôn `UPDATE_STATE`/`UPDATE_STATUS` đã có ở PATCH `stateId`.
- **I-3 (không đổi thì không đòi, và không ghi) — bất biến QUYỀN, không phải tối ưu:** F có trong body nhưng bằng giá trị hiện tại ⇒ không đòi P(F) **và patch không chứa khoá của F**. Vế «không ghi» chịu lực: `raw` đọc không khoá hàng, nên trong khoảng đọc→ghi một thay đổi hợp lệ qua route chuyên trách có thể commit; nếu PATCH vẫn ghi giá trị «không đổi» theo bản chụp cũ thì nó ghi đè thay đổi đó mà không có P(F). So sánh: `dueAt` theo epoch ms (cùng phép so của change-deadline), `null` ≠ giá trị; `priority` bằng chuỗi; người phụ trách bằng id, `null` ≠ id. `null` (xoá hạn / bỏ ưu tiên / gỡ người phụ trách) là **đổi**.
- **I-4 (một hàm quyết định):** cặp → phạm vi qua `DataScopeService.resolveManyOrNull` → `PermissionService.resolveStrongestScopes` → `decideStrongestScope` — cùng hàm quyết định mà `resolveAndAssert` → `resolveStrongestScope` dùng (`permission.service.ts:782`, `:831-833`; `permission.decide.ts:225`). Điều kiện 403 qua `DataScopeService.assertGranted` (tách từ `resolveAndAssert`, §3.4). Buộc phạm vi việc qua `ProjectAccessService.assertTaskInScopeTx(…, "write")` — cùng hàm `loadMutable` của route chuyên trách gọi. Người phụ trách qua `assertAssigneeInScope` (hiện là hai bản giống hệt nhau ở hai service — ghim bằng ca đối chứng R8, nợ gộp D8). Không biểu thức quyền thứ hai.

**Phạm vi:** đường `PATCH /tasks/:taskId` (service) + mọi nơi FE gọi PATCH với ba trường: form Sửa việc, hộp thoại Sửa việc con, dòng inline việc con (§3.6). **Không đụng:** route chuyên trách, `POST /tasks`, logic `stateId`/`parentTaskId`, seed quyền.

## §2 Đo trên `9e29fed7`

### 2.1 Đường PATCH và route chuyên trách [ĐO]

| Đường                    | Controller (`tasks.controller.ts`) | Service                                     | Cặp → phạm vi | Buộc việc            | Buộc người phụ trách |
| ------------------------ | ---------------------------------- | ------------------------------------------- | ------------- | -------------------- | -------------------- |
| `PATCH /tasks/:taskId`   | `:188-197`                         | `task-core.service.ts:602-815` `updateTask` | `:607-612`    | `:628`               | `:704-709`           |
| `POST …/assign`          | `:308-318`                         | `task-actions.service.ts:106-184`           | `:111`        | `:113` `loadMutable` | `:114`               |
| `POST …/change-priority` | `:377-387`                         | `:301-361`                                  | `:306-311`    | `:313` `loadMutable` | —                    |
| `POST …/change-deadline` | `:390-400`                         | `:364-~425`                                 | `:369-374`    | `:376` `loadMutable` | —                    |

- Dựng patch ba trường ở PATCH: `task-core.service.ts:696` (priority) · `:697` (dueAt) · `:699-713` (người phụ trách; `null` không qua `resolveAssignee`). Ghi `:719` `updateTaskCoreTx`. [ĐO]
- Đọc bản ghi `:617` `findRawByIdTx` không khoá; khoá cây `lockTasksForTreeWriteTx` chỉ khi `touchesTree` (`:641-646`), sau lần đọc. Route chuyên trách so no-op với bản ghi rồi ghi (`task-actions.service.ts:118`, `:314`, `:387`). [ĐO] ⇒ I-3 vế «không ghi».
- Tiền lệ cùng file: PATCH `stateId` resolve cặp **trước tx** (`prepareStateWrite :857-876`), trong tx 403 **chỉ khi thực sự đổi** (`:919-921`, `:933-935`) và buộc theo scope của cặp (`:909`). [ĐO]
- 403 thiếu cặp: `data-scope.service.ts:81-82` (`scope == null` ⇒ `ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope")`); bản không-ném `resolveOrNull :101`, gộp N cặp `resolveManyOrNull :128` (trả **mảng theo chỉ số**, doc-block cảnh báo tra theo khoá ⇒ `undefined`). [ĐO]
- DTO `updateTaskCoreSchema` (`packages/contracts/src/task.ts:627-658`): `.partial().strict()`, ba trường đều `nullable`. DTO route chuyên trách: assign không-null (`task-actions.ts:20`), priority không-null (`:42`), deadline nullable ⇒ gỡ người phụ trách / bỏ ưu tiên **chỉ** có ở PATCH. [ĐO]
- Cỡ tệp: `task-core.service.ts` 1395 dòng (> 800 ⇒ không làm dài thêm) · `task-actions.service.ts` 799 (chạm trần) · `tasks.controller.ts` 549 · `tasks.permissions.spec.ts` 199. [ĐO]

### 2.2 Grant seed [ĐO]

Nguồn `apps/api/src/foundation/seed/task-permissions.const.ts` (seed 0485 + 0501). Mục tiêu sau WO: **0 vai trò canonical** nằm ngoài I-1/I-2. Vai trò tự tạo (quản trị vai trò) ghép được `update:task` với cặp chuyên trách ở phạm vi khác ⇒ I-2 cần cho trường hợp đó. Bảng vai trò × cặp: kênh owner.

### 2.3 FE gửi gì [ĐO]

- Form Sửa `TaskFormDrawer.tsx:101` → `taskFormToUpdatePayload` (`task-form-schema.ts:99-109`): **luôn gửi đủ 7 trường**, không theo dirty ⇒ quy tắc server **phải** là I-3 (so với bản ghi).
- Round-trip của form cũ: `priority` `null → "" → null`, người phụ trách `null → "" → null`, `dueAt` qua `isoToLocalDatetime` (`routes/tasks/constants.ts:89-95`) cắt về phút rồi `localDatetimeToIso` ⇒ chỉ `due_at` lưu có giây/ms ≠ 0 mới bị tính «đổi».
- Nguồn sinh `dueAt` ở FE: inline change-deadline `TaskInlineFields.tsx:350` (`localDatetimeToIso` từ ô `datetime-local`) ⇒ giây = 0. Backend: grep writer `dueAt` tính toán (`new Date` / `endOf` / `addDays` / `setHours`) ngoài spec ⇒ 0 kết quả. Hàng lẻ giây chỉ có thể đến từ client API khác / dữ liệu nhập [SUY RA; đếm trên DB chưa làm — §7].
- `TaskInlineFields.tsx`: ưu tiên/hạn/người phụ trách đã đi route chuyên trách + `useCan` (`:290`, `:327`, `:377`) ⇒ không đổi.
- Hai nơi khác gọi PATCH với trường có cặp: `SubtaskInlineControls.tsx:59-60` (một trường/lần; chọn PATCH có chủ đích — chú thích `:31-34`) và `TaskSubtaskDialogs.tsx:139` (`subtaskFormToUpdatePayload` `subtask-form-schema.ts:41-47`, đủ 3 trường).
- RHF: trường `disabled` qua register có thể cho `undefined`, mapper hiện đổi `undefined → null` (= xoá hạn) [SUY RA — đo ở thi công] ⇒ khoá trường bằng dirty-only, không dựa vào giá trị của trường bị khoá.

### 2.4 Bất biến cần đạt so với route chuyên trách

Đường sửa chung phải áp **cùng cặp + cùng phạm vi** như route chuyên trách cho phần thay đổi tương ứng:

| Kiểm                                                          | Loại           | Xử lý                         |
| ------------------------------------------------------------- | -------------- | ----------------------------- |
| Cặp chuyên trách của trường đổi                               | quyền          | **áp** (I-1)                  |
| Phạm vi việc theo cặp (`loadMutable` ⇒ `assertTaskInScopeTx`) | quyền          | **áp** (I-2)                  |
| Người phụ trách theo phạm vi `assign`                         | quyền          | **áp** (I-2)                  |
| Việc đã huỷ ⇒ 422 (`loadMutable :529-536`)                    | vòng đời       | nợ D1                         |
| `dueAt ≥ startAt` đang lưu ⇒ 400 (`:378-384`)                 | hợp lệ dữ liệu | nợ D2                         |
| Outbox + activity + `task_assignees` riêng từng thao tác      | hành vi        | nợ D3 (S20-TASK-ASSIGNNOTI-1) |
| Việc theo workflow ⇒ 400                                      | —              | đã khớp                       |

### 2.5 Mã lỗi + test hiện có [ĐO]

- 403: `ForbiddenException` qua phong bì chuẩn của filter toàn cục; mã phong bì `AUTH-ERR-FORBIDDEN` (`common/errors/error-codes.ts:17`) dùng chung cho mọi 403 [SUY RA — đo phong bì ở thi công] ⇒ ca test phân biệt cổng trường với guard route bằng **thông điệp**. Không thêm mã mới.
- Int-spec hiện có gọi PATCH với trường có cặp: 1 lời gọi (`task-core.int-spec.ts:589`, người gọi đủ cặp) ⇒ giữ xanh [SUY RA]. `task-core-codegen.spec.ts` dựng `TaskCoreService` theo vị trí ⇒ cập nhật khi thêm phụ thuộc.

## §3 Thiết kế

**3.1 Bảng trường ↔ cặp, một nơi.** Tệp mới `apps/api/src/tasks/task-patch-field-gate.ts` (`@Injectable TaskPatchFieldGate` + hàm thuần export, ~170 dòng): hằng `TASK_PATCH_GATED_FIELDS = [{field:"dueAt", action:"update-deadline"}, {field:"priority", action:"update-priority"}, {field:"assigneeEmployeeId", action:"assign"}]`.

**3.2 `prepare(user, dto)` — trước tx.** Lọc `TASK_PATCH_GATED_FIELDS` theo trường **có mặt** ⇒ mảng `present`; dựng `requests = present.map(...)`; gọi `dataScope.resolveManyOrNull` (một lượt đọc grant; không mở kết nối thứ hai trong tx — khuôn `prepareStateWrite`). Kết quả đọc bằng `[i]` **cùng thứ tự với `requests`** và ghép lại với `present[i]` — không dựng `Map` theo khoá cặp, không dùng chỉ số của bảng gốc. Trả mảng `{ field, scope: DataScope | null }`.

**3.3 Trong tx, trước mọi ghi.**

- `computeChanged(raw, dto)` (thuần, export): tập trường **đổi** theo I-3.
- `assertTx(tx, user, taskId, changed, prepared)`: với mỗi trường đổi, `dataScope.assertGranted(scope)` (403) → `projectAccess.assertTaskInScopeTx(tx, user, taskId, scope, "write")` (404). Trả `assignScope` (khi người phụ trách đổi).
- `buildGatedPatch(dto, changed, assignee)` (thuần, export): trả phần patch của ba trường; **chỉ** trường thuộc `changed` có khoá. `updateTask` trải kết quả này vào `patch` thay cho `:696-713`; người phụ trách mới resolve qua `resolveAssignee(tx, user, assignScope, …)` trước khi gọi.

**3.4 `DataScopeService.assertGranted(scope: DataScope | null | undefined)`** — tách điều kiện 403 ra khỏi `resolveAndAssert` (hàm này gọi lại nó) ⇒ một nơi quyết định 403. **Giữ so lỏng `scope == null`** (bắt cả `undefined`); unit ghim `assertGranted(undefined)` ⇒ 403. Hai chỗ lặp chuỗi ở `applyStateChangeTx` giữ nguyên (nợ D5).

**3.5 `updateTask` (net ≤ 0 dòng; đo `wc -l` trước/sau = 1395 → ≤ 1395).** Thêm phụ thuộc ở **cuối** constructor; `prepare` cạnh `prepareStateWrite`; `computeChanged` + `assertTx` ngay sau `assertInScopeForWrite :628`; thay `:696-713` bằng trải `buildGatedPatch`. Route PATCH giữ `update:task` (gate trường ở method dùng chung, không ở route — cùng nguyên tắc `stateId`). `tasks.module.ts` thêm provider.

**3.6 FE.** `TaskFormDrawer` (chế độ sửa): `useCan` ba cặp từ `TASK_CORE_ENGINE_PAIRS` ⇒ thiếu cặp thì trường `disabled` + dòng gợi ý (i18n); payload **chỉ trường dirty** (`taskFormToUpdatePayload(values, dirtyFields)`). Chế độ tạo không đổi. Cùng khuôn (trong phạm vi WO, không tuỳ chọn) cho `TaskSubtaskDialogs` (`subtaskFormToUpdatePayload` dirty-only) và `SubtaskInlineControls` (control người phụ trách/hạn khoá theo `useCan` cặp tương ứng). Viết lại chú thích `SubtaskInlineControls.tsx:31-34` theo luật mới, trung tính (cặp quyền, không nêu vai trò). Không hard-code vai trò.

**3.7 Điểm nối cho WO sau.**

- S20-TASK-ASSIGNNOTI-1: dùng `changed.has("assigneeEmployeeId")` từ §3.3 để phát cùng sự kiện như `/assign` — không tự so lại. PATCH đổi người phụ trách hiện **chỉ ghi cột** (`task-core.service.ts:699-713`), không ghi `task_assignees` như `/assign` (`task-actions.service.ts:122-131`) — WO đó quyết định có hội tụ không.
- S20-TASK-ALLOWEDACTIONS-1: khả năng sửa từng trường tính từ **cùng** `TASK_PATCH_GATED_FIELDS` + `prepare` — không bảng ánh xạ thứ hai; D1 (việc đã huỷ) thuộc phạm vi của WO đó.

## §4 Bảng ca test

Int-spec MỚI `apps/api/test/integration/task-patch-field-gate.int-spec.ts`: app thật qua `applyMainPipeline`, cổng `hasDb && LANE_DB`, chạy lane `mediaos_s20r`; khung theo `task-read-paths-scope.int-spec.ts`; người gọi dựng bằng `grant()` theo cặp (tên ca mô tả bất biến, không mô tả vai trò). Người gọi: **G0** `update:task@Company`; **G1** G0 + ba cặp @Company; **G2** G0 + ba cặp @Own, **không** là thành viên Owner/Manager của dự án chứa việc «ngoài phạm vi» (nhánh thành viên của mode `write` cũng cho qua — `project-access.service.ts:135-155`); **G3** G0 + chỉ `update-priority@Company`; **B** tenant khác, đủ cặp.

Việc seed cho ca R/A có **cả ba trường khác null** (hạn, ưu tiên, người phụ trách) và giá trị đích khác giá trị đầu.

**Assert chung cho mọi ca R:** mã HTTP; thông điệp đúng nguồn (cổng trường: chuỗi của `assertGranted` / `ASSIGNEE_OUT_OF_SCOPE` / `TASK-ERR-TASK-NOT-FOUND` — **không** phải `Permission denied: …` của guard); hàng DB không đổi (đọc lại qua `directPool`, mọi cột ba trường + tiêu đề + `updated_at`); 0 dòng `task_activity_logs` / `audit_logs` mới cho việc đó. Mỗi ca R phải đỏ trên base — đã kiểm bằng lý luận (bảng ở kênh owner); thi công chạy RED thật trên base trước khi vá.

| #   | Ca                                                                                                                   | Kỳ vọng                                            | Bất biến                                         |
| --- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------ |
| R1  | G0 PATCH `{dueAt: mới}`                                                                                              | 403                                                | I-1                                              |
| R2  | G0 PATCH `{priority: mới}`                                                                                           | 403                                                | I-1                                              |
| R3  | G0 PATCH `{assigneeEmployeeId: người khác}`                                                                          | 403                                                | I-1                                              |
| R4  | G0 PATCH `{assigneeEmployeeId: null}`                                                                                | 403                                                | I-1, I-3                                         |
| R5  | G0 PATCH `{dueAt: null}`                                                                                             | 403                                                | I-1, I-3                                         |
| R6  | G0 PATCH `{title: mới, dueAt: mới}`                                                                                  | 403; tiêu đề **không** đổi                         | I-1 (cả request)                                 |
| R7  | G2 PATCH `{dueAt}` trên việc ngoài phạm vi Own                                                                       | 404                                                | I-2                                              |
| R8  | G2 PATCH `{assigneeEmployeeId: người ngoài Own}` trên việc của G2; **đối chứng:** cùng G2 `POST …/assign` cùng người | 403 `ASSIGNEE_OUT_OF_SCOPE` ở **cả hai** đường     | I-2, I-4                                         |
| R9  | G3 PATCH `{dueAt: mới}`                                                                                              | 403                                                | I-1 (đúng cặp)                                   |
| A1  | G0 PATCH đủ 7 trường, chỉ tiêu đề đổi; `dueAt` cùng thời điểm khác offset                                            | 200; tiêu đề đổi; ba cột giữ nguyên                | I-3                                              |
| A2  | Hai việc giống hệt T1, T2. G1 PATCH ba trường đổi trên T1; G1 ba route chuyên trách trên T2                          | 200 cả hai; ba cột T1 = T2 và cả hai ≠ giá trị đầu | I-1 ALLOW                                        |
| A3  | G2 PATCH `{dueAt}` trên việc của G2                                                                                  | 200; `due_at` = đích                               | I-2 ALLOW                                        |
| A4  | G3 PATCH `{priority: mới}`                                                                                           | 200; `priority` = đích                             | đứng cạnh R9                                     |
| A5  | G0 PATCH `{title}`                                                                                                   | 200                                                | hồi quy · ca đứng cạnh cho R (G0 qua cổng route) |
| X1  | B PATCH `{dueAt}` trên việc tenant A                                                                                 | 404; việc A không đổi                              | cô lập tenant (hồi quy, xanh cả trên base)       |

**Unit** (tệp mới `task-patch-field-gate.spec.ts`):

- `computeChanged`: cùng thời điểm khác offset ⇒ không đổi; lệch 1 ms ⇒ đổi; `null` vs giá trị ⇒ đổi; `null` vs `null` ⇒ không đổi; vắng ⇒ không xét; `priority null` vs giá trị ⇒ đổi.
- `buildGatedPatch`: với **mỗi** trong ba trường, có trong body nhưng bằng giá trị lưu (gồm `null` vs `null`) ⇒ patch **không có khoá** đó (`not.toHaveProperty`); trường đổi ⇒ có khoá.
- `prepare`: chỉ hỏi đúng cặp của trường có mặt (0 trường ⇒ 0 lượt đọc grant); body chỉ `priority`, actor chỉ có `update-priority` ⇒ qua; body `{dueAt, priority}` cùng actor ⇒ 403 (ánh xạ theo chỉ số của `requests` đã lọc).
- `DataScopeService.assertGranted(undefined)` ⇒ 403; `assertGranted(null)` ⇒ 403.
- `tasks.permissions.spec.ts`: ghim PATCH vẫn khai đúng một cặp `update:task` ở route.

**FE** (chỉ thao tác ô văn bản — tránh race option nạp qua effect):

- `TaskFormDrawer.test.tsx` (mới): F1 thiếu `update-deadline` ⇒ ô hạn `disabled`; F2a đủ cặp, sửa chỉ tiêu đề ⇒ body **đúng bằng** `{title}`; F2b thiếu cả ba cặp, sửa chỉ tiêu đề ⇒ body **không có khoá** `dueAt`, `priority`, `assigneeEmployeeId` (`not.toHaveProperty`); F3 đủ cặp ⇒ ba trường bật.
- `SubtaskInlineControls.spec.tsx`: ca hiện có (`:166`, `:233`) chạy với mock `useCan` cấp đủ cặp; thêm ca thiếu `assign` ⇒ control người phụ trách khoá, thiếu `update-deadline` ⇒ control hạn khoá, 0 lời gọi `updateTask`.
- Hộp thoại Sửa việc con: ca dirty-only tương tự F2b (trong `TaskSubtaskPanel.spec.tsx` hoặc tệp spec mới — đo ở thi công).

## §5 Đột biến (mỗi cái phải bị giết — không miễn cái nào)

| #   | Đột biến                                                        | Ca giết                                                               |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| M1  | Bỏ lời gọi `assertTx`                                           | R1–R6, R9                                                             |
| M2  | Xét "có mặt" thay vì "đổi"                                      | A1                                                                    |
| M3  | So `dueAt` bằng chuỗi thay vì epoch ms                          | A1, unit offset                                                       |
| M4  | Người phụ trách buộc theo scope `update`                        | R8                                                                    |
| M5  | Bỏ `assertTaskInScopeTx` theo scope cặp                         | R7                                                                    |
| M6  | Thiếu cặp ⇒ lặng lẽ bỏ trường thay vì 403                       | R1, R6 (assert 403 + thông điệp)                                      |
| M7  | Coi `null` là "không đổi"                                       | R4, R5                                                                |
| M8  | Đảo cặp priority ↔ deadline trong bảng                          | R9, A4                                                                |
| M9  | Ghi cả trường không đổi (bỏ vế «không ghi» của I-3)             | unit `buildGatedPatch` (×3 trường, gồm `null` vs `null`)              |
| M10 | FE gửi đủ body                                                  | F2a, F2b                                                              |
| M11 | FE `useCan` sai cặp                                             | F1, ca khoá control việc con                                          |
| M12 | `assertGranted` so chặt `=== null`                              | unit `assertGranted(undefined)`                                       |
| M13 | `prepare` ánh xạ theo chỉ số bảng gốc thay vì `requests` đã lọc | unit `prepare` (body chỉ `priority` ⇒ qua; `{dueAt, priority}` ⇒ 403) |

## §6 Tệp đổi

Trong `paths` WO: `apps/api/src/tasks/task-core.service.ts` (net ≤ 0 dòng) · `apps/api/src/tasks/tasks.controller.ts` (chỉ chú thích PATCH) · `apps/api/src/tasks/tasks.permissions.spec.ts` · `apps/api/test/integration/task-patch-field-gate.int-spec.ts` (mới) · `apps/app/src/routes/tasks/TaskFormDrawer.tsx` · `docs/permission-matrix-spec.md` (§6 TASK: ghi I-1…I-3, gồm I-3 là bất biến quyền chống ghi đè đồng thời) · `docs/plans/S20-SEC-TASKPATCHGATE-1.md`. Không đổi: `task-actions.service.ts` (799 dòng), `TaskInlineFields.tsx` (đã đúng — §2.3).

**pathsNeeded (ngoài `paths`):**

- `apps/api/src/tasks/task-patch-field-gate.ts` + `task-patch-field-gate.spec.ts` (mới — `task-core.service.ts` quá 800 dòng)
- `apps/api/src/tasks/tasks.module.ts` (provider) · `apps/api/src/tasks/task-core-codegen.spec.ts` (constructor theo vị trí)
- `apps/api/src/permission/data-scope.service.ts` (`assertGranted`, ~6 dòng) + spec của nó (ca `undefined`)
- `apps/app/src/routes/tasks/task-form-schema.ts` (mapper dirty-only) · `apps/app/src/routes/tasks/TaskFormDrawer.test.tsx` (mới) · `apps/app/src/i18n/locales/vi/tasks.ts` (dòng gợi ý)
- `apps/app/src/routes/tasks/subtask-form-schema.ts` · `TaskSubtaskDialogs.tsx` · `SubtaskInlineControls.tsx` · `SubtaskInlineControls.spec.tsx` · `TaskSubtaskPanel.spec.tsx` (nếu ca hộp thoại đặt ở đó)

## §7 Deploy + rollback + hệ quả

Không migration, không đổi seed. FE (Pages) tự lên khi merge; API deploy tay.

- **Thứ tự:** merge (FE tự lên) → owner deploy API **ngay sau merge**. Luồng chính chỉ mở PR khi owner sẵn sàng deploy API trong ngày (nhánh PR công khai từ lúc mở PR).
- **Tương thích:** FE mới + API cũ an toàn (API cũ nhận mọi tập con trường). FE cũ (tab SPA chưa tải lại) + API mới: chỉ việc có `due_at` lưu với giây/ms ≠ 0 mới bị tính «đổi» khi người thiếu cặp lưu form ⇒ 403 cả request. Nguồn FE đã đo là giây = 0 (§2.3); số hàng lẻ giây trên DB chưa đếm (câu hỏi mở). Handoff nhắc owner: người dùng tải lại trang sau khi deploy API.
- **Hệ quả owner đã chấp nhận (nhắc lại trong prBody):** người chỉ có `update:task` mà thiếu cặp không còn tự dời hạn / đổi ưu tiên / đổi người phụ trách qua form Sửa. **Bổ sung thông tin (không mở lại quyết định):** ở việc con, người thiếu `assign` / `update-deadline` cũng không còn tự nhận, gỡ người phụ trách hay đặt/xoá hạn qua dòng inline và hộp thoại Sửa việc con.
- PR xếp chồng trên PR S20-SEC-TASKLEGACYREAD-1: merge PR đó trước, rồi đặt lại base.
- Rollback: API về bản build trước; FE revert commit; không có dữ liệu cần hoàn.

## §8 Ngoài phạm vi / nợ

- **D1** PATCH không chặn việc đã huỷ (route chuyên trách 422) — luật vòng đời; giao S20-TASK-ALLOWEDACTIONS-1 hoặc WO riêng.
- **D2** PATCH chỉ có `dueAt` không so với `startAt` đang lưu, và chiều ngược lại: PATCH chỉ có `startAt` không so với `dueAt` đang lưu (refine Zod chỉ chạy khi cả hai có trong body). Khi FE gửi dirty-only, client vẫn chặn nhờ refine của form (`task-form-schema.ts:29-37`), nhưng server không — luật hợp lệ dữ liệu.
- **D3** PATCH không phát outbox / activity riêng cho ba trường, và đổi người phụ trách qua PATCH không ghi `task_assignees` — S20-TASK-ASSIGNNOTI-1 (điểm nối §3.7). Audit/activity `TASK_UPDATED` hiện ghi mọi trường **có mặt** trong body [ĐO `task-core.service.ts:763`] ⇒ WO sau dựa vào `changed`, không dựa vào bản ghi audit.
- **D4** `POST /tasks` đặt ba trường chỉ với `create:task` — tạo mới không phải "đổi"; không thuộc WO (câu hỏi mở).
- **D5** Chuỗi 403 lặp ở `applyStateChangeTx` — chuyển sang `assertGranted` ở WO dọn.
- **D6** `check.sh --all --lane-db` + FULL gate: luồng chính.
- **D7** Gỡ người phụ trách (`null`) chỉ có ở PATCH; sau WO đòi `assign` — có cần cặp riêng cho «gỡ» là quyết định mới, không chặn WO.
- **D8** `assertAssigneeInScope` là hai bản giống hệt (`task-core.service.ts:1277-1291`, `task-actions.service.ts:594-608`) — gộp về một nơi (ví dụ `ProjectAccessService`) ở WO dọn; tới lúc đó ca đối chứng R8 ghim hai bản không trôi.
- **D9** Route chuyên trách còn qua lớp giao `scopeKeys` của PAT trong `PermissionGuard` (`permission.guard.ts:100-115`). Hiện tương đương vì đường PAT đã gỡ (`app.module.ts:141`). Nếu khôi phục PAT, cổng trường phải áp cùng phép giao `scopeKeys` với guard.

## §9 Thi công (GREEN) — lệch / bổ sung so với plan

- **`task-core.repository.ts`** (909 dòng, > 800 ⇒ không làm dài thêm): `computeChanged` so với bản ghi đọc trong tx (§3.3) cần giá trị đang lưu của hạn + ưu tiên ⇒ `findRawByIdTx` thêm `due_at`/`task_priority` vào projection (cùng dòng) và `TaskRawRow` thêm 2 trường; bù bằng gọn 2 chú thích cũ ⇒ net 0 dòng. Tệp ngoài §6, ghi vào pathsNeeded.
- **`task-core.service.ts`**: 1395 → 1394 dòng (§3.5 đạt). Người phụ trách mới resolve theo phạm vi `assign` do `assertTx` trả về; trường không đổi không resolve, không ghi.
- **`assertTx`**: mọi 403 (thiếu cặp) đi trước mọi 404 (ngoài phạm vi việc), như guard route đi trước data-scope; phạm vi trùng nhau chỉ kiểm một lần; trường đổi mà `prepare` không có ⇒ `assertGranted(undefined)` ⇒ 403 (fail-closed).
- **`buildGatedPatch`**: người phụ trách đổi sang một người mà chưa resolve theo phạm vi `assign` ⇒ 500 (lỗi lập trình, không ghi).
- **FE dùng chung**: `task-patch-field-locks.ts` (`useTaskPatchFieldLocks` — ba cặp từ `TASK_CORE_ENGINE_PAIRS`) + `TaskFieldLockedHint.tsx` cho form Sửa việc, hộp thoại Sửa việc con và control inline việc con; quy tắc payload chung `editableDirtyFields` + `pickEditable` (`task-form-schema.ts`): trường gửi = dirty và không bị khoá. Không có trường nào sửa ⇒ không gọi API (PATCH rỗng bị 400). Khoá i18n mới `fieldGate.locked` ở `tasks-workux.ts` vì `tasks.ts` đã quá 800 dòng.
- **Ca RED**: sửa kiểu tham số của helper trong `task-patch-field-gate.spec.ts` và bỏ `import React` thừa ở hai spec FE mới (typecheck đỏ) — không đổi assert nào.
- **Đột biến §5**: chưa chạy ở bước GREEN — thuộc bước gate.
