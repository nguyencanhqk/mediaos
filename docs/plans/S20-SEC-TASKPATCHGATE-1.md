# S20-SEC-TASKPATCHGATE-1 — plan v1

> Zone 🔴 red · gate FULL · crown (permission / data-scope). Nhánh `fix/s20-sec-taskpatchgate-1` cắt từ `9e29fed7` (đầu nhánh S20-SEC-TASKLEGACYREAD-1 — PR xếp chồng, cùng `tasks.controller.ts` + `tasks.permissions.spec.ts`).
> Mọi số đo lấy trên `9e29fed7`. Nhãn: **[ĐO]** = đã đọc/đếm trên mã; **[SUY RA]** = suy luận, đo lại ở bước thi công.
> Repo PUBLIC: plan chỉ ghi bất biến + số đo tổng hợp + danh sách tệp. Bảng vai trò × trường × đường nằm ở kênh owner (ngoài repo).
> Quyết định owner (23/10/2026, không mở lại): PATCH có trường thuộc cặp chuyên trách mà người gọi thiếu cặp ⇒ **từ chối cả request (403)**, không âm thầm bỏ trường; form Sửa khoá trường theo cặp quyền server trả.

## §1 Bất biến + phạm vi

Ba trường và cặp chuyên trách tương ứng: hạn `dueAt` ↔ `update-deadline:task` · ưu tiên `priority` ↔ `update-priority:task` · người phụ trách `assigneeEmployeeId` ↔ `assign:task`.

- **I-1 (cùng thay đổi, cùng quyết định quyền):** một `PATCH /tasks/:taskId` làm giá trị của trường F **đổi** so với bản ghi hiện tại chỉ thành công khi người gọi có cặp P(F). Thiếu ⇒ 403 cho cả request: không cột nào đổi, không dòng activity/audit nào được ghi.
- **I-2 (cùng phạm vi):** phần đổi F bị buộc theo phạm vi của chính P(F), không mượn phạm vi `update:task`: việc phải nằm trong phạm vi ghi của P(F) (ngoài ⇒ 404, như route chuyên trách); người phụ trách mới phải nằm trong phạm vi `assign` (ngoài ⇒ 403 `ASSIGNEE_OUT_OF_SCOPE`). Cùng khuôn `UPDATE_STATE`/`UPDATE_STATUS` đã có ở PATCH `stateId`.
- **I-3 (không đổi thì không đòi):** F có trong body nhưng bằng giá trị hiện tại ⇒ không đòi P(F) và **không ghi F**. So sánh: `dueAt` theo epoch ms (cùng phép so của change-deadline), `null` ≠ giá trị; `priority` bằng chuỗi; người phụ trách bằng id, `null` ≠ id. `null` (xoá hạn / bỏ ưu tiên / gỡ người phụ trách) là **đổi**.
- **I-4 (một hàm quyết định):** cặp → phạm vi qua `PermissionService.resolveStrongestScope` (đường của `DataScopeService`), điều kiện 403 dùng chung với `resolveAndAssert`, buộc phạm vi qua `ProjectAccessService.assertTaskInScopeTx(…, "write")`, người phụ trách qua `assertAssigneeInScope`. Không biểu thức quyền thứ hai.

**Phạm vi:** đường `PATCH /tasks/:taskId` (service) + form Sửa ở FE (và hai nơi gọi PATCH của việc con gửi cùng trường — §6). **Không đụng:** route chuyên trách, `POST /tasks`, logic `stateId`/`parentTaskId`, seed quyền.

## §2 Đo trên `9e29fed7`

### 2.1 Đường PATCH và route chuyên trách [ĐO]

| Đường                    | Controller (`tasks.controller.ts`) | Service                                     | Cặp → phạm vi       | Buộc việc                          | Buộc người phụ trách                      |
| ------------------------ | ---------------------------------- | ------------------------------------------- | ------------------- | ---------------------------------- | ----------------------------------------- |
| `PATCH /tasks/:taskId`   | `:188-197` gate `update:task`      | `task-core.service.ts:602-822` `updateTask` | `:607-612` `update` | `:628` scope `update`              | `:704-709` `resolveAssignee(updateScope)` |
| `POST …/assign`          | `:308-318` gate `assign`           | `task-actions.service.ts:106-184`           | `:111` `assign`     | `:113` `loadMutable(scope assign)` | `:114` scope `assign`                     |
| `POST …/change-priority` | `:377-387` gate `update-priority`  | `:301-361`                                  | `:306-311`          | `:317`                             | —                                         |
| `POST …/change-deadline` | `:390-400` gate `update-deadline`  | `:364-~425`                                 | `:369-374`          | `:375`                             | —                                         |

