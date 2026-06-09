# G3 — Review-Gate Artifact (dấu vết kiểm chứng)

> **Mục đích:** ghi lại dấu vết kiểm chứng cho review gate **FULL** của G3 (CLAUDE.md §6 + plan G3 §6/§7) — permission engine, vùng đỏ 🔴.
> Đây là **bản tổng hợp từ nguồn sự thật đã có** (`TASKS.md` G3 · `docs/plans/G3-permission-engine.md` · `docs/permission-matrix-spec.md` · `git log`) **CỘNG** một lượt **chạy lại test thật** trong phiên này (không tin snapshot — bài học `g4-gates.md` §5).
>
> Tạo: 2026-06-09 · Branch hiện tại: `feat/g6-media` · Nguồn gate level/reviewer: plan G3 §6 (FULL) + CLAUDE.md §6.

---

## 1. Bảng tổng hợp gate

| Sub-task | Gate | Reviewer (plan §6 / CLAUDE §6) | Trạng thái | Commit chính |
| --- | --- | --- | --- | --- |
| **G3-0** Gate cứng: `permission-matrix-spec.md` tồn tại | — | (gate tài liệu) | ✅ có ([`docs/permission-matrix-spec.md`](../permission-matrix-spec.md), nhãn G0-4) | `111ea52` (plan) |
| **G3-1** Schema 5 bảng + RLS+FORCE + seed catalog/role | **FULL** | `database-reviewer` + `tdd-guide` | ✅ passed | `480bf4b` |
| **G3-3** Test deny-path TRƯỚC (RED) | **FULL** | `tdd-guide` + `type-design-analyzer` | ✅ passed (RED→GREEN) | `6546eee` (RED) |
| **G3-2** `PermissionService.can()` 4 tầng (GREEN) | **FULL** | `security-reviewer` + `silent-failure-hunter` + `type-design-analyzer` | ✅ passed | `93f1923` → `3a2bf0c` (gate fixes) |
| **G3-4** Guards pipeline + Valkey cache + invalidation | **FULL** | `security-reviewer` + `silent-failure-hunter` | ⚠️ **passed một phần** (read/decision OK; *mutation/emit/audit chưa nối* — xem §4.1) | `b2d3767` |
| **G3-5** FE `<PermissionGate>` + `useCan()` | LIGHT | `typescript-reviewer` + `react-reviewer` | ✅ passed | `8f8d4ec` |
| Smoke test 10-route | — | (chore) | ✅ script | `22d1291` (`smoke-test-g3.sh`) |
| Close-out + mở G4 | — | — | ✅ | `ba13726` |

> **Lưu ý nguồn:** "✅ passed" = ghi nhận theo `TASKS.md` G3 (gate đã chạy ở các phiên trước, xác nhận bởi commit `3a2bf0c` "security + silent-failure gate fixes before merge"). File này **không** chạy lại reviewer agent, nhưng **có** chạy lại test suite (§3).

---

## 2. Chi tiết từng sub-task

