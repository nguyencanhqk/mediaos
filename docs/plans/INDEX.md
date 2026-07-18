# INDEX — Tổng quan Work Order đang hành

> **TỰ SINH** bởi `harness/gen-plan-index.mjs` — KHÔNG sửa tay (chạy lại sau khi đổi backlog/ledger/plan).
> Nguồn: `harness/backlog.mjs` (WO) + `activity.jsonl` (trạng thái) + `docs/plans/<id>.md` (micro-plan).
> Roadmap đầy đủ 112 story / 7 sprint: **IMPLEMENTATION-02 §7** (KHÔNG nhân bản ở đây — pull-sprint).

**238 WO** · có micro-plan: **107/238** · ⬜ 20 chờ · 🔵 0 đang làm · ✅ 218 xong · 🔴 0 chặn

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
| `S2-FND-BE-8` | 🔴 | ✅ xong | [📄](S2-FND-BE-8.md) | ✅S2-FND-BE-5 | Đóng permission-seed orphan (audit §6.3): system-settings GET/PATCH +  |
| `S2-FND-JOBS-1` | 🔴 | ✅ xong | [📄](S2-FND-JOBS-1.md) | — | System Jobs khung tối thiểu (audit §5.2, DB-08 §8.14-15 + BACKEND-11 § |
| `S2-FND-FILE-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S2-FND-BE-4 | Upload file E2E (audit H3, BACKEND-11 §11.4): chốt mô hình presigned-P |
| `S2-FE-FND-7` | 🟡 | ✅ xong | — *(chưa)* | — | FE System sửa nhỏ theo audit (H8 + §7): defaultRoute app Hệ thống → /s |
| `S2-FND-DB-2` | 🔴 | ✅ xong | — *(chưa)* | — | DB hygiene theo DB-09 (audit §3.2, P2): index bổ sung (files/file_acce |
| `S2-FND-CONTRACT-1` | 🟡 | ✅ xong | [📄](S2-FND-CONTRACT-1.md) | — | API contract hygiene theo BACKEND-12 (audit §6.2, P2): Swagger/OpenAPI |
| `S2-FND-DOC-1` | 🟢 | ✅ xong | [📄](S2-FND-DOC-1.md) | — | Pin lệch-có-chủ-đích Foundation vào docs (DB-08/09/10 · BACKEND-04/11/ |
| `S2-AUTH-ROLEMEM-1` | 🔴 | ✅ xong | [📄](S2-AUTH-ROLEMEM-1.md) | — | Tab Thành viên trên RoleDetailPage: BE GET /auth/roles/:id/members + F |
| `S2-AUTH-PERMUX-1` | 🔴 | ✅ xong | [📄](S2-AUTH-PERMUX-1.md) | ✅S2-AUTH-ROLEMEM-1 | Tối ưu gán quyền: BE GET /auth/roles/:id/permissions + RolePermissions |
| `S2-AUTH-USEROPS-1` | 🔴 | ✅ xong | [📄](S2-AUTH-USEROPS-1.md) | — | Quản lý người dùng nâng cao: xóa mềm + khôi phục + admin reset mật khẩ |
| `S2-HR-EMPFILE-1` | 🔴 | ✅ xong | [📄](S2-HR-EMPFILE-1.md) | — | BE Employee File: upload/list/download/soft-delete file hồ sơ nhân viê |
| `S2-FE-HR-9` | 🟢 | ✅ xong | — *(chưa)* | ✅S2-HR-EMPFILE-1 | FE Employee Files tab trong EmployeeDetailPage: danh sách + upload (pr |
| `S2-FND-SYSSET-1` | 🔴 | ✅ xong | [📄](S2-FND-SYSSET-1.md) | — | BE System Settings: GET (+PATCH) /foundation/system-settings + quyền m |
| `S2-FE-FND-8` | 🟢 | ✅ xong | — *(chưa)* | ✅S2-FND-SYSSET-1 | FE hoàn thiện SystemSettingsPage (/system/settings) thay placeholder:  |

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
| `S3-QA-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-BE-3 ✅S3-INT-1 | QA LEAVE + integration: balance + request draft/submit/cancel/validati |
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
| `S3-LEAVE-SEED-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S3-LEAVE-SEED-1 | Leave types 8/8 + pin mã (audit §4.2, DB-10 §14.3): thêm MATERNITY/MAR |
| `S3-FE-LEAVE-7` | 🟢 | ✅ xong | [📄](S3-FE-LEAVE-7.md) | — | FE LeaveOverviewPage (/leave) — màn tổng quan nghỉ phép: balance summa |
| `S3-ATT-EXPORT-1` | 🟡 | ✅ xong | [📄](S3-ATT-EXPORT-1.md) | — | ATT export bảng công theo quyền (GET /attendance/records/export CSV, g |

## Sprint 4

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S4-TASK-DB-1` | 🔴 | ✅ xong | [📄](S4-TASK-DB-1.md) | — | Schema + migration TASK core (projects·project_members·tasks·task_assi |
| `S4-TASK-RECON-1` | 🔴 | ✅ xong | [📄](S4-TASK-RECON-1.md) | ✅S4-TASK-DB-1 | Đối soát pair-drift + grant tồn dư TASK: ánh xạ cặp legacy đang enforc |
| `S4-TASK-RECON-2` | 🔴 | ✅ xong | [📄](S4-TASK-RECON-2.md) | ✅S4-TASK-RECON-1 | CONTRACT pair-drift TASK: gỡ grant legacy ('comment','comment') khỏi e |
| `S4-TASK-SEED-1` | 🔴 | ✅ xong | [📄](S4-TASK-SEED-1.md) | ✅S4-TASK-DB-1 ✅S4-TASK-RECON-1 | Seed permission TASK (23 mã canonical DB-06 §12.1) + role-permission m |
| `S4-TASK-BE-1` | 🟡 | ✅ xong | [📄](S4-TASK-BE-1.md) | ✅S4-TASK-SEED-1 | BE Project CRUD + close/delete mềm + quản lý member (GET/POST /project |
| `S4-TASK-BE-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-TASK-BE-1 | BE Task CRUD + My-tasks + filter (GET/POST /tasks, GET/PATCH/DELETE /t |
| `S4-TASK-BE-3` | 🔴 | ✅ xong | [📄](S4-TASK-BE-3.md) | ✅S4-TASK-BE-2 | BE Task assignment + status workflow FSM (assign/đổi assignee, add/rem |
| `S4-TASK-BE-4` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-TASK-BE-3 | BE Kanban (board + move) + comment/mention + checklist + activity log  |
| `S4-NOTI-DB-1` | 🔴 | ✅ xong | [📄](S4-NOTI-DB-1.md) | ✅S4-TASK-DB-1 | Schema + migration NOTI (notification_events·notification_templates·no |
| `S4-NOTI-SEED-1` | 🔴 | ✅ xong | [📄](S4-NOTI-SEED-1.md) | ✅S4-NOTI-DB-1 | Seed notification event catalog (Event code registry §9.5 canonical) + |
| `S4-NOTI-SEED-2` | 🔴 | ✅ xong | [📄](S4-NOTI-SEED-2.md) | ✅S4-TASK-BE-3 | Vá catalog notification_events khớp registry §9.5 cho event TASK (BE-3 |
| `S4-NOTI-BE-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S4-NOTI-SEED-1 | BE My-notification APIs (GET /notifications, /dropdown, /unread-count, |
| `S4-NOTI-BE-2` | 🔴 | ✅ xong | [📄](S4-NOTI-BE-2.md) | ✅S4-NOTI-SEED-1 ✅S4-NOTI-BE-1 | BE Event intake + notification engine (POST /internal/v1/notifications |
| `S4-NOTI-BE-3` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-NOTI-BE-2 | BE Notification admin config (GET events/templates/delivery-logs, PATC |
| `S4-NOTI-BE-4` | 🔴 | ✅ xong | — *(chưa)* | ✅S4-NOTI-BE-3 | NOTI admin config WRITE: migration GRANT-only (INSERT,UPDATE notificat |
| `S4-DASH-DB-1` | 🔴 | ✅ xong | [📄](S4-DASH-DB-1.md) | ✅S4-NOTI-DB-1 | Schema + migration DASH (dashboard_widgets·dashboard_widget_configs·da |
| `S4-DASH-SEED-1` | 🔴 | ✅ xong | [📄](S4-DASH-SEED-1.md) | ✅S4-DASH-DB-1 ✅S4-NOTI-BE-1 | Seed widget catalog 7 In-sprint (§11.3) + permission DASH + default co |
| `S4-DASH-CATALOG-2` | 🔴 | ✅ xong | [📄](S4-DASH-CATALOG-2.md) | ✅S4-DASH-SEED-1 ✅S4-DASH-BE-2 | Bù đủ catalog widget DASH (11 widget còn lại của DB-07 §14.3) + reconc |
| `S4-DASH-BE-1` | 🔴 | ✅ xong | [📄](S4-DASH-BE-1.md) | ✅S4-DASH-SEED-1 | BE Dashboard resolver (GET /dashboard/me, /types, /:type) + widget reg |
| `S4-DASH-SEED-2` | 🔴 | ✅ xong | — *(chưa)* | — | Backfill grant read:dashboard cho role manager + hr (role sinh ở 0444  |
| `S4-DASH-BE-2` | 🔴 | ✅ xong | [📄](S4-DASH-BE-2.md) | ✅S4-DASH-BE-1 ✅S4-TASK-BE-2 ✅S4-NOTI-BE-1 | BE Widget data services (GET /dashboard/widgets, /widgets/:slug) cho 7 |
| `S4-INT-1` | 🔴 | ✅ xong | [📄](S4-INT-1.md) | ✅S4-TASK-BE-3 ✅S4-TASK-BE-4 ✅S4-NOTI-BE-2 ✅S4-NOTI-SEED-2 | Tích hợp TASK → NOTI: wiring event producer (outbox) → consumer intake |
| `S4-INT-2` | 🟡 | ✅ xong | [📄](S4-INT-2.md) | ✅S4-DASH-BE-2 ✅S4-INT-1 | Tích hợp DASH cache invalidation từ event TASK/NOTI/ATT/LEAVE (POST /i |
| `S4-FE-REGISTRY-1` | 🟢 | ✅ xong | [📄](S4-FE-REGISTRY-1.md) | — | FE đăng ký module TASK·NOTI·DASH vào route/sidebar/action registry + q |
| `S4-FE-TASK-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-TASK-BE-1 ✅S4-FE-REGISTRY-1 | FE Project screens: ProjectListPage · ProjectDetailPage · ProjectFormD |
| `S4-FE-TASK-CLEANUP-1` | 🟢 | ✅ xong | — *(chưa)* | — | Gỡ/chuyển tasksApi legacy (web-core tasks-api.ts) — code chết gọi GET  |
| `S4-FE-TASK-2` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-TASK-BE-3 ✅S4-FE-REGISTRY-1 | FE Task screens: TaskListPage · MyTasksPage · TaskDetailPage · TaskFor |
| `S4-FE-TASK-3` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-TASK-BE-4 ✅S4-FE-TASK-2 | FE Task collaboration: TaskKanbanPage (drag-drop) · TaskCommentThread  |
| `S4-FE-NOTI-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-NOTI-BE-1 ✅S4-FE-REGISTRY-1 | FE Notification: NotificationBadge · NotificationDropdown · Notificati |
| `S4-FE-NOTI-CLEANUP-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-FE-NOTI-1 | Gỡ dứt điểm NotificationBell (@mediaos/ui) + notification-api legacy ( |
| `S4-FE-DASH-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-DASH-BE-2 ✅S4-FE-REGISTRY-1 | FE Dashboard shell + P0 widgets: DashboardMePage · DashboardWidgetGrid |
| `S4-FE-DASH-2` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-DASH-BE-2 ✅S4-FE-DASH-1 | FE Dashboard widget mở rộng: AttendanceTodayWidget · PendingLeaveWidge |
| `S4-QA-1` | 🟡 | ✅ xong | [📄](S4-QA-1.md) | ✅S4-TASK-BE-4 ✅S4-NOTI-BE-2 ✅S4-DASH-BE-2 | QA Sprint 4 permission/data-scope + deny-path: TASK CRUD/assign/status |
| `S4-QA-2` | 🟡 | ✅ xong | [📄](S4-QA-2.md) | ✅S4-INT-2 ✅S4-FE-DASH-2 ✅S4-QA-1 | QA Sprint 4 E2E + regression sign-off: flow task→noti→dash (§15.1) + n |
| `S4-TASK-BE-5` | 🟡 | ✅ xong | [📄](S4-TASK-BE-5.md) | ✅S4-TASK-BE-2 | BE TASK file (project/task) qua FileService + file_links + Project pro |
| `S4-FE-TASK-4` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-TASK-BE-5 ✅S4-FE-TASK-2 | FE TaskFilePanel (upload/list/download/delete theo quyền) + ProjectPro |
| `S4-DASH-BE-3` | 🟡 | ✅ xong | [📄](S4-DASH-BE-3.md) | ✅S4-DASH-BE-1 | BE Dashboard widget config CRUD (GET /dashboard/configs, PATCH /config |
| `S4-FE-DASH-3` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-DASH-BE-3 ✅S4-FE-DASH-1 | FE DashboardConfigPage (cấu hình widget theo role/user/dashboard-type: |
| `S4-FE-NOTI-2` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-NOTI-BE-4 ✅S4-FE-REGISTRY-1 | FE Notification Events admin (UI-NOTI-SCREEN-004): bảng event catalog  |
| `S4-FE-NOTI-3` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-NOTI-BE-3 ✅S4-FE-REGISTRY-1 | FE Notification Delivery Logs read-only (UI-NOTI-SCREEN-006): bảng app |
| `S4-NOTI-BE-5` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-NOTI-BE-4 | NOTI admin templates LIST: GET /notifications/templates (filter event/ |
| `S4-FE-NOTI-4` | 🟢 | ✅ xong | — *(chưa)* | ✅S4-NOTI-BE-5 ✅S4-FE-REGISTRY-1 | FE Notification Templates admin (NOTI-SCREEN-006 / UI-NOTI-SCREEN-005) |
| `S4-QA-TASK-1` | 🟡 | ✅ xong | [📄](S4-QA-TASK-1.md) | ✅S4-TASK-BE-4 | QA TASK permission/data-scope + deny-path (tách khỏi S4-QA-1 để chạy n |
| `S4-QA-NOTI-1` | 🟡 | ✅ xong | [📄](S4-QA-NOTI-1.md) | ✅S4-NOTI-BE-4 | QA NOTI permission/own-scope + deny-path (tách khỏi S4-QA-1): own-scop |
| `S4-INT-3` | 🔴 | ✅ xong | [📄](S4-INT-3.md) | ✅S4-INT-1 | Tích hợp LEAVE → NOTI qua OutboxNotificationBridge (INT-1): event-type |
| `S4-INT-4` | 🔴 | ✅ xong | [📄](S4-INT-4.md) | ✅S4-INT-1 | Tích hợp ATT → NOTI: bổ sung producer outbox trong ATT (adjustment sub |
| `S4-INT-5` | 🔴 | ✅ xong | [📄](S4-INT-5.md) | ✅S4-INT-1 | Tích hợp HR/AUTH → NOTI: HR tạo employee → activation/welcome notifica |

## Sprint 5

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S5-DEVOPS-1` | 🟡 | ✅ xong | [📄](S5-DEVOPS-1.md) | — | Staging/UAT readiness: env + deploy pipeline + migration/seed chạy từ  |
| `S5-QA-E2E-1` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S4-QA-2 | Integration freeze + system smoke P0 + cross-module E2E: login→Home Po |
| `S5-BE-CONTRACT-1` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S4-QA-2 | API contract & OpenAPI/Swagger chuẩn hoá theo module + FE integration  |
| `S5-SEC-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S4-QA-2 | Permission & data-scope hardening + field-level/export permission + se |
| `S5-QA-REG-1` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S4-QA-2 | QA regression suite MVP (test-case matrix theo module × role) + UI sta |
| `S5-QA-DASHNOTI-1` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S4-QA-2 ✅S4-INT-2 | Dashboard & Notification hardening: widget degraded/cache đúng, unread |
| `S5-PERF-1` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S4-QA-2 | Performance/reliability smoke + observability baseline: SLA danh sách  |
| `S5-UAT-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S5-QA-E2E-1 ⏳S5-QA-REG-1 ⏳S5-SEC-1 | UAT prep + run (script theo role · test data · sign-off) + release rea |
| `S5-QA-GATE-LANEDB-1` | 🟡 | ✅ xong | [📄](S5-QA-GATE-LANEDB-1.md) | — | Vá false-green cổng local: harness/check.sh chạy `pnpm test` KHÔNG set |
| `S5-FND-JOBS-OBS-1` | 🟡 | ✅ xong | — *(chưa)* | — | System Jobs observability: GET /foundation/system-jobs đọc lịch sử sys |
| `S5-ME-DOC-1` | 🟢 | ✅ xong | [📄](S5-ME-DOC-1.md) | — | Docs sync SPEC-09 ME: cập nhật SPEC-01/PRD-00/DB-01·08·09·10/README §8 |
| `S5-ME-DB-1` | 🔴 | ✅ xong | [📄](S5-ME-DB-1.md) | — | Schema + migration user_preferences (SPEC-09 §15.2) — RLS+FORCE, uniqu |
| `S5-ME-BE-1` | 🔴 | ✅ xong | [📄](S5-ME-BE-1.md) | ✅S5-ME-DB-1 | BE MeModule aggregation: GET /me + /me/overview + attendance/leave/tas |
| `S5-ME-BE-2` | 🟡 | ✅ xong | [📄](S5-ME-BE-2.md) | ✅S5-ME-DB-1 ✅S5-ME-BE-1 | BE preferences + avatar: GET/PATCH /me/preferences (+appearance) upser |
| `S5-ME-BE-3` | 🔴 | ✅ xong | [📄](S5-ME-BE-3.md) | ✅S5-ME-BE-1 | BE Hoạt động bảo mật own-scope: GET /me/security/activity đọc login_lo |
| `S5-ME-FE-1` | 🟡 | ✅ xong | [📄](S5-ME-FE-1.md) | ✅S5-ME-DB-1 ✅S5-ME-BE-1 | FE registry + shell + Tổng quan ME (ME-SCREEN-001): ModuleCode/APP_REG |
| `S5-ME-FE-2` | 🟡 | ✅ xong | [📄](S5-ME-FE-2.md) | ✅S5-ME-FE-1 ✅S5-ME-BE-3 | FE Hồ sơ của tôi + Tài khoản & bảo mật dưới /me/*: TÁI DÙNG MyProfileP |
| `S5-ME-FE-3` | 🟢 | ✅ xong | [📄](S5-ME-FE-3.md) | ✅S5-ME-FE-1 ✅S5-ME-BE-2 | FE Công việc của tôi (ATT/LEAVE/TASK summary + deep-link) + Thông báo  |
| `S5-ME-QA-1` | 🟡 | ✅ xong | [📄](S5-ME-QA-1.md) | ✅S5-ME-BE-2 ✅S5-ME-BE-3 | QA ME: IDOR sweep mọi endpoint /me/* + cross-user/cross-tenant + aggre |
| `S5-HR-LINKUI-1` | 🟡 | ✅ xong | — *(chưa)* | — | FE liên kết/hủy liên kết hồ sơ nhân viên ↔ tài khoản có sẵn trên trang |
| `S5-HR-IMPORT-BE-1` | 🔴 | ✅ xong | [📄](S5-HR-IMPORT-BE-1.md) | ✅S5-ME-DB-1 | BE import nhân viên hàng loạt: seed cặp permission ('import','employee |
| `S5-HR-IMPORT-FE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-HR-IMPORT-BE-1 | FE import nhân viên hàng loạt: màn upload file + tải template + previe |
| `S5-HR-ORGCHART-BE-1` | 🔴 | ✅ xong | [📄](S5-HR-ORGCHART-BE-1.md) | — | BE sơ đồ tổ chức: GET /hr/org-chart/employees (cây nhân sự theo quản l |
| `S5-HR-ORGCHART-FE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-HR-ORGCHART-BE-1 | FE sơ đồ tổ chức trực quan /hr/org-chart: tab Phòng ban (node-chart +  |
| `S5-HR-WORKINFO-1` | 🟡 | ✅ xong | [📄](S5-HR-WORKINFO-1.md) | — | Hoàn thiện khối Thông tin công việc (chi tiết nhân viên + hồ sơ của tô |
| `S5-FE-TASK-NAV-1` | 🟢 | ✅ xong | — *(chưa)* | — | Sidebar TASK mở đường: thêm mục 'Dự án' (/tasks/projects) + đổi label  |
| `S5-TASK-BE-6` | 🟢 | ✅ xong | — *(chưa)* | — | Kanban counts (trả nợ SPEC-06 §13.8): GET /projects/:id/kanban bổ sung |
| `S5-FE-TASK-5` | 🟢 | ✅ xong | — *(chưa)* | ✅S5-TASK-BE-6 | Kanban card giàu tín hiệu (benchmark): badge comment/attachment/checkl |
| `S5-FE-TASK-6` | 🟡 | ✅ xong | [📄](S5-FE-TASK-6.md) | ✅S5-FE-TASK-NAV-1 | TASK-SCREEN-010 Task quá hạn (/tasks/overdue) + TASK-SCREEN-011 Báo cá |
| `S5-LEAVE-HOLIDAYS-MOVE-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S5-FE-TASK-NAV-1 | Chuyển màn Ngày nghỉ lễ /system/public-holidays → /leave/public-holida |
| `S5-NOTI-FIX-1` | 🔴 | ✅ xong | [📄](S5-NOTI-FIX-1.md) | — | Backfill target_url_template cho 39 template notification global (QA2- |
| `S5-NOTI-FIX-2` | 🔴 | ✅ xong | [📄](S5-NOTI-FIX-2.md) | — | Vá 3 event render placeholder câm TASK_COMMENT_CREATED · TASK_MENTIONE |
| `S5-TASK-HRCODE-1` | 🔴 | ✅ xong | [📄](S5-TASK-HRCODE-1.md) | ✅S5-NOTI-FIX-2 | Cấp task_code cho task HR (createApprovalTaskTx ← leave/attendance-adj |
| `S5-LEAVE-DEADCODE-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S5-TASK-HRCODE-1 | Dọn khối LeaveService chết (createRequest/approveRequest/rejectRequest |
| `S5-SEQ-HARDEN-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S5-TASK-HRCODE-1 | Gia cố cấp mã tuần tự: SAVEPOINT cho recovery 23505 (ensure-on-miss ra |
| `S5-TASK-PIPELINE-1` | 🔴 | ⬜ chờ | [📄](S5-TASK-PIPELINE-1.md) | ✅S5-TASK-HRCODE-1 | Đợt A — Kanban cột pipeline tuỳ biến theo dự án (project_states) thay  |
| `S5-TASK-NAV-TREE-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S5-TASK-PIPELINE-1 | Đợt B — Sidebar cây phòng ban: dự án lồng dưới phòng ban + menu ⋯ mỗi  |
| `S5-TASK-WORKSPACE-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S5-TASK-PIPELINE-1 | Đợt D1 — Vỏ workspace dự án: tab bar (Bảng·Danh sách·Báo cáo·Hoạt động |
| `S5-TASK-DETAIL-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S5-TASK-PIPELINE-1 | Màn chi tiết task — vá 4 gap TRONG SPEC chưa làm: timeline hiện dữ liệ |

## Sprint 6

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S6-GOV-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S5-UAT-1 | Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đ |
| `S6-STAB-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S5-UAT-1 | Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/AT |
| `S6-QA-FINAL-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S6-STAB-1 | QA final pass: regression + E2E + API contract + regression-theo-role  |
| `S6-SEC-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S6-STAB-1 | Security / RBAC / Data-Protection final hardening: auth/session · RBAC |
| `S6-PERF-DB-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S6-STAB-1 | Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback  |
| `S6-REL-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S6-QA-FINAL-1 ⏳S6-SEC-1 ⏳S6-PERF-DB-1 | Release Candidate build + release notes + Go-live runbook + deployment |
| `S6-GOLIVE-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S6-REL-1 | Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/su |

## Khác

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `HR-PROFILE-UI-1` | 🔴 | ✅ xong | — *(chưa)* | — | Nâng cấp màn Hồ sơ nhân sự: dải tổng quan (headcount+donut giới tính+4 |
| `HR-PROFILE-UI-2` | 🟡 | ✅ xong | [📄](HR-PROFILE-UI-2.md) | ✅HR-PROFILE-UI-1 | Hồ sơ nhân sự phần 2: gom nhóm bảng 1/2 cấp (Tùy chỉnh cột) + export d |
| `HR-PERF-1` | 🔴 | ✅ xong | [📄](HR-PERF-1.md) | ✅HR-PROFILE-UI-1 | Tối ưu hiệu năng nền tảng: (a) code-split router theo module (bundle a |
| `HR-IDENTITY-READ-1` | 🔴 | ✅ xong | [📄](HR-IDENTITY-READ-1.md) | ✅HR-PROFILE-UI-1 | Lộ identity_number/issue_date/issue_place (CCCD §14.18) qua read surfa |

---

**Quy ước micro-plan** (tái dùng qua auto-loop): mỗi WO có file `docs/plans/<id>.md` với frontmatter máy-đọc
(`lanes/acceptanceChecks/testTasks/steps`) + phần prose reconcile. Auto-loop đọc plan nếu có (reconcile-refresh),
chưa có thì tạo + lưu. Xem file mẫu: `docs/plans/S0-FND-DB-1-reconcile.md`.
