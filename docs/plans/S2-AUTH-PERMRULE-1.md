# S2-AUTH-PERMRULE-1 — Gán quyền theo LUẬT khớp mẫu (rule builder)

> Owner-request 2026-07-08: sau khi đề xuất 3 mô hình, chọn **"Làm thẳng builder luật khớp mẫu"**
> (Pattern rules, bỏ qua pha Templates). Zone **red** (permission WRITE, crown-jewel) → FULL gate,
> plan-reviewer TRƯỚC khi code.

## Mục tiêu
Admin dựng 1 **luật** = bộ khớp trên catalog quyền (`resourceType` × nhóm `action` × lọc độ nhạy)
+ 1 `dataScope`; server **bung** ra tập grant khớp, cho **xem trước (dry-run)**, rồi áp vào vai trò.
Thay cho việc tick tay từng dòng ở RolePermissionsPage.

## Hiện trạng (tái dùng, KHÔNG đụng)
- `RolePermissionsPage` v2 (PERMUX-1): gán/thu hồi + bulk-tick, nhóm theo `resourceType`, trạng thái
  thật qua `GET /auth/roles/:id/permissions`.
- Mutation server ĐỦ: `POST /auth/roles/:id/permissions` (assign:permission **isSensitive**, idempotent
  cùng scope, đổi scope = DELETE+INSERT, **scope-ceiling** chặn System, **anti-escalation**) + `DELETE`.
- Catalog: `GET /auth/permissions` (view:permission) → `[{action, resourceType, isSensitive}]`.
- `permission-labels.ts` (nhãn tiếng Việt). `CloneRoleDialog` = pattern "áp tuần tự + báo từng dòng".
- **KHÔNG có** cơ chế bung 1 luật → nhiều grant.

## Thiết kế

### #1 BE — endpoint `apply-rule` (ghi qua ĐÚNG đường cũ, không mở cổng mới)
- Route: `POST /auth/roles/:id/permissions/apply-rule`
  gate `@RequirePermission("assign","permission",{ isSensitive: true })` — **cùng cặp + độ nhạy** như
  assign thủ công (chỉ company-admin; hr/employee KHÔNG có).
- Contracts `applyPermissionRuleSchema` (request):
  ```
  match: {
    resourceTypes: string[]          // [] = mọi resource; hoặc danh sách cụ thể (từ catalog)
    actionPreset: 'read-only' | 'crud' | 'custom'
    actions: string[]                // CHỈ dùng khi preset='custom' (phải khớp catalog)
    includeSensitive: boolean        // default false
  }
  effect: 'ALLOW'                    // MVP CHỈ ALLOW (DENY = deny-overrides, nguy hiểm → thủ công, phase sau)
  dataScope: 'Own'|'Team'|'Department'|'Company'   // Zod enum KHÔNG có System (ceiling)
  dryRun: boolean
  ```
