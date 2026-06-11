# G7 — Workflow Builder đầy đủ — KẾ HOẠCH CHI TIẾT

> **MOAT lớn nhất** của MediaOS. Biến workflow **cứng MVP-0** (G4-3) → **builder cấu hình động** (DAG: song song + tuần tự + phụ thuộc).
> Chế độ: 🛠️ TDD 🔋 · Cỡ: XL · **FULL gate** + deny-path RED trước + Opus cho phần FSM/DAG.
> Nguồn sự thật: [`workflow-state-machine.md`](../spikes/workflow-state-machine.md) (spike) · [`erd-v2.md`](../erd-v2.md) §5/§8/§9.1 · ADR 0009 (outbox) / 0010 (permission) / 0016 (approval single-source) · [`CLAUDE.md`](../../CLAUDE.md) §2 (3 bất biến).
> Lập: 2026-06-08 · **Cập nhật 2026-06-09** (đối chiếu code thực tế: line-ref §1.4/§3c khớp 100%; renumber migration + sửa branch base). Branch dự kiến: `feat/g7-workflow`.

> **⚠️ ĐÍNH CHÍNH 2026-06-09 (đọc TRƯỚC §3/§8):**
> 1. **Migration dời 0029→0032 …→0035.** `0029/0030/0031` ĐÃ BỊ CHIẾM (0029_g6_reset_token_trigger_warning · 0030_g5fix_org_team_permissions_seed · 0031_g3fix_grant_object_permission_seed). G7 bắt đầu **0032**.
> 2. **Branch base = tip `feat/g6-media` (`7ae9fde`), KHÔNG phải `master`.** `master` (`f4d4bb5`) THIẾU 4 commit cuối: `4b23ccd` (G5-FIX 0030) · `149041a` (**G4-3 assign + by-content + FE board — G7 DỰA TRỰC TIẾP**) · `893da50` (G4 coverage) · `7ae9fde` (G3-fix 0031). Branch từ master = mất G4-3 + migration 0030/0031.
> 3. **Anchor `when`:** max đã apply = `1717500035000` (`0031_g3fix`, idx 32). 0032 đặt `when` > 1717500035000 (≈ 1717500040000), tăng dần.

---

## 0. Điều kiện tiên quyết & cảnh báo thứ tự (ĐỌC TRƯỚC)

