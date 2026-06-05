# PLAN — G3 Permission Engine

> Tạo TRƯỚC khi viết code (PLAYBOOK §11). Rà bằng `plan-reviewer` tới PASS rồi mới code.
> Nguồn: ADR [0010](../adr/0010-permission-4tier.md) · ERD [`erd-v2.md`](../erd-v2.md) §4 (roles/perms) · `docs/permission-matrix-spec.md` · `TASKS.md` G3 · `CLAUDE.md` §2/§3/§6.

## Meta

- **Mã:** G3 · **Phase:** G3 · **Mốc:** M1 (Lõi sống)
- **Vùng rủi ro chủ đạo:** 🔴 đỏ (permission engine sai = toàn bộ module sau có lỗ hổng bảo mật)
- **Model chính:** **Opus** (G3-2/G3-3/G3-4 — logic 4-tầng + deny-path + cache invalidation)
- **Ước lượng:** L (~8–12 ngày focus)
- **Review gate:** **FULL** — `ecc:security-reviewer` + `ecc:typescript-reviewer` + `ecc:silent-failure-hunter` (mọi diff G3 chạm permission/guard/cache).

---

## 1. Mục tiêu

Sau G3: **mọi API endpoint kiểm tra đúng quyền theo 4 tầng**; **quyền nhạy cảm (lương, tài khoản kênh, tài chính) KHÔNG kế thừa từ role thường kể cả super-admin — phải explicit ALLOW**; **DENY luôn thắng ALLOW cùng tầng, tổng hợp qua mọi role**; **cache Valkey phản ánh đúng thực tế, invalidate ngay khi đổi quyền, re-check `expires_at` trên cache hit**; **FE chỉ render control theo capabilities nhận từ server** (server là sự thật duy nhất). Đây là nền để mọi module M2+ không phải tự viết permission check.

---

## 2. Scope

**Trong:**

- DB schema: `roles`, `permissions`, `role_permissions`, `user_roles`, `object_permissions` + seed mapping.
- `PermissionService.can(user, action, objType, objId?, ctx?)` — thuật toán 4 tầng, deny-overrides-across-roles.
- Guard pipeline NestJS: `JwtAuthGuard → CompanyGuard → PermissionGuard`.
- Guard cho `PATCH/POST /permissions/object` — ai được SET object-level permission.
- Cache Valkey per-user capabilities (map format) + invalidation khi đổi role/quyền (emit audit).
- `GET /auth/me` trả thêm `capabilities` map (non-sensitive actions); sensitive chỉ trả `allowed: boolean`.
- FE: `<PermissionGate>` + `useCan()` hook đọc capabilities map từ store (O(1) lookup — KHÔNG gọi API per-check).
- Test deny-path TRƯỚC (RED) cho từng rule theo `permission-matrix-spec.md`.
- Audit 100% mọi mutation quyền (grant/revoke role, object-permission change) qua `audit_logs` G2.

**Ngoài (không làm lần này):**

- Role hierarchy / kế thừa role (G3 dùng **flat roles** — tuyên bố dứt khoát, không implement sau mà không có plan riêng).
- Masking field chi tiết theo từng DTO (G5/G6 làm khi có module — dùng `can()` để quyết định trả field nào).
- Envelope encryption (G6-2) — chỉ cần `can('reveal-secret', 'platform-account', id)` là placeholder ở G3.
- Object-level permission UI builder (G7) — G3 chỉ API + storage.
- Approval permission (G8) — dùng `can()` đã có.
- Guard cho WebSocket (G10) và BullMQ jobs: ghi nhận là cần làm — BullMQ jobs phải gọi `PermissionService.can()` với explicit principal (KHÔNG bypass). WS handshake phải qua JWT→Company→Permission. Defer implementation đến G10, nhưng interface `can()` phải hỗ trợ non-HTTP caller từ G3.

**Acceptance (TASKS.md G3 "Done khi"):** user chỉ thấy menu/nút theo quyền; API chặn đúng; đổi quyền có audit + cache invalidate.

---

## 3. Phụ thuộc

