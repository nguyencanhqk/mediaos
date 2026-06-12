# G9 — Task Hub hợp nhất — KẾ HOẠCH CHI TIẾT

> **Bất biến #4 thành hiện thực:** MỌI nguồn việc (sản xuất, duyệt, trả sửa, task sau họp, đề xuất chi, đơn nghỉ, giao việc tay) → **chung bảng `tasks`**, phân biệt bằng `task_type`. **Cấm** bảng task riêng cho từng module.
> Chế độ: 🛠️ (G9-1 contract-test) + 🤖 (G9-2/3/4) · Cỡ: L · ~8–12 ngày.
> Nguồn sự thật: [`erd-v2.md`](../erd-v2.md) §6/§8/**§9.1/§262** · TASKS.md G9 · ADR 0009 (outbox) / 0010 (permission) / 0016 (approval single-source) · [`CLAUDE.md`](../../CLAUDE.md) §2 (bất biến #4) · spike workflow §5.3 (dedup_key).
> Lập: 2026-06-08 · **Review v2:** 2 reviewer (architect + database-reviewer) → BLOCKING fix đã áp (xem §9). · Branch dự kiến: `feat/g9-task-hub` (tạo **SAU khi G6-2 merge**).

---

## 0. Điều kiện tiên quyết & cảnh báo thứ tự (ĐỌC TRƯỚC)

1. **G9 phụ thuộc G6-2 merge — KHÔNG khởi công sớm.** Lý do **không phải logic** mà là hạ tầng:
   - `master` hiện chỉ tới **G3**; toàn bộ G4/G5/G6 (kể cả bảng `tasks` ở migration `0008`) đang nằm trên branch **`feat/g6-media`** chưa merge. Tạo branch G9 từ master sẽ **không có bảng `tasks`**.
   - Migration journal dùng chung: G6-2 còn `0027`(2d)/`0028`(2f) **và có thể `2g` rotation** đang chờ. Migration G9 phải đứng **sau** chúng. → **Tạo `feat/g9-task-hub` từ master CHỈ SAU KHI `feat/g6-media` (gồm G6-2) đã merge.**
2. **Permission + audit/outbox đã xong (G2/G3)** → đủ điều kiện luật phụ thuộc. G9 không nhạy cảm như secret/payroll → **không FULL gate**. G9-1 vẫn TDD contract-test trước.
3. **G9 làm TRƯỚC G8/G10/G11/G13.** Các module sau chỉ **emit vào `tasks`** (revision/defect G8, meeting_action G10, hr G11, finance G13). Làm G9 muộn → mỗi module tự đẻ bảng task riêng = **phá bất biến #4** + rework. G9 và **G7 độc lập** (G7 tái dùng `tasks` as-is) — thứ tự linh hoạt; khuyến nghị G9 trước (nhẹ, nền tảng).
4. **⚠️ Số migration KHÔNG hard-code — gán lúc thực thi + DE-CONFLICT G7 (BLOCKING B1/F1/F12).**
   - **KHÔNG ghi cứng `0029`/`when=1717500040000`.** Lúc 1a: đọc `apps/api/migrations/meta/_journal.json` (max hiện tại idx27/`when=1717500030000`, tag `0022`), lấy `idx = max_idx+1`, `when = max_applied_when + 1000` (verify **> mọi entry đã apply** TRƯỚC migrate — assert trong gate).
   - **G7 plan ĐANG cũng nhắm `0029` + `when≈1717500040000`** ([G7 §3](./G7-workflow-builder.md#L75) dòng 75/80/204). Đây là **xung đột thật, không phải chú thích thụ động.** ✅ **PRECONDITION bắt buộc trước G9-1a:** sửa G7 plan §3/§7 → renumber G7 sang `0030+` + bump `when`. Ai chạy trước thắng; bỏ bước này → bên còn lại vỡ journal ("xanh-giả" handoff G6 §4.2).

---

## 1. Phân tích khoảng cách: `tasks` hiện tại → Task Hub đầy đủ

### 1.1. Hiện trạng đã verify trong code (KHÔNG đoán)

Bảng `tasks` ([db/schema/workflow.ts:225-268](../../apps/api/src/db/schema/workflow.ts#L225-L268)):

| Cột | Kiểu | Ghi chú |
| --- | --- | --- |
| `id`, `company_id` | uuid | RLS+FORCE đã bật (migration `0008`, dùng `NULLIF(current_setting('app.current_company_id', true), '')::uuid`) |
| `task_type` | text NOT NULL default `'workflow_step'` | CHECK in (`workflow_step`,`office`,`meeting_action`,`hr`,`finance`) — **5 type** |
| `workflow_step_id` | uuid nullable FK→`workflow_steps` SET NULL | |
| `content_item_id` | uuid nullable FK→`content_items` SET NULL | đã nullable ✅ |
| `title`, `assignee_user_id`, `status`, `origin`, `revision_round`, `due_date`, `deleted_at`, `created_at`, `updated_at` | | `status` 6 giá trị; `origin` initial/revision |
| **dedup_key** uq | `(company_id, workflow_step_id, revision_round) WHERE workflow_step_id IS NOT NULL AND deleted_at IS NULL` | |

`task_comments` ([0009](../../apps/api/migrations/0009_tasks_submission_comments.sql)) đã có (RLS+FORCE — **nhưng policy thiếu `WITH CHECK` + dùng `current_setting` trần, là lỗ hổng** — xem §3.5). Service/Repo hiện tại chỉ có **`getMyTasks` (by assignee) + comments** — CHƯA có create/board/filter.

> ✅ **Bằng chứng sống cho CT1:** [`test/integration/rls-registry.ts:573-584`](../../apps/api/test/integration/rls-registry.ts#L573) đã seed `tasks` với `task_type='office'` + mọi context FK NULL → DoD "task non-video tạo được" **đã đúng ở tầng DB hiện tại**; G9-1 chỉ formalize qua service + CHECK + contract-test.

### 1.2. ⚠️ ĐÍNH CHÍNH so với tài liệu (đã verify — đừng tin tài liệu, tin code)

| Tài liệu nói | Thực tế code | Hệ quả cho G9 |
| --- | --- | --- |
| ERD §274: *"`tasks` đã dùng FK `project_id`…"* | **KHÔNG có cột `project_id`** | G9-1 **ADD** `project_id` |
| TASKS.md: 7 `task_type` | CHECK chỉ 5 (`workflow_step·office·meeting_action·hr·finance`) | D1 — KHÔNG migrate breaking |
| TASKS.md: `workflow_instance_id` nullable | Task chỉ link `workflow_step_id` | G9-1 ADD `workflow_instance_id` (soft-FK, D4) |
| TASKS.md DB list: `task_attachments` | **Chưa tồn tại** | G9-1 CREATE `task_attachments` |
| (ngầm) module sau emit vào tasks | **Không có cột source-ref** cho approval/leave/expense/meeting | **D8** (mới) — pattern real-FK per-module |

### 1.3. Cần thêm (G9 tạo)
- **Cột mới trên `tasks`:** `project_id` (FK→projects), `workflow_instance_id` (FK→workflow_instances), `created_by` (FK→users), `description` (text), `priority` (text).
- **CHECK consistency một-chiều** (D2) + index composite cho board.
- **Bảng `task_attachments`** (RLS chuẩn `0008`, có `deleted_at`).
- **Fix-forward** policy `task_comments` (thêm `WITH CHECK`).
- **Seed permissions** `create/read/update/assign/delete:task` (non-sensitive).

---

## 2. ✅ QUYẾT ĐỊNH KIẾN TRÚC — ĐÃ CHỐT (2026-06-08, user duyệt)

> 8/8 chốt. D1 (hoãn `review` tới G7/G8) + D8 (real-FK per-module) do user chọn trực tiếp; D2–D7 chốt theo mặc định (D2 bị ràng buộc kỹ thuật bởi B2). Đừng litigate lại khi code.

| # | Quyết định | Chốt | Đánh đổi |
| --- | --- | --- | --- |
| **D1** | 7 `task_type` của TASKS.md | **GIỮ 5 type literal trong DB.** Board suy ra: `origin='revision'`→**revision**; còn lại workflow_step→**production**. **`review` HOÃN** (cần tín hiệu vai-trò-bước sạch từ G7/G8 — KHÔNG multi-hop join ở G9, sửa M1). DoD "7 loại" = 5 literal + revision + production (review ghi rõ defer). | Lệch nhãn TASKS.md→cập nhật chú thích. `review` về sau. |
| **D2** | Ràng buộc context FK (sửa B2) | **TẤT CẢ nullable** + CHECK **một-chiều**: `CHECK (task_type = 'workflow_step' OR workflow_step_id IS NULL)` — **chỉ** task `workflow_step` được mang `workflow_step_id`; task `workflow_step` **có thể** step NULL (instance-level/quá độ G7), "phải có step" ép ở **FSM tầng service** (KHÔNG ở DB). Office/hr/finance/meeting_action mọi context NULL = **HỢP LỆ** (CT1). | KHÔNG box-in G7 (task link instance-trước-step) / G10. Guard `DO $$` verify vi phạm trước ADD. |
| **D3** | Luồng rút gọn (office) | **Tái dùng enum `status` 6 giá trị**; office giới hạn `{not_started, in_progress, completed}` qua **FSM service** (KHÔNG `waiting_review/approved/revision`). KHÔNG thêm enum. | FSM 2 nhánh: workflow vs office. |
| **D4** | `workflow_instance_id` | **ADD ngay** dạng soft-FK nullable; task G4 hiện NULL; G7 áp template → link instance. Nhất quán D2 (workflow_step task có thể có instance, step set sau). | Cột "ngủ" tới G7. FK→`workflow_instances` (đã có G4-3). |
| **D5** | `task_attachments` (sửa F2/F4/H1) | **Tạo mới** + **`deleted_at`** (soft-delete — attachment có thể là bằng chứng workflow, bất biến #2). RLS chuẩn `0008` (`NULLIF(...,true)` + **USING & WITH CHECK**). Worker **không** DELETE; app soft-delete. **Audit thao tác attachment dưới `objectType='task'`** (objectId=taskId) → KHÔNG cần ALTER audit-object-types. | +1 bảng rls-registry. |
| **D6** | Quyền giao việc tay | Gate **`create:task`** (non-sensitive). Assignee **bắt buộc cùng tenant + active** (guard in-tx). Soft-delete gate `delete:task`. | Seed permission + grant catalog. |
| **D7** | Idempotency office-task | Office-task tạo **đồng bộ trực tiếp** (không outbox) → **không cần dedup_key**; dedup_key giữ nguyên chỉ phủ workflow-task. | 2 office-task cùng title = 2 row (đúng). |
| **D8** | **Source-row linkage (MỚI — sửa B3, bất biến #4)** | **Mỗi module sau tự ADD cột real-FK nullable của riêng nó vào `tasks` trong migration của chính nó** — G8 `defect_id`/`approval_request_id`, G10 `meeting_id`, G11 `leave_request_id`/`attendance_adjustment_request_id`, G13 `expense_request_id` (mẫu real-FK của `approval_requests`, ERD §9.1/§262 + quyết định per-phase G6 §3.1). **G9 KHÔNG pre-add** (bảng đích chưa tồn tại → không FK được). **G9 PHẢI:** (a) `taskFilterSchema`/board query/DTO **mở-rộng-được** (không hard-code tập cột), (b) **ghi to pattern này** để không module nào đẻ bảng task riêng. | Lệch: cột tasks lớn dần qua các phase — chấp nhận (đúng real-FK over polymorphic của dự án). |

---

## 3. Migration plan — một migration `00NN_g9_task_hub.sql` (G9-1)

> Mỗi statement `--> statement-breakpoint`. CHECK **byte-identical** với `db/schema/workflow.ts`. RLS chuẩn **`0008`** (KHÔNG mirror lỗ hổng `0009`). Migrate → `tenant-isolation.int-spec.ts` + `rls-guards` regression → thêm `task_attachments` vào `rls-registry.ts` → commit.

**1. ALTER `tasks` — thêm cột (đều nullable / có default, KHÔNG vỡ data):**
```sql
ALTER TABLE tasks
  ADD COLUMN project_id           UUID REFERENCES projects(id)           ON DELETE SET NULL,
  ADD COLUMN workflow_instance_id UUID REFERENCES workflow_instances(id) ON DELETE SET NULL,
  ADD COLUMN created_by           UUID REFERENCES users(id)              ON DELETE SET NULL,
  ADD COLUMN description          TEXT,
  ADD COLUMN priority             TEXT NOT NULL DEFAULT 'medium';
```
> **F10:** dùng tập **`('low','medium','high','urgent')`** (đồng bộ `projects` `0023`), default `'medium'`. **M2:** CHECK `priority` **KHÔNG cần** `DO $$` guard vì `DEFAULT 'medium'` backfill mọi row cũ thoả ngay — ghi rõ lý do để qua database-reviewer.

**2. CHECK consistency một-chiều (D2/B2) — guard TRƯỚC ADD:**
```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tasks WHERE task_type <> 'workflow_step' AND workflow_step_id IS NOT NULL) THEN
    RAISE EXCEPTION 'tasks: non-workflow task must not carry workflow_step_id';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_workflow_step_link_check
  CHECK (task_type = 'workflow_step' OR workflow_step_id IS NULL);
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check
  CHECK (priority IN ('low','medium','high','urgent'));
```
> Data G4 thoả (mọi task workflow_step đều có step; chưa có office task). **KHÔNG** đổi `tasks_task_type_check` (giữ 5 type — D1). **KHÔNG** đổi `dedup_key` (D7).

**3. Index board (F7 — composite, KHÔNG single-column rời):**
```sql
CREATE INDEX tasks_created_by_idx               ON tasks (created_by);
CREATE INDEX tasks_project_id_idx               ON tasks (project_id);
CREATE INDEX tasks_workflow_instance_id_idx     ON tasks (workflow_instance_id);
CREATE INDEX tasks_company_type_active_idx      ON tasks (company_id, task_type)                    WHERE deleted_at IS NULL;
CREATE INDEX tasks_company_status_active_idx    ON tasks (company_id, status)                       WHERE deleted_at IS NULL;
CREATE INDEX tasks_company_assignee_status_idx  ON tasks (company_id, assignee_user_id, status)     WHERE deleted_at IS NULL;
```

**4. CREATE `task_attachments` (D5 — RLS chuẩn `0008`, F2/F4/F6/F11):**
```sql
CREATE TABLE task_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   UUID NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
               REFERENCES companies(id) ON DELETE CASCADE,
  task_id      UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  file_url     TEXT NOT NULL,
  file_name    TEXT NOT NULL,
  content_type TEXT,
  size_bytes   BIGINT,
  deleted_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> ... breakpoints ...
CREATE INDEX task_attachments_task_id_idx    ON task_attachments (task_id);
CREATE INDEX task_attachments_company_id_idx ON task_attachments (company_id);
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY task_attachments_tenant_isolation ON task_attachments
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE ON task_attachments TO mediaos_app;     -- KHÔNG DELETE (soft-delete)
GRANT SELECT ON task_attachments TO mediaos_worker;
```

**5. Fix-forward policy `task_comments` (F8 — vá lỗ hổng cross-tenant INSERT):**
```sql
ALTER POLICY task_comments_tenant_isolation ON task_comments
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
```

**6. Seed permissions (F5 — spell out đúng cột `0019`):**
```sql
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('create','task',false), ('read','task',false), ('update','task',false),
  ('assign','task',false), ('delete','task',false)
ON CONFLICT (action, resource_type) DO NOTHING;
```
> KHÔNG auto-gán system role — qua grant catalog.

**7. Journal (F1/F12):** `idx = live max+1`; `when = live max applied when + 1000` (đọc `_journal.json` lúc author, hiện max `1717500030000`). Verify `> mọi entry đã apply` TRƯỚC migrate. **KHÔNG hard-code.**

**8. rls-registry (F6):** thêm case `task_attachments` — seedRow: tạo task (`task_type='office'`, FK NULL) → tạo user (uploaded_by) → insert attachment → return id (theo chuỗi seed `task_comments` hiện có `rls-registry.ts:585+`).

---

## 4. Micro-steps theo THỨ TỰ (không đảo)

### G9-1 🛠️🔋 (M) — Chuẩn hoá `tasks` thành Hub + contract-test
- **1a** migration `00NN` (§3) → migrate (RUNBOOK G6 handoff §2: đặt env tay, KHÔNG `set -a . ./.env` vì path có space) → `tenant-isolation` + `rls-guards` regression → thêm `task_attachments` vào `rls-registry.ts` (shape §3.8) → commit. **Per-migration gate `ecc:database-reviewer`**.
- **1b** Drizzle schema (`workflow.ts`: +5 cột + 2 CHECK byte-identical + `taskAttachments` table) + contracts ([`packages/contracts/src/task.ts`](../../packages/contracts/src/task.ts): `taskTypeSchema`, `taskPrioritySchema` enum 4 giá trị, `createTaskSchema`, `taskAttachmentSchema`, **`taskFilterSchema` mở-rộng-được** D8).
- **1c** 🛠️ **Contract-test RED TRƯỚC** (§5). Test cốt lõi CT1: office task tạo được **không cần** video/step/content/project.
- **Gate**: 1a per-migration (database-reviewer) + 1c TDD. Coverage ≥80%.

### G9-2 🤖🟢 (S) — Giao việc tay + soft-delete
- **2a** BE: `TasksController` + `TasksService.createTask` (`task_type='office'`, `created_by=currentUser`, **guard assignee cùng tenant + active in-tx**, audit-in-tx `TaskCreated`). Gate `create:task`.
- **2b** FSM office rút gọn (D3): `PATCH /tasks/:id/status` validate nhánh office (chặn `waiting_review/approved/revision`). Audit `TaskStatusChanged`.
- **2c** 🆕 **soft-delete (M3):** `DELETE /tasks/:id` → set `deleted_at`, audit `TaskDeleted`, gate `delete:task`. Attachment upload/delete (`POST/DELETE /tasks/:id/attachments`) audit **dưới `objectType='task'`** (H1).
- **2d** FE: dialog "Giao việc" + `<PermissionGate create task>`.
- **Gate**: LIGHT.

### G9-3 🤖🟢 (L) — Task Board tổng
- **3a** BE: `GET /tasks` filter (`task_type`, `status`, `assignee`, `project_id`, `scope`, `q`) + pagination + map category (D1: revision/production; review defer). Gate `read:task` (**403 nếu thiếu** — không trả [] rỗng, L1).
- **3b** FE `/tasks/board`: Kanban (office 3 cột rút gọn) · Table (TanStack Table v8) · Calendar (`due_date`). Filter loại + view Office Tasks.
- **3c** FE Task Detail Drawer: tabs (Chi tiết · Comment G4-4 · Attachment) + badge loại.
- **Gate**: LIGHT.

### G9-4 🤖🟢 (M) — My/Team/Project gộp + thống nhất read-path
- **4a** 🆕 **refactor `getMyTasks` (H2):** gộp `findByAssignee` ([tasks.repository.ts:13-48](../../apps/api/src/tasks/tasks.repository.ts#L13)) vào query thống nhất `scope='my'` — **một code-path** (DRY); cập nhật caller FE G4-4. CT13 regression.
- **4b** BE scope: `my` (assignee) · **`team` = task có `project_id` ∈ project gắn team của user qua `project_teams`** (H3 — KHÔNG "task của mọi đồng đội", tránh unbounded) · `project` (project_id) · `office`. Một truy vấn `tasks`.
- **4c** FE: tabs My/Team/Project/Office; card **badge loại + bối cảnh điều kiện** (content title / project name / sau G10-13 meeting/đơn nghỉ/đề xuất chi). `created_by` NULL → render **"Hệ thống/Workflow"** (L2).
- **Gate**: LIGHT.

---

## 5. Contract-test / deny-path RED suite (viết TRƯỚC implement — G9-1 core)

**Hub contract (1c):**
- **CT1** ⭐ tạo `task_type='office'`, **mọi context FK NULL** → **THÀNH CÔNG** (DoD chính). _(baseline DB đã đúng: rls-registry:573-584.)_
- **CT2** tạo `task_type='workflow_step'` **thiếu** `workflow_step_id` → **service-FSM reject** (KHÔNG còn DB CHECK chặn — D2 cho phép step NULL ở DB; ép ở service).
- **CT3** tạo `task_type='office'` **kèm** `workflow_step_id` → **REJECT** (DB CHECK `tasks_workflow_step_link_check`).
- **CT4** `priority` ngoài enum → REJECT.

**Tenant/permission deny:**
- **CT5** company A gán `assignee_user_id` của B → guard in-tx reject.
- **CT6** company A `project_id` của B → reject (guard + RLS 0 row).
- **CT7** user KHÔNG `create:task` → tạo reject; KHÔNG `read:task` → board **403** (L1, fail-closed ADR-0010), KHÔNG phải `[]`. Audit cả deny.

**FSM office (2b/2c):**
- **CT8** office `in_progress→completed` OK; office→`waiting_review/approved/revision` REJECT.
- **CT11** xoá task = soft-delete (`deleted_at`) + audit `TaskDeleted`, KHÔNG hard-delete (bất biến #2); board filter `deleted_at IS NULL`. _(SUT = endpoint 2c.)_

**Regression / bất biến:**
- **CT9** task workflow G4 cũ thoả CHECK mới; start/submit/approve hết vòng (nối G4-3).
- **CT10** dedup_key chỉ phủ workflow-task: 2 office task cùng title → 2 row (D7).
- **CT12** cross-tenant board: A không thấy task/attachment của B (RLS + rls-registry `task_attachments`).
- **CT13** 🆕 sau refactor `getMyTasks` (4a): My Tasks vẫn trả task workflow + category projection (H2).
- **CT14** 🆕 team-scope isolation (H3): đồng đội của A trong company A KHÔNG thấy task company B; team-scope chỉ trả task project gắn team mình.
- **CT15** 🆕 `task_comments` cross-tenant **INSERT** bị chặn sau khi thêm `WITH CHECK` (F8).

---

## 6. Gates & DoD
- **G9-1**: per-migration `ecc:database-reviewer` + TDD contract-test RED→GREEN. **G9-2/3/4**: LIGHT (`ecc:typescript-reviewer` + `ecc:quality-gate`).
- **Per-migration**: migrate → `tenant-isolation` xanh → `rls-guards` xanh → thêm `task_attachments` vào `rls-registry.ts`.
- **Coverage ≥80%**; cao hơn cho `TasksService.createTask` + FSM office.
- **DoD G9** (TASKS.md): giao việc tay được; Task Board đủ loại (5 literal + revision/production suy ra, **review defer**); lọc theo loại; office đi luồng rút gọn; **không module nào có bảng task riêng** (bất biến #4 — D8 ép pattern).

---

## 7. Rủi ro & traps

| Rủi ro | Vá |
| --- | --- |
| **Journal `when` + số migration đụng G7** (B1/F1) | KHÔNG hard-code; `when=live max+1000`; **sửa G7 plan sang 0030+ TRƯỚC G9-1a** (precondition §0.4); assert `> max-applied` trước migrate. |
| **CHECK biconditional box-in G7/G10** (B2) | Dùng **một-chiều** `(task_type='workflow_step' OR workflow_step_id IS NULL)`; "must-have-step" ở FSM service. |
| **Bất biến #4 thiếu source-ref** (B3) | **D8**: module sau tự ADD real-FK; G9 làm filter/DTO mở-rộng-được + ghi to pattern. |
| **Mirror lỗ hổng RLS `0009`** (F2/F8) | `task_attachments` + fix-forward `task_comments` dùng `NULLIF(...,true)` + **USING & WITH CHECK** (chuẩn `0008`). |
| **attachment hard-delete mất bằng chứng** (F4) | `deleted_at` + worker không DELETE. |
| **2 read-path phân kỳ** (H2) | refactor `getMyTasks` → unified `scope=my` (4a) + CT13. |
| **team-scope unbounded** (H3) | định nghĩa qua `project_teams`; index + CT14. |
| **CHECK byte-lệch SQL↔schema** | `priority`/link-check copy y hệt vào `workflow.ts`. |
| **G7 ↔ G9 đụng `tasks`** | G7 tái dùng as-is; G9 chỉ thêm cột nullable + CHECK một-chiều tương thích. |

---

## 8. Thứ tự khởi công (sau khi G6-2 merge)
```
0a merge feat/g6-media (gồm G6-2) → master   [checkpoint]
0b sửa G7 plan §3/§7 renumber 0030+  [PRECONDITION B1]
0c tạo branch feat/g9-task-hub từ master
→ G9-1 (1a migration → 1b schema/contracts → 1c contract-test RED→GREEN)   [🛠️, database-reviewer]
→ G9-2 (2a create office → 2b FSM rút gọn → 2c soft-delete+attachment → 2d FE)  [🤖, LIGHT]
→ G9-3 (3a filter API → 3b Board → 3c Detail Drawer)                            [🤖, LIGHT]
→ G9-4 (4a refactor getMyTasks → 4b scope → 4c card)                            [🤖, LIGHT]
→ harness-audit (tùy chọn) → PR
```
> Tạo `docs/plans/G9-progress-handoff.md` khi bắt đầu 1a.

---

## 9. Review log (v2 — 2026-06-08)
> 2 reviewer song song (`ecc:architect` + `ecc:database-reviewer`), read-only, đối chiếu line thật.

**BLOCKING đã áp:** B1/F1 (journal/G7 de-conflict → §0.4 precondition) · B2 (CHECK một-chiều → D2) · B3 (source-ref → **D8 mới**) · F2 (RLS chuẩn 0008 → §3.4) · F5 (permission seed spell-out → §3.6) · F6 (rls-registry shape → §3.8) · F7 (index composite → §3.3).
**HIGH đã áp:** H1 (attachment audit dưới 'task' → D5/2c) · H2 (refactor getMyTasks → 4a/CT13) · H3 (team-scope qua project_teams → 4b/CT14) · F4 (attachment deleted_at → D5) · F8 (fix-forward task_comments WITH CHECK → §3.5/CT15) · F11 (GRANT spell-out → §3.4).
**MEDIUM đã áp:** M1 (review category defer → D1) · M2 (priority no-guard note → §3.1) · M3 (soft-delete writer → 2c/CT11) · F10 (priority dùng 'medium' đồng bộ projects → §3.1).
**LOW đã áp:** L1 (CT7 → 403) · L2 (created_by NULL → "Hệ thống/Workflow", 4c).
**Bác/để ý:** F3/F9/F13 (database-reviewer xác nhận KHÔNG phải lỗi — CHECK syntax/`wf_instances_target_check`/dedup_key office đều an toàn). M1 `review` category: chấp nhận DoD "7 loại" hiểu là 5 literal + 2 suy ra, `review` bổ sung khi G7/G8 có tín hiệu vai-trò-bước.

---

_Liên quan: [`erd-v2.md`](../erd-v2.md) §6/§8/§9.1/§262 · [`G7-workflow-builder.md`](./G7-workflow-builder.md) (renumber 0030+) · [`G6-progress-handoff.md`](./G6-progress-handoff.md) (RUNBOOK migrate + journal trap) · ADR 0009/0010/0016 · [`TASKS.md`](../../TASKS.md) G9._
