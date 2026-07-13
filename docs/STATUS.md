# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-13 01:55Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🟢 S4-FE-TASK-4 — FE TaskFilePanel (upload/list/download/delete theo quyền) + ProjectProgressCard (summary tiến độ) — P1/P2 (IMP02-STORY-075/076)
- **zone**: green · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/app/src/routes/**`, `apps/app/src/i18n/**`, `packages/web-core/src/lib/**`
- **phụ thuộc**: S4-TASK-BE-5✓, S4-FE-TASK-2✓
- **done_when (đích hội tụ)**:
  - [ ] TaskFilePanel trong TaskDetailPage: danh sách file + upload (progress) + download + xóa (confirm) — PermissionGate TASK.*.FILE_*; ProjectProgressCard trong ProjectDetailPage (task theo status/overdue/workload)
  - [ ] Tái dùng component upload/download; loading/error/empty; masking do server; web-core api getTaskFiles/uploadTaskFile/deleteTaskFile + getProjectReport
  - [ ] i18n vi + FE spec gating
  - [ ] check.sh xanh; LIGHT gate (react-reviewer + quality-gate)

### 🔴 HR-PERF-1 — Tối ưu hiệu năng nền tảng: (a) code-split router theo module (bundle apps/app 1.55MB→lazy route) · (b) batch permission list HR (2 can()/row → canBatch preload company-grants + getObjectGrantsForMany, GIỮ NGUYÊN ngữ nghĩa object-DENY priority-1) · (c) pg_trgm GIN index search nhân sự khi headcount >1–2k — crown ở (b)
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/app/src/router.tsx`, `apps/api/src/permission/**`, `apps/api/src/employees/**`, `apps/api/migrations/**`, `docs/plans/HR-PERF-1.md`
- **phụ thuộc**: HR-PROFILE-UI-1✓
- **done_when (đích hội tụ)**:
  - [ ] (a) route-level lazy: mở màn HR không tải bundle TASK/LEAVE/ATT; initial JS giảm đo được (ghi số trước/sau vào PR); không đổi route path/permission gate
  - [ ] (b) PermissionService.canBatch (hoặc tương đương) cho hr-read list: kết quả BẰNG CHÍNH XÁC per-row can() trên bộ test có object-ALLOW lẫn object-DENY; deny-path giữ nguyên; số query permission/trang ≤ 4
  - [ ] (c) migration GIN pg_trgm (users.full_name/email + employee_profiles.employee_code) CHỈ khi owner bật (dữ liệu lớn) — kèm EXPLAIN trước/sau trong PR; FULL gate security-reviewer cho (b)

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S4-QA-2` QA Sprint 4 E2E + regression sign-off: flow task→noti→dash (§15.1) + notification deep link + dashboard degraded + regression S0–S3
- 🔴 `HR-IDENTITY-READ-1` Lộ identity_number/issue_date/issue_place (CCCD §14.18) qua read surface — OWNER ĐÃ CHỐT 2026-07-12: cặp MỚI view-identity:employee (is_sensitive) + inline detail + audit-on-reveal mirror salary, KHÔNG role-grant sẵn
- 🟡 `S4-NOTI-BE-5` NOTI admin templates LIST: GET /notifications/templates (filter event/channel/locale, company override ∪ global) — mở lại scope gốc NOTI-API-303 đã 'thu hẹp', mở đường FE NOTI-SCREEN-006

**CHỜ (kẹt phụ thuộc):**
- `S5-QA-E2E-1` Integration freeze + system smoke P0 + cross-module E2E: login→Home Portal→module workspace→check-in→nghỉ phép→task→notification→dashboard (WS-B/C) ⏳ cần: S4-QA-2
- `S5-BE-CONTRACT-1` API contract & OpenAPI/Swagger chuẩn hoá theo module + FE integration hardening (401/403/422/500 mapping, request-id, idempotency, query invalidation sau mutation) — WS-D ⏳ cần: S4-QA-2
- `S5-SEC-1` Permission & data-scope hardening + field-level/export permission + security testing (IDOR, file access, sensitive fields, rate-limit auth) — WS-E, crown ⏳ cần: S4-QA-2
- `S5-QA-REG-1` QA regression suite MVP (test-case matrix theo module × role) + UI state hardening + responsive/accessibility smoke — WS-F ⏳ cần: S4-QA-2
- `S5-QA-DASHNOTI-1` Dashboard & Notification hardening: widget degraded/cache đúng, unread count chính xác, deep link an toàn, invalidation theo event — WS-G ⏳ cần: S4-QA-2
- `S5-PERF-1` Performance/reliability smoke + observability baseline: SLA danh sách nhân viên·bảng công·task·notification·dashboard + logging/monitoring/alerting — WS-H ⏳ cần: S4-QA-2
- `S5-UAT-1` UAT prep + run (script theo role · test data · sign-off) + release readiness checklist + known issues/release notes nội bộ — gate vào Sprint 6 ⏳ cần: S5-QA-E2E-1, S5-QA-REG-1, S5-SEC-1
- `S6-GOV-1` Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đổi sau freeze, RC governance (WS1) ⏳ cần: S5-UAT-1
- `S6-STAB-1` Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation) + fix P0/P1 + daily triage (WS2) ⏳ cần: S5-UAT-1
- `S6-QA-FINAL-1` QA final pass: regression + E2E + API contract + regression-theo-role + UAT final + điều kiện sign-off (WS3) ⏳ cần: S6-STAB-1
- `S6-SEC-1` Security / RBAC / Data-Protection final hardening: auth/session · RBAC · field masking · file access · audit · secret/config review (WS4) — crown ⏳ cần: S6-STAB-1
- `S6-PERF-DB-1` Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (index, query perf, backup/restore rehearsal) — WS5/WS6 ⏳ cần: S6-STAB-1
- `S6-REL-1` Release Candidate build + release notes + Go-live runbook + deployment/rollback rehearsal + monitoring/alerting/support readiness (WS7/WS8/WS9) — crown release ⏳ cần: S6-QA-FINAL-1, S6-SEC-1, S6-PERF-DB-1
- `S6-GOLIVE-1` Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/support guide · known issues · post-go-live backlog) — WS10 ⏳ cần: S6-REL-1
- `S4-FE-NOTI-4` FE Notification Templates admin (NOTI-SCREEN-006 / UI-NOTI-SCREEN-005): bảng template theo event + editor title/body — gate view/update:notification-template (đã allowlisted); kèm mở đường vào sidebar cho templates + delivery-logs ⏳ cần: S4-NOTI-BE-5

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S5-DEVOPS-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 7
- **migration head**: idx 173 — `0493_s4_dashcatalog2_widget_catalog_9` (174 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `a5b2894b` | 2026-07-13 | feat(fe): hệ theme light/dark dùng chung + thống nhất cuộn app-frame (#187) |
| `f6a00547` | 2026-07-12 | feat(int): S4-INT-3 — LEAVE → NOTI qua bridge INT-1, recipient theo SPEC-05 §19.1/§14.19 🔴 (#185) |
| `68227f97` | 2026-07-12 | feat(dash): S4-FE-DASH-3 — DashboardConfigPage + phơi capability dashboard-config qua allowlist 🔴(phần allowlist) (#186) |
| `ad4cdbd0` | 2026-07-12 | feat(task): S4-TASK-BE-5 — file surface canonical /tasks/:id/files + khóa legacy /attachments (410) + project report (#184) |
| `fc33165f` | 2026-07-12 | chore(harness): bake plan-block wave-2A — S4-INT-3 recipient theo SPEC-05 §19.1/§14.19 (rẽ nhánh fromStatus, 2 producer cancelled) + S4-TASK-BE-5 OWNER chốt SUPERSEDE khóa route legacy /attachments (lỗ đọc-rộng in-tenant) (#182) |
| `3c8a1758` | 2026-07-12 | feat(int): S4-INT-5 — HR/AUTH → NOTI (activation/welcome + password-reset + account-locked) 🔴 (#181) |
| `99192838` | 2026-07-12 | feat(int): S4-INT-4 — ATT → NOTI producer outbox + bridge (7 hành động) 🔴 [thay #179] (#183) |
| `c67779f6` | 2026-07-12 | S4-QA-1: QA Sprint 4 permission/data-scope + deny-path (TASK/NOTI/DASH) — FULL gate PASS (#180) |
| `db8f0811` | 2026-07-12 | chore(harness): chốt owner-decision HR-IDENTITY-READ-1 + regen STATUS + plan docs tồn đọng (#176) |
| `6571f705` | 2026-07-12 | auto/S4 INT 2 (#178) |
| `76ecd42c` | 2026-07-12 | wip(S4-FE-DASH-2): 4 widget dashboard P1 + DashboardTypeSwitcher (#177) |
| `d10b80df` | 2026-07-12 | feat(ci): workflow_dispatch cho Apps — Frontend CI (nghiệm pipeline FE + nút redeploy tay) (#175) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
