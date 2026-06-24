# S0-QA-1 — Test Strategy, Smoke Checklist & Test-Case Matrix Skeleton

> Nguồn gốc: WO S0-QA-1 — done_when #2: "test strategy + smoke checklist + test-data plan ghi rõ; test-case matrix skeleton theo module (QA-02)".
> Nguồn sự thật nghiệp vụ: `docs/QA/QA-01_QA_Strategy_And_Test_Plan.md` + `docs/QA/QA-02_Test_Case_Matrix_theo_module.md`.
> File này là **kế hoạch triển khai QA cho Sprint 0** — KHÔNG nhân bản chi tiết nghiệp vụ từ QA-01/02.

---

## 1. Phạm vi Sprint 0 QA

Sprint 0 chỉ verify **hạ tầng nền** (DB + migration + seed), KHÔNG test nghiệp vụ module:

| Mục tiêu | Trạng thái S0 |
| --- | --- |
| Migration chain 0000→0438 chạy sạch từ DB trống | Gate: `migration-smoke.int-spec.ts` |
| Seed idempotent (modules catalog + system_settings) | Gate: `migration-smoke.int-spec.ts` §2d/2e |
| RLS+FORCE trên bảng company-scoped | Gate: `migration-smoke.int-spec.ts` §3 |
| Audit log append-only (app role REVOKE UPDATE/DELETE) | Gate: `migration-smoke.int-spec.ts` §5 |
| Foundation permissions seeded | Gate: `migration-smoke.int-spec.ts` §4 |
| Bảng `sessions` (S0-AUTH-DB-1 gate) | Gate: `migration-smoke.int-spec.ts` §6 skipIf |
| Test-case matrix skeleton theo module (QA-02) | Tài liệu: §5 dưới |
| Test-data plan | §4 dưới |

---

## 2. Chiến lược kiểm thử tổng thể (bám QA-01)

### 2.1 Nguyên tắc

1. **Backend là lớp kiểm soát cuối cùng** — mọi API phải pass guard permission + company_id isolation, KHÔNG tin input client.
2. **Deny-path test TRƯỚC (RED)** — viết test kiểm thiếu quyền/sai tenant TRƯỚC khi implement. Test phải FAIL trước khi code xanh.
3. **DB cô lập theo lane** — test integration chạy trên `LANE_DB=mediaos_<lane>`, KHÔNG DB dev chung (tránh đỏ-giả/xanh-giả do drift migration).
4. **Coverage ≥80%** — vùng crown-jewel (permission/RLS/audit/auth/FSM phê duyệt) áp bar riêng.
5. **Invariant check tự động** — 3 bất biến (company_id · append-only · no-secret-plaintext) phải có test ép.

### 2.2 Phân tầng test (theo QA-01 §8)

| Tầng | Công cụ | Ghi chú |
| --- | --- | --- |
| Unit | Vitest (không DB) | Service logic, FSM, validator, utility |
| Integration | Vitest + Postgres trực tiếp | DB constraint, RLS, permission, seed |
| API contract | Vitest + NestJS test module | HTTP method/status/response shape |
| E2E | Vitest + Playwright (Phase sau) | Flow người dùng — bắt đầu từ Sprint 1 |
| Security | Deny-path integration + manual | Token, tenant isolation, sensitive masking |
| Performance | k6 / pnpm test:perf (Phase sau) | Query quan trọng: list, dashboard, notification |

### 2.3 Ưu tiên theo risk (QA-01 §7.2)

| Priority | Loại rủi ro | Ví dụ |
| --- | --- | --- |
| P0 | Sai dữ liệu nghiêm trọng / lộ dữ liệu / gãy flow lõi | RLS bypass, audit không ghi, permission không chặn |
| P1 | Ảnh hưởng lớn có workaround | Seed lỗi trên môi trường mới, notification chưa đúng |
| P2 | UI/UX hoặc nghiệp vụ phụ | Label sai, filter phụ lỗi |
| P3 | Cải tiến nhỏ | Polish, spacing |

---

## 3. Smoke Checklist — Migration & Seed từ DB trống

Chạy qua `LANE_DB=mediaos_<lane>` sau `bash scripts/lane-db-setup.sh <lane>`:

