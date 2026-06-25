# S2-AUTH-BE-2 — Permission + data-scope resolver guard (micro-plan)

> Crown-jewel / red zone. Model Opus. FULL gate (security-reviewer + silent-failure-hunter) + người chốt.
> Branch `feat/s2-auth-be-2` cắt từ master `a0ace35` (#26). Mig head `0445`. **KHÔNG migration mới** (cột
> `role_permissions.data_scope` đã có từ S2-AUTH-DB-1 / mig 0441). **KHÔNG push master.**
>
> Nguồn: IMPLEMENTATION-05 §9.1 (AUTH-S2-004) §13 §15.1 · BACKEND-03 §17/§18/§26.4 · API-10 · ISSUE-BOARD-01 §18.3 (AUTH-BE-004).

## 1. Mục tiêu (done_when backlog)
1. `PermissionService` + scope resolver: dịch `data_scope` → điều kiện truy vấn — Own=self · Team/Department=cây quản lý · Company=tenant · System=toàn hệ thống; **deny-overrides giữ nguyên**.
2. Guard/middleware **tái dùng** cho HR API (S2-HR-BE-*) — KHÔNG hard-code role; thiếu quyền → 403 **TRƯỚC** khi chạm dữ liệu.
3. Deny-path RED **viết trước**: employee chỉ thấy scope Own · cross-tenant deny (RLS + resolver) · scope rộng hơn grant → 403 · coverage vùng nhạy cảm ≥80%.
   - **Reconcile done_when #3 (plan-review #6):** "scope rộng hơn grant" enforce bằng **thu hẹp rows** (resolver trả đúng scope được cấp; predicate giới hạn), KHÔNG ném 403. 403 chỉ khi **không có grant nào**. Test chứng minh non-escalation (rowset = tập scope cấp), không assert 403 cho trường hợp narrowing.

## 2. As-built đã có (KHÔNG dựng lại — chỉ chồng lên)
- `PermissionService.can()` — cổng 4-tier ALLOW/DENY (hot-path, **KHÔNG sửa**).
- `PermissionService.getCapabilityScopes()` (BE-1) — union scope/cặp cho `/auth/me` (display, fail-safe `{}`). Đây là **gợi ý FE**, KHÔNG phải cổng.
- `PermissionGuard` (`guards/permission.guard.ts`) + `@RequirePermission(action,resourceType,opts)` — cổng permission, fail-closed 403. Đã gate action:resourceType nhưng **CHƯA** giải data_scope.
- `getCompanyRoleGrantsWithScope()` (repo + cache passthrough) — trả grant kèm `dataScope`.
- DB: `role_permissions.data_scope` (CHECK Own/Team/Department/Company/System, mig 0441) đã seed per-pair §13 (mig 0444). `employee_profiles` (mig 0442): `user_id`, `direct_manager_id`→users, `org_unit_id`→org_units; `employee_manager_relations` (manager_user_id/employee_user_id, relation_type) cho đa-quản-lý.
- Contract `DATA_SCOPES`/`DataScope` (`@mediaos/contracts`) ↔ `ROLE_DATA_SCOPES` (apps/api schema) — đã có test đồng bộ.

## 3. Ranh giới BE-2 vs S2-INT-2 (quyết định coupling AUTH↔HR)
**Vấn đề:** Team/Department cần dữ liệu cây quản lý của HR, nhưng HR endpoints (S2-HR-BE-1) CHƯA build và **phụ thuộc vào BE-2**. Không được để BE-2 phụ thuộc ngược HR.

**Quyết định:**
- BE-2 đọc **TRỰC TIẾP bảng `employee_profiles`** (schema đã land) qua 1 repo nhỏ trong permission module — KHÔNG import HR service. Đây là quan hệ **đọc-only schema dùng chung**, không phải coupling module.
- BE-2 giao **Team = direct report** (`direct_manager_id = ctx.userId`) + **Department = cùng org_unit** (`org_unit_id = orgUnit của requester`). Đây là MVP linear (BE03-OQ-005: direct-only; multi-level tree = Phase 2). **Đa-quản-lý qua `employee_manager_relations` + org-unit head = S2-INT-2** (WO đó "tích hợp HR direct_manager ↔ data-scope Team/Department"). BE-2 để 1 hook mở rộng (provider) nhưng default = direct/org-unit.
- Own/Company/System **không cần HR** → hoạt động đủ ngay ở BE-2.

