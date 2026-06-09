# G7 — Workflow Builder đầy đủ — KẾ HOẠCH CHI TIẾT

> **MOAT lớn nhất** của MediaOS. Biến workflow **cứng MVP-0** (G4-3) → **builder cấu hình động** (DAG: song song + tuần tự + phụ thuộc).
> Chế độ: 🛠️ TDD 🔋 · Cỡ: XL · **FULL gate** + deny-path RED trước + Opus cho phần FSM/DAG.
> Nguồn sự thật: [`workflow-state-machine.md`](../spikes/workflow-state-machine.md) (spike) · [`erd-v2.md`](../erd-v2.md) §5/§8/§9.1 · ADR 0009 (outbox) / 0010 (permission) / 0016 (approval single-source) · [`CLAUDE.md`](../../CLAUDE.md) §2 (3 bất biến).
> Lập: 2026-06-08 · Branch dự kiến: `feat/g7-workflow` (tạo SAU khi G6-2 merge).

---

## 0. Điều kiện tiên quyết & cảnh báo thứ tự (ĐỌC TRƯỚC)

1. **G7 phụ thuộc G6-2 hoàn tất.** Nguyên tắc solo #1 (tuần tự, không song song) + luật phụ thuộc: code module mới chỉ khi nhánh hiện tại đóng gọn. **Lập kế hoạch G7 ngay được; KHỞI CÔNG G7 chỉ sau khi G6-2 commit + FULL gate + merge.** Lý do kỹ thuật: tránh migration/journal đè nhau giữa 2 phase chưa đóng.
2. **Permission engine + audit/outbox đã xong (G2/G3)** → đủ điều kiện luật phụ thuộc cho module nhạy cảm. G7 không nhạy cảm như secret nhưng chạm permission (ai được tạo/áp workflow) → vẫn FULL gate ở phần logic.
3. **Migration G7 bắt đầu `0029`** (sau G6-2 dùng 0027/0028). ⚠️ **TRAP journal `when`** (xem §3 và handoff G6 §4.2): `when` của 0029+ phải **LỚN HƠN** max `when` đã apply lúc đó (G6-2 0022 dùng `when=1717500030000`; 0027/0028 sẽ > 30000). Đặt 0029 ≈ `1717500040000+`, tăng dần.

---

## 1. Phân tích khoảng cách: G4-3 (cứng) → G7 (động)

### 1.1. Đã có sẵn (G4-3 — tái dùng, KHÔNG làm lại)

| Bảng | Trạng thái hiện tại | G7 cần gì thêm |
| --- | --- | --- |
| `workflow_definitions` | có `allow_parallel_steps`(bool, luôn false), `max_approval_level`, `is_active`, `code` partial-uq | **+`version`, +`status`(draft/published/archived), +`published_at`, +`created_by`**; uq theo (code,version) |
| `workflow_definition_steps` | `step_order`, `code`, `assignee_role_code`, `reviewer_role_code`, `is_required`, `default_task_title`; uq (def,order) WHERE 1=1 | **+`node_key`(ổn định cho canvas/deps), +`position_x/y`(layout), +`step_type`, +`default_checklist_id`**; bỏ phụ thuộc `step_order` làm con trỏ |
| `step_transitions` | bảng data-driven FSM — **NHƯNG G4-3 KHÔNG dùng** (FSM hard-code `MVP0_TRANSITIONS` trong code) | **GIỮ schema, vẫn KHÔNG dùng** (xem D3 §2) — states phổ quát, không cấu hình per-workflow |
| `workflow_instances` | `current_step_order`(single pointer), `content_item_id` NOT NULL CHECK | **+`project_id` nullable + CHECK đúng-một** (erd §9.1); `current_step_order` → advisory (không còn guard) |
| `workflow_steps` (projection) | `step_order`, `status`, assignee/reviewer; uq (instance,order) | **+`node_key`** (map về template step); thêm tracking phụ thuộc (computed, không cột) |
| `tasks` | unified hub + `dedup_key` (company,step,round) | tái dùng nguyên; auto-task đổi nguồn kích hoạt (dep-open thay vì order+1) |
| `approval_requests`/`approval_steps` | single-source ADR-0016 | tái dùng nguyên (max_level vẫn 1 ở G7; 1–3 cấp là G8) |
| `defects` | append-only | tái dùng |
| `workflow_step_instance_locks` | có `locked_step_id`, `caused_by_step_id`, `lock_reason`, `released_at` | **dùng THẬT** cho lock-propagation đa nhánh (G4-3 chỉ ghi 1 lý do tuần tự) |