### 3.1 Migration smoke

- [ ] `0000` → `0438`: tất cả migration áp thành công, không lỗi SQL
- [ ] `db:check` exit 0: journal forward-only, no-gap, no-dup-tag, head đọc động từ `_journal.json`
- [ ] Bảng Foundation tồn tại: `companies`, `system_settings`, `company_settings`, `modules`, `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items`
- [ ] Bảng Auth/RBAC tồn tại: `users`, `refresh_tokens`, `password_reset_tokens`, `roles`, `permissions`, `user_roles`, `role_permissions`, `object_permissions`
- [ ] Bảng Outbox tồn tại: `outbox_events`, `processed_events`
- [ ] GATE: `sessions` — skipIf S0-AUTH-DB-1 chưa land (không fail vì bảng chưa migrate)

### 3.2 RLS+FORCE smoke

- [ ] Mọi bảng company-scoped có `relrowsecurity=true` AND `relforcerowsecurity=true` trong `pg_class`
- [ ] Bảng cần kiểm: `companies`, `users`, `audit_logs`, `files`, `file_links`, `file_access_logs`, `sequence_counters`, `public_holidays`, `data_retention_policies`, `seed_batches`, `seed_items`, `company_settings`

### 3.3 Seed smoke

- [ ] MVP modules active sau seed: `AUTH`, `HR`, `ATT`, `LEAVE`, `TASK`, `DASH`, `NOTI`
- [ ] Extension modules inactive: `PAYROLL`, `RECRUIT`, `ASSET`, `ROOM`, `CHAT`, `SOCIAL`
- [ ] system_settings defaults seeded + `status=Active`: `file.max_upload_size_mb`, `file.allowed_mime_types`, `system.default_timezone`, `system.default_locale`, `audit.default_retention_days`
- [ ] Foundation permissions catalog: ≥1 `foundation-*` resource_type seeded

### 3.4 Idempotency smoke

- [ ] Chạy `INSERT ON CONFLICT` modules lại → đếm modules KHÔNG tăng
- [ ] Chạy `INSERT ON CONFLICT` system_settings lại → đếm settings KHÔNG tăng
- [ ] `SeedTrackingService.startBatch` cùng key 2 lần → 1 row, `reused=true`
- [ ] `SeedTrackingService.markItem` cùng payload 2 lần → 1 row, status `Skipped`

### 3.5 Append-only smoke (BẤT BIẾN #2)

- [ ] `mediaos_app` role thực thi `UPDATE audit_logs` → `permission denied`
- [ ] `mediaos_app` role thực thi `DELETE audit_logs` → `permission denied`

---

## 4. Test-Data Plan

### 4.1 Tenant cô lập

Mỗi integration test tự tạo tenant riêng qua `seedCompany(direct, label)`:

```typescript
const A = await seedCompany(direct, "qa-s0");  // company A
const B = await seedCompany(direct, "qa-s0-b"); // company B (cross-tenant deny test)
```

Cleanup sau mỗi suite qua `cleanupTenants(direct, [A.companyId, B.companyId])`.

### 4.2 User / Role seed

```typescript
const userId = await seedUser(direct, companyId, "test@example.com");
const roleId = await seedRole(direct, companyId, "hr-manager");
const permId = await seedPermissionCatalog(direct, "view", "hr-employee", false);
await seedRolePermission(direct, roleId, permId, "ALLOW");
await seedUserRole(direct, userId, roleId, companyId);
```

### 4.3 Dữ liệu global (không company_id)

- `modules` catalog: global, seed bởi migration `0435`
- `system_settings`: global, seed bởi migration `0435`
- `permissions` catalog: global, seed bởi `0435` + `S0-AUTH-DB-1`
- `roles` hệ thống: `is_system=true`, `company_id IS NULL`

### 4.4 Quy tắc test-data

1. KHÔNG dùng UUID cố định làm PK trong test nghiệp vụ — dùng `randomUUID()` hoặc `defaultRandom()`.
2. KHÔNG seed dữ liệu media/finance/workflow/channel — de-media-fy (CLAUDE.md §1).
3. Dùng `directPool()` (superuser) cho seed/teardown — KHÔNG dùng `appPool()` để bypass RLS khi seed.
4. Mỗi test file tự quản lý cleanup trong `afterAll` — KHÔNG dùng global shared state giữa các file test.

