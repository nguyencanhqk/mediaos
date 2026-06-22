# INDEX — Tổng quan Work Order đang hành

> **TỰ SINH** bởi `harness/gen-plan-index.mjs` — KHÔNG sửa tay (chạy lại sau khi đổi backlog/ledger/plan).
> Nguồn: `harness/backlog.mjs` (WO) + `activity.jsonl` (trạng thái) + `docs/plans/<id>.md` (micro-plan).
> Roadmap đầy đủ 112 story / 7 sprint: **IMPLEMENTATION-02 §7** (KHÔNG nhân bản ở đây — pull-sprint).

**19 WO** · có micro-plan: **1/19** · ⬜ 11 chờ · 🔵 2 đang làm · ✅ 6 xong · 🔴 0 chặn

## Sprint 0

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S0-GOV-1` | 🟢 | 🔵 đang làm | — *(chưa)* | — | Governance: chuẩn hoá board/label/DoR/DoD + chốt backlog harness theo  |
| `S0-CI-1` | 🟢 | ✅ xong | — *(chưa)* | — | CI BE/FE: đối chiếu lint·typecheck·test·build + migration-check + path |
| `S0-ENV-1` | 🟢 | ✅ xong | — *(chưa)* | — | Hạ tầng local: đối chiếu docker compose (Postgres/PgBouncer/Valkey/Min |
| `S0-FND-DB-1` | 🔴 | ✅ xong | [📄](S0-FND-DB-1-reconcile.md) | — | Đối chiếu schema nền (companies·modules·settings·sequence·audit·files· |
| `S0-FND-SEED-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S0-FND-DB-1 | Seed module catalog (MVP active · Phase inactive) + default system/com |
| `S0-AUTH-DB-1` | 🔴 | ✅ xong | — *(chưa)* | — | Đối chiếu AUTH/RBAC schema (users·sessions·password_reset·login_log·ro |
| `S0-API-CORE-1` | 🟡 | ✅ xong | — *(chưa)* | — | Đối chiếu shared config·logger·error-response envelope {success,messag |
| `S0-FE-CORE-1` | 🟢 | ✅ xong | — *(chưa)* | — | Đối chiếu FE project structure (auth·console·app) + design token + bas |
| `S0-FE-API-1` | 🟢 | 🔵 đang làm | — *(chưa)* | — | Đối chiếu API client + query layer + error mapper (401/403/422/500 · r |
| `S0-QA-1` | 🟡 | ⬜ chờ | — *(chưa)* | ✅S0-FND-DB-1 | Test strategy + verify migrate/seed từ DB trống + test-case matrix ske |

## Sprint 1

| WO | Zone | Trạng thái | Micro-plan | Phụ thuộc | Mô tả |
| --- | --- | --- | --- | --- | --- |
| `S1-FND-AUDIT-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S0-FND-DB-1 | AuditService v2 (DB-08 shape) + AuditMaskerService + audit-list/detail |
| `S1-FND-SETTING-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S0-FND-DB-1 ⏳S1-FND-AUDIT-1 | SettingService: precedence company→system→default + /settings/public ( |
| `S1-FND-FILE-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S0-FND-DB-1 ⏳S1-FND-AUDIT-1 | FileService: upload metadata + StorageAdapter port + FilePolicy (deny- |
| `S1-FND-SEQ-1` | 🔴 | ⬜ chờ | — *(chưa)* | ✅S0-FND-DB-1 | SequenceService.nextCode (tx + FOR UPDATE) + preview (không tăng) + re |
| `S1-FND-MODULE-1` | 🟡 | ⬜ chờ | — *(chưa)* | ⏳S0-FND-SEED-1 ⏳S1-FND-AUDIT-1 | CompanyService /company/current (GET/PATCH có audit) + ModuleCatalogSe |
| `S1-FND-WIRE-1` | 🟢 | ⬜ chờ | — *(chưa)* | ⏳S1-FND-AUDIT-1 ⏳S1-FND-SETTING-1 ⏳S1-FND-FILE-1 ⏳S1-FND-SEQ-1 ⏳S1-FND-MODULE-1 | FoundationModule gom (company·module-catalog·settings·audit·files·sequ |
| `S1-FE-LAYOUT-1` | 🟢 | ⬜ chờ | — *(chưa)* | ✅S0-FE-CORE-1 | FE shell: Home Portal + App Switcher + Module Workspace layout (topbar |
| `S1-FE-REGISTRY-1` | 🟢 | ⬜ chờ | — *(chưa)* | ✅S0-FE-CORE-1 | App/route/sidebar registry (permission-driven; metadata permission/sco |
| `S1-QA-FND-1` | 🔴 | ⬜ chờ | — *(chưa)* | ⏳S1-FND-AUDIT-1 ⏳S1-FND-SETTING-1 ⏳S1-FND-FILE-1 ⏳S1-FND-SEQ-1 ⏳S1-FND-MODULE-1 | QA hardening Foundation: permission/scope + file security + sequence c |

---

**Quy ước micro-plan** (tái dùng qua auto-loop): mỗi WO có file `docs/plans/<id>.md` với frontmatter máy-đọc
(`lanes/acceptanceChecks/testTasks/steps`) + phần prose reconcile. Auto-loop đọc plan nếu có (reconcile-refresh),
chưa có thì tạo + lưu. Xem file mẫu: `docs/plans/S0-FND-DB-1-reconcile.md`.