### 1.2. Bảng MỚI (G7 tạo)

- `workflow_step_dependencies` — **cạnh DAG** ở template (step B chờ step A). Đây là phần "cấu hình được" cốt lõi.
- `checklists` + `checklist_items` — template checklist gắn step.
- `workflow_step_checklist_states` — trạng thái tick checklist ở instance (append-friendly).

### 1.3. Thay đổi MÔ HÌNH lớn nhất (rủi ro cao — đọc kỹ)

**MVP-0 = tuần tự thuần, 1 con trỏ `current_step_order`.** Không biểu diễn được "2 bước chạy song song". G7 thay bằng **mô hình thoả-mãn-phụ-thuộc**:

> **Một bước `not_started` trở nên "mở" (startable) khi MỌI dependency upstream của nó đã `approved`.**
> - Tuần tự = chuỗi phụ thuộc tuyến tính (A→B→C→D).
> - Song song = fork: B và C cùng phụ thuộc A → khi A approved, **cả B và C mở cùng lúc**.
> - Hợp lưu = join: D phụ thuộc cả B và C → D chỉ mở khi **cả B và C approved**.

Hệ quả: bỏ guard `step.stepOrder === instance.currentStepOrder` (G4-3) → thay bằng guard `allDependenciesApproved(step)`. `open_next` (1 bước kế) → `openNewlyUnblockedSteps` (0..n bước). Workflow `completed` khi **mọi** step required `approved` (không phải "bước cuối theo order").

### 1.4. ⚠️ ĐÍNH CHÍNH kiến trúc ghi trạng thái — "consumer" trên giấy ≠ code thực tế (plan-review BLOCKING #1)

> **Đã verify trong `apps/api/src/workflow/approval.service.ts`:** KHÔNG có event-consumer projection tách rời. `ApprovalService.approve()` là **single-writer ĐỒNG BỘ trong 1 transaction**: ghi `approval_steps` → close `approval_request` → **ghi thẳng `workflow_steps.status='approved'`** (`repo.approveStep`, dòng 133) → update task → nếu last: `completeWorkflowInstance` (148); nếu không: `advanceInstanceStepOrder` con trỏ +1 (163). Outbox `step.approved` (164) **CHỈ** để notification — KHÔNG có consumer nào đọc nó để set projection.
>
> ADR-0016 nói "chỉ consumer ghi approved/revision" nhưng hiện thực hoá là **"chỉ ApprovalService (qua FSM `validateConsumerTransition`) được ghi approved/revision; service nghiệp vụ thường (`workflow.service` start/submit) KHÔNG được"**. Đây mới là invariant thực tế cần giữ.
>
> **Hệ quả cho G7-3c (sửa luận điểm sai của plan cũ):** `openNewlyUnblockedSteps` + `isWorkflowComplete` được tổng quát hoá **NGAY TRONG `ApprovalService.approve` (cùng tx)** — KHÔNG phải trong một "consumer" tưởng tượng. Bỏ `advanceInstanceStepOrder` (con trỏ tuyến tính) + `isLastStep = stepOrder >= maxStepOrder` (dòng 144). Invariant giữ: chỉ ApprovalService (path approve/revision qua FSM) ghi `approved`/`revision`/mở bước; `workflow.service` chỉ ghi `in_progress`/`waiting_review`. **Quyết định mở (D9 mới):** giữ mô hình single-writer đồng bộ này (KHÔNG dựng consumer thật ở G7 — YAGNI; tách consumer để dành nếu G8 1–3 cấp cần async). RED FS5 khẳng định `workflow.service` vẫn KHÔNG ghi được `approved`.

---

