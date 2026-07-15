# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-15 07:38Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S5-ME-BE-3 — BE Hoạt động bảo mật own-scope: GET /me/security/activity đọc login_logs + user_security_events CỦA CHÍNH user (mask IP, không lộ nhạy cảm) — sessions TÁI DÙNG /auth/sessions sẵn có
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/auth/**`, `apps/api/src/me/**`, `apps/api/test/integration/**`, `packages/contracts/src/**`, `docs/plans/S5-ME-BE-3.md`
- **phụ thuộc**: S5-ME-BE-1✓
- **done_when (đích hội tụ)**:
  - [ ] GET /api/v1/me/security/activity: đọc login_logs + user_security_events CỦA CHÍNH user hiện tại (WHERE user_id = actor AND company_id = tenant — own-scope hard-code từ token, KHÔNG param); phân trang + giới hạn khoảng thời gian; KHÔNG cache dài (§12.6); gate = ME.ACCESS (seed ở S5-ME-DB-1) + own-scope từ token, KHÔNG dùng cặp view:audit-log (cặp đó là viewer admin Company-scope, GIỮ NGUYÊN endpoint admin không đụng); chốt shape route trong plan
  - [ ] DTO tối giản (thời gian · loại sự kiện · thiết bị/UA rút gọn · IP mask theo policy §10.6) — KHÔNG trả token/secret/chi tiết bảo mật thừa (§17); sessions list/revoke KHÔNG dựng lại — ME tái dùng GET /auth/sessions + POST revoke/revoke-others sẵn có
  - [ ] Int-spec RED-trước: A không đọc được activity của B (cùng tenant + cross-tenant, kể cả khi truyền user_id lạ) · chưa đăng nhập 401 · response không chứa field nhạy cảm (assert shape); gate hasDb && LANE_DB
  - [ ] Crown AUTH: plan-reviewer PASS TRƯỚC khi code; FULL gate security-reviewer + silent-failure-hunter PASS

## Hàng đợi

**READY (phụ thuộc đã xong — làm được ngay):**
- 🟡 `S4-QA-2` QA Sprint 4 E2E + regression sign-off: flow task→noti→dash (§15.1) + notification deep link + dashboard degraded + regression S0–S3
- 🟡 `S5-ME-BE-2` BE preferences + avatar: GET/PATCH /me/preferences (+appearance) upsert user_preferences own-scope + POST/DELETE /me/avatar qua foundation files → employee_profiles.avatar_url
- 🟡 `S5-ME-FE-1` FE registry + shell + Tổng quan ME (ME-SCREEN-001): ModuleCode/APP_REGISTRY card 'Cá nhân' + ROUTE_REGISTRY /me/* + SIDEBAR_REGISTRY.ME (§8.1) + MODULE_APP_METADATA + trang /me overview
- 🟡 `S5-HR-IMPORT-FE-1` FE import nhân viên hàng loạt: màn upload file + tải template + preview lỗi từng dòng (dry-run) + áp dụng + màn kết quả — gate cặp ('import','employee')
- 🔴 `S5-HR-ORGCHART-BE-1` BE sơ đồ tổ chức: GET /hr/org-chart/employees (cây nhân sự theo quản lý trực tiếp, directory-class, theo data-scope, chống cycle/orphan) + headcount additive vào /org/units/tree
- 🟡 `S5-HR-WORKINFO-1` Hoàn thiện khối Thông tin công việc (chi tiết nhân viên + hồ sơ của tôi): BE thêm jobLevelName·contractTypeName·tên quản lý trực tiếp/gián tiếp (additive) + FE thêm dòng tương ứng + khối Thông tin nghỉ việc
- 🟢 `S5-FE-TASK-5` Kanban card giàu tín hiệu (benchmark): badge comment/attachment/checklist + avatar-initials assignee + style Done/Cancelled + lọc theo assignee/'Chưa giao' trên board
- 🟡 `S5-FE-TASK-6` TASK-SCREEN-010 Task quá hạn (/tasks/overdue) + TASK-SCREEN-011 Báo cáo tiến độ dự án — FE-only trên BE sẵn có (query overdue + PROJECT_PROGRESS), layout KPI tiles theo benchmark
- 🟢 `S5-LEAVE-HOLIDAYS-MOVE-1` Chuyển màn Ngày nghỉ lễ /system/public-holidays → /leave/public-holidays (re-home FE-only: route + sidebar LEAVE group admin + redirect path cũ; gate & BE giữ nguyên)

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
- `S5-ME-FE-2` FE Hồ sơ của tôi + Tài khoản & bảo mật dưới /me/*: TÁI DÙNG MyProfilePage/PCR/ChangePassword/Sessions/2FA + màn Hoạt động bảo mật mới (BE-3) ⏳ cần: S5-ME-FE-1, S5-ME-BE-3
- `S5-ME-FE-3` FE Công việc của tôi (ATT/LEAVE/TASK summary + deep-link) + Thông báo & Tùy chọn thông báo (FE mới trên BE sẵn) + Cài đặt cá nhân (theme sync server↔localStorage) ⏳ cần: S5-ME-FE-1, S5-ME-BE-2
- `S5-ME-QA-1` QA ME: IDOR sweep mọi endpoint /me/* + cross-user/cross-tenant + aggregation degraded + preference policy — theo SPEC-09 §20, coverage ≥80% apps/api/src/me ⏳ cần: S5-ME-BE-2, S5-ME-BE-3
- `S5-HR-ORGCHART-FE-1` FE sơ đồ tổ chức trực quan /hr/org-chart: tab Phòng ban (node-chart + trưởng đơn vị + headcount) + tab Nhân sự (reporting-line card avatar·tên·chức danh) + toggle giữ dạng danh sách cũ ⏳ cần: S5-HR-ORGCHART-BE-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S5-DEVOPS-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-FE-TASK-4`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `HR-PERF-1`, `HR-IDENTITY-READ-1`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-NOTI-BE-5`, `S4-FE-NOTI-4`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`, `S5-ME-DOC-1`, `S5-ME-DB-1`, `S5-ME-BE-1`, `S5-HR-LINKUI-1`, `S5-HR-IMPORT-BE-1`, `S5-FE-TASK-NAV-1`, `S5-TASK-BE-6`

## Trạng thái repo

- **branch**: `chore/s5-plans-ledger-0715` · **file đang đổi (dirty)**: 0
- **migration head**: idx 175 — `0495_s5_medb1_user_preferences_me_module_perms` (176 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `a0db43b9` | 2026-07-15 | chore(harness): gom plan docs tồn đọng — S5-HR-IMPORT-BE-1 · S5-ME-BE-1 · S5-ME-DOC-1 |
| `abb350fd` | 2026-07-13 | chore(harness): seed S5-LEAVE-HOLIDAYS-MOVE-1 — chuyển màn Ngày nghỉ lễ /system/public-holidays → /leave (FE-only, gate giữ nguyên) (#204) |
| `c7042ac5` | 2026-07-13 | chore(harness): seed wave S5-TASK-UX — 4 WO (sidebar Dự án · Kanban counts §13.8 · card benchmark · SCREEN-010/011) (#203) |
| `0d08e133` | 2026-07-13 | wip(S4-FE-NOTI-4): NotificationTemplatesPage (NOTI-SCREEN-006) + mở đường sidebar templates/delivery-logs (#200) |
| `df39364d` | 2026-07-13 | wip(me-preferences-db): mig 0495 user_preferences + seed module ME + 5 pair quyền ME (#199) |
| `1357ead9` | 2026-07-13 | chore(harness): S5-ME sửa done_when theo plan-reviewer — ME-DEC-002 bị trích ngược (#198) |
| `fc9d2264` | 2026-07-13 | feat(hr): HR-IDENTITY-READ-1 — lộ identity_number/issue_date/issue_place (CCCD §14.18) qua view-identity:employee 🔴 (#197) |
| `251d629c` | 2026-07-13 | chore(harness): bổ sung 4 story HR (IMP02-STORY-121..124) + 6 WO S5-HR — liên kết tài khoản UI · import Excel · sơ đồ tổ chức trực quan · thông tin công việc (#196) |
| `0572b8d7` | 2026-07-13 | docs(me): S5-ME-DOC-1 — sync SPEC-09 ME + DB-01/08/09/10 + API-11 ME stub + PRD/README (#195) |
| `80ebc0db` | 2026-07-13 | wip(S4-NOTI-BE-5): GET /notifications/templates admin list (override ∪ global) (#194) |
| `b39fafaf` | 2026-07-13 | chore(harness): HR-IDENTITY-READ-1 owner chốt lần 2 — GRANT KÈM (hr/company-admin/employee mirror view-sensitive 0444, explicit per-role, không CROSS JOIN) + giữ gate-flip an toàn + stem identityissue cho masker + gom plan docs tồn đọng (#192) |
| `f9830634` | 2026-07-13 | chore(harness): board tiến độ — thêm EPIC-12 ME (8 story/44pt) + trace-map WO→story đúng module (#193) |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
