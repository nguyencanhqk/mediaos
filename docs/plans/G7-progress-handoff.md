# G7 — Progress Handoff (LUỒNG A spine)

> Trạng thái thực thi G7 Workflow Builder. Cập nhật mỗi viên. Nguồn kế hoạch: [`G7-workflow-builder.md`](./G7-workflow-builder.md) (§4 micro-steps, §5 RED suite, §8 luồng, **§10 residual = chi tiết quyết định từng viên**).

**Branch:** `feat/g7-workflow` (main dir `c:/dev 2/MediaOS`) · 1a…3c-ii đã push · **3c-iii `af8f583` CHƯA push** · **DB dev ở migration 0034**.

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
| **3c-iii** | `af8f583` | **FOR UPDATE race-safety + W2 cleanup + FS5/FS10** — `approve()` chèn `lockInstanceForUpdateInTx` (SELECT…FOR UPDATE per-instance) NGAY sau `findInstanceByIdInTx`, TRƯỚC mọi read dep → 2 approver đóng 2 dep cuối của join serialize (BLOCKING #2; **approve-only**, không deadlock). W2: xoá `findMaxStepOrder`+`advanceInstanceStepOrder`+`updateInstanceStepOrder` (+ bỏ `max` import; `current_step_order` chỉ advisory). FS10 = **probe lock xác định** (giữ khoá → approve() block; bỏ Promise.all timing vì phụ-thuộc-thứ-tự-test). FS5 = `validateConsumerTransition` writer DUY NHẤT của approved/revision (cặp D6). ⑤ FS11 skip (e2e linear che). **Còn ⑥ gate FULL+santa.** |

**Test:** toàn bộ xanh — fsm 27 (+FS5) · approval 19 (A4/A5/A7+branch) · unit dag 9 · int workflow-approve 5 (FS2/FS3/FS7/FS6/**FS10**) · e2e linear 17 · (templates/apply/tenant-isolation/rls-guards… giữ xanh). typecheck sạch.

---

## ✅ 3c-iii ĐÃ XONG (commit `af8f583`) — chỉ còn ⑥ gate + push

> 3c-i + 3c-ii + 3c-iii **code/test XONG**. Crown-jewel 3c hoàn tất phần code; CHỈ còn lớp review gate + push.

- **① RED FS10 → ② GREEN lock → ③ W2 cleanup → ④ FS5** — xong, commit `af8f583` (5 file, +149/−51), **local, CHƯA push**.
- **Lock:** `approve()` chèn `lockInstanceForUpdateInTx` (SELECT…FOR UPDATE per-instance) NGAY sau `findInstanceByIdInTx`, TRƯỚC mọi read dep. **approve-only** (start/submit không cần — chỉ ghi step của chính nó; giữ 1 row instance/tx → không deadlock).
- **FS10 (quyết định quan trọng):** `Promise.all` timing tự nhiên **KHÔNG đỏ tin cậy** (phụ thuộc thứ-tự-test/độ-ấm-pool — từng thấy xanh-trong-trạng-thái-lỗi). Đã thay bằng **probe lock xác định**: blocker (`directPool`) giữ `SELECT…FOR UPDATE` trên instance → real `approve()` PHẢI block (chưa-lock=không-block=ĐỎ; có-lock=block→release=XANH). Đúng-tuần-tự open/complete đã có FS3/FS7.
- **W2:** xoá `findMaxStepOrder`+`advanceInstanceStepOrder`+`updateInstanceStepOrder` (cả 3 dead) + bỏ `max` import; `current_step_order` chỉ advisory. Spec dọn mock + 2 assertion legacy.
- **FS5:** đặt ở **FSM unit** — `validateConsumerTransition` là writer DUY NHẤT của approved/revision (cặp với **D6** đã có; D6 chứng minh service path KHÔNG ghi được approved/revision).
- **⑤ FS11: SKIP** — e2e linear 17 đã che vòng start/submit/approve (seed `video_standard_v0` không seed deps → mọi bước root, guard `allDependenciesApproved` mới vẫn xanh).
- **KHÔNG migration** trong 3c. Migration kế = **0035** (4a eval hook), rồi **0036** (4c permissions seed — PHẢI seed hyphen: `create/update/publish/read:workflow-template` + `apply:workflow-instance`).

### ⬜ VIÊN KẾ: ⑥ FULL+santa gate cho crown-jewel 3c (rồi push)

- **Scope gate:** review CẢ **3c-i (`0d31be6`) + 3c-ii (`c26eb94`) + 3c-iii (`af8f583`)** — DAG/FSM/lock/auto-task/idempotency = crown-jewel.
- **Agent (song song):** `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter`; rồi `ecc:santa-method` (dual-review hội tụ).
- Sửa CRITICAL/HIGH → re-verify (fsm 27 · approval 19 · int 5 · e2e 17 · typecheck) → commit fix theo PATH → **push `feat/g7-workflow`**.

### Ghi chú review treo cho ⑥ gate

- **Review C1 (race trên join)** đã được vá ở 3c-iii (FOR UPDATE) — gate xác nhận lock đặt đúng (TRƯỚC mọi read dep) + approve-only đủ an toàn.
- ⚠️ BẪY pg single-connection: đọc dep TUẦN TỰ (await), KHÔNG `Promise.all` trên CÙNG 1 tx; FS10 test cần 2 connection RIÊNG.
- Điểm gate nên soi: (a) lock đặt sau `findInstanceByIdInTx` có nằm TRƯỚC mọi DAG-read không (approval.service.ts); (b) `.for("update")` Drizzle sinh đúng SQL trên `workflow_instances` + còn `withTenant`/RLS; (c) start/submit bỏ lock có tạo race khác không (kết luận 3c-iii: không); (d) probe FS10 có còn xanh-xác-định.

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