---

## 5. Test-Case Matrix Skeleton theo Module (QA-02)

Skeleton bên dưới liệt kê **group + số lượng test case tối thiểu** theo module. Chi tiết từng test case nằm ở `docs/QA/QA-02_Test_Case_Matrix_theo_module.md`. Khi implement từng WO, thêm test case vào `apps/api/test/` hoặc `apps/api/src/**/*.spec.ts` tương ứng.

Quy ước mã: `QA02-{MODULE}-{GROUP}-{NNN}` (QA-02 §4.1).

### 5.1 FOUNDATION

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| DB (migration/seed/RLS) | 30+ | `test/integration/migration-smoke.int-spec.ts` | S0 (done) |
| DB (append-only audit) | 5+ | `test/foundation/audit-logs-appendonly.int-spec.ts` | S0 (done) |
| DB (seed idempotent) | 5+ | `test/integration/foundation-seed-idempotent.int-spec.ts` | S0 (done) |
| API (settings public) | 5+ | `test/foundation/` | S1 |
| API (audit list/filter) | 5+ | `test/foundation/audit-list-filter.int-spec.ts` | S1 (done) |
| PERM (audit 403) | 3+ | `test/foundation/` | S1 |
| SEC (masking) | 5+ | `test/foundation/` | S1 |

### 5.2 AUTH

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| DB (schema/RLS) | 10+ | `test/integration/` | S0 (gate S0-AUTH-DB-1) |
| API (login/logout/refresh) | 10+ | `test/integration/auth.int-spec.ts` | S1 |
| API (session management) | 5+ | `test/integration/auth-session.int-spec.ts` | S1 |
| PERM (role/permission CRUD) | 8+ | `test/integration/permission-admin.int-spec.ts` | S1 |
| SEC (no secret in response) | 5+ | `test/integration/` | S1 |
| SEC (cross-tenant deny) | 3+ | `test/integration/` | S1 |

### 5.3 HR

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| API (employee CRUD) | 10+ | `test/integration/` | S2 |
| PERM (Own/Team/Dept/Company scope) | 8+ | `test/integration/` | S2 |
| SEC (sensitive masking salary) | 3+ | `test/integration/` | S2 |
| FLOW (profile change request) | 5+ | `test/integration/` | S2 |
| DB (employee code sequence no-dup) | 3+ | `test/integration/` | S2 |

### 5.4 ATT

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| API (check-in/out) | 8+ | `test/integration/` | S3 |
| VAL (double check-in deny) | 3+ | `test/integration/` | S3 |
| PERM (scope Own/Team/Company) | 5+ | `test/integration/attendance-permission.int-spec.ts` | S3 |
| FLOW (adjustment approval) | 5+ | `test/integration/` | S3 |
| INT (leave approved blocks check-in) | 3+ | `test/integration/` | S3 |

### 5.5 LEAVE

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| API (request CRUD) | 8+ | `test/integration/` | S3 |
| FLOW (submit→approve→notify) | 5+ | `test/integration/` | S3 |
| PERM (Own/Team/Company) | 5+ | `test/integration/` | S3 |
| INT (ATT sync khi approve) | 3+ | `test/integration/` | S3 |
| VAL (overlap/balance check) | 5+ | `test/integration/` | S3 |

### 5.6 TASK

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| API (project/task CRUD) | 10+ | `test/integration/` | S4 |
| PERM (member/watcher/company) | 5+ | `test/integration/` | S4 |
| FLOW (kanban state transition) | 5+ | `test/integration/` | S4 |
| INT (file attachment) | 3+ | `test/integration/task-attachments.int-spec.ts` | S4 |

### 5.7 NOTI

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| API (list/unread/mark-read) | 8+ | `test/integration/` | S4 |
| PERM (tenant isolation) | 3+ | `test/integration/notifications-tenant-isolation.int-spec.ts` | S4 |
| INT (event → notification delivery) | 5+ | `test/integration/notifications-mandatory.int-spec.ts` | S4 |