- **Cần có TRƯỚC G3:** G2 merge (auth + withTenant + audit + outbox xanh). `users`, `companies`, `audit_logs` phải tồn tại.
- **G3-0 (gate cứng):** `permission-matrix-spec.md` phải tồn tại và đủ (từ G0-4). Nếu chưa có → tạo draft + duyệt TRƯỚC G3-1. Không viết test không có spec.
- **Trong G3 (thứ tự bắt buộc):** G3-0 (spec) → G3-1 (schema + seed) → G3-3 (test RED) → G3-2 (implement GREEN) → G3-4 (guards + cache) → G3-5 (FE).
- **GX-4 (chú ý migration):** bảng mới → RLS+FORCE ngay khi CREATE. **G2-5 regression PHẢI chạy lại sau G3-1** (5 bảng mới thêm vào `rls-registry.ts`).
- **Seam đã có từ G2:** `JwtAuthGuard` (xác thực JWT); `withTenant` trong `DbService`; `audit_logs` để ghi event đổi quyền; `EventBus` để emit `permission.changed`.

---

## 3b. Thiết kế thuật toán `can()` — 4 tầng (ĐÃ VÁ)

```
Ưu tiên giảm dần:
  1. OBJECT-LEVEL DENY  (object_permissions — subject=user/role + object_type + object_id + effect=DENY)
  2. OBJECT-LEVEL ALLOW (object_permissions — subject=user/role + object_type + object_id + effect=ALLOW)
  3. COMPANY-LEVEL DENY  (gom TẤT CẢ role của user → nếu có BẤT KỲ DENY nào thì DENY thắng)
  4. COMPANY-LEVEL ALLOW (gom TẤT CẢ role của user → nếu có ít nhất 1 ALLOW thì cho phép)

DENY thắng tuyệt đối trong cùng tầng, tổng hợp ACROSS mọi role của user.
Tầng thấp hơn (object-level) THẮNG tầng cao hơn (company-level).

Quyền nhạy cảm (is_sensitive = true):
  Wildcard (*:* hoặc resource:*) KHÔNG match — chỉ exact (action, resourceType) ALLOW mới được tính.
  Phải có explicit ALLOW ở object/company level.
  KHÔNG kế thừa từ wildcard/parent role, kể cả super-admin.
  Ví dụ: action="view-salary", "reveal-secret", "view-revenue".

Super-admin:
  Có wildcard *:* ALLOW trong role_permissions — áp dụng cho non-sensitive action.
  Với sensitive action: phải có THÊM explicit (action, resourceType) ALLOW — wildcard bị bỏ qua.
  [CHỐT — không còn là câu hỏi mở]

Expires_at:
  user_roles.expires_at được LƯU trong cache payload.
  Mỗi cache hit: re-check expires_at > now() TRƯỚC KHI trả kết quả.
  Nếu hết hạn → xoá entry đó khỏi capabilities, fallback query DB.
  [CHỐT — tránh cửa sổ 5 phút sau khi role hết hạn]

Deny-overrides across-roles (QUAN TRỌNG):
  Tại company-level: tổng hợp TẤT CẢ role_permissions của user.
  Nếu ANY role cho DENY → DENY, bất kể role khác cho ALLOW.
  Test bắt buộc: user có role A (ALLOW view-salary) + role B (DENY view-salary) → kết quả DENY.
```

**Input:** `{ userId, companyId, action, resourceType, resourceId?, ctx? }`
**Output:** `{ allowed: boolean, reason: string }` (reason để debug + audit deny)

**Cache format:** `perm:{companyId}:{userId}` → map `{ "action:resourceType": { allowed: boolean, expiresAt: ISO | null } }`
**TTL:** 5 phút (safety net khi event mất — tối đa 5 phút stale, chấp nhận được vì revoke khẩn cấp có path riêng: `invalidateUser()` manual).
**Invalidation:** DEL key ngay khi `permission.changed` event (sub-100ms latency target).
**Cache miss query:** tối đa 2 query (1 company-level JOIN, 1 object-level batch theo resourceType) — không lazy per-check.

---

