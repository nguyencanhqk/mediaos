# DB-11: GOAL DATABASE DESIGN — MỤC TIÊU

> **Nguồn nghiệp vụ:** [SPEC-10 GOAL](<../SPEC/SPEC-10 GOAL.md>) · Quy ước chung: [DB-01](<DB-01 DATABASE DESIGN TỔNG QUAN.md>) §3.1/§7.9/§19b · TASK nền: [DB-06](<DB-06 TASK Database Design.md>) §3.3/§7.4
>
> **Liên quan:** [API-12 GOAL API Design](<../API Design/API-12_GOAL_API_Design.md>) · [DB-09 §8.14 index](<DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed GOAL](<DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9b](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | DB-11 |
| Tên tài liệu | GOAL Database Design — Mục tiêu phòng ban · dự án · nhân viên |
| Module | GOAL (SPEC-10) |
| Phiên bản | v1.0 — **Approved** (duyệt cùng SPEC-10 tại PR S5-GOAL-DOC-1, 23/07/2026) |
| Ngày tạo / cập nhật | 20/07/2026 / 23/07/2026 |
| Head migration lúc viết | idx 183 / `0503_s5_subtask1_leaf_counting` ⇒ migration GOAL bắt đầu **0504+** |
| Đã chạy thật (23/07/2026) | `0504`–`0507` (S5-GOAL-DB-1, PR #252). Head hiện tại idx 189 / `0509` — đợt D (`task_templates`) lấy **0510+**, xem §9 |

---

## 2. Mục đích tài liệu

Thiết kế dữ liệu cho module GOAL: cây mục tiêu 3 cấp (department/project/employee, chừa company), sổ check-in append-only, liên kết đo tiến độ với TASK, và bộ template phục vụ phân rã mục tiêu thành task. Mọi quy tắc nghiệp vụ (mã lỗi, công thức đo) sống ở SPEC-10 — file này chỉ đặc tả tầng dữ liệu.

---

## 3. Phạm vi thiết kế

### 3.1 Bảng mới trong DB-11

| Bảng | Vai trò | Ghi chú |
| --- | --- | --- |
| `goals` | Cây mục tiêu 1 bảng cho mọi cấp (GOAL-DEC-001) | soft delete |
| `goal_updates` | Sổ check-in / finalize / reopen | **append-only** (bất biến #2) |
| `task_templates` | Header template phân rã | DB-06 §3.3 từng chừa chỗ — kích hoạt tại đây |
| `task_template_items` | Từng task mẫu trong template | |

### 3.2 Bảng SỬA

| Bảng | Thay đổi | Ghi chú |
| --- | --- | --- |
| `tasks` (DB-06 §7.4) | thêm cột `goal_id UUID NULL` + FK + index partial | liên kết đo mode `tasks` (GOAL-DEC-006) |

### 3.3 Bảng dùng lại (không tạo mới)

`companies` · `users` · `employees` · `departments` (HR) · `projects` / `tasks` (TASK) · `roles`/`permissions`/`role_permissions` (AUTH) · `audit_logs` · `sequence_counters` (sinh `goal_code`) · `modules` + seed permission (Foundation) · `notification_*` (NOTI, qua outbox bridge).

---

## 4. Nguyên tắc thiết kế

1. **RLS + FORCE theo `company_id`** trên cả 4 bảng mới, policy literal-GUC theo mẫu 0479 (bất biến #1). Tạo policy **TRƯỚC** mọi INSERT.
2. **`goal_updates` append-only**: app role chỉ GRANT SELECT, INSERT — KHÔNG UPDATE/DELETE (bất biến #2, cùng họ `task_activity_logs`).
3. **Tiến độ là dẫn xuất + cache**: `goals.progress_percent` là cache, nguồn sự thật là công thức SPEC-10 §13; job đối soát đêm sửa drift.
4. **Cây thuần 1 bảng**: level phân biệt cấp; CHECK ràng buộc level↔cột neo; quan hệ cha-con validate ở service (chiều cấp + chống cycle), DB chỉ giữ FK.
5. **Soft delete** cho `goals`/`task_templates`/`task_template_items`; `goal_updates` không bao giờ xóa.
6. UUID PK `gen_random_uuid()`, timestamp UTC — theo DB-01.

---

## 5. ERD cấp module

```text
departments 1─n goals (level=department)
projects    1─n goals (level=project)      goals 1─n goals (parent_goal_id, cha cấp cao hơn)
employees   1─n goals (level=employee)     goals 1─n goal_updates (append-only)
employees   1─n goals (owner_employee_id)
goals       1─n tasks (tasks.goal_id, SET NULL khi goal bị xóa cứng — thực tế soft delete)
task_templates 1─n task_template_items
```

---

## 6. Chi tiết bảng

### 6.1 Bảng `goals`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK, `gen_random_uuid()` |
| `company_id` | UUID | Có | FK `companies.id`, RLS |
| `goal_code` | VARCHAR(100) | Có | qua `sequence_counters`, unique theo company |
| `name` | VARCHAR(255) | Có | |
| `description` | TEXT | Không | |
| `level` | VARCHAR(20) | Có | `company` / `department` / `project` / `employee` — MVP service chặn `company` (GOAL-ERR-004) |
| `department_id` | UUID | Theo level | FK `departments.id` |
| `project_id` | UUID | Theo level | FK `projects.id` |
| `employee_id` | UUID | Theo level | FK `employees.id` — chủ thể goal cá nhân |
| `parent_goal_id` | UUID | Không | FK `goals.id`; chiều cấp validate ở service (GOAL-ERR-002) |
| `owner_employee_id` | UUID | Có | FK `employees.id`; level=employee ⇒ = `employee_id` (GOAL-ERR-010) |
| `period_type` | VARCHAR(20) | Có | `quarter` / `year` / `custom` |
| `period_start` | DATE | Có | |
| `period_end` | DATE | Có | CHECK ≥ start |
| `measure_type` | VARCHAR(20) | Có | `percent` / `number` / `boolean`, default `percent` |
| `target_value` | NUMERIC(18,2) | Không | bắt buộc khi number+manual (GOAL-ERR-015, service) |
| `current_value` | NUMERIC(18,2) | Không | cập nhật qua check-in |
| `unit` | VARCHAR(50) | Không | "hợp đồng", "VNĐ", "%"… |
| `progress_mode` | VARCHAR(20) | Có | `manual` / `project` / `tasks` / `children`, default `manual` |
| `progress_percent` | NUMERIC(5,2) | Không | **cache dẫn xuất**; NULL = "chưa đo" (khác 0%) |
| `weight` | NUMERIC(8,2) | Có | default 1, CHECK > 0 |
| `status` | VARCHAR(20) | Có | `Draft` / `Active` / `Completed` / `Cancelled`, default `Draft` |
| `finalized_at` | TIMESTAMP | Không | chốt kỳ — đóng băng mọi số liệu |
| `finalized_by` | UUID | Không | FK `users.id` |
| `metadata` | JSONB | Không | |
| `created_at/by` `updated_at/by` `deleted_at/by` | | | chuẩn chung, soft delete |

#### Constraint/index

```sql
ALTER TABLE goals ADD CONSTRAINT chk_goals_level
CHECK (level IN ('company','department','project','employee'));

-- level ↔ cột neo (GOAL-ERR-001)
ALTER TABLE goals ADD CONSTRAINT chk_goals_level_anchor CHECK (
  (level = 'company'    AND department_id IS NULL     AND project_id IS NULL     AND employee_id IS NULL) OR
  (level = 'department' AND department_id IS NOT NULL AND project_id IS NULL     AND employee_id IS NULL) OR
  (level = 'project'    AND project_id IS NOT NULL    AND department_id IS NULL AND employee_id IS NULL) OR
  (level = 'employee'   AND employee_id IS NOT NULL   AND department_id IS NULL AND project_id IS NULL)
);

ALTER TABLE goals ADD CONSTRAINT chk_goals_period      CHECK (period_end >= period_start);
ALTER TABLE goals ADD CONSTRAINT chk_goals_period_type CHECK (period_type IN ('quarter','year','custom'));
ALTER TABLE goals ADD CONSTRAINT chk_goals_measure     CHECK (measure_type IN ('percent','number','boolean'));
ALTER TABLE goals ADD CONSTRAINT chk_goals_mode        CHECK (progress_mode IN ('manual','project','tasks','children'));
ALTER TABLE goals ADD CONSTRAINT chk_goals_mode_project CHECK (progress_mode <> 'project' OR level = 'project'); -- GOAL-ERR-012
ALTER TABLE goals ADD CONSTRAINT chk_goals_status      CHECK (status IN ('Draft','Active','Completed','Cancelled'));
ALTER TABLE goals ADD CONSTRAINT chk_goals_progress    CHECK (progress_percent IS NULL OR (progress_percent >= 0 AND progress_percent <= 100));
ALTER TABLE goals ADD CONSTRAINT chk_goals_weight      CHECK (weight > 0);
ALTER TABLE goals ADD CONSTRAINT chk_goals_no_self_parent CHECK (parent_goal_id IS NULL OR parent_goal_id <> id);

CREATE UNIQUE INDEX uq_goals_company_code_active ON goals (company_id, goal_code) WHERE deleted_at IS NULL;
CREATE INDEX idx_goals_company_level_period ON goals (company_id, level, period_start DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_goals_company_department   ON goals (company_id, department_id, status)   WHERE deleted_at IS NULL AND department_id IS NOT NULL;
CREATE INDEX idx_goals_company_project      ON goals (company_id, project_id)               WHERE deleted_at IS NULL AND project_id IS NOT NULL;
CREATE INDEX idx_goals_company_employee     ON goals (company_id, employee_id, period_start DESC) WHERE deleted_at IS NULL AND employee_id IS NOT NULL;
CREATE INDEX idx_goals_company_parent       ON goals (company_id, parent_goal_id)           WHERE deleted_at IS NULL AND parent_goal_id IS NOT NULL;
```

Ghi chú: chống cycle + đúng chiều cấp cha-con là **luật service** (cây tối đa 3 tầng MVP, kiểm khi ghi) — không dùng trigger đệ quy.

### 6.2 Bảng `goal_updates` — append-only

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` | UUID | Có | PK |
| `company_id` | UUID | Có | FK, RLS |
| `goal_id` | UUID | Có | FK `goals.id` |
| `update_type` | VARCHAR(20) | Có | `checkin` / `finalize` / `reopen` (recompute tự động KHÔNG ghi — tránh phình) |
| `actor_user_id` | UUID | Có | FK `users.id` |
| `old_current_value` / `new_current_value` | NUMERIC(18,2) | Không | |
| `old_progress_percent` / `new_progress_percent` | NUMERIC(5,2) | Không | |
| `confidence` | SMALLINT | Không | 0–100, cảm nhận khả năng đạt |
| `note` | TEXT | Không | |
| `created_at` | TIMESTAMP | Có | KHÔNG có updated/deleted — ledger |

```sql
ALTER TABLE goal_updates ADD CONSTRAINT chk_goal_updates_type CHECK (update_type IN ('checkin','finalize','reopen'));
ALTER TABLE goal_updates ADD CONSTRAINT chk_goal_updates_confidence CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 100));
CREATE INDEX idx_goal_updates_goal ON goal_updates (company_id, goal_id, created_at DESC);
-- GRANT: app role SELECT, INSERT — KHÔNG UPDATE/DELETE; worker SELECT.
```

### 6.3 Bảng `task_templates`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` / `company_id` | UUID | Có | PK / FK RLS |
| `name` | VARCHAR(255) | Có | |
| `description` | TEXT | Không | |
| `department_id` | UUID | Không | FK — template của phòng; NULL = dùng chung công ty |
| `is_active` | BOOLEAN | Có | default true |
| audit + soft delete | | | chuẩn chung |

```sql
CREATE UNIQUE INDEX uq_task_templates_company_name ON task_templates (company_id, name) WHERE deleted_at IS NULL;
CREATE INDEX idx_task_templates_company_dept ON task_templates (company_id, department_id) WHERE deleted_at IS NULL;
```

### 6.4 Bảng `task_template_items`

| Cột | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| `id` / `company_id` | UUID | Có | PK / FK RLS |
| `template_id` | UUID | Có | FK `task_templates.id` |
| `title` | VARCHAR(500) | Có | |
| `description` | TEXT | Không | |
| `default_priority` | VARCHAR(50) | Không | CHECK theo task priority DB-06 §8.5 |
| `estimate_hours` | NUMERIC(8,2) | Không | |
| `checklist` | JSONB | Không | mảng string — map vào task_checklists khi áp |
| `sort_order` | INTEGER | Có | default 0 |
| audit + soft delete | | | |

```sql
CREATE INDEX idx_task_template_items_tpl ON task_template_items (company_id, template_id, sort_order) WHERE deleted_at IS NULL;
```

### 6.5 SỬA bảng `tasks` — thêm `goal_id`

```sql
ALTER TABLE tasks ADD COLUMN goal_id UUID NULL;
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_goal FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE SET NULL; -- FK ĐƠN CỘT (bẫy composite-FK SET NULL không áp ở đây)
CREATE INDEX idx_tasks_company_goal ON tasks (company_id, goal_id) WHERE goal_id IS NOT NULL AND deleted_at IS NULL;
```

Quy tắc gắn (GOAL-ERR-008) ép ở service, không ép FK chéo ở DB (goal employee ↔ assignee thay đổi theo thời gian — service kiểm tại thời điểm gắn).

---

## 7. Enum chuẩn (đồng bộ packages/contracts)

| Nhóm | Giá trị |
| --- | --- |
| goal level | `company` · `department` · `project` · `employee` |
| period_type | `quarter` · `year` · `custom` |
| measure_type | `percent` · `number` · `boolean` |
| progress_mode | `manual` · `project` · `tasks` · `children` |
| goal status | `Draft` · `Active` · `Completed` · `Cancelled` |
| goal_update type | `checkin` · `finalize` · `reopen` |

---

## 8. Index theo use case

| Use case | Index dùng |
| --- | --- |
| Trang Mục tiêu theo kỳ + phòng | `idx_goals_company_level_period` + `idx_goals_company_department` |
| Cây con của 1 goal | `idx_goals_company_parent` |
| Mục tiêu của tôi (/me) | `idx_goals_company_employee` |
| Tab Mục tiêu trong project | `idx_goals_company_project` |
| Đếm task Done của goal (mode tasks) | `idx_tasks_company_goal` |
| Lịch sử check-in | `idx_goal_updates_goal` |

---

## 9. Seed & kế hoạch migration (0504+, lane DB tuần tự)

| Bước | Nội dung | Ràng buộc thứ tự |
| --- | --- | --- |
| 0504 | Tạo `goals` + `goal_updates` + **ENABLE/FORCE RLS + policy literal-GUC cả 2 bảng** + GRANT (goal_updates: SELECT,INSERT only — KHÔNG UPDATE/DELETE) + index | RLS TRƯỚC mọi INSERT (bất biến #1); đăng ký rls-registry |
| 0505 | ALTER `tasks` ADD `goal_id` + FK đơn cột + index partial — bảng `tasks` thật nằm ở `schema/workflow.ts` (tên file di sản), `projects` ở `schema/media.ts` | sau 0504 |
| 0506 | Seed module `GOAL` vào `modules` (mirror 0435, ON CONFLICT DO NOTHING) + **7 cặp** permission wave lõi (SPEC-10 §11, TRỪ manage/task-template → 0508) + grant per-pair data_scope 4 role canonical (DELETE-wrong-scope + INSERT ON CONFLICT, verify fail-LOUD mirror 0466/0476) + **UNION-ADD `'goal'` vào CHECK `audit_logs.object_type`** (DO-block idempotent mẫu 0474) + **seed `sequence_counters` 'goal' cho MỌI company** (mirror 0498: scope Company, prefix + padding, reset Never, ON CONFLICT DO NOTHING + verify fail-loud — thiếu là `SequenceNotFoundError` ngay goal đầu tiên, đúng bug QA2-CRIT-002 của task_code) | `is_sensitive` (nhất là finalize) chốt với owner TRONG plan WO — flip sau seed đụng pin canonical-seed |
| 0507 | **Seed NOTI catalog GOAL**: thêm `GOAL_ASSIGNED` + `GOAL_FINALIZED` vào `notification-event-catalog.const.ts` (isEnabled=true) + migration seed `notification_events` + template render (mirror 0481/0490; payload chỉ goal name + link) | PHẢI xong TRƯỚC khi BE-2 đăng ký registrar — bridge `registerSource()` **fail-loud NGAY LÚC BOOT** nếu eventCode chưa có trong catalog |
| **0510+** (đợt D) | Tạo `task_templates` + `task_template_items` + RLS + seed pair `('manage','task-template')` + UNION-ADD `'task_template'` vào audit CHECK | tách khỏi wave lõi — chỉ chạy khi làm phân rã. ⚠️ **Số 0508 dự kiến ban đầu ĐÃ BỊ CHIẾM** (`0508_lms_access_permission`, `0509_s5_lmsdb1_audit_lms_object_types` — wave LMS chen vào sau 20/07). Head tại 23/07/2026 = idx 189 / `0509` ⇒ đợt D lấy **0510+**; luôn đọc `migrations/meta/_journal.json` THẬT lúc chạy, đừng tin số ghi sẵn ở đây |

Số migration là **dự kiến** — nối tiếp head THẬT tại thời điểm chạy WO (kiểm `_journal.json` trước, tránh trùng số với lane khác — bẫy `wo-paths-drive-gate-and-scheduler`).

---

## 10. Đối chiếu bất biến

| Bất biến | Áp dụng trong DB-11 |
| --- | --- |
| #1 company_id + RLS FORCE | cả 4 bảng mới, policy trước INSERT, `withTenant` ở repo |
| #2 append-only / soft delete | `goal_updates` không UPDATE/DELETE (bổ sung danh sách ledger); `goals`/templates soft delete |
| #3 không secret | module không lưu secret; notification payload chỉ goal name + link |
