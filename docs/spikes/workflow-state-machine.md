# Spike G0-3 — Thiết kế Workflow State Machine (MVP-0)

> **Loại tài liệu:** Design spike (KHÔNG code thật). Đầu vào cho task **G4-3** (1 workflow cứng 4 bước + auto-task) và **G4-5** (approval 1 cấp + return-revision).
> **Nguồn:** [`mvp-0-scope.md`](../mvp-0-scope.md) · [Workflow mẫu](../../THIẾT%20KẾ%20WORKFLOW%20MẪU%20—%20MVP%20v1.md) · [`erd-v2.md`](../erd-v2.md) · ADR [0009](../adr/0009-audit-outbox-event-bus.md) / [0010](../adr/0010-permission-engine-4-tier.md) / [0016](../adr/0016-approval-single-source-of-truth.md) · [`CLAUDE.md`](../../CLAUDE.md)
> **3 bất biến ràng buộc xuyên suốt:** (1) `company_id` ở mọi query (RLS FORCE) · (2) không hard-delete audit/snapshot (append-only) · (3) không secret plaintext.

---

## 1. Phạm vi spike

### 1.1. IN-SCOPE (MVP-0 — workflow cứng tuần tự)

- **Đúng 1 workflow hard-coded**: `Script → Edit → QA → Upload` (4 bước, rút gọn từ workflow mẫu 13 bước).
- **Tuần tự thuần**: bước N+1 chỉ mở khi bước N `approved`. Không nhánh, không hợp lưu.
- **Approval đúng 1 cấp** mỗi bước, **luôn đi qua `approval_requests`** (`max_level = 1`) theo ADR 0016 — không có đường tắt ghi thẳng `step.status`.
- **Return-revision 1 mức**: người duyệt chọn **bước lỗi + người chịu trách nhiệm** → sinh `defects` + đẩy bước về `revision`.
- **State machine mức bước** (9 trạng thái chuẩn nhưng MVP-0 chỉ dùng 6): `not_started`, `in_progress`, `waiting_review`, `approved`, `revision`, (`completed` = đồng nghĩa approved ở bước cuối). Các state `blocked`, `skipped`, `cancelled` **chỉ dùng tối thiểu** (xem §4 cho `blocked`).
- **Auto-sinh task** khi mở bước (idempotent qua `processed_events`).
- **Lock tuần tự đơn giản**: khi revision ở bước N, các bước N+1..cuối ở `not_started` và không cho thao tác (xem §4).

### 1.2. OUT-OF-SCOPE — hoãn rõ ràng

| Hạng mục | Hoãn tới |
| --- | --- |
| DAG, bước song song, hợp lưu nhiều nhánh, rule "Voice song song sau khi script duyệt" | **G0-3-đầy-đủ → G5a** |
| Lock-propagation đa nhánh ("lỗi nhân vật → khóa mọi cảnh dùng nhân vật"), bảng `workflow_step_instance_locks` dùng thật | **G0-3-đầy-đủ → G5a** |
| Approval 3 cấp (`max_level > 1`), escalation | **G5b** |
| Defect đầy đủ (severity, KPI penalty, evaluation form) | **G5b** |
| Workflow Builder canvas (React Flow), workflow cấu hình động | **G5a** |
| Bước không bắt buộc / `skipped`, deadline auto, KPI hooks | **G5a/G5b** |

> Bảng `workflow_step_instance_locks` (erd-v2 §5) **được tạo schema** nhưng MVP-0 dùng nó ở dạng tối giản (chỉ 1 lý do: "downstream chờ revision"), không có suy luận đa nhánh.

---

## 2. Mô hình dữ liệu trạng thái (mức khái niệm)

> Mọi bảng nghiệp vụ: `company_id UUID NOT NULL` + `ENABLE/FORCE ROW LEVEL SECURITY` + policy `tenant_isolation` (erd-v2 §6). Truy cập qua `withTenant(companyId, fn)`. Không lặp lại cột này ở từng bảng dưới (ngầm hiểu có).

### 2.1. `workflow_definitions` — template (global-per-tenant, ít thay đổi)

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK | |
| `company_id` | tenant |
| `code` | định danh ổn định (vd `video_standard_v0`) |
| `name` | "Video chuẩn MVP-0" |
| `applies_to` | `content_item` |
| `max_approval_level` | `1` (MVP-0) |
| `allow_parallel_steps` | `false` (MVP-0) |
| `is_active` / `deleted_at` | soft-delete được phép (KHÔNG phải bảng audit/snapshot) |