## 4. Phân rã micro-step

| # | Bước nhỏ | Vùng | Model | Agent/Skill | Test (deny-path TRƯỚC) | DoD bước |
|---|-----------|------|-------|-------------|------------------------|----------|
| **G3-0** | **Kiểm tra/tạo `permission-matrix-spec.md`**: xác nhận file đã tồn tại đủ (từ G0-4) hoặc tạo draft bao gồm: danh sách action × resource_type, đánh dấu `is_sensitive`, mapping role mặc định → permission, scope object-level. Duyệt nội bộ trước khi sang G3-1. | 🟡 | Sonnet | — | — | `permission-matrix-spec.md` tồn tại, có danh sách action/resource/sensitive/mapping đủ để seed. |
| **G3-1** | **DB schema + seed:** migration `0005_permissions.sql`. (a) Bảng `roles` (`id, company_id NULLABLE, name, description, is_sensitive_boundary, deleted_at`). (b) `permissions` (`id, action, resource_type, is_sensitive — UNIQUE(action, resource_type)`). (c) `role_permissions` (`role_id, permission_id, effect ALLOW\|DENY — UNIQUE(role_id, permission_id, effect)` — cho phép cùng role+permission có cả ALLOW+DENY để test deny-wins logic; thuật toán luôn DENY-wins). (d) `user_roles` (`id, user_id, role_id, company_id, object_type NULLABLE, object_id NULLABLE, expires_at NULLABLE`). (e) `object_permissions` (`id, subject_type user\|role, subject_id, permission_id, object_type, object_id, effect`). **RLS + FORCE** trên tất cả; riêng `roles`: SELECT `company_id = current_company OR company_id IS NULL`; INSERT/UPDATE/DELETE `company_id = current_company` (tenant KHÔNG thao tác system role). `permissions` = read-only global catalog (app role chỉ SELECT). **Seed:** roles cơ bản (super-admin, company-admin, manager, employee) + **permissions catalog + role_permissions mapping** từ `permission-matrix-spec.md` qua migration hoặc seeder script. Drizzle schema khớp SQL. | 🔴 | Sonnet | database-reviewer + tdd-guide | **RED (G2-5 regression):** 5 bảng mới vào `rls-registry.ts` → isolation test TỰ PHÁT HIỆN thiếu policy. Tenant A thử UPDATE system role → bị RLS từ chối. `permissions` (catalog) — tenant thử INSERT → từ chối. | Migration reversible; RLS+FORCE đúng; tenant không sửa system role; regression G2-5 xanh với bảng mới; seed mapping đủ từ spec. |
| **G3-3** | **Viết test deny-path TRƯỚC** (RED, trước G3-2): dựa `permission-matrix-spec.md`. Ca bắt buộc: (a) user không role → từ chối; (b) DENY thắng ALLOW cùng tầng; (c) **user có role A (ALLOW) + role B (DENY) cùng action → DENY** (deny-overrides across-roles); (d) object-DENY thắng company-ALLOW; (e) sensitive + wildcard `*:*` ALLOW → từ chối (wildcard không match sensitive); (f) sensitive + explicit ALLOW → cho phép; (g) role hết hạn (`expires_at` qua) → từ chối **kể cả khi cache hit** (re-check expiresAt); (h) super-admin + sensitive action không có explicit → từ chối; (i) `resourceId` null + action yêu cầu object → từ chối; (j) object-ALLOW + company-DENY → object-ALLOW thắng (tầng thấp wins); (k) hai consumer cùng event revoke → idempotent; (l) cả cache và DB lỗi → **fail-closed** (DENY, không false-ALLOW). | 🔴 | Opus | tdd-guide + type-design-analyzer | Là chính nó — phải RED trước khi G3-2 implement. | ≥20 ca deny-path + ≥10 ca allow; mỗi ca có assert rõ `reason`; chạy CI không Docker (in-memory mock DB đủ). |
| **G3-2** | **`PermissionService`** implement `can()` — thuật toán 4 tầng (§3b). **Sensitive check TRƯỚC wildcard resolve** (không để wildcard `*:*` bypass is_sensitive). Tổng hợp deny-overrides across-roles ở company-level. `expires_at` re-check ở tầng cache. Tối đa 2 query (company JOIN + object batch). Trả `{ allowed, reason }`. Không nuốt lỗi DB — throw rõ ràng (silent-failure-hunter sẽ bắt). Debug-only: emit `permission.checked` via EventEmitter. | 🔴 | Opus | type-design-analyzer + silent-failure-hunter + security-reviewer | G3-3 suite phải GREEN sau G3-2. | ≥90% coverage `can()`; test (c)(e)(g)(h)(l) xanh; không false-ALLOW khi fail. |
| **G3-4** | **Guard pipeline + cache Valkey:** (a) `CompanyGuard` — verify user thuộc `company_id` JWT. (b) `PermissionGuard` — `@RequirePermission(action, resourceType)` + call `can()`; **fail-closed khi không có decorator** (route mới quên gắn → từ chối mặc định, không phải cho qua). `@Public()` bypass. (c) **Guard cho object-permission mutation** (`PATCH /permissions/object`): yêu cầu action `grant-object-permission:permission` — chỉ company-admin+ mới được set. Ngăn privilege-escalation. (d) Cache: `perm:{companyId}:{userId}` map với `expiresAt` trong payload, TTL 5 phút. Re-check `expiresAt` mỗi cache hit. Invalidation: subscribe `permission.changed` → DEL key (<100ms). Khi đổi role/quyền: ghi audit + emit `permission.changed` outbox. (e) Valkey down → fallback DB (WARN log, không nuốt lỗi, không false-ALLOW). Cả DB lỗi → fail-closed DENY. `PermissionService.invalidateUser(companyId, userId)` public. | 🔴 | Opus | security-reviewer + silent-failure-hunter | **RED:** revoke role → call `can()` ngay → từ chối (cache DEL). Role hết hạn 1s → call `can()` → từ chối (expiresAt re-check). Guard không decorator → 403. Object-permission grant không quyền → 403. Valkey down → DB fallback, không 500. DB down → DENY (fail-closed). Privilege-escalation: user thường thử self-grant → 403. | Audit 100% mutation quyền; fail-closed xác nhận; invalidation <100ms; smoke test danh sách route chính không bị break. |
| **G3-5** | **FE `<PermissionGate>` + `useCan()`**: `/me` trả `capabilities: Record<"action:resourceType", boolean>` (map, O(1) lookup). Sensitive resource chỉ trả `isSensitiveAllowed: boolean` riêng — không expose detail vào map chung. `useCan(action, resourceType)` → đọc từ Zustand store (KHÔNG gọi API per-check — cấm). `<PermissionGate action="..." resourceType="...">` → render children hoặc null/fallback. **Nguyên tắc:** FE = UX hint; server guard là sự thật. | 🟡 | Sonnet | typescript-reviewer + react-reviewer | Mock `/me` không có capability → `useCan` false → gate ẩn. Mock `/me` có capability → gate hiện. API bypass FE gate → server guard chặn 403 (test ở G3-4). | useCan là O(1) store lookup; không API call per render; sensitive không leak vào map chung; FE component có unit test. |

