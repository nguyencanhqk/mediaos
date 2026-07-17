# S5-HR-ORGCHART-BE-1 — BE sơ đồ tổ chức (cây nhân sự theo quản lý trực tiếp)

> Zone: **red / crown-jewel** (data-scope + permission). Gate: **FULL** (security-reviewer + silent-failure-hunter).
> Owner boundary decision (2026-07-17): **Option A — scoped subtree only** (KHÔNG hiện cấp trên của actor).
> No migration, no new permission pair. Additive-only.

## 1. Phạm vi

Hai mặt, đều read-only + additive:

1. **`GET /api/v1/hr/org-chart/employees`** — dựng cây nhân sự theo `employee_profiles.direct_manager_id`
   (một `users.id`) ↔ `employee.user_id`, lọc theo data-scope của actor, node **chỉ directory-class**,
   chống cycle/orphan, không treo/500.
2. **`employeeCount` additive** vào response `GET /org/units/tree` — đếm employee active/đơn vị, giữ nguyên
   shape/field cũ (FE org-chart hiện tại KHÔNG gãy), không N+1.

`jobLevelName` **CÓ** trong node org-chart (WO done_when liệt kê tường minh) — khác với S5-HR-WORKINFO-1
(thêm jobLevelName/contractTypeName cho màn **chi tiết nhân viên + hồ sơ của tôi**, không phải node org-chart).
KHÔNG trong phạm vi: sơ đồ team, biểu đồ FE (S5-HR-ORGCHART-FE-1), cập nhật schema OrgTreeNode ở
`packages/web-core` (đường FE — app sẽ nhận `employeeCount` sau khi FE WO cập nhật web-core), rollup
headcount theo subtree (đếm TRỰC TIẾP/đơn vị).

## 2. Quyết định ranh giới data-scope (Option A — CHỐT)

Tái dùng **nguyên** pipeline của `GET /hr/employees`:

```
scope   = DataScopeService.resolveAndAssert(uid, cid, "read", "employee")   // 403 nếu thiếu grant
ctx     = DataScopeService.resolveContext(uid, cid)                         // đọc FRESH mỗi request
scopeSQL = DataScopeService.buildEmployeeScopeCondition(scope, ctx)         // Own/Team/Dept/Company/System
```

**Tập node = tập con ACTIVE của ĐÚNG predicate `buildEmployeeScopeCondition`** (§4: chỉ thêm điều kiện
`status='active'`). Đây là mỏ neo an toàn: org-chart KHÔNG BAO GIỜ lộ một node directory mà list không lộ
(tập org-chart ⊆ tập list cùng scope).

- **Company/System** → toàn bộ nhân viên active trong tenant.
- **Department** → nhân viên trong đơn vị actor sở hữu ∪ đơn vị actor đứng đầu (đúng predicate hiện có).
- **Team** → self ∪ direct reports ∪ EMR-managed (đúng predicate hiện có).
- **Own** → chỉ chính actor.
- **Thiếu cặp `read:employee`** → `resolveAndAssert` ném `ForbiddenException` → **403 + 0 dữ liệu**.

**KHÔNG có đường quản lý lên trên** (owner chọn A). Node nào có `direct_manager_id` trỏ tới người
**ngoài tập nhìn thấy** (hoặc null / chưa link user / đã nghỉ) → **thành node gốc (orphan)**. Không lộ gì
ngoài list ⇒ triệt tiêu lớp rò "listByTeam rò trong-tenant".

Bất biến #1: mọi query trong `withTenant(cid)`; predicate luôn AND `company_id` (belt-and-suspenders trên RLS).

## 3. Node = directory-class allowlist (Bất biến #3)

DTO Zod `.strict` — **CHỈ** các field sau, KHÔNG PII/salary/identity/contact/notes:

| Field | Nguồn |
| --- | --- |
| `employeeId` | `employee_profiles.id` |
| `userId` (nullable) | `employee_profiles.user_id` — dùng để nối cây + FE điều hướng (UUID mờ, list đã lộ) |
| `displayName` (nullable) | `users.full_name` (LEFT JOIN; null khi chưa link user) |
| `positionName` (nullable) | `positions.name` (LEFT JOIN) |
| `orgUnitName` (nullable) | `org_units.name` (LEFT JOIN) |
| `jobLevelName` (nullable) | `job_levels.name` (LEFT JOIN) |
| `avatarUrl` (nullable) | `employee_profiles.avatar_url` |
| `employeeCode` (nullable) | `employee_profiles.employee_code` |
| `children` | đệ quy |

Repo SELECT chỉ các cột trên (không kéo salary/PII vào bộ nhớ). Projection service map 1-1 sang node.
Int-spec assert **key của node ⊆ allowlist** (không có `phone/baseSalary/identityNumber/gender/...`).

## 4. Tập nhân viên đưa vào cây

