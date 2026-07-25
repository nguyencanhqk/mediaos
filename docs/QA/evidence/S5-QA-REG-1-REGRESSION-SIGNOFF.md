# S5-QA-REG-1 — Regression suite MVP + UI-state + responsive/a11y smoke sign-off

> Work Order **S5-QA-REG-1** — Workstream F (🟡 yellow / LIGHT gate).
> Sources: IMPLEMENTATION-08 §15 (§15.2 regression suite MVP · §15.3 UI-state checklist ·
> §15.4 responsive/accessibility smoke) · QA-02 · QA-08 · plan `docs/plans/S5-QA-REG-1.md`.
> Signed off: **2026-07-25**. Branch `qa/S5-QA-REG-1-regression-a11y`.

This WO is **test + sign-off only** (§15.2/§15.3 are a survey — no product code changed for those two
tables) plus a small **net-new §15.4 a11y smoke** (4 files, no new dependency — `@testing-library/react`
`fireEvent` only, per owner decision in the plan §2). Every backend citation below was opened and the
cited `it()` title/line was verified directly (not copied from memory) — this closes the gap the plan
flagged from an earlier survey round that missed colocated `src/**/*.int.spec.ts` specs.

## Artifacts added / touched by this WO

| File | What |
| --- | --- |
| `apps/app/src/routes/forbidden.spec.tsx` | NEW — a11y smoke: `<h1>` heading, message-per-`reason` enum, unknown-reason fallback, "Về trang chủ" action link accessible name. |
| `packages/ui/src/components/ui/sheet.spec.tsx` | NEW — `Sheet` had ZERO test coverage despite being the shared primitive behind every P0 drawer (TaskDetailDrawer/ProjectFormDrawer/TaskFormDrawer): role=dialog/aria-modal/aria-labelledby+describedby, close-button accessible name, Escape-close, and the untested "yields Esc to a nested Dialog/Popover" branch. |
| `apps/app/src/layouts/topbar/GlobalTopbar.spec.tsx` | NEW — icon-only-button accessible-name smoke for the ONE component mounted on every protected P0 screen (mobile-menu/app-switcher/theme-toggle/notification-bell/home-link); includes a `window.matchMedia` mock (ThemeToggle → `useTheme`) per the plan's "no new dep" pattern. |
| `packages/ui/src/components/ui/data-table.spec.tsx` | +1 test (append, not new file) — responsive-structure proxy: `DataTable` (used by every P0 list screen) wraps `<table>` in `.overflow-x-auto`. |
| `docs/QA/evidence/S5-QA-REG-1-REGRESSION-SIGNOFF.md` | This sign-off. |

---

## §15.2 Backend regression suite MVP — module × P0/P1 coverage

**Conclusion: 10/10 modules COVERED.** Every citation below was opened and the exact `it()` title + line
verified (glob-quét CẢ `apps/api/test/**/*.int-spec.ts` LẪN colocated `apps/api/src/**/*.int.spec.ts` —
bài học S5-SEC-1: khảo sát vòng-1 từng báo "gap ATT" chỉ vì bỏ sót glob thứ hai).