- MVP-0 có thể seed cứng 1 row. Cấu trúc bước nằm ở `workflow_definition_steps` để G5a mở Builder không phải đổi schema.

### 2.2. `workflow_definition_steps` — định nghĩa bước (template)

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` · `workflow_definition_id` FK | |
| `step_order` INT | 1..4, **UNIQUE `(workflow_definition_id, step_order)` WHERE deleted_at IS NULL** |
| `code` | `script` / `edit` / `qa` / `upload` |
| `name` | tên hiển thị |
| `assignee_role_code` | role mặc định người thực hiện (Script Writer…) |
| `reviewer_role_code` | role mặc định người duyệt (Project Manager…) |
| `is_required` | `true` (MVP-0 mọi bước bắt buộc) |
| `default_task_title` | "Viết kịch bản"… (template auto-task) |

### 2.3. `step_transitions` — cấu hình transition CHO PHÉP (data-driven guard)

> Tách bảng này để FSM **không hard-code trong service** — engine đọc bảng này để kiểm tra một transition có hợp lệ không. MVP-0 seed cứng theo §3.

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` · `workflow_definition_id` FK | |
| `from_state` | enum step state |
| `event` | `start` / `submit` / `approve` / `request_revision` / `open_next` |
| `to_state` | enum step state |
| `applies_to_step_code` | null = mọi bước; hoặc giới hạn (vd `open_next` không áp bước cuối) |
| UNIQUE `(workflow_definition_id, from_state, event)` | mỗi (state,event) chỉ 1 đích → FSM xác định |

### 2.4. `workflow_instances` — 1 lần chạy workflow cho 1 video

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` | |
| `workflow_definition_id` FK | |
| `content_item_id` FK (nullable) · `project_id` FK (nullable) | **CHECK đúng-một NOT NULL** (erd-v2 §9.1) — MVP-0 dùng `content_item_id` |
| `status` | `active` / `completed` / `cancelled` |
| `current_step_order` | con trỏ "bước đang hoạt động" (1..4); = projection, đổi qua consumer |
| `created_at` / `created_by` | |

### 2.5. `workflow_steps` (instance) — **PROJECTION** (ADR 0016)

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` · `workflow_instance_id` FK | |
| `step_order` INT · `step_code` | bản sao snapshot từ definition lúc tạo instance |
| `assignee_user_id` | người thực hiện thực tế (resolve từ role lúc tạo) |
| `reviewer_user_id` | "người **nên** duyệt" (định tuyến) — KHÔNG phải nguồn sự thật quyết định |
| `status` | **projection** `not_started/in_progress/waiting_review/approved/revision/blocked` — **CHỈ event consumer được ghi `approved`/`revision`** |
| `approved_at` | gương soi từ `approval_steps.decided_at` (chỉ consumer ghi) |
| `started_at` / `submitted_at` | mốc do service nghiệp vụ ghi cho `start`/`submit` (state không nhạy cảm duyệt) |

> **Ranh giới ghi (ADR 0016):** `start`, `submit` (→ `in_progress`, `waiting_review`) do service ghi. `approved`, `revision`, `open_next` (→ `in_progress` của bước kế) **chỉ consumer event ghi**. Cấm `UPDATE workflow_steps SET status='approved'` trong service.

### 2.6. `tasks` — đơn vị việc gắn bước (FK thật)

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` | |
| `workflow_step_id` FK · `content_item_id` FK | |
| `title` | từ `default_task_title` |
| `assignee_user_id` | = assignee của bước |
| `status` | `chưa bắt đầu/đang làm/chờ duyệt/cần sửa/đã duyệt/hoàn thành` |
| `origin` | `initial` / `revision` (phân biệt task gốc và task sửa) |
| `revision_round` INT | 0 cho task gốc, +1 mỗi vòng revision (idempotency key, §5) |
| `dedup_key` | UNIQUE `(company_id, workflow_step_id, revision_round)` WHERE deleted_at IS NULL — chống sinh trùng khi replay outbox |
| `deleted_at` | soft-delete được phép |

### 2.7. `approval_requests` + `approval_steps` — **NGUỒN SỰ THẬT** (ADR 0016)

`approval_requests`:

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` | |
| `workflow_step_instance_id` FK (nullable) · `task_id` FK (nullable) | **CHECK đúng-một** (erd-v2 §9.1). MVP-0 nhắm `workflow_step_instance_id` |
| `status` | `pending` / `approved` / `revision_requested` |
| `current_level` / `max_level` | `1 / 1` ở MVP-0 |
| `requested_by` / `created_at` | |