`status = 'active'` AND `deleted_at IS NULL` AND `scopeSQL`. Chỉ nhân viên **active** là node ⇒
"manager đã nghỉ (resigned/inactive/terminated/soft-deleted) → report thành node gốc" xảy ra tự nhiên
(manager không nằm trong tập active nên không map được cha). Ghi rõ khác biệt có chủ đích với list
(list trả mọi status) — org-chart = cơ cấu **hiện hành**.

## 5. Thuật toán dựng cây (thuần in-memory, chống cycle — không treo/500)

Input: `rows: OrgNodeRow[]` (mỗi row có `employeeId`, `userId|null`, `directManagerId|null`, + field directory).

**Một nguồn object duy nhất:** dựng ĐÚNG 1 `Map<employeeId, node>` — roots và children đều **tham chiếu
cùng object** (không tạo 2 node cho 1 row); bước cắt cạnh-vòng cũng thao tác trên chính object đó ⇒ giữ
bất biến "mỗi node đúng 1 lần".

```text
nodeById = Map<employeeId, node>            // 1 object / row; node.children = []
byUser   = Map<userId, node>                // CHỈ node có userId != null (direct_manager_id trỏ users.id)
cyclesDetected = false

// Self-manager (directManagerId === userId) = cycle BẬC-1 (dữ liệu bất thường) → orphan-root + BẬT cờ.
isSelfManage(n) = n.directManagerId != null && n.directManagerId === n.userId
isParentLink(n) = n.directManagerId != null
                  && !isSelfManage(n)
                  && byUser.has(n.directManagerId)           // cha phải nằm trong tập nhìn thấy
if any isSelfManage(n): cyclesDetected = true

roots = []                                                   // orphan / self-manage → gốc
for n in rows:
    if isParentLink(n): byUser.get(n.directManagerId).children.push(nodeById.get(n.employeeId))
    else:               roots.push(nodeById.get(n.employeeId))   // manager null / ngoài tập / chưa-link / self
```

Chống cycle nhiều-bậc (A→B→A) bằng DFS từ roots với `visited: Set<employeeId>`:

```text
visited = new Set()
dfs(node): if visited.has(node.employeeId) return; visited.add(node.employeeId); for c in node.children dfs(c)
for r in roots: dfs(r)
// Bất kỳ node CHƯA visited ⇒ nằm trong vòng thuần (không có lối vào phi-chu-trình):
//   cắt cạnh vào (gỡ khỏi children của cha), PROMOTE lên root, set cyclesDetected=true, dfs tiếp — lặp tới khi phủ hết.
for n in rows where !visited.has(n.employeeId):
    cyclesDetected = true
    detach nodeById.get(n.employeeId) khỏi children của cha nó; roots.push(nodeById.get(n.employeeId)); dfs(nodeById.get(n.employeeId))
return { roots, cyclesDetected }
```

Bảo đảm: **kết thúc chắc chắn** (visited đơn điệu tăng), **mỗi node xuất hiện đúng 1 lần**, self-manage
HOẶC vòng nhiều-bậc → cây đã cắt vòng + `warnings.cyclesDetected = true`. Không đệ quy vô hạn, không 500.

Sắp thứ tự con/root theo `displayName` (nulls last) để output ổn định (dễ test/so sánh).

## 6. Response contract

```ts
orgChartEmployeeNodeSchema  // z.lazy đệ quy, .strict, chỉ field ở §3
orgChartEmployeeTreeSchema = z.object({
  roots: z.array(orgChartEmployeeNodeSchema),
  warnings: z.object({ cyclesDetected: z.boolean() }),
})
```

File: `packages/contracts/src/hr/org-chart.ts`, export qua `hr/index.ts`.

## 7. Headcount additive `/org/units/tree`

- `orgTreeNodeSchema` + type `OrgTreeNode`: thêm `employeeCount: z.number().int().nonnegative().optional()`
  — **OPTIONAL** để thật sự additive (0 consumer typecheck vỡ: `apps/console/.../org-structure.spec.tsx`
  có literal `const TREE_NODE: OrgTreeNode = {...}` không có field này; nếu required sẽ tsc đỏ). BE **luôn**
  populate (`?? 0`) nên runtime field luôn có mặt — FE badge dựa vào được.
