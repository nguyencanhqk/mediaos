# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-22 03:55Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

_Không có item in_progress._ Chọn 1 item READY bên dưới → đặt `status` = in_progress trong backlog.mjs.

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S5-QA-E2E-1` Integration freeze + system smoke P0 + cross-module E2E: login→Home Portal→module workspace→check-in→nghỉ phép→task→notification→dashboard (WS-B/C)
- 🟡 `S5-BE-CONTRACT-1` API contract & OpenAPI/Swagger chuẩn hoá theo module + FE integration hardening (401/403/422/500 mapping, request-id, idempotency, query invalidation sau mutation) — WS-D
- 🔴 `S5-SEC-1` Permission & data-scope hardening + field-level/export permission + security testing (IDOR, file access, sensitive fields, rate-limit auth) — WS-E, crown
- 🟡 `S5-QA-REG-1` QA regression suite MVP (test-case matrix theo module × role) + UI state hardening + responsive/accessibility smoke — WS-F
- 🟡 `S5-QA-DASHNOTI-1` Dashboard & Notification hardening: widget degraded/cache đúng, unread count chính xác, deep link an toàn, invalidation theo event — WS-G
- 🟡 `S5-PERF-1` Performance/reliability smoke + observability baseline: SLA danh sách nhân viên·bảng công·task·notification·dashboard + logging/monitoring/alerting — WS-H
- 🔴 `S5-LEAVE-DEADCODE-1` Dọn khối LeaveService chết (createRequest/approveRequest/rejectRequest/cancelRequest + CreateLeaveRequestDto/createLeaveRequestSchema) — di sản G11 còn sót sau rebuild SPEC-05 Sprint 3, không route HTTP nào tới được
- 🔴 `S5-SEQ-HARDEN-1` Gia cố cấp mã tuần tự: SAVEPOINT cho recovery 23505 (ensure-on-miss race hiện trả 500 do 25P02), allocate sau authz tầng-service (chống đốt counter), phân biệt constraint khi map unique-violation
- 🟢 `S5-GOAL-DOC-1` Docs sync SPEC-10 GOAL: SPEC-01/PRD-00/DB-01·09·10 ghi nhận GOAL + API-12 GOAL stub + permission-matrix 8 cặp + nav header 9 SPEC cũ + ghi chú DB-06 (tasks.goal_id, task_templates kích hoạt)
- 🔴 `S5-GOAL-BE-1` BE GoalsModule: CRUD 3 cấp + cây theo kỳ + data-scope service-layer (own/department/all) + validate level↔neo↔parent + goal_code qua sequence_counters
- 🔴 `S5-GOAL-DB-2` Đợt D — Schema + migration task_templates + task_template_items + RLS FORCE + seed cặp ('manage','task-template') + UNION-ADD 'task_template' audit CHECK (số cũ 0508 ĐÃ BỊ CHIẾM bởi lms_access; 0509 dự kiến cho S5-LMS-DB-1 — kiểm _journal lấy số kế lúc chạy, DO-block cộng dồn KHÔNG rewrite CHECK từ snapshot cũ)
- 🔴 `S5-FND-REVOKE-1` Nợ di sản G-era (finding MEDIUM gate S5-GOAL-DB-1): REVOKE DELETE org_units + projects khỏi app role — chặn cửa cascade-xoá goals/goal_updates vòng qua soft-delete (expand-contract 2 release nếu còn caller)
- 🔴 `S5-LMS-DB-1` Mig 0509 (kiểm _journal trước khi đánh số): UNION-ADD audit object_type 'lms_sso' + 'lms_sync' vào CHECK audit_logs + cập nhật AUDIT_OBJECT_TYPES union TS cùng commit
- 🟡 `S5-LMS-APP-1` LOCAL apps/lms — chuẩn hoá UI: '/' hết landing (có phiên → /course, chưa → /login), /course = giao diện chính (SSO next + sau-login đều về /course), /dashboard relabel 'Khoá học của tôi', sidebar sắp lại (Course đầu, ẨN khu HR placeholder employee/salary/benefits/uniform/assets), admin giữ nguyên theo permission

**CHỜ (kẹt phụ thuộc):**
- `S5-UAT-1` UAT prep + run (script theo role · test data · sign-off) + release readiness checklist + known issues/release notes nội bộ — gate vào Sprint 6 ⏳ cần: S5-QA-E2E-1, S5-QA-REG-1, S5-SEC-1
- `S6-GOV-1` Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đổi sau freeze, RC governance (WS1) ⏳ cần: S5-UAT-1
- `S6-STAB-1` Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation) + fix P0/P1 + daily triage (WS2) ⏳ cần: S5-UAT-1
- `S6-QA-FINAL-1` QA final pass: regression + E2E + API contract + regression-theo-role + UAT final + điều kiện sign-off (WS3) ⏳ cần: S6-STAB-1
- `S6-SEC-1` Security / RBAC / Data-Protection final hardening: auth/session · RBAC · field masking · file access · audit · secret/config review (WS4) — crown ⏳ cần: S6-STAB-1
- `S6-PERF-DB-1` Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (index, query perf, backup/restore rehearsal) — WS5/WS6 ⏳ cần: S6-STAB-1
- `S6-REL-1` Release Candidate build + release notes + Go-live runbook + deployment/rollback rehearsal + monitoring/alerting/support readiness (WS7/WS8/WS9) — crown release ⏳ cần: S6-QA-FINAL-1, S6-SEC-1, S6-PERF-DB-1
- `S6-GOLIVE-1` Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/support guide · known issues · post-go-live backlog) — WS10 ⏳ cần: S6-REL-1
- `S5-GOAL-BE-2` BE progress engine 4 mode + rollup bubble + job đối soát đêm (system-jobs) + check-in/finalize/reopen (ledger goal_updates) + link/unlink task↔goal + NOTI GOAL_ASSIGNED/GOAL_FINALIZED qua bridge đã ship ⏳ cần: S5-GOAL-BE-1
- `S5-GOAL-FE-1` FE trang Mục tiêu: menu sidebar riêng + danh sách/cây theo kỳ·phòng ban + form tạo/sửa (chọn cấp → đúng field neo, chọn mode đo) + màn chi tiết 4 tab — PermissionGate GOAL.*, i18n vi ⏳ cần: S5-GOAL-BE-1
- `S5-GOAL-FE-2` FE vòng đo: check-in modal + lịch sử + nút chốt kỳ/mở lại + gắn goal từ panel task + tab Công việc trong goal (bulk link) + khối 'Mục tiêu của tôi' trong /me ⏳ cần: S5-GOAL-BE-2, S5-GOAL-FE-1
- `S5-GOAL-TPL-1` Đợt D — Phân rã mục tiêu từ template: CRUD template (BE+FE, GOAL-SCREEN-006) + wizard preview sửa/xóa/thêm/gán người/cột board + POST /goals/:id/decompose tạo bulk task 1 transaction ⏳ cần: S5-GOAL-DB-2, S5-GOAL-FE-2
- `S5-GOAL-DASH-1` Đợt E — Widget dashboard 'Mục tiêu kỳ này' (progress theo phòng ban, đọc cache) + hàng mục tiêu trong trang phòng ban ⏳ cần: S5-GOAL-BE-2, S5-GOAL-FE-1
- `S5-LMS-BE-1` Auto-sync tài khoản MediaOS→LMS: outbox event RIÊNG hr.employee_status_changed dùng CHUNG cho cả HrWriteService.changeStatus LẪN đường admin khoá/mở user (CẤM re-emit auth.user_locked — đã có consumer notification + sẽ lan auto-lock tạm thời sang LMS) + LmsUserSyncBridge (EventBus, KHÔNG qua OutboxNotificationBridge) + job đối soát @SystemJobHandler LMS_USER_SYNC + env LMS_SYNC_TOKEN + audit 'lms_sync' ⏳ cần: S5-LMS-DB-1
- `S5-LMS-BE-2` Trả nợ audit #253: ghi audit_logs objectType 'lms_sso' action sso_link_minted tại GET /integrations/lms/sso-link (objectId=jti, KHÔNG log token/secret) ⏳ cần: S5-LMS-DB-1
- `S5-LMS-APP-2` LOCAL apps/lms — SSO-only: cờ env SSO_ONLY=true → đóng register/forgot/reset/resend-otp (route redirect + API 403), /login chỉ còn nút 'Đăng nhập qua MediaOS' ({MEDIAOS_APP_URL}/lms), break-glass ADMIN_EMAILS vẫn login mật khẩu; audit consume SSO → admin_audit_log. LÀM CUỐI WAVE ⏳ cần: S5-LMS-BE-1, S5-LMS-APP-3
- `S5-LMS-APP-3` LOCAL apps/lms — API export tiến độ: GET /api/mediaos/progress?email= Bearer MEDIAOS_SYNC_TOKEN (tái dùng bearerMatches sync-users) → enrollment + % hoàn thành/course + learning time + điểm quiz/exam; cap kích thước + không lộ dữ liệu user khác ⏳ cần: S5-LMS-APP-1
- `S5-LMS-BE-3` Proxy tiến độ đào tạo vào MediaOS: GET /me/training (email resolve TỪ TOKEN — không nhận param, mirror SPEC-09 §14.4) gọi LMS /api/mediaos/progress, cache ngắn ~60s, gate access:lms, contracts Zod ⏳ cần: S5-LMS-APP-3
- `S5-LMS-FE-1` FE /me: card 'Đào tạo' trong MeOverviewPage (fail-soft như 5 section hiện có) + trang /me/training (danh sách khoá + % + thời lượng + nút 'Mở LMS' → /lms) + sidebar entry, gate access:lms, i18n vi ⏳ cần: S5-LMS-BE-3

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S4-QA-2`, `S5-DEVOPS-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-FE-TASK-4`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `HR-PERF-1`, `HR-IDENTITY-READ-1`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-NOTI-BE-5`, `S4-FE-NOTI-4`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`, `S5-ME-DOC-1`, `S5-ME-DB-1`, `S5-ME-BE-1`, `S5-ME-BE-2`, `S5-ME-BE-3`, `S5-ME-FE-1`, `S5-ME-FE-2`, `S5-ME-FE-3`, `S5-ME-QA-1`, `S5-HR-LINKUI-1`, `S5-HR-IMPORT-BE-1`, `S5-HR-IMPORT-FE-1`, `S5-HR-ORGCHART-BE-1`, `S5-HR-ORGCHART-FE-1`, `S5-HR-WORKINFO-1`, `S5-FE-TASK-NAV-1`, `S5-TASK-BE-6`, `S5-FE-TASK-5`, `S5-FE-TASK-6`, `S5-LEAVE-HOLIDAYS-MOVE-1`, `S5-NOTI-FIX-1`, `S5-NOTI-FIX-2`, `S5-TASK-HRCODE-1`, `S5-TASK-PIPELINE-1`, `S5-TASK-NAV-TREE-1`, `S5-TASK-WORKSPACE-1`, `S5-TASK-DETAIL-1`, `S5-TASK-SUBTASK-1`, `S5-DASH-TASKSTATUS-FIX-1`, `S5-TASK-PROJROLE-1`, `S5-TASK-BOARD-UX-1`, `S5-TASK-INLINE-1`, `S5-TASK-AVATAR-1`, `S5-TASK-CARDSUB-1`, `S5-TASK-MOVEPROJ-1`, `S5-TASK-COVER-1`, `S5-GOAL-DB-1`, `S5-BRAND-BE-1`, `S5-BRAND-FE-1`, `S5-BRAND-FE-2`

