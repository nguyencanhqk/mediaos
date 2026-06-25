# INDEX — Tổng quan Work Order đang hành

> **TỰ SINH** bởi `harness/gen-plan-index.mjs` — KHÔNG sửa tay (chạy lại sau khi đổi backlog/ledger/plan).
> Nguồn: `harness/backlog.mjs` (WO) + `activity.jsonl` (trạng thái) + `docs/plans/<id>.md` (micro-plan).
> Roadmap đầy đủ 112 story / 7 sprint: **IMPLEMENTATION-02 §7** (KHÔNG nhân bản ở đây — pull-sprint).

**44 WO** · có micro-plan: **18/44** · ⬜ 17 chờ · 🔵 0 đang làm · ✅ 27 xong · 🔴 0 chặn

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
| `S2-AUTH-BE-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S2-AUTH-DB-2 ✅S2-AUTH-SEED-1 | Login/logout/me: password verify + session issue/revoke + login_log +  |
| `S2-AUTH-BE-2` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S2-AUTH-DB-1 ✅S2-AUTH-SEED-1 | Permission + data-scope resolver guard dùng chung (decorator/middlewar |
| `S2-AUTH-BE-3` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S2-AUTH-BE-2 | User admin API (P1): list/detail/create/update + lock/unlock + roles/p |
| `S2-AUTH-BE-4` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S2-AUTH-DB-2 ⏳S2-AUTH-BE-1 | Change-password + forgot/reset-password (P1): token hash + expiry/used |
| `S2-HR-DB-1` | 🔴 | ✅ xong | [📄](S2-HR-DB-1.md) | — | Migration HR Core: departments·positions·job_levels·contract_types·emp |
| `S2-HR-SEED-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S2-HR-DB-1 ✅S2-AUTH-SEED-1 | Seed HR master data (job_levels·contract_types·employee_code_config +  |
| `S2-HR-BE-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S2-HR-DB-1 ⏳S2-AUTH-BE-2 | HR read core: GET /hr/employees (list/pagination/search/filter/sort/da |
| `S2-HR-BE-2` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-1 ⏳S2-HR-SEED-1 | HR write core: POST/PATCH /hr/employees + auto employee-code (tx + Seq |
| `S2-HR-BE-3` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S2-HR-DB-1 ⏳S2-AUTH-BE-2 | Department/position CRUD (P1): create/update/soft-delete + master data |
| `S2-HR-BE-4` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-1 | Profile change request skeleton (P1/P2): employee gửi yêu cầu sửa hồ s |
| `S2-FE-AUTH-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S2-AUTH-BE-1 ⏳S2-AUTH-BE-2 | FE Auth: Login page + auth bootstrap (/auth/me) + ProtectedRoute/Publi |
| `S2-FE-HR-1` | 🟢 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-1 ⏳S2-FE-AUTH-1 | FE HR: EmployeeList (table/filter/search/pagination) + EmployeeDetail  |
| `S2-FE-HR-2` | 🟢 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-2 ⏳S2-FE-HR-1 | FE HR: EmployeeForm (create/edit) + dropdown lookups + validation + su |
| `S2-FE-HR-3` | 🟢 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-1 ⏳S2-FE-AUTH-1 | FE: MyProfile (read-only) + user/role read-only placeholder (P1, KHÔNG |
| `S2-INT-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-2 ⏳S2-AUTH-BE-3 | Tích hợp HR tạo employee ↔ AUTH tạo/link user (giao dịch nhất quán, un |
| `S2-INT-2` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-1 ⏳S2-AUTH-BE-2 | Tích hợp HR direct_manager ↔ data-scope Team/Department của permission |
| `S2-QA-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S2-AUTH-BE-2 ⏳S2-HR-BE-1 | QA AUTH + RBAC/data-scope: login success/fail/locked/logout/me + Own/T |
| `S2-QA-2` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S2-HR-BE-2 ⏳S2-FE-HR-2 | QA HR CRUD + FE smoke + regression: employee create/update/status/link |

---

**Quy ước micro-plan** (tái dùng qua auto-loop): mỗi WO có file `docs/plans/<id>.md` với frontmatter máy-đọc
(`lanes/acceptanceChecks/testTasks/steps`) + phần prose reconcile. Auto-loop đọc plan nếu có (reconcile-refresh),
chưa có thì tạo + lưu. Xem file mẫu: `docs/plans/S0-FND-DB-1-reconcile.md`.