> **Thứ tự thực thi:** G3-0 → G3-1 → G3-3 (RED) → G3-2 (GREEN) → G3-4 → G3-5.

---

## 5. Rủi ro & giảm thiểu

| Rủi ro | Khả năng | Tác động | Giảm thiểu |
|--------|----------|----------|------------|
| **Deny-overrides sai** (dừng ở ALLOW đầu tiên, bỏ qua DENY của role khác) | Trung bình | 🔴 chí mạng | Ca (c) trong G3-3 bắt buộc; collect ALL roles rồi aggregate. |
| **Sensitive bypass qua wildcard** (wildcard check trước is_sensitive) | Trung bình | 🔴 chí mạng | Ca (e)(h) G3-3; sensitive check TRƯỚC wildcard resolve trong code; FULL gate. |
| **RLS system roles — tenant sửa được** (policy `IS NULL` thiếu INSERT guard) | Thấp | 🔴 cao | Policy INSERT/UPDATE/DELETE chỉ `company_id = current_company`; regression test tenant UPDATE system role → reject. |
| **Cache stale expires_at** (role hết hạn, cache TTL 5 phút còn lên) | Trung bình | 🔴 cao | Store expiresAt trong cache payload; re-check mỗi cache hit (§3b). Ca (g) G3-3. |
| **Privilege-escalation object-permission** (user tự grant) | Thấp | 🔴 | Guard `grant-object-permission:permission` ở G3-4; ca self-grant trong G3-3. |
| **Fail-open khi DB lỗi** (exception nuốt → trả ALLOW) | Thấp | 🔴 | `silent-failure-hunter`; ca (l) G3-3 assert fail-closed; không catch rỗng. |
| **Guard pipeline sai thứ tự** (permission trước auth → panic) | Thấp | 🟠 | `JwtAuthGuard` đầu tiên; integration test token rỗng → 401 (không 403). |
| **N+1 FE** (nhiều `useCan()` → nhiều API call) | Thấp (nếu rõ) | 🟡 | Khẳng định O(1) store lookup; cấm API call trong `useCan()`; code review. |
| **Regression G2-5 miss bảng mới** | Trung bình | 🔴 | 5 bảng vào `rls-registry.ts` ở G3-1; CI fail nếu thiếu. |
| **Seed permission thiếu** (role không có quyền nào) | Trung bình | 🟠 | Seed từ spec; CI query "user company-admin không có role_permissions → fail". |