## 4. Thiết kế

### 4a. Engine: `PermissionService.resolveStrongestScope()` (sửa `permission.service.ts`, additive)
```
resolveStrongestScope(userId, companyId, action, resourceType): Promise<DataScope | null>
```
Thuật toán (PIN chặt — chống nới scope ngầm, theo plan-review #1/#2/#3):
1. Đọc `getCompanyRoleGrantsWithScope`, lọc active (tái dùng `isGrantActive`).
2. **Deny-overrides (wildcard-aware, Y HỆT getCapabilities/can):** có DENY khớp (`a:r`, `*:r`, `a:*`, `*:*`) → trả `null` (chặn tuyệt đối, ưu tiên cao nhất).
3. Tách ALLOW khớp thành **EXACT** (`g.action===action && g.resourceType===resourceType`) và **WILDCARD** (khớp nhờ `*`).
4. **Mỗi grant đóng góp ĐÚNG `dataScope` của chính nó** — KHÔNG bao giờ "nâng cấp" (KHÔNG có chuyện `*:*` → System; seed §13 là cặp-exact, wildcard nếu có mang default `'Company'`, mig 0441). Bỏ ví dụ sai "`*:*` System".
5. **Sensitive gate (mirror `can()` :124-131):** `effectivelySensitive = bất kỳ ALLOW khớp nào có isSensitive`. Nếu sensitive → **chỉ EXACT non-wildcard ALLOW** đủ điều kiện đóng góp scope (wildcard KHÔNG thoả — y như can()).
6. **Precedence EXACT > WILDCARD (chống leak #2):** nếu có ≥1 EXACT ALLOW đủ điều kiện → chọn scope MẠNH NHẤT **chỉ trong EXACT**. Nếu KHÔNG có exact và không-sensitive → fallback chọn mạnh nhất trong WILDCARD. Lý do: §13 scope là per-cặp-exact; 1 role khác có `*:* = Company` KHÔNG được nới `Team` (exact của line-manager) thành Company.
7. Thứ tự mạnh: `System(5) > Company(4) > Department(3) > Team(2) > Own(1)`.
8. Không ALLOW đủ điều kiện → `null`. Lỗi hạ tầng → **fail-closed `null`** (KHÁC getCapabilityScopes fail-safe `{}` cho UI; đây là cổng).
- KHÔNG đụng `can()`; method MỚI độc lập. KHÔNG đổi `CompanyRoleGrant`/`CanInput`.

### 4b. `DataScopeService` (file MỚI `apps/api/src/permission/data-scope.service.ts`)
API tối thiểu (BACKEND-03 §26.4, cắt gọn theo YAGNI — chỉ employee target Sprint 2):
```
buildEmployeeScopeCondition(scope, ctx): SQL | null      // list filter, DB-level
isEmployeeInScope(scope, ctx, target): Promise<boolean>  // single-resource detail/action check
resolveAndAssert(userId, companyId, action, resourceType): Promise<DataScope>  // gate: resolve scope hoặc ném Forbidden
```
- `ctx: ScopeContext = { userId, companyId, orgUnitId? }` — `orgUnitId` nạp lười từ `employee_profiles` của requester khi cần (Department).
- `target: EmployeeScopeTarget = { userId, orgUnitId, companyId, directManagerUserId? }`.
- **Map scope → predicate trên `employee_profiles`** (Drizzle `SQL`, AND vào query của consumer; **LUÔN tự kèm `company_id` — KHÔNG trả `null` no-op**, belt-and-suspenders trên RLS, plan-review #9):
  - `System` → `eq(company_id, ctx.companyId)` (N=1 single-tenant: System vẫn giới hạn tenant hiện tại; cross-system out-of-MVP). Ghi chú rõ.
  - `Company` → `eq(company_id, ctx.companyId)` (KHÔNG `null`).
  - `Department` → `and(eq(company_id,ctx.companyId), eq(org_unit_id, ctx.orgUnitId))`; requester không có org_unit → `sql\`false\`` (fail-closed).
  - `Team` → `and(eq(company_id,ctx.companyId), or(eq(direct_manager_id, ctx.userId), eq(user_id, ctx.userId)))` — **reports ∪ self** (manager thấy cả mình, plan-review #7).
  - `Own` → `and(eq(company_id,ctx.companyId), eq(user_id, ctx.userId))`.
  - scope `null`/không hợp lệ → `sql\`false\`` (0 hàng — KHÔNG rò).
- `isEmployeeInScope` (in-memory boolean — **defense-in-depth #4**): **TRƯỚC TIÊN** `if (target.companyId !== ctx.companyId) return false` cho MỌI scope (kể cả System/Company; N=1). Sau đó: System/Company→true; Department→`target.orgUnitId===ctx.orgUnitId`; Team→`target.directManagerUserId===ctx.userId || target.userId===ctx.userId`; Own→`target.userId===ctx.userId`. null→false.
  - **Hợp đồng (plan-review #3a):** `isEmployeeInScope` là **bộ lọc scope, KHÔNG phải cổng auth**. Consumer PHẢI gọi `can(...,resourceId)` / `resolveAndAssert` TRƯỚC (object-tier DENY + sensitive gate do `can()` lo), rồi mới dùng `isEmployeeInScope` để chặn ngoài-phạm-vi. Ghi rõ trong JSDoc + note cho HR-BE-1.
- `resolveAndAssert`: gọi `resolveStrongestScope`; `null` → `ForbiddenException('AUTH-ERR-FORBIDDEN: out of permission')`. Trả scope để consumer build filter. **Thiếu quyền → 403 TRƯỚC khi đọc dữ liệu** (done_when #2). **KHÔNG nhận requested-scope** → "scope rộng hơn grant" KHÔNG ném 403 mà **thu hẹp** (xem §5b/§7 done_when #3 reconcile).

### 4c. Repo: `apps/api/src/permission/data-scope.repository.ts` (MỚI)
- `getRequesterOrgUnitId(userId, companyId): Promise<string|null>` — đọc `employee_profiles.org_unit_id` của requester qua `withTenant` (RLS).
- **GUARDRAIL (plan-review #8):** CHỈ import **schema table** (`employee_profiles` từ `db/schema`) — TUYỆT ĐỐI KHÔNG import `EmployeesModule`/`EmployeeService`/bất kỳ Nest module HR nào (tránh DI-cycle; HR-BE-1 depends_on BE-2). Schema là plain Drizzle table → không tạo vòng. KHÔNG thêm import HR vào `permission.module.ts`.
- (test-only helper read employee subset qua filter — dùng trong int test để CHỨNG MINH predicate, không phải API công khai).

### 4d. Wiring `permission.module.ts` (additive)
- Provide `DataScopeService` + `DataScopeRepository`; **export `DataScopeService`** để HR module (S2-HR-BE-1) inject. KHÔNG sửa `app.module.ts`. KHÔNG đổi guard order.

### 4e. Decorator — KHÔNG mở rộng route metadata
- Scope là **dữ liệu (grant của user)**, KHÔNG phải khai báo route → resolver đọc scope THỰC của user, không cần `@RequireScope`. Giữ `@RequirePermission` nguyên (YAGNI; tránh 2 nguồn sự thật). Cổng scope = `DataScopeService` mà consumer gọi (đúng BACKEND-03 §18.2/§18.3: service filter/assert, không guard mù vì scope cần resource).

## 5. Test (RED trước — done_when #3)
### 5a. Unit (colocated, BẮT BUỘC chạy): `apps/api/src/permission/data-scope.service.spec.ts`
- `resolveStrongestScope`:
  - chọn mạnh nhất khi nhiều role exact (Own+Department→Department; +Company→Company).
  - **DENY-override khớp → null** (employee bị DENY view:employee → không scope, kể cả có ALLOW).
  - **exact > wildcard (plan-review #2):** exact `view:employee=Team` + wildcard `*:*=Company` → **Team** (KHÔNG Company).
  - **wildcard-only:** chỉ `*:*=Company`, không exact → `Company` (đóng góp đúng dataScope của nó, KHÔNG nâng System — plan-review #1).
  - **sensitive (plan-review #3b):** pair sensitive + chỉ wildcard ALLOW → wildcard KHÔNG thoả → `null`; sensitive + exact ALLOW=Company → `Company`.
  - không khớp → null; lỗi DB → null (fail-closed).
- `buildEmployeeScopeCondition`: Own/Team/Department/Company/System → đúng predicate (assert luôn kèm `company_id`; Team có `or(direct_manager, user_id)`); scope null → `false`; Department thiếu orgUnit → `false`.
- `isEmployeeInScope`: từng scope true/false; **target.companyId≠ctx.companyId → false cho MỌI scope** (kể cả Company/System, plan-review #4); Team self→true; null→false.
- `resolveAndAssert`: null scope → ForbiddenException (no-grant).

### 5b. Integration (LANE_DB gated `hasDb && LANE_DB`): `apps/api/test/integration/data-scope-resolver.int-spec.ts`
Seed 2 company (A,B) + employees: empSelf, manager (quản empSelf qua direct_manager_id), peer khác org_unit, employee công ty B. Build select `employee_profiles` AND `buildEmployeeScopeCondition`:
- **Own**: empSelf chỉ thấy chính mình (1 hàng = self).
- **Team**: manager thấy direct report (empSelf), KHÔNG thấy peer ngoài cây.
- **Department**: thấy đúng cùng org_unit, không thấy org_unit khác.
- **Company**: thấy mọi employee company A, **KHÔNG** thấy company B (RLS + tenant).
- **Cross-tenant**: ctx company A + predicate → 0 hàng của B (BẤT BIẾN #1).
- **scope rộng hơn grant = THU HẸP, KHÔNG 403 (reconcile done_when #3, plan-review #6):** user chỉ có grant Own → `resolveStrongestScope`=Own → `buildEmployeeScopeCondition` cho **đúng tập Own** (1 hàng self), **assert rowset === tập Own** (không leo thang lên Company). 403 CHỈ dành cho **no-grant** (`resolveAndAssert` → ForbiddenException). Đây là diễn giải đúng: enforcement = narrowing rows; cổng 403 = thiếu quyền hoàn toàn.
- `resolveAndAssert` thiếu grant hoàn toàn → 403.

## 6. BẤT BIẾN giữ
- #1 tenant: mọi đọc qua `withTenant`; predicate luôn AND `company_id` (consumer) + RLS; cross-tenant test xanh.
- #2: KHÔNG ghi/append-only liên quan (resolver read-only).
- #3 secret: KHÔNG log grant/scope nhạy cảm; KHÔNG token/secret trong DTO.
- Hot-file: `permission.service.ts`/`permission.module.ts` = **append additive** (method/provider mới), KHÔNG rewrite `can()`.

## 7. Acceptance đo được
- **Path note (plan-review #5):** int spec ở `apps/api/test/integration/**` NẰM NGOÀI WO paths gốc (`permission/**`,`auth/**`) → **mở rộng `paths` trong backlog.mjs** thêm `apps/api/test/integration/**` (tiền lệ DB-1/DB-2/BE-1) như một phần WO này; guard-scope hết cảnh báo.
- `pnpm --filter @mediaos/api typecheck` + eslint xanh.
- Unit spec mới **xuất hiện trong run summary** (colocated `src/permission/**`), RED→GREEN có bằng chứng.
- Int spec LANE_DB: ≥8 case trên DB cô lập (chain 0000→0445) PASS; cùng spec KHÔNG LANE_DB → SKIP (chứng gate thật).
- FULL gate: security-reviewer 0 CRITICAL/HIGH · silent-failure-hunter PASS (fail-closed null, không nuốt lỗi).
- Regression engine: `permission.service.spec.ts` + `permission.scopes.spec.ts` + guard specs còn xanh (không sửa-để-qua).

## 8. Không làm (scope creep / defer)
- Đa-quản-lý `employee_manager_relations`, org-unit head, multi-level tree → **S2-INT-2** / Phase 2.
- Project scope → TASK module (Sprint 4).
- Sửa controller HR thực để áp filter → **S2-HR-BE-1** (BE-2 chỉ giao service + chứng minh bằng int test).
- Cache scope invalidation event → follow-up (TTL hiện 300s của permission cache đủ MVP; getCapabilityScopes/resolve đọc tươi, KHÔNG cache).
- Migration / contracts → ngoài paths, không cần.
