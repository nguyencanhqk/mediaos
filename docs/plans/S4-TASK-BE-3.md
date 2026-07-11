# Plan S4-TASK-BE-3 — Task actions crown-FSM: assign / watchers / change-status / change-priority / change-deadline trên cột `task_status` mới, activity log + outbox event, cảnh báo nghỉ phép không chặn

> Zone **red / crown FSM** → FULL gate (CLAUDE.md:99-101) + santa-method; plan này RED-tests-trước, KHÔNG migration, KHÔNG DDL (bảng đã đủ từ mig 0478).
> Trạng thái review: **PASS-with-conditions** (plan-reviewer 2026-07-11 — xem mục 11, 3 điều kiện ĐK-1..3 BẮT BUỘC + 6 open questions đã chốt)

## 1. Phạm vi & không-phạm-vi

**Trong phạm vi (6 route mới, append vào `TasksController`):**

| Route | Nguồn spec |
| --- | --- |
| `POST /tasks/:taskId/assign` | SPEC-06:1963 (TASK-API-206) · API-06:1484 §14.1 |
| `POST /tasks/:taskId/change-status` | SPEC-06:1964 (TASK-API-207) · API-06:1527 §14.2 |
| `POST /tasks/:taskId/change-priority` | SPEC-06:1965 (TASK-API-208) · API-06:1575 §14.3 |
| `POST /tasks/:taskId/change-deadline` | SPEC-06:1966 (TASK-API-209) · API-06:1602 §14.4 |
| `POST /tasks/:taskId/watchers` | API-06:618 + §14.5 (1631) |
| `DELETE /tasks/:taskId/watchers/:watcherId` | API-06:619 + §14.6 (1647) |

Tên route theo **verb canonical API-06/SPEC-06 §16.3 TK-4** (`change-status`/`change-priority`/`change-deadline` — SPEC-06:1954 cấm `PUT .../status`); done_when viết tắt "POST /:id/status" — xem Open Question #1.

