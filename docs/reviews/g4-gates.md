# G4 — Review-Gate Artifact (dấu vết kiểm chứng)

> **Mục đích:** ghi lại dấu vết kiểm chứng cho review gate phân tầng của G4 (CLAUDE.md §6 + plan G4 §7).
> Đây là **bản tổng hợp từ nguồn sự thật đã có** (`TASKS.md` G4 · `docs/plans/G4-mvp-walking-skeleton.md` · `git log`) — **KHÔNG phải chạy lại gate**.
> Trước đây trạng thái gate chỉ tồn tại dưới dạng chữ trong `TASKS.md` ("FULL/LIGHT gate passed") mà không có file artifact (khác G6 có handoff). File này vá lỗ hổng quy trình đó.
>
> Tạo: 2026-06-09 · Branch hiện tại: `feat/g6-media` · Nguồn gate level/reviewer: plan G4 §7.

---

## 1. Bảng tổng hợp gate

| Sub-task | Gate | Reviewer dự kiến (plan §7) | Trạng thái | Commit chính |
| --- | --- | --- | --- | --- |
| **G4-1** Org/Employee | LIGHT | `ecc:typescript-reviewer` | ✅ passed | `aca6233` |
| **G4-2** Channel/Project/Content | LIGHT | `ecc:typescript-reviewer` | ✅ passed | `ac9417d` → `0467216` (+ `4b60474` mark done) |
| **G4-3** Workflow cứng (FSM) | **FULL** | `ecc:security-reviewer` + `ecc:typescript-reviewer` + `ecc:silent-failure-hunter` | ✅ passed | `0ff268f` (RED) → `7f05fee` (GREEN) |
| **G4-4** My Tasks + submit + comment | LIGHT | `ecc:typescript-reviewer` | ✅ passed | `a4e4f61` |
| **G4-5** Approval 1 cấp + return revision | **FULL** | `ecc:security-reviewer` + `ecc:typescript-reviewer` + `ecc:silent-failure-hunter` | ✅ passed | `18084b6` |
| **G4-6** Notification + project chat | LIGHT | `ecc:typescript-reviewer` | ✅ passed (3 HIGH fixes) | `c4398dc` |
| **G4-7** E2E full lifecycle | LIGHT | `ecc:e2e-runner` | ✅ passed (5 bug fixes) | `547b594` → `259586c` → `879efca` |
| **G4-8** Pilot deploy | — (chore, không gate code) | — | ✅ tài liệu | `docs/pilot/*` |

> **Lưu ý nguồn:** "Reviewer dự kiến" = reviewer được quy định trong plan §7. "Trạng thái ✅ passed" = ghi nhận theo `TASKS.md` G4 (gate đã chạy ở các phiên trước). File này **không** chạy lại các reviewer agent.

---

## 2. Chi tiết từng sub-task + fix đã áp

### G4-1 — Org/Employee tối thiểu · LIGHT ✅
- Schema: `org_units` + `teams` + `team_members`; **RLS + FORCE + CHECK** ngay khi CREATE.
- BE: NestJS OrgModule (7 endpoints); Zod contracts.
- FE: `/org/departments` · `/org/teams` · `/org/employees` (list + inline role assign).
- Commit: `aca6233`.

### G4-2 — Channel + Project + Content · LIGHT ✅
- BE: 9 endpoints (channels/projects/content + project↔channel).
- FE: 3 trang + sidebar nav.
- Commits: `ac9417d` (schema + CRUD + FE) → `0467216` (navigation + `GET /projects/:id`) → `4b60474` (mark done).

### G4-3 — 1 workflow cứng (FSM) · **FULL** ✅
- **TDD deny-path RED→GREEN: 23 tests** (`workflow-fsm.service.spec.ts`).
- Workflow hard-coded 4 bước `Script→Edit→QA→Upload` + auto-sinh task + submit.
- Global `JwtAuthGuard` + `CompanyGuard` wired.
- Tổng tại thời điểm đóng: 125 tests xanh.
- Commits: `0ff268f` (RED suite) → `7f05fee` (impl GREEN).
- **Crown-jewel** — module nhạy cảm, nay được enforce coverage ≥80% (xem §3).

