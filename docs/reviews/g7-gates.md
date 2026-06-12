# G7 — Review-Gate Artifact (Workflow Builder · gate HOLISTIC tổng)

> **Mục đích:** dấu vết kiểm chứng cho viên GATE TỔNG của G7 (spine 1a→4c BE + FE Track C) — gate
> cross-cutting toàn cục, soi GIAO THOA + lắp ghép, thứ gate-từng-viên không thấy (CLAUDE.md §6).
> Khác g3/g4-gates.md (tổng hợp hồi cố): file này ghi lại gate **đã chạy live** trong phiên này.
>
> Tạo: 2026-06-12 · Branch: `feat/g7-workflow` → PR base `master` · Mức gate BE: **B1 FOCUSED** + santa · FE: **LIGHT**.

---

## 0. Bối cảnh — tích hợp master (Decision #A) TRƯỚC khi gate

Nhánh `feat/g7-workflow` phân kỳ với `master` ở `bf4362c`: cả hai làm **G5-FIX F2** độc lập và **chiếm
trùng số migration 0030/0031**. PR "as-is" KHÔNG mergeable (conflict + journal hỏng). Đã chọn **merge
master + reconcile** (commit `32ac739`):

- Conflicts (5) — `org.controller.ts` / `org.module.ts` / `docs/G5-org-personnel-full.md` → lấy master
  (F2 master là canonical/superset granular CRUD); `web/lib/employees-api.ts` → union (master
  `employeeProfileSchema` + nhánh `unwrapEnvelope`); `meta/_journal.json` → dựng lại 1 dãy idx liền + when đơn điệu.
- Migration reconcile: **DROP** `0030_g5fix_org_team_permissions_seed` (redundant — master 0030 là superset);
  **KEEP** master `0030_g5fix_org_team_perms` + `0031_g5fix_position_perm`; **KEEP** G7 `0032–0036`;
  **RENAME** `0031_g3fix_grant_object_permission_seed` → `0037` (độc lập, idempotent ON CONFLICT).
- Post-merge fix `bd28990`: `org.permission.spec.ts` align với F2 granular của master (nhánh assert bare
  `'manage'` đã bỏ cùng 0030 redundant).
- **Verify reset-DB**: drop `public`+`drizzle` → re-migrate `0000→0037` sạch từ đầu → chuỗi migration toàn vẹn.

---

## 1. Bảng tổng hợp gate

| Surface | Mức | Reviewer | Verdict | Fix commit |
| --- | --- | --- | --- | --- |
| **BE crown-jewel** (approve()/FSM/lock/4a/4b/4c/migrations/RLS/contract) | B1 FOCUSED | `ecc:security-reviewer` + `ecc:database-reviewer` + `ecc:silent-failure-hunter` | FAIL→ triage→ **PASS sau fix** | `2fbe7d0` |
| **BE — santa dual-review** trên fix | santa | `security-reviewer` (re-attack S2) + `code-reviewer` (D4/SF3/SF5 + test-integrity) | **both PASS** | `0c0e88d` (đóng 2 coverage gap) |
| **FE** (checklist UI · canvas · workflow-*-api) | LIGHT | `ecc:typescript-reviewer` + `ecc:a11y-architect` | FAIL→ triage→ **PASS sau fix** (plan criteria) | `e9e93c7` |

---

## 2. BE crown-jewel — B1 FOCUSED: phát hiện, triage, fix

3 reviewer chạy song song trên crown-jewel surface (NHẤN 4a/4b/4c là gate-đầu). Tất cả FAIL với nhiều
phát hiện — đã verify từng cái với code (reviewer overstate nhiều), triage:

### Đã FIX (commit `2fbe7d0`, RED-first cho S2)