## 2. ⚠️ QUYẾT ĐỊNH KIẾN TRÚC — cần bạn duyệt TRƯỚC khi code

| # | Quyết định | Đề xuất (mặc định) | Đánh đổi |
| --- | --- | --- | --- |
| **D1** | Đặt tên bảng | **GIỮ tên cũ** `workflow_definitions`/`workflow_definition_steps`/`workflow_steps`; THÊM `workflow_step_dependencies`/`checklists`/`checklist_items`. TASKS.md ghi `workflow_templates`… chỉ là nhãn — KHÔNG rename (breaking vô ích). | Lệch tên giữa TASKS.md và DB → cập nhật chú thích TASKS.md. |
| **D2** | Tuần tự → DAG | **Bỏ single-pointer guard**, dùng "mở khi mọi dep approved". `current_step_order` giữ làm advisory (hiển thị sequential). | Phải tổng quát hoá `WorkflowFsmService` + consumer; viết lại deny-path. |
| **D3** | FSM động hay hằng | **States = hằng số dùng chung** (`not_started→in_progress→waiting_review→approved/revision` không đổi per-workflow). Cái cấu hình được là **ĐỒ THỊ bước** (`workflow_step_dependencies`), không phải states. `step_transitions` table để vestigial (YAGNI). | Nếu sau này cần custom state per-workflow (G8+) sẽ kích hoạt `step_transitions`. |
| **D4** | Versioning template | **Published version BẤT BIẾN.** Sửa template đã publish → **clone sang version mới** (`version+1`, status=draft). Instance đang chạy giữ snapshot version cũ → không vỡ. | Thêm `version`+`status`; logic clone; uq `(company,code,version)`. |
| **D5** | Lock BR-006 (WF-003) | Revision bước N → khóa **CHỈ hậu duệ phụ thuộc N** (transitive descendants trong DAG). Nhánh độc lập **vẫn mở**. | Cần thuật toán descendants + test "nhánh độc lập KHÔNG bị khóa". |
| **D6** | Phạm vi G7-2 canvas | **Tách 2 lớp**: (a) 🛠️ validate-DAG (RED-first, lõi) + lifecycle publish/clone; (b) 🤖 vẽ React Flow. Làm (a) trước — builder vẽ đẹp nhưng DAG sai = vô dụng. | Canvas đẹp đến sau; chấp nhận form-config tạm ở 2c nếu cần demo sớm. |
| **D7** | Backfill instance G4-3 cũ | Seed `video_standard_v0` thành 1 template **version 1 published** + sinh `workflow_step_dependencies` tuyến tính (script→edit→qa→upload) để instance cũ resolve qua engine mới. | 1 migration data nhỏ; test instance cũ vẫn chạy hết vòng. |

---

## 3. Migration plan (0029 → 0032)

> Mỗi migration: `--> statement-breakpoint` giữa MỌI statement · RLS+FORCE+policy `tenant_isolation` cho bảng mới · CHECK byte-identical với `db/schema/*.ts` · thêm journal entry (`when` tăng, > max-applied) · thêm bảng vào `test/integration/rls-registry.ts` · migrate + chạy `tenant-isolation.int-spec.ts` regression TRƯỚC khi commit.

### 0029 — G7-1: template config + DAG + checklist (template)
- ALTER `workflow_definitions`: `+version INT NOT NULL DEFAULT 1`, `+status TEXT NOT NULL DEFAULT 'draft'` CHECK in(draft,published,archived), `+published_at TIMESTAMPTZ`, `+created_by UUID`. Đổi uq `(company,code)` → `(company,code,version)` partial WHERE deleted_at IS NULL.
- ALTER `workflow_definition_steps`: `+node_key TEXT NOT NULL` (ổn định, dùng cho deps+canvas), `+step_type TEXT DEFAULT 'task'`, `+position_x INT`, `+position_y INT`, `+default_checklist_id UUID`. uq `(workflow_definition_id, node_key)`.
- CREATE `workflow_step_dependencies`: `id, company_id, workflow_definition_id, from_step_id FK→def_steps, to_step_id FK→def_steps, dependency_type TEXT DEFAULT 'finish_to_start'`. uq `(workflow_definition_id, from_step_id, to_step_id)`; CHECK `from_step_id <> to_step_id` (chặn self-loop ở DB). RLS+FORCE.
- CREATE `checklists` (template: id, company_id, name, workflow_definition_step_id nullable) + `checklist_items` (id, company_id, checklist_id, label, is_required, sort_order). RLS+FORCE.
- Seed: D7 backfill `video_standard_v0` v1 published + deps tuyến tính.