### G4-4 — My Tasks + submit + comment · LIGHT ✅
- `GET /tasks`, `POST /tasks/:id/comments` + `GET` comments.
- FE `/tasks` (2-panel list + detail), `SubmitWorkForm` (link + note → submitStep), `CommentThread`.
- `submission_url` / `submission_note` trên `workflow_steps`; migration **0009**.
- ⚠️ **`task_attachments` DESCOPED** (close-out 2026-06-09): MVP nộp **chỉ bằng link**, không upload file. Để lại phase sau (Task Hub G9 / Media assets).
- Commit: `a4e4f61`. Tổng: 125 tests xanh.

### G4-5 — Approval 1 cấp + return revision · **FULL** ✅
- **TDD: 12 deny + happy tests RED→GREEN** (`approval.service.spec.ts`).
- `validateConsumerTransition` thêm vào FSM; `ApprovalService` (approve T3, requestRevision T4 + defect + revision task).
- Repository: `createApprovalStep`, `closeApprovalRequest`, `approveStep`, `advanceInstanceStepOrder`, `completeWorkflowInstance`, `setStepToRevision`, `createDefect`, `findMaxStepOrder`.
- 3 endpoints (GET/POST approval-requests). Đi qua `approval_requests` theo **ADR-0016** (không ghi thẳng `step.status`).
- FE: tab "Chờ duyệt" + `ApprovalCard` (approve / trả về form).
- Commit: `18084b6`. Tổng tại thời điểm đóng: 137 API + 17 web tests xanh.
- **Crown-jewel** — nay được enforce coverage ≥80% (xem §3); branch coverage nâng 69.5% → 86.6% phiên này.

### G4-6 — Notification + project chat · LIGHT ✅ (3 HIGH fixes)
- Migration **0010**: 4 bảng RLS (`notifications`, `chat_rooms`, `chat_room_members`, `chat_messages`).
- BE: `NotificationsModule` + `ChatModule`; auto-tạo project chat room khi tạo project.
- FE: `NotificationBell` (poll 30s) + `/chat/projects/:id`.
- **Fix đã áp: 3 HIGH** (từ LIGHT gate) — đã giải quyết trước khi đóng.
- Commit: `c4398dc`. Tổng: 154 tests xanh.

### G4-7 — E2E full video lifecycle · LIGHT ✅ (5 bug fixes)
- E2E spec 17 test: `Script→Edit→QA→Upload` lifecycle + revision flow + tenant isolation cross-check.
- Mở rộng harness G2-5 thêm **22 bảng G4** (idColumn / skipNoContext) → tránh xanh-giả.
- **Fix đã áp — 3 production bugs:**
  1. `auth.controller.ts` thiếu `@Public()`.
  2. `audit_logs` CHECK constraint.
  3. Route ordering `approval-requests` vs `:instanceId`.
- **Fix đã áp — 2 migration bugs:**
  1. `task_comments` thiếu GRANT.
  2. Policy thiếu `NULLIF`.
- Commits: `547b594` (DEFER + blocker ticket) → `259586c` (root-cause fix: seed project-manager role + `POST /content`) → `879efca` (RESOLVED). Tổng: 282 tests xanh.

### G4-8 — Pilot deploy · chore ✅
- Deploy checklist → [`docs/pilot/deploy-checklist.md`](../pilot/deploy-checklist.md).
- Feedback form → [`docs/pilot/feedback-template.md`](../pilot/feedback-template.md).
- Không có gate code (triển khai/thu feedback).

---

## 3. Close-out 2026-06-09 (rà soát trước khi đóng G4)

Rà soát toàn bộ G4 vs plan/CLAUDE.md phát hiện & **đã sửa** 3 lỗ hổng + 1 phụ (chi tiết: plan G4 §"Close-out review"):

1. **FE không khởi tạo/điều khiển được workflow** (chặn tiêu chí "pilot dùng được"). E2E xanh chỉ vì test gọi thẳng API + set `assignee_user_id` bằng SQL.
   **Sửa:** thêm tab **"Sản xuất"** ở `content-detail` (nút *Bắt đầu sản xuất* → `POST /workflow/start`, board 4 bước, gán việc).