## Trạng thái repo

- **branch**: `feat/s5-brand-be-1` · **file đang đổi (dirty)**: 0
- **migration head**: idx 188 — `0508_lms_access_permission` (189 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `9662fd93` | 2026-07-22 | feat(brand): áp thương hiệu ra vỏ app — logo topbar + favicon động + sửa favicon tĩnh vỡ [S5-BRAND-FE-2] |
| `56fb0139` | 2026-07-22 | feat(brand): FE khối "Thương hiệu" ở /system/company + dọn ô logo URL thô ở console [S5-BRAND-FE-1] |
| `49957bf5` | 2026-07-22 | fix(brand): đóng 5 phát hiện security-review S5-BRAND-BE-1 (verdict BLOCK → sửa) |
| `5d79b966` | 2026-07-22 | feat(brand): BE thương hiệu công ty — wrapper presign logo + favicon trên FileService [S5-BRAND-BE-1] |
| `54f5028b` | 2026-07-22 | feat: task detail UX + role-member picker dùng chung + PROD tooling (#255) |
| `49ff063c` | 2026-07-21 | docs(brand): seed wave S5-BRAND — cài đặt thương hiệu logo + favicon (3 WO: wrapper presign trên FileService + FE /system/company + áp vỏ app, không migration/quyền mới) |
| `0cdd68e0` | 2026-07-21 | docs(lms): seed wave S5-LMS Giai đoạn B — 8 WO (auto-sync + SSO-only + audit + tiến độ về /me + chuẩn hoá UI LMS) |
| `bd981f8c` | 2026-07-21 | feat(lms): phân quyền access:lms thuộc app chính (gate card + endpoint + seed 4 vai trò) (#254) |
| `bc09ffb7` | 2026-07-21 | feat(integration): cầu SSO MediaOS→LMS Giai đoạn A — sso-link HMAC 60s + sidebar Đào tạo + script sync tài khoản (#253) |
| `2c8be7b3` | 2026-07-21 | chore(harness): S5-GOAL-DB-1 → done (#252 merged, master 0cbc5e79) |
| `0cbc5e79` | 2026-07-21 | feat(goal): DB core module Mục tiêu — goals + goal_updates + tasks.goal_id + seed quyền/counter/catalog [S5-GOAL-DB-1] (#252) |
| `f841eb8d` | 2026-07-20 | docs(goal): vá kế hoạch S5-GOAL theo review đối kháng (plan-reviewer BLOCK → PASS-with-fixes) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
