# G7 — Progress Handoff (LUỒNG A spine)

> Trạng thái thực thi G7 Workflow Builder. Cập nhật mỗi viên. Nguồn kế hoạch: [`G7-workflow-builder.md`](./G7-workflow-builder.md) (§4 micro-steps, §5 RED suite, §8 luồng, **§10 residual = chi tiết quyết định từng viên**).

**Branch:** `feat/g7-workflow` (main dir `c:/dev 2/MediaOS`) · 1a…3c + ⑥ gate + **4a `c7fab96`** **đã push (origin đồng bộ)** · **DB dev ở migration 0035**.

---

## ✅ ĐÃ XONG (đừng làm lại)

| Viên | Commit | Tóm tắt |
| --- | --- | --- |
| 1a–1c | `5c0f7a9`…`91fb4f5` | 0032 (template/DAG/checklist) + contracts freeze (1b) + 0033 audit object_type + WorkflowTemplates CRUD (template/step/dep/checklist, draft-only, RLS+audit) |
| 2a (LUỒNG B) | `05ea98a` | `DagValidatorService` (pure, DV1–DV6) — merge vào A |
| merge | `4a012ac` | merge `feat/g7-dag` → A |
| 2a-fix | `7fbf2cd` | NUL-byte trong dag-validator → escape `\u0000` (de-binary) |
| **2b** | `12f7b19` | **publish/clone lifecycle** — DAG gate (422 + dagValidation), clone version+1 copy steps/deps/checklists + node_key giữ; adapter `dag-result.adapter.ts` (service code → contract code) |
| 1a-fix | `8ccec9e` | seed `node_key` (G4-7 e2e xanh) |
| **3a** | `a4f7b5b` | **migration 0034** — instance đa-target (content XOR project) + `definition_version` + `workflow_steps.node_key` + `workflow_step_checklist_states` (RLS+FORCE) |
| **3b** | `2032894` | **applyTemplate** — instance từ template published, snapshot steps, mở **bước root** (auto-task idempotent); endpoint `POST /workflow-templates/:id/apply` gate `apply:workflow-instance` |
| **3c-i** | `0d31be6` | **DAG dep-guard** — `workflow-dag.ts` PURE (`allDependenciesApproved`, key=node_key??step_code, root→true, fail-closed); FSM start/submit guard = `dependenciesApproved===false→DependenciesNotMetError` (bỏ guard stepOrder===currentStepOrder); repo `findStepsByInstanceIdInTx`; service `resolveDependenciesApproved` (await tuần tự) |
| **3c-ii** | `c26eb94` | **approve() fan-out + complete theo DAG** — `computeNewlyUnblockedStepIds` (mở 0..n downstream khi dep đủ → auto-task idempotent) + `isWorkflowComplete` (mọi step required approved, KHÔNG theo order); task read vào tx (`findActiveTaskByStepIdInTx`); giữ alias `isLastStep:isWorkflowComplete` (e2e linear xanh). `findMaxStepOrder`/`advanceInstanceStepOrder` **ngừng dùng** (W2→3c-iii) |
| **3c-iii** | `af8f583` | **FOR UPDATE race-safety + W2 cleanup + FS5/FS10** — `approve()` chèn `lockInstanceForUpdateInTx` (SELECT…FOR UPDATE per-instance) NGAY sau `findInstanceByIdInTx`, TRƯỚC mọi read dep → 2 approver đóng 2 dep cuối của join serialize (BLOCKING #2; **approve-only**, không deadlock). W2: xoá `findMaxStepOrder`+`advanceInstanceStepOrder`+`updateInstanceStepOrder` (+ bỏ `max` import; `current_step_order` chỉ advisory). FS10 = **probe lock xác định** (giữ khoá → approve() block; bỏ Promise.all timing vì phụ-thuộc-thứ-tự-test). FS5 = `validateConsumerTransition` writer DUY NHẤT của approved/revision (cặp D6). ⑤ FS11 skip (e2e linear che). **⑥ gate FULL+santa XONG → fix `62b5374`.** |
| **⑥ gate** | `62b5374` | **FULL+santa gate** trên crown-jewel 3c — security+database+silent-failure (song song) → santa dual-review **NICE**. Vá **F1** (23505→409 ở `approve()`+`requestRevision()`), **F2** (`requestRevision` đọc task in-tx → đóng TOCTOU), **F3** (fan-out no-op `logger.warn`). Chỉ `approval.service.ts`+spec. Verify XANH (fsm 27 · approval 19 · int 5 FS10 3× · e2e 17 · typecheck). |
| **4a** | `0d8535b`+`c7fab96` | **LockPropagationService (BR-006/WF-003 `downstream_blocked_by_revision`).** Migration **0035** (sub-gate riêng): eval-hook cols (`requires_evaluation`, `evaluation_template_id` soft-ref — inert, dùng ở 4c) + partial-uq `wf_step_locks_active_uq (company,locked,caused_by) WHERE released_at IS NULL` (bảng locks đã có từ 0008, RLS sẵn). ⚠️ **drizzle-kit generate KHÔNG dùng được** (repo chỉ giữ `0000_snapshot.json` → generate full-recreate) — **hand-author SQL** + journal `when` thủ công (1717500043000); idx 36 / tag 0035 (idx≠tag-number theo lệ repo). **Lock:** revision N → `computeTransitiveDescendants` (pure BFS, dedup diamond, fail-closed) → INSERT lock hậu duệ (caused_by=N); nhánh độc lập KHÔNG khóa (LK2). Re-approve N → release caused_by=N (soft `released_at`) → fan-out mở chỉ khi NOT EXISTS lock active khác (multi-source LK5, batch `findLockedStepIds` 1-query). FSM `stepLocked` guard (start/submit) → `StepLockedError`→409, trước deps-guard. Wiring: `requestRevision` (insert in-tx), `approve` (release+open-filter), `workflow.service` start/submit, module. **RED→GREEN:** LK1/LK2/LK3/LK5 int + pure-fn 6 + FSM-guard 3 + service unit 7. Verify XANH (typecheck · unit 70 · int lock 4/approve 5/apply 6 · e2e 17). **FULL+santa gate:** security CLEAN · database (N+1→batch) · silent-failure (observability +log) · santa dual-review **NICE/NICE**. |

**Test:** toàn bộ xanh — fsm 27 (+FS5) · approval 19 (A4/A5/A7+branch) · unit dag 9 · int workflow-approve 5 (FS2/FS3/FS7/FS6/**FS10**) · e2e linear 17 · (templates/apply/tenant-isolation/rls-guards… giữ xanh). typecheck sạch.

---

## ✅ 3c-iii + ⑥ gate ĐÃ XONG — crown-jewel 3c KHÉP (đã push)

> 3c-i + 3c-ii + 3c-iii + ⑥ FULL+santa gate **XONG**. Crown-jewel 3c hoàn tất — code + gate + push (`62b5374`).

- **① RED FS10 → ② GREEN lock → ③ W2 cleanup → ④ FS5** — xong, commit `af8f583` (5 file, +149/−51), **local, CHƯA push**.
- **Lock:** `approve()` chèn `lockInstanceForUpdateInTx` (SELECT…FOR UPDATE per-instance) NGAY sau `findInstanceByIdInTx`, TRƯỚC mọi read dep. **approve-only** (start/submit không cần — chỉ ghi step của chính nó; giữ 1 row instance/tx → không deadlock).
- **FS10 (quyết định quan trọng):** `Promise.all` timing tự nhiên **KHÔNG đỏ tin cậy** (phụ thuộc thứ-tự-test/độ-ấm-pool — từng thấy xanh-trong-trạng-thái-lỗi). Đã thay bằng **probe lock xác định**: blocker (`directPool`) giữ `SELECT…FOR UPDATE` trên instance → real `approve()` PHẢI block (chưa-lock=không-block=ĐỎ; có-lock=block→release=XANH). Đúng-tuần-tự open/complete đã có FS3/FS7.
- **W2:** xoá `findMaxStepOrder`+`advanceInstanceStepOrder`+`updateInstanceStepOrder` (cả 3 dead) + bỏ `max` import; `current_step_order` chỉ advisory. Spec dọn mock + 2 assertion legacy.
- **FS5:** đặt ở **FSM unit** — `validateConsumerTransition` là writer DUY NHẤT của approved/revision (cặp với **D6** đã có; D6 chứng minh service path KHÔNG ghi được approved/revision).
- **⑤ FS11: SKIP** — e2e linear 17 đã che vòng start/submit/approve (seed `video_standard_v0` không seed deps → mọi bước root, guard `allDependenciesApproved` mới vẫn xanh).
- **KHÔNG migration** trong 3c. ~~Migration kế = 0035 (4a eval hook)~~ → **0035 XONG** (`0d8535b`, idx 36, `when 1717500043000`, tag `0035_g7_eval_hook_lock_uq`). Migration kế = **0036** (4c permissions seed — PHẢI seed hyphen: `create/update/publish/read:workflow-template` + `apply:workflow-instance`).
- **4a XONG.** Viên kế = **4b** (checklist enforcement, RED **LK4**: `submit` gated khi `checklist_item.is_required` chưa tick — đọc `workflow_step_checklist_states`; API tick + audit; KHÔNG migration) → **4c** (eval hook emit `step.evaluation_required` khi bước `requires_evaluation` approved; migration **0036** permissions seed). Eval cols 0035 đang inert tới 4c.

### ✅ ⑥ FULL+santa gate XONG — fix `62b5374`

- **Scope:** review CẢ 3c-i (`0d31be6`) + 3c-ii (`c26eb94`) + 3c-iii (`af8f583`).
- **Agent:** `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` (song song) → `ecc:santa-method` dual-review **NICE (cả 2 reviewer PASS)**. KHÔNG CRITICAL/HIGH net-new; lock/DAG/FSM/idempotency đúng.
- **Đã vá (`62b5374` — chỉ `approval.service.ts` + spec, theo PATH, attribution OFF):**
  - **F1 (HIGH):** `approve()` + `requestRevision()` map `approval_steps_request_level_uq` **23505 → ConflictException(409)** thay raw 500 khi 2 approver đua cùng request. Toàn vẹn vốn AN TOÀN (uq + atomic rollback — santa chứng minh `createApprovalStep` là write ĐẦU TIÊN nên rollback trọn tx); **mapping-only ĐỦ, KHÔNG cần re-read-under-lock** (YAGNI).
  - **F2 (MED, pre-existing):** `requestRevision()` đọc task qua `findActiveTaskByStepIdInTx(...tx)` thay non-tx `findTaskByStepId` → đóng TOCTOU `nextRevisionRound`.
  - **F3 (LOW):** fan-out `createTask` no-op nay `logger.warn` (parity `applyTemplate`/`startWorkflow`).
- **Verify XANH:** typecheck · fsm 27 · approval 19 · int 5 (FS10 deterministic 3×: 862/855/868ms) · e2e 17.
- **Gate points ĐẠT:** (a) lock TRƯỚC mọi DAG-read ✓; (b) `.for("update")` qua `tx`+`company_id`, RLS còn ép ✓; (c) approve-only KHÔNG tạo race khác (`revision` không bao giờ = `approved`, gating monotonic, X4 chặn approved→revision) ✓; (d) FS10 xanh-xác-định 3× ✓.

### Nợ ghi nhận sau ⑥ gate (KHÔNG chặn — santa nêu)

- **Multi-level approvals (forward-looking):** chốt 23505 dựa trên `level=1`/`maxLevel=1`. Duyệt đa-cấp tương lai → 2 approver KHÁC cấp sẽ KHÔNG bị `approval_steps_request_level_uq` chặn; revisit khi làm. MVP-0 single-level → hiện an toàn.
- **Contract `c26eb94`:** outbox `step.approved` bỏ `nextStepOrder`, thêm `newlyOpenedStepIds` — xác nhận consumer notify đã migrate sang field mới.

## Bất biến vận hành (giữ cả G7)
- HAND-DRIVEN: đọc + trình plan từng viên, duyệt rồi mới code. Commit theo PATH tường minh (KHÔNG `git add -A`). Attribution tắt.
- CLAUDE §2: `withTenant(companyId)` mọi query; bảng mới RLS+FORCE+policy + thêm `rls-registry.ts`; không hard-delete quan trọng; không secret plaintext.
- Per-migration gate (khi có migration): set env TAY → migrate → tenant-isolation + rls-guards xanh → commit. Chạy test: vitest.config đã inject `DATABASE_URL`/`DATABASE_DIRECT_URL`.
- FULL gate (security+database+silent-failure+santa) cho logic crown-jewel (FSM/lock/DAG/permission/audit).

## Nợ kỹ thuật nổi bật (chi tiết §10)
- **0036 PHẢI seed**: `publish:workflow-template` (ngoài create/update/read) + `apply:workflow-instance` (hyphen) — tới đó các endpoint fail-closed 403.
- **tasks thiếu `project_id`**: project-target workflow tạo task không anchor project → cần migration + query (3c/G8). G7 thực tế đi content_item.
- `id` param chưa validate UUID (toàn controller workflow-templates) — defer fix đồng bộ.
- `defaultChecklistId` clone hoãn (luôn NULL trước 3b; remap khi 3b/3c set).
