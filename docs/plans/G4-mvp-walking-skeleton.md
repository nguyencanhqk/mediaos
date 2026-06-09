# PLAN — G4 MVP-0 Walking Skeleton

> Tạo TRƯỚC khi viết code. Nguồn: `TASKS.md` G4 · `docs/spikes/workflow-state-machine.md` · `docs/erd-v2.md` · `CLAUDE.md` · ADR-0016.
> Branch: `feat/g4-mvp-skeleton`. Gate: LIGHT cho 🤖 tasks; FULL cho 🛠️ tasks (G4-3, G4-5).

---

## Meta

- **Mã:** G4 · **Mốc:** M1 (Lõi sống) — *first time system is alive end-to-end*
- **Model:** Haiku/Sonnet cho 🤖 AI-bulk; **Opus cho G4-3/G4-5** (FSM + approval — crown-jewel)
- **Ước lượng:** ~12–18 ngày focus
- **Thứ tự:** G4-1 → G4-2 → G4-3 → G4-4 → G4-5 → G4-6 → G4-7 → G4-8

---

## 1. Mục tiêu

Sau G4: **1 video thật đi trọn vòng đời** — tạo project/content → workflow auto-sinh task (Script→Edit→QA→Upload) → assignee nộp work → người duyệt approve/reject → pilot team dùng được thật sự.

---

## 2. Phụ thuộc toàn phase

- **G3 đã merge master** ✅ — `PermissionService.can()`, guard pipeline, `<PermissionGate>` + `useCan()` sẵn sàng.
- Mọi bảng mới phải có **RLS + FORCE** ngay khi CREATE — không có cửa sổ rò tenant.
- **Bất biến #4 (Task Hub):** mọi việc (sản xuất, duyệt, revision) → bảng **`tasks`** chung phân biệt `task_type`. **Cấm** bảng task riêng cho từng module.
- G4-5 approval phải đi qua **`approval_requests`** (không ghi thẳng `step.status`) theo ADR-0016.
- G2-5 isolation regression **phải chạy lại** sau mỗi migration thêm bảng mới.

---

## 3. DB Schema tổng hợp G4

> Chỉ liệt kê bảng MỚI (không kể bảng G1–G3 đã có).

### G4-1: Org/Employee

```
org_units (id, company_id, parent_id→org_units, name, type['department'|'division'], deleted_at)
teams     (id, company_id, org_unit_id→org_units, name, deleted_at)
team_members (id, company_id, team_id→teams, user_id→users, role_id→roles, joined_at, deleted_at)
```

RLS: `company_id = current_setting('app.current_company_id')::uuid` + FORCE ROW LEVEL SECURITY.
Soft-delete trên cả 3 bảng (`deleted_at`).

### G4-2: Channel + Project + Content

```
channels         (id, company_id, name, platform['youtube'|'tiktok'|'facebook'|'instagram'], status, deleted_at)
projects         (id, company_id, name, status, org_unit_id→org_units nullable, deleted_at)
project_channels (id, company_id, project_id→projects, channel_id→channels)
content_items    (id, company_id, project_id→projects, title, content_type['video'|'short'|'reel'], status, deleted_at)
```

### G4-3: Workflow

```
workflow_instances (id, company_id, content_item_id→content_items UNIQUE, current_step_order int, status, created_at)
workflow_steps     (id, company_id, instance_id→workflow_instances, step_order int, step_name text,
                    status['not_started'|'in_progress'|'waiting_review'|'approved'|'revision'],
                    assignee_id→users nullable, started_at, completed_at)
```