- **S2 (HIGH, security) — null-reviewer fail-open → tự duyệt.** `submitStep` tạo approval request với
  `reviewerUserId=null` (PM gán reviewer sau); guard cũ `reviewerUserId !== null && != actor` → null bỏ qua
  → BẤT KỲ thành viên tenant (kể cả assignee) tự duyệt. **Fix:** `workflow-fsm.service.ts` Guard 5
  **FAIL-CLOSED** — null HOẶC actor≠reviewer → `NotReviewerError`. RED test deny-path trước (fsm spec S2
  block), cập nhật fixtures approval/int/e2e (gán reviewer = assignee = userA, single-actor).
- **D4 (HIGH, race-safety) — `requestRevision()` thiếu `lockInstanceForUpdateInTx`** mà `approve()` có
  (3c-iii). Concurrent approve/revision cùng instance race trên DAG reads + propagate lock. **Fix:** thêm
  FOR UPDATE per-instance TRƯỚC khi đọc DAG (parity approve()).
- **SF3 (defensive) — `closeApprovalRequest` 0-row** không guard → có thể commit request 'pending' trong
  khi step đã approved/revision. **Fix:** `const [closed] = …; if (!closed) throw ISE` ở cả 2 path.
- **SF5 (observability) — eval-hook (4c) no-def-match** `logger.warn` → `logger.error` (side-effect hợp đồng
  bị bỏ phải alert được).

### Santa dual-review (cả 2 PASS) — đóng 2 coverage gap (commit `0c0e88d`)

- security-reviewer re-attack S2 (5 vector: null-reviewer, mismatch, alt entry-point, DTO injection,
  cross-tenant) → không bypass. **PASS**.
- code-reviewer audit D4/SF3/SF5 + test-integrity (đổi `makeStep` default reviewer không neuter test nào;
  helper int/e2e set reviewer là prerequisite, không che race FS10/fan-out) → **PASS**.
- Gap (coverage, không phải defect) đã đóng: test `closeApprovalRequest` trả `[]`→ISE (approve + revision);
  test `requestRevision` null-reviewer FAIL-CLOSED (đối xứng C3 approve).

### 4a/4b/4c (gate-đầu) — kết luận

- **4a LockPropagationService**: BR-006 transitive blocking đúng; insert tuần tự trong tx (không Promise.all);
  `wf_step_locks_active_uq` partial-uq `WHERE released_at IS NULL` chặn double active-lock; `onConflictDoNothing`
  idempotent. ✅
- **4b checklist enforcement**: submit gated bởi `resolveChecklistComplete` trong tx sau FOR UPDATE step;
  fail-closed (thiếu row → ISE, không `?? 0`); cross-item guard. ✅
- **4c eval hook**: emit `step.evaluation_required` trong CÙNG tx (transactional outbox — rollback ⇒ no ghost);
  payload company-scoped; no-def-match nay error-level. ✅

---

## 3. FE — LIGHT: phát hiện, triage, fix

### Đã FIX (commit `e9e93c7`)

- **TS-HIGH1 (checklist mirror) — submit gate mở OAN khi đang load.** `checklistReady =
  allRequiredChecked(checklist?.items ?? [])`: lúc load (undefined) → `[]` → vacuously true → nút submit bật
  trước khi checklist về (và cả khi fetch lỗi). **Fix:** require `isSuccess` (fail-closed khi load/lỗi) → đúng
  "mirror BE 4b, không chỉ dựa 4xx".
- **A11Y-A** — template node `ariaLabel = step.name` (tránh đọc UUID khi focus bàn phím).
- **A11Y-B** — instance edge `focusable:false` + `Handle aria-hidden` (cạnh/handle read-only inert).

### FE PASS theo tiêu chí plan

- checklist UI mirror BE 4b ✅ (sau TS-HIGH1) · canvas a11y: **list/keyboard fallback** ("Danh sách" +
  status list) + **published cấm kéo/xoá edge** (reviewer xác nhận PASS) ✅ · không hard-code permission
  (publish/clone qua `<PermissionGate>`; không inline role string) ✅ · bind contracts Zod (`schema.parse`) ✅.

