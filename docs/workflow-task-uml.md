# MediaOS — Workflow & Task: Phân tích kiến trúc theo chuẩn UML

> **Mục tiêu:** Hiểu **tất tần tật** domain *Workflow & Task* — từ **mô hình dữ liệu** (data), **cách thức hoạt động** (behavior), tới **kiến trúc** (structure) — diễn giải bằng các sơ đồ UML chuẩn.
> Nguồn sự thật: `apps/api/src/db/schema/workflow.ts` · `schema/approval.ts` · module `apps/api/src/workflow`, `apps/api/src/approval`, `apps/api/src/defect`, `apps/api/src/tasks`.
> Bổ trợ cho [`erd-current.md §5`](./erd-current.md) (cấu trúc dữ liệu) và [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) (kiến trúc tổng).
> Quyết định nền: **ADR-0016** (event-sourcing nhẹ: service ghi `in_progress/waiting_review`, **chỉ consumer** ghi `approved/revision`) · **ADR-0024** (task hub thống nhất).

---

## 0. Bản đồ khái niệm (Conceptual Map)

Domain chia làm **4 tầng khái niệm**, ánh xạ trực tiếp ra 17 bảng:

| Tầng | Vai trò | Bảng chính | Ẩn dụ |
|---|---|---|---|
| **A. TEMPLATE (Định nghĩa)** | "Quy trình *nên* chạy thế nào" — thiết kế tái dùng, có version | `workflow_definitions` · `workflow_definition_steps` · `workflow_step_dependencies` · `step_transitions` · `checklists` · `checklist_items` | Bản thiết kế (blueprint) |
| **B. INSTANCE (Thực thi)** | "Quy trình *đang* chạy cho 1 video/project cụ thể" | `workflow_instances` · `workflow_steps` · `workflow_step_checklist_states` · `workflow_step_instance_locks` | Dây chuyền sản xuất đang chạy |
| **C. APPROVAL (Phê duyệt)** | Vòng đời quyết định duyệt/trả-sửa (nguồn sự thật trạng thái) | `approval_requests` · `approval_steps` · `approval_rules` · `defects` | Hội đồng kiểm duyệt |
| **D. TASK HUB (Việc)** | Mặt phẳng công việc thống nhất cho *mọi* loại việc | `tasks` · `task_comments` · `task_attachments` | Bảng việc (Kanban) chung |

**Nguyên lý xuyên suốt:** Template là **lớp bất biến khi published**; Instance **pin `definition_version`** để đọc DAG đúng phiên bản; Approval là **nguồn sự thật** còn `workflow_steps.status` chỉ là **projection**; Task Hub là **điểm hội tụ** mọi việc (workflow, HR, finance, meeting…).

---

## 1. CLASS DIAGRAM — Mô hình miền (Domain Model)

### 1.1. Tầng A — TEMPLATE (định nghĩa quy trình)

```mermaid
classDiagram
    direction LR
    class WorkflowDefinition {
        <<AggregateRoot>>
        +UUID id
        +UUID companyId
        +string code
        +string name
        +string appliesTo "content_item|project"
        +int maxApprovalLevel
        +bool allowParallelSteps
        +int version
        +string status "draft|published|archived"
        +timestamp publishedAt
        +bool isActive
        +timestamp deletedAt
        --invariant--
        UQ(company, code, version) WHERE not deleted
        published ⇒ immutable (clone-on-edit)
    }
    class WorkflowDefinitionStep {
        +UUID id
        +int stepOrder "advisory pointer"
        +string code
        +string nodeKey "STABLE DAG identity"
        +string stepType "task"
        +string assigneeRoleCode
        +string reviewerRoleCode
        +bool isRequired
        +string defaultTaskTitle
        +UUID defaultChecklistId "↻ circular FK"
        +bool requiresEvaluation
        +int positionX, positionY "canvas"
    }
    class WorkflowStepDependency {
        <<DAG edge>>
        +UUID fromStepId "upstream"
        +UUID toStepId "downstream"
        +string dependencyType "finish_to_start|..."
        --invariant--
        CHECK from <> to (no self-loop)
        UQ(def, from, to)
        acyclic (enforced app-side)
    }
    class StepTransition {
        <<FSM guard table>>
        +string fromState
        +string event
        +string toState
        +string appliesToStepCode "null=all"
        +string writtenBy "service|consumer"
        --invariant--
        UQ(def, fromState, event)
    }
    class Checklist {
        +UUID id
        +string name
        +UUID workflowDefinitionStepId "↻ circular FK"
    }
    class ChecklistItem {
        +UUID id
        +string label
        +bool isRequired
        +int sortOrder
    }

    WorkflowDefinition "1" *-- "0..*" WorkflowDefinitionStep : steps
    WorkflowDefinition "1" *-- "0..*" WorkflowStepDependency : DAG edges
    WorkflowDefinition "1" *-- "0..*" StepTransition : FSM rules
    WorkflowDefinitionStep "1" o-- "0..1" Checklist : default ↻
    Checklist "1" *-- "0..*" ChecklistItem : items
    WorkflowStepDependency "*" --> "1" WorkflowDefinitionStep : from
    WorkflowStepDependency "*" --> "1" WorkflowDefinitionStep : to
```