- `OrgRepository.getOrgTree`: đếm **TRONG** `withTenant(companyId)` (bất biến #1) bằng 1 câu group-by (KHÔNG N+1):
  `SELECT org_unit_id, count(*)::int FROM employee_profiles WHERE company_id=$1 AND deleted_at IS NULL
   AND status='active' AND org_unit_id IS NOT NULL GROUP BY org_unit_id`.
  Merge `employeeCount = countMap.get(node.id) ?? 0` vào flat node **trước** `buildTree`. Local types
  `FlatNode`/`TreeNode` (org.repository.ts) thêm `employeeCount: number` để `buildTree` spread không thiếu field.
- `/org/units/tree` vẫn READ-mở (cơ cấu tổ chức + headcount active/đơn vị = aggregate không-PII; endpoint đã
  mở-đọc theo quyết định hiện hữu; WO chỉ định thêm headcount vào chính endpoint này; JwtAuthGuard+CompanyGuard
  vẫn ép đăng nhập + tenant). Đếm trực tiếp/đơn vị (không rollup).
- Lưu ý FE: `packages/web-core/src/lib/hr-org-api.ts` có schema `OrgTreeNode` RIÊNG (strip-unknown) → app FE
  sẽ **strip** `employeeCount` cho tới khi FE WO cập nhật web-core (ngoài phạm vi WO này; console dùng
  contracts schema trực tiếp nên nhận được ngay).

## 8. File đụng tới (additive)

**Tạo mới:**
- `packages/contracts/src/hr/org-chart.ts`
- `apps/api/src/employees/hr-org-chart.controller.ts` (`@Controller("hr/org-chart")`, guard read:employee)
- `apps/api/src/employees/hr-org-chart.service.ts`
- `apps/api/src/employees/hr-org-chart.repository.ts`
- `apps/api/src/employees/hr-org-chart.service.spec.ts` (unit: tree/cycle/orphan/allowlist — no DB)
- `apps/api/test/integration/hr-org-chart-scope.int-spec.ts` (deny/scope/cross-tenant/cycle/allowlist + employeeCount)

**Sửa (additive):**
- `packages/contracts/src/hr/index.ts` (+export org-chart)
- `packages/contracts/src/org.ts` (+employeeCount)
- `apps/api/src/org/org.repository.ts` (getOrgTree employeeCount)
- `apps/api/src/employees/employees.module.ts` (wire controller/service/repo — khối additive)
- `harness/backlog.mjs` (status)

**Route collision:** `@Controller("hr/org-chart")` + `@Get("employees")` = `hr/org-chart/employees`.
Segment `org-chart` ≠ `employees` ⇒ KHÔNG đụng `hr/employees/:id` của HrReadController.

## 9. Test (RED trước)

**Unit `hr-org-chart.service.spec.ts` (no DB):**
- orphan: manager null / manager ngoài tập / manager chưa-link → root
- nesting bình thường (2 cấp)
- cycle A↔B → `cyclesDetected=true`, mỗi node đúng 1 lần, không treo
- self-manager → root + warning
- projection allowlist: node CHỈ có key §3

**Int-spec `hr-org-chart-scope.int-spec.ts` (real app, gate `hasDb && LANE_DB`):**
- **deny**: user KHÔNG có grant read:employee → **403** (RED trước)
- **Own**: chỉ thấy node của mình
- **Team** (planted EMR + direct report 2 nhánh, bài học S2-INT-2): self ∪ report ∪ EMR-managed; NOT stranger
- **In-tenant upward-leak (case then chốt risk #1)**: Team-scope, seed 1 nhân viên IN-scope (EMR-managed)
  có `direct_manager_id` trỏ tới user IN-TENANT, **ACTIVE, NGOÀI scope actor**. Flatten TOÀN cây và assert:
  (i) nhân viên đó là **root**, (ii) manager thật của nó **VẮNG MẶT hoàn toàn** (`not.toContain` trên tập
  phẳng userId, không chỉ kiểm root-level). Đây là bằng chứng org-chart KHÔNG đắp cạnh lên trên qua predicate thật.
- **Department**: unit-head thấy đúng subtree đơn vị mình đứng đầu (own-unit ∪ headed-unit); node đơn vị khác vắng mặt
- **Company**: thấy toàn tenant; report của manager-đã-nghỉ (status≠active) = root (orphan)
- **cross-tenant**: tenant B KHÔNG thấy node tenant A (BẤT BIẾN #1)
- **cycle** A↔B planted → 200, `cyclesDetected=true`, không treo (+ self-manager → root + cờ, phủ ở unit)
- **allowlist**: response node (flatten) KHÔNG chứa field ngoài §3 (assert keys)
- **employeeCount**: seed employee active theo đơn vị → `GET /org/units/tree` trả `employeeCount` đúng;
  employee đã soft-delete/nghỉ KHÔNG đếm; cross-tenant không cộng chéo

## 10. Rủi ro & giảm thiểu

| Rủi ro | Giảm thiểu |
| --- | --- |
| Rò trong-tenant (listByTeam) | Tập node = ĐÚNG `buildEmployeeScopeCondition`; không đường lên trên (Option A) |
| Rò field nhạy cảm | Repo SELECT chỉ allowlist; DTO `.strict`; int-spec assert keys |
| Treo/500 do cycle | DFS visited-set, promote cạnh vòng thành root + cờ cảnh báo; unit-test cycle |
| N+1 headcount | 1 group-by; merge in-memory |
| FE org-tree cũ gãy | employeeCount additive, không đổi field cũ |
| Cross-tenant qua EMR planted | RLS + predicate AND company_id (đã có ở buildEmployeeScopeCondition); int-spec adversarial |

## 11. Definition of Done

typecheck/lint xanh · unit + int-spec (LANE_DB) xanh, deny-path RED-trước · node allowlist chốt · cycle
không treo · employeeCount đúng + không N+1 · FULL gate PASS · backlog cập nhật · **red zone: dừng ở PR,
owner chốt merge** (không auto-merge).