### 5.8 DASH

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| API (widget data by role) | 8+ | `test/integration/` | S5 |
| PERM (scope per widget) | 5+ | `test/integration/` | S5 |
| PERF (response <200ms P95) | 3+ | `test/integration/` | S5 |

### 5.9 CROSS-MODULE

| Group | Số lượng tối thiểu | File test | Sprint |
| --- | --- | --- | --- |
| CROSS (LEAVE→ATT sync) | 3+ | `test/integration/` | S3 |
| CROSS (HR→ATT employee resign) | 3+ | `test/integration/` | S3 |
| CROSS (TASK→NOTI event) | 3+ | `test/integration/` | S4 |
| CROSS (company_id isolation across modules) | 5+ | `test/integration/tenant-isolation.int-spec.ts` | S0 (done) |
| REG (smoke regression after each sprint) | 10+ | `test/integration/migration-smoke.int-spec.ts` | S0+ |

---

## 6. Luật viết test (bắt buộc)

1. **Deny-path TRƯỚC (RED)**: test thiếu quyền → 403; sai tenant → 0 row; viết TRƯỚC khi implement.
2. **`company_id` mọi query nghiệp vụ** — dùng `withTenant(companyId, fn)`; KHÔNG query trần.
3. **DB cô lập**: `LANE_DB=mediaos_<lane>` cho mọi integration test — KHÔNG dùng `mediaos` dev chung.
4. **Cleanup tường minh**: `afterAll` gọi `cleanupTenants(direct, [companyId])` — KHÔNG để rác.
5. **Không `@ts-ignore`/`eslint-disable`** — sửa root-cause hoặc dùng `build-error-resolver`.
6. **Không mock DB cho invariant** — RLS/append-only/tenant isolation phải test trên Postgres thật.
7. **Audit append-only test**: kiểm `permission denied` từ `mediaos_app` role — KHÔNG chỉ test tầng app.

---

## 7. Gate tự động (CI)

| Bước | Command | Điều kiện fail |
| --- | --- | --- |
| Typecheck | `pnpm --filter @mediaos/api typecheck` | TS error |
| Unit test | `pnpm --filter @mediaos/api test` | Test fail (không DB) |
| Migration check | `pnpm --filter @mediaos/api db:check` | Journal gap/dup/fail |
| Integration (CI) | `LANE_DB=mediaos_ci pnpm --filter @mediaos/api test` | Test fail trên DB cô lập |

---

## 8. Nợ kỹ thuật QA (tracked)

| Ticket | Nội dung | Phụ thuộc |
| --- | --- | --- |
| `S0-AUTH-DB-1` | GATE bảng `sessions` + seed AUTH permission matrix | S0-AUTH-DB-1 |
| `S1-QA-DEBT-1` | Triage 60 fail pre-existing (parked finance/workflow + module chưa mount) | S0 done |
| `S1-INT-MOUNT-1` | Quyết scope webhooks + ui-config: mount hoặc exclude có vé Phase | S0 done |
| `S1-QA-FND-1` | QA hardening Foundation (file security, sequence concurrency, public-settings leak) | S1 FND services |

---

## 9. Verify lệnh chạy (S0-QA-1)

```bash
# 1. Dựng DB cô lập lane
bash scripts/lane-db-setup.sh qa

# 2. Set LANE_DB
export LANE_DB=mediaos_qa

# 3. Chạy test migration-smoke
pnpm --filter @mediaos/api test test/integration/migration-smoke.int-spec.ts

# 4. Chạy typecheck
pnpm --filter @mediaos/api typecheck
```

Kết quả mong đợi:
- `migration-smoke.int-spec.ts` XANH (tất cả bảng Foundation + Auth/RBAC tồn tại, seed đúng, RLS đúng, append-only đúng).
- Test `sessions` GATE: log `[S0-QA-1 GATE] bảng 'sessions' chưa tồn tại — chờ S0-AUTH-DB-1. Skipping assertion.` và PASS (không fail).
- Typecheck XANH.

---

_Cập nhật lần cuối: 2026-06-23 — S0-QA-1 (lane backend)._