| Nhóm | Test chính (IMPLEMENTATION-08 §15.2) | Covering spec (file:line — real `it()` title) | Status |
| --- | --- | --- | --- |
| **AUTH** | Login/logout/refresh/forgot/reset/change-password/session-expired | `auth.int-spec.ts:96` "login đúng → trả token…"; `:125` "refresh rotation + REUSE-DETECTION…"; `:141` "forgot-password không lộ email…"; `:148` "reset-password single-use…"; `:182` "brute-force: quá số lần sai → 429"; `auth-session.int-spec.ts:198` "refresh cookie + CSRF hợp lệ → 200…"; `auth-logout.int-spec.ts:112` "logout(refreshToken) → refresh CHÍNH token đó sau đó = 401…"; `auth-reset-deny-path.int-spec.ts:269` "change-password đúng currentPassword → đổi hash…"; `two-factor-login.int-spec.ts:144` "completeTwoFactorLogin: challenge + mã TOTP đúng → tokens" | ✅ |
| **HOME** | Home Portal, App Switcher, app visibility, route guard | `my-apps-canonical-role.int-spec.ts:114` "MỌI role thấy HR + ATT + LEAVE…"; `:124` "AUTH (system app) ẨN cho employee + manager; HIỆN cho hr + company-admin"; `:143` "shape my-apps đúng contract + KHÔNG lộ secret…"; `module-registry.deny.int-spec.ts:68` "operator thường (company-admin) KHÔNG có manage:module-toggle ⇒ DENY"; `:90` "platform-admin (grant tường minh) ⇒ ALLOW"; `module-admin.int.spec.ts:128` "Employee GET /foundation/modules → 403"; `:202` "R6 — GET /foundation/modules/my-apps…→ 200" | ✅ |
| **HR** | Employee list/detail/create/update/status/profile-change/contract | `employees-rbac-scope.int-spec.ts:226` "DENY: GET /hr/employees KHÔNG có read:employee → 403"; `:247/253/260/271` Own/Team/Department/Company scope; `hr-employee-write.int-spec.ts:201` "auto-generates monotonic codes…"; `:290` "update: PATCH a structural field → 200…"; `:352` "link-user endpoint…"; `hr-contract.int-spec.ts:371` "hr create → 201 + exactly one audit row…"; `profile-change-request.int-spec.ts:320` "approve applies every mapped field to employee_profiles…"; `:639` "approver CÓ approve NHƯNG THIẾU view-identity → 403" | ✅ |
| **ATT** | Today, check-in/out, records, adjustment, approval, remote-request | `attendance-be1.int.spec.ts:154` "check-in→check-out OFFICE_8H…"; `:212` "check-in lần 2 cùng ngày ⇒ Conflict"; `:302` "race — 2 lệnh check-in đồng thời…"; `attendance-adjustment.int.spec.ts:302` "manager approves report's request → record Adjusted…"; `:485` "the creator may NOT self-APPROVE…403 ATT-ERR-SELF-APPROVAL"; `:521` "two CONCURRENT approves…exactly one 200 and one 409"; `remote-work-request.int.spec.ts:215` "owner submits Draft → Pending…"; `:362` "manager approves report's Pending…→ Approved, attendance_records upserted"; `attendance-permission.int-spec.ts:72` "approve…user thiếu grant ⇒ 403" | ✅ |
| **LEAVE** | Balance, create/submit/cancel/approve/reject/calendar/sync-ATT | `leave-qa2-api.int-spec.ts:374` "HR GET /leave/admin/balances → company-wide…"; `:394` "submit→approve ledger: RESERVE/RELEASE/USE…"; `leave-approval.int.spec.ts:366` "manager approve a non-report's request → 403 LEAVE-ERR-OUT-OF-SCOPE…"; `:465` "approve happy: RELEASE+USE ledger…APPROVED event + audit"; `leave-noti-e2e.int-spec.ts:355` "gửi đơn nghỉ → 1 notification cho direct manager…"; `leave-att-sync-qa2.int-spec.ts:366` "owner cancels Approved+Synced full-day → Cancelled, ATT recalc…REFUND ledger exact" | ✅ |
| **TASK** | Project/task list/detail/status/comment/checklist/kanban/mention | `task-core.int-spec.ts:408` "employee/manager KHÔNG có create:task (deferred) → POST /tasks 403"; `:424` "employee @Own: thấy task assigned=mình…"; `task-qa1-fsm-collab.int-spec.ts:392` "nhảy cấp Todo→Done → 200…"; `:430` "Done khi checklist is_required_for_done chưa tick → 400 CHECKLIST-REQUIRED…"; `task-qa1-permission-matrix.int-spec.ts:451` "task NGOÀI Own…read 404 · WRITE 404 fail-closed"; `task-comments-checklists.int-spec.ts:269` "mention người CÓ quyền xem task → 200 + outbox TASK_MENTIONED"; `tasks-board.int-spec.ts:115` "TENANT ISOLATION: login A → board KHÔNG lộ row của B" | ✅ |
| **NOTI** | Unread-count/dropdown/list/detail/mark-read/deep-link/template | `my-notifications.int-spec.ts:222` "deny: noPerm…→ 403"; `:302` "GET /notifications/unread-count: unread=2…"; `noti-event-intake.int-spec.ts:262` "TASK_ASSIGNED + UserIds → created=1…1 delivery_log Sent attempt_no=1"; `:434` "non-system (TASK_ASSIGNED): actor∈recipients → actor KHÔNG nhận"; `notification-delivery-append-only.int-spec.ts:89/115` INSERT succeeds / UPDATE DENIED (append-only); `s5-noti-fix1-deeplink.int-spec.ts:189` "TASK_ASSIGNED → notification.target_url = /tasks/{taskId}" | ✅ |
| **DASH** | Dashboard me/type/widget/quick-action/cache-fallback | `dashboard-resolver.int-spec.ts:208` "M1 no-role: GET /dashboard/me·…→ 403"; `:230` "M2 employee: /dashboard/employee → 200, đúng 5 widget…"; `dashboard-widget-data.int-spec.ts:276` "D5 cache: miss(hit=false) → hit(true…) → refresh<min-interval serve…"; `:427` "D4 employee: /widgets/my-tasks → 200 status=Degraded…KHÔNG 500"; `dashboard-widget-security.int-spec.ts:416` "S4 masking: uNoView…/widgets/hr-overview → 200, KHÔNG lương/PII"; `dashboard-cache-invalidate.int-spec.ts:238` "TASK_ASSIGNED → invalidate MY_TASKS + TASK_ALERTS…" | ✅ |
| **SYSTEM** | User/role/permission/module-settings/audit-log | `auth-users-admin.int-spec.ts:266` "GET /auth/users → 403"; `:356` "GET /auth/users → 200 + DTO KHÔNG passwordHash"; `permission-admin.int-spec.ts:225` "assignRole writes user_role + audit (RoleAssigned) + outbox permission.changed"; `system-settings.int-spec.ts:189` "P1 — GET /system-settings → 200; sensitive value masked…"; `:272` "P6 — PATCH hợp lệ → 200…1 audit company_id=actor"; `audit-logs-appendonly.int-spec.ts:66/79` INSERT succeeds / UPDATE DENIED | ✅ |
| **FILE** | Upload/download/delete private file | `files-service.int-spec.ts:142` "I1 — upload writes files(Private/Pending) + audit 'file'/FileUploaded…"; `:214` "I5 — download (policy ALLOW) returns short-TTL url…"; `file-access-hardening.int.spec.ts:375` "real HR/contract-linked file + in-scope viewer → GET /:id/download-url → 200"; `:397` "…out-of-scope viewer → GET /:id/download-url → 403 + deny-log"; `employee-file.int-spec.ts:421` "append-only (QA-06): mediaos_app UPDATE/DELETE of a file_access_logs row is DENIED" | ✅ |