**Điểm thiết kế cốt lõi:**
- `nodeKey` = **danh tính bền vững** của một bước trong DAG (tách khỏi `stepOrder` vốn chỉ còn là con trỏ advisory). Dependency và canvas tham chiếu `nodeKey`, nên instance đọc DAG đúng dù template clone sang version mới.
- **FK vòng** `WorkflowDefinitionStep.defaultChecklistId ⇄ Checklist.workflowDefinitionStepId` — Drizzle giải bằng lazy thunk (`AnyPgColumn`).
- `step_transitions` = **FSM dữ-liệu-hóa**: engine từ chối mọi cặp `(from_state, event)` không có trong bảng → có thể tùy biến luồng theo từng company mà không sửa code.

### 1.2. Tầng B + C — INSTANCE & APPROVAL (thực thi + phê duyệt)

```mermaid
classDiagram
    direction TB
    class WorkflowInstance {
        <<AggregateRoot>>
        +UUID id
        +UUID workflowDefinitionId
        +UUID contentItemId "XOR"
        +UUID projectId "XOR"
        +int currentStepOrder "advisory"
        +int definitionVersion "PIN template ver"
        +string status "active|completed|cancelled"
        --invariant--
        CHECK (content_item XOR project) = 1
        UQ active per content_item
        UQ active per project
    }
    class WorkflowStep {
        <<projection — ADR-0016>>
        +UUID id
        +int stepOrder
        +string stepCode
        +string nodeKey "→ template DAG"
        +string status "not_started|in_progress|waiting_review|approved|revision|blocked"
        +UUID assigneeUserId
        +UUID reviewerUserId
        +string submissionUrl, submissionNote
        +timestamp startedAt, submittedAt, approvedAt
        --invariant--
        service writes in_progress/waiting_review
        ONLY consumer writes approved/revision
    }
    class WorkflowStepChecklistState {
        +UUID workflowStepId
        +UUID checklistItemId
        +UUID checkedBy
        --invariant--
        UQ(step, item) — tick≤1; untick = DELETE
    }
    class WorkflowStepInstanceLock {
        <<revision lock>>
        +UUID lockedStepId
        +UUID causedByStepId
        +string lockReason "downstream_blocked_by_revision"
        +timestamp releasedAt "null=active"
        --invariant--
        UQ active(company, locked, causedBy) WHERE released IS NULL
    }
    class ApprovalRequest {
        <<source of truth>>
        +UUID id
        +UUID workflowStepId
        +UUID requestedBy
        +UUID assigneeId "reviewer"
        +string status "pending|approved|revision_requested"
        +int currentLevel
        +int maxLevel
        +timestamp decidedAt
        --invariant--
        UQ pending per step
    }
    class ApprovalStep {
        <<append-only>>
        +UUID approvalRequestId
        +int level
        +UUID approverUserId
        +string decision "approved|revision_requested"
        +timestamp decidedAt
        --invariant--
        UQ(request, level) — 1 quyết định/cấp
    }
    class ApprovalRule {
        +UUID workflowStepId
        +int level
        +UUID approverUserId "WHO decides at level"
        --invariant--
        CHECK level >= 1
    }
    class Defect {
        <<append-only>>
        +UUID workflowStepId
        +UUID responsibleUserId
        +UUID causedByApprovalStepId
        +string description
    }

    WorkflowInstance "1" *-- "1..*" WorkflowStep : steps
    WorkflowStep "1" *-- "0..*" WorkflowStepChecklistState : ticks
    WorkflowStep "1" o-- "0..*" WorkflowStepInstanceLock : lockedBy
    WorkflowStep "1" --> "0..*" WorkflowStepInstanceLock : causes
    WorkflowStep "1" *-- "0..*" ApprovalRequest : approvals
    WorkflowStep "1" o-- "0..*" ApprovalRule : levelRules
    ApprovalRequest "1" *-- "1..*" ApprovalStep : decisions
    WorkflowStep "1" *-- "0..*" Defect : defects
    ApprovalStep "1" o-- "0..1" Defect : caused
```