---

## 4. Residual (đã ghi nhận, KHÔNG block gate này)

| # | Mục | Lý do residual | Đề xuất |
| --- | --- | --- | --- |
| S1 | Endpoint workflow transition dùng **FSM-actor model**, không có RBAC permission-catalog gate (chỉ `assign` có `@RequirePermission`) | Intended design (controller cmt 70-72); guard actor/reviewer ép authz per-step; lỗ tự-duyệt thật đã đóng bởi S2 | Pass RBAC-hardening sau: seed `start/submit/approve` perms + guards + grants + deny tests |
| D1 | `_journal.json` tag `0022` ở idx 26 | **Pre-existing G6** (cả master + nhánh), KHÔNG net-new; drizzle resolve theo `tag`+`when` (monotonic) nên KHÔNG lỗi runtime | Ghi chú, không rename post-deploy (đổi hash) |
| D2 | `wf_step_locks_active_uq` gồm `company_id` trong unique tuple | Defensible multi-tenant pattern; reviewer thừa nhận đúng dưới RLS | Optional: siết về `(locked_step_id, caused_by_step_id)` |
| D5/D6/D9 | `ON CONFLICT` thiếu target · `DROP INDEX/CONSTRAINT` thiếu `IF EXISTS` trên migration ĐÃ apply | Cosmetic idempotency; migration chạy sạch fresh | Optional khi viết migration mới |
| TS-HIGH2 | `StepEditor`/`DependencyEditor`/canvas-edit gate bởi `isDraft`, chưa bởi `useCan` | BE ép permission server-side (không lỗ bảo mật); FE không hard-code; thêm gate có rủi ro perm-string (mismatch underscore/hyphen `templates.tsx:17` vs hyphen BE) | Follow-up: gate editors bằng `useCan("update","workflow-template")` + sửa mismatch |
| A11Y-E | `ui/dialog.tsx` thiếu focus-trap | **Shared component** (dùng toàn app), cần focus-trap/Radix — broader scope ngoài LIGHT | Follow-up a11y |
| A11Y-C/D/F | aria-label nút Sửa/Xoá · target-size toggle · contrast `text-green-700` | Refinement WCAG-AA, ngoài tiêu chí canvas-a11y của plan | Follow-up a11y |
| FE polish | `savePosition` thiếu `onError` · `applyResultSchema` shape cục bộ (chưa vào contracts) · react-refresh warnings · `mock-store.apply` bỏ args | Minor UX/maintainability | Khi đụng lại |

---

## 5. Verify XANH (sau mọi fix)

| Suite | Kết quả |
| --- | --- |
| Migration chain `0000→0037` (reset DB) | ✅ apply sạch |
| BE typecheck | ✅ |
| BE workflow unit | ✅ **123** (116 baseline + 4 S2 + 3 coverage) |
| BE full unit (`src`) | ✅ **424** |
| BE integration | ✅ **284 + 2 skip** |
| BE e2e lifecycle | ✅ **17** |
| FE typecheck · test · build | ✅ · **133** · ✅ |

---

## 6. Kết luận

GATE TỔNG G7 **PASS**: BE crown-jewel B1 FOCUSED — 3 reviewer, các phát hiện đã verify + fix net-new
CRITICAL/HIGH (S2 security, D4 race-safety) + defensive (SF3/SF5); **santa dual-review cả 2 PASS**; 4a/4b/4c
(gate-đầu) đã thực sự soi. FE LIGHT — checklist mirror + canvas a11y đạt tiêu chí plan. CLAUDE §2 bất biến
nguyên vẹn (withTenant, no hard-delete instance/audit, RLS+FORCE+policy bảng mới + rls-registry đủ); contract
1b freeze không phá (chỉ additive); hard-delete chỉ template-children draft. Residual ghi mục 4.
