# INDEX — Tổng quan Work Order đang hành

> **TỰ SINH** bởi `harness/gen-plan-index.mjs` — KHÔNG sửa tay (chạy lại sau khi đổi backlog/ledger/plan).
> Nguồn: `harness/backlog.mjs` (WO) + `activity.jsonl` (trạng thái) + `docs/plans/<id>.md` (micro-plan).
> Roadmap đầy đủ 112 story / 7 sprint: **IMPLEMENTATION-02 §7** (KHÔNG nhân bản ở đây — pull-sprint).

**132 WO** · có micro-plan: **48/132** · ⬜ 6 chờ · 🔵 0 đang làm · ✅ 126 xong · 🔴 0 chặn

## Sprint 0

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S0-GOV-1` | 🟢 | ✅ xong | — *(chưa)* | — | Governance: chuẩn hoá board/label/DoR/DoD + chốt backlog harness theo  |
| `S0-CI-1` | 🟢 | ✅ xong | [📄](S0-CI-1-reconcile.md) | — | CI BE/FE: đối chiếu lint·typecheck·test·build + migration-check + path |
| `S0-CI-2` | 🟡 | ✅ xong | [📄](S0-CI-2.md) | ✅S0-CI-1 | CI security gates: secret-scan (gitleaks/trufflehog) + dependency-scan |
| `S0-ENV-1` | 🟢 | ✅ xong | — *(chưa)* | — | Hạ tầng local: đối chiếu docker compose (Postgres/PgBouncer/Valkey/Min |
| `S0-FND-DB-1` | 🔴 | ✅ xong | [📄](S0-FND-DB-1-reconcile.md) | — | Đối chiếu schema nền (companies·modules·settings·sequence·audit·files· |
| `S0-FND-SEED-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S0-FND-DB-1 | Seed module catalog (MVP active · Phase inactive) + default system/com |
| `S0-AUTH-DB-1` | 🔴 | ✅ xong | [📄](S0-AUTH-DB-1-reconcile.md) | — | Đối chiếu AUTH/RBAC schema (users·sessions·password_reset·login_log·ro |
| `S0-API-CORE-1` | 🟡 | ✅ xong | [📄](S0-API-CORE-1-reconcile.md) | — | Đối chiếu shared config·logger·error-response envelope {success,messag |
| `S0-FE-CORE-1` | 🔴 | ✅ xong | [📄](S0-FE-CORE-1-reconcile.md) | — | Đối chiếu FE project structure (auth·console·app) + design token + bas |
| `S0-FE-API-1` | 🟢 | ✅ xong | [📄](S0-FE-API-1.md) | ✅S0-API-CORE-1 | Đối chiếu API client + query layer + error mapper (401/403/422/500 · r |
| `S0-QA-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S0-FND-DB-1 | Test strategy + verify migrate/seed từ DB trống + test-case matrix ske |

## Sprint 1

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S1-FND-AUDIT-1` | 🔴 | ✅ xong | [📄](S1-FND-AUDIT-1.md) | ✅S0-FND-DB-1 | AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail |
| `S1-FND-SETTING-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S0-FND-DB-1 ✅S1-FND-AUDIT-1 | SettingService: precedence company→system→default + /settings/public ( |
| `S1-FND-FILE-1` | 🔴 | ✅ xong | [📄](S1-FND-FILE-1.md) | ✅S0-FND-DB-1 ✅S1-FND-AUDIT-1 | FileService: upload metadata + StorageAdapter port + FilePolicy (deny- |
| `S1-FND-SEQ-1` | 🔴 | ✅ xong | [📄](S1-FND-SEQ-1.md) | ✅S0-FND-DB-1 | SequenceService.nextCode (tx + FOR UPDATE) + preview (không tăng) + re |
| `S1-FND-MODULE-1` | 🔴 | ✅ xong | [📄](S1-FND-MODULE-1.md) | ✅S0-FND-SEED-1 ✅S1-FND-AUDIT-1 ✅S1-FND-SETTING-1 | CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogSe |
| `S1-FND-WIRE-1` | 🟢 | ✅ xong | [📄](S1-FND-WIRE-1.md) | ✅S1-FND-AUDIT-1 ✅S1-FND-SETTING-1 ✅S1-FND-FILE-1 ✅S1-FND-SEQ-1 ✅S1-FND-MODULE-1 | FoundationModule gom (company·module-catalog·settings·audit·files·sequ |
| `S1-FE-LAYOUT-1` | 🟢 | ✅ xong | [📄](S1-FE-LAYOUT-1.md) | ✅S0-FE-CORE-1 | FE shell: Home Portal + App Switcher + Module Workspace layout (topbar |
| `S1-FE-REGISTRY-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S0-FE-CORE-1 | App/route/sidebar registry (permission-driven; metadata permission/sco |
| `S1-FE-QUERY-WIRE-1` | 🟢 | ✅ xong | [📄](S1-FE-QUERY-WIRE-1.md) | ✅S0-FE-API-1 | Wire QueryClient defaultOptions (retry=shouldRetryQuery + staleTime/gc |
| `S1-QA-FND-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S1-FND-AUDIT-1 ✅S1-FND-SETTING-1 ✅S1-FND-FILE-1 ✅S1-FND-SEQ-1 ✅S1-FND-MODULE-1 | QA hardening Foundation: permission/scope + file security + sequence c |
| `S1-QA-DEBT-1` | 🟡 | ✅ xong | — *(chưa)* | — | Test-suite triage: xoá/exclude test của module PARKED (de-media-fy: fi |
| `S1-INT-MOUNT-1` | 🟡 | ✅ xong | — *(chưa)* | — | Quyết scope + mount-or-skip: webhooks-deny + ui-config-deny đang 404 ( |

## Sprint 2

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S2-AUTH-DB-1` | 🔴 | ✅ xong | [📄](S2-AUTH-DB-1.md) | — | RBAC engine: thêm cột role_permissions.data_scope (Own/Team/Department |
| `S2-AUTH-DB-2` | 🔴 | ✅ xong | [📄](S2-AUTH-DB-2.md) | ✅S2-AUTH-DB-1 | Đối chiếu AUTH/RBAC tables vs DB-02 §12.1 (users·user_sessions·passwor |
| `S2-AUTH-SEED-1` | 🔴 | ✅ xong | [📄](S2-AUTH-SEED-1.md) | ✅S2-AUTH-DB-1 ✅S2-AUTH-DB-2 | Seed permission/role/role_permission VỚI data_scope đúng từng role + b |
| `S2-AUTH-BE-1` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-1.md) | ✅S2-AUTH-DB-2 ✅S2-AUTH-SEED-1 | Login/logout/me: password verify + session issue/revoke + login_log +  |
| `S2-AUTH-BE-2` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-2.md) | ✅S2-AUTH-DB-1 ✅S2-AUTH-SEED-1 | Permission + data-scope resolver guard dùng chung (decorator/middlewar |
| `S2-AUTH-BE-3` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-2 | User admin API (P1): list/detail/create/update + lock/unlock + roles/p |
| `S2-AUTH-BE-4` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-AUTH-DB-2 ✅S2-AUTH-BE-1 | Change-password + forgot/reset-password (P1): token hash + expiry/used |
| `S2-AUTH-BE-5` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-AUTH-DB-2 ✅S2-AUTH-BE-3 | Login-log + security-event viewer (P1): GET /auth/login-logs + /securi |
| `S2-HR-DB-1` | 🔴 | ✅ xong | [📄](S2-HR-DB-1.md) | — | Migration HR Core: departments·positions·job_levels·contract_types·emp |
| `S2-HR-SEED-1` | 🔴 | ✅ xong | [📄](S2-HR-SEED-1.md) | ✅S2-HR-DB-1 ✅S2-AUTH-SEED-1 | Seed HR master data (job_levels·contract_types·employee_code_config +  |
| `S2-HR-BE-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-HR-DB-1 ✅S2-AUTH-BE-2 | HR read core: GET /hr/employees (list/pagination/search/filter/sort/da |
| `S2-HR-BE-2` | 🔴 | ✅ xong | [📄](S2-HR-BE-2.md) | ✅S2-HR-BE-1 ✅S2-HR-SEED-1 | HR write core: POST/PATCH /hr/employees + auto employee-code (tx + Seq |
| `S2-HR-BE-3` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-HR-DB-1 ✅S2-AUTH-BE-2 | Department/position CRUD (P1): create/update/soft-delete + master data |
| `S2-HR-BE-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-1 | Profile change request skeleton (P1/P2): employee gửi yêu cầu sửa hồ s |
| `S2-FE-AUTH-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-1 ✅S2-AUTH-BE-2 | FE Auth: Login page + auth bootstrap (/auth/me) + ProtectedRoute/Publi |
| `S2-FE-HR-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-1 ✅S2-FE-AUTH-1 | FE HR: EmployeeList (table/filter/search/pagination) + EmployeeDetail  |
| `S2-FE-HR-2` | 🟢 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-2 ✅S2-FE-HR-1 | FE HR: EmployeeForm (create/edit) + dropdown lookups + validation + su |
| `S2-FE-HR-3` | 🟢 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-1 ✅S2-FE-AUTH-1 | FE: MyProfile (read-only) + user/role read-only placeholder (P1, KHÔNG |
| `S2-INT-1` | 🔴 | ✅ xong | [📄](S2-INT-1.md) | ✅S2-HR-BE-2 ✅S2-AUTH-BE-3 | Tích hợp HR tạo employee ↔ AUTH tạo/link user (giao dịch nhất quán, un |
| `S2-INT-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-1 ✅S2-AUTH-BE-2 | Tích hợp HR direct_manager ↔ data-scope Team/Department của permission |
| `S2-QA-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-2 ✅S2-HR-BE-1 | QA AUTH + RBAC/data-scope: login success/fail/locked/logout/me + Own/T |
| `S2-QA-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-2 ✅S2-FE-HR-2 | QA HR CRUD + FE smoke + regression: employee create/update/status/link |
| `S2-QA-DEBT-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-3 ✅S2-AUTH-BE-4 | Test-hygiene AUTH: gate int-spec trên hasDb && LANE_DB (KHÔNG bare ski |
| `S2-AUTH-HARDEN-1` | 🔴 | ✅ xong | [📄](S2-AUTH-HARDEN-1.md) | ✅S2-AUTH-BE-4 | Hardening password-reset (P2): tách rate-limit bucket forgot khỏi logi |
| `S2-HR-MASK-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-1 | HR read tinh chỉnh (P2): xác nhận+gate masking salaryType theo SPEC-03 |
| `S2-HR-EMP-LEGACY-LOCK-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-1 ✅S2-HR-MASK-1 | Khoá route legacy GET /employees(/:id): mask salaryType+PII (view-sala |
| `S2-AUTH-BRAND-1` | 🔴 | ✅ xong | — *(chưa)* | — | Rebrand TOTP issuer (P3): TOTP_ISSUER 'MediaOS' → 'FUNTIME MEDIA' khớp |
| `S2-FE-AUTH-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-4 ✅S2-FE-AUTH-1 | FE Auth self-service: forgot-password + reset-password + session-expir |
| `S2-FE-AUTH-3` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-3 ✅S2-FE-HR-3 | FE User admin CRUD (/system/users): create + detail + edit + assign-ro |
| `S2-AUTH-BE-6` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-6.md) | ✅S2-AUTH-BE-3 | Role write API (P1): POST/PATCH /auth/roles (create/update, KHÔNG sửa  |
| `S2-FE-AUTH-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-6 ✅S2-FE-HR-3 | FE Role & Permission admin: /system/roles create/detail/edit + assign- |
| `S2-AUTH-BE-7` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-1 | Session management API (P1): GET /auth/sessions (phiên của CHÍNH user) |
| `S2-FE-AUTH-5` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-7 ✅S2-FE-AUTH-1 | FE Account self-service: /account/sessions (list + revoke phiên của ch |
| `S2-FE-FND-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S1-FND-MODULE-1 ✅S1-FND-SETTING-1 ✅S1-FE-REGISTRY-1 | FE FOUNDATION admin: System Overview (/system) + Company info view/edi |
| `S2-FE-FND-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S1-FND-AUDIT-1 ✅S1-FND-FILE-1 ✅S1-FE-REGISTRY-1 | FE FOUNDATION admin: Audit log viewer (/system/audit-logs + detail, th |
| `S2-FND-BE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S1-FND-MODULE-1 | Admin module catalog API (P1): GET /foundation/modules (TẤT CẢ module, |
| `S2-FE-FND-3` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-FND-BE-1 ✅S1-FE-REGISTRY-1 | FE FOUNDATION admin: Module Catalog (/system/modules + /:code detail)  |
| `S2-FE-FND-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S1-FE-REGISTRY-1 | FE FOUNDATION admin: Public Holidays (/system/public-holidays list+CRU |
| `S2-FND-BE-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S1-FND-SEQ-1 ✅S1-FND-WIRE-1 | Foundation ops admin API (P1): Sequences (GET list + preview + PATCH c |
| `S2-FE-FND-5` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-FND-BE-2 ✅S1-FE-REGISTRY-1 | FE FOUNDATION admin: Sequence Counters (/system/sequences list+preview |
| `S2-FND-BE-3` | 🔴 | ✅ xong | [📄](S2-FND-BE-3.md) | ✅S1-FND-WIRE-1 ✅S1-FND-FILE-1 | Foundation security-admin API (P1): Retention policies (GET + PATCH ov |
| `S2-FE-FND-6` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-FND-BE-3 ✅S1-FE-REGISTRY-1 | FE FOUNDATION admin: Retention Policies (/system/retention config) + F |
| `S2-FE-HR-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-FE-HR-3 ✅S2-INT-2 | FE HR Profile change-request workflow: /hr/me/change-request (self gửi |
| `S2-FE-HR-5` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-FE-HR-1 | FE HR Master data mgmt: /hr/departments + /hr/positions + /hr/job-leve |
| `S2-FE-HR-6` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-FE-HR-1 ✅S2-INT-2 | FE HR Org chart (/hr/org-chart, theo data-scope) + HR audit-logs (/hr/ |
| `S2-HR-BE-6` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-HR-DB-1 ✅S1-FND-FILE-1 | Employee contracts (carry-over STORY-031): migration employee_contract |
| `S2-FE-HR-7` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-6 ✅S2-FE-HR-1 | FE HR Contracts: /hr/contracts (DS hợp đồng) + /hr/employees/:id/contr |
| `S2-HR-BE-7` | 🟡 | ✅ xong | [📄](S2-HR-BE-7.md) | ✅S2-HR-DB-1 ✅S1-FND-SEQ-1 | Employee-code config admin API (carry-over STORY-035): GET/PATCH /hr/s |
| `S2-FE-HR-8` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-HR-BE-7 ✅S2-FE-HR-1 | FE HR Employee-code config: /hr/settings/employee-code (form cấu hình  |
| `S2-AUTH-BE-8` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-8.md) | — | user_security_events WRITER (audit gap #1): ghi sự kiện bảo mật BACKEN |
| `S2-AUTH-BE-9` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-9.md) | — | Lock/suspend user → REVOKE toàn bộ session/refresh NGAY (audit gap #2) |
| `S2-AUTH-BE-10` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-10.md) | — | refresh() kiểm company active (audit gap #3): company suspended → KHÔN |
| `S2-AUTH-CAP-1` | 🔴 | ✅ xong | [📄](S2-AUTH-CAP-1.md) | — | Phơi capability sensitive qua /auth/me: thêm export:leave + view:leave |
| `S2-AUTH-DB-4` | 🔴 | ✅ xong | [📄](S2-AUTH-DB-4.md) | — | 2FA per-user + pair reset-2fa:user (OWNER CHỐT 2026-07-03): cột users. |
| `S2-AUTH-BE-11` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-11.md) | ✅S2-AUTH-DB-4 | 2FA self-service hardening + role-write cờ ép: status trả required · d |
| `S2-AUTH-BE-12` | 🔴 | ✅ xong | [📄](S2-AUTH-BE-12.md) | ✅S2-AUTH-DB-4 ✅S2-AUTH-BE-11 | Admin 2FA controls: PATCH user requireTwoFactor + detail DTO twoFactor |
| `S2-FE-ACCT-SEC-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-11 | FE Account Security: section Bảo mật trong /account/profile — trạng th |
| `S2-FE-SYS-SEC-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-AUTH-BE-11 ✅S2-AUTH-BE-12 | FE Admin security: /system/roles form toggle 'Bắt buộc 2FA' + /system/ |
| `S2-AUTH-DB-3` | 🔴 | ✅ xong | — *(chưa)* | — | user_roles soft-delete (audit gap #4): thêm deleted_at/deleted_by + RE |
| `S2-FE-AUTH-6` | 🟡 | ✅ xong | — *(chưa)* | ✅S2-FE-AUTH-1 | FE Account-layer còn thiếu: màn enroll 2FA trong apps/app khi mustSetu |
| `S2-AUTH-DOC-1` | 🟢 | ✅ xong | [📄](S2-AUTH-DOC-1.md) | — | Pin lệch-có-chủ-đích vào docs AUTH (DB-02 · BACKEND-03 · API-02 · FRON |
| `S2-FND-BE-4` | 🔴 | ✅ xong | [📄](S2-FND-BE-4.md) | — | File-access hardening (audit H1+H2): FilePolicy fallback FAIL-CLOSED c |
| `S2-FND-BE-5` | 🔴 | ✅ xong | — *(chưa)* | — | Permission-surface reconcile (audit H4+H6): chốt cặp audit-log viewer  |
| `S2-FND-BE-6` | 🔴 | ✅ xong | — *(chưa)* | — | Trả nợ audit CONFIG holiday (BE-6→BE-9, audit H5) + mở rộng audit-mask |
| `S2-FND-DB-1` | 🔴 | ✅ xong | — *(chưa)* | — | REVOKE DELETE app-role trên companies + users (audit sát-HIGH, BẤT BIẾ |
| `S2-FND-SEED-2` | 🟡 | ✅ xong | — *(chưa)* | — | Runtime seeder HR + Sequences (audit H7, DB-10 §14): job_levels 8 + co |
| `S2-FND-SEED-3` | 🔴 | ✅ xong | — *(chưa)* | — | Bootstrap dựng-từ-trống tự động (audit §4.2): seed default company ide |
| `S2-FND-SEED-4` | 🟡 | ✅ xong | — *(chưa)* | — | Seed settings đủ theo DB-10 §11 (audit §4.2): bổ sung 9/14 system key  |
| `S2-FND-BE-8` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S2-FND-BE-5 | Đóng permission-seed orphan (audit §6.3): system-settings GET/PATCH +  |
| `S2-FND-JOBS-1` | 🔴 | ⬜ chờ | — *(chưa)* | — | System Jobs khung tối thiểu (audit §5.2, DB-08 §8.14-15 + BACKEND-11 § |
| `S2-FND-FILE-2` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S2-FND-BE-4 | Upload file E2E (audit H3, BACKEND-11 §11.4): chốt mô hình presigned-P |
| `S2-FE-FND-7` | 🟡 | ✅ xong | — *(chưa)* | — | FE System sửa nhỏ theo audit (H8 + §7): defaultRoute app Hệ thống → /s |
| `S2-FND-DB-2` | 🔴 | ✅ xong | — *(chưa)* | — | DB hygiene theo DB-09 (audit §3.2, P2): index bổ sung (files/file_acce |
| `S2-FND-CONTRACT-1` | 🟡 | ⬜ chờ | — *(chưa)* | — | API contract hygiene theo BACKEND-12 (audit §6.2, P2): Swagger/OpenAPI |
| `S2-FND-DOC-1` | 🟢 | ✅ xong | [📄](S2-FND-DOC-1.md) | — | Pin lệch-có-chủ-đích Foundation vào docs (DB-08/09/10 · BACKEND-04/11/ |

## Sprint 3

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S3-ATT-DB-1` | 🔴 | ✅ xong | [📄](S3-ATT-DB-1.md) | — | Migration ATT Core: shifts·shift_assignments·attendance_rules·attendan |
| `S3-LEAVE-DB-1` | 🔴 | ✅ xong | [📄](S3-LEAVE-DB-1.md) | ✅S3-ATT-DB-1 | Migration LEAVE Core: leave_types·leave_policies·leave_balances·leave_ |
| `S3-FND-SEEDRUN-1` | 🔴 | ✅ xong | — *(chưa)* | — | Runtime per-company master-data seed runner: registry + bootstrap reco |
| `S3-ATT-SEED-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S3-ATT-DB-1 ✅S2-AUTH-SEED-1 ✅S3-FND-SEEDRUN-1 | Seed ATT permissions (§11.1) + role→data_scope mapping (§11.3) + defau |
| `S3-LEAVE-SEED-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-DB-1 ✅S2-AUTH-SEED-1 ✅S3-ATT-SEED-1 ✅S3-FND-SEEDRUN-1 | Seed LEAVE permissions (§11.2) + role→data_scope mapping + leave types |
| `S3-ATT-BE-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S3-ATT-SEED-1 ✅S2-AUTH-BE-2 ✅S2-HR-BE-1 | ATT Today + check-in + check-out: resolve employee/shift/rule (server- |
| `S3-ATT-BE-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S3-ATT-BE-1 | ATT records read: my-records + records/{id} detail + team-records + re |
| `S3-ATT-BE-3` | 🟡 | ✅ xong | [📄](S3-ATT-BE-3.md) | ✅S3-ATT-SEED-1 | Shift/rule minimum (P1): GET /attendance/shifts + /rules/effective + r |
| `S3-LEAVE-BE-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-SEED-1 ✅S2-AUTH-BE-2 ✅S2-HR-BE-1 | LEAVE balance + types + calculation preview: GET /leave/types + GET /l |
| `S3-LEAVE-BE-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-1 | LEAVE request workflow (me): create draft + update draft + submit + li |
| `S3-LEAVE-BE-3` | 🔴 | ✅ xong | [📄](S3-LEAVE-BE-3.md) | ✅S3-LEAVE-BE-2 ✅S2-INT-2 | LEAVE approval workflow: pending-list theo scope + approve + reject(re |
| `S3-LEAVE-BE-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-SEED-1 ✅S2-AUTH-BE-2 | LEAVE type/policy management + HR balance view/adjust + ledger (P1): C |
| `S3-INT-1` | 🔴 | ✅ xong | [📄](S3-INT-1.md) | ✅S3-ATT-BE-1 ✅S3-LEAVE-BE-3 | LEAVE→ATT sync: onLeaveApproved handler + AttendanceLeaveSyncService ( |
| `S3-FE-REGISTRY-1` | 🔴 | ✅ xong | [📄](S3-FE-REGISTRY-1.md) | ✅S2-FE-AUTH-1 ✅S1-FE-REGISTRY-1 ✅S3-ATT-SEED-1 ✅S3-LEAVE-SEED-1 | FE registry + API layer ATT/LEAVE: app/sidebar/route registry (permiss |
| `S3-FE-ATT-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S3-ATT-BE-1 ✅S3-FE-REGISTRY-1 | FE ATT Today: AttendanceTodayPage + AttendanceStatusCard + CheckInOutA |
| `S3-FE-ATT-2` | 🟡 | ✅ xong | [📄](S3-FE-ATT-2.md) | ✅S3-ATT-BE-2 ✅S3-FE-ATT-1 | FE ATT records (P0/P1): MyAttendanceRecordsPage + TeamAttendanceRecord |
| `S3-FE-LEAVE-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-2 ✅S3-FE-REGISTRY-1 | FE LEAVE me: MyLeaveBalancePage/LeaveBalanceCard + MyLeaveRequestsPage |
| `S3-FE-LEAVE-2` | 🟡 | ✅ xong | [📄](S3-FE-LEAVE-2.md) | ✅S3-LEAVE-BE-3 ✅S3-FE-LEAVE-1 | FE LEAVE approval: LeaveApprovalPage + pending table + approval detail |
| `S3-QA-1` | 🔴 | ✅ xong | [📄](S3-QA-1.md) | ✅S3-ATT-BE-2 ✅S3-INT-1 | QA ATT: today/check-in/out rule + blocked-leave-day + records scope Ow |
| `S3-QA-2` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S3-LEAVE-BE-3 ✅S3-INT-1 | QA LEAVE + integration: balance + request draft/submit/cancel/validati |
| `S3-ATT-BE-4` | 🔴 | ✅ xong | [📄](S3-ATT-BE-4.md) | ✅S3-ATT-BE-2 ✅S2-INT-2 | ATT Adjustment workflow API (CO-S4-003): adjustment_requests create/li |
| `S3-ATT-BE-5` | 🔴 | ✅ xong | [📄](S3-ATT-BE-5.md) | ✅S3-ATT-BE-2 ✅S2-INT-2 | ATT Remote/Onsite-work request workflow API (CO-S4-004): remote_work_r |
| `S3-ATT-BE-6` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-ATT-BE-2 ✅S1-FND-AUDIT-1 | ATT Reports + audit read (CO-S4-006, P2): GET /attendance/reports (tổn |
| `S3-FE-ATT-3` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-ATT-BE-4 ✅S3-FE-ATT-2 | FE ATT Adjustment (/attendance/adjustment-requests my/list/new/:id + / |
| `S3-FE-ATT-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-ATT-BE-5 ✅S3-FE-ATT-2 | FE ATT Remote/Onsite (/attendance/remote-work-requests my/list/new/:id |
| `S3-FE-ATT-5` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-ATT-BE-3 ✅S3-FE-ATT-2 | FE ATT admin + company records: /attendance/records (công ty, 004) + / |
| `S3-FE-ATT-6` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-ATT-BE-6 ✅S3-FE-ATT-2 | FE ATT Reports (/attendance/reports) + Audit logs (/attendance/audit-l |
| `S3-LEAVE-BE-5` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-3 ✅S2-INT-2 | LEAVE Calendar API (CO-S4-005): GET /leave/calendar theo data-scope Ow |
| `S3-LEAVE-BE-6` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-4 ✅S1-FND-AUDIT-1 | LEAVE Reports + balance transactions + audit read (P2): GET /leave/bal |
| `S3-FE-LEAVE-3` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-3 ✅S3-FE-LEAVE-1 | FE LEAVE all-requests (/leave/requests, 006) + edit draft (/leave/requ |
| `S3-FE-LEAVE-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-5 ✅S3-FE-LEAVE-1 | FE LEAVE Calendar (/leave/calendar, own/team/company theo scope) |
| `S3-FE-LEAVE-5` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-4 ✅S3-LEAVE-BE-6 ✅S3-FE-LEAVE-1 | FE LEAVE admin: /leave/types + /leave/policies + /leave/balances (HR)  |
| `S3-FE-LEAVE-6` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-6 ✅S3-FE-LEAVE-1 | FE LEAVE Reports (/leave/reports) + Audit logs (/leave/audit-logs) |
| `S3-LEAVE-SEED-2` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S3-LEAVE-SEED-1 | Leave types 8/8 + pin mã (audit §4.2, DB-10 §14.3): thêm MATERNITY/MAR |

---

**Quy ước micro-plan** (tái dùng qua auto-loop): mỗi WO có file `docs/plans/<id>.md` với frontmatter máy-đọc
(`lanes/acceptanceChecks/testTasks/steps`) + phần prose reconcile. Auto-loop đọc plan nếu có (reconcile-refresh),
chưa có thì tạo + lưu. Xem file mẫu: `docs/plans/S0-FND-DB-1-reconcile.md`.