### 1.3. Tầng D — TASK HUB (việc thống nhất, BẤT BIẾN #4)

```mermaid
classDiagram
    direction LR
    class Task {
        <<unified hub>>
        +UUID id
        +string taskType "workflow_step|production|review|revision|meeting_action|office|finance|hr"
        +UUID workflowStepId "FK set null"
        +UUID workflowInstanceId "FK set null"
        +UUID contentItemId "FK set null"
        +UUID projectId "FK set null"
        +string title
        +UUID assigneeUserId
        +string status "not_started|in_progress|waiting_review|revision|approved|completed"
        +string origin "initial|revision"
        +int revisionRound
        +timestamp dueDate
        +timestamp deletedAt "soft delete"
        --invariant--
        UQ dedup(company, step, revisionRound) WHERE step NOT NULL & not deleted
    }
    class TaskComment {
        <<append-only>>
        +UUID taskId
        +UUID userId
        +string body
    }
    class TaskAttachment {
        <<append-only / soft-del>>
        +UUID taskId
        +UUID uploadedBy
        +string storageKey "SERVER-derived {co}/tasks/{task}/{uuid}"
        +string fileName, contentType
        +bigint sizeBytes
        +timestamp deletedAt
        --invariant--
        no signed URL stored (BẤT BIẾN #3)
    }

    Task "1" *-- "0..*" TaskComment : thread
    Task "1" *-- "0..*" TaskAttachment : files
    Task "0..*" ..> "0..1" WorkflowStep : workflow_step (hub link)
    Task "0..*" ..> "0..1" WorkflowInstance : context
```

> **`tasks` là HUB**: có FK thật (đều `ON DELETE SET NULL`) tới `workflow_step / workflow_instance / content_item / project`, đồng thời nhận **task polymorphic** từ HR (`leave_requests`, `attendance_adjustment_requests`), Finance (`expense_requests`), Meeting (`meeting_tasks.task_id` — uuid trần). Một bảng việc duy nhất cho toàn hệ thống.

---

## 2. PACKAGE / COMPONENT DIAGRAM — Kiến trúc tầng

Kiến trúc **Modular Monolith** kiểu **Controller → Service → Repository**, với 4 service hạt nhân **thuần logic** (pure, không chạm DB) để dễ test và tách biệt nghiệp vụ khỏi I/O.

```mermaid
flowchart TB
    subgraph API["REST API Layer (NestJS Controllers)"]
        WTC["WorkflowTemplatesController<br/>/workflow-templates/*"]
        WC["WorkflowController<br/>/workflow/*"]
        AIC["ApprovalInboxController<br/>/approvals/*"]
        DC["DefectController<br/>/defects/*"]
        TC["TasksController<br/>/tasks/*"]
        TAC["TaskAttachmentsController"]
    end

    subgraph SVC["Service Layer (business logic)"]
        WTS["WorkflowTemplatesService<br/>(publish, clone, versioning)"]
        WS["WorkflowService<br/>(start, apply, step start/submit)"]
        AS["ApprovalService<br/>(approve/revision fan-out)"]
        AMS["ApprovalMultilevelService<br/>(level progression)"]
        DS["DefectService"]
        TS["TasksService (hub)"]
        HTS["HrTasksService (stateless tx-bridge)"]
        TAS["TaskAttachmentsService"]
    end

    subgraph PURE["Pure Domain Logic (NO DB — highly testable)"]
        FSM["WorkflowFsmService<br/>validateService/ConsumerTransition"]
        DAGV["DagValidatorService<br/>Kahn cycle + BFS reachability"]
        DAGU["workflow-dag.ts<br/>deps-approved, newly-unblocked"]
        LPS["LockPropagationService<br/>transitive descendant locks"]
        ADP["DagResultAdapter<br/>rows↔nodeKey, code map"]
    end

    subgraph REPO["Repository Layer (Drizzle + withTenant/RLS)"]
        WTR["WorkflowTemplatesRepository"]
        WR["WorkflowRepository"]
        ARR["ApprovalRulesRepository"]
        DR["DefectRepository"]
        TR["TasksRepository"]
    end

    subgraph INFRA["Cross-cutting Infrastructure"]
        OUT["OutboxService<br/>(transactional events)"]
        WORK["OutboxWorker<br/>(FOR UPDATE SKIP LOCKED)"]
        AUD["AuditService (append-only)"]
        PERM["PermissionService (can/RLS)"]
        DB[("PostgreSQL 16<br/>RLS + FORCE")]
    end

    WTC --> WTS --> WTR
    WC --> WS --> WR
    WC --> AS --> WR
    AIC --> AMS --> ARR
    DC --> DS --> DR
    TC --> TS --> TR
    TAC --> TAS --> TR

    WS --> FSM
    WS --> DAGU
    AS --> DAGU
    AS --> LPS
    AMS --> AS
    WTS --> DAGV
    WTS --> ADP
    DS --> TS

    SVC --> OUT
    SVC --> AUD
    SVC -.guard.-> PERM
    REPO --> DB
    OUT --> DB
    WORK --> DB
    WORK -.dispatch.-> SVC
```