### G3-0 — Gate cứng spec · ✅
- [`docs/permission-matrix-spec.md`](../permission-matrix-spec.md) tồn tại trước G3-1: 4 tầng, danh mục action × resourceType, đánh dấu `is_sensitive`, ma trận role × permission, ≥12 deny-case RED. Thỏa "không có spec = không seed = không viết test đúng" (plan §10 QĐ #2).

### G3-1 — Schema + RLS + seed · FULL ✅
- Migration [`0005_permissions.sql`](../../apps/api/migrations/0005_permissions.sql): 5 bảng `roles` / `permissions` / `role_permissions` / `user_roles` / `object_permissions`. **RLS + FORCE** tất cả.
- `roles`: USING `company_id = current OR IS NULL` (system role đọc được mọi tenant), WITH CHECK `= current_company` (tenant **không** ghi được system role) → chống CHẶN-3.
- `permissions` = catalog global, app role chỉ `SELECT` (không INSERT/UPDATE/DELETE).
- `role_permissions` UNIQUE `(role_id, permission_id, effect)` → cho phép ALLOW+DENY đồng tồn (test deny-wins) → chống CHẶN-1.
- Seed: 8 system role (company-admin … employee) + catalog ~100 permission; **sensitive KHÔNG seed cho role nào** (cấp tường minh per-user) → chống CHẶN-2.
- Drizzle [`schema/permissions.ts`](../../apps/api/src/db/schema/permissions.ts) khớp SQL.
- **G2-5 regression:** 5 bảng đã có trong [`test/integration/rls-registry.ts`](../../apps/api/test/integration/rls-registry.ts) (`roles`/`role_permissions` đánh `skipNoContext` cho system rows; `permissions` ghi chú là catalog global ngoài harness tenant-isolation).

### G3-3 — Deny-path RED · FULL ✅
- [`permission.service.spec.ts`](../../apps/api/src/permission/permission.service.spec.ts): 42 ca (27 deny + 15 allow) phủ đủ a–l của plan §4. Có nhóm RBAC (từ matrix §8) + reauth + idempotency + auditRequired.
- Viết TRƯỚC G3-2 (commit RED `6546eee` đứng trước GREEN `93f1923`).

### G3-2 — `can()` 4 tầng (GREEN) · FULL ✅
- [`permission.service.ts`](../../apps/api/src/permission/permission.service.ts): ưu tiên Object-DENY → Object-ALLOW → Company-DENY (deny-overrides-across-roles) → Company-ALLOW → default-deny.
- **Sensitive gate:** wildcard `*`/`*:*` KHÔNG thỏa; cần exact non-wildcard ALLOW. Defense-in-depth `effectivelySensitive = isSensitive || grant.isSensitive`.
- **expires_at re-check mỗi call** (an toàn cache-hit), `instanceof Date` guard.
- **Fail-closed:** mọi lỗi DB/infra → DENY + log, không false-ALLOW.
- Gate fixes pre-merge (`3a2bf0c`): logging trong catch, `auditRequired=isSensitive` khi fail-closed, `requiresReauth` guard cho nhánh non-sensitive, cross-check sensitive từ catalog.

### G3-4 — Guards + cache + invalidation · FULL ⚠️ (xem §4.1)
- Pipeline `JwtAuthGuard → CompanyGuard → PermissionGuard` ([`guards/`](../../apps/api/src/permission/guards/)). PermissionGuard **fail-closed khi thiếu `@RequirePermission`**, `@Public()` bypass, kill-switch `PERMISSION_GUARD_ENABLED=false`.
- `CachedPermissionRepository` ([`permission.cache.ts`](../../apps/api/src/permission/permission.cache.ts)): Valkey TTL 300s, fallback DB khi Valkey lỗi (best-effort, không nuốt lỗi sai).
- `PermissionCacheInvalidator` ([`permission.module.ts`](../../apps/api/src/permission/permission.module.ts)) subscribe `permission.changed` → `invalidateUser()` DEL cap key.
- ⚠️ **Read/decision path hoàn chỉnh & test xanh. Mutation/emit/audit path CHƯA tồn tại** — xem §4.1.

### G3-5 — FE PermissionGate + useCan · LIGHT ✅
- [`/me`](../../apps/api/src/auth/auth.service.ts) trả `capabilities: Record<"action:resourceType", boolean>` — chỉ **non-sensitive** (lọc `!g.isSensitive`), sensitive không leak vào map chung.
- [`useCan`](../../apps/web/src/hooks/use-can.ts) đọc Zustand store O(1), wildcard fallback, KHÔNG gọi API per-check. [`PermissionGate`](../../apps/web/src/components/permission-gate.tsx) render children/fallback.

---

## 3. Re-run kiểm chứng 2026-06-09 (chạy thật trong phiên này — không tin snapshot)

| Hạng mục | Lệnh | Kết quả |
| --- | --- | --- |
| Unit suite permission (4 file: service + g3-4 guards/cache + 2 reveal G6) | `vitest run src/permission` | ✅ **80 passed / 80** |
| FE `useCan` + `PermissionGate` | `vitest run use-can.spec + permission-gate.spec` | ✅ **14 passed / 14** |

> Tại thời điểm đóng G3 (`TASKS.md`): 52 service + 20 guard/cache + 14 FE. Con số 80 hiện tại gồm các test reveal-secret thêm ở G6-2e (`permission.service.reveal.spec.ts`, `permission.guard.reveal.spec.ts`) — không hồi quy G3.

---

## 4. Re-review 2026-06-09 — phát hiện (đối chiếu working tree thực)

### 4.1. 🔴 HIGH — Nhánh *mutation/write* của G3 chưa tồn tại, dù G3-4 đánh ✅ (cùng loại lỗ hổng quy trình `g4-gates.md` §5)

Đã grep xác nhận trên working tree:

1. **`permission.changed` chỉ được *subscribe*, KHÔNG nơi nào *emit*** (`grep emit/publish/outbox permission.changed` → rỗng). ⇒ `invalidateUser()` là **code chết-cho-đến-khi-nối**; cache chỉ dựa TTL 5 phút, **không** invalidate <100ms như DoD tuyên bố.
2. **Không có endpoint ghi `user_roles` / `object_permissions`** (`grep user_roles/assignRole` ngoài permission+test → rỗng). Role chỉ gán qua **seed/migration/test**. ⇒ DoD "đổi role/quyền: ghi audit + emit outbox" và "audit 100% mutation quyền" **chưa hiện thực** (không có bề mặt mutation để audit).
3. **Không có `PATCH/POST /permissions/object`** (plan §2 "Trong" + G3-4c). Guard chống privilege-escalation chỉ test cô lập (ca 14 mock `permMeta`); **không có controller thật**, và permission `grant-object-permission:permission` **KHÔNG có trong catalog 0005** → đúng *bẫy F2/G4*: action ở decorator/test nhưng thiếu catalog → nếu sau gắn endpoint mà quên seed sẽ deny-403 oan tất cả.

> **Hệ quả:** G3 an toàn *hôm nay* (không endpoint = không vector leo thang). Nhưng đây là **mìn cho G5/G7**: khi thêm UI quản lý role/object-permission BẮT BUỘC (a) emit `permission.changed`, (b) ghi audit, (c) seed `grant-object-permission:permission`. Nếu không → cache stale ≤5 phút + mất audit.
>
> **Đề xuất chỉnh trạng thái:** hạ G3-4 từ "✅" → "✅ read-path / ⏳ mutation-path nợ G5/G7" trong `TASKS.md`.

### 4.2. 🟠 MEDIUM — Drift hai nguồn sự thật: matrix-spec có Tầng 2 (Scope), implementation thì không

- [`permission-matrix-spec.md` §1/§8](../permission-matrix-spec.md) định nghĩa 4 tầng = **RBAC / Scope / Object / Sensitive**, liệt deny-scope (ca 4–9) là RED bắt buộc.
- [`G3-permission-engine.md` §3b](../plans/G3-permission-engine.md) **định nghĩa lại** 4 tầng = object± / company± (bỏ Scope). Implementation theo plan: `can()` **không có Tầng 2**; `deny-scope` tồn tại trong type nhưng **không bao giờ trả về**; ca scope §8 không có trong service spec.
- Scope thực tế ép rải rác ở query-layer từng module + RLS — hợp lý cho MVP, **nhưng drift chưa ghi nhận**. Cần 1 dòng quyết định dứt khoát ("Tầng 2 → query-layer; `deny-scope` vestigial") hoặc cập nhật matrix-spec.

### 4.3. 🟡 LOW (latent — chưa kích hoạt vì seed không có wildcard)

- **Seed 0005 không có `super-admin`/`*:*`** (khác plan §3b vốn bàn kỹ super-admin wildcard). Thực tế company-admin được liệt kê tường minh mọi non-sensitive — *an toàn hơn*. Ca (e)(h) wildcard chỉ là mock unit-test. → nên ghi "MVP không seed wildcard".
- **Nếu sau seed `*:*`:** `getCapabilities` đưa `"*:*": true` vào map FE → `useCan` trả `true` cho cả sensitive (FE hiện nút mà server 403 — lệch UX, không phải lỗ bảo mật).
- **Sensitive-bypass nếu decorator quên `isSensitive` + user giữ `*:*`** ([`permission.service.ts:120`](../../apps/api/src/permission/permission.service.ts#L120)): wildcard mang `isSensitive=false` nên không kích defense-in-depth. Gợi ý: service tra `is_sensitive` từ catalog thay vì tin cờ decorator.
- **Down-migration 0005 chỉ là comment** (`-- DROP TABLE …`) — không thực thi, trái plan §8 "reversible" (có thể là quy ước forward-only chung — nên thống nhất).
- **Cosmetic:** cột `roles.is_system` (thực) vs `is_sensitive_boundary` (plan G3-1) — đặt tên khác, không ảnh hưởng logic.

---

## 5. Kết luận

- **Lõi quyết định quyền (can / guards / cache-read / FE): ĐẠT** — test xanh thật (80 api + 14 web), đúng 12 ca bắt buộc (a–l), fail-closed + deny-overrides-across-roles + sensitive-chặn-wildcard + expires re-check đều có bằng chứng. Đây là crown-jewel và nó vững.
- **Nhánh ghi/đổi-quyền: THIẾU** (emit `permission.changed`, audit-on-change, endpoint grant role + object-permission, seed `grant-object-permission`). G3-4 hiện đánh ✅ vượt thực tế code → chuyển thành nợ G5/G7 (§4.1).
- **Drift matrix-spec ↔ plan về Tầng 2 (Scope)** cần một quyết định chính thức (§4.2).

⚠️ G3 đủ đóng về **chức năng read/enforce** cho MVP; **nợ quy trình** là nhánh mutation chưa nối + drift scope chưa ghi nhận. Hai việc này phải xử lý TRƯỚC khi G5/G7 thêm bề mặt quản lý quyền.

_Tham chiếu: `TASKS.md` (G3, dòng 156–164) · `docs/plans/G3-permission-engine.md` · `docs/permission-matrix-spec.md` · CLAUDE.md §3/§5/§6 · ADR-0010._