No gap-test needed for backend — this WO adds **zero** new backend spec (§15.2 was survey-only, matching
the plan's §1 conclusion).

---

## §15.3 UI-state checklist — FE primitive/spec coverage

**Conclusion: majority COVERED already** by shared primitives + per-page specs. Fresh sweep at sign-off
time (not the plan's earlier snapshot): **183/202** FE spec files (`apps/app/src` + `packages/ui/src`)
assert at least one of skeleton/empty/forbidden/isError/retry.

| State (§15.3) | Shared primitive / mapping | Sample real spec citation |
| --- | --- | --- |
| **Loading** | `packages/ui/src/components/ui/skeleton.tsx` (`Skeleton`) | `skeleton.spec.tsx` (mount + `animate-pulse` class); consumer e.g. `EmployeeDetailPage.spec.tsx:186` "shows loading skeleton while fetching" |
| **Empty** | `packages/ui/src/components/ui/empty-state.tsx` (`EmptyState`) | `empty-state.spec.tsx` (title/description/action); consumer e.g. `EmployeeListPage.tsx` `emptyState={<EmptyState title={t("employees.empty.title")} …/>}` |
| **Forbidden** | `apps/app/src/routes/forbidden.tsx` (`ForbiddenPage`) — **now has a dedicated spec** (this WO, `forbidden.spec.tsx`) | Per-page gates already asserted forbidden independently, e.g. `EmployeeDetailPage.spec.tsx:120` "renders forbidden state when user lacks read:employee"; `TaskKanbanPage.spec.tsx:203` "renders forbidden state without view-kanban:task" |
| **Error / Validation / Conflict** | `packages/web-core/src/lib/api-error-kind.ts` (`mapStatusToErrorKind`) + `error-mapper.ts` (`mapApiErrorToUi`) | `api-error-kind.spec.ts:30` "409 → CONFLICT"; `:35` "422 với code='VALIDATION-ERR-001' → VALIDATION"; `error-mapper.spec.ts:41` "VALIDATION → FORM_ERRORS"; `:53` "CONFLICT → INLINE_ALERT" (→ `canRetry:true`); consumer e.g. `TaskKanbanPage.spec.tsx:265` "shows error state with retry on load failure" |
| **Success** | Inline `role="status" aria-live="polite"` banner (pattern used where a toast-style confirmation is needed) | `UserDetailPage.tsx:183-189` (2FA reset) + `UserDetailPage.spec.tsx:248` "resets 2FA after confirm and shows a success toast with revoked session count" |
| **Stale** | `WidgetCard` footer `lastUpdatedAt` (dashboard cache `last_updated_at`) | `WidgetCard.spec.tsx:91-103` "footer 'Cập nhật lúc' (last_updated_at, S4-FE-DASH-1-FIX)" — `lastUpdatedAt` present/`null`/`undefined` all asserted |
| **Scope empty** | Server pre-scopes the result set (RLS + data_scope) before the FE ever sees it — `EmptyState` renders the SAME generic empty message either way; distinguishing "empty because of your scope" vs "empty system-wide" is a BE-authority concern (§15.2 HR/ATT/LEAVE/TASK data-scope tests above), not a separate FE code path | n/a — by design (masking/scope is server's job per CLAUDE.md §5) |
| **Disabled** | `WidgetCard` quick-action `enabled`/`disabled_reason` | `WidgetCard.spec.tsx:125` "action disabled (enabled=false) → KHÔNG hiển thị" (with `disabled_reason` carried from server) |
| **Degraded** | `DashboardWidgetGrid` renders each widget independently — one widget's `status=Degraded` never crashes/hides siblings | `DashboardWidgetGrid.isolation.spec.tsx:125` "render KHÔNG throw/crash khi 1 widget Degraded nằm cạnh 1 widget Active"; `:138` "widget TASK_ALERTS (Degraded) hiển thị error state cục bộ — KHÔNG kéo theo lỗi ở MY_TASKS" |

---

## §15.4 Responsive/accessibility smoke — automated vs. manual

Per the plan's owner decision (§2): **"No new dep"** — `@testing-library/react` + `fireEvent` (no
`@testing-library/user-event`, no jest-axe/playwright/axe-core). Split honestly below: what is
jsdom-testable (keyboard/focus/role/aria) is automated; what needs a real browser/viewport
(layout reflow, computed contrast, actual reduced-motion rendering) is **manual/CSS-only** with the
reason stated, matching the plan's out-of-scope note.

| §15.4 item | Coverage | Automated? |
| --- | --- | --- |
| Screen reader — icon-only button has `aria-label` (P0 topbar) | **NEW** `GlobalTopbar.spec.tsx` — sweeps every rendered `<button>` (`toHaveAccessibleName()`), plus targeted assertions for mobile-menu/app-switcher/theme-toggle/notification-bell/home-link | ✅ automated |
| Keyboard — Esc closes modal/drawer (shared primitive) | **NEW** `sheet.spec.tsx` — `Sheet` (used by TaskDetailDrawer/ProjectFormDrawer/TaskFormDrawer) had zero prior spec; adds role=dialog/aria-modal/labelledby+describedby, Esc-close, and the untested "yields Esc to a nested Dialog/Popover" branch. `Dialog` (modal primitive) was **already** fully covered by pre-existing `dialog.spec.tsx` (role/aria/Esc/focus-trap/focus-return) — not duplicated here. `TaskDetailDrawer.spec.tsx` (pre-existing) already asserts "Esc đóng panel" at the consumer level | ✅ automated |
| Screen reader — 403 page has a heading + reason-specific message + actionable link | **NEW** `forbidden.spec.tsx` — single `<h1>`, message per `reason` enum (all 6 values), unknown-reason fallback, "Về trang chủ" link accessible name | ✅ automated |
| Tablet — horizontal table scroll | **NEW** (appended) `data-table.spec.tsx` — static proxy: `DataTable` (shared by every P0 list) wraps `<table>` in `.overflow-x-auto` | ✅ automated (structure only) |
| Desktop/Tablet/Mobile — actual responsive reflow at real viewport widths (sidebar collapse breakpoints, card-vs-table switch, sticky actions, touch-target size) | Tailwind breakpoint classes exist in the components (`md:`/`lg:`/`hidden … :block` — see `GlobalTopbar.tsx`, `ModuleWorkspaceLayout.tsx`) but jsdom has no layout engine — it cannot evaluate `@media` queries or actual box geometry | ⬜ **manual** — needs a real browser/viewport; owner explicitly declined browser tooling (plan §2/§4) |
| Focus — focus ring visible, focus trap in modal/drawer | Focus-trap Tab/Shift+Tab wrapping IS already unit-tested (`dialog.spec.tsx`, pre-existing) at the DOM-focus level; the **visual** focus ring (`outline`/`ring` CSS rendering) cannot be asserted in jsdom | Partial — trap logic ✅ automated; ring rendering ⬜ manual (CSS paint) |
| Contrast — status/error/warning not color-only | Design-token review (not a jsdom-testable property — computed contrast ratio requires real rendering) | ⬜ **manual** — documented as CSS/design-token concern, no automation added this WO |
| Reduced motion — UX not broken when animation is reduced | No `prefers-reduced-motion` branch found in app code (animations are plain Tailwind `transition-*`/`animate-pulse`, not gated by a JS media-query branch) — nothing to unit-test; degrading gracefully is a CSS property, not app logic | ⬜ **manual/CSS-only** — no JS branch exists to test; noted honestly rather than faked |
| `window.matchMedia` JS branch (theme) | `ThemeToggle`/`useTheme` DOES branch on `matchMedia` — already covered by pre-existing `packages/ui/src/hooks/use-theme.spec.ts`; the **new** `GlobalTopbar.spec.tsx` also mocks `matchMedia` (same pattern) so the topbar-level smoke has a deterministic `resolvedTheme` instead of relying on jsdom's fail-soft default | ✅ automated (pre-existing + reused in new spec) |

---

## Test run evidence (2026-07-25)

```text
# packages/ui — includes NEW sheet.spec.tsx + appended data-table.spec.tsx
$ pnpm --filter @mediaos/ui test
  Test Files  16 passed (16)
       Tests  98 passed (98)

# apps/app — includes NEW forbidden.spec.tsx + GlobalTopbar.spec.tsx
$ cd apps/app && npx vitest run --no-file-parallelism
  Test Files  197 passed (197)
       Tests  1493 passed (1493)

# Typecheck
$ pnpm --filter @mediaos/ui typecheck    # clean
$ pnpm --filter @mediaos/app typecheck   # clean
```

Note: one full-suite run without `--no-file-parallelism` hit a known flaky worker crash
(`ERR_IPC_CHANNEL_CLOSED` — see memory `vitest-worker-crash-chunked-runs`), unrelated to this WO's
changes; the `--no-file-parallelism` re-run above is clean.

## Carry-over / not in scope

- **Backend gap-test**: none — §15.2 is 10/10 covered by existing specs (survey-only WO).
- **Visual/viewport verification** (real responsive reflow, contrast ratios, reduced-motion rendering):
  manual, owner-declined browser tooling (axe/playwright) this round — see §15.4 table above for the
  exact reasoning per item. A future WO could add Playwright + axe-core if the product decides automated
  visual regression is worth the new dependency.
- **`Sheet` a11y** now matches `Dialog`'s coverage level; no other shared primitive was found with zero
  a11y coverage during this survey.

## Sign-off

§15.2 backend regression: **10/10 modules COVERED** (verified by opening each cited spec). §15.3 UI-state:
**majority COVERED** by shared primitives + 183/202 FE specs asserting state coverage; `ForbiddenPage` gap
closed this WO. §15.4 responsive/a11y: **net-new automated smoke added** (4 files/edits, no new
dependency) for everything jsdom can evaluate; remaining items honestly marked manual/CSS-only with
reasons. **S5-QA-REG-1: PASS.** — QA, 2026-07-25.
