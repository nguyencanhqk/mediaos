# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-19 01:13Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

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
- 🔴 `S5-TASK-PIPELINE-1` Đợt A — Kanban cột pipeline tuỳ biến theo dự án (project_states) thay 5 cột FSM cố định; nới FSM cho phép mở lại + auto-map state_group→status qua changeStatus; backfill state_id từ task_status

**CHỜ (kẹt phụ thuộc):**
- `S5-UAT-1` UAT prep + run (script theo role · test data · sign-off) + release readiness checklist + known issues/release notes nội bộ — gate vào Sprint 6 ⏳ cần: S5-QA-E2E-1, S5-QA-REG-1, S5-SEC-1
- `S6-GOV-1` Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đổi sau freeze, RC governance (WS1) ⏳ cần: S5-UAT-1
- `S6-STAB-1` Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation) + fix P0/P1 + daily triage (WS2) ⏳ cần: S5-UAT-1
- `S6-QA-FINAL-1` QA final pass: regression + E2E + API contract + regression-theo-role + UAT final + điều kiện sign-off (WS3) ⏳ cần: S6-STAB-1
- `S6-SEC-1` Security / RBAC / Data-Protection final hardening: auth/session · RBAC · field masking · file access · audit · secret/config review (WS4) — crown ⏳ cần: S6-STAB-1
- `S6-PERF-DB-1` Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (index, query perf, backup/restore rehearsal) — WS5/WS6 ⏳ cần: S6-STAB-1
- `S6-REL-1` Release Candidate build + release notes + Go-live runbook + deployment/rollback rehearsal + monitoring/alerting/support readiness (WS7/WS8/WS9) — crown release ⏳ cần: S6-QA-FINAL-1, S6-SEC-1, S6-PERF-DB-1
- `S6-GOLIVE-1` Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/support guide · known issues · post-go-live backlog) — WS10 ⏳ cần: S6-REL-1
- `S5-TASK-NAV-TREE-1` Đợt B — Sidebar cây phòng ban: dự án lồng dưới phòng ban + menu ⋯ mỗi phòng ban (xem báo cáo · thêm dự án · sắp xếp); ModuleSidebar dựng cây đệ quy ⏳ cần: S5-TASK-PIPELINE-1
- `S5-TASK-WORKSPACE-1` Đợt D1 — Vỏ workspace dự án: tab bar (Bảng·Danh sách·Báo cáo·Hoạt động) + toolbar (tìm·lọc·sắp xếp·tuỳ chỉnh hiển thị·xuất khẩu) + rail avatar lọc theo người thực hiện ⏳ cần: S5-TASK-PIPELINE-1
- `S5-TASK-DETAIL-1` Màn chi tiết task — vá 4 gap TRONG SPEC chưa làm: timeline hiện dữ liệu cũ→mới (§13.12) + nới gate cho người liên quan · hiện người giao việc (reporter) · GET watchers · subtask thật (parent_task_id) ⏳ cần: S5-TASK-PIPELINE-1
- `S5-TASK-SUBTASK-1` Công việc con = subtask THẬT (parent_task_id): CRUD + người thực hiện/hạn riêng + ẩn khỏi board + tiến độ thẻ cha = tỉ lệ con hoàn thành ⏳ cần: S5-TASK-PIPELINE-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S4-QA-2`, `S5-DEVOPS-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-FE-TASK-4`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `HR-PERF-1`, `HR-IDENTITY-READ-1`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-NOTI-BE-5`, `S4-FE-NOTI-4`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`, `S5-ME-DOC-1`, `S5-ME-DB-1`, `S5-ME-BE-1`, `S5-ME-BE-2`, `S5-ME-BE-3`, `S5-ME-FE-1`, `S5-ME-FE-2`, `S5-ME-FE-3`, `S5-ME-QA-1`, `S5-HR-LINKUI-1`, `S5-HR-IMPORT-BE-1`, `S5-HR-IMPORT-FE-1`, `S5-HR-ORGCHART-BE-1`, `S5-HR-ORGCHART-FE-1`, `S5-HR-WORKINFO-1`, `S5-FE-TASK-NAV-1`, `S5-TASK-BE-6`, `S5-FE-TASK-5`, `S5-FE-TASK-6`, `S5-LEAVE-HOLIDAYS-MOVE-1`, `S5-NOTI-FIX-1`, `S5-NOTI-FIX-2`, `S5-TASK-HRCODE-1`

## Trạng thái repo

- **branch**: `docs/s5-task-subtask-model` · **file đang đổi (dirty)**: 3
- **migration head**: idx 178 — `0498_s5_notifix2_task_code_seqgen` (179 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `731072e6` | 2026-07-18 | docs(task): kế hoạch đợt A pipeline + seed 4 WO redesign TASK (benchmark MISA AMIS) (#232) |
| `a6a900cd` | 2026-07-18 | fix(task,att): task HR từ đơn điều chỉnh công mang task_code THẬT + counter Inactive → 409 (S5-TASK-HRCODE-1) (#231) |
| `f00167db` | 2026-07-18 | fix(hr): /hr/audit-logs luôn "Không thể tải lịch sử" (schema client lệch hình dạng response) (#230) |
| `b02292b8` | 2026-07-18 | feat(me,hr,noti): gom self-service về ME + sửa lỗi duyệt yêu cầu hồ sơ + thông báo phê duyệt (#229) |
| `f49a1ce3` | 2026-07-18 | feat(me,hr): avatar own-scope + hiển thị khắp nơi + HR-managed (S5-ME-BE-4/FE-4 · BE-5 · HR-AVATAR-1) (#228) |
| `4849433c` | 2026-07-18 | feat(hr): sơ đồ tổ chức đồ hoạ + trưởng phòng/thành viên + nút quản trị (S5-HR-ORGCHART-FE-1/2/3) (#227) |
| `ba5b23db` | 2026-07-18 | @ (#226) |
| `036ab5ba` | 2026-07-18 | feat(hr): S5-HR-WORKINFO-1 — khối Thông tin công việc (chi tiết NV + hồ sơ của tôi) (#225) |
| `0397bebe` | 2026-07-18 | feat(hr): S5-HR-ORGCHART-BE-1 — GET /hr/org-chart/employees (cây nhân sự scoped, directory-class) + employeeCount /org/units/tree 🔴 (#224) |
| `f3d8fa9a` | 2026-07-17 | test(me-qa): S5-ME-QA-1 — IDOR sweep /me/* + cross-user/tenant deny + aggregation degraded + preference policy (SPEC-09 §20) (#223) |
| `7a41e79b` | 2026-07-17 | feat(me-fe): S5-ME-FE-2 — Hồ sơ của tôi + Tài khoản & bảo mật dưới /me/* + màn Hoạt động bảo mật (ME-SCREEN-002..008) (#222) |
| `d5fc9e14` | 2026-07-17 | S5-FE-TASK-5: Kanban card giàu tín hiệu + lọc theo assignee (SPEC-06 §13.8) — FIX-2 LIGHT gate (#218) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