`approval_steps`:

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` · `approval_request_id` FK | |
| `level` | `1` |
| `approver_user_id` | người **thực sự** quyết |
| `decision` | `approved` / `revision_requested` (append-only ý niệm: 1 quyết định/level) |
| `decided_at` | thời điểm quyết — nguồn cho `step.approved_at` |
| `comment` | |

### 2.8. `defects` — hệ quả của `revision_requested` (KHÔNG phải kênh duyệt)

| Cột | Ý nghĩa |
| --- | --- |
| `id` PK · `company_id` | |
| `workflow_step_instance_id` FK | **bước lỗi** (người duyệt chọn) |
| `responsible_user_id` FK | **người chịu trách nhiệm** sửa |
| `caused_by_approval_step_id` FK | quyết định sinh ra defect này |
| `description` | mô tả lỗi |
| `created_at` | append-only (không hard-delete) |

### 2.9. `workflow_step_instance_locks` — schema có sẵn, MVP-0 dùng tối giản

(erd-v2 §5) MVP-0 chỉ ghi 1 lý do `downstream_blocked_by_revision`; suy luận đa nhánh → G5a.

### 2.10. Append-only / outbox

`audit_logs`, `outbox_events`, `processed_events`, `dead_letter_events` (erd-v2 §1, §3): app role chỉ INSERT/SELECT. `defects` không hard-delete. Quyết định trong `approval_steps` không bị overwrite (mỗi level 1 quyết định cuối).

---

## 3. Bảng transition đầy đủ (mức step)

> Engine kiểm tra bằng `step_transitions`. Cột "Người ghi" làm rõ ranh giới ADR 0016. Mọi transition đều validate `company_id` (cross-tenant = illegal tuyệt đối, §8).

| # | from_state | event | to_state | Guard / điều kiện | Side-effect | Người ghi |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | `not_started` | `start` | `in_progress` | actor = assignee của bước; bước này là `current_step_order`; instance `active` | `started_at`; audit `StepStarted` | Service |
| T2 | `in_progress` | `submit` | `waiting_review` | actor = assignee; có ràng buộc tối thiểu (file/link nộp tồn tại) | `submitted_at`; **tạo `approval_request` (max_level=1)**; emit `ApprovalRequested`; audit | Service |
| T3 | `waiting_review` | `approve` | `approved` | actor = approver hợp lệ (PermissionService); `approval_request.status` chuyển `approved` | ghi `approval_steps.decision=approved`+`decided_at` → cập nhật `approval_requests` → emit **`StepApproved`** qua outbox | Approval service ghi quyết định; **consumer** ghi `step.status=approved`,`approved_at` |
| T4 | `waiting_review` | `request_revision` | `revision` | actor = approver; người duyệt chọn **bước lỗi (= bước này ở MVP-0) + người chịu trách nhiệm** | ghi `approval_steps.decision=revision_requested` → emit **`StepReturnedForRevision`**; consumer: INSERT `defects`, sinh **revision task** (§5), khóa downstream (§4) | Approval service ghi quyết định; **consumer** ghi `step.status=revision` + tạo defect/task |
| T5 | `revision` | `start` | `in_progress` | actor = `responsible_user_id` của defect (hoặc assignee); defect liên quan chưa resolved | `started_at` (vòng mới); audit `RevisionStarted` | Service |
| T6 | `approved` | `open_next` (system) | bước kế: `not_started`→`in_progress` (hoặc set bước kế `not_started`→ sẵn sàng) | bước hiện tại `approved`; tồn tại bước `step_order+1` | consumer (nghe `StepApproved`): set `workflow_instances.current_step_order = +1`; **sinh task bước kế** (§5); mở khóa bước kế; emit `TaskCreated`; audit `StepOpened` | **Consumer** (idempotent) |
| T7 | `approved` (bước cuối, order=4) | `complete_workflow` (system) | instance `completed` | bước cuối `approved`; không còn bước kế | `workflow_instances.status=completed`; cập nhật `content_item` → `Published`; emit `WorkflowCompleted`; audit | **Consumer** |

### 3.1. Transition ILLEGAL (engine PHẢI reject — không có hàng trong `step_transitions`)

| Mã | Mô tả | Lý do reject |
| --- | --- | --- |
| X1 | `not_started → waiting_review` (submit khi chưa start) | bỏ qua `in_progress` |
| X2 | `not_started → approved` / `in_progress → approved` | duyệt bước chưa `waiting_review` (ADR 0016) |
| X3 | `approved → in_progress` / `approved → waiting_review` (nộp lại vào bước đã duyệt) | bước đã chốt; sửa phải qua revision của approver |
| X4 | `approved → revision` trực tiếp (không qua approver mới) | MVP-0 không reopen bước đã approved |
| X5 | `revision → waiting_review` (nộp thẳng không start lại) | phải qua `revision → in_progress → waiting_review` |
| X6 | `open_next` khi bước N **chưa** `approved` | mở bước N+1 sớm (vi phạm tuần tự) |
| X7 | bất kỳ transition khi `instance.status != active` | workflow completed/cancelled |
| X8 | mọi transition mà `company_id` actor ≠ row | cross-tenant (chặn ở RLS + guard) |

> Quy tắc engine: nếu `(from_state, event)` không có trong `step_transitions` của definition → **reject deterministic** (lỗi `IllegalTransition`), không "đoán". Đây là invariant test RED (§8).

---

## 4. Luật "khóa phần liên quan" (lock propagation) — MVP-0

Vì tuần tự thuần nên lock đơn giản: **khóa mọi bước SAU bước đang lỗi**.

### 4.1. Định nghĩa chính xác

- Khi `request_revision` ở **bước N** (T4):
  - Bước N → `revision`.
  - Bước **N+1 .. 4**: giữ ở `not_started` (chúng vốn chưa được mở vì tuần tự). Để biểu diễn rõ "bị chặn vì revision", consumer ghi 1 row `workflow_step_instance_locks` với `caused_by_step_instance_id = bước N`, `lock_reason='downstream_blocked_by_revision'` cho từng bước sau **đang/lẽ ra được mở** (thực tế ở MVP-0 chỉ bước N là active nên downstream vốn đã `not_started` → lock chủ yếu mang tính audit/hiển thị).
  - **Không cho thao tác** trên bước N+1..4: `start`/`submit`/`approve` đều illegal (guard T1 yêu cầu bước là `current_step_order`; revision không tăng con trỏ).
- `current_step_order` **không lùi** — vẫn = N (đang sửa tại chỗ).
- Bước **trước N** (1..N-1) đã `approved`: **không bị khóa, không reopen** (MVP-0 chỉ revise đúng 1 bước đang ở `waiting_review`).

### 4.2. Khi nào mở lại (release lock)

- Khi bước N được `approve` lại (vòng sau): `revision → in_progress → waiting_review → approved` (T5→T2→T3) → consumer chạy `open_next` (T6) → **release** mọi lock `downstream_blocked_by_revision` của instance (`released_at = now()`), mở bước N+1.
- Release là idempotent (replay an toàn): set `released_at` nếu đang null.

### 4.3. Phần hoãn

- Lock **đa nhánh** ("lỗi nhân vật chính → khóa mọi cảnh dùng nhân vật đó", "lỗi voice khóa dựng nhưng không khóa thumbnail") — từ workflow mẫu §6.6 — **hoãn sang G0-3-đầy-đủ/G5a**. MVP-0 không có nhánh nên không phát sinh.
- Reopen bước đã approved (revise bước 1 khi đang ở bước 3) → **G5a** (cần lock ngược + invalidate downstream đã duyệt).

---

## 5. Logic auto-sinh task

### 5.1. Khi nào sinh

| Sự kiện | Task sinh | revision_round | origin |
| --- | --- | --- | --- |
| Tạo workflow instance | sinh task cho **bước 1** (Script) khi bước 1 mở; bước 2..4 **chưa** sinh | 0 | `initial` |
| `open_next` (T6) sau khi bước N approved | sinh task cho **bước N+1** | 0 | `initial` |
| `request_revision` (T4) ở bước N | sinh **task revision mới** cho bước N | round trước +1 | `revision` |

> **Quyết định: revision sinh task MỚI**, không tái mở task cũ. Lý do: task cũ giữ lịch sử "đã nộp & bị trả" (append-only tinh thần audit), task mới mang vòng sửa rõ ràng + gắn `defect`. Task cũ chuyển `status='cần sửa'` để hiển thị ở My Tasks nhưng không nhận nộp mới.

### 5.2. Gán cho ai

- **Task initial**: `assignee_user_id = workflow_steps.assignee_user_id` (resolve từ `assignee_role_code` lúc tạo instance; nếu nhiều người cùng role → cần rule chọn 1, xem §9 câu hỏi mở).
- **Task revision**: `assignee_user_id = defects.responsible_user_id` (người duyệt chọn). Đây là điểm "trả sửa đúng người".

### 5.3. Idempotency (chống sinh trùng khi replay outbox)

- Consumer auto-task dùng `processed_events (consumer_name='autotask', event_id)` UNIQUE → 1 event xử lý đúng 1 lần (erd-v2 §1.2).
- Thêm lớp 2: `tasks.dedup_key = (company_id, workflow_step_id, revision_round)` partial-unique (§2.6) → kể cả event được replay với `processed_events` chưa kịp ghi (crash giữa chừng), INSERT trùng sẽ vi phạm unique → bắt và bỏ qua (no-op), không tạo task thứ 2.
- Toàn bộ: ghi nghiệp vụ + outbox **cùng transaction**; consumer xử lý idempotent.

---

## 6. Tương tác với Approval (ADR 0016)

- **`step.status` là projection** của `approval_requests`/`approval_steps`:
  - `waiting_review`: service tạo `approval_request(status=pending, max_level=1)` khi submit (T2).
  - `approved`: chỉ khi `approval_steps.decision=approved` → `approval_requests.status=approved` → emit `StepApproved` → **consumer** set `step.status=approved`, `approved_at = approval_steps.decided_at`.
  - `revision`: tương tự với `decision=revision_requested` → emit `StepReturnedForRevision` → consumer set `step.status=revision` + tạo `defects`.
- **Ai được tạo `approval_request`**: hệ thống tự tạo khi assignee `submit` (T2). Assignee không tự duyệt.
- **Ai được quyết (`approval_steps.decision`)**: chỉ user thỏa `PermissionService.can(user, 'approve', 'workflow_step_instance', stepId, ctx)` (ADR 0010, deny-by-default, scope project/channel). `reviewer_user_id` trên step chỉ là gợi ý định tuyến, **không** đồng nghĩa quyền.
- **Return-revision map dữ liệu**:
  - "bước lỗi" → `defects.workflow_step_instance_id` (MVP-0: chỉ chọn được chính bước đang `waiting_review` — chọn bước khác = illegal, §8 case D7).
  - "người chịu trách nhiệm" → `defects.responsible_user_id` → trở thành assignee của revision task (§5.2).
  - quyết định gốc → `defects.caused_by_approval_step_id`.

---

## 7. Audit & Outbox

### 7.1. Sự kiện ghi `audit_logs` (append-only, INSERT-only)

| Hành động | Audit | Ghi chú |
| --- | --- | --- |
| start / submit bước | `StepStarted`, `StepSubmitted` | actor, step, instance |
| quyết định duyệt | `StepApproved` | actor = approver, decided_at |
| trả sửa | `StepReturnedForRevision` | + defect (bước lỗi, người chịu trách nhiệm) |
| mở bước kế | `StepOpened` | system actor |
| hoàn tất workflow | `WorkflowCompleted` | content → Published |
| tạo task (initial/revision) | `TaskCreated` | assignee, round |

> Bắt buộc theo CLAUDE.md mục 8: mọi hành động quan trọng (duyệt/trả sửa/tạo) có audit. Audit không hard-delete (bất biến #2).

### 7.2. Sự kiện emit ra `outbox_events` (cùng transaction nghiệp vụ — ADR 0009)

| event_type | Sinh bởi | Consumer (idempotent) |
| --- | --- | --- |
| `approval.requested` | submit (T2) | notification (chờ duyệt) |
| `step.approved` | ghi quyết định approve (T3) | workflow-projection (set step.status), autotask (open_next + sinh task), notification (được duyệt) |
| `step.returned_for_revision` | ghi quyết định revision (T4) | workflow-projection (set revision + defect), autotask (revision task), lock (ghi downstream lock), notification (bị trả sửa) |
| `task.created` | autotask consumer | notification (task mới) |
| `workflow.completed` | open_next ở bước cuối (T7) | notification, (G5: KPI) |

- Consumer cập nhật `workflow_steps` là **DUY NHẤT** được phép ghi `status=approved/revision` (ADR 0016). Idempotent qua `processed_events`.
- Dead-letter + alert nếu consumer fail (erd-v2 §1.3).

---

## 8. Deny-cases / Illegal transitions cần test TRƯỚC (RED)

> Test deny-path trước (CLAUDE.md mục 6, ADR 0010). Mỗi case = 1 test RED phải fail-closed.

| # | Case | Kỳ vọng |
| --- | --- | --- |
| D1 | Approve bước đang `in_progress` (chưa `waiting_review`) | reject `IllegalTransition` (X2) |
| D2 | Submit/nộp work vào bước đã `approved` | reject (X3) |
| D3 | Mở/start bước N+1 khi bước N chưa `approved` | reject (X6), `current_step_order` không đổi |
| D4 | User công ty A approve/đọc step của công ty B | reject — RLS chặn 0 row + guard fail (X8, bất biến #1) |
| D5 | Revise một bước **không tồn tại** trong instance (stepId lạ / khác instance) | reject — FK/scope fail |
| D6 | Service ghi thẳng `UPDATE workflow_steps SET status='approved'` (bỏ qua approval) | cấm — chỉ consumer ghi (ADR 0016); test phát hiện ở FULL gate |
| D7 | Return-revision chọn bước lỗi ≠ bước đang `waiting_review` (vd revise bước 1 từ approver bước 3) | reject ở MVP-0 (reopen → G5a) |
| D8 | Approve bởi user **không có quyền** approve (chỉ là assignee, hoặc role khác) | reject — `PermissionService.can` deny-by-default (ADR 0010) |
| D9 | Assignee tự approve task của chính mình (self-approval) | reject — tách vai trò thực hiện/duyệt |
| D10 | Submit bước khi `instance.status != active` (completed/cancelled) | reject (X7) |
| D11 | Replay event `step.approved` 2 lần | idempotent — không sinh task trùng, không tăng `current_step_order` 2 lần (processed_events + dedup_key §5.3) |
| D12 | `revision → submit` thẳng (không start lại) | reject (X5) |

---

## 9. Câu hỏi mở / Rủi ro cần chốt trước khi code G4-3

1. **Resolve assignee từ role khi nhiều người cùng role**: bước có `assignee_role_code` nhưng project có >1 Script Writer → chọn ai? (round-robin / chọn lúc tạo project / để PM gán tay). Cần rule trước G4-3.
2. **Self-approval & reviewer routing**: `reviewer_user_id` mặc định resolve thế nào nếu reviewer_role có nhiều người? Có cấm assignee ≡ reviewer không (D9)? Đề xuất: cấm cứng ở MVP-0.
3. **"Đúng-một mục tiêu" của `approval_request`**: MVP-0 nhắm `workflow_step_instance_id`. Có dùng `task_id` cho luồng nào không, hay luôn step-level? Đề xuất: step-level only ở MVP-0.
4. **Trạng thái task khi revision**: task cũ chuyển `cần sửa` hay `hủy`? (đã đề xuất `cần sửa` + tạo task mới — cần xác nhận với UX My Tasks).
5. **`current_step_order` vs nhiều bước mở**: MVP-0 đúng 1 bước active tại 1 thời điểm — xác nhận không có race "approve bước N trong khi đang revision" (đã chặn bởi T-rules nhưng cần test concurrency D11-style với 2 approver đồng thời).
6. **`step_transitions` data-driven vs hard-code**: chốt mức độ — MVP-0 nên seed bảng (chuẩn cho G5a) hay tạm hard-code FSM trong code và migrate sau? Đề xuất: seed bảng ngay (chi phí thấp, tránh viết lại).
7. **`blocked` state**: MVP-0 có cần state `blocked` riêng cho downstream, hay chỉ dựa `not_started` + bảng lock? Đề xuất: dùng `not_started` + lock-row để giảm số state.
8. **Mapping `content_item.status` → `Published`**: chốt enum content và ai (consumer nào) sở hữu transition này khi `WorkflowCompleted`.
9. **Quyền tạo workflow instance**: ai được "áp workflow" lên content (PM? người tạo video?) — cần permission action cụ thể cho G4-2/G4-3.

---

_Liên quan: [`mvp-0-scope.md`](../mvp-0-scope.md) §2 (state machine) · [`erd-v2.md`](../erd-v2.md) §5, §8, §9.1 · ADR 0009/0010/0016 · [`CLAUDE.md`](../../CLAUDE.md) §2 (3 bất biến)._
