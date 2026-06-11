# G7 — Progress Handoff (LUỒNG A spine)

> Trạng thái thực thi G7 Workflow Builder. Cập nhật mỗi viên. Nguồn kế hoạch: [`G7-workflow-builder.md`](./G7-workflow-builder.md) (§4 micro-steps, §5 RED suite, §8 luồng, **§10 residual = chi tiết quyết định từng viên**).

**Branch:** `feat/g7-workflow` (main dir `c:/dev 2/MediaOS`) · **đã push hết** lên origin · **DB dev ở migration 0034**.

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

**Test:** toàn bộ xanh — unit dag 9 · approval 19 (A4/A5/A7+branch) · int workflow-approve 4 (FS2/FS3/FS7/FS6) · e2e linear 17 · (templates/apply/tenant-isolation/rls-guards… giữ xanh). typecheck sạch.

---

## ▶️ VIÊN KẾ: 3c-iii — race-safety (FOR UPDATE) + W2 cleanup (crown-jewel, FULL+santa, Opus)

> ĐỌC TRƯỚC: `G7-workflow-builder.md` §1.4 · §3c · §5 (FS5/FS10/FS11) · `apps/api/src/workflow/{approval.service,workflow.service,workflow.repository}.ts` · spike `docs/spikes/workflow-state-machine.md`.
> **3c-i (dep-gate) + 3c-ii (fan-out/complete) ĐÃ XONG** — 3c-iii chỉ còn lock + dọn + 3 RED còn lại.

- **KHÔNG migration** (3c thuần code). Migration kế = **0035** (4a eval hook), rồi **0036** (4c permissions seed — PHẢI seed hyphen: `create/update/publish/read:workflow-template` + `apply:workflow-instance`).
- **Race-safety (BLOCKING #2 / FS10):** thêm `SELECT…FOR UPDATE` per-instance (`workflow_instances`) **TRƯỚC** mọi read dep TRONG `approve()` (và start/submit nếu cần). Repo: thêm `lockInstanceForUpdateInTx(companyId, instanceId, tx)`; gọi ngay sau `findInstanceByIdInTx` trong `approve()`. Mọi read dep của approve đã nằm trong tx sẵn (3c-ii) → chỉ cần chèn lock đầu.
- **W2 cleanup:** xoá `findMaxStepOrder` + `advanceInstanceStepOrder` khỏi repo (đã ngừng dùng ở 3c-ii); `current_step_order` chỉ còn advisory. Grep xác nhận không còn caller trước khi xoá.
- **RED-first còn lại (§5):**
  - **FS10** concurrency join: 2 dep cuối của D approve **gần đồng thời** → D mở **đúng-1 task**, complete **đúng-1 lần** (FOR UPDATE serialize per-instance). ⚠️ `dedup_key` che under-open → test phải tách "under-open" khỏi "task đúng-1" (§5). Khó test: cần 2 tx song song trên 2 connection → dùng `directPool` 2 client hoặc `Promise.all` 2 lời gọi `approve()` riêng connection.
  - **FS5** `workflow.service` (start/submit) KHÔNG được ghi thẳng `status=approved` → chỉ path approve/revision qua FSM `validateConsumerTransition` ghi approved/revision (invariant §1.4). Test khẳng định guard.
  - **FS11** instance G4-3 cũ (deps tuyến tính seed) chạy hết vòng start/submit/approve qua guard `allDependenciesApproved` mới + thoả CHECK đúng-một. (e2e linear 17 hiện đã cover phần lớn — FS11 bổ sung nếu §5 yêu cầu ngưỡng riêng.)
- **CUỐI 3c-iii → gate FULL+santa 1 lần** cho cả crown-jewel (3c-i+ii+iii): `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` + `ecc:santa-method`. (Đã hoãn suốt 3c theo cost discipline.)

### Ghi chú review treo cho 3c-iii

- **Review C1 (race trên join)** chỉ áp dụng cho 3c-iii (FOR UPDATE) — KHÔNG phải defect của 3c-ii.
- ⚠️ BẪY pg single-connection: đọc dep TUẦN TỰ (await), KHÔNG `Promise.all` trên CÙNG 1 tx (FS10 test cần 2 connection RIÊNG, không phải 2 query 1 tx).

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