- Service `applyPermissionRuleToRole(actor, roleId, dto)`:
  1. Gate `assertCan(assign, permission, isSensitive=true)` fail-closed TRƯỚC mọi DB access.
  2. Lan can matcher (BadRequest, 0 ghi): `preset='custom'` mà `actions=[]` → 400; `includeSensitive=true`
     VÀ `resourceTypes=[]` → 400 ("luật gồm quyền nhạy cảm phải giới hạn resourceType" — chặn "gán mọi
     quyền nhạy cảm 1 phát").
  3. `withTenant`: `findRoleByIdTx` → 404; `role.isSystem` → **400** (KHÔNG áp lên vai trò hệ thống,
     mirror update/delete); `companyId !== actor.companyId` → 404.
  4. Đọc catalog + grants hiện có. **[PLAN-FIX MED-1]** `listPermissionsTx` KHÔNG ở `RoleAdminRepository`
     (chỉ có `findPermissionTx` đơn + `listRolePermissionsTx`) — nó ở **`PermissionAdminRepository`**
     (`permission-admin.repository.ts:260`). → **tiêm `PermissionAdminRepository` vào `RoleAdminService`**
     (cùng `permission.module`, acyclic) để đọc catalog; grants qua `listRolePermissionsTx` sẵn có.
  5. **Bung matcher** → tập cặp `(action, resourceType)`:
     - resourceTypes `[]` → mọi resource; else `resourceType ∈ set`.
     - **[PLAN-FIX MED-2] action theo MẪU TÊN, không phải tập cứng** (catalog ATT/LEAVE dùng verb-suffix:
       `view-own/view-team/view-company/check-in`, `create/submit/approve`… — tập cứng `{view,read,list}`
       KHÔNG khớp): `read-only` = action khớp regex `^(view|read|list)(-|$)` (bắt cả `view-own/view-team`)
       · `crud` = `^(create|read|update|delete|view|list)(-|$)` · `custom` = `actions[]` (phải khớp catalog).
     - lọc `!includeSensitive` → BỎ `is_sensitive=true` (gom vào `excludedSensitive`).
  6. **Diff** với grants hiện có. **DENY ưu tiên** (tránh churn ALLOW vô nghĩa vì deny-overrides luôn thắng):
     - có DENY cùng cặp → `skipped` (đang DENY — rule ALLOW KHÔNG ghi đè, kiểm TRƯỚC) ·
       ALLOW cùng scope → `skipped` (đã có) · ALLOW khác scope → `toChangeScope` (preview nêu rõ **hướng
       mở-rộng/thu-hẹp** — DELETE+INSERT có thể HẠ scope) · chưa có → `toAdd`.
  7. `dryRun=true` → trả `{ toAdd[], toChangeScope[], skipped[], excludedSensitive[], counts }`,
     **KHÔNG ghi, KHÔNG audit**.
  8. `dryRun=false` → áp tuần tự `toAdd ∪ toChangeScope` qua **`assignPermissionToRole`** (audit từng
     grant + anti-escalation là cổng cuối), thu kết quả từng dòng; + 1 audit summary
     `RolePermissionRuleApplied`. **[PLAN-FIX MED-4]** `objectType: "role_permission"` (đã là thành viên
     hợp lệ của union đóng băng `AuditObjectType` — mirror PermissionAssigned, `role-admin.service.spec.ts:240`;
     KHÔNG bịa type mới → KHÔNG cần migration CHECK), `objectId = roleId`, `after = { resourceTypes,
     actionPreset, effect, dataScope, addedCount, changedCount }`. Summary-audit mở `withTenant` RIÊNG,
     **chỉ khi `!dryRun`** (dryRun ⇒ 0 audit).
  - **Mô hình transaction (chốt):** mỗi `assignPermissionToRole` tự mở `withTenant` (mirror `CloneRoleDialog`
    server-side) — KHÔNG atomic toàn-bộ. Lỗi giữa chừng → subset đã ghi, báo rõ từng dòng, KHÔNG rollback
    (admin thấy và gán bù). Chấp nhận (đồng thuận với clone).
- Contracts `permissionRulePreviewSchema` (response): 4 mảng cặp + `counts` + (khi !dryRun) `applied[]`.

### #2 FE — Rule builder trong `RolePermissionsPage`
- Nút "Gán theo luật" ở header — `useCanExact(assign, permission)` (mirror thanh bulk hiện có).
- Dialog builder:
  - Multi-select `resourceTypes` (từ catalog; rỗng = cảnh báo "áp cho MỌI resource").
  - Radio `actionPreset`: **Chỉ đọc** (view/read/list) · **CRUD** · **Tuỳ chọn** (mở multi-select actions).
  - Toggle "Gồm quyền nhạy cảm" (mặc định TẮT; bật → cảnh báo đỏ; **disable** khi resourceTypes rỗng).
  - Select `dataScope` (≤ Company).
  - "Xem trước" → `apply-rule` dryRun → bảng: **Thêm N · Đổi scope M · Bỏ qua K · Loại vì nhạy cảm S**
    (liệt kê từng cặp, nhãn tiếng Việt).
  - "Áp dụng N thay đổi" (disable tới khi đã xem trước) → `apply-rule` !dryRun → kết quả từng dòng
    (tái dùng UI CloneRoleDialog) → `invalidate` grants.
- web-core `roleAdminApi.applyPermissionRule(roleId, body)`.

### #3 Test (RED trước — deny-path)
- Unit service: 403 thiếu assign:permission · system role 400 · cross-tenant 404 ·
  (includeSensitive & resourceTypes=[]) → 400 · (custom & actions=[]) → 400 · **[MED-2]** preset read-only
  bung đúng theo mẫu tên trên resource verb-suffix (`attendance`: khớp `view-own/view-team/view-company`,
  KHÔNG `check-in`) · !includeSensitive loại sensitive · **dryRun KHÔNG ghi/audit** · apply idempotent (đã
  có cùng scope → skip, 0 assign) · đổi scope gọi assign scope mới · **DENY cùng cặp → skip TRƯỚC** (0
  assign) · audit `RolePermissionRuleApplied` đúng 1 lần khi !dryRun, 0 lần khi dryRun.
- Int-spec (LANE_DB): áp rule read-only 2 resourceType lên role tenant → role_permissions đúng grant
  + audit; employee 403; dryRun 0 row DB.
- **[PLAN-FIX MED-3] Int-spec 2-tenant (red-zone regression, CLAUDE.md §6):** trồng role của tenant A →
  admin tenant B gọi apply-rule (CẢ dryRun LẪN apply) trên roleId của A → **404** + xác minh **0 write, 0
  audit, KHÔNG leak** grants của A (đọc chéo phải rỗng).

## Rủi ro & chốt
- **KHÔNG migration** (luật transient — chỉ ghi vào `role_permissions` cũ) · **KHÔNG mutation surface
  mới** (đi qua `assignPermissionToRole`).
- Bung hàng loạt = rủi ro leo thang → **3 chốt**: loại sensitive mặc định · chặn (sensitive & mọi-
  resource) · **preview bắt buộc** (client luôn dryRun trước; apply là call riêng).
- MVP **chỉ ALLOW** + scope ≤ Company. DENY, **lưu luật đặt tên (bảng DB)**, gom nhóm theo **module**
  → phase sau.
- Grants của SYSTEM role admin đọc được (RLS) nhưng **áp rule lên system role bị chặn** (400) — mirror
  update/delete role.
- Preset action cố định trong code — nếu catalog thêm action mới, preset không tự phủ (đúng chủ đích:
  preset là tập an toàn được kiểm soát; muốn quyền khác → dùng preset 'custom').