**Quan hệ với route legacy `PATCH /tasks/:taskId/status`** (tasks.controller.ts:154-168 → `TasksService.updateStatus` tasks.service.ts:261-299, "luồng rút gọn G9-3"):
- **GIỮ SONG SONG, KHÔNG đụng.** Legacy ghi cột `status` lowercase (`not_started/in_progress/completed`, `officeTaskStatusSchema`); route mới ghi cột **`task_status` TitleCase** (mig 0478:334, CHECK 0478:354-356 `Todo/In Progress/In Review/Done/Cancelled`) — hai cột KHÁC NHAU trên cùng bảng `tasks` (contracts task.ts:531-536 đã ghi rõ phân biệt). Sửa/gỡ legacy = phá luồng chính G9-3 (board legacy đọc `status`) → vi phạm "không phá luồng chính" (CLAUDE.md §8). Đánh dấu `@deprecated` trong JSDoc route legacy, hợp nhất ở WO dọn sau.
- **KHÔNG sync 2 cột** trong WO này: mapping không 1-1 (`In Review`/`Cancelled` không tồn tại trong officeTaskStatus). Drift 2 cột là nợ ghi nhận (Risk #3, Open Question #3).

**Task workflow-driven** (`workflow_step_id IS NOT NULL` hoặc `task_type ∈ {workflow_step, production, review, revision}` — guard hiện hữu task-core.service.ts:42 + 219-221): **chặn 400 `TASK-ERR-TASK-WORKFLOW`** trên assign/change-status/change-priority/change-deadline (mirror BE-2). Watch **cho phép** (không mutate vòng đời task).

**Không-phạm-vi (WO tiếp nhận tường minh):**
- Consumer outbox → NOTI intake + recipient/loại-actor = **S4-INT-1** (backlog.mjs:4625-4653).
- Kanban move (tái dùng FSM này), comment/mention/checklist API = **S4-TASK-BE-4** (backlog.mjs:4238).
- `co_assignee_employee_ids` (API-06:1500) — MVP chỉ Main (BACKEND-08:486 "MVP bắt buộc hỗ trợ Main").
- `Idempotency-Key` (API-06 §24:2432-2442) — chưa có hạ tầng idempotency chung; ghi nợ.
- Lật 5 grant `TASK_DEFERRED_GRANTS` (create/update/delete:task emp/mgr — task-permissions.const.ts:140-144): **không liên quan** — 5 cặp WO này dùng đã grant đủ từ 0485.
- Đồng bộ `task_assignees` cho nhánh đổi assignee qua `PATCH /tasks/:id` (BE-2) — Risk #7.
- `GET /tasks/overdue` (TASK-API-211) — không trong done_when.

## 2. FSM transition table

Nguồn chuẩn: **SPEC-06 §14.11:1458-1472** ("Đây là bảng transition chuẩn (nguồn gốc) cho toàn hệ thống") + BACKEND-08 §9.7:490-496. Hiện thực = hằng thuần trong file mới `task-fsm.ts` (map from→Set<to>), unit-test được không cần DB.

| From \ To | In Progress | In Review | Done | Cancelled | Todo |
| --- | --- | --- | --- | --- | --- |
| **Todo** | ✅ | ❌ | ❌ | ✅ | — |
| **In Progress** | — | ✅ | ✅ | ✅ | ❌ |
| **In Review** | ✅ | — | ✅ | ✅ | ❌ |
| **Done** | ⚙️ chỉ khi policy reopen bật — **mặc định TẮT** (BACKEND-08:495 "không mặc định") | ❌ | — | ❌ | ❌ |
| **Cancelled** | ❌ terminal (SPEC-06:1464, 1479) | ❌ | ❌ | — | ❌ |

- `from = NULL` (hàng legacy chưa backfill — CHECK 0478:356 cho phép NULL): **coalesce 'Todo'** rồi áp bảng (BE-2 create luôn set 'Todo' — task-core.repository.ts:363). Ghi rõ trong code + test.
- **Mã lỗi (canonical slug — SPEC-06 §18a:2127, khớp API-06 §25:2448-2469):**
  - Transition sai bảng → **409 `TASK-ERR-WORKFLOW-INVALID`** (ánh xạ TASK-ERR-017 — SPEC-06:2142; API-06:2464).
  - `from = 'Cancelled'` (mọi action) → **422 `TASK-ERR-TASK-CLOSED`** (TASK-ERR-019 — SPEC-06:2144; API-06:2467).
  - Done + setting checklist bật + còn item `is_done=false` → **400 `TASK-ERR-CHECKLIST-REQUIRED`** (TASK-ERR-018 — SPEC-06:2143; API-06:2453).
  - Status ngoài enum → Zod 400 (`taskCoreStatusSchema` contracts task.ts:548-554).
- **Checklist-required config:** `SettingService.resolveSetting(companyId, "require_checklist_done_before_task_done")` (setting.service.ts:86-89, precedence company>system>default; key nguyên văn BACKEND-08:1687). `found=false` ⇒ coi như TẮT. Đếm `task_checklist_items` `is_done=false AND deleted_at IS NULL` (bảng 0478:154-192). `tasks.module.ts` import thêm `SettingsModule` foundation (exports SettingService — settings.module.ts:22, tiền lệ employees.module.ts:63).
- **Side-effect:** to `Done` → set `completed_at=now(), completed_by=actor` ; to `Cancelled` → `cancelled_at/by` (cột có sẵn 0478:339-342). Reopen (nếu bật) → clear `completed_at/by`.
- Ghi `task_activity_logs` action `TASK_STATUS_CHANGED` (old/new values) + audit `TaskStatusChanged` objectType 'task' **trong cùng tx** (mirror task-core.service.ts:169-196).

## 3. Permission pairs (seed 0485 THẬT)

Catalog + grant trích **0485:67-84 (catalog) / 0485:114-191 (grant matrix, verify exact-set 0485:246-311)**; mirror TS: task-permissions.const.ts:94-130.

| Endpoint | `@RequirePermission` | employee | manager | hr | company-admin |
| --- | --- | --- | --- | --- | --- |
| POST /:id/assign | `('assign','task')` | ❌ **403** (không seed — 0485:119 "KHÔNG … assign") | ✅ @Team (0485:137) | ✅ @Company (0485:156) | ✅ @Company (0485:180) |
| POST /:id/change-status | `('update-status','task')` | ✅ @Own (0485:122) | ✅ @Team (0485:142) | ✅ @Company (0485:161) | ✅ @Company (0485:185) |
| POST /:id/change-priority | `('update-priority','task')` | ❌ **403** | ✅ @Team (0485:143) | ✅ @Company (0485:162) | ✅ @Company (0485:186) |
| POST /:id/change-deadline | `('update-deadline','task')` | ❌ **403** | ✅ @Team (0485:144) | ✅ @Company (0485:163) | ✅ @Company (0485:187) |
| POST /:id/watchers · DELETE /:id/watchers/:watcherId | `('watch','task')` | ✅ @Own (0485:125) | ✅ @Team (0485:139) | ✅ @Company (0485:159) | ✅ @Company (0485:183) |

- **TASK_DEFERRED_GRANTS KHÔNG chạm 5 cặp này** (chỉ create/update/delete:task — const.ts:140-144; BE-2 đã ship mà vẫn hoãn, task-core.int-spec.ts:6). Employee 403 trên assign/priority/deadline là **ĐÚNG THIẾT KẾ seed**, không phải deferred — test khẳng định, KHÔNG "sửa" bằng grant mới.
- Tất cả 5 cặp `is_sensitive=false` (0485:71-78) → `@RequirePermission` không cần `{isSensitive:true}`.
- **Data-scope trong service (double-gate, mirror BE-2):** mỗi action `dataScope.resolveAndAssert(user.id, companyId, action, 'task')`; scope < Company ⇒ task phải qua `assertInScopeForWrite`-pattern (task-core.service.ts:334-352, `buildReadScopeExists` task-core.repository.ts:153-179) → ngoài scope = **404** nhất quán. Assignee đích qua `resolveAssignee` (task-core.service.ts:382-410): 400 `TASK-ERR-ASSIGNEE-INVALID`-nhóm cho not-found/inactive/no-account, **403 out-of-scope**.
- Cập nhật `tasks.permissions.spec.ts` GUARDED_MUTATIONS (hiện :39-59) thêm 6 handler mới.

## 4. Event outbox

**Pattern thật:** `OutboxService.enqueue(tx, {eventType, payload})` cùng tx nghiệp vụ (outbox.service.ts:16-24, ADR-0009); payload kèm `eventCode` canonical — mirror LEAVE (leave-approval.service.ts:179-190: `eventType:"leave.request.approved"`, `payload.eventCode:"LEAVE_REQUEST_APPROVED"`). OutboxService từ `EventsModule` @Global (đã import ở tasks.module.ts:24).

| eventCode (registry §9.5 — IMPLEMENTATION-07:565-570) | eventType outbox đề xuất | Trigger | Payload (non-sensitive) |
| --- | --- | --- | --- |
| `TASK_ASSIGNED` | `task.assigned` | assign lần đầu (old assignee NULL) | chung* + `assigneeEmployeeId`, `assigneeUserId` |
| `TASK_ASSIGNEE_CHANGED` | `task.assignee_changed` | đổi assignee (old ≠ new, old ≠ NULL) | chung* + old/new `assigneeEmployeeId`/`assigneeUserId` |
| `TASK_STATUS_CHANGED` | `task.status_changed` | transition hợp lệ commit | chung* + `fromStatus`, `toStatus`, `assigneeUserId`, `creatorUserId` |
| `TASK_PRIORITY_CHANGED` | `task.priority_changed` | đổi priority | chung* + `oldPriority`, `newPriority`, `assigneeUserId` |
| `TASK_DUE_DATE_CHANGED` | `task.due_date_changed` | đổi deadline | chung* + `oldDueAt`, `newDueAt`, `assigneeUserId` |

\* chung = `eventCode, taskId, taskTitle, projectId, actorUserId, actorEmployeeId`. **KHÔNG** đưa `description`, `reason/note` (text tự do — có thể nhạy cảm; SPEC-06 §19 + IMPLEMENTATION-07 §9.4 "Payload không chứa … dữ liệu nhạy cảm"). `actorUserId` bắt buộc — S4-INT-1 dùng để LOẠI actor khỏi recipient (backlog.mjs:4650). Watcher add/remove: **chỉ activity log, KHÔNG outbox** — registry §9.5 không có mã `TASK_WATCHER_*`, và "Producer §9.4: chỉ phát các mã có trong registry; không phát mã lạ" (IMPLEMENTATION-07:584).

**⚠️ Đối chiếu catalog NOTI seed 0481 (bài học TASK_MENTIONED) — LỆCH, nêu bật thay vì tự chế:**

| Registry §9.5 (BE-3 phát) | Catalog 0481 THẬT | Kết luận |
| --- | --- | --- |
| TASK_ASSIGNED | ✅ 0481:78, `is_enabled=true`, có template :229 | khớp |
| TASK_STATUS_CHANGED | ✅ 0481:79, enabled, template :233 | khớp |
| TASK_ASSIGNEE_CHANGED | ✅ 0481:96 nhưng `is_enabled=false`, KHÔNG template | phát vẫn đúng; NOTI im lặng theo thiết kế tới khi bật |
| **TASK_PRIORITY_CHANGED** | ❌ **KHÔNG CÓ trong 0481** | catalog lookup miss ở INT-1 |
| **TASK_DUE_DATE_CHANGED** | ❌ 0481:97 seed **`TASK_DEADLINE_CHANGED`** (tên KHÁC canonical §9.5) | catalog lookup miss ở INT-1 |

Quyết định: BE-3 **phát đúng mã canonical §9.5** (khớp done_when nguyên văn + DASH invalidation backlog.mjs:4668 dùng `TASK_DUE_DATE_CHANGED`). Vá catalog = migration seed mới — **NGOÀI paths WO này** (`apps/api/migrations/**` không được phép) → ghi **BLOCKER bàn giao** cho WO seed trước/cùng S4-INT-1 (mục 10 #2).

## 5. redTests (int-spec RED-trước)

File mới `apps/api/test/integration/task-actions.int-spec.ts` — mirror khuôn task-core.int-spec.ts (gate `describe.skipIf(!(hasDb && process.env.LANE_DB))` :42-48, seed helpers :91-135, assert outbox qua direct SQL như leave-approval.int-spec.ts:263). Cập nhật `apps/api/src/tasks/tasks.permissions.spec.ts` (guard metadata 6 handler mới). Unit spec `task-fsm.spec.ts` cho bảng transition thuần.

1. **FSM sai → 4xx + state không đổi:** admin `change-status` Todo→Done → 409 body code `TASK-ERR-WORKFLOW-INVALID`; direct query `task_status` vẫn 'Todo'; **0** outbox `task.status_changed`; **0** activity mới. Tương tự Todo→In Review, In Progress→Todo, Done→In Progress (reopen mặc định tắt) → 409.
2. **FSM hợp lệ:** Todo→In Progress→In Review→Done chuỗi 200; Done set `completed_at/by`; mỗi bước 1 activity `TASK_STATUS_CHANGED` (old/new values đúng) + 1 outbox payload `{eventCode:'TASK_STATUS_CHANGED', fromStatus, toStatus, actorUserId}`.
3. **Cancelled terminal:** task Cancelled → change-status/assign/change-priority/change-deadline đều 422 `TASK-ERR-TASK-CLOSED`, state không đổi.
4. **Checklist config:** seed `company_settings` key `require_checklist_done_before_task_done=true` + 1 item `is_done=false` → In Progress→Done 400 `TASK-ERR-CHECKLIST-REQUIRED`; tick done hết → 200. Config tắt/thiếu → Done không cần checklist.
5. **Assign deny:** employee (không grant `assign:task`) → 403 guard; manager @Team assign employee NGOÀI team → 403 out-of-scope; manager đổi task NGOÀI scope → 404; cross-tenant taskId → 404; assignee tenant khác → 400/404 không lộ.
6. **Assign đúng:** hr assign lần đầu → `tasks.main_assignee_employee_id`+`assignee_user_id` set, `task_assignees` đúng 1 hàng Main Active (unique 0478:71-73), activity `TASK_ASSIGNED`, outbox eventCode `TASK_ASSIGNED`; đổi người → hàng Main cũ `status='Removed'`+`removed_at`, hàng mới Active, activity+outbox `TASK_ASSIGNEE_CHANGED` kèm old/new; assign lại CHÍNH người đó → 200 no-op, **không** event/log trùng.
7. **Cảnh báo nghỉ phép (không chặn):** seed `leave_requests` status `'Approved'` (và 1 case lowercase `'approved'` legacy — CHECK union hr.ts:463-466) trùm `due_at` → assign trả 200 + `warnings[]` chứa `TASK-WARN-ASSIGNEE-ON-LEAVE` (API-06:1327); change-deadline vào giữa kỳ nghỉ → 200 + warning; task VẪN được gán/đổi (MVP không chặn — API-06:1292).
8. **Watcher:** POST tự-watch → hàng Active `watcher_type='Manual'`; POST lặp → **409 `TASK-ERR-DUPLICATE-WATCHER`** (SPEC-06 §18a:2127) + direct count = 1; DELETE → soft-remove (`status='Removed'`, `removed_at/by`, `deleted_at` set — thoả partial unique 0478:112-114); re-watch sau remove → 200; employee @Own watch task KHÔNG liên quan mình → 404; actor không có employee mapping → 400 fail-loud; watcherId tenant/task khác → 404.
9. **Priority/deadline:** employee → 403 (cặp không grant); mgr @Team đổi priority task trong team → 200 + activity `TASK_PRIORITY_CHANGED` + outbox `TASK_PRIORITY_CHANGED`; deadline mới < `start_at` → 400 `TASK-ERR-INVALID-DATE-RANGE` (CHECK 0478:364-365 + slug API-06:2452); deadline OK → activity `TASK_DUE_DATE_CHANGED` + outbox `TASK_DUE_DATE_CHANGED`.
10. **Actor-not-notify prep (INT):** mọi outbox payload có `actorUserId` = user gọi; KHÔNG chứa `description`/`reason`; các field recipient-hint (assigneeUserId/creatorUserId) hiện diện để INT-1 loại actor.
11. **Workflow task:** `task_type='workflow_step'` → assign/change-status/priority/deadline 400 (mirror guard BE-2); watch → 200.
12. **Append-only:** UPDATE/DELETE `task_activity_logs` qua app-role → fail (mirror task-core.int-spec).

## 6. filesToTouch

| File | Mới/Sửa | Ước lượng | Ghi chú |
| --- | --- | --- | --- |
| `packages/contracts/src/task-actions.ts` | MỚI | ~140 dòng | assignTask/changeTaskStatus/changeTaskPriority/changeTaskDeadline/addWatcher schemas + `taskActionWarningSchema` + response `{task, warnings}` — file MỚI vì task.ts đã 665 dòng (665+~130 sát trần 800) |
| `packages/contracts/src/index.ts` | Sửa (append 1 dòng) | +1 | `export * from "./task-actions";` (barrel :89 tiền lệ) |
| `apps/api/src/tasks/task-fsm.ts` | MỚI | ~70 | bảng transition thuần + `assertTransition()` trả mã lỗi slug |
| `apps/api/src/tasks/task-fsm.spec.ts` | MỚI | ~80 | unit FSM (không DB) |
| `apps/api/src/tasks/task-actions.repository.ts` | MỚI | ~330 | raw SQL (cột 0478 chưa typed — mirror task-core.repository.ts:8-12): update status/priority/due, task_assignees swap-Main, watchers insert/soft-remove/find, checklist pending count, leave overlap (`status IN ('approved','Approved')`), company_id bind tường minh |
| `apps/api/src/tasks/task-actions.service.ts` | MỚI | ~450 | 6 use-case; scope+guard+FSM+setting+warning+activity+audit+outbox trong 1 `withTenant` tx |
| `apps/api/src/tasks/tasks.controller.ts` | Sửa (append) | 252 → ~380 | 6 route + `@RequirePermission` đúng cặp §3 |
| `apps/api/src/tasks/tasks.dto.ts` | Sửa (append) | +~15 | createZodDto wrappers |
| `apps/api/src/tasks/task-activity.service.ts` | Sửa (append union) | 66 → ~80 | thêm `TASK_ASSIGNED / TASK_ASSIGNEE_CHANGED / TASK_STATUS_CHANGED / TASK_PRIORITY_CHANGED / TASK_DUE_DATE_CHANGED / TASK_WATCHER_ADDED / TASK_WATCHER_REMOVED`; targetType thêm `"Watcher"` / `"Assignee"` (CHECK 0478:217-219 đã cho phép) |
| `apps/api/src/tasks/tasks.module.ts` | Sửa (additive) | 51 → ~60 | providers TaskActionsService/Repository + import `SettingsModule` (foundation) |
| `apps/api/src/tasks/tasks.permissions.spec.ts` | Sửa (append) | +~10 hàng bảng | 6 handler mới vào GUARDED_MUTATIONS |
| `apps/api/test/integration/task-actions.int-spec.ts` | MỚI | ~700 | mục 5 |
| `docs/plans/S4-TASK-BE-3.md` | MỚI | plan này | |

Mọi file <800 dòng (CLAUDE.md:89). Tất cả trong paths cho phép của WO.

## 7. Steps triển khai tối thiểu để GREEN (thứ tự)

1. **Contracts** — `task-actions.ts` + barrel + dto wrappers; `pnpm --filter @mediaos/contracts build` (dual ESM/CJS).
2. **RED trước** — viết `task-actions.int-spec.ts` (mục 5) + cập nhật `tasks.permissions.spec.ts` + `task-fsm.spec.ts`; chạy trên LANE_DB cô lập (`bash scripts/lane-db-setup.sh taskbe3` → `export LANE_DB=mediaos_taskbe3`) → chứng minh ĐỎ (route 404 / guard thiếu).
3. **`task-fsm.ts`** thuần → unit xanh.
4. **`task-actions.repository.ts`** — raw SQL theo idiom task-core.repository (bind `company_id` mọi câu, chạy trong `TenantTx`).
5. **`task-actions.service.ts`** — mỗi action 1 `withTenant` tx: load raw task (404) → guard workflow (400) → guard Cancelled (422) → data-scope write (404) → FSM/validate (409/400) → checklist-setting (400) → mutate + side-effects (`completed_at`…, task_assignees swap, watcher soft-remove) → leave-warning (SELECT read-only cross-module) → activity + audit + outbox **cùng tx** → reload DTO + `warnings[]`.
6. **Controller + module wiring** (khối additive).
7. Chạy int-spec → GREEN; `pnpm typecheck` + `check.sh`.
8. **FULL gate:** security-reviewer + database-lens + silent-failure-lens + santa-method (crown); cập nhật `harness/backlog.mjs` status.

## 8. Invariants phải giữ

- **#1 company_id/tenant:** mọi query trong `db.withTenant` + `AND company_id = $bind` tường minh (RLS+FORCE đã bật trên tasks/task_assignees/task_watchers/task_activity_logs — 0478:61-66, 106-111, 221-226). Cross-tenant/out-of-scope → 404 không lộ.
- **#2 append-only + soft-delete:** `task_activity_logs` chỉ INSERT (GRANT 0478:238, ghi cùng tx — task-activity.service.ts:8-11); watcher/assignee gỡ = soft-remove (`status='Removed'`+`removed_at`+`deleted_at`), KHÔNG DELETE; outbox enqueue cùng tx (rollback ⇒ không event ma — outbox.service.ts:12-13).
- **#3 không secret/nhạy cảm:** payload outbox chỉ ID/enum/title/timestamp (mục 4); `reason/note` chỉ vào `task_activity_logs.message`, không vào event.
- **Permission:** double-gate guard (controller) + data-scope (service), fail-closed; audit `AuditService.record` objectType 'task' cho mọi mutation (DoD CLAUDE.md §8).
- **Actor-not-notify:** producer luôn ghi `actorUserId` vào payload; loại actor là trách nhiệm consumer S4-INT-1 (backlog.mjs:4650) — BE-3 chỉ chuẩn bị dữ liệu, test khẳng định field.
- **FSM bất khả xâm phạm:** task workflow-driven không đi qua route tay (guard mirror task-core.service.ts:42).

## 9. Risks & bẫy

1. **Hot-file `tasks.controller.ts` / `tasks.module.ts` / contracts barrel** — chỉ APPEND khối mới, không rewrite (CLAUDE.md §9.3).
2. **Route order NestJS:** 6 route mới đều dạng `:taskId/<static>` — không va `@Get(":taskId")` (khác method/độ dài path); vẫn khai SAU các route tĩnh hiện có, giữ nguyên thứ tự cũ (comment tasks.controller.ts:66).
3. **Legacy PATCH status drift:** cùng task có thể `status='completed'` (legacy) nhưng `task_status='In Progress'` — chấp nhận, ghi nợ (mục 1); KHÔNG map tự động.
4. **Catalog 0481 lệch registry** (TASK_PRIORITY_CHANGED thiếu, TASK_DEADLINE_CHANGED ≠ TASK_DUE_DATE_CHANGED) — mục 4; nếu không vá trước INT-1 = notification im lặng đúng kiểu bài học TASK_MENTIONED (backlog.mjs:4243).
5. **Watcher trùng — 2 nguồn mâu thuẫn:** API-06 §14.5.2 "trả success idempotent" vs done_when "watcher trùng bị chặn" + slug `TASK-ERR-DUPLICATE-WATCHER` 409 tồn tại (SPEC-06 §18a:2127). Chọn **409** (done_when + slug registry); unique index 0478:112-114 là hàng rào cuối — bắt lỗi 23505 → 409, không nuốt.
6. **Bẫy user_id legacy (bài học BE-1 plan §3):** `task_watchers.employee_id NOT NULL` (0478:89) — actor không có `employee_profiles` mapping ⇒ 400 fail-loud, KHÔNG chèn mù; leave_requests check phải OR cả `user_id` (NOT NULL legacy) lẫn `employee_id` (nullable — hr.ts:398, 417) và status **union** `'approved'/'Approved'` (CHECK hr.ts:463-466).
7. **`task_assignees` chưa được BE-2 ghi:** create/PATCH hiện chỉ set `tasks.main_assignee_employee_id`. Assign mới phải xử lý "old Main không có hàng task_assignees" (swap-Main tolerant: soft-remove nếu có, insert mới luôn) — nếu không sẽ vỡ unique `uq_task_assignees_one_main_active` (0478:71-73) ở lần assign thứ 2.
8. **Dedupe event:** no-op (same assignee / same priority / same due_at) → 200 không event, tránh spam notification khi client retry; transition fail → nhờ cùng-tx nên không event rác.
9. **Raw `tx.execute` không type-parse** — timestamptz/boolean về string; normalize như task-core.service.ts:431-441.
10. **Checklist-setting key chưa có trong `setting-defaults.ts`** — `resolveSetting` trả `found=false` ⇒ mặc định TẮT (đúng "nếu config bật"); parse value phòng thủ (`true`/`"true"`).
11. **Env test:** phải LANE_DB cô lập (CLAUDE.md §9.5) — DB chung gây xanh/đỏ-giả.

## 10. Open questions cho plan-reviewer

1. **Tên route:** done_when viết `POST /:id/status·/priority·/deadline`; SPEC-06:1954+1964-1966 & API-06 §14 chốt `change-status/change-priority/change-deadline`. Plan chọn canonical theo spec (FRONTEND-11 sẽ gọi tên này). Xác nhận? (Nếu reviewer muốn khớp done_when từng chữ → đổi 3 path const, không ảnh hưởng phần còn lại.)
2. **BLOCKER bàn giao (cần người):** vá catalog NOTI (thêm `TASK_PRIORITY_CHANGED`, alias/đổi `TASK_DEADLINE_CHANGED`→`TASK_DUE_DATE_CHANGED` + template) = migration seed mới ngoài paths BE-3 — đề xuất WO `S4-NOTI-SEED-2` trước S4-INT-1. Đồng ý tạo backlog item?
3. **Reopen Done→In Progress:** mặc định TẮT theo BACKEND-08:495 "không mặc định"; có cần hook setting (vd `task.allow_reopen_done`) ngay trong WO này hay để WO sau? Plan: hard-off + mã 409, hook để sau.
4. **Watcher hộ người khác** (API-06:1640 "employee_id trong body nếu được phép"): plan cho phép khi target nằm trong data-scope `watch:task` của actor (tái dùng `isEmployeeInScope`); phương án chặt hơn = self-only MVP. Chọn phương án nào?
5. **Assignee ngoài project member:** SPEC-06:1412 "cảnh báo" — plan trả warning `TASK-WARN-ASSIGNEE-NOT-MEMBER` (mã WARN mới, mirror naming API-06:1327), không chặn. OK với mã warning tự đặt (spec không định nghĩa slug WARN này)?
6. **Same-value no-op = 200 im lặng** (không event/activity) — hay 409 `TASK-ERR-IDEMPOTENCY-CONFLICT`? Plan chọn 200 no-op (thân thiện retry khi chưa có Idempotency-Key).

## 11. KẾT QUẢ PLAN-REVIEW (2026-07-11) — PASS-with-conditions · BẮT BUỘC BÁM KHI CODE

Reviewer đã xác minh MỌI claim then chốt trên file thật (FSM §14.11 khớp từng ô; ma trận 0485 chính xác; catalog 0481 drift là thật; OutboxService cùng-tx đúng; 0478 đủ bảng/CHECK — DDL-free hợp lệ; SettingService key chưa tồn tại ⇒ mặc định TẮT; `assignee_user_id` là cột thật BE-2 đã ghi; route mới không va legacy PATCH /status; task tables chưa typed ⇒ raw SQL đúng).

### ĐIỀU KIỆN BẮT BUỘC (vá vào implement + test)

- **ĐK-1 (HIGH):** bổ sung redTests cho `change-status` của EMPLOYEE (hành động duy nhất employee làm được): (a) employee @Own đổi status task CỦA MÌNH → 200 + activity/outbox; (b) employee change-status task NGOÀI Own scope → **404** (chứng minh assertInScopeForWrite với scope=Own của update-status:task — không mượn cơ chế từ test assign).
- **ĐK-2 (handoff):** WO `S4-NOTI-SEED-2` sẽ được tạo ở backlog (ngoài lane này) để vá catalog 0481 trước S4-INT-1: thêm `TASK_PRIORITY_CHANGED`, đổi/alias `TASK_DEADLINE_CHANGED`→`TASK_DUE_DATE_CHANGED`, template + enable `TASK_ASSIGNEE_CHANGED`. BE-3 vẫn phát mã canonical §9.5 — KHÔNG tự chế theo catalog drift.
- **ĐK-3 (MEDIUM):** đếm checklist-pending PHẢI giới hạn theo `task_checklists.is_required_for_done=true` (0478:132) — KHÔNG đếm item của checklist không-bắt-buộc; test #4 seed `is_required_for_done=true` (thêm 1 case checklist không-bắt-buộc có item pending → Done vẫn 200).

### CẢNH BÁO NÊN VÁ (W1-W3 đưa vào code/test luôn)

- **W1:** thêm `taskCode` (nullable) vào payload chung outbox — template 0481 dùng `{task_code}`.
- **W2:** test #9 thêm assertion no-op same-value priority/deadline → 200 + 0 event.
- **W3:** thêm case cross-tenant taskId → 404 cho change-status/priority/deadline (không chỉ assign).
- W4/W5 (tham khảo): dispatcher dung nạp event chưa có consumer (tiền lệ LEAVE); cân nhắc trích logic resolveAssignee dùng chung — chấp nhận copy có kiểm soát trong service mới.

### OPEN QUESTIONS ĐÃ CHỐT

1. Route = canonical `change-status`/`change-priority`/`change-deadline` (API-06 §14; FE chưa build nên không vỡ consumer).
2. Tạo WO `S4-NOTI-SEED-2` — đồng ý (xem ĐK-2).
3. Reopen Done→In Progress: **hard-off + 409**, hook setting để WO sau (YAGNI).
4. Watcher: **self-only MVP** — POST /watchers KHÔNG nhận employee_id trong body; giảm bề mặt tấn công, tránh scope-path under-tested.
5. Warning `TASK-WARN-ASSIGNEE-NOT-MEMBER` OK — PHẢI khai enum warning trong `packages/contracts/src/task-actions.ts`; chỉ phát khi task có `project_id`.
6. Same-value no-op = **200 im lặng, 0 event/activity** — chốt.