1. **G7 phụ thuộc G6-2 hoàn tất.** ✅ **ĐÃ THOẢ (2026-06-09):** G6 đóng, G6-2 merged `origin/master f4d4bb5`, completion-evaluator PASS. ⚠️ NHƯNG `master` mới chỉ tới merge-base `bf4362c`; 4 commit cuối (G5-FIX/G4-3/G3-fix, migration 0030/0031) còn nằm TRÊN `feat/g6-media` chưa merge master → **branch G7 từ tip `feat/g6-media`** (xem đính chính #2). Nguyên tắc solo #1 (tuần tự, không song song): KHỞI CÔNG G7 chỉ khi nhánh hiện tại đóng gọn — tránh migration/journal đè nhau giữa 2 phase chưa đóng.
2. **Permission engine + audit/outbox đã xong (G2/G3)** → đủ điều kiện luật phụ thuộc cho module nhạy cảm. G7 không nhạy cảm như secret nhưng chạm permission (ai được tạo/áp workflow) → vẫn FULL gate ở phần logic.
3. **Migration G7 bắt đầu `0032`** (đã có 0029_g6_reset_token_trigger_warning · 0030_g5fix · 0031_g3fix). ⚠️ **TRAP journal `when`** (xem §3 và handoff G6 §4.2): `when` của 0032+ phải **LỚN HƠN** max `when` đã apply = **`1717500035000`** (idx 32, tag `0031_g3fix_grant_object_permission_seed`). Đặt 0032 ≈ `1717500040000`, tăng dần (+1000/migration). Verify `> max-applied` bằng cách đọc `migrations/meta/_journal.json` TRƯỚC khi generate.

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

## 3. Migration plan (0032 → 0035)

> Mỗi migration: `--> statement-breakpoint` giữa MỌI statement · RLS+FORCE+policy `tenant_isolation` cho bảng mới · CHECK byte-identical với `db/schema/*.ts` · thêm journal entry (`when` tăng, > max-applied) · thêm bảng vào `test/integration/rls-registry.ts` · migrate + chạy `tenant-isolation.int-spec.ts` regression TRƯỚC khi commit.

### 0032 — G7-1: template config + DAG + checklist (template)
- ALTER `workflow_definitions`: `+version INT NOT NULL DEFAULT 1`, `+status TEXT NOT NULL DEFAULT 'draft'` CHECK in(draft,published,archived), `+published_at TIMESTAMPTZ`, `+created_by UUID`. Đổi uq `(company,code)` → `(company,code,version)` partial WHERE deleted_at IS NULL.
- ALTER `workflow_definition_steps`: `+node_key TEXT NOT NULL` (ổn định, dùng cho deps+canvas), `+step_type TEXT DEFAULT 'task'`, `+position_x INT`, `+position_y INT`, `+default_checklist_id UUID`. uq `(workflow_definition_id, node_key)`.
- CREATE `workflow_step_dependencies`: `id, company_id, workflow_definition_id, from_step_id FK→def_steps, to_step_id FK→def_steps, dependency_type TEXT DEFAULT 'finish_to_start'`. uq `(workflow_definition_id, from_step_id, to_step_id)`; CHECK `from_step_id <> to_step_id` (chặn self-loop ở DB). RLS+FORCE.
- CREATE `checklists` (template: id, company_id, name, workflow_definition_step_id nullable) + `checklist_items` (id, company_id, checklist_id, label, is_required, sort_order). RLS+FORCE.
- Seed: D7 backfill `video_standard_v0` v1 published + deps tuyến tính.

### 0033 — G7-3: instance đa-target + checklist state
- ALTER `workflow_instances`: `+project_id UUID nullable` FK; `+definition_version INT NOT NULL DEFAULT 1` (pin version bất biến D4 → KHÔNG cần snapshot deps riêng, đọc template deps theo version).
- **CHECK đúng-một (BLOCKING #3 — làm ĐÚNG tên + guard + uq):**
  - `DROP CONSTRAINT wf_instances_target_check` (TÊN THẬT trong schema.ts — KHÔNG viết "DROP CHECK content_item_id IS NOT NULL"; bẫy handoff G6 §4.3: phải dùng tên DB thật như 0025 dùng `content_items_content_type_check`).
  - **TRƯỚC** `ADD CONSTRAINT`: `DO $$ ... IF EXISTS (SELECT 1 FROM workflow_instances WHERE (content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int <> 1) THEN RAISE EXCEPTION ... $$` (guard mẫu handoff §2). Instance G4-3 cũ có `content_item_id` set, `project_id` NULL → `(1)+(0)=1` ✅ thoả; guard chỉ để chặn data bẩn.
  - `ADD CONSTRAINT wf_instances_target_check CHECK ((content_item_id IS NOT NULL)::int + (project_id IS NOT NULL)::int = 1)` — **byte-identical** với `check()` trong `db/schema/workflow.ts`.
  - **Partial-unique active cho project_id** (lỗ hổng plan cũ bỏ sót): index hiện `wf_instances_content_item_active_uq` chỉ phủ content_item_id → thêm `wf_instances_project_active_uq` ON (project_id) WHERE `status='active' AND project_id IS NOT NULL`. (Hoặc 1 uq biểu thức COALESCE — chọn 2 index riêng cho rõ.)
- ALTER `workflow_steps`: `+node_key TEXT` (map về template step để tra deps theo `definition_version`).
- CREATE `workflow_step_checklist_states`: `id, company_id, workflow_step_id FK, checklist_item_id FK, checked_by, checked_at`. uq `(workflow_step_id, checklist_item_id)`. **RLS+FORCE** + policy tenant_isolation + **THÊM vào `rls-registry.ts`** (liệt kê tường minh — tránh "xanh giả" bẫy handoff §2).
- **RED đi kèm 0033:** instance G4-3 cũ (content_item_id set) thoả CHECK mới + start/submit/approve chạy hết vòng qua engine mới (nối với D7 backfill).

### 0034 — G7-4: evaluation hook (con trỏ, không phải engine)
- ALTER `workflow_definition_steps`: `+requires_evaluation BOOL DEFAULT false`, `+evaluation_template_id UUID nullable` (FK mềm — bảng eval thật ở **G8**, để uuid trần + defer như pattern content_types/template_id G6-4).
- Không tạo engine eval ở G7 — chỉ emit event `step.evaluation_required` để G8 tiêu thụ.

### 0035 — permissions seed (G7-1..3 dùng dần)
- Seed permissions: `create:workflow_template`, `update:workflow_template`, `publish:workflow_template`, `read:workflow_template`, `apply:workflow` (tạo instance), `manage:workflow_instance`. KHÔNG seed system role tự động — gán qua grant catalog. `publish`/`apply` cân nhắc sensitive=false (không re-auth) nhưng gate chặt.
- ⚠️ **Nợ G3-4 mutation-path (TASKS.md dòng 150/163 "NỢ G5/G7"):** chưa nơi nào _emit_ `permission.changed` khi grant/revoke quyền → cache permission KHÔNG invalidate <100ms. Khi gán quyền `*:workflow_template` qua grant catalog, PHẢI emit `permission.changed` (hạ tầng `PermissionCacheInvalidator` đã sẵn ở G3-4, chỉ chờ nối). Nếu chưa làm endpoint grant ở G7 → ghi rõ vào residual để G9 không tưởng đã xong.

---

## 4. Micro-steps theo THỨ TỰ (không đảo)

### G7-1 🤖🟢 (M) — Template + Step config + Dependencies (DRAFT only)
- **1a** migration `0032` (§3) → migrate → tenant-isolation regression → rls-registry (+3 bảng) → commit.
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
- **3a** 🛠️ migration `0033` (§3) → regression → rls-registry.
- **3b** 🛠️ **`applyTemplate(templateId, target)`** (RED-first): chỉ template **published**; snapshot steps (copy node_key/assignee resolve từ role) vào `workflow_steps`; pin `definition_version`; tính **bước root** (không dep) → mở (`not_started`→sẵn sàng) + sinh auto-task; **idempotent** (uq 1 active instance/content đã có; dùng `processed_events`+`dedup_key`). Deny: apply template draft/archived; apply lên target đã có active instance; target không đúng appliesTo.
- **3c** 🛠️ **tổng quát hoá `WorkflowFsmService` + `ApprovalService.approve` (RED-first — sửa spec G4-3 hiện có).** Thực thi **NGAY TRONG `ApprovalService.approve` cùng tx** (xem §1.4 — KHÔNG có consumer tách rời):
  - FSM: bỏ guard `step.stepOrder === instance.currentStepOrder` → guard `allDependenciesApproved(step, deps)` (ảnh hưởng CẢ start/submit của `workflow.service`; RED FS1 + instance G4-3 cũ).
  - `approve()`: thay `advanceInstanceStepOrder`(+1) + `isLastStep = stepOrder >= maxStepOrder` (dòng 144/163) bằng `openNewlyUnblockedSteps(instance, justApprovedStep)` (duyệt step phụ thuộc step vừa approved; mở step `not_started`→sinh auto-task nếu MỌI dep approved — 0..n bước) + `isWorkflowComplete = mọi step required = approved`.
  - **Race-safety join (BLOCKING #2 + B-NEW-1):** trước khi tính join, `SELECT ... FOR UPDATE` trên `workflow_instances` row (serialize per-instance) — chống 2 approver duyệt 2 dep cuối của D đồng thời → lost-update. ⚠️ **ĐIỀU KIỆN BẮT BUỘC để FOR UPDATE thật sự chặn được (đã verify code):** `approve()` hiện gọi `findTaskByStepId` (approval.service.ts:137) và `findMaxStepOrder` (143) **KHÔNG truyền `tx`** → chúng tự mở `withTenant` riêng (workflow.repository.ts:364 = connection KHÁC qua PgBouncer) → nằm NGOÀI khóa. Vậy: **MỌI read của `openNewlyUnblockedSteps` + `isWorkflowComplete` (đọc trạng thái dep-steps) PHẢI nhận `tx`** — refactor các repo-method liên quan sang nhận `tx` (bỏ kiểu tự-mở-`withTenant`); FOR UPDATE đặt TRƯỚC mọi read trạng thái dep, cùng `tx`. Nếu còn 1 read tự-mở-tx → đọc snapshot cũ → race tái xuất dù có FOR UPDATE.
  - **W2 dọn nợ tuyến tính:** xóa/deprecate `findMaxStepOrder` + `advanceInstanceStepOrder` (logic con trỏ `step_order`); `current_step_order` chỉ-advisory (D2), **CẤM dùng làm guard** trong DAG (nguồn lỗi nếu để repo-method cũ sống).
  - **W1 lock 1-row/nguồn:** mỗi nguồn revision = 1 row `workflow_step_instance_locks` (`caused_by_step_id` đơn — đủ, không đổi cột); thêm **partial-uq `(company_id, locked_step_id, caused_by_step_id) WHERE released_at IS NULL`** (chống tích row rác khi replay; làm ở 0034/4a). Release `caused_by=N`; step mở chỉ khi NOT EXISTS lock active khác (LK5).
  - `tasks.dedup_key` chặn task trùng nhưng **che mất** under-open (cả 2 cùng KHÔNG mở D) — RED FS10 phải tách "under-open" khỏi "task đúng-1" (xem §5).
  - Giữ invariant §1.4: chỉ path approve/revision (qua FSM `validateConsumerTransition`) ghi `approved`/`revision`; `workflow.service` chỉ ghi `in_progress`/`waiting_review` (RED FS5).
  - **Resolve assignee khi nhiều người cùng role** (spike §9 #1, plan cũ bỏ sót): khi fork mở nhiều bước, mỗi bước resolve `assignee_role_code`→user. Chốt rule MVP-G7: **để PM gán tay lúc apply** (form chọn assignee per-step) HOẶC fallback người đầu tiên theo role — không round-robin (YAGNI). Ghi vào contract applyTemplate.
- **3d** 🤖 FE: `/workflows/instances/$id` — hiển thị DAG trạng thái (tái dùng canvas read-only, tô màu theo status); wire My Tasks (đã có G4-4) nhận task đa-bước-song-song.
- **Gate**: **FULL** (FSM + auto-task + idempotency).

### G7-4 🛠️🔋 (L) — Lock related parts + Checklist + Evaluation hook
- **4a** 🛠️ migration `0034` (eval hook cols) + **`LockPropagationService`** (RED-first, BR-006/WF-003): revision bước N → tính **transitive descendants** của N trong DAG → INSERT `workflow_step_instance_locks` (locked_step_id ∈ descendants, caused_by_step_id=N); **nhánh độc lập KHÔNG khóa**.
  - **Release đa-nguồn (BLOCKING #4 — sửa logic sai plan cũ):** một bước join D có thể bị khóa bởi NHIỀU nguồn (B revision + C revision đều khóa D). Release khi N re-approved = `released_at=now()` các lock `caused_by=N` — **NHƯNG** bước được coi "mở lại" CHỈ khi `KHÔNG còn lock active nào khác` trên cùng `locked_step_id`. Guard "step startable" = `allDependenciesApproved AND NOT EXISTS(lock active trên step)`. Nếu B re-approved nhưng C còn revision → D **VẪN khóa**. Idempotent replay.
  - Deny: start/submit/approve bước đang bị lock (còn lock active); **ALLOW** thao tác bước nhánh độc lập (test khẳng định chống over-lock).
- **4b** checklist enforcement: `submit` (T2) gated — mọi `checklist_item.is_required` của bước phải `checked` (đọc `workflow_step_checklist_states`). API tick item + audit. FE checklist trong task detail.
- **4c** evaluation hook: bước `requires_evaluation` → khi approved emit `step.evaluation_required` (consumer G8 tiêu thụ sau; G7 chỉ emit + log dead-letter nếu chưa có consumer). Migration `0035` permissions seed.
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
| **Journal `when`-trap** (0032+ phải > max-applied `1717500035000` = 0031_g3fix) | Đặt `when` 0032 ≈ 1717500040000, tăng dần; đọc `meta/_journal.json` verify > max-applied TRƯỚC khi generate. |
| **Migration number collision** (0029/0030/0031 đã bị chiếm) | G7 bắt đầu 0032 (KHÔNG 0029); xem đính chính đầu file. |
| **Branch base sai** (master thiếu G4-3 + 0030/0031) | Branch G7 từ tip `feat/g6-media` (`7ae9fde`), KHÔNG từ master. |
| **Instance G4-3 cũ vỡ** khi đổi guard tuần tự→DAG | D7: seed deps tuyến tính cho `video_standard_v0`; test instance cũ chạy hết vòng qua engine mới. |
| **Phá invariant ADR-0016** khi tổng quát fan-out (open nhiều bước) | §1.4: KHÔNG có consumer tách rời — `openNewlyUnblockedSteps` chạy trong `ApprovalService.approve` (single-writer). Giữ invariant THỰC: chỉ path approve/revision (qua FSM) ghi approved/revision; `workflow.service` chỉ ghi in_progress/waiting_review. |
| **Race join** 2 dep cuối approve đồng thời | FOR UPDATE serialize per-instance khi tính join (BLOCKING #2, FS10). |
| **Over-lock** join đa-nguồn release sai | Step mở chỉ khi không còn lock active nào khác (BLOCKING #4, LK5). |
| **Over-lock** (khóa cả nhánh độc lập) | LK2 test khẳng định nhánh độc lập ALLOW. |
| **React Flow bundle/license** | `@xyflow/react` MIT — OK; lazy-load route canvas. |
| **Race 2 approver song song** trên 2 nhánh | uq `approval_reqs_step_pending_uq` per-step + idempotent consumer; test concurrency. |
| **Cycle ẩn qua nhiều version** | DagValidator chạy lúc publish, không lúc thêm từng edge (draft cho phép tạm sai). |

## 8. Thứ tự khởi công — 3 LUỒNG SONG SONG (spine + 2 nhánh lá)

> Phân tích phụ thuộc (xem chú thích): G7 có **xương sống tuần tự cứng** (migration 0032→0035 + refactor FSM single-writer đụng cùng file) KHÔNG tách được. Nhưng **2 nhánh lá** tách rời được nếu (a) worktree riêng, (b) đóng băng contract trước khi fork, (c) **chỉ 1 luồng sở hữu migration**.

```text
                         ┌── FREEZE CONTRACTS (sau 1b) ──┐  ← mốc đồng bộ DUY NHẤT
LUỒNG A (spine · main dir feat/g7-workflow · Opus · hand-driven):
  1a(0032) → 1b ════╪══════════════╪═══▶ 1c → 2b → 3a(0033) → 3b → 3c(FSM) → 4a(0034) → 4b → 4c(0035) → gates → PR
                    │              │            ▲ tích hợp B trước 2b           ▲ merge C dần ở 3d/cuối
LUỒNG B (worktree c:/dev 2/mediaos-g7-B-dag · feat/g7-dag):
                    └─▶ 2a DagValidatorService (pure, no DB, RED DV1–6) ──────┘  → A cherry-pick/merge vào trước 2b
LUỒNG C (worktree c:/dev 2/mediaos-g7-C-fe · feat/g7-fe):
                                   └─▶ 1d form → 2c canvas → 2d a11y → 3d instance view (bám contract, mock API) ─▶ A merge
```

**Nhánh đã tạo sẵn (worktree riêng — KHÔNG dùng chung working tree, tránh shared-index hazard):**

```text
feat/g7-workflow   → LUỒNG A   (checkout trong main dir c:/dev 2/MediaOS — nơi có .env/docker/migrate)
feat/g7-dag        → LUỒNG B   worktree: c:/dev 2/mediaos-g7-B-dag
feat/g7-fe         → LUỒNG C   worktree: c:/dev 2/mediaos-g7-C-fe
# mỗi worktree: chạy `pnpm install` riêng (pnpm store hardlink, nhẹ) trước khi code.
```

**Bất biến SONG SONG (vi phạm = vỡ journal/merge-hell):**

1. **CHỈ luồng A chạm `apps/api/migrations/` + `_journal.json`.** B/C **cấm** tạo migration. Đây là điểm nghẽn #1.
2. **Đóng băng `packages/contracts/src/workflow.ts` ở 1b** rồi A commit + push. B/C **chỉ bắt đầu impl thật sau khi `git merge feat/g7-workflow`** lấy contract đó. Đổi contract sau freeze = ép rebase cả 2 → hạn chế tối đa.
3. **Commit theo PATH tường minh; KHÔNG `git add -A`** (main dir còn doc G6 dở của session trước).
4. **Hội tụ:** A merge `feat/g7-dag` (1 file service + spec, gần như 0 conflict) **TRƯỚC bước 2b**; A merge `feat/g7-fe` dần ở 3d/cuối (file FE/route mới, conflict tối thiểu).
5. Mỗi 🛠️ của A → chạy GX-1 review gate ngay; per-migration gate (migrate → tenant-isolation regression → +rls-registry) trước commit. Cập nhật `docs/plans/G7-progress-handoff.md` mỗi bước (A tạo khi bắt đầu 1a).

> ⚠️ Track A trước khi `git checkout feat/g7-workflow` ở main dir: xử lý 3 doc G6 đang dở (`TASKS.md`, `G6-media-full.md`, `G6-progress-handoff.md`) — commit vào `feat/g6-media` hoặc stash, KHÔNG để cuốn vào commit G7.

---

## 9. Prompt khởi động từng luồng (copy-paste)

### LUỒNG A — Spine (BE/DB/FSM · Opus · hand-driven)

```text
Tôi chạy LUỒNG A (spine) của G7 Workflow Builder, branch feat/g7-workflow trong main dir c:/dev 2/MediaOS.
Model Opus. HAND-DRIVEN: trước MỖI micro-step, ĐỌC liên quan + trình kế hoạch cho tôi DUYỆT rồi mới code. Chậm mà chắc, 1 viên/lần.

ĐỌC TRƯỚC: docs/plans/G7-workflow-builder.md (toàn bộ, nhất là §1.4/§2/§3/§5/§8) · CLAUDE.md §2 (3 bất biến)/§3/§5/§6 · docs/spikes/workflow-state-machine.md · apps/api/src/workflow/{approval.service.ts,workflow-fsm.service.ts,workflow.repository.ts}.

PHẠM VI LUỒNG A (theo §4, KHÔNG đảo): 1a→1b→1c → (chờ B xong 2a, merge vào) 2b → 3a→3b→3c→ (3d do C) → 4a→4b→4c → gates → PR.
TÔI LÀ LUỒNG DUY NHẤT ĐƯỢC TẠO MIGRATION (0032→0035). Journal `when` > 1717500035000 (đọc meta/_journal.json verify trước generate), +1000/migration.

QUY TẮC CODE (bắt buộc):
- CLAUDE §2: mọi query nghiệp vụ qua withTenant(companyId); RLS+FORCE+policy tenant_isolation cho MỌI bảng mới; không hard-delete (soft delete/append-only); không secret plaintext.
- Per-migration gate: migrate (đặt env TAY, KHÔNG `. ./.env` vì path có space) → test/integration/tenant-isolation.int-spec.ts xanh → rls-guards xanh → thêm bảng vào test/integration/rls-registry.ts → rồi mới commit.
- TDD RED-first cho deny-path (§5): viết test ĐỎ đúng lý do TRƯỚC khi impl. Coverage ≥80% (cao hơn cho FSM).
- Invariant §1.4 (đã verify code): KHÔNG dựng consumer tách rời — openNewlyUnblockedSteps + isWorkflowComplete chạy NGAY trong ApprovalService.approve cùng tx. Chỉ path approve/revision (qua FSM validateConsumerTransition) ghi approved/revision; workflow.service chỉ ghi in_progress/waiting_review.
- Race-safety §3c (BLOCKING #2): SELECT...FOR UPDATE trên workflow_instances TRƯỚC mọi read trạng thái dep; refactor findTaskByStepId/findMaxStepOrder + mọi repo-method đọc dep sang NHẬN tx (bỏ tự-mở-withTenant) — nếu còn 1 read tự-mở-tx → race tái xuất.
- Service chứa business logic (không ở Controller); Repository lo DB; DTO/contract Zod validate; API nhạy cảm check permission; file 200–400 dòng (max 800); immutable (không mutate, trả copy mới); không console.log; không any.
- Gate: FULL (security+database+silent-failure + santa-method) cho 2b/3/4; LIGHT cho 1d (C lo). 1c = audit-in-tx objectType workflow_template.
- MỐC ĐỒNG BỘ: sau 1b, ĐÓNG BĂNG packages/contracts/src/workflow.ts → commit "chore(g7-1b): freeze contracts" → push → báo tôi để LUỒNG B/C merge. Sau đó hạn chế đổi contract.
- Commit theo PATH tường minh, KHÔNG git add -A. KHÔNG đụng app.module.ts nếu parallel-session giữ.

Bắt đầu: ĐỌC §3/0032 + schema workflow.ts hiện tại, rồi trình kế hoạch 1a (migration 0032 + RLS 3 bảng mới + backfill node_key) cho tôi duyệt.
```

### LUỒNG B — DagValidatorService (pure logic · isolatable · TDD)

```text
Tôi chạy LUỒNG B của G7, branch feat/g7-dag, worktree c:/dev 2/mediaos-g7-B-dag (worktree RIÊNG — KHÔNG đụng main dir).

SETUP + SYNC GATE (làm trước tiên):
1. cd c:/dev 2/mediaos-g7-B-dag ; pnpm install.
2. CHỜ LUỒNG A báo đã push "chore(g7-1b): freeze contracts" → `git merge feat/g7-workflow` lấy packages/contracts/src/workflow.ts (stepSchema+node_key, dependencySchema).
3. TUYỆT ĐỐI KHÔNG tạo migration, KHÔNG sửa apps/api/migrations/ hay _journal.json, KHÔNG đụng DB. Chỉ luồng A sở hữu schema/migration.

ĐỌC TRƯỚC: docs/plans/G7-workflow-builder.md §2(D2/D5)/§4(2a)/§5(DV1–DV6)/§7 · docs/spikes/workflow-state-machine.md · CLAUDE.md §5/§6.

NHIỆM VỤ — chỉ 2a: DagValidatorService (PURE, no DB, no NestJS DB-DI) tại apps/api/src/workflow/dag-validator.service.ts.
- Input: steps[] (mỗi step có node_key) + deps[] (from_node_key→to_node_key), kiểu LẤY TỪ contract đã freeze. Output: { valid: boolean, errors: {code,message,...}[] }.
- TDD RED-first: viết spec ĐỎ TRƯỚC (dag-validator.service.spec.ts) phủ DV1–DV6:
  DV1 chu trình A→B→C→A → reject; DV2 self-dep A→A → reject; DV3 dep trỏ step template khác → reject;
  DV4 step orphan (không reachable từ root) → reject; DV5 dep trỏ node_key không tồn tại/đã xoá → reject;
  DV6 DAG song song hợp lệ A→{B,C}→D → pass.
- Thuật toán: cycle detection bằng Kahn topo-sort hoặc DFS màu; ≥1 root (node không có dep vào); reachability BFS từ root.

QUY TẮC CODE: hàm thuần + immutable (không mutate input, trả mảng/đối tượng mới); early-return thay nesting sâu; named constants cho error code; types từ contract (không any); file <800 dòng; không console.log; coverage ≥90% (đây là crown-jewel logic). Gate: santa-method tự kiểm tra biên (đồ thị rỗng, 1 node, đa root, nhánh cụt).

GIAO NỘP: service + spec PASS độc lập (pnpm --filter @mediaos/api exec vitest run src/workflow/dag-validator). Báo luồng A để A merge feat/g7-dag vào TRƯỚC bước 2b (publish gọi validator này). KHÔNG tự merge sang A.

Bắt đầu: sau SYNC GATE, viết RED suite DV1–DV6 trước, cho tôi xem nó đỏ đúng lý do, rồi mới GREEN.
```

### LUỒNG C — Frontend (canvas/forms · isolatable · bám contract)

```text
Tôi chạy LUỒNG C của G7, branch feat/g7-fe, worktree c:/dev 2/mediaos-g7-C-fe (worktree RIÊNG).

SETUP + SYNC GATE:
1. cd c:/dev 2/mediaos-g7-C-fe ; pnpm install.
2. CHỜ LUỒNG A push "chore(g7-1b): freeze contracts" → `git merge feat/g7-workflow` lấy contract. Trước khi A ship endpoint, MOCK API (msw/stub) theo contract — KHÔNG chờ BE.
3. KHÔNG tạo migration, KHÔNG sửa apps/api/. Chỉ làm apps/web.

ĐỌC TRƯỚC: docs/plans/G7-workflow-builder.md §2(D6)/§4(1d,2c,2d,3d) · CLAUDE.md §4(stack)/§5(FE rules) · apps/web hiện có (pattern /content, /projects, TanStack Router/Query, shadcn/ui, <PermissionGate>/useCan, My Tasks G4-4).

NHIỆM VỤ (FE, theo thứ tự): 
- 1d /workflows/templates (list) + /workflows/templates/$id (form thêm/xoá bước + chọn dependency dropdown — CHƯA canvas).
- 2c Canvas React Flow (@xyflow/react, MIT, lazy-load route): node=step, edge=dependency; kéo-thả tạo edge→gọi dependency API; lưu position_x/y; nút Validate/Publish/Nhân bản; hiển thị lỗi DAG inline.
- 2d a11y (ecc:a11y-architect): fallback bàn phím/danh sách cho canvas; badge draft/published; CẤM kéo edge khi published.
- 3d /workflows/instances/$id: tái dùng canvas read-only tô màu theo status; wire My Tasks nhận task đa-bước-song-song.

QUY TẮC CODE (CLAUDE §5 FE): KHÔNG hard-code permission → dùng <PermissionGate>/useCan(); dữ liệu nhạy cảm mask (server lo, client không nhận thì không render); form validation React Hook Form + Zod (contract = nguồn DTO); table có pagination/filter (TanStack Table v8 headless); status/text dùng constants chung; shadcn/ui + Tailwind v4; immutable state (Zustand/Query, không mutate); component props có type rõ; không any/console.log; file 200–400 dòng. Gate: LIGHT (ecc:typescript-reviewer + ecc:quality-gate) + a11y cho 2d.

GIAO NỘP: build xanh (pnpm --filter @mediaos/web build) + lint + test. Báo luồng A để merge feat/g7-fe (file/route FE mới → conflict tối thiểu). KHÔNG tự merge sang A.

Bắt đầu: sau SYNC GATE, dựng skeleton route /workflows/templates + template-api client theo contract (mock), trình cho tôi xem layout trước khi nối canvas.
```

---

## 10. Residual / nợ kỹ thuật (cập nhật theo tiến độ)

**Sau 1c-i (Template CRUD core):**
- **Permission seed nợ tới 0036:** endpoint `workflow-templates` gate quyền `workflow-template` (hyphen — đồng bộ `workflow-instance`). Catalog CHƯA seed (dời từ 0035→**0036**, cuối G7-4c) → endpoint **fail-closed 403** cho mọi user tới khi 0036 seed + admin grant qua grant-catalog. FE luồng C dùng mock API nên không kẹt. ⚠️ 0036 PHẢI seed đúng spelling **hyphen** `create/update/read:workflow-template` (KHỚP guard) — nếu seed underscore sẽ lệch → mãi 403.
- **list() chưa phân trang:** template low-cardinality nên chấp nhận; thêm pagination khi cần (contract `templateDetailSchema`/list đã FROZEN — đổi sau 1b cân nhắc kỹ).
- **Hard-delete child rows (1c-ii→iv):** schema frozen KHÔNG có `deleted_at` ở `workflow_definition_steps`/`workflow_step_dependencies`/`checklists`/`checklist_items` → remove = hard-delete, **giới hạn template `draft`** (published immutable + instance snapshot riêng ở `workflow_steps` → không mất audit-data). Chốt lại khi tới 1c-ii.
- **Audit gom aggregate:** mọi thao tác template/step/dep/checklist audit dưới `objectType='workflow_template'`, `objectId=templateId` (1 audit type, thêm ở migration 0033).

**Sau 1c-ii (Template step config):**
- **stepOrder auto (max+1) có race chấp nhận được:** 2 `addStep` đồng thời cùng template → 1 cái 23505 trên `wf_def_steps_def_order_uq` → 409 (client retry). KHÔNG mất data. Template editing low-concurrency (1 PM/template) → chấp nhận; nâng `SELECT…FOR UPDATE` trên template row nếu sau này cần đa editor đồng thời.
- **Hard-delete step (draft-only):** đã chốt — `removeStep` hard DELETE, ép draft qua `loadDraftTemplate`; FK cascade `workflow_step_dependencies`, SET NULL `checklists.workflow_definition_step_id`. Áp cùng pattern cho dep (1c-iii) + checklist (1c-iv).
- **23505 fallback:** mọi unique-violation không khớp constraint cụ thể → 409 chung (chống raw pg-error 500 rò tên bảng/schema).

**Sau 1c-iii (dependency) + 1c-iv (checklist) — ĐÓNG 1c:**
- **DAG/cycle KHÔNG validate ở 1c-iii:** add edge chỉ ép referential integrity (self-loop→400, cross-template→400, dup→409). Cycle/reachability/unreachable check ở **2b publish** (DagValidator từ luồng B). Draft cho phép tạm sai.
- **23503 FK fallback:** race xoá step giữa lúc add dependency → FK violation → 400 (chống raw 500).
- **Checklist gắn-step (1c-iv):** checklist `workflow_definition_step_id` lấy từ URL `:stepId`; item ops scope qua JOIN checklist→step→template; INNER JOIN loại checklist orphaned. **Edit item HOÃN** (chỉ add/remove — như dependency); cần sửa item thì remove+re-add. `step.defaultChecklistId` KHÔNG set ở 1c-iv (không có trong step DTO frozen) → để runtime apply 3b.
- **Repo delete self-defending:** deleteDependency/deleteChecklist/deleteChecklistItem scope đủ (company + parent + id), không dựa find-trước-đó.

---

_Liên quan: [`workflow-state-machine.md`](../spikes/workflow-state-machine.md) · [`erd-v2.md`](../erd-v2.md) · [`G6-media-full.md`](./G6-media-full.md) (mẫu plan) · ADR 0009/0010/0016 · [`TASKS.md`](../../TASKS.md) G7._