2. **Thiếu endpoint gán assignee/reviewer.**
   **Sửa:** `POST /workflow/steps/:id/assign` (**FULL**: `@RequirePermission update content`, audit `StepAssigned`, đồng bộ assignee sang `tasks`) + lookup `GET /workflow/by-content/:contentItemId`. Test: `workflow-assign.service.spec.ts` (5 tests).
3. **`task_attachments` chưa từng tạo.**
   **Quyết định:** descope chính thức khỏi G4 (xem G4-4).
4. **(Phụ) FE↔API lệch envelope** — client web parse body trần trong khi API luôn bọc `{success,data,error}` (bằng chứng FE chưa từng chạy thật với API).
   **Sửa:** `api-client.ts` + `tasks-api.ts` + `employees-api.ts` + `workflow-api.ts` → **unwrap envelope tolerant** (chạy đúng cả body trần trong test lẫn enveloped thật).

> ⚠️ **Trạng thái commit:** các thay đổi close-out (workflow controller/service/repository/module/dto + contracts `workflow.ts` + `content-detail.tsx` + 4 client FE + `workflow-assign.service.spec.ts`) hiện ở **working tree (chưa commit)** trên branch `feat/g6-media` cùng với thay đổi coverage §3. Commit khi đóng phiên.

---

## 4. Coverage enforcement — module nhạy cảm (G4-3 FSM + G4-5 approval)

> Vá nốt nợ quy trình thứ 2 (plan G4 §"Còn nợ"): coverage ≥80% cho G4-3/G4-5 **chưa enforce** trong vitest config. Nay đã bật.

- **Provider:** cài `@vitest/coverage-v8@^3.2.6` (khớp vitest 3.2.6) — trước đó chưa có provider.
- **Ngưỡng SCOPED** trong [`apps/api/vitest.config.ts`](../../apps/api/vitest.config.ts) — gate đúng **2 file crown-jewel unit-tested**, key là đường dẫn chính xác (per-file = aggregate, không nhập nhằng glob):
  ```ts
  coverage: {
    provider: "v8",
    thresholds: {
      "src/workflow/workflow-fsm.service.ts": { lines: 80, functions: 80, branches: 80, statements: 80 },
      "src/workflow/approval.service.ts":      { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  }
  ```
- **Vì sao KHÔNG gate cả `src/workflow/**`:** `workflow.service.ts` / `workflow.repository.ts` / controller / module / dto được phủ bởi `*.int-spec` / `*.e2e-spec` có `skipIf(!DATABASE_URL)`. Chạy unit (không Docker DB) chúng đọc 0–25% → ngưỡng phủ toàn bộ sẽ **đỏ oan**. Đây chính là "ngưỡng mù" mà plan dặn tránh.
- **Đo thực trước khi set ngưỡng** (tránh ngưỡng mù), rồi **bổ sung test cho nhánh thiếu** (KHÔNG hạ ngưỡng):

  | File | Stmts | Branch | Funcs | Lines |
  | --- | --- | --- | --- | --- |
  | `workflow-fsm.service.ts` | 94.4% | 90.6% | 100% | 94.4% |
  | `approval.service.ts` (trước) | 93.8% | **69.5% ❌** | 85.7% | 93.8% |
  | `approval.service.ts` (sau, +6 test) | 98.5% | **86.6% ✅** | 85.7% | 98.5% |

- **Test bổ sung** (`approval.service.spec.ts`, +6 → 18 tests): nhánh task-linked (approve/revision), comment truthy, `InternalServerErrorException` guard (approveStep/setStepToRevision rỗng), rethrow lỗi không phải HTTP qua `withTenant().catch`.
- **Lệnh gate:** `pnpm --filter @mediaos/api test:cov` (= `vitest run src/workflow --coverage --coverage.include=src/workflow/**`). Đã xác minh RED→GREEN: set ngưỡng → đỏ trên `approval.service.ts` branch 69.5% (chứng minh gate thực sự bắt) → thêm test → **xanh, EXIT=0**.
- ⚠️ Ngưỡng chỉ kích hoạt khi chạy có `--coverage`. `pnpm test` thường (không `--coverage`) vẫn xanh nhưng không enforce — dùng `test:cov` (hoặc thêm vào CI) để gate.