- Dựng patch ba trường ở PATCH: `task-core.service.ts:699` (priority) · `:700` (dueAt) · `:701-712` (người phụ trách; `null` không qua `resolveAssignee`). [ĐO]
- Tiền lệ cùng file: PATCH `stateId` resolve cặp **trước tx** (`prepareStateWrite :857-876`, bản không-ném cho `update-status`), trong tx 403 **chỉ khi thực sự đổi** (`:919-921`, `:933-935`) và buộc theo scope của cặp (`:909`). [ĐO]
- 403 thiếu cặp: `data-scope.service.ts:82` `ForbiddenException("AUTH-ERR-FORBIDDEN: out of permission scope")`; cùng chuỗi lặp ở `task-core.service.ts:920,934`. Bản không-ném: `resolveOrNull :101`, gộp N cặp một lượt đọc grant: `resolveManyOrNull :128`. [ĐO]
- DTO `updateTaskCoreSchema` (`packages/contracts/src/task.ts:627-658`): `.partial().strict()`, ba trường đều `nullable`. DTO route chuyên trách: assign không-null (`task-actions.ts:20`), priority không-null (`:42`), deadline nullable. ⇒ gỡ người phụ trách / bỏ ưu tiên **chỉ** có ở PATCH. [ĐO]
- Cỡ tệp: `task-core.service.ts` 1395 dòng (> 800 ⇒ không làm dài thêm) · `task-actions.service.ts` 799 (chạm trần) · `tasks.controller.ts` 549 · `tasks.permissions.spec.ts` 199. [ĐO]

### 2.2 Grant seed (tổng hợp) [ĐO]

Nguồn `apps/api/src/foundation/seed/task-permissions.const.ts:102,139-141` (seed 0485 + 0501). 4 vai trò canonical: `update:task` 4/4; mỗi cặp trong ba cặp 3/4; **1/4** vai trò có `update:task` mà không có cặp nào trong ba cặp; ở 3/4 còn lại phạm vi cặp = phạm vi `update:task` (0/4 lệch phạm vi). Vai trò tự tạo ghép được `update:task` rộng với cặp hẹp hơn ⇒ I-2 chỉ lộ qua vai trò tự tạo [SUY RA — có quản trị vai trò]. Bảng vai trò × trường × đường: kênh owner.

### 2.3 FE gửi gì [ĐO]

- Form Sửa `TaskFormDrawer.tsx:101` → `taskFormToUpdatePayload` (`task-form-schema.ts:99-109`): **luôn gửi đủ 7 trường** (gồm ba trường có cặp), không theo dirty. ⇒ quy tắc server **phải** là I-3 (so với bản ghi), nếu không mọi lần sửa tiêu đề của người thiếu cặp đều 403.
- `isoToLocalDatetime` (`routes/tasks/constants.ts:89-95`) cắt về phút ⇒ `dueAt` có giây/ms khác 0 đi vòng qua form thành giá trị khác ⇒ bị tính là "đổi" [ĐO hàm; nguồn sinh `dueAt` có giây = SUY RA]. ⇒ FE phải gửi **chỉ trường dirty**.
- `TaskInlineFields.tsx`: ưu tiên/hạn/người phụ trách đã đi route chuyên trách + `useCan` (`:290`, `:327`, `:377`) ⇒ không đổi.
- Hai nơi khác gọi PATCH với trường có cặp: `SubtaskInlineControls.tsx:59-60` (một trường/lần) và `TaskSubtaskDialogs.tsx:139` (`subtaskFormToUpdatePayload` `subtask-form-schema.ts:41-47`, đủ 3 trường).
- RHF `^7.80`: trường `disabled` qua register cho giá trị `undefined`, mapper hiện đổi `undefined → null` (= xoá hạn) [SUY RA — đo ở thi công] ⇒ khoá trường bằng dirty-only, không dựa vào giá trị trường bị khoá.

### 2.4 Guard route chuyên trách có mà PATCH thiếu [ĐO]

