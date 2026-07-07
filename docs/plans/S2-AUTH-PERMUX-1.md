# S2-AUTH-PERMUX-1 — Tối ưu gán quyền (đủ bộ #1→#4)

> Owner-request 2026-07-07, chọn "Đủ bộ": (1) BE đọc quyền-đã-gán · (2) RolePermissionsPage v2 ·
> (3) Nhân bản vai trò · (4) Nhãn tiếng Việt. Zone **red** → FULL gate.

## Hiện trạng

- RolePermissionsPage hiện MÙ trạng thái (banner: BE chưa có API list-by-role) — chỉ render catalog
  toàn hệ thống + nút Gán/Thu hồi chay.
- Mutation server ĐÃ ĐỦ, không đụng: `POST /auth/roles/:id/permissions` (idempotent cùng scope,
  đổi scope = DELETE+INSERT, scope-ceiling chặn System, ANTI-ESCALATION assign:permission
  isSensitive) + `DELETE .../permissions`.
- Catalog đọc qua `GET /auth/permissions` (view:permission).

## Thiết kế

### #1 BE — GET /auth/roles/:id/permissions (read-only duy nhất thêm mới)

- Gate `@RequirePermission("view","permission")` — cùng cặp với catalog (topology quyền =
  admin-only theo seed).
- Repo `listRolePermissionsTx(tx, roleId)`: role_permissions ⋈ permissions theo role_id →
  `{action, resourceType, effect, dataScope, isSensitive}`. Tenant-isolation qua findRoleByIdTx
  404-guard (mirror listMembers: RLS roles + notOperatorRole) + RLS role_permissions (policy join
  roles own-tenant-or-NULL). KHÔNG cần company filter tường minh trên role_permissions (bảng không
  có company_id — cách ly bằng role-guard 404 TRƯỚC + RLS).
- Contracts `rolePermissionGrantsSchema {grants:[...]}`.
- Int-spec (LANE_DB): P1 exact grants (seed ALLOW qua API + 1 row DENY seed thẳng → cả hai trả về
  đúng effect) · N1 employee 403 · N2b role company tenant khác 404 · N3 UUID lạ 404 · N5
  operator-role f0 404.

### #2 FE — RolePermissionsPage v2

- 2 query: catalog (có sẵn) + grants mới → map `action:resourceType → {effect,dataScope}`.
- Nhóm theo `resourceType` (collapsible, đếm đã-gán/tổng); search filter giữ nguyên.
- Mỗi dòng: trạng thái (badge Đã gán + scope | chưa) · dropdown scope (đổi = gọi assign với scope
  mới — server tự DELETE+INSERT) · nút Gán/Thu hồi theo trạng thái. Row DENY → badge DENY (không
  sửa từ UI này — hiếm, chỉ hiển thị).
- Bulk: checkbox per-row + per-group; thanh bulk chọn scope → "Gán N quyền" tuần tự (skip dòng đã
  gán cùng scope), kết quả từng dòng.
- BỎ banner mù-trạng-thái.

### #3 Nhân bản vai trò

- Nút "Nhân bản" trên RoleDetailPage (PermissionGate create:role — nút chỉ chạy được trọn khi có
  assign:permission; server là cổng cuối từng bước).
- Dialog: nhập tên (+mô tả mặc định "Sao chép từ <tên nguồn>") → `createRole` → đọc grants nguồn
  (#1) → gán TUẦN TỰ các grant ALLOW scope ≤ Company (System-scope bị ceiling — liệt kê bỏ qua;
  DENY không copy — liệt kê bỏ qua) → kết quả từng dòng + nút "Mở vai trò mới".

### #4 Nhãn tiếng Việt

- `apps/app/src/routes/system/roles/permission-labels.ts`: map action + resource cho module MVP
  (AUTH/HR/ATT/LEAVE/FOUNDATION/TASK/NOTI/DASH pairs thường gặp); helper `labelAction/labelResource`
  fallback mã thô. Dùng ở RolePermissionsPage (v2) — mã thô vẫn hiện kèm (title/tooltip) để không
  mất trace với seed.

## Rủi ro & chốt

- KHÔNG mutation surface mới; mọi ghi đi qua endpoint cũ đã audit + anti-escalation.
- Grants của SYSTEM role hiển thị được cho admin tenant (RLS cho đọc role system) — đúng chủ đích
  (cấu hình chung), mutation lên system role vẫn bị chặn ở service (companyId !== actor → 404,
  system role check).
- Clone role: copy grant thất bại giữa chừng → role mới tồn tại với subset grants; dialog báo rõ
  từng dòng lỗi — chấp nhận (admin thấy và bấm gán bổ sung), KHÔNG rollback phức tạp.