### 0030 — G7-3: instance đa-target + checklist state
- ALTER `workflow_instances`: `+project_id UUID nullable` FK; `+definition_version INT NOT NULL DEFAULT 1` (pin version bất biến D4 → KHÔNG cần snapshot deps riêng, đọc template deps theo version).
- **CHECK đúng-một (BLOCKING #3 — làm ĐÚNG tên + guard + uq):**
  - `DROP CONSTRAINT wf_instances_target_check` (TÊN THẬT trong schema.ts — KHÔNG viết "DROP CHECK content_item_id IS NOT NULL"; bẫy handoff G6 §4.3: phải dùng tên DB thật như 0025 dùng `content_items_content_type_check`).
  - **TRƯỚC** `ADD CONSTRAINT`: `DO $$ ... IF EXISTS (SELECT 1 FROM workflow_instances WHERE (content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int <> 1) THEN RAISE EXCEPTION ... $$` (guard mẫu handoff §2). Instance G4-3 cũ có `content_item_id` set, `project_id` NULL → `(1)+(0)=1` ✅ thoả; guard chỉ để chặn data bẩn.
  - `ADD CONSTRAINT wf_instances_target_check CHECK ((content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int = 1)` — **byte-identical** với `check()` trong `db/schema/workflow.ts`.
  - **Partial-unique active cho project_id** (lỗ hổng plan cũ bỏ sót): index hiện `wf_instances_content_item_active_uq` chỉ phủ content_item_id → thêm `wf_instances_project_active_uq` ON (project_id) WHERE `status='active' AND project_id IS NOT NULL`. (Hoặc 1 uq biểu thức COALESCE — chọn 2 index riêng cho rõ.)
- ALTER `workflow_steps`: `+node_key TEXT` (map về template step để tra deps theo `definition_version`).
- CREATE `workflow_step_checklist_states`: `id, company_id, workflow_step_id FK, checklist_item_id FK, checked_by, checked_at`. uq `(workflow_step_id, checklist_item_id)`. **RLS+FORCE** + policy tenant_isolation + **THÊM vào `rls-registry.ts`** (liệt kê tường minh — tránh "xanh giả" bẫy handoff §2).
- **RED đi kèm 0030:** instance G4-3 cũ (content_item_id set) thoả CHECK mới + start/submit/approve chạy hết vòng qua engine mới (nối với D7 backfill).

### 0031 — G7-4: evaluation hook (con trỏ, không phải engine)
- ALTER `workflow_definition_steps`: `+requires_evaluation BOOL DEFAULT false`, `+evaluation_template_id UUID nullable` (FK mềm — bảng eval thật ở **G8**, để uuid trần + defer như pattern content_types/template_id G6-4).
- Không tạo engine eval ở G7 — chỉ emit event `step.evaluation_required` để G8 tiêu thụ.

### 0032 — permissions seed (G7-1..3 dùng dần)
- Seed permissions: `create:workflow_template`, `update:workflow_template`, `publish:workflow_template`, `read:workflow_template`, `apply:workflow` (tạo instance), `manage:workflow_instance`. KHÔNG seed system role tự động — gán qua grant catalog. `publish`/`apply` cân nhắc sensitive=false (không re-auth) nhưng gate chặt.

---

## 4. Micro-steps theo THỨ TỰ (không đảo)

### G7-1 🤖🟢 (M) — Template + Step config + Dependencies (DRAFT only)
- **1a** migration `0029` (§3) → migrate → tenant-isolation regression → rls-registry (+3 bảng) → commit.
- **1b** Drizzle schema (`workflow.ts` mở rộng: version/status, deps, checklists) + contracts (`packages/contracts/src/workflow.ts`: templateSchema, stepSchema+node_key, dependencySchema, checklistSchema; Zod = nguồn sự thật).
- **1c** BE: `WorkflowTemplatesController/Service/Repository` (TÁCH khỏi `workflow.service.ts` hiện có theo §3.3 handoff G6) — CRUD template (draft) + step config + dependency add/remove + checklist CRUD. Gate `create/update:workflow_template`. Audit-in-tx (objectType `workflow_template`). **Chỉ DRAFT sửa được** (published khoá).
- **1d** FE: `/workflows/templates` list + `/workflows/templates/$id` step-config form (CHƯA canvas — form thêm/xoá bước + chọn dep dropdown). `<PermissionGate>` create/update.
- **Gate**: 1a (migration ALTER + RLS 3 bảng mới + backfill `node_key NOT NULL` cho steps G4-3 cũ) → **per-migration gate `ecc:database-reviewer`** (KHÔNG thuần LIGHT — chạm schema/backfill); 1d FE form = LIGHT (typescript-reviewer + quality-gate). ⚠️ dependency CRUD chạm DAG → validate ở G7-2.

### G7-2 🛠️🔋 (L) — DAG validate (RED-first) + publish/clone + Canvas
> Tách "validate" (🛠️ Opus, RED trước) khỏi "vẽ" (🤖). **Đây là lõi crown-jewel của G7.**
- **2a** 🛠️ **`DagValidatorService`** (pure, no DB) — **viết RED suite TRƯỚC** (§5). Validate: (1) không chu trình (cycle detection — DFS/Kahn topo-sort), (2) mọi step reachable từ root, (3) dep chỉ trỏ step CÙNG template, (4) không self-dep, (5) ≥1 root (step không có dep vào), (6) không dep tới step đã xoá. Trả `{valid, errors[]}`.
- **2b** 🛠️ **publish/clone lifecycle**: `publishTemplate` (chạy DagValidator → nếu pass: status=published, published_at, KHÓA sửa) ; `cloneTemplate` (published→draft version+1, copy steps+deps+checklists, node_key giữ nguyên). Gate `publish:workflow_template`. Deny: publish template có DAG sai; sửa published in-place. Audit `WorkflowPublished`/`WorkflowCloned`.
- **2c** 🤖 **React Flow canvas** (`@xyflow/react` — đã trong stack CLAUDE §4): node = step, edge = dependency; kéo-thả tạo edge → gọi dependency API; lưu `position_x/y`; nút "Validate" (gọi 2a) + "Publish" (2b) + "Nhân bản". Hiển thị lỗi DAG inline.
- **2d** 🤖 a11y (ecc:a11y-architect): canvas có fallback bàn phím/danh sách; draft/published badge; KHÔNG cho kéo edge ở published.
- **Gate**: **FULL** (logic DAG = crown-jewel) — security + database + silent-failure + **santa-method** cho 2a/2b.

### G7-3 🛠️🔋 (L) — Instance + step instance + auto-task idempotent (DAG)
- **3a** 🛠️ migration `0030` (§3) → regression → rls-registry. 
- **3b** 🛠️ **`applyTemplate(templateId, target)`** (RED-first): chỉ template **published**; snapshot steps (copy node_key/assignee resolve từ role) vào `workflow_steps`; pin `definition_version`; tính **bước root** (không dep) → mở (`not_started`→sẵn sàng) + sinh auto-task; **idempotent** (uq 1 active instance/content đã có; dùng `processed_events`+`dedup_key`). Deny: apply template draft/archived; apply lên target đã có active instance; target không đúng appliesTo.
- **3c** 🛠️ **tổng quát hoá `WorkflowFsmService` + `ApprovalService.approve` (RED-first — sửa spec G4-3 hiện có).** Thực thi **NGAY TRONG `ApprovalService.approve` cùng tx** (xem §1.4 — KHÔNG có consumer tách rời):
  - FSM: bỏ guard `step.stepOrder === instance.currentStepOrder` → guard `allDependenciesApproved(step, deps)` (ảnh hưởng CẢ start/submit của `workflow.service`; RED FS1 + instance G4-3 cũ).
  - `approve()`: thay `advanceInstanceStepOrder`(+1) + `isLastStep = stepOrder >= maxStepOrder` (dòng 144/163) bằng `openNewlyUnblockedSteps(instance, justApprovedStep)` (duyệt step phụ thuộc step vừa approved; mở step `not_started`→sinh auto-task nếu MỌI dep approved — 0..n bước) + `isWorkflowComplete = mọi step required = approved`.
  - **Race-safety join (BLOCKING #2 + B-NEW-1):** trước khi tính join, `SELECT ... FOR UPDATE` trên `workflow_instances` row (serialize per-instance) — chống 2 approver duyệt 2 dep cuối của D đồng thời → lost-update. ⚠️ **ĐIỀU KIỆN BẮT BUỘC để FOR UPDATE thật sự chặn được (đã verify code):** `approve()` hiện gọi `findTaskByStepId` (approval.service.ts:137) và `findMaxStepOrder` (143) **KHÔNG truyền `tx`** → chúng tự mở `withTenant` riêng (workflow.repository.ts:364 = connection KHÁC qua PgBouncer) → nằm NGOÀI khóa. Vậy: **MỌI read của `openNewlyUnblockedSteps` + `isWorkflowComplete` (đọc trạng thái dep-steps) PHẢI nhận `tx`** — refactor các repo-method liên quan sang nhận `tx` (bỏ kiểu tự-mở-`withTenant`); FOR UPDATE đặt TRƯỚC mọi read trạng thái dep, cùng `tx`. Nếu còn 1 read tự-mở-tx → đọc snapshot cũ → race tái xuất dù có FOR UPDATE.
  - **W2 dọn nợ tuyến tính:** xóa/deprecate `findMaxStepOrder` + `advanceInstanceStepOrder` (logic con trỏ `step_order`); `current_step_order` chỉ-advisory (D2), **CẤM dùng làm guard** trong DAG (nguồn lỗi nếu để repo-method cũ sống).
  - **W1 lock 1-row/nguồn:** mỗi nguồn revision = 1 row `workflow_step_instance_locks` (`caused_by_step_id` đơn — đủ, không đổi cột); thêm **partial-uq `(company_id, locked_step_id, caused_by_step_id) WHERE released_at IS NULL`** (chống tích row rác khi replay; làm ở 0031/4a). Release `caused_by=N`; step mở chỉ khi NOT EXISTS lock active khác (LK5).
  - `tasks.dedup_key` chặn task trùng nhưng **che mất** under-open (cả 2 cùng KHÔNG mở D) — RED FS10 phải tách "under-open" khỏi "task đúng-1" (xem §5).
  - Giữ invariant §1.4: chỉ path approve/revision (qua FSM `validateConsumerTransition`) ghi `approved`/`revision`; `workflow.service` chỉ ghi `in_progress`/`waiting_review` (RED FS5).
  - **Resolve assignee khi nhiều người cùng role** (spike §9 #1, plan cũ bỏ sót): khi fork mở nhiều bước, mỗi bước resolve `assignee_role_code`→user. Chốt rule MVP-G7: **để PM gán tay lúc apply** (form chọn assignee per-step) HOẶC fallback người đầu tiên theo role — không round-robin (YAGNI). Ghi vào contract applyTemplate.
- **3d** 🤖 FE: `/workflows/instances/$id` — hiển thị DAG trạng thái (tái dùng canvas read-only, tô màu theo status); wire My Tasks (đã có G4-4) nhận task đa-bước-song-song.
- **Gate**: **FULL** (FSM + auto-task + idempotency).

### G7-4 🛠️🔋 (L) — Lock related parts + Checklist + Evaluation hook
- **4a** 🛠️ migration `0031` (eval hook cols) + **`LockPropagationService`** (RED-first, BR-006/WF-003): revision bước N → tính **transitive descendants** của N trong DAG → INSERT `workflow_step_instance_locks` (locked_step_id ∈ descendants, caused_by_step_id=N); **nhánh độc lập KHÔNG khóa**.
  - **Release đa-nguồn (BLOCKING #4 — sửa logic sai plan cũ):** một bước join D có thể bị khóa bởi NHIỀU nguồn (B revision + C revision đều khóa D). Release khi N re-approved = `released_at=now()` các lock `caused_by=N` — **NHƯNG** bước được coi "mở lại" CHỈ khi `KHÔNG còn lock active nào khác` trên cùng `locked_step_id`. Guard "step startable" = `allDependenciesApproved AND NOT EXISTS(lock active trên step)`. Nếu B re-approved nhưng C còn revision → D **VẪN khóa**. Idempotent replay.
  - Deny: start/submit/approve bước đang bị lock (còn lock active); **ALLOW** thao tác bước nhánh độc lập (test khẳng định chống over-lock).
- **4b** checklist enforcement: `submit` (T2) gated — mọi `checklist_item.is_required` của bước phải `checked` (đọc `workflow_step_checklist_states`). API tick item + audit. FE checklist trong task detail.
- **4c** evaluation hook: bước `requires_evaluation` → khi approved emit `step.evaluation_required` (consumer G8 tiêu thụ sau; G7 chỉ emit + log dead-letter nếu chưa có consumer). Migration `0032` permissions seed.
- **Gate**: **FULL** (lock logic = crown-jewel; santa-method).

---

## 5. Deny-path RED suite (viết TRƯỚC implement — TDD core)

> Mở rộng spike §8. Mỗi case = 1 test RED fail-closed. Bám CLAUDE §6 + GX-2.

**DAG validator (2a):**
- DV1 chu trình A→B→C→A → reject.
- DV2 self-dep A→A → reject (cũng chặn ở CHECK DB).
- DV3 dep trỏ step template khác → reject.
- DV4 step không reachable từ root nào → reject (orphan).
- DV5 dep trỏ step không tồn tại/đã xoá → reject.
- DV6 DAG hợp lệ song song (A→{B,C}→D) → pass.

**Lifecycle (2b):**
- LC1 publish template DAG sai → reject (không đổi status).
- LC2 sửa step/dep của template **published** → reject (immutable D4).
- LC3 clone published → draft version+1 copy đủ steps+deps → pass; sửa bản clone OK.

**FSM/Instance (3b/3c) — tổng quát từ spike §8:**
- FS1 start bước có dep CHƯA approved → reject (thay D3 cũ).
- FS2 song song: A approved → **B và C cùng mở** (assert 2 task sinh). 
- FS3 hợp lưu: B approved nhưng C chưa → D **chưa mở**; cả B,C approved → D mở.
- FS4 approve bước chưa `waiting_review` → reject (X2, ADR-0016).
- FS5 `workflow.service` (start/submit) ghi thẳng `status=approved` → cấm; chỉ path approve/revision qua FSM `validateConsumerTransition` ghi approved/revision (invariant §1.4, KHÔNG phải "consumer" tách rời).
- FS6 replay `step.approved` 2 lần → idempotent (không sinh task trùng, không complete 2 lần).
- FS7 complete CHỈ khi mọi step required approved (không phải bước cuối theo order).
- FS8 apply template draft/archived → reject; apply lên content đã có active → reject.
- FS9 cross-tenant (company A áp/đọc instance B) → RLS 0 row + guard fail.
- FS10 **concurrency join** (BLOCKING #2): 2 dep cuối của D approve gần đồng thời → D mở **đúng-1-lần**, task D **đúng-1** (FOR UPDATE serialize per-instance).
- FS11 **instance G4-3 cũ** (deps tuyến tính seed D7): start/submit/approve chạy hết vòng qua guard `allDependenciesApproved` mới + thoả CHECK đúng-một (nối D7).

**Lock (4a) — BR-006:**
- LK1 revision bước N → hậu duệ N bị lock (start/submit/approve reject).
- LK2 **nhánh độc lập (không phụ thuộc N) VẪN thao tác được** (ALLOW — chống over-lock).
- LK3 N re-approved → release lock hậu duệ (idempotent replay).
- LK4 checklist required chưa tick → submit reject (4b).
- LK5 **đa-nguồn** (BLOCKING #4): D bị khóa bởi cả B và C; B re-approved nhưng C còn revision → D **VẪN khóa** (release chỉ mở khi không còn lock active nào khác).

**Permission-deny (G7-1/2/3 — plan cũ bỏ sót):**
- PD1 user không `publish:workflow_template` → publish reject (deny-by-default ADR-0010).
- PD2 user không `apply:workflow` → applyTemplate reject.
- PD3 user không `create/update:workflow_template` → CRUD template reject. Audit cả deny.

---

## 6. Gates & DoD

- **FULL gate** (G7-2/3/4): `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` + `ecc:santa-method` (logic DAG/FSM/lock). G7-1 = LIGHT.
- **Per-migration gate** (§3): migrate → `tenant-isolation.int-spec.ts` xanh → `rls-guards` completeness xanh → thêm bảng `rls-registry.ts`.
- **Coverage ≥80%**, ngưỡng cao hơn cho `DagValidatorService`/`WorkflowFsmService`/`LockPropagationService`.
- **DoD G7** (TASKS.md): builder tạo bước song song/tuần tự + dependency; áp vào content sinh task idempotent; lỗi chỉ khóa phần liên quan (nhánh độc lập chạy tiếp).
- `harness-audit` cuối G7 (GX-5).

## 7. Rủi ro & traps

| Rủi ro | Vá |
| --- | --- |
| **Journal `when`-trap** (0029+ < G6-2 0027/0028 đã apply) | Đặt `when` 0029 ≈ 1717500040000, tăng dần; verify > max-applied trước migrate. |
| **Instance G4-3 cũ vỡ** khi đổi guard tuần tự→DAG | D7: seed deps tuyến tính cho `video_standard_v0`; test instance cũ chạy hết vòng qua engine mới. |
| **Phá invariant ADR-0016** khi tổng quát fan-out (open nhiều bước) | §1.4: KHÔNG có consumer tách rời — `openNewlyUnblockedSteps` chạy trong `ApprovalService.approve` (single-writer). Giữ invariant THỰC: chỉ path approve/revision (qua FSM) ghi approved/revision; `workflow.service` chỉ ghi in_progress/waiting_review. |
| **Race join** 2 dep cuối approve đồng thời | FOR UPDATE serialize per-instance khi tính join (BLOCKING #2, FS10). |
| **Over-lock** join đa-nguồn release sai | Step mở chỉ khi không còn lock active nào khác (BLOCKING #4, LK5). |
| **Over-lock** (khóa cả nhánh độc lập) | LK2 test khẳng định nhánh độc lập ALLOW. |
| **React Flow bundle/license** | `@xyflow/react` MIT — OK; lazy-load route canvas. |
| **Race 2 approver song song** trên 2 nhánh | uq `approval_reqs_step_pending_uq` per-step + idempotent consumer; test concurrency. |
| **Cycle ẩn qua nhiều version** | DagValidator chạy lúc publish, không lúc thêm từng edge (draft cho phép tạm sai). |

## 8. Thứ tự khởi công (sau khi G6-2 merge)

```
0a tạo branch feat/g7-workflow từ master (sau merge G6-2)
→ G7-1 (1a→1d, LIGHT)
→ G7-2 (2a RED→GREEN → 2b → 2c → 2d, FULL)
→ G7-3 (3a→3b→3c→3d, FULL)
→ G7-4 (4a→4b→4c, FULL)
→ harness-audit + security-scan → PR
```

> Bám **viên/ngày** (1 micro-step/lần). Sau mỗi 🛠️ chạy GX-1 review gate ngay. Cập nhật handoff `docs/plans/G7-progress-handoff.md` mỗi bước (tạo khi bắt đầu 1a).

---

_Liên quan: [`workflow-state-machine.md`](../spikes/workflow-state-machine.md) · [`erd-v2.md`](../erd-v2.md) · [`G6-media-full.md`](./G6-media-full.md) (mẫu plan) · ADR 0009/0010/0016 · [`TASKS.md`](../../TASKS.md) G7._