| Guard                                 | Route chuyên trách       | PATCH                              | Loại           | Xử lý                         |
| ------------------------------------- | ------------------------ | ---------------------------------- | -------------- | ----------------------------- |
| Cặp chuyên trách                      | có                       | không                              | quyền          | **áp** (I-1)                  |
| Phạm vi việc theo cặp                 | `loadMutable(scope cặp)` | scope `update`                     | quyền          | **áp** (I-2)                  |
| Người phụ trách theo phạm vi `assign` | có                       | scope `update`                     | quyền          | **áp** (I-2)                  |
| Việc đã huỷ ⇒ 422                     | `loadMutable :529-536`   | không                              | vòng đời       | nợ D1                         |
| `dueAt ≥ startAt` hiện có ⇒ 400       | `:378-384`               | chỉ khi cả hai trong body (Zod)    | hợp lệ dữ liệu | nợ D2                         |
| Outbox + activity riêng từng thao tác | có                       | `TASK_UPDATED` chung, không outbox | hành vi        | nợ D3 (S20-TASK-ASSIGNNOTI-1) |
| Workflow ⇒ 400                        | có                       | có                                 | —              | đã khớp                       |

### 2.5 Mã lỗi + test hiện có [ĐO]

- 403: `AUTH-ERR-FORBIDDEN` qua `ForbiddenException` (phong bì chuẩn của filter toàn cục) — cùng mã guard route chuyên trách trả. Không thêm mã mới.
- Int-spec hiện có gọi PATCH với trường có cặp: 1 lời gọi (`task-core.int-spec.ts:589`, người gọi đủ cặp) ⇒ giữ xanh [SUY RA]. `task-core-codegen.spec.ts` dựng `TaskCoreService` theo vị trí ⇒ cập nhật khi thêm phụ thuộc.

## §3 Thiết kế

**3.1 Bảng trường ↔ cặp, một nơi.** Tệp mới `apps/api/src/tasks/task-patch-field-gate.ts` (`@Injectable TaskPatchFieldGate`, ~150 dòng): hằng `TASK_PATCH_GATED_FIELDS = [{field:"dueAt", action:"update-deadline"}, {field:"priority", action:"update-priority"}, {field:"assigneeEmployeeId", action:"assign"}]`.

**3.2 `prepare(user, dto)` — trước tx.** Với các trường có cặp **có mặt** trong body, gọi `dataScope.resolveManyOrNull` (một lượt đọc grant; không mở kết nối thứ hai trong tx — khuôn `prepareStateWrite`). Trả map trường → scope | null.

**3.3 `assertTx(tx, user, taskId, raw, dto, ctx)` — trong tx, trước mọi ghi.** Tính tập trường **đổi** theo I-3; với mỗi trường đổi: `DataScopeService.assertGranted(scope)` (403) → `projectAccess.assertTaskInScopeTx(tx, user, taskId, scope, "write")` (404). Trả `{ changed, assignScope }`.

**3.4 `DataScopeService.assertGranted(scope)`** — tách điều kiện `scope == null ⇒ 403` ra khỏi `resolveAndAssert` (hàm này gọi lại nó) ⇒ một nơi quyết định 403, PATCH tái dùng. Hai chỗ lặp chuỗi ở `applyStateChangeTx` giữ nguyên (nợ D5).

**3.5 `updateTask` (net ≤ 0 dòng; đo `wc -l` trước/sau = 1395 → ≤ 1395).** Thêm phụ thuộc ở **cuối** constructor; `prepare` cạnh `prepareStateWrite`; `assertTx` ngay sau `assertInScopeForWrite :628`; thay `:699-712`: chỉ ghi trường thuộc `changed`, người phụ trách qua `resolveAssignee(tx, user, assignScope, …)`. Route PATCH giữ `update:task` (gate trường ở method dùng chung, không ở route — cùng nguyên tắc `stateId`). `tasks.module.ts` thêm provider.

**3.6 FE.** `TaskFormDrawer` (chế độ sửa): `useCan` ba cặp từ `TASK_CORE_ENGINE_PAIRS` ⇒ thiếu cặp thì trường `disabled` + dòng gợi ý (i18n); payload **chỉ trường dirty** (`taskFormToUpdatePayload(values, dirtyFields)`). Chế độ tạo không đổi. Cùng khuôn cho dialog việc con + điều khiển inline việc con (§6). Không hard-code vai trò.

**3.7 Điểm nối cho WO sau.** S20-TASK-ASSIGNNOTI-1: dùng `changed.has("assigneeEmployeeId")` từ `assertTx` để phát cùng sự kiện như `/assign` — không tự so lại. S20-TASK-ALLOWEDACTIONS-1: khả năng sửa từng trường tính từ **cùng** `TASK_PATCH_GATED_FIELDS` + `prepare` — không bảng ánh xạ thứ hai; D1 (việc đã huỷ) thuộc phạm vi của WO đó.

## §4 Bảng ca test

