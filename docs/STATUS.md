# STATUS — MediaOS (TỰ SINH — KHÔNG sửa tay)

> Sinh bởi `harness/gen-status.mjs` lúc **2026-07-23 17:54Z**. Status TỰ ĐỘNG từ ledger (start-on-touch · finish-on-commit); đóng dấu tay: `node harness/ledger.mjs start|done <WO>`. Cơ cấu WO (title/zone/paths/deps) sửa ở `harness/backlog.mjs`.

## Tiêu điểm phiên (đang làm)

### 🔴 S5-FND-REVOKE-1 — Nợ di sản G-era (finding MEDIUM gate S5-GOAL-DB-1): REVOKE DELETE org_units + projects khỏi app role — chặn cửa cascade-xoá goals/goal_updates vòng qua soft-delete (expand-contract 2 release nếu còn caller)
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/migrations/**`, `apps/api/src/**`, `apps/api/test/integration/**`, `docs/plans/S5-FND-REVOKE-1.md`
- **phụ thuộc**: S5-GOAL-DB-1✓
- **done_when (đích hội tụ)**:
  - [ ] Grep TOÀN BỘ caller thật (kể cả raw sql) xác nhận 0 đường DELETE org_units/projects từ app role; migration REVOKE DELETE 2 bảng khỏi app role + verify fail-loud information_schema
  - [ ] Int-spec: app role DELETE org_units/projects → 42501; suite HR/TASK hiện có vẫn xanh (LANE_DB); FULL gate DB PASS

### 🟡 S5-LMS-FE-1 — FE /me: card 'Đào tạo' trong MeOverviewPage (fail-soft như 5 section hiện có) + trang /me/training (danh sách khoá + % + thời lượng + nút 'Mở LMS' → /lms) + sidebar entry, gate access:lms, i18n vi
- **zone**: yellow · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/app/src/routes/me/**`, `apps/app/src/routes/lms/**`, `apps/app/src/layouts/workspace/sidebar-registry.ts`, `apps/app/src/router.tsx`, `apps/app/src/i18n/**`, `packages/web-core/src/**`, `docs/plans/S5-LMS-FE-1.md`
- **phụ thuộc**: S5-LMS-BE-3✓
- **done_when (đích hội tụ)**:
  - [ ] Card Đào tạo trong /me (số khoá đang học + % gần nhất, fail-soft khi 403/502 — KHÔNG kéo sập overview) + trang /me/training loading/error/empty đủ 3 trạng thái; user không quyền access:lms không thấy card/menu (PermissionGate/useCan, KHÔNG hard-code role)
  - [ ] i18n namespace vi đủ; unit test component chính; LIGHT gate (typescript + react + quality-gate) xanh

### 🔴 S5-SYS-CLEAN-1 — Retention cho system_job_runs (47.126 dòng/18 MB, tăng mỗi nhịp scheduler): thêm vào RetentionCleanupJob với NGƯỠNG CÓ ĐIỀU KIỆN — giữ ≥90 ngày cho LMS_USER_SYNC, giữ VĨNH VIỄN mọi row Failed/Partial
- **zone**: red · **skills**: code-review
- **sửa ở đâu (paths)**: `apps/api/src/foundation/**`, `apps/api/src/scheduler/**`, `apps/api/migrations/**`, `apps/api/src/db/schema/**`, `apps/api/test/integration/**`, `docs/plans/S5-SYS-CLEAN-1.md`
- **phụ thuộc**: S5-LMS-BE-4✓
- **done_when (đích hội tụ)**:
  - [ ] Row Failed/Partial KHÔNG BAO GIỜ bị xoá (test RED-trước: seed row Failed 2 năm tuổi → chạy retention → row còn nguyên)
  - [ ] Row Success của LMS_USER_SYNC < 90 ngày KHÔNG bị xoá; > 90 ngày mới xoá
  - [ ] Xử lý TƯỜNG MINH row company_id IS NULL (job cấp system — retention policy là per-tenant nên ca này KHÔNG tự rơi vào đâu cả): chốt giữ hay xoá, có test
  - [ ] FULL gate PASS (chạm retention + bảng append-only-ish); không cấp thêm grant DELETE cho app role

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
- 🟡 `S5-GOAL-FE-1` FE trang Mục tiêu: menu sidebar riêng + danh sách/cây theo kỳ·phòng ban + form tạo/sửa (chọn cấp → đúng field neo, chọn mode đo) + màn chi tiết 4 tab — PermissionGate GOAL.*, i18n vi
- 🔴 `S5-GOAL-DB-2` Đợt D — Schema + migration task_templates + task_template_items + RLS FORCE + seed cặp ('manage','task-template') + UNION-ADD 'task_template' audit CHECK (số cũ 0508 ĐÃ BỊ CHIẾM bởi lms_access; 0509 dự kiến cho S5-LMS-DB-1 — kiểm _journal lấy số kế lúc chạy, DO-block cộng dồn KHÔNG rewrite CHECK từ snapshot cũ)
- 🔴 `S5-LMS-APP-2` LOCAL apps/lms — SSO-only: cờ env SSO_ONLY=true → đóng register/forgot/reset/resend-otp (route redirect + API 403), /login chỉ còn nút 'Đăng nhập qua MediaOS' ({MEDIAOS_APP_URL}/lms), break-glass ADMIN_EMAILS vẫn login mật khẩu; audit consume SSO → admin_audit_log. LÀM CUỐI WAVE

**CHỜ (kẹt phụ thuộc):**
- `S5-UAT-1` UAT prep + run (script theo role · test data · sign-off) + release readiness checklist + known issues/release notes nội bộ — gate vào Sprint 6 ⏳ cần: S5-QA-E2E-1, S5-QA-REG-1, S5-SEC-1
- `S6-GOV-1` Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đổi sau freeze, RC governance (WS1) ⏳ cần: S5-UAT-1
- `S6-STAB-1` Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/ATT/LEAVE/TASK/NOTI/DASH/Foundation) + fix P0/P1 + daily triage (WS2) ⏳ cần: S5-UAT-1
- `S6-QA-FINAL-1` QA final pass: regression + E2E + API contract + regression-theo-role + UAT final + điều kiện sign-off (WS3) ⏳ cần: S6-STAB-1
- `S6-SEC-1` Security / RBAC / Data-Protection final hardening: auth/session · RBAC · field masking · file access · audit · secret/config review (WS4) — crown ⏳ cần: S6-STAB-1
- `S6-PERF-DB-1` Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback verification (index, query perf, backup/restore rehearsal) — WS5/WS6 ⏳ cần: S6-STAB-1
- `S6-REL-1` Release Candidate build + release notes + Go-live runbook + deployment/rollback rehearsal + monitoring/alerting/support readiness (WS7/WS8/WS9) — crown release ⏳ cần: S6-QA-FINAL-1, S6-SEC-1, S6-PERF-DB-1
- `S6-GOLIVE-1` Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/support guide · known issues · post-go-live backlog) — WS10 ⏳ cần: S6-REL-1
- `S5-GOAL-FE-2` FE vòng đo: check-in modal + lịch sử + nút chốt kỳ/mở lại + gắn goal từ panel task + tab Công việc trong goal (bulk link) + khối 'Mục tiêu của tôi' trong /me ⏳ cần: S5-GOAL-FE-1
- `S5-GOAL-TPL-1` Đợt D — Phân rã mục tiêu từ template: CRUD template (BE+FE, GOAL-SCREEN-006) + wizard preview sửa/xóa/thêm/gán người/cột board + POST /goals/:id/decompose tạo bulk task 1 transaction ⏳ cần: S5-GOAL-DB-2, S5-GOAL-FE-2
- `S5-GOAL-DASH-1` Đợt E — Widget dashboard 'Mục tiêu kỳ này' (progress theo phòng ban, đọc cache) + hàng mục tiêu trong trang phòng ban ⏳ cần: S5-GOAL-FE-1

**Đã xong (v2):** `S0-GOV-1`, `S0-CI-1`, `S0-CI-2`, `S0-ENV-1`, `S0-FND-DB-1`, `S0-FND-SEED-1`, `S0-AUTH-DB-1`, `S0-API-CORE-1`, `S0-FE-CORE-1`, `S0-FE-API-1`, `S0-QA-1`, `S1-FND-AUDIT-1`, `S1-FND-SETTING-1`, `S1-FND-FILE-1`, `S1-FND-SEQ-1`, `S1-FND-MODULE-1`, `S1-FND-WIRE-1`, `S1-FE-LAYOUT-1`, `S1-FE-REGISTRY-1`, `S1-FE-QUERY-WIRE-1`, `S1-QA-FND-1`, `S1-QA-DEBT-1`, `S1-INT-MOUNT-1`, `S2-AUTH-DB-1`, `S2-AUTH-DB-2`, `S2-AUTH-SEED-1`, `S2-AUTH-BE-1`, `S2-AUTH-BE-2`, `S2-AUTH-BE-3`, `S2-AUTH-BE-4`, `S2-AUTH-BE-5`, `S2-HR-DB-1`, `S2-HR-SEED-1`, `S2-HR-BE-1`, `S2-HR-BE-2`, `S2-HR-BE-3`, `S2-HR-BE-4`, `S2-FE-AUTH-1`, `S2-FE-HR-1`, `S2-FE-HR-2`, `S2-FE-HR-3`, `S2-INT-1`, `S2-INT-2`, `S2-QA-1`, `S2-QA-2`, `S2-QA-DEBT-1`, `S2-AUTH-HARDEN-1`, `S2-HR-MASK-1`, `S2-HR-EMP-LEGACY-LOCK-1`, `S2-AUTH-BRAND-1`, `S2-FE-AUTH-2`, `S2-FE-AUTH-3`, `S2-AUTH-BE-6`, `S2-FE-AUTH-4`, `S2-AUTH-BE-7`, `S2-FE-AUTH-5`, `S2-FE-FND-1`, `S2-FE-FND-2`, `S2-FND-BE-1`, `S2-FE-FND-3`, `S2-FE-FND-4`, `S2-FND-BE-2`, `S2-FE-FND-5`, `S2-FND-BE-3`, `S2-FE-FND-6`, `S2-FE-HR-4`, `S2-FE-HR-5`, `S2-FE-HR-6`, `S2-HR-BE-6`, `S2-FE-HR-7`, `S2-HR-BE-7`, `S2-FE-HR-8`, `S3-ATT-DB-1`, `S3-LEAVE-DB-1`, `S3-FND-SEEDRUN-1`, `S3-ATT-SEED-1`, `S3-LEAVE-SEED-1`, `S3-ATT-BE-1`, `S3-ATT-BE-2`, `S3-ATT-BE-3`, `S3-LEAVE-BE-1`, `S3-LEAVE-BE-2`, `S3-LEAVE-BE-3`, `S3-LEAVE-BE-4`, `S3-INT-1`, `S3-FE-REGISTRY-1`, `S3-FE-ATT-1`, `S3-FE-ATT-2`, `S3-FE-LEAVE-1`, `S3-FE-LEAVE-2`, `S3-QA-1`, `S3-QA-2`, `S3-ATT-BE-4`, `S3-ATT-BE-5`, `S3-ATT-BE-6`, `S3-FE-ATT-3`, `S3-FE-ATT-4`, `S3-FE-ATT-5`, `S3-FE-ATT-6`, `S3-LEAVE-BE-5`, `S3-LEAVE-BE-6`, `S3-FE-LEAVE-3`, `S3-FE-LEAVE-4`, `S3-FE-LEAVE-5`, `S3-FE-LEAVE-6`, `S2-AUTH-BE-8`, `S2-AUTH-BE-9`, `S2-AUTH-BE-10`, `S2-AUTH-CAP-1`, `S2-AUTH-DB-4`, `S2-AUTH-BE-11`, `S2-AUTH-BE-12`, `S2-FE-ACCT-SEC-1`, `S2-FE-SYS-SEC-1`, `S2-AUTH-DB-3`, `S2-FE-AUTH-6`, `S2-AUTH-DOC-1`, `S2-FND-BE-4`, `S2-FND-BE-5`, `S2-FND-BE-6`, `S2-FND-DB-1`, `S2-FND-SEED-2`, `S2-FND-SEED-3`, `S2-FND-SEED-4`, `S3-LEAVE-SEED-2`, `S2-FND-BE-8`, `S2-FND-JOBS-1`, `S2-FND-FILE-2`, `S2-FE-FND-7`, `S2-FND-DB-2`, `S2-FND-CONTRACT-1`, `S2-FND-DOC-1`, `S2-AUTH-ROLEMEM-1`, `S2-AUTH-PERMUX-1`, `S2-AUTH-USEROPS-1`, `S4-TASK-DB-1`, `S4-TASK-RECON-1`, `S4-TASK-RECON-2`, `S4-TASK-SEED-1`, `S4-TASK-BE-1`, `S4-TASK-BE-2`, `S4-TASK-BE-3`, `S4-TASK-BE-4`, `S4-NOTI-DB-1`, `S4-NOTI-SEED-1`, `S4-NOTI-SEED-2`, `S4-NOTI-BE-1`, `S4-NOTI-BE-2`, `S4-NOTI-BE-3`, `S4-NOTI-BE-4`, `S4-DASH-DB-1`, `S4-DASH-SEED-1`, `S4-DASH-CATALOG-2`, `S4-DASH-BE-1`, `S4-DASH-SEED-2`, `S4-DASH-BE-2`, `S4-INT-1`, `S4-INT-2`, `S4-FE-REGISTRY-1`, `S4-FE-TASK-1`, `S4-FE-TASK-CLEANUP-1`, `S4-FE-TASK-2`, `S4-FE-TASK-3`, `S4-FE-NOTI-1`, `S4-FE-NOTI-CLEANUP-1`, `S4-FE-DASH-1`, `S4-FE-DASH-2`, `S4-QA-1`, `S4-QA-2`, `S5-DEVOPS-1`, `S3-FE-LEAVE-7`, `S2-HR-EMPFILE-1`, `S2-FE-HR-9`, `S2-FND-SYSSET-1`, `S2-FE-FND-8`, `S4-TASK-BE-5`, `S4-FE-TASK-4`, `S4-DASH-BE-3`, `S4-FE-DASH-3`, `S3-ATT-EXPORT-1`, `HR-PROFILE-UI-1`, `HR-PROFILE-UI-2`, `HR-PERF-1`, `HR-IDENTITY-READ-1`, `S4-FE-NOTI-2`, `S4-FE-NOTI-3`, `S4-NOTI-BE-5`, `S4-FE-NOTI-4`, `S4-QA-TASK-1`, `S4-QA-NOTI-1`, `S5-QA-GATE-LANEDB-1`, `S5-FND-JOBS-OBS-1`, `S4-INT-3`, `S4-INT-4`, `S4-INT-5`, `S5-ME-DOC-1`, `S5-ME-DB-1`, `S5-ME-BE-1`, `S5-ME-BE-2`, `S5-ME-BE-3`, `S5-ME-FE-1`, `S5-ME-FE-2`, `S5-ME-FE-3`, `S5-ME-QA-1`, `S5-HR-LINKUI-1`, `S5-HR-IMPORT-BE-1`, `S5-HR-IMPORT-FE-1`, `S5-HR-ORGCHART-BE-1`, `S5-HR-ORGCHART-FE-1`, `S5-HR-WORKINFO-1`, `S5-FE-TASK-NAV-1`, `S5-TASK-BE-6`, `S5-FE-TASK-5`, `S5-FE-TASK-6`, `S5-LEAVE-HOLIDAYS-MOVE-1`, `S5-NOTI-FIX-1`, `S5-NOTI-FIX-2`, `S5-TASK-HRCODE-1`, `S5-TASK-PIPELINE-1`, `S5-TASK-NAV-TREE-1`, `S5-TASK-WORKSPACE-1`, `S5-TASK-DETAIL-1`, `S5-TASK-SUBTASK-1`, `S5-DASH-TASKSTATUS-FIX-1`, `S5-TASK-PROJROLE-1`, `S5-TASK-BOARD-UX-1`, `S5-TASK-INLINE-1`, `S5-TASK-AVATAR-1`, `S5-TASK-CARDSUB-1`, `S5-TASK-MOVEPROJ-1`, `S5-TASK-COVER-1`, `S5-GOAL-DOC-1`, `S5-GOAL-DB-1`, `S5-GOAL-BE-1`, `S5-GOAL-BE-2`, `S5-LMS-DB-1`, `S5-LMS-BE-1`, `S5-LMS-BE-2`, `S5-LMS-APP-1`, `S5-LMS-APP-3`, `S5-LMS-BE-3`, `S5-LMS-BE-4`, `S5-BRAND-BE-1`, `S5-BRAND-FE-1`, `S5-BRAND-FE-2`

## Trạng thái repo

- **branch**: `master` · **file đang đổi (dirty)**: 18
- **migration head**: idx 189 — `0509_s5_lmsdb1_audit_lms_object_types` (190 migration)
- **nền**: Hạ tầng backend đã land master (RLS·permission·audit·outbox) + một phần Foundation service (audit/holidays/files/sequences/retention/seed). Migration head idx 121 / 0438. RECONCILE-FIRST: đối chiếu với DB-08/BACKEND spec, giữ phần khớp, chỉ build phần thiếu/lệch. De-media-fy: media·finance·SaaS·workflow-DAG·payroll·mobile OUT-OF-SCOPE.
- **hướng v2**: Rebuild theo bộ docs gold-standard. Triển khai theo dependency (IMPLEMENTATION-01 §4): Foundation → AUTH/RBAC → HR → ATT+LEAVE → TASK → NOTI → DASH → integration → QA/UAT → release. Backend guard là lớp kiểm soát quyền cuối. Mỗi sprint phải tạo increment chạy được + test được. Reconcile-first với code đã build. FE: auth·console·app.

## Commit gần đây

| sha | ngày | mô tả |
| --- | --- | --- |
| `b767cb15` | 2026-07-24 | feat(goal): BE vòng đo mục tiêu — engine 4 mode + check-in/finalize/reopen + link task↔goal + NOTI + job đối soát (S5-GOAL-BE-2) (#267) |
| `5532f2bb` | 2026-07-24 | chore(harness): regen STATUS sau khi S5-LMS-BE-3 merge (#266) — mở khoá S5-LMS-FE-1 |
| `44dca909` | 2026-07-24 | feat(lms): GET /me/training — proxy tiến độ đào tạo LMS (own-scope, Zod v1, cache 60s) [S5-LMS-BE-3] (#266) |
| `d2c1d4f3` | 2026-07-24 | docs(readme): dong ME o §9 tro API-11 bang link that + ghi nhan BE/FE da ship |
| `cf84e5c0` | 2026-07-24 | chore(harness): regen STATUS sau khi S5-GOAL-DOC-1 merge (#264) + flip Approved ME (#265) |
| `4e776125` | 2026-07-24 | docs(me): flip SPEC-09 ME + API-11 ME Draft -> Approved (#265) |
| `af33fc15` | 2026-07-24 | docs(goal): dong bo bo tai lieu SPEC-10 GOAL + duyet Approved + go trung so hieu (S5-GOAL-DOC-1) (#264) |
| `7a289001` | 2026-07-23 | chore(harness): regen STATUS sau khi S5-LMS-APP-3 dong (mo khoa S5-LMS-BE-3 + S5-LMS-APP-2) |
| `b5cc4521` | 2026-07-23 | feat(lms): API export tiến độ học cho MediaOS + FULL gate 2 vòng (S5-LMS-APP-3) |
| `3d338c94` | 2026-07-23 | feat(goal): BE GoalsModule — CRUD cây mục tiêu 3 cấp + /goals/tree + /me/goals (S5-GOAL-BE-1) (#263) |
| `b3b3befe` | 2026-07-23 | chore(harness): regen STATUS sau khi S5-LMS-BE-4 merge (#262) |
| `f3aa9fd4` | 2026-07-23 | test(lms): script nghiệm thu LMS + verify PROD cho S5-LMS-BE-4 |

---
_Vòng phiên: `bash harness/init.sh` (mở) → làm 1 Work Order → `bash harness/check.sh` (verify) → `bash harness/finish.sh` (đóng + bàn giao)._
