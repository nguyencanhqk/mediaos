# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-12 01:12Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S4-INT-2` Tích hợp DASH cache invalidation từ event TASK/NOTI/ATT/LEAVE (POST /internal/v1/dashboard/cache/invalidate) — chỉ mã do producer thật phát (§11.5 reconcile)
- 🟢 `S4-FE-DASH-2` FE Dashboard widget mở rộng: AttendanceTodayWidget · PendingLeaveWidget · ProjectProgressWidget · HrOverviewWidget + DashboardTypeSwitcher (P1)
- 🟡 `S4-QA-1` QA Sprint 4 permission/data-scope + deny-path: TASK CRUD/assign/status · NOTI own-scope/mark-read · DASH widget visibility theo quyền (coverage ≥80%)
- 🟡 `S4-TASK-BE-5` BE TASK file (project/task) qua FileService + file_links + Project progress report (GET /projects/:id/report) — P1/P2 (IMP02-STORY-075/076)
- 🟢 `S4-FE-DASH-3` FE DashboardConfigPage (cấu hình widget theo role/user/dashboard-type: sort/enable/size) — P1/P2 (IMP02-STORY-091)
- 🔴 `HR-PERF-1` Tối ưu hiệu năng nền tảng: (a) code-split router theo module (bundle apps/app 1.55MB→lazy route) · (b) batch permission list HR (2 can()/row → canBatch preload company-grants + getObjectGrantsForMany, GIỮ NGUYÊN ngữ nghĩa object-DENY priority-1) · (c) pg_trgm GIN index search nhân sự khi headcount >1–2k — crown ở (b)
- 🔴 `HR-IDENTITY-READ-1` OWNER CHỐT: lộ identity_number/issue_date/issue_place (CCCD §14.18) qua read surface — cần gate RIÊNG cao hơn view-sensitive (vd view-identity:employee, seed per-pair + audit-on-reveal như salary) — hiện read DTO chủ đích KHÔNG chứa identity_*
- 🔴 `S4-INT-3` Tích hợp LEAVE → NOTI qua OutboxNotificationBridge (INT-1): event-type leave.request.{submitted,approved,rejected,cancelled,revoked} → NOTI intake, recipient §9.4 — hiện event LEAVE rơi im lặng, requester không được báo
- 🔴 `S4-INT-4` Tích hợp ATT → NOTI: bổ sung producer outbox trong ATT (adjustment submit/approve/reject · remote-work submit/approve/reject/cancel) + đăng ký event-type + recipient-resolver vào OutboxNotificationBridge — ATT hiện CHƯA phát event nào
- 🔴 `S4-INT-5` Tích hợp HR/AUTH → NOTI: HR tạo employee → activation/welcome notification (mảnh thiếu STORY-098) + AUTH password-reset-requested/account-locked → notify chủ tài khoản — producer HR/AUTH + đăng ký vào OutboxNotificationBridge

**CHỜ (kẹt phụ thuộc):**
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
- `S4-FE-TASK-4` FE TaskFilePanel (upload/list/download/delete theo quyền) + ProjectProgressCard (summary tiến độ) — P1/P2 (IMP02-STORY-075/076) ⏳ cần: S4-TASK-BE-5

**🛑 BLOCKED:**
- `S4-DASH-CATALOG-2` Bù đủ catalog widget DASH (11 widget còn lại của DB-07 §14.3) + reconcile mâu thuẫn nội bộ DB-07 §8.5 ↔ §14.3 + cặp refresh:dashboard-cache

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S5-DEVOPS-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-DASH-BE-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`

## Trạng thái repo

- **branch**: `feat/s5-fe-deploy-dispatch` · **file đang đổi (dirty)**: 3
- **migration head**: idx 172 — `0492_hr_profile_ui2_export_employee_sensitive` (173 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `fd6dd5d` | 2026-07-12 | feat(ci): workflow_dispatch cho Apps — Frontend CI (nghiệm pipeline FE + nút redeploy tay) |
| `0ac11f6` | 2026-07-12 | S5-DEVOPS-1: Staging/UAT readiness — migrate-from-empty verify + seed 4 tài khoản UAT + env formalize + runbook (#174) |
| `a868679` | 2026-07-11 | docs(claude): §5 — fixture giống-secret phải ghép chuỗi (tránh gitleaks generic-api-key false-block) + thủ tục quét net-diff/master trước khi --admin bypass (#172) |
| `9cda20d` | 2026-07-11 | wip(S4-FE-NOTI-3): FE Notification Delivery Logs read-only viewer (UI-NOTI-SCREEN-006) (#169) |
| `56c7641` | 2026-07-11 | wip(qagatelanedb): check.sh LOUD-detect + opt-in provision int-spec skip thieu LANE_DB (#170) |
| `47f4b3a` | 2026-07-11 | feat(foundation): S5-FND-JOBS-OBS-1 — GET /foundation/system-jobs observability (read-only, view:foundation-job) + SystemJobsPage (#171) |
| `a95badb` | 2026-07-11 | wip(qanoti1-permission-denypath): S4-QA-NOTI-1 — unified NOTI permission/own-scope/deny-path QA sign-off (RED-first) + gap fills (#167) |
| `85ee393` | 2026-07-11 | feat(int): S4-INT-1 — TASK→NOTI integration (OutboxNotificationBridge generic, 8 mã, §9.4 recipient, idempotent, zero-migration) 🔴 (#168) |
| `16b319c` | 2026-07-11 | auto/S4 FE NOTI 2 (#166) |
| `6dbbc74` | 2026-07-11 | test(qa): S4-QA-TASK-1 — QA TASK permission/data-scope + deny-path (canonical FSM + collab) (#165) |
| `b93b98e` | 2026-07-11 | auto/S4 FE DASH 1 (#164) |
| `993914c` | 2026-07-11 | feat(hr): HR-PROFILE-UI-2 — HR export (export:employee gate + data-scope + PII mask) + grouping/sort server-side (mig 0492) 🔴 (#163) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