> Workflow hard-coded 4 bước: `1=Script · 2=Edit · 3=QA · 4=Upload`.
> `tasks` bảng chung (bất biến #4): `(id, company_id, task_type, ref_id, assignee_id, status, title, due_date, deleted_at)`.
> `tasks.ref_id` → `workflow_steps.id` khi `task_type = 'workflow_step'`.

### G4-4: Tasks + Comments + Attachments

```
task_comments   (id, company_id, task_id→tasks, user_id→users, body, created_at)
task_attachments(id, company_id, task_id→tasks, file_url, file_name, file_size, uploaded_by→users, created_at)
```

### G4-5: Approval + Defects

```
approval_requests (id, company_id, step_id→workflow_steps, requested_by→users, assignee_id→users,
                   status['pending'|'approved'|'rejected'], decided_at, comment, created_at)
defects           (id, company_id, approval_request_id→approval_requests, failed_step_order int,
                   responsible_user_id→users, description, created_at)
```

### G4-6: Notifications + Chat

```
notifications  (id, company_id, user_id→users, type, ref_id uuid, ref_type text, body, is_read bool default false, created_at)
chat_rooms     (id, company_id, ref_id→projects nullable, room_type['project'|'direct'], name, created_at)
chat_room_members (id, company_id, room_id→chat_rooms, user_id→users, joined_at)
chat_messages  (id, company_id, room_id→chat_rooms, sender_id→users, body, created_at)
```

---

## 4. API Endpoints mỗi sub-task

### G4-1 — Org/Employee

| Method | Path | Guard | Notes |
|--------|------|-------|-------|
| GET | `/org/departments` | JWT+Company | list org_units (tree hoặc flat) |
| POST | `/org/departments` | JWT+Company+`create:org-unit` | tạo phòng/khối |
| GET | `/org/teams` | JWT+Company | list teams |
| POST | `/org/teams` | JWT+Company+`create:team` | tạo team |
| POST | `/org/teams/:id/members` | JWT+Company+`manage:team` | thêm member + role |
| DELETE | `/org/teams/:id/members/:userId` | JWT+Company+`manage:team` | xoá member |
| GET | `/org/employees` | JWT+Company | list users với team/role info |

### G4-2 — Channel/Project/Content

| Method | Path | Guard |
|--------|------|-------|
| GET/POST | `/channels` | JWT+Company |
| GET/POST | `/projects` | JWT+Company |
| POST | `/projects/:id/channels` | JWT+Company+`manage:project` |
| GET/POST | `/projects/:id/content` | JWT+Company |

### G4-3 — Workflow

| Method | Path | Notes |
|--------|------|-------|
| POST | `/workflow/start` | body: `{contentItemId}` — tạo instance + 4 steps + task bước 1 |
| GET | `/workflow/:instanceId` | trả full instance + steps |
| POST | `/workflow/steps/:stepId/submit` | assignee nộp work → `waiting_review` |

### G4-4 — My Tasks

| Method | Path |
|--------|------|
| GET | `/tasks/my` | filter: status, type |
| POST | `/tasks/:id/submit` | submit file/link |
| POST | `/tasks/:id/comments` | thêm comment |

### G4-5 — Approval

| Method | Path | Notes |
|--------|------|-------|
| POST | `/approvals` | body: `{stepId}` — tạo approval request |
| POST | `/approvals/:id/approve` | → step `approved` → mở bước tiếp |
| POST | `/approvals/:id/reject` | body: `{failedStepOrder, responsibleUserId, description}` → sinh defects → bước về `revision` |

### G4-6 — Notification + Chat

| Method | Path |
|--------|------|
| GET | `/notifications` | filter: `is_read` |
| PATCH | `/notifications/:id/read` | |
| GET/POST | `/chat/rooms` | |
| GET/POST | `/chat/rooms/:id/messages` | |

---

## 5. FE Screens

| Sub-task | Routes | Notes |
|----------|--------|-------|
| G4-1 | `/org/departments`, `/org/teams`, `/org/employees` | list + inline role assign |
| G4-2 | `/channels`, `/projects`, `/projects/:id` | project detail shows channels + content list |
| G4-3 | `/projects/:id/content/:contentId/workflow` | workflow board (bước dọc/ngang) |
| G4-4 | `/tasks` (My Tasks) | filter tabs: Tất cả / Chờ nộp / Đã nộp |
| G4-5 | Review panel trong workflow screen | approve/reject form + defect form |
| G4-6 | Notification bell + `/chat/projects/:id` | sidebar chat |

---

## 6. Commit sequence

```
G4-1: feat(G4-1): org_units + teams + team_members schema + RLS + NestJS Org module + FE lists
G4-2: feat(G4-2): channels + projects + content_items schema + CRUD + FE screens
G4-3: test(G4-3): workflow FSM deny-path RED suite
      feat(G4-3): workflow hard-coded 4 steps + auto-task + submit
G4-4: feat(G4-4): tasks/my + comments + attachments
G4-5: test(G4-5): approval deny-path RED suite
      feat(G4-5): approval 1-level + return-revision + defects
G4-6: feat(G4-6): notifications + project chat room
G4-7: test(G4-7): E2E full video lifecycle
G4-8: chore(G4-8): pilot deploy notes + feedback template
```

---

## 7. Review gates

| Sub-task | Gate | Reviewers |
|----------|------|-----------|
| G4-1 | LIGHT | `ecc:typescript-reviewer` |
| G4-2 | LIGHT | `ecc:typescript-reviewer` |
| G4-3 | **FULL** | `ecc:security-reviewer` + `ecc:typescript-reviewer` + `ecc:silent-failure-hunter` |
| G4-4 | LIGHT | `ecc:typescript-reviewer` |
| G4-5 | **FULL** | `ecc:security-reviewer` + `ecc:typescript-reviewer` + `ecc:silent-failure-hunter` |
| G4-6 | LIGHT | `ecc:typescript-reviewer` |
| G4-7 | LIGHT | `ecc:e2e-runner` |

---

## 8. Acceptance (TASKS.md G4 "Done khi")

- Một video thật: tạo → task → nộp → duyệt → trả sửa → upload; **pilot team dùng được**. 🎉
- G2-5 isolation tests vẫn xanh sau mỗi migration mới.
- Coverage ≥ 80% cho G4-3 + G4-5 (module nhạy cảm).