**Quy ước phụ thuộc (luật tầng):**
1. Controller chỉ gọi Service; **không** chạm Repository/DB.
2. Service chứa **toàn bộ nghiệp vụ**; ủy thác tính toán thuần cho tầng PURE; ủy thác I/O cho Repository.
3. **Tầng PURE không có DB** → service tự resolve dữ liệu *trong transaction của mình* rồi **truyền kết quả vào** (vd `dependenciesApproved`, `stepLocked`, `checklistComplete` cho FSM). Điều này giữ FSM/DAG **kiểm thử được 100% bằng unit test**.
4. Mọi Repository đi qua `withTenant(companyId, fn)` → `set_config('app.current_company_id')` → **RLS + FORCE** ép cô lập tenant ở tầng DB (BẤT BIẾN #1).
5. **Transactional Outbox**: event ghi cùng transaction với mutation nghiệp vụ → không mất event, không "ghi DB xong mới publish".

---

## 3. STATE MACHINE DIAGRAMS — Vòng đời

### 3.1. Step FSM (trái tim của hệ thống) — `MVP0_TRANSITIONS`

Bảng chuyển trạng thái dữ-liệu-hóa (7 transition), phân biệt **ai được ghi** (`writtenBy`):

```mermaid
stateDiagram-v2
    [*] --> not_started : task tạo ra
    not_started --> in_progress : **start** (service / assignee) T1
    in_progress --> waiting_review : **submit** (service / assignee) T2
    waiting_review --> approved : **approve** (consumer / reviewer) T3
    waiting_review --> revision : **request_revision** (consumer / reviewer) T4
    revision --> in_progress : **start** (service / assignee) T5
    approved --> in_progress : **open_next** (consumer / system) T6
    approved --> completed : **complete_workflow** (consumer / system) T7
    completed --> [*]

    note right of waiting_review
        ADR-0016: SERVICE chỉ ghi
        in_progress / waiting_review.
        approved / revision CHỈ do
        CONSUMER (qua approval pipeline).
    end note
    note left of in_progress
        blocked (status thứ 6) = nhánh DAG
        chờ; thể hiện qua LOCK, không phải
        transition trong bảng này.
    end note
```

**Thứ tự 7 guard khi `validateServiceTransition` (start/submit)** — *fail-closed, kiểm trước khi tra bảng*:

| # | Guard | Lỗi ném | Mục đích |
|---|---|---|---|
| 1 | `instance.status === 'active'` | `WorkflowInactiveError` | Không thao tác trên instance đã đóng |
| 2 | `step.instanceId === instance.id` | `WorkflowNotFoundError` | Chống nhầm/giả mạo step |
| 3a | `stepLocked !== true` | `StepLockedError` | Bị khóa do upstream đang revision (BR-006) |
| 3b | `dependenciesApproved !== false` | `DependenciesNotMetError` | Mọi DAG dep upstream phải approved (thay guard tuyến tính cũ) |
| 4 | `actor === step.assigneeUserId` | `NotStepActorError` | Chỉ người được giao mới start/submit |
| 5 | `(status, event)` có trong bảng | `IllegalTransitionError` | FSM hợp lệ |
| 6 | `(status:event)` ∈ `SERVICE_EVENTS` | `IllegalTransitionError` | Chặn service ghi event consumer-only |
| 7 | `checklistComplete !== false` (chỉ submit) | `ChecklistIncompleteError` | Mọi checklist *required* đã tick |

**`validateConsumerTransition` (approve/request_revision)** thêm guard **reviewer fail-closed**: `reviewerUserId === null` → từ chối (chống bất kỳ ai self-approve khi PM chưa gán reviewer); `reviewerUserId !== actorId` → `NotReviewerError`.

### 3.2. Approval Request — phê duyệt đa cấp (multilevel)

```mermaid
stateDiagram-v2
    [*] --> pending : submitStep tạo request (currentLevel=1)
    pending --> pending : approveLevel (level < maxLevel)\nappend approval_step + bump currentLevel
    pending --> approved : approveLevel (level == maxLevel)\n→ ApprovalService.approve()
    pending --> revision_requested : rejectLevel (BẤT KỲ cấp nào)\n→ ApprovalService.requestRevision()
    approved --> [*]
    revision_requested --> [*]

    note right of pending
        ApprovalMultilevelService:
        - approveLevel cấp trung gian: chỉ bump,
          KHÔNG duyệt step, KHÔNG fan-out DAG.
        - reject ở cấp 1 KHÔNG âm thầm lên cấp 2.
        - Row lock FOR UPDATE serialize đua tranh.
        - UQ(request, level) ⇒ 23505 = đã quyết.
        - assertActorIsCurrentLevelApprover (fail-closed:
          thiếu rule cấp hiện tại ⇒ không ai duyệt được).
    end note
```

### 3.3. Workflow Instance & Definition lifecycle

```mermaid
stateDiagram-v2
    state "WORKFLOW INSTANCE" as I {
        [*] --> active : start/apply
        active --> completed : last step approved\n(complete_workflow)
        active --> cancelled : hủy
        completed --> [*]
        cancelled --> [*]
    }
    state "WORKFLOW DEFINITION (template)" as D {
        [*] --> draft : create
        draft --> draft : edit steps/deps/checklists
        draft --> published : **publish** (DAG validation gate PASS)
        published --> archived : deprecate
        published --> draft : **clone** → version+1 (bản mới)
        archived --> [*]
        note right of published
            IMMUTABLE. Sửa = clone sang
            version mới (status=draft).
            Instance pin definitionVersion.
        end note
    }
```

### 3.4. Task lifecycle — phân nhánh theo `task_type`

```mermaid
stateDiagram-v2
    state "OFFICE / HR / FINANCE (manual)" as M {
        [*] --> not_started
        not_started --> in_progress : PATCH status (assignee)
        in_progress --> completed : PATCH status
        note right of in_progress
            officeTaskStatusSchema chỉ cho
            {not_started,in_progress,completed}.
            Validate tại SERVICE boundary (SEC-2).
        end note
    }
    state "WORKFLOW-DRIVEN (FSM-owned)" as W {
        [*] --> not_started2
        not_started2 --> in_progress2 : mirror step.start
        in_progress2 --> waiting_review2 : mirror step.submit
        waiting_review2 --> approved2 : mirror step.approve
        waiting_review2 --> revision2 : mirror step.request_revision
        revision2 --> not_started2 : task MỚI (revisionRound++)
        approved2 --> completed2 : workflow complete
        note right of waiting_review2
            PATCH/DELETE thủ công bị CHẶN.
            FSM consumer là chủ sở hữu trạng thái.
            WORKFLOW_TASK_TYPES = {workflow_step,
            production, review, revision}.
        end note
    }
```

---

## 4. SEQUENCE DIAGRAMS — Các luồng hoạt động chính

### 4.1. Áp template → tạo Instance + Task gốc

```mermaid
sequenceDiagram
    actor PM
    participant WTC as WorkflowTemplatesController
    participant WS as WorkflowService
    participant DAGU as workflow-dag.ts
    participant WR as WorkflowRepository
    participant OUT as Outbox
    participant DB

    PM->>WTC: POST /workflow-templates/:id/apply
    Note over WTC: @RequirePermission(apply, workflow-instance)
    WTC->>WS: applyTemplate(template, target)
    WS->>WR: assert template.status == 'published'
    WS->>WR: validate target (content_item XOR project)
    WS->>DB: BEGIN tx (withTenant)
    WS->>WR: INSERT workflow_instances (pin definitionVersion)
    WS->>WR: INSERT workflow_steps (mọi step, status=not_started)
    WS->>DAGU: tìm ROOT steps (in-degree 0)
    loop mỗi root step
        WS->>WR: createTask(workflow_step, origin=initial, round=0)
        Note over WR: onConflictDoNothing — dedup_key
    end
    WS->>OUT: enqueue("workflow.started")
    WS->>DB: COMMIT
    WS-->>PM: instance + root tasks
```

### 4.2. Start → Submit step (service-side FSM)

```mermaid
sequenceDiagram
    actor Assignee
    participant WC as WorkflowController
    participant WS as WorkflowService
    participant FSM as WorkflowFsmService
    participant WR as WorkflowRepository
    participant OUT as Outbox

    Assignee->>WC: POST /workflow/steps/:id/start
    WC->>WS: startStep(stepId, actor)
    WS->>DB: BEGIN tx
    WS->>WR: load step + instance (FOR read)
    WS->>WR: resolve stepLocked? (active locks)
    WS->>WR: resolve dependenciesApproved? (DAG)
    WS->>FSM: validateServiceTransition(start, guards 1..6)
    FSM-->>WS: transition{to: in_progress}
    WS->>WR: UPDATE step.status=in_progress, startedAt
    WS->>WR: UPDATE task.status=in_progress (mirror)
    WS->>DB: COMMIT

    Assignee->>WC: POST /workflow/steps/:id/submit (url, note)
    WC->>WS: submitStep(...)
    WS->>WR: resolve checklistComplete? (required items)
    WS->>FSM: validateServiceTransition(submit, guard 7)
    WS->>WR: UPDATE step.status=waiting_review, submittedAt
    WS->>WR: INSERT approval_requests (pending, level=1)
    WS->>OUT: enqueue("approval.requested")
    WS->>DB: COMMIT
```

### 4.3. Approve → DAG fan-out (mở bước kế / hoàn tất)

```mermaid
sequenceDiagram
    actor Reviewer
    participant WC as WorkflowController
    participant AS as ApprovalService
    participant FSM as WorkflowFsmService
    participant DAGU as workflow-dag.ts
    participant LPS as LockPropagation
    participant WR as WorkflowRepository
    participant OUT as Outbox

    Reviewer->>WC: POST /workflow/approval-requests/:id/approve
    WC->>AS: approve(requestId, actor)
    AS->>DB: BEGIN tx
    AS->>WR: SELECT instance FOR UPDATE (serialize join)
    AS->>FSM: validateConsumerTransition(approve, reviewer check)
    AS->>WR: UPDATE step.status=approved, approvedAt
    AS->>WR: UPDATE approval_request.status=approved
    AS->>WR: INSERT approval_step (decision=approved)
    AS->>LPS: releaseLocksForReapproved(step)
    AS->>DAGU: computeNewlyUnblockedStepIds(DAG, locks)
    alt còn bước downstream mở được
        loop mỗi step unblocked (no active lock)
            AS->>WR: createTask(open next) [dedup]
            AS->>OUT: enqueue("step.approved", newlyOpenedStepIds)
        end
    else đây là bước cuối, mọi required đã approved
        AS->>WR: UPDATE instance.status=completed
        AS->>OUT: enqueue("workflow.completed")
    end
    opt step.requiresEvaluation
        AS->>OUT: enqueue("step.evaluation_required") (G8 consumer)
    end
    AS->>DB: COMMIT
```

### 4.4. Request revision → Defect + lan truyền khóa (lock propagation)

```mermaid
sequenceDiagram
    actor Reviewer
    participant AS as ApprovalService
    participant LPS as LockPropagation
    participant DS as DefectService
    participant TS as TasksService
    participant WR
    participant OUT

    Reviewer->>AS: requestRevision(requestId)
    AS->>DB: BEGIN tx
    AS->>WR: UPDATE step.status=revision
    AS->>WR: UPDATE approval_request.status=revision_requested
    AS->>WR: INSERT approval_step (revision_requested)
    AS->>LPS: propagateRevisionLock(revisedStep, dagCtx)
    Note over LPS: computeTransitiveDescendants → khóa MỌI con cháu<br/>onConflictDoNothing (idempotent, multi-source LK5)
    LPS->>WR: INSERT wf_step_instance_locks[] (caused_by=revisedStep)
    AS->>WR: INSERT defect (append-only)
    AS->>WR: createTask(revisionRound++, origin=revision) [dedup mới]
    AS->>OUT: enqueue("step.revision_requested")
    AS->>DB: COMMIT
```

> Bước downstream bị khóa **chỉ mở lại** khi **mọi** nguồn khóa (caused_by) được re-approve (`releaseLocksForReapproved` xóa lock theo nguồn; join-point đa nguồn — LK5 — vẫn khóa tới khi nguồn cuối cùng được duyệt).

---

## 5. ACTIVITY DIAGRAM — Cổng kiểm DAG khi publish

```mermaid
flowchart TD
    A["POST /workflow-templates/:id/publish"] --> B{status == draft?}
    B -- no --> X1["TemplatePublishedImmutableError"]
    B -- yes --> C["load steps + deps trong tx"]
    C --> D["DagResultAdapter.buildDagInput<br/>(rows → nodeKey, FK integrity)"]
    D --> E["DagValidatorService.validateDag()"]
    E --> F1{trùng nodeKey?}
    F1 -- yes --> XR["aggregate errors"]
    E --> F2{self-dependency?}
    F2 -- yes --> XR
    E --> F3{endpoint không tồn tại?}
    F3 -- yes --> XR
    E --> F4{có ROOT (in-degree 0)?}
    F4 -- no --> XR
    E --> F5{chu trình? (Kahn topo-sort)}
    F5 -- yes --> XR
    E --> F6{node mồ côi? (BFS reachability)}
    F6 -- yes --> XR
    XR --> X2["TemplateDagInvalidError → HTTP 422 + list lỗi"]
    F1 & F2 & F3 & F4 & F5 & F6 -- tất cả PASS --> G["UPDATE status=published, publishedAt<br/>WHERE status=draft (atomic)"]
    G --> H["audit + return"]
```

**Thuật toán kiểm DAG** (`DagValidatorService`, thuần, gộp mọi lỗi — không early-return):
- **Chu trình:** Kahn topological sort — node còn dư sau khi rút hết in-degree-0 = node trong chu trình.
- **Khả đạt:** BFS từ tập root; node không thăm được = mồ côi (`UNREACHABLE_NODE`).
- **Cấu trúc:** trùng `nodeKey`, self-loop, endpoint lạ, thiếu root.

---

## 6. Mẫu thiết kế & bất biến (Design Patterns / Invariants)

| Pattern | Áp dụng | Cơ chế |
|---|---|---|
| **Transactional Outbox** | Mọi event nghiệp vụ | `outbox.enqueue(tx, …)` cùng tx với mutation → `OutboxWorker` đọc `FOR UPDATE SKIP LOCKED`, idempotent qua `processed_events(consumer, event_id)`, dead-letter sau 5 lần. |
| **Event-sourcing nhẹ / CQRS-projection (ADR-0016)** | `workflow_steps.status` | Approval (request/steps) = **write model / source of truth**; `workflow_steps.status` = **read projection**. Service ghi `in_progress/waiting_review`; **chỉ** consumer ghi `approved/revision`. |
| **Data-driven FSM** | `step_transitions` | Engine từ chối cặp `(from,event)` không khai báo → tùy biến luồng không cần đổi code. |
| **DAG (thay luồng tuyến tính)** | `workflow_step_dependencies` + `nodeKey` | Step mở khi *mọi* upstream approved; cho phép song song (`allow_parallel_steps`). `stepOrder` chỉ còn advisory. |
| **Idempotency / Dedup** | `tasks_dedup_key_uq(company, step, revisionRound)` | `onConflictDoNothing` chống sinh trùng task khi replay outbox. |
| **Append-only** | `approval_steps`, `defects`, `task_comments`, `task_attachments` | App role chỉ `SELECT/INSERT` (+`UPDATE(deleted_at)` cho attachment) — bảo toàn audit (BẤT BIẾN #2). |
| **Separation of Duties (SoD) đa cấp** | `approval_rules` + `approval_steps` | 1 quyết định/cấp (UQ), actor phải khớp approver cấp hiện tại, reject bất kỳ cấp → revision (không leo cấp ngầm). |
| **Exactly-one (XOR)** | `workflow_instances` | CHECK `(content_item XOR project) = 1`; UQ active per target. |
| **Optimistic immutability** | Template published | Clone-on-edit sang `version+1`; instance pin `definition_version`. |
| **Pure core, impure shell** | FSM / DAG / Lock / Adapter | Logic thuần không DB; service resolve dữ liệu trong tx rồi truyền vào → unit-test 100%. |
| **Hub thống nhất (ADR-0024)** | `tasks` | Một bảng việc cho workflow + HR + finance + meeting; FK `SET NULL` giữ task sống độc lập với nguồn. |

---

## 7. Use-Case View (tác nhân & quyền)

```mermaid
flowchart LR
    PM["PM / Quản lý"]
    AS_["Assignee (người làm)"]
    RV["Reviewer (cấp 1..N)"]
    SYS["System (OutboxWorker)"]

    PM --- UC1["Thiết kế & publish template"]
    PM --- UC2["Áp template / start workflow"]
    PM --- UC3["Gán assignee/reviewer cho step"]
    AS_ --- UC4["Start → tick checklist → Submit"]
    RV --- UC5["Approve / Request-revision (đa cấp)"]
    PM --- UC6["Tạo defect (trả sửa)"]
    SYS --- UC7["Fan-out DAG, mở bước kế, complete"]
    SYS --- UC8["Lan/giải khóa revision"]

    UC1 -.perm.-> P1["publish:workflow-template"]
    UC2 -.perm.-> P2["apply:workflow-instance"]
    UC3 -.perm.-> P3["update:content"]
    UC5 -.perm.-> P4["approve:approval-request + là approver cấp hiện tại"]
    UC6 -.perm.-> P5["create:defect"]
```

| Endpoint tiêu biểu | Verb | Quyền |
|---|---|---|
| `/workflow-templates` | POST | `create:workflow-template` |
| `/workflow-templates/:id/publish` | POST | `publish:workflow-template` (cổng DAG) |
| `/workflow-templates/:id/clone` | POST | `create:workflow-template` |
| `/workflow-templates/:id/apply` | POST | `apply:workflow-instance` |
| `/workflow/steps/:id/assign` | POST | `update:content` + PermissionGuard |
| `/workflow/steps/:id/start` · `/submit` | POST | RLS + FSM (actor = assignee) |
| `/workflow/approval-requests/:id/approve` · `/request-revision` | POST | RLS + FSM (actor = reviewer cấp hiện tại) |
| `/defects` | POST | `create:defect` (fail-closed trước tx) |
| `/tasks` (board) | GET | `read:task` |
| `/tasks` (tạo office) | POST | `create:task` |
| `/tasks/:id/status` | PATCH | `update:task` (chặn task workflow-driven) |
| `/tasks/:id/attachments` | POST | `create:task` **OR** là assignee (OR-gate) |

---

## 8. Tổng kết — "đọc" domain này thế nào

1. **Template** vẽ ra DAG các bước + FSM + checklist; **published là bất biến**, sửa thì clone version mới.
2. **Apply** một template lên 1 content_item *hoặc* project → sinh **instance** + **step projection** + **task gốc** cho các bước root.
3. **Assignee** start → tick required checklist → submit; FSM kiểm **7 guard fail-closed** rồi tạo **approval_request**.
4. **Reviewer** approve/reject; approval đa cấp leo cấp (`approval_rules`); chỉ **approve cấp cuối** mới chạm step.
5. **Consumer** (ADR-0016) ghi `approved/revision` lên projection, **fan-out DAG** mở bước kế hoặc **hoàn tất** instance; `requiresEvaluation` bắn event sang KPI/Evaluation (G8).
6. **Revision** sinh **defect** (append-only) + **task trả-sửa** (revisionRound++) + **lan khóa** mọi con cháu DAG; chỉ mở lại khi mọi nguồn re-approve.
7. Mọi việc đổ về **Task Hub** — một bảng `tasks` cho toàn hệ thống, với comment & attachment append-only.

> Sinh từ code tại nhánh `feat/web-ui-redesign-foundation` (đối chiếu schema `040dd82`). Cập nhật khi `workflow.ts` / module workflow đổi.
