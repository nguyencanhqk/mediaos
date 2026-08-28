# INDEX — Tổng quan Work Order đang hành

> **TỰ SINH** bởi `harness/gen-plan-index.mjs` — KHÔNG sửa tay (chạy lại sau khi đổi backlog/ledger/plan).
> Nguồn: `harness/backlog.mjs` (WO) + `activity.jsonl` (trạng thái) + `docs/plans/<id>.md` (micro-plan).
> Roadmap đầy đủ 112 story / 7 sprint: **IMPLEMENTATION-02 §7** (KHÔNG nhân bản ở đây — pull-sprint).

**419 WO** · có micro-plan: **240/419** · ⬜ 12 chờ · 🔵 0 đang làm · ✅ 407 xong · 🔴 0 chặn

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
| `S5-QA-E2E-1` | 🟡 | ✅ xong | [📄](S5-QA-E2E-1.md) | ✅S4-QA-2 | Integration freeze + system smoke P0 + cross-module E2E: login→Home Po |
| `S5-BE-CONTRACT-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-QA-2 | API contract & OpenAPI/Swagger chuẩn hoá theo module + FE integration  |
| `S5-SEC-1` | 🔴 | ✅ xong | [📄](S5-SEC-1.md) | ✅S4-QA-2 | Permission & data-scope hardening + field-level/export permission + se |
| `S5-QA-REG-1` | 🟡 | ✅ xong | [📄](S5-QA-REG-1.md) | ✅S4-QA-2 | QA regression suite MVP (test-case matrix theo module × role) + UI sta |
| `S5-QA-DASHNOTI-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-QA-2 ✅S4-INT-2 | Dashboard & Notification hardening: widget degraded/cache đúng, unread |
| `S5-PERF-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S4-QA-2 | Performance/reliability smoke + observability baseline: SLA danh sách  |
| `S5-UAT-1` | 🟡 | ✅ xong | [📄](S5-UAT-1.md) | ✅S5-QA-E2E-1 ✅S5-QA-REG-1 ✅S5-SEC-1 | UAT prep + run (script theo role · test data · sign-off) + release rea |
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
| `S5-TASK-DEPTFILTER-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-GOAL-FE-2 | GET /tasks bổ sung filter departmentId + search (trả nợ #272): gỡ ràng |
| `S5-FE-TASK-5` | 🟢 | ✅ xong | — *(chưa)* | ✅S5-TASK-BE-6 | Kanban card giàu tín hiệu (benchmark): badge comment/attachment/checkl |
| `S5-FE-TASK-6` | 🟡 | ✅ xong | [📄](S5-FE-TASK-6.md) | ✅S5-FE-TASK-NAV-1 | TASK-SCREEN-010 Task quá hạn (/tasks/overdue) + TASK-SCREEN-011 Báo cá |
| `S5-LEAVE-HOLIDAYS-MOVE-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S5-FE-TASK-NAV-1 | Chuyển màn Ngày nghỉ lễ /system/public-holidays → /leave/public-holida |
| `S5-NOTI-FIX-1` | 🔴 | ✅ xong | [📄](S5-NOTI-FIX-1.md) | — | Backfill target_url_template cho 39 template notification global (QA2- |
| `S5-NOTI-FIX-2` | 🔴 | ✅ xong | [📄](S5-NOTI-FIX-2.md) | — | Vá 3 event render placeholder câm TASK_COMMENT_CREATED · TASK_MENTIONE |
| `S5-TASK-HRCODE-1` | 🔴 | ✅ xong | [📄](S5-TASK-HRCODE-1.md) | ✅S5-NOTI-FIX-2 | Cấp task_code cho task HR (createApprovalTaskTx ← leave/attendance-adj |
| `S5-LEAVE-DEADCODE-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S5-TASK-HRCODE-1 | Dọn khối LeaveService chết (createRequest/approveRequest/rejectRequest |
| `S5-SEQ-HARDEN-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S5-TASK-HRCODE-1 | Gia cố cấp mã tuần tự: SAVEPOINT cho recovery 23505 (ensure-on-miss ra |
| `S5-TASK-PIPELINE-1` | 🔴 | ✅ xong | [📄](S5-TASK-PIPELINE-1.md) | ✅S5-TASK-HRCODE-1 | Đợt A — Kanban cột pipeline tuỳ biến theo dự án (project_states) thay  |
| `S5-TASK-NAV-TREE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-TASK-PIPELINE-1 | Đợt B — Sidebar cây phòng ban: dự án lồng dưới phòng ban + menu ⋯ mỗi  |
| `S5-TASK-WORKSPACE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-TASK-PIPELINE-1 | Đợt D1 — Vỏ workspace dự án: tab bar (Bảng·Danh sách·Báo cáo·Hoạt động |
| `S5-TASK-DETAIL-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-TASK-PIPELINE-1 | Màn chi tiết task — vá 4 gap TRONG SPEC chưa làm: timeline hiện dữ liệ |
| `S5-TASK-SUBTASK-1` | 🔴 | ✅ xong | [📄](S5-TASK-SUBTASK-1.md) | ✅S5-TASK-PIPELINE-1 | Công việc con = subtask THẬT (parent_task_id): CRUD + người thực hiện/ |
| `S5-DASH-TASKSTATUS-FIX-1` | 🔴 | ✅ xong | [📄](S5-DASH-TASKSTATUS-FIX-1.md) | — | Dashboard đếm SAI cột trạng thái: mv_dashboard_task_status GROUP BY `s |
| `S5-TASK-PROJROLE-1` | 🔴 | ✅ xong | [📄](S5-TASK-PROJROLE-1.md) | ✅S5-TASK-PIPELINE-1 | Đợt C — Quyền per-project THẬT: projectRole (Owner/Manager/Member/View |
| `S5-TASK-BOARD-UX-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-TASK-PIPELINE-1 ✅S5-TASK-DETAIL-1 | Board: bấm thẻ mở chi tiết trong panel TRƯỢT PHẢI (?task=, giữ ngữ cản |
| `S5-TASK-INLINE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-TASK-BOARD-UX-1 | Màn chi tiết task: bố cục lại (dự án + trạng thái + ưu tiên lên dải đầ |
| `S5-TASK-AVATAR-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-ME-BE-5 | Avatar người phụ trách trong TASK (Nhóm C của hệ avatar): nối 3 mắt xí |
| `S5-TASK-CARDSUB-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S5-TASK-SUBTASK-1 | Thẻ board: nút trỏ xuống bung danh sách việc con ngay trên thẻ (tải lư |
| `S5-TASK-MOVEPROJ-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-TASK-INLINE-1 | VÁ BUG state_id mồ côi khi đổi dự án + đường đổi dự án ĐÚNG MỘT chỗ (h |
| `S5-TASK-COVER-1` | 🔴 | ✅ xong | [📄](S5-TASK-COVER-1.md) | ✅S5-TASK-AVATAR-1 | Ảnh bìa cho công việc — chọn từ TỆP ĐÃ ĐÍNH KÈM (file_links Attachment |
| `S5-GOAL-DOC-1` | 🟢 | ✅ xong | — *(chưa)* | — | Docs sync SPEC-10 GOAL: SPEC-01/PRD-00/DB-01·09·10 ghi nhận GOAL + API |
| `S5-GOAL-DB-1` | 🔴 | ✅ xong | [📄](S5-GOAL-DB-1.md) | — | Schema + migration goals + goal_updates (append-only) + tasks.goal_id  |
| `S5-GOAL-BE-1` | 🔴 | ✅ xong | [📄](S5-GOAL-BE-1.md) | ✅S5-GOAL-DB-1 | BE GoalsModule: CRUD 3 cấp + cây theo kỳ + data-scope service-layer (o |
| `S5-GOAL-BE-2` | 🔴 | ✅ xong | [📄](S5-GOAL-BE-2.md) | ✅S5-GOAL-BE-1 | BE progress engine 4 mode + rollup bubble + job đối soát đêm (system-j |
| `S5-GOAL-FE-1` | 🟡 | ✅ xong | [📄](S5-GOAL-FE-1.md) | ✅S5-GOAL-BE-1 | FE trang Mục tiêu: menu sidebar riêng + danh sách/cây theo kỳ·phòng ba |
| `S5-GOAL-FE-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-GOAL-BE-2 ✅S5-GOAL-FE-1 | FE vòng đo: check-in modal + lịch sử + nút chốt kỳ/mở lại + gắn goal t |
| `S5-GOAL-DB-2` | 🔴 | ✅ xong | [📄](S5-GOAL-DB-2.md) | ✅S5-GOAL-DB-1 | Đợt D — Schema + migration task_templates + task_template_items + RLS  |
| `S5-GOAL-TPL-1` | 🟡 | ✅ xong | [📄](S5-GOAL-TPL-1.md) | ✅S5-GOAL-DB-2 ✅S5-GOAL-FE-2 | Đợt D — Phân rã mục tiêu từ template: CRUD template (BE+FE, GOAL-SCREE |
| `S5-FND-REVOKE-1` | 🔴 | ✅ xong | [📄](S5-FND-REVOKE-1.md) | ✅S5-GOAL-DB-1 | Nợ di sản G-era (finding MEDIUM gate S5-GOAL-DB-1): REVOKE DELETE org_ |
| `S5-GOAL-DASH-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-GOAL-BE-2 ✅S5-GOAL-FE-1 | Đợt E — Widget dashboard 'Mục tiêu kỳ này' (progress theo phòng ban, đ |
| `S5-LMS-DB-1` | 🔴 | ✅ xong | [📄](S5-LMS-DB-1.md) | — | Mig 0509 (kiểm _journal trước khi đánh số): UNION-ADD audit object_typ |
| `S5-LMS-BE-1` | 🔴 | ✅ xong | [📄](S5-LMS-BE-1.md) | ✅S5-LMS-DB-1 | Auto-sync tài khoản MediaOS→LMS: outbox event RIÊNG hr.employee_status |
| `S5-LMS-BE-2` | 🔴 | ✅ xong | [📄](S5-LMS-BE-2.md) | ✅S5-LMS-DB-1 | Trả nợ audit #253: ghi audit_logs objectType 'lms_sso' action sso_link |
| `S5-LMS-APP-1` | 🟡 | ✅ xong | [📄](S5-LMS-APP-1.md) | — | LOCAL apps/lms — chuẩn hoá UI: '/' hết landing (có phiên → /course, ch |
| `S5-LMS-APP-2` | 🔴 | ✅ xong | [📄](S5-LMS-APP-2.md) | ✅S5-LMS-BE-1 ✅S5-LMS-APP-3 | LOCAL apps/lms — SSO-only: cờ env SSO_ONLY=true → đóng register/forgot |
| `S5-LMS-APP-3` | 🔴 | ✅ xong | [📄](S5-LMS-APP-3.md) | ✅S5-LMS-APP-1 | LOCAL apps/lms — API export tiến độ: GET /api/mediaos/progress?email=  |
| `S5-LMS-BE-3` | 🔴 | ✅ xong | [📄](S5-LMS-BE-3.md) | ✅S5-LMS-APP-3 | Proxy tiến độ đào tạo vào MediaOS: GET /me/training (email resolve TỪ  |
| `S5-LMS-FE-1` | 🟡 | ✅ xong | [📄](S5-LMS-FE-1.md) | ✅S5-LMS-BE-3 | FE /me: card 'Đào tạo' trong MeOverviewPage (fail-soft như 5 section h |
| `S5-LMS-BE-4` | 🔴 | ✅ xong | [📄](S5-LMS-BE-4.md) | ✅S5-LMS-BE-1 | Job đối soát LMS chỉ ghi audit khi CÓ THAY ĐỔI THẬT: LmsHttpClient.syn |
| `S5-LMS-UI-1` | 🟢 | ✅ xong | [📄](S5-LMS-UI-1.md) | — | LOCAL apps/lms — đồng bộ TOKEN màu với MediaOS: port giá trị :root/.da |
| `S5-LMS-UI-2` | 🟢 | ✅ xong | [📄](S5-LMS-UI-2.md) | ✅S5-LMS-UI-1 ✅S5-FND-UI-GEN-1 | LOCAL apps/lms — đồng bộ COMPONENT LÕI với MediaOS: button/badge/card/ |
| `S5-LMS-UI-3` | 🟢 | ✅ xong | [📄](S5-LMS-UI-3.md) | — | LOCAL apps/lms — port CẤU TRÚC SHELL về khung MediaOS: topbar full-wid |
| `S5-LMS-UI-4` | 🟢 | ✅ xong | [📄](S5-LMS-UI-4.md) | ✅S5-LMS-UI-3 | LOCAL apps/lms — hòa chrome vào MediaOS: App Switcher thành launcher t |
| `S5-LMS-OPEN-DIRECT-1` | 🟢 | ✅ xong | — *(chưa)* | — | MediaOS apps/app — mở LMS 'vào thẳng': tile Đào tạo (App Switcher) + n |
| `S5-LMS-NOTI-1` | 🔴 | ✅ xong | [📄](S5-LMS-NOTI-1.md) | — | MediaOS BE — mở đường cho LMS đẩy thông báo vào module NOTI: seed nhóm |
| `S5-LMS-NOTI-2` | 🟡 | ✅ xong | [📄](S5-LMS-NOTI-2.md) | ✅S5-LMS-NOTI-1 | LOCAL apps/lms — đẩy sự kiện học tập về NOTI của MediaOS (ghi danh đượ |
| `S5-FND-THEME-AA-1` | 🟢 | ✅ xong | [📄](S5-FND-THEME-AA-1.md) | — | packages/ui theme.css — kéo 4 cặp token trượt AA ở chế độ LIGHT lên ≥4 |
| `S5-FND-UI-GEN-1` | 🟡 | ✅ xong | [📄](S5-FND-UI-GEN-1.md) | — | packages/ui — nâng primitive lên thế hệ shadcn mới (button/badge/input |
| `S5-SYS-CLEAN-1` | 🔴 | ✅ xong | [📄](S5-SYS-CLEAN-1.md) | ✅S5-LMS-BE-4 | Retention cho system_job_runs (47.126 dòng/18 MB, tăng mỗi nhịp schedu |
| `S5-DEVOPS-DEPLOYMIG-1` | 🟡 | ✅ xong | [📄](S5-DEVOPS-DEPLOYMIG-1.md) | — | m prod-update: chèn bước MIGRATE trước RESTART (fail-closed — migrate  |
| `S5-BRAND-BE-1` | 🟡 | ✅ xong | — *(chưa)* | — | BE Thương hiệu công ty: wrapper presign logo + favicon trên FileServic |
| `S5-BRAND-FE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S5-BRAND-BE-1 | FE khối 'Thương hiệu' trong /system/company: upload/preview/gỡ logo +  |
| `S5-BRAND-FE-2` | 🟢 | ✅ xong | — *(chưa)* | ✅S5-BRAND-BE-1 | FE áp thương hiệu ra vỏ app: GlobalTopbar hiện logo công ty (fallback  |

## Sprint 6

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S6-GOV-1` | 🟡 | ✅ xong | [📄](S6-GOV-1.md) | ✅S5-UAT-1 | Scope Freeze & Release Governance: đóng băng scope MVP, quy tắc thay đ |
| `S6-STAB-1` | 🟡 | ✅ xong | [📄](S6-STAB-1.md) | ✅S5-UAT-1 | Stabilization & Bug Triage: module stabilization checklist (AUTH/HR/AT |
| `S6-QA-FINAL-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S6-STAB-1 | QA final pass: regression + E2E + API contract + regression-theo-role  |
| `S6-SEC-1` | 🔴 | ✅ xong | [📄](S6-SEC-1.md) | ✅S6-STAB-1 | Security / RBAC / Data-Protection final hardening: auth/session · RBAC |
| `S6-PERF-DB-1` | 🔴 | ✅ xong | [📄](S6-PERF-DB-1.md) | ✅S6-STAB-1 | Performance/Query/Cache hardening + DB Migration/Seed/Backup/Rollback  |
| `S6-QA-CHUNK-1` | 🟡 | ✅ xong | [📄](S6-QA-CHUNK-1.md) | — | KI-014 — truy gốc crash ERR_IPC_CHANNEL_CLOSED rồi chuẩn hoá chạy test |
| `S6-SEC-ROUTEMAP-1` | 🟡 | ✅ xong | [📄](S6-SEC-ROUTEMAP-1.md) | — | Dựng lại Phụ lục A bằng QUÉT RUNTIME (boot AppModule, đọc metadata thậ |
| `S6-SEC-ORG-1` | 🔴 | ✅ xong | [📄](S6-SEC-ORG-1.md) | ✅S6-SEC-ROUTEMAP-1 | KI-030 — gate 3 route đọc /org đang lộ danh bạ toàn tenant cho MỌI use |
| `S6-SEC-ORGSCOPE-1` | 🔴 | ✅ xong | [📄](S6-SEC-ORGSCOPE-1.md) | ✅S6-SEC-ORG-1 | N-1 (hậu FULL gate S6-SEC-ORG-1) — ép data_scope trong OrgRepository.l |
| `S6-SEC-ORGTEAMSCOPE-1` | 🔴 | ✅ xong | [📄](S6-SEC-ORGTEAMSCOPE-1.md) | ✅S6-SEC-ORGSCOPE-1 | N-1c (FULL gate S6-SEC-ORGSCOPE-1 phát hiện) — GET /org/teams/:id/memb |
| `S6-SEC-IDENTITY-PROJ-1` | 🔴 | ✅ xong | [📄](S6-SEC-IDENTITY-PROJ-1.md) | ✅S6-SEC-ORGTEAMSCOPE-1 | Gốc rễ của N-1/N-2/N-1c — buộc TẦNG CHIẾU `users.email`/`users.fullNam |
| `S6-SEC-IDENTITYBOUND-1` | 🔴 | ✅ xong | [📄](S6-SEC-IDENTITYBOUND-1.md) | ✅S6-SEC-ORGTEAMSCOPE-1 | N-1d/N-1e (KI-051 · KI-052) — bound hai đường chiếu danh tính còn hở:  |
| `S6-SEC-PERMVERB-1` | 🔴 | ✅ xong | [📄](S6-SEC-PERMVERB-1.md) | ✅S6-SEC-ORG-1 | N-2 (hậu FULL gate S6-SEC-ORG-1) — chốt MỘT động từ giữa `read:user` ( |
| `S6-SEC-NOTITX-1` | 🔴 | ✅ xong | [📄](S6-SEC-NOTITX-1.md) | — | KI-034 — gộp insert notification + outbox + audit vào MỘT transaction  |
| `S6-SEC-LOGINLOG-1` | 🔴 | ✅ xong | [📄](S6-SEC-LOGINLOG-1.md) | — | KI-042 — login_logs: hàng company_id IS NULL (thử đăng nhập pre-auth,  |
| `S6-SEC-LOGINLOG-2` | 🔴 | ✅ xong | [📄](S6-SEC-LOGINLOG-2.md) | ✅S6-SEC-LOGINLOG-1 | KI-044 — hàng blocked/TooManyAttempts ghi company_id NULL kể cả khi sl |
| `S6-SEC-XTENANTFK-1` | 🔴 | ✅ xong | [📄](S6-SEC-XTENANTFK-1.md) | ✅S6-QA-TENANTWRITE-1 | KI-046 — 457 khoá ngoại MỘT-CỘT nối hai bảng tenant (số đúng: 460 một- |
| `S6-SEC-MV-1` | 🔴 | ✅ xong | [📄](S6-SEC-MV-1.md) | ✅S6-SEC-LOGINLOG-1 | KI-041 — 2 matview dashboard nằm NGOÀI RLS (Postgres không hỗ trợ): dự |
| `S6-SEC-DBFENCE-1` | 🔴 | ✅ xong | [📄](S6-SEC-DBFENCE-1.md) | — | KI-028 MỞ LẠI — test ghi thẳng vào DB PROD: bịt nguồn rò (vitest.confi |
| `S6-SEC-ROTATE-1` | 🔴 | ✅ xong | [📄](S6-SEC-ROTATE-1.md) | — | KI-043 (S0, CHẶN GO-LIVE) — mật khẩu Postgres PROD chính là literal tr |
| `S6-QA-TENANTWRITE-1` | 🔴 | ✅ xong | [📄](S6-QA-TENANTWRITE-1.md) | — | KI-037 — lưới tenant-isolation (156 bảng × 3 ca) CHỈ SELECT: không có  |
| `S6-REL-1` | 🔴 | ✅ xong | [📄](S6-REL-1.md) | ✅S6-QA-FINAL-1 ✅S6-SEC-1 ✅S6-PERF-DB-1 ✅S6-QA-CHUNK-1 ✅S6-SEC-ROUTEMAP-1 ✅S6-SEC-ORG-1 ✅S6-SEC-NOTITX-1 ✅S6-SEC-LOGINLOG-1 ✅S6-SEC-MV-1 | Release Candidate build + release notes + Go-live runbook + deployment |
| `S6-GOLIVE-1` | 🔴 | ✅ xong | [📄](S6-GOLIVE-1.md) | ✅S6-REL-1 | Final Sign-off · Go/No-go · Go-live execution · Handoff (admin/user/su |
| `S6-OPS-LOGWINDOW-1` | 🟡 | ✅ xong | [📄](S6-OPS-LOGWINDOW-1.md) | — | Cảnh báo vận hành đếm SAI cửa sổ — ops-alert-check trả CRIT vì đếm 5 n |
| `S6-LEAVE-ACCRUAL-1` | 🔴 | ✅ xong | [📄](S6-LEAVE-ACCRUAL-1.md) | — | Engine cộng dồn phép theo chính sách (accrual_method) — cấp vào NGÀY C |
| `S6-LEAVE-CARRYOVER-1` | 🔴 | ✅ xong | [📄](S6-LEAVE-CARRYOVER-1.md) | ✅S6-LEAVE-ACCRUAL-1 | Chuyển tiếp phép chưa nghỉ sang năm sau + hết hạn theo mốc CẤU HÌNH ĐƯ |
| `S6-LEAVE-MAXNEG-1` | 🔴 | ✅ xong | [📄](S6-LEAVE-MAXNEG-1.md) | — | Ép trần số ngày âm (max_negative_days) ở đường quyết định đơn nghỉ — h |
| `S6-LEAVE-TYPEADMIN-1` | 🟡 | ✅ xong | [📄](S6-LEAVE-TYPEADMIN-1.md) | — | Màn Loại nghỉ là CỬA MỘT CHIỀU — đặt 'Ngưng áp dụng' xong không bật lạ |

## Khác

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `HR-PROFILE-UI-1` | 🔴 | ✅ xong | — *(chưa)* | — | Nâng cấp màn Hồ sơ nhân sự: dải tổng quan (headcount+donut giới tính+4 |
| `HR-PROFILE-UI-2` | 🟡 | ✅ xong | [📄](HR-PROFILE-UI-2.md) | ✅HR-PROFILE-UI-1 | Hồ sơ nhân sự phần 2: gom nhóm bảng 1/2 cấp (Tùy chỉnh cột) + export d |
| `HR-PERF-1` | 🔴 | ✅ xong | [📄](HR-PERF-1.md) | ✅HR-PROFILE-UI-1 | Tối ưu hiệu năng nền tảng: (a) code-split router theo module (bundle a |
| `HR-IDENTITY-READ-1` | 🔴 | ✅ xong | [📄](HR-IDENTITY-READ-1.md) | ✅HR-PROFILE-UI-1 | Lộ identity_number/issue_date/issue_place (CCCD §14.18) qua read surfa |

## Sprint 7

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S7-GOAL-PROJTAB-1` | 🟡 | ✅ xong | [📄](S7-GOAL-PROJTAB-1.md) | ✅S6-GOLIVE-1 | Tab 'Mục tiêu' trong trang dự án: mục tiêu của dự án + phủ mục tiêu củ |
| `S7-CHAT-DOC-1` | 🟢 | ✅ xong | [📄](docs/SPEC/SPEC-15 CHAT.md) | — | Bộ tài liệu CHAT: SPEC-15 + DB-12 + API-13 + ma trận phân quyền §9c +  |
| `S7-CHAT-DOC-2` | 🟢 | ✅ xong | [📄](S7-CHAT-WAVE.md) | ✅S7-CHAT-DOC-1 | Hoà CHAT-DEC-004 (owner lật: SA đọc được mọi phòng, có audit) vào bộ d |
| `S7-CHAT-DB-1` | 🔴 | ✅ xong | [📄](S7-CHAT-DB-1.md) | ✅S7-CHAT-DOC-1 ✅S6-GOLIVE-1 | Migration CHAT: ALTER 3 bảng đã có (cột v1 + backfill TRƯỚC CHECK + co |
| `S7-CHAT-DB-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S7-CHAT-DB-1 | Migration 0539: chat_messages.room_seq PER-ROOM (sửa công thức đếm chư |
| `S7-CHAT-BE-1` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-1.md) | ✅S7-CHAT-DB-2 | ChatAccessService — ĐIỂM KHẲNG ĐỊNH MEMBERSHIP DUY NHẤT (fail-closed,  |
| `S7-CHAT-BE-2` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-2.md) | ✅S7-CHAT-BE-1 | Tin nhắn: đọc theo con trỏ seq (cấm offset) · gửi idempotent theo clie |
| `S7-CHAT-BE-3` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-3.md) | ✅S7-CHAT-BE-2 | Đính kèm tệp/ảnh qua FOUNDATION Files + ChatMessageFileResolver (BẮT B |
| `S7-FND-LINKFALLBACK-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S7-CHAT-BE-3 | FilePolicy: tệp TỪNG có link module thì KHÔNG bao giờ tụt xuống fallba |
| `S7-CHAT-BE-4` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-4.md) | ✅S7-CHAT-BE-2 | Tìm kiếm toàn văn tiếng Việt (có dấu/không dấu) — LUÔN giới hạn theo p |
| `S7-CHAT-BE-5` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-5.md) | ✅S7-CHAT-BE-1 | Phòng tự động theo phòng ban + dự án: tạo/đóng phòng, đồng bộ thành vi |
| `S7-CHAT-BE-6` | 🟡 | ✅ xong | [📄](S7-CHAT-BE-6.md) | ✅S7-CHAT-BE-2 ✅S7-CHAT-DB-1 | Thông báo CHAT qua OutboxNotificationBridge: mention gửi ngay + DM gộp |
| `S7-INT-OUTBOX-FIFO-1` | 🟡 | ✅ xong | — *(chưa)* | — | OutboxWorker dispatch ĐÚNG THỨ TỰ trong cùng lô claim (KI-059): RETURN |
| `S7-CHAT-RT-0` | 🔴 | ✅ xong | [📄](S7-CHAT-RT-0.md) | — | Hạ tầng WS: GẮN ValkeyIoAdapter (hiện định nghĩa rồi nhưng KHÔNG chỗ n |
| `S7-CHAT-RT-1` | 🔴 | ✅ xong | [📄](S7-CHAT-RT-1.md) | ✅S7-CHAT-BE-2 | Realtime CHAT: join phòng SERVER-SIDE lúc handshake (không nhận danh s |
| `S7-CHAT-FE-1` | 🟡 | ✅ xong | [📄](S7-CHAT-FE-1.md) | ✅S7-CHAT-BE-2 ✅S7-CHAT-RT-1 ✅S7-CHAT-RT-0 | Nền FE chat: contracts + api-client + store Zustand dùng chung + MỘT k |
| `S7-CHAT-BE-8` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-8.md) | ✅S7-CHAT-BE-3 | Presign upload own-scope cho CHAT — nhân viên thường gửi được tệp/ảnh  |
| `S7-CHAT-FE-2` | 🟡 | ✅ xong | [📄](S7-CHAT-FE-2.md) | ✅S7-CHAT-FE-1 ✅S7-CHAT-BE-3 | Trang /chat full-screen: 3 cột (danh sách phòng · hội thoại · thông ti |
| `S7-CHAT-FE-3` | 🟡 | ✅ xong | [📄](S7-CHAT-FE-3.md) | ✅S7-CHAT-FE-2 | Panel chat nổi toàn hệ thống (tối đa 3 hội thoại) + badge tổng chưa đọ |
| `S7-CHAT-FE-4` | 🟢 | ✅ xong | [📄](S7-CHAT-FE-4.md) | ✅S7-CHAT-FE-2 ✅S7-CHAT-BE-4 | Màn hình tìm kiếm tin nhắn (nhảy tới tin trong ngữ cảnh) + tab tệp/tin |
| `S7-CHAT-BE-7` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-7.md) | ✅S7-CHAT-BE-2 ✅S7-CHAT-BE-3 | 🔒 Đường đọc-vượt membership (CHAT-DEC-004): controller+service RIÊNG  |
| `S7-CHAT-FE-5` | 🟡 | ✅ xong | [📄](S7-CHAT-FE-5.md) | ✅S7-CHAT-BE-7 ✅S7-CHAT-FE-2 | 🔒 Màn quản trị đọc-vượt (CHAT-SCREEN-007) + nhật ký đọc-vượt (CHAT-SC |
| `S7-CHAT-BE-9` | 🔴 | ✅ xong | [📄](S7-CHAT-BE-9.md) | ✅S7-CHAT-FE-5 | 🔒 CHAT-API-019 nhận bộ lọc actorUserId + from/to (giữ keyset) — để CH |
| `S7-CALL-DOC-1` | 🔴 | ✅ xong | — *(chưa)* | — | Owner ký DECISIONS-07 (nới CHAT-DEC-005 có hàng rào R1-R4) + sửa SPEC- |
| `S7-CALL-DB-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S7-CALL-DOC-1 | Migration CALL: chat_calls + chat_call_participants (company_id + RLS  |
| `S7-CALL-BE-1` | 🔴 | ✅ xong | [📄](S7-CALL-BE-1.md) | ✅S7-CALL-DB-1 | Vòng đời cuộc gọi qua REST (mời · nhận · từ chối · huỷ · kết thúc) + G |
| `S7-CALL-RT-1` | 🔴 | ✅ xong | [📄](S7-CALL-RT-1.md) | ✅S7-CALL-BE-1 | 🔒 Gateway /ws-call: allowlist ĐÓNG 8 sự kiện inbound, relay SDP/ICE K |
| `S7-CALL-FE-1` | 🟡 | ✅ xong | [📄](S7-CALL-FE-1.md) | ✅S7-CALL-RT-1 ✅S7-CHAT-FE-3 | UI cuộc gọi: nút gọi trong phòng · chuông đến · khung đang gọi (thu nh |
| `S7-CHAT-LMS-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S7-CALL-FE-1 | Gỡ chat khỏi LMS (GIỮ trợ lý AI) + trỏ lối vào sidebar sang /chat Medi |
| `S7-CALL-QA-1` | 🔴 | ✅ xong | [📄](S7-CALL-QA-1.md) | ✅S7-CALL-FE-1 | Bộ test CALL: deny-path signalling · cô lập 2-tenant · vòng đời cuộc g |
| `S7-CALL-RT-FIX-1` | 🔴 | ✅ xong | [📄](S7-CALL-RT-FIX-1.md) | ✅S7-CALL-QA-1 | Vá fail-OPEN /ws-call: `disconnect()` trong middleware handshake là no |
| `S7-CALL-RT-FIX-2` | 🔴 | ✅ xong | [📄](S7-CALL-RT-FIX-2.md) | ✅S7-CALL-QA-1 | Vá 'gỡ thành viên giữa cuộc gọi': VẪN relay SDP/ICE tới người đã bị gỡ |
| `S7-CALL-QA-2` | 🟡 | ✅ xong | — *(chưa)* | ✅S7-CALL-QA-1 | Test FE cuộc gọi: bật đo coverage cho apps/app + phủ 1.241 dòng đang l |
| `S7-CHAT-QA-1` | 🔴 | ✅ xong | [📄](S7-CHAT-QA-1.md) | ✅S7-CHAT-FE-3 ✅S7-CHAT-BE-5 ✅S7-CHAT-BE-6 ✅S7-CHAT-FE-4 ✅S7-CHAT-FE-5 | Bộ test trọn vẹn CHAT: 12 nhóm scenario SPEC-15 §21 trên LANE_DB + E2E |
| `S7-CHAT-CLEAN-1` | 🔴 | ✅ xong | [📄](S7-CHAT-CLEAN-1.md) | ✅S7-CHAT-QA-1 | Contract (release SAU): drop chat_rooms.channel_id + chat_messages.fil |
| `S7-QA-CATALOGFIXTURE-1` | 🔴 | ✅ xong | [📄](S7-QA-CATALOGFIXTURE-1.md) | — | Fixture test KHÔNG được đổi `permissions.is_sensitive` của cặp CHÍNH T |
| `S7-QA-OUTBOXPROBE-1` | 🟡 | ✅ xong | — *(chưa)* | — | Chùm đỏ NGẮT QUÃNG họ KI-059 dưới tải song song: `outbox-fifo` (probe  |
| `S7-CHAT-DB-3` | 🔴 | ✅ xong | [📄](S7-CHAT-DB-3.md) | — | Expand-contract least-privilege: REVOKE UPDATE(visible_from_seq) + UPD |
| `S7-CHAT-CLEAN-2` | 🔴 | ✅ xong | — *(chưa)* | — | Dọn nhẹ hậu gate: comment đã chết ở đường quyết định · endpointOf fall |
| `S7-SEC-ROLE2FA-UI-1` | 🔴 | ✅ xong | — *(chưa)* | — | Màn "Sửa vai trò" hiển thị SAI cờ Bắt buộc 2FA (luôn chưa-tick) và KHÔ |

## Sprint 8

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S8-CHAT-UX-DOC-1` | 🟡 | ✅ xong | [📄](S8-CHAT-UX-WAVE.md) | — | Owner chốt CHAT-DEC-014…018 rồi hoà vào bộ docs CHAT — HAI quyết định  |
| `S8-CHAT-UX-FE-1` | 🟡 | ✅ xong | [📄](S8-CHAT-UX-WAVE.md) | — | Danh sách hội thoại CHIA MỤC theo loại phòng (Ghim · Riêng · Nhóm · Ph |
| `S8-CHAT-UX-DB-1` | 🔴 | ✅ xong | [📄](S8-CHAT-UX-DB-1.md) | ✅S8-CHAT-UX-DOC-1 | Mig 0543: chat_room_members.pinned_at (ghim per-user) + chat_rooms.ava |
| `S8-CHAT-UX-BE-1` | 🟡 | ✅ xong | [📄](S8-CHAT-UX-BE-1.md) | ✅S8-CHAT-UX-DB-1 | Tuỳ chọn per-phòng: ghim/bỏ ghim (trần 10) · tắt thông báo (muted_unti |
| `S8-CHAT-UX-BE-2` | 🔴 | ✅ xong | [📄](S8-CHAT-UX-BE-2.md) | ✅S8-CHAT-UX-DB-1 | Avatar phòng cho group/department/project — presign wrapper gate ('upd |
| `S8-CHAT-UX-BE-3` | 🟡 | ✅ xong | [📄](S8-CHAT-UX-BE-3.md) | ✅S8-CHAT-UX-DB-1 | Thả cảm xúc: PUT/DELETE /chat/messages/:id/reactions/:emoji + tổng hợp |
| `S8-CHAT-UX-RT-1` | 🔴 | ✅ xong | [📄](S8-CHAT-UX-RT-1.md) | ✅S8-CHAT-UX-DOC-1 | Đang gõ (REST-ping → emitter, KHÔNG mở @SubscribeMessage) + đang onlin |
| `S8-CHAT-UX-FE-2` | 🟡 | ✅ xong | [📄](S8-CHAT-UX-FE-2.md) | ✅S8-CHAT-UX-BE-1 ✅S8-CHAT-UX-BE-2 ✅S8-CHAT-UX-FE-1 | Mục Ghim + menu ngữ cảnh mỗi hội thoại (ghim · tắt thông báo · đánh dấ |
| `S8-CHAT-UX-FE-3` | 🟡 | ✅ xong | [📄](S8-CHAT-UX-FE-3.md) | ✅S8-CHAT-UX-BE-3 ✅S8-CHAT-UX-RT-1 ✅S8-CHAT-UX-FE-2 | Khung chat: avatar người gửi + gộp tin liên tiếp cùng người + thanh th |
| `S8-CHAT-UX-QA-1` | 🟡 | ✅ xong | [📄](S8-CHAT-UX-QA-1.md) | ✅S8-CHAT-UX-FE-3 | Nghiệm thu wave S8-CHAT-UX: deny-path + cross-tenant + coverage ≥80% + |
| `S8-CHAT-ENTRY-1` | 🟢 | ✅ xong | — *(chưa)* | ✅S7-CHAT-FE-3 | Thẻ "Tin nhắn" ở Home Portal + App Switcher (APP_REGISTRY) — gate ĐỦ c |

## Sprint 9

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S9-SOCIAL-DOC-1` | 🔴 | ✅ xong | [📄](S9-SOCIAL-WAVE.md) | — | Owner ký ADR DECISIONS-08 (app vệ tinh SOCIAL): nới giai đoạn Phase 4  |
| `S9-SOCIAL-SEC-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-DOC-1 | Vá 2 lỗ chặn triển khai TẠI C:\fbpost trước khi nhập: mã hoá KEK 3 cột |
| `S9-SOCIAL-APP-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-SEC-1 | Nhập cây code vào apps/fbpost: git init + copy (BỎ node_modules/.next/ |
| `S9-SOCIAL-DB-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-APP-1 | Migration 0544+: seed cặp quyền ('view','social-post') · ('create','so |
| `S9-SOCIAL-BE-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-DB-1 | Cầu SSO MediaOS → fbpost: SocialSsoService sao khuôn LmsSsoService (HM |
| `S9-SOCIAL-FE-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-BE-1 | Tile 'Đăng bài' trong APP_REGISTRY + AppSwitcher, gate bằng quyền SOCI |
| `S9-SOCIAL-DEVOPS-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-APP-1 | Dịch vụ NSSM MediaOS-Social cổng 3500 (LMS đang 3400) + .env.productio |
| `S9-SOCIAL-QA-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-FE-1 ✅S9-SOCIAL-DEVOPS-1 | Nghiệm thu wave S9-SOCIAL: deny-path phiên + replay SSO + gate quyền b |

## Sprint 10

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S10-SOCIAL-LIB-1` | 🔴 | ✅ xong | — *(chưa)* | ✅S9-SOCIAL-QA-1 | Kho video đọc từ thư mục có WHITELIST: SOCIAL_MEDIA_LIBRARY_DIRS + GET |
| `S10-SOCIAL-LIB-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S10-SOCIAL-LIB-1 | Màn 'Kho video': cấu hình thư mục gốc từ giao diện (lưu ở settings, kh |
| `S10-SOCIAL-OPS-1` | 🔴 | ✅ xong | [📄](S10-SOCIAL-OPS-1.md) | ✅S10-SOCIAL-LIB-1 | Đưa kho sang ổ D: (SOCIAL_DATA_DIR) + đổi dịch vụ MediaOS-Social từ Lo |
| `S10-OPS-SITEWATCH-1` | 🟡 | ✅ xong | — *(chưa)* | — | ops-alert-check mù với mọi mặt PROD ngoài API :3100 — thêm dò fbpost : |
| `S10-OPS-ALERTCHAN-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S10-OPS-SITEWATCH-1 | Đường BÁO ĐỘNG ra ngoài: tin nhắn phải nói ĐANG HỎNG CÁI GÌ (nay chỉ c |
| `S10-FND-ENVKEY-1` | 🟡 | ✅ xong | — *(chưa)* | — | `INTERNAL_API_KEY` là secret ĐANG DÙNG THẬT nhưng vắng mặt ở env.schem |
| `S10-QA-LOGNOISE-1` | 🟢 | ✅ xong | — *(chưa)* | — | Nhiễu log `OutboxNotificationBridge … intake THẤT BẠI` khi chạy test — |
| `S10-ATT-NOTIPROD-1` | 🟡 | ✅ xong | [📄](S10-ATT-NOTIPROD-1.md) | — | 3 sự kiện ATT bật trong danh mục nhưng KHÔNG AI PHÁT (`ATT_MISSING_CHE |
| `S10-QA-ROUTEHTTP-1` | 🟡 | ✅ xong | — *(chưa)* | — | Một mảng lớn đường dẫn API không có test HTTP nào chạm — guard/DTO/env |
| `S10-QA-ROUTEHTTP-2` | 🔴 | ✅ xong | [📄](S10-QA-ROUTEHTTP-2.md) | ✅S10-QA-ROUTEHTTP-1 | 12 route risk≥5 còn lại chưa có test HTTP nào chạm — guard/DTO/envelop |
| `S10-QA-SECPOLICY-GATE-1` | 🔴 | ✅ xong | [📄](S10-QA-SECPOLICY-GATE-1.md) | — | KI-065 — quyết định số phận `PATCH /settings/security-policy`: route c |
| `S10-AUTH-STEPUP-1` | 🔴 | ✅ xong | [📄](S10-AUTH-STEPUP-1.md) | ✅S10-QA-SECPOLICY-GATE-1 | Chưa có step-up (xác thực lại) THẬT: cờ `requiresReauth` của permissio |
| `S10-FND-JSONLOG-1` | 🟡 | ✅ xong | — *(chưa)* | — | Log chưa có cấu trúc JSON — và bất kỳ ai đổi định dạng log đều PHẢI sử |
| `S10-DASH-MVREFRESH-1` | 🟡 | ✅ xong | — *(chưa)* | — | Materialized view dashboard KHÔNG CÓ LỊCH CHẠY — chỉ làm mới khi có ng |
| `S10-HR-STATUSUI-1` | 🔴 | ✅ xong | [📄](S10-HR-STATUSUI-1.md) | — | HR-FUNC-006 — FE không có nút 'Đổi trạng thái nhân viên'; và sửa `end_ |
| `S10-AUTH-IPTRUST-1` | 🔴 | ✅ xong | — *(chưa)* | — | PROD chạy sau `cloudflared` cùng máy nhưng `TRUST_PROXY` không đặt ⇒ M |
| `S10-FND-VALKEYSCOPE-1` | 🔴 | ✅ xong | [📄](S10-FND-VALKEYSCOPE-1.md) | — | 4 môi trường dùng CHUNG một Valkey db0 nhưng chỉ `chat:presence` + kên |
| `S10-FND-VALKEYSCOPE-2` | 🔴 | ✅ xong | — *(chưa)* | ✅S10-FND-VALKEYSCOPE-1 | Gỡ chu kỳ chuyển tiếp của S10-FND-VALKEYSCOPE-1: đọc/ghi kép `replay:* |
| `S10-QA-ATTNOTIFLAKE-1` | 🟡 | ✅ xong | — *(chưa)* | — | attendance-alert-noti-producer.int.spec.ts ĐỎ CHẮC CHẮN mọi lần chạy s |
| `S10-QA-CHUNKTEST-FBPOST-1` | 🟢 | ✅ xong | — *(chưa)* | — | `harness/chunk-test.mjs` loại `apps/lms` nhưng KHÔNG loại `apps/fbpost |
| `S10-FE-PLATFORMACCOUNTS-DEADPATH-1` | 🟢 | ✅ xong | — *(chưa)* | — | Đường FE CHẾT: console gọi `POST /platform-accounts/reauth` và `POST / |
| `S10-SEC-AUDITLOGROW-1` | 🔴 | ✅ xong | [📄](S10-SEC-AUDITLOGROW-1.md) | — | KI-070 — bản vá KI-053/054/069 bound CỘT chứ KHÔNG bound HÀNG: `view:a |
| `S10-CHAT-CALLSWEEP-1` | 🔴 | ✅ xong | [📄](S10-CHAT-CALLSWEEP-1.md) | — | KI-063 (R4 ĐÃ KÝ 20/08) — cuộc gọi `active` không ai quét ⇒ phòng khoá |
| `S10-FE-BREAKGLASS-DEADPATH-1` | 🟢 | ✅ xong | — *(chưa)* | — | Đường FE CHẾT (cùng lớp platform-accounts): màn `/settings/break-glass |
| `S10-SEC-AUDITLOGROW-2` | 🔴 | ✅ xong | [📄](S10-SEC-AUDITLOGROW-2.md) | — | KI-072 — `GET /foundation/audit-logs` (+ `/:id`) KHÔNG bound HÀNG: cùn |
| `S10-SEC-ROLEMEMBERROW-1` | 🔴 | ✅ xong | [📄](S10-SEC-ROLEMEMBERROW-1.md) | ✅S10-SEC-AUDITLOGROW-2 | KI-071 — `GET /auth/roles/:id/members` bound CỘT chứ KHÔNG bound HÀNG: |
| `S10-SEC-ROLEMEMBERFE-1` | 🔴 | ✅ xong | [📄](S10-SEC-ROLEMEMBERFE-1.md) | ✅S10-SEC-ROLEMEMBERROW-1 | KI-073 — tab Thành viên role: THÂN 201 của POST /permissions/users/:us |
| `S10-SEC-ROLEMEMBERDEL-1` | 🔴 | ✅ xong | [📄](S10-SEC-ROLEMEMBERDEL-1.md) | ✅S10-SEC-ROLEMEMBERFE-1 | KI-074 — oracle thứ HAI của tab Thành viên role: DELETE /permissions/u |
| `S10-CHAT-EMITGUARD-1` | 🟡 | ✅ xong | [📄](S10-CHAT-EMITGUARD-1.md) | — | KI-075 — hai job CHAT (`emitExpired` :68 · `emitAutoEnded` :72) gọi đư |
| `S10-CHAT-EMITGUARD-2` | 🟡 | ✅ xong | [📄](S10-CHAT-EMITGUARD-2.md) | ✅S10-CHAT-EMITGUARD-1 | KI-076 — NĂM route REST của CALL phát realtime SAU COMMIT không bọc (` |
| `S10-FND-BODYVALIDATE-1` | 🟡 | ✅ xong | [📄](S10-FND-BODYVALIDATE-1.md) | — | KI-068 — 4 route GHI trả 500 `SYSTEM-ERR-001` thay vì 400 khi body sai |
| `S10-SEC-LOGINLOG429-1` | 🔴 | ✅ xong | [📄](S10-SEC-LOGINLOG429-1.md) | — | KI-047 + KI-048 — NĂM đường 429 (KHÔNG phải bốn) không ghi một dòng `l |
| `S10-HR-EMPPAGE-1` | 🟡 | ✅ xong | — *(chưa)* | — | KI-010 — `GET /employees` KHÔNG có phân trang: handler nhận đúng 4 que |
| `S10-SEC-FKCATALOG-1` | 🔴 | ✅ xong | [📄](S10-SEC-FKCATALOG-1.md) | — | KI-055 — 11 cặp FK lớp G trỏ tới bảng catalog toàn cục (`company_id` N |
| `S10-QA-ROUTEHTTP-3` | 🟡 | ✅ xong | [📄](S10-QA-ROUTEHTTP-3.md) | — | KI-025 — nốt phần đuôi độ phủ HTTP: sau S10-QA-ROUTEHTTP-1 (370/499 ph |
| `S10-ATT-SHIFTASSIGNSCOPE-1` | 🟡 | ✅ xong | [📄](S10-ATT-SHIFTASSIGNSCOPE-1.md) | — | KI-080 — `POST /attendance/shift-assignments` trả 500 khi client gửi ` |
| `S10-LEAVE-TYPEQUOTA-1` | 🟡 | ✅ xong | [📄](S10-LEAVE-TYPEQUOTA-1.md) | — | KI-081 — `GET /leave/types` bỏ sót `annualQuota` dù contract khai bắt  |
| `S10-FND-PARAMUUID-1` | 🟡 | ✅ xong | — *(chưa)* | ✅S10-FND-BODYVALIDATE-1 | KI-077 — NĂM tham số `:id`/`:linkId` READ/DELETE còn lại của `foundati |
| `S10-FND-PARAMUUID-2` | 🟡 | ✅ xong | [📄](S10-FND-PARAMUUID-2.md) | ✅S10-FND-PARAMUUID-1 | KI-078 — 221 tham số `:id`/`*Id` toàn API còn thiếu validate ở biên: v |
| `S10-FND-PARAMUUID-3` | 🟡 | ✅ xong | [📄](S10-FND-PARAMUUID-3.md) | ✅S10-FND-PARAMUUID-2 | KI-078 đợt 2 — 42 tham số `:id`/`*Id` mảng HR/tổ chức (employees 21 ·  |
| `S10-FND-PARAMUUID-4` | 🟡 | ✅ xong | [📄](S10-FND-PARAMUUID-4.md) | ✅S10-FND-PARAMUUID-3 | KI-078 đợt 3 — 36 tham số `:id`/`*Id`: KHÉP MỌI MODULE TRONG PHẠM VI T |
| `S10-FND-PARAMUUID-5` | 🟡 | ✅ xong | [📄](S10-FND-PARAMUUID-5.md) | ✅S10-FND-PARAMUUID-4 | KI-078 đợt 4 (CUỐI trong phạm vi) — 75 tham số `:id`/`*Id` của `tasks/ |
| `S10-CLEAN-WORKFLOWPARK-1` | 🟡 | ✅ xong | [📄](S10-CLEAN-WORKFLOWPARK-1.md) | — | DỌN bề mặt API của module `workflow/` (code PARK de-media-fy) — gỡ 29  |
| `S10-CLEAN-WORKFLOWCLUSTER-2` | 🔴 | ✅ xong | [📄](S10-CLEAN-WORKFLOWCLUSTER-2.md) | ✅S10-CLEAN-WORKFLOWPARK-1 | KI-082 — DỌN NỐT cụm workflow/approval: gỡ `approval/` + engine còn lạ |
| `S10-QA-COLDSTART500-1` | 🟡 | ✅ xong | [📄](S10-QA-COLDSTART500-1.md) | — | Tìm nguồn 500 cold-start ở lần chạy int-spec ĐẦU TIÊN trên lane DB vừa |
| `S10-AUTH-2FAGUARD-FAILMODE-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S10-QA-COLDSTART500-1 | TwoFactorEnforcementGuard: BA lời gọi `withTenant` không được bọc chạy |
| `S10-GOV-IDUNIQUE-1` | 🟡 | ✅ xong | [📄](S10-GOV-IDUNIQUE-1.md) | — | KI-079 — danh tính TRÙNG lọt qua mọi lưới: mã WO trong `backlog.mjs` v |

## Sprint 11

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S11-ASSET-DOC-1` | 🟢 | ⬜ chờ | [📄](S11-OFFICE-WAVE.md) | — | Bộ tài liệu ASSET: SPEC-13 + DB-15 + API-14 + permission-matrix §9d +  |
| `S11-ASSET-DB-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S11-ASSET-DOC-1 | Schema + migration ASSET theo DB-15: asset_categories · assets · asset |
| `S11-ASSET-BE-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S11-ASSET-DB-1 | Module NestJS assets/: CRUD danh mục + tài sản, cấp phát/thu hồi, bảo  |
| `S11-ASSET-FE-1` | 🟢 | ⬜ chờ | — *(chưa)* | ⏳S11-ASSET-BE-1 | FE ASSET (apps/app routes/assets/): danh sách + chi tiết + form + cấp  |
| `S11-ASSET-QA-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S11-ASSET-BE-1 ⏳S11-ASSET-FE-1 | QA ASSET: int-spec deny-path/IDOR/cross-tenant + FSM chuyển tiếp sai + |
| `S11-ROOM-DOC-1` | 🟢 | ⬜ chờ | [📄](S11-OFFICE-WAVE.md) | — | Bộ tài liệu ROOM: SPEC-14 + DB-16 + API-15 + permission-matrix §9e + h |
| `S11-ROOM-DB-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S11-ROOM-DOC-1 ⏳S11-ASSET-DB-1 | Schema + migration ROOM theo DB-16 + ROOM-DEC-001: tái dụng/ALTER meet |
| `S11-ROOM-BE-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S11-ROOM-DB-1 | Module NestJS rooms/: CRUD phòng họp (Office Admin), đặt phòng + báo t |
| `S11-ROOM-FE-1` | 🟢 | ⬜ chờ | — *(chưa)* | ⏳S11-ROOM-BE-1 | FE ROOM (apps/app routes/rooms/): lịch phòng tuần/ngày (cột = phòng, c |
| `S11-ROOM-QA-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S11-ROOM-BE-1 ⏳S11-ROOM-FE-1 | QA ROOM: race double-booking (2 request song song → đúng 1 thắng), den |
| `S11-OFFICE-DASH-1` | 🟢 | ⬜ chờ | — *(chưa)* | ⏳S11-ASSET-FE-1 ⏳S11-ROOM-FE-1 | Widget DASH cho wave OFFICE: «thống kê tài sản theo trạng thái/loại» + |

---

**Quy ước micro-plan** (tái dùng qua auto-loop): mỗi WO có file `docs/plans/<id>.md` với frontmatter máy-đọc
(`lanes/acceptanceChecks/testTasks/steps`) + phần prose reconcile. Auto-loop đọc plan nếu có (reconcile-refresh),
chưa có thì tạo + lưu. Xem file mẫu: `docs/plans/S0-FND-DB-1-reconcile.md`.