---

## 6. Test plan

- **Deny-path RED trước implement** (G3-3 trước G3-2): ≥20 ca deny, ≥10 ca allow.
- **Ca bắt buộc đặc thù G3 (ngoài danh sách mục 4):** deny-overrides-across-roles (c); sensitive-vs-wildcard (e); expires_at cache re-check (g); fail-closed DB-down (l); privilege-escalation self-grant.
- **Coverage:** ≥90% cho `PermissionService.can()`; ≥80% chung G3.
- **Integration (CI Postgres + Valkey thật):**
  - G3-1: regression G2-5 isolation suite với 5 bảng mới.
  - G3-2/3: `can()` unit test (in-memory mock DB OK cho logic test).
  - G3-4: guard pipeline integration (HTTP call thật: 401 vs 403 vs 200); cache invalidation (Valkey thật); expires_at expiry.
- **FULL gate** mọi diff G3 chạm permission/guard/cache: `security-reviewer + typescript-reviewer + silent-failure-hunter`.
- **Smoke test sau deploy:** danh sách 10 route chính — mỗi route test với token đúng quyền (200) và sai quyền (403).

---

## 7. Commit & merge

- Nhánh: `feat/g3-permission-engine` (cắt từ `master` sau khi G2 merge).
- Micro-commit: `docs(G3-0): permission-matrix-spec draft`, `feat(G3-1): roles/permissions schema + RLS + seed`, `test(G3-3): deny-path RED suite`, `feat(G3-2): PermissionService.can() 4-tier`, `feat(G3-4): guards + Valkey cache + invalidation`, `feat(G3-5): FE PermissionGate + useCan`.
- **Điều kiện merge:** CI xanh + FULL gate PASS + G3-3 deny-path suite xanh + G2-5 regression xanh + smoke test 10 route OK + `completion-evaluator` PASS.

---

## 8. Rollback

- Mỗi migration reversible (down drop bảng mới; không ảnh hưởng `users/companies` G2).
- **Guard rollback kill-switch:** nếu deploy guard gây false-deny hàng loạt → tắt `PermissionGuard` qua env flag `PERMISSION_GUARD_ENABLED=false` (fail-open tạm, log WARN, revoke ngay sau điều tra). Đây là emergency measure, không phải thiết kế thường.
- Smoke test 10 route sau deploy để phát hiện sớm trước khi hàng loạt user bị ảnh hưởng.
- Valkey cache là ephemeral → rollback bất cứ lúc, chỉ mất cache (không mất dữ liệu).

---

## 9. Custom component cần tạo