Int-spec MỚI `apps/api/test/integration/task-patch-field-gate.int-spec.ts`: app thật qua `applyMainPipeline`, cổng `hasDb && LANE_DB`, chạy lane `mediaos_s20r`; khung theo `task-read-paths-scope.int-spec.ts`; người gọi dựng bằng `grant()` theo cặp (tên ca mô tả bất biến, không mô tả vai trò). Người gọi: **G0** `update:task@Company`; **G1** G0 + ba cặp @Company; **G2** G0 + ba cặp @Own; **G3** G0 + chỉ `update-priority@Company`; **B** tenant khác, đủ cặp.

| #   | Ca                                                                              | Kỳ vọng                           | Mã cũ           | Bất biến         |
| --- | ------------------------------------------------------------------------------- | --------------------------------- | --------------- | ---------------- |
| R1  | G0 PATCH `{dueAt: mới}`                                                         | 403; `due_at` giữ; 0 activity mới | 200 ⇒ RED       | I-1              |
| R2  | G0 PATCH `{priority: mới}`                                                      | 403                               | 200 ⇒ RED       | I-1              |
| R3  | G0 PATCH `{assigneeEmployeeId: người khác}`                                     | 403                               | 200 ⇒ RED       | I-1              |
| R4  | G0 PATCH `{assigneeEmployeeId: null}` trên việc đã giao                         | 403                               | 200 ⇒ RED       | I-1, I-3         |
| R5  | G0 PATCH `{dueAt: null}` trên việc có hạn                                       | 403                               | 200 ⇒ RED       | I-1, I-3         |
| R6  | G0 PATCH `{title: mới, dueAt: mới}`                                             | 403; tiêu đề **không** đổi        | 200 ⇒ RED       | I-1 (cả request) |
| R7  | G2 PATCH `{dueAt}` trên việc ngoài phạm vi Own                                  | 404                               | 200 ⇒ RED       | I-2              |
| R8  | G2 PATCH `{assigneeEmployeeId: người ngoài Own}` trên việc của G2               | 403 `ASSIGNEE_OUT_OF_SCOPE`       | 200 ⇒ RED       | I-2              |
| R9  | G3 PATCH `{dueAt: mới}`                                                         | 403                               | 200 ⇒ RED       | I-1 (đúng cặp)   |
| A1  | G0 PATCH đủ 7 trường, chỉ tiêu đề đổi; `dueAt` cùng thời điểm nhưng khác offset | 200; tiêu đề đổi                  | 200 (gác ALLOW) | I-3              |
| A2  | G1 PATCH ba trường đổi; và cùng thay đổi qua ba route chuyên trách              | 200 cả hai đường; giá trị DB khớp | 200             | I-1 ALLOW        |
| A3  | G2 PATCH `{dueAt}` trên việc của G2                                             | 200                               | 200             | I-2 ALLOW        |
| A4  | G3 PATCH `{priority: mới}`                                                      | 200                               | 200             | đứng cạnh R9     |
| A5  | G0 PATCH `{title}`                                                              | 200                               | 200             | hồi quy          |
| X1  | B PATCH `{dueAt}` trên việc tenant A                                            | 404; việc A không đổi             | 404             | cô lập tenant    |

Unit (tệp mới `task-patch-field-gate.spec.ts`): bảng so I-3 (cùng thời điểm khác offset ⇒ không đổi; lệch 1 ms ⇒ đổi; `null` vs giá trị ⇒ đổi; vắng ⇒ không xét; `priority null` vs giá trị ⇒ đổi); `prepare` chỉ hỏi đúng cặp của trường có mặt (0 trường ⇒ 0 lượt đọc grant). `tasks.permissions.spec.ts`: ghim PATCH vẫn khai đúng một cặp `update:task` ở route.
FE (`TaskFormDrawer.test.tsx` mới): F1 thiếu `update-deadline` ⇒ ô hạn `disabled`; F2 sửa chỉ tiêu đề ⇒ body chỉ có `title` (mã cũ gửi đủ 7 ⇒ RED); F3 đủ cặp ⇒ ba trường bật. Chỉ thao tác ô văn bản (tránh race option nạp qua effect).

## §5 Đột biến (mỗi cái phải bị giết)

