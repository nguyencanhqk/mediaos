# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-11 01:11Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S4-TASK-BE-3 — BE Task assignment + status workflow FSM (assign/đổi assignee, add/remove watcher, POST /:id/status transition hợp lệ, priority/deadline) — crown FSM, activity log, phát event NOTI
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/tasks/**`, `apps/api/test/integration/**`, `packages/contracts/src/**`, `docs/plans/S4-TASK-BE-3.md`
- **phụ thuộc**: S4-TASK-BE-2✓
- **done_when (đích hội tụ)**:
  - [ ] POST /tasks/:id/assign (giao/đổi assignee chính) · POST/DELETE /:id/watchers · POST /:id/status · POST /:id/priority · POST /:id/deadline — @RequirePermission đúng cặp; chỉ gán người trong scope/project; cảnh báo (không chặn cứng MVP) nếu assignee đang nghỉ phép duyệt
  - [ ] FSM status hợp lệ: Todo→In Progress→In Review→Done/Cancelled (transition table tường minh, chặn nhảy trạng thái sai → mã lỗi SPEC-06); Done có thể đòi checklist hoàn thành nếu config bật; ghi task_activity_logs TASK_ASSIGNED/STATUS_CHANGED/PRIORITY_CHANGED/DUE_DATE_CHANGED
  - [ ] Phát event chuẩn qua outbox theo Event code registry §9.5 (TASK_ASSIGNED/TASK_ASSIGNEE_CHANGED/TASK_STATUS_CHANGED/TASK_PRIORITY_CHANGED/TASK_DUE_DATE_CHANGED) — payload KHÔNG chứa dữ liệu nhạy cảm; wiring consumer thực ở S4-INT-1
  - [ ] Int-spec RED-trước: transition không hợp lệ → 4xx + không đổi state · gán ngoài scope/tenant → deny · watcher trùng bị chặn · actor không tự nhận notify (chuẩn bị INT) · activity log ghi đúng; FULL gate security-reviewer + plan-reviewer PASS trước code (crown)
  - [ ] GHI CHÚ ACCEPTANCE (plan-review 2026-07-11 OQ#1, PR #150): route THỰC = POST /:id/change-status · /change-priority · /change-deadline (verb canonical SPEC-06 §16.3/API-06 §14 — done_when dòng 1 là shorthand); watcher SELF-ONLY (không nhận employee_id body); QA map test theo tên canonical, KHÔNG báo lệch.

### 🔴 S4-DASH-BE-1 — BE Dashboard resolver (GET /dashboard/me, /types, /:type) + widget registry + permission/scope gate — crown data-scope
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/dashboard/**`, `apps/api/test/integration/**`, `packages/contracts/src/**`, `docs/plans/S4-DASH-BE-1.md`
- **phụ thuộc**: S4-DASH-SEED-1✓
- **done_when (đích hội tụ)**:
  - [ ] GET /api/v1/dashboard/me (resolve dashboard mặc định theo permission user) · GET /dashboard/types (type được xem) · GET /dashboard/:type — trả widget allowed theo permission + user context; KHÔNG hard-code dashboard theo role (dựa dashboard_widget_configs)
  - [ ] Widget registry service: chỉ trả widget mà user có required_permission; widget nhạy cảm kiểm CẢ permission DASH lẫn permission module nguồn; mọi query filter company_id
  - [ ] DTO contracts dual-build; envelope API-01; widget list có limit
  - [ ] Int-spec RED-trước: employee KHÔNG thấy widget Manager/HR · cross-tenant deny · dashboard/me trả đúng type theo quyền; FULL gate security-reviewer + plan-reviewer PASS trước code (crown)

### 🟢 S4-FE-TASK-CLEANUP-1 — Gỡ/chuyển tasksApi legacy (web-core tasks-api.ts) — code chết gọi GET /tasks shape cũ sau BREAKING PR #145 (my-tasks → /tasks/my)
- **zone**: green · **skills**: code-review
- **sửa ở đâu (paths)**: `packages/web-core/src/lib/**`, `packages/web-core/src/index.ts`
- **done_when (đích hội tụ)**:
  - [ ] Quét lại consumer 3 app (app/console/auth) + packages chứng minh 0 import tasksApi/tasks-api (mirror quy trình PR #140); nếu phát hiện consumer sống → DỪNG, báo người
  - [ ] Gỡ packages/web-core/src/lib/tasks-api.ts + tasks-api.spec.ts + export ở barrel (nếu có); HOẶC nếu S4-FE-TASK-2 đã cần client thì thay bằng taskCoreApi theo GET /tasks/my + DTO taskCore* contracts — KHÔNG giữ shape cũ
  - [ ] pnpm --filter @mediaos/web-core build + test xanh; typecheck 3 app xanh (chứng minh không còn tham chiếu); LIGHT gate

### 🟡 S5-DEVOPS-1 — Staging/UAT readiness: env + deploy pipeline + migration/seed chạy từ DB trống + test account đủ role (Employee/Manager/HR/Admin/Super Admin) — đối chiếu topology PROD/DEV-ONLINE đang chạy
- **zone**: yellow · **skills**: code-review
- **sửa ở đâu (paths)**: `.github/workflows/**`, `docker-compose.yml`, `.env.example`, `scripts/**`, `mediaos.ps1`, `docs/plans/S5-DEVOPS-1.md`
- **done_when (đích hội tụ)**:
  - [ ] Staging/UAT env có URL ổn định (đối chiếu topology PROD + DEV-ONLINE đang chạy: NSSM API + cloudflared tunnel + Pages — ghi rõ cái nào là staging/UAT, không dựng trùng); pipeline deploy BE+FE chạy được
  - [ ] Migration + seed chạy sạch từ DB trống (0000→head) trên env staging; test account đủ 5 role có sẵn (seed hoặc script), không secret thật trong repo
  - [ ] Checklist môi trường IMPLEMENTATION-08 §10.3 đạt; Known Blockers ghi rõ nếu READY-001..008 chưa đủ
  - [ ] check.sh xanh; LIGHT gate

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S4-TASK-BE-5` BE TASK file (project/task) qua FileService + file_links + Project progress report (GET /projects/:id/report) — P1/P2 (IMP02-STORY-075/076)

**CHỜ (kẹt phụ thuộc):**
- `S4-TASK-BE-4` BE Kanban (board + move) + comment/mention + checklist + activity log (GET /projects/:id/kanban, POST /:id/move, comments CRUD, checklists/items, GET /:id/activity) — P1 ⏳ cần: S4-TASK-BE-3
- `S4-NOTI-SEED-2` Vá catalog notification_events khớp registry §9.5 cho event TASK (BE-3): thêm TASK_PRIORITY_CHANGED · đổi TASK_DEADLINE_CHANGED→TASK_DUE_DATE_CHANGED · template + enable TASK_ASSIGNEE_CHANGED — BẮT BUỘC TRƯỚC S4-INT-1 ⏳ cần: S4-TASK-BE-3
- `S4-DASH-CATALOG-2` Bù đủ catalog widget DASH (11 widget còn lại của DB-07 §14.3) + reconcile mâu thuẫn nội bộ DB-07 §8.5 ↔ §14.3 + cặp refresh:dashboard-cache ⏳ cần: S4-DASH-BE-2
- `S4-DASH-BE-2` BE Widget data services (GET /dashboard/widgets, /widgets/:slug) cho 7 widget In-sprint + cache TTL + degraded state — data-scope + module nguồn permission ⏳ cần: S4-DASH-BE-1
- `S4-INT-1` Tích hợp TASK → NOTI: wiring event producer (outbox) → consumer intake, tạo notification đúng recipient cho mọi event TASK/PROJECT — E2E task→noti — crown ⏳ cần: S4-TASK-BE-3, S4-TASK-BE-4, S4-NOTI-SEED-2
- `S4-INT-2` Tích hợp DASH cache invalidation từ event TASK/NOTI/ATT/LEAVE (POST /internal/v1/dashboard/cache/invalidate) — chỉ mã do producer thật phát (§11.5 reconcile) ⏳ cần: S4-DASH-BE-2, S4-INT-1
- `S4-FE-TASK-2` FE Task screens: TaskListPage · MyTasksPage · TaskDetailPage · TaskFormDrawer · TaskAssignControl · TaskStatusSelect (P0) ⏳ cần: S4-TASK-BE-3
- `S4-FE-TASK-3` FE Task collaboration: TaskKanbanPage (drag-drop) · TaskCommentThread (mention) · TaskChecklistPanel · TaskActivityTimeline (P1) ⏳ cần: S4-TASK-BE-4, S4-FE-TASK-2
- `S4-FE-DASH-1` FE Dashboard shell + P0 widgets: DashboardMePage · DashboardWidgetGrid · WidgetCard · MyTasksWidget · TaskAlertsWidget · NotificationsWidget (P0) ⏳ cần: S4-DASH-BE-2
- `S4-FE-DASH-2` FE Dashboard widget mở rộng: AttendanceTodayWidget · PendingLeaveWidget · ProjectProgressWidget · HrOverviewWidget + DashboardTypeSwitcher (P1) ⏳ cần: S4-DASH-BE-2, S4-FE-DASH-1
- `S4-QA-1` QA Sprint 4 permission/data-scope + deny-path: TASK CRUD/assign/status · NOTI own-scope/mark-read · DASH widget visibility theo quyền (coverage ≥80%) ⏳ cần: S4-TASK-BE-4, S4-DASH-BE-2
- `S4-QA-2` QA Sprint 4 E2E + regression sign-off: flow task→noti→dash (§15.1) + notification deep link + dashboard degraded + regression S0–S3 ⏳ cần: S4-INT-2, S4-FE-DASH-2, S4-QA-1
- `S5-QA-E2E-1` Integration freeze + system smoke P0 + cross-module E2E: login→Home Portal→module workspace→check-in→nghỉ phép→task→notification→dashboard (WS-B/C) ⏳ cần: S4-QA-2
- `S5-BE-CONTRACT-1` API contract & OpenAPI/Swagger chuẩn hoá theo module + FE integration hardening (401/403/422/500 mapping, request-id, idempotency, query invalidation sau mutation) — WS-D ⏳ cần: S4-QA-2
- `S5-SEC-1` Permission & data-scope hardening + field-level/export permission + security testing (IDOR, file access, sensitive fields, rate-limit auth) — WS-E, crown ⏳ cần: S4-QA-2
- `S5-QA-REG-1` QA regression suite MVP (test-case matrix theo module × role) + UI state hardening + responsive/accessibility smoke — WS-F ⏳ cần: S4-QA-2
- `S5-QA-DASHNOTI-1` Dashboard & Notification hardening: widget degraded/cache đúng, unread count chính xác, deep link an toàn, invalidation theo event — WS-G ⏳ cần: S4-QA-2, S4-INT-2
- `S5-PERF-1` Performance/reliability smoke + observability baseline: SLA danh sách nhân viên·bảng công·task·notification·dashboard + logging/monitoring/alerting — WS-H ⏳ cần: S4-QA-2
- `S5-UAT-1` UAT prep + run (script theo role · test data · sign-off) + release readiness checklist + known issues/release notes nội bộ — gate vào Sprint 6 ⏳ cần: S5-QA-E2E-1, S5-QA-REG-1, S5-SEC-1
- `S6-GOV-1` Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đổi sau freeze, RC governance (WS1) ⏳ cần: S5-UAT-1
- `S6-STAB-1` Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation) + fix P0/P1 + daily triage (WS2) ⏳ cần: S5-UAT-1
- `S6-QA-FINAL-1` QA final pass: regression + E2E + API contract + regression-theo-role + UAT final + điều kiện sign-off (WS3) ⏳ cần: S6-STAB-1
- `S6-SEC-1` Security / RBAC / Data-Protection final hardening: auth/session · RBAC · field masking · file access · audit · secret/config review (WS4) — crown ⏳ cần: S6-STAB-1
- `S6-PERF-DB-1` Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (index, query perf, backup/restore rehearsal) — WS5/WS6 ⏳ cần: S6-STAB-1
- `S6-REL-1` Release Candidate build + release notes + Go-live runbook + deployment/rollback rehearsal + monitoring/alerting/support readiness (WS7/WS8/WS9) — crown release ⏳ cần: S6-QA-FINAL-1, S6-SEC-1, S6-PERF-DB-1
- `S6-GOLIVE-1` Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/support guide · known issues · post-go-live backlog) — WS10 ⏳ cần: S6-REL-1
- `S4-FE-TASK-4` FE TaskFilePanel (upload/list/download/delete theo quyền) + ProjectProgressCard (summary tiến độ) — P1/P2 (IMP02-STORY-075/076) ⏳ cần: S4-TASK-BE-5, S4-FE-TASK-2
- `S4-DASH-BE-3` BE Dashboard widget config CRUD (GET /dashboard/configs, PATCH /configs/:id) theo company/role/user/dashboard-type + audit — P1/P2 (IMP02-STORY-091) ⏳ cần: S4-DASH-BE-1
- `S4-FE-DASH-3` FE DashboardConfigPage (cấu hình widget theo role/user/dashboard-type: sort/enable/size) — P1/P2 (IMP02-STORY-091) ⏳ cần: S4-DASH-BE-3, S4-FE-DASH-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S3-ATT-EXPORT-1`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 1
- **migration head**: idx 167 — `0487_s4_notibe4_admin_config_grant` (168 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `f90e9ba` | 2026-07-11 | feat(noti): S4-NOTI-BE-4 admin config WRITE — mig 0487 GRANT INSERT,UPDATE + PATCH events/templates (company-override) + audit (#149) |
| `227720c` | 2026-07-11 | chore(harness): backlog S4-TASK-BE-2 + S4-FE-TASK-1 done (PR #145/#146) + mở WO S4-FE-TASK-CLEANUP-1 (gỡ tasksApi chết sau BREAKING GET /tasks) + regen STATUS (#147) |
| `e58a4eb` | 2026-07-11 | feat(task-fe): Project screens (List/Detail/Form/Member) trong apps/app [S4-FE-TASK-1] (#146) |
| `abc0a6a` | 2026-07-11 | feat(task): BE Task CRUD + My-tasks + filter (SPEC-06) [S4-TASK-BE-2] (#145) |
| `a1683f7` | 2026-07-11 | chore(harness): regen STATUS sau #142-#144 (NOTI-BE-3 partial · RECON-2 · TASK-BE-1) + ledger chốt SEED-1/BE-3 |
| `dd9379b` | 2026-07-10 | feat(task): BE Project CRUD + close/delete mềm + quản lý member (SPEC-06) [S4-TASK-BE-1] (#144) |
| `b14b235` | 2026-07-10 | feat(task-recon): CONTRACT pair-drift TASK — gỡ grant legacy comment:comment khỏi employee + company-admin (mig 0486) [S4-TASK-RECON-2] 🔴 (#143) |
| `78643ee` | 2026-07-10 | feat(noti): S4-NOTI-BE-3 partial — admin config GET + reminder job TASK_DUE_SOON/OVERDUE · mở WO S4-NOTI-BE-4 (#142) |
| `608b008` | 2026-07-10 | feat(task-seed): seed 23 mã permission TASK + grant ma trận SPEC-06 §9 (mig 0485) [S4-TASK-SEED-1] 🔴 (#141) |
| `e4e326f` | 2026-07-10 | chore(fe): gỡ dứt điểm NotificationBell (@mediaos/ui) + notificationApi legacy (web-core) — code chết trỏ route BE đã xoá ở PR #133 (S4-FE-NOTI-CLEANUP-1) (#140) |
| `fec4463` | 2026-07-10 | fix(cli): thêm MIGRATE vào menu + in rõ DB đích trước khi migrate (#132) |
| `ad380b0` | 2026-07-10 | test(web-core): vá flake api-client.spec — 1 loadFresh cho 4 kịch bản refresh-fail (#139) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