| Tên | Loại | Dùng ở | Khi |
|-----|------|---------|-----|
| `permission-deny-path-tester` | agent custom | G3-3 | trước G3-3 |
| `permission-matrix-spec.md` | tài liệu | G3-0 | gate cứng trước G3-1 |

---

## 10. Quyết định đã chốt (không còn mở)

| # | Quyết định | Lý do |
| -- | --------- | ----- |
| 1 | **Super-admin sensitive action = explicit ALLOW bắt buộc** (wildcard `*:*` không match sensitive) | BẤT BIẾN 4; reviewer CHẶN-2. Wildcard chỉ áp dụng non-sensitive. |
| 2 | **`permission-matrix-spec.md` là gate cứng trước G3-1** | Không có spec = không seed = không viết test đúng. |
| 3 | **Capabilities `/me` format = map** `{ "action:resourceType": boolean }` | O(1) FE lookup; tránh N+1 scan. |
| 4 | **TTL 5 phút + event-DEL + re-check expiresAt trong payload** | TTL = safety net (5 phút stale max khi event mất); re-check = tránh cửa sổ expires_at. |
| 5 | **G3 = flat roles, không có role hierarchy** | Role hierarchy kéo theo sensitive kế thừa → vi phạm BẤT BIẾN 4. Nếu cần sau này phải có plan riêng. |

---

## ✅ Checklist trước khi bắt đầu code

- [ ] G2 PR merge vào master; CI xanh.
- [ ] `permission-matrix-spec.md` tồn tại và đã duyệt (G3-0).
- [ ] Nhánh `feat/g3-permission-engine` cắt từ `master`.
- [ ] 5 bảng mới thêm vào `rls-registry.ts` (G3-1 đầu tiên).
- [ ] G3-3 test suite viết trước G3-2 (deny-path RED).
- [ ] Seed mapping role → permission từ spec đã có trong migration.
- [ ] Smoke test script 10 route sẵn sàng chạy sau deploy.

---

## ✅ Kết quả rà soát plan (`plan-reviewer`)

**Vòng 1 (2026-06-05): VERDICT = REVISE** → 4 vấn đề CHẶN + 8 vấn đề VÁ, đã vá hết:

1. **[CHẶN-1 · Deny-overrides across-roles]** `role_permissions` UNIQUE `(role_id, permission_id, effect)` thay vì PK `(role_id, permission_id)`; thuật toán §3b bổ sung "gom ALL roles, BẤT KỲ DENY → DENY"; test ca (c) bắt buộc.
2. **[CHẶN-2 · Sensitive boundary không có enforcement point]** Chốt: wildcard `*:*` KHÔNG match `is_sensitive = true`, kể cả super-admin. Ghi rõ trong §3b + test ca (e)(h). Câu hỏi mở #1 đã chốt.
3. **[CHẶN-3 · RLS system roles company_id NULL]** Policy `roles`: SELECT `= current OR IS NULL`; INSERT/UPDATE/DELETE `= current_company`; test tenant UPDATE system role → reject.
4. **[CHẶN-4 · expires_at vs cache TTL]** Store `expiresAt` trong cache payload; re-check mỗi cache hit; test ca (g) bao gồm cache-warm scenario.

**VÁ đã fold:**

- VÁ-1: Tuyên bố flat roles (không hierarchy) vào Scope NGOÀI.
- VÁ-2: WS/BullMQ defer G10, interface `can()` phải hỗ trợ non-HTTP caller.
- VÁ-3: Guard `grant-object-permission:permission` — privilege-escalation prevention.
- VÁ-4: Audit 100% mutation quyền qua `audit_logs` G2.
- VÁ-5: Seed permissions catalog + role_permissions mapping từ spec vào G3-1.
- VÁ-6: G3-0 gate cứng — spec phải tồn tại trước G3-1.
- VÁ-7: Rollback kill-switch env flag + smoke test 10 route.
- VÁ-8: TTL 5 phút = safety net rõ ràng; max 5 phút stale khi event mất.

_Vòng 2 nên chạy để xác nhận PASS sau các vá này._