| #   | Đột biến                                       | Ca giết                                                                                                                                                                                                   |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | Bỏ lời gọi `assertTx`                          | R1–R6, R9                                                                                                                                                                                                 |
| M2  | Xét "có mặt" thay vì "đổi"                     | A1                                                                                                                                                                                                        |
| M3  | So `dueAt` bằng chuỗi thay vì epoch ms         | A1, unit offset                                                                                                                                                                                           |
| M4  | Người phụ trách buộc theo scope `update`       | R8                                                                                                                                                                                                        |
| M5  | Bỏ `assertTaskInScopeTx` theo scope cặp        | R7                                                                                                                                                                                                        |
| M6  | Thiếu cặp ⇒ lặng lẽ bỏ trường thay vì 403      | R1, R6                                                                                                                                                                                                    |
| M7  | Coi `null` là "không đổi"                      | R4, R5                                                                                                                                                                                                    |
| M8  | Đảo cặp priority ↔ deadline trong bảng         | R9, A4                                                                                                                                                                                                    |
| M9  | Ghi trường không đổi (bỏ I-3 phần "không ghi") | unit trên tập `changed` + chỗ dựng patch; ở mức DB gần như đột biến tương đương (cùng thời điểm) — chỉ lộ khi ghi đồng thời [SUY RA; nếu không giết được thì ghi là tương đương, không tính vào ngưỡng 6] |
| M10 | FE gửi đủ body                                 | F2                                                                                                                                                                                                        |
| M11 | FE `useCan` sai cặp                            | F1                                                                                                                                                                                                        |

## §6 Tệp đổi

Trong `paths` WO: `apps/api/src/tasks/task-core.service.ts` (net ≤ 0 dòng) · `apps/api/src/tasks/tasks.controller.ts` (chỉ chú thích PATCH) · `apps/api/src/tasks/tasks.permissions.spec.ts` · `apps/api/test/integration/task-patch-field-gate.int-spec.ts` (mới) · `apps/app/src/routes/tasks/TaskFormDrawer.tsx` · `docs/permission-matrix-spec.md` (§6 TASK: ghi quy tắc I-1…I-3) · `docs/plans/S20-SEC-TASKPATCHGATE-1.md`. Không đổi: `task-actions.service.ts` (799 dòng), `TaskInlineFields.tsx` (đã đúng — §2.3).

**pathsNeeded (ngoài `paths`):**

- `apps/api/src/tasks/task-patch-field-gate.ts` + `task-patch-field-gate.spec.ts` (mới — `task-core.service.ts` quá 800 dòng)
- `apps/api/src/tasks/tasks.module.ts` (provider) · `apps/api/src/tasks/task-core-codegen.spec.ts` (constructor theo vị trí)
- `apps/api/src/permission/data-scope.service.ts` (`assertGranted`, ~6 dòng)
- `apps/app/src/routes/tasks/task-form-schema.ts` (mapper dirty-only) · `apps/app/src/routes/tasks/TaskFormDrawer.test.tsx` (mới) · `apps/app/src/i18n/locales/vi/tasks.ts` (dòng gợi ý)
- `apps/app/src/routes/tasks/subtask-form-schema.ts` · `TaskSubtaskDialogs.tsx` · `SubtaskInlineControls.tsx` (cùng khuôn khoá trường + dirty-only; nếu luồng chính muốn giữ hẹp ⇒ chuyển thành nợ D7, server vẫn đúng)

## §7 Deploy + rollback

Không migration, không đổi seed. FE (Pages) tự lên khi merge; API deploy tay. FE mới tương thích API cũ (API cũ nhận mọi tập con trường). API mới với FE cũ: chỉ ca `dueAt` có giây đi vòng qua form bị 403 cho người thiếu cặp — FE lên trước nên khoảng hở ≈ 0. Thứ tự: merge (FE tự lên) → deploy API. PR xếp chồng trên PR S20-SEC-TASKLEGACYREAD-1: merge PR đó trước, rồi đặt lại base. Rollback: API về bản build trước; FE revert commit; không có dữ liệu cần hoàn.

## §8 Ngoài phạm vi / nợ

- **D1** PATCH không chặn việc đã huỷ (route chuyên trách 422) — luật vòng đời; giao S20-TASK-ALLOWEDACTIONS-1 hoặc WO riêng.
- **D2** PATCH chỉ có `dueAt` không so với `startAt` đang lưu — luật hợp lệ dữ liệu.
- **D3** PATCH không phát outbox / activity riêng cho ba trường — S20-TASK-ASSIGNNOTI-1 (điểm nối §3.7). Audit/activity `TASK_UPDATED` hiện ghi mọi trường **có mặt** trong body (không phải trường đổi) [ĐO `task-core.service.ts:763`] ⇒ WO sau dựa vào `changed`, không dựa vào bản ghi audit.
- **D4** `POST /tasks` đặt ba trường chỉ với `create:task` — tạo mới không phải "đổi"; không thuộc WO (câu hỏi mở).
- **D5** Chuỗi 403 lặp ở `applyStateChangeTx` — chuyển sang `assertGranted` ở WO dọn.
- **D6** `check.sh --all --lane-db` + FULL gate: luồng chính.
