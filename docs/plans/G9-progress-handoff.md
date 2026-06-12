# G9 — Task Hub hợp nhất — PROGRESS HANDOFF

> Nhật ký thực thi G9 (bám [`G9-task-hub.md`](./G9-task-hub.md) §4). Cập nhật mỗi land.
> Branch: `feat/g9-taskhub`.

---

## G9-1 ✅ — land #1 (mig 0040)

`tasks` thành Hub: +`project_id`/`workflow_instance_id` nullable, nới CHECK `task_type` 8 loại (7 spec +
`workflow_step` back-compat, ADR-0024 widen-no-data-migrate). Tầng repo/service nền (`createTask`/`list*`/
`updateStatus`/`softDelete` + audit + deny-path workflow-task). Gate FULL PASS. **CHƯA nối controller.**

> ⚠️ **Đính chính so với plan §3:** G9-1 land bản GỌN hơn — **KHÔNG** thêm `created_by`/`description`/
> `priority`, **KHÔNG** tạo `task_attachments`, **KHÔNG** thêm CHECK một-chiều `tasks_workflow_step_link_check`,
> **KHÔNG** fix-forward `task_comments WITH CHECK`. G9-2+ phải bám hiện trạng mig 0040, không bám plan §3.

---

## G9-2 BE ✅ — land #2 (backend, no migration)

**Quyền đã sẵn:** `create/read/update/delete/assign/manage:task` + `comment:comment` đã seed **và grant**
company-admin/employee ở mig **0005** → **G9-2 KHÔNG cần migration**.

**Đã làm (apps/api/src/tasks):**
- **2a** `POST /tasks` — gate `create:task`; **SEC-1 tenant-FK guard in-tx** (`assigneeActiveTx`: cùng tenant +
  `status='active'` + chưa xoá; `projectExistsTx`: cùng tenant + chưa xoá) chạy TRƯỚC insert trong cùng
  `withTenant` tx. Lý do SEC-1: FK trỏ PK toàn cục → giá trị chéo tenant vẫn thoả ràng buộc DB, RLS chỉ chặn
  ĐỌC → phải chặn GHI app-side. Audit `TaskCreated`.
- **2b** `PATCH /tasks/:id/status` — gate `update:task`; **SEC-2** `status` thu hẹp `OfficeTaskStatusDto`
  (DTO `updateTaskStatusSchema` + `safeParse` defense-in-depth ở service); reject task workflow-driven
  (`workflowStepId != null || WORKFLOW_TASK_TYPES`). Audit `TaskStatusChanged`.
- **2c** `DELETE /tasks/:id` — gate `delete:task`; soft-delete (`deleted_at`, BẤT BIẾN #2); reject workflow
  task. Audit `TaskDeleted`. _(Attachment upload/delete **hoãn** — bảng `task_attachments` chưa land + chưa
  có storage R2/MinIO infra.)_
- **`POST /tasks/:id/comments`** — gate `comment:comment` (vá gate H-1: comment là WRITE, không để ngỏ như
  read; `employee` có sẵn quyền nên không regression).
- **DB-8/SF-2 (pagination):** bỏ magic `.limit(500)` → `DEFAULT_PAGE_SIZE=50`/`MAX_PAGE_SIZE=200` +
  `clampLimit`/`safeOffset` + `page?` trên `listAll/listByProject/listByTeam` (forward qua service). My Tasks
  giữ array bounded `MY_TASKS_CAP=200` (per-assignee).

**Test:** `tasks.service.spec.ts` (11 — SEC-1 deny CT5/CT6, CT1 office, FSM office, soft-delete CT11) +
`tasks.permissions.spec.ts` (18 — lock 4 gate + read mở). **api unit 456/456**, typecheck 4/4, lint sạch.

**Gate PASS:** `ecc:security-reviewer` + `ecc:silent-failure-hunter` + adversarial verify. CRITICAL=0.
BẤT BIẾN #1/#2 + audit-in-tx + FSM + catalog-match: PASS. Đã vá **H-1** (gate addComment), **L-1**
(`WORKFLOW_TASK_TYPES` `satisfies TaskTypeDto[]` — chống divergence khi thêm FSM type; lưu ý: KHÔNG derive
"all-minus-manual" vì sẽ sai-phân-loại meeting_action/finance/hr), **SF-3** (`page` threaded, tránh kẹp ngầm 50).

**2d FE ✅:** `tasksApi.createTask`/`updateTaskStatus`/`deleteTask` (`tasks-api.ts`, parse `taskSchema`, status
thu hẹp `OfficeTaskStatusDto`) + `CreateTaskDialog` "Giao việc tay" (title/assignee/due, plain useState +
shadcn Dialog/Input/Select — house style, KHÔNG RHF) bọc `<PermissionGate create task>` ở Tasks page,
invalidate `["tasks"]`. web typecheck/lint xanh · web test 133/133. _(Không spec riêng — đồng bộ convention:
`CreateProjectDialog`/`CreateChannelDialog` cũng không có spec; gating phủ bởi `permission-gate.spec`.)_

**G9-2 ĐÓNG.** status-change UI (Kanban luồng rút gọn) + delete UI + attachment → **G9-3** (Task Board).

---

## Deferred findings (theo dõi cho G9-3/4 / follow-up)

| ID | Sev | Nội dung | Đẩy về |
| --- | --- | --- | --- |
| H-2 | HIGH | `listBoard/listByProject/listByTeam` đã có service method nhưng CHƯA có route → **G9-3 3a PHẢI gate `read:task` (403 nếu thiếu, KHÔNG trả [])** + test gate trước khi land | G9-3 |
| SF-2/SF-1 | MED | Chưa có `paginationSchema` ở contracts → khi G9-3 nối query-param phải validate `limit/offset` (`z.number().int().min`) ở DTO; repo `clampLimit/safeOffset` đã robust (NaN/Infinity/âm) làm lưới cuối | G9-3 |
| SF-3b | MED | Board method trả rows-only (không `total/hasMore`) → G9-3 cân nhắc envelope `meta:{total,page,limit}` (đã có ở contracts `apiResponseSchema`) để báo truncation | G9-3 |
| M-2 | MED | `addComment` audit log full `body` (≤2000 ký tự) verbatim → cân nhắc truncate/chỉ log `commentId` (data governance) — code G4-4 cũ | follow-up |
| M-3 | MED | `PERMISSION_GUARD_ENABLED` kill-switch chưa ghi trong `.env.example` (G3) — blast radius tăng khi thêm endpoint | follow-up |
| M-1 | MED | `dueDate` dùng `z.string().datetime()` (offset:false) → input phải UTC (nhất quán UTC-at-rest) — không phải lỗi, ghi nhận | — |
| L-2 | LOW | `getComments` dùng 2 `withTenant` tách (assertExists + fetch) — benign TOCTOU (empty vs 404), code G4 | follow-up |
| L-3 | LOW | `assign:task`/`manage:task` seed nhưng chưa route nào dùng → reserve cho G9-4 bulk-assign | G9-4 |

---

## Thứ tự còn lại
```
G9-2 2d FE dialog "Giao việc"                                  [🤖, LIGHT]
G9-3 (3a filter+pagination API + gate read:task → 3b Board → 3c Detail Drawer)  [🤖, LIGHT]
G9-4 (4a refactor getMyTasks unified scope → 4b scope my/team/project/office → 4c card)  [🤖, LIGHT]
```