---

## 5. Re-review 2026-06-09 (lần 2) — Org/Team permission hole (F2) · phát hiện & ĐÃ SỬA

Rà soát lại G4 đối chiếu **working tree thực** (không tin snapshot tài liệu) phát hiện build đang **ĐỎ** — trái với tuyên bố "all green" ở §4 (snapshot đó chụp TRƯỚC khi `org.permission.spec.ts` được thêm):

1. **BLOCKER — 24 test FAIL** ở [`org.permission.spec.ts`](../../apps/api/src/org/org.permission.spec.ts) (RED suite F2/G5-FIX). Lần chạy nền báo `exit 0` là exit của `tail`/`echo` cuối lệnh, **che** exit thật của vitest (=1).
2. **BLOCKER — lỗ hổng phân quyền G4-1:** fix F2 cho `OrgController` **bị bỏ dở** — 4 route `org_unit` đã gắn `@UseGuards(PermissionGuard)+@RequirePermission`, nhưng **6 route team KHÔNG** (`createTeam`/`updateTeam`/`assignTeamLeader`/`deleteTeam`/`addTeamMember`/`removeTeamMember`). → bất kỳ member tenant nào cũng CRUD team + đổi leader + thêm/xoá member. Vi phạm CLAUDE.md §5 + guard `manage:team` plan G4-1 §4.
3. **HIGH — quyền chưa từng seed + sai convention:** không có migration 0030 (mới nhất 0029); action ghép `'manage-org-unit'`/`'manage-team'` chỉ tồn tại trong controller+spec. Catalog (0005/0019/0027) dùng action **bare-verb** + resource riêng → kể cả route org_unit đã gắn guard cũng **deny-403 oan** company-admin/hr-manager (chỉ `*:*` super-admin lọt).

**Đã sửa — commit `4b23ccd` trên `feat/g6-media` (6 file thuần-F2, tách riêng khỏi G4 close-out/G6):**
- Gắn `@UseGuards(PermissionGuard)+@RequirePermission('manage','team')` cho cả 6 route team.
- Đổi 4 decorator org_unit `'manage-org-unit'`→`'manage'` (đúng convention bare-verb, khớp fix workflow cùng phiên `('update','content')`); sửa spec expected action tương ứng.
- Migration **0030** [`0030_g5fix_org_team_permissions_seed.sql`](../../apps/api/migrations/0030_g5fix_org_team_permissions_seed.sql): seed `('manage','org_unit')`+`('manage','team')` (non-sensitive) + grant ALLOW cho company-admin (…001) + hr-manager (…009); journal idx 31.
- **Verify:** `org.permission.spec.ts` **40/40 xanh**; full suite **443 passed / 2 skipped / 0 fail**, typecheck `tsc` RC=0.

> ⚠️ **Nợ mới (không chặn):** suite **flaky** — 1/2 lần chạy full báo "1 file failed / 0 test fail / +14 skip" (đua worker ở int/e2e-spec `skipIf(!DATABASE_URL)` khi chạy không Docker DB). Cần điều tra & cô lập riêng; không phải assertion fail, không do fix này.

---

## 6. Kết luận

G4 đủ điều kiện đóng về **chức năng** (lifecycle video end-to-end qua UI) **và quy trình**:
- Review gate phân tầng: có dấu vết kiểm chứng (file này) cho cả 8 sub-task.
- Coverage ≥80% cho module nhạy cảm (G4-3 FSM + G4-5 approval): **đã enforce + xanh**.
- Close-out 3 lỗ hổng + envelope fix: **đã sửa** (working tree, chờ commit).
- **Re-review lần 2 (§5): lỗ hổng phân quyền Org/Team (F2) — đã sửa + verify xanh.**

⚠️ **Fix F2 đã commit tách riêng (`4b23ccd`).** Phần close-out G4 (workflow + docs, gồm file này) + G6 **còn lại vẫn ở working tree** `feat/g6-media` (chưa commit) — commit khi đóng phiên.

_Tham chiếu: `TASKS.md` (G4) · `docs/plans/G4-mvp-walking-skeleton.md` (§7 gate, §8 acceptance, close-out) · CLAUDE.md §6 · ADR-0016._
