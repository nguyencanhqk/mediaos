# S2-AUTH-ROLEMEM-1 — Tab Thành viên trên RoleDetailPage

> Owner-request 2026-07-07 (chat): "khi ấn vào một vai trò cụ thể thì có thêm một tab có thể xem
> danh sách các tài khoản có quyền đó và có thể thêm tài khoản nhanh vào vai trò đó (theo người
> hoặc thêm nhanh theo phòng ban, team của công ty)".
> Zone: **red** (permission surface) → FULL gate security-reviewer bắt buộc.

## Hiện trạng (khảo sát 2026-07-07)

- Mutation per-user ĐÃ CÓ ĐỦ, không đụng: `POST /permissions/users/:userId/roles` +
  `DELETE /permissions/users/:userId/roles/:roleId` (permission-admin.controller, gate
  `assign-role:user` isSensitive, SoD chống tự-gán, audit `RoleAssigned/RoleRevoked` +
  `user_security_events` dual-write in-tx, user_roles soft-delete mig 0471, idempotent).
- FE cờ hiển thị `assign-role:user` đã mở qua allowlist (S2-AUTH-CAP-2, PR #117).
- `GET /hr/employees?orgUnitId=` trả list nhân viên kèm `userId` (nullable) → nguồn cho
  "thêm nhanh theo phòng ban". Org tree: `GET /org/units/tree`.
- **Thiếu duy nhất**: endpoint đọc "user nào đang giữ role này".

## Thiết kế

### BE — CHỈ 1 endpoint đọc mới (không mở mutation surface)

`GET /auth/roles/:id/members` (role-admin.controller, @Controller("auth/roles") sẵn có)

- Gate: `@RequirePermission("view", "user")` — response là dữ liệu user (email/tên/trạng thái);
  view:user (non-sensitive) là cặp đúng, admin + hr có grant. KHÔNG dùng view:role (không đủ
  che dữ liệu user), KHÔNG assign-role (đọc-only không cần sensitive).
- Query: user_roles ⋈ users, lọc `role_id = :id` AND `user_roles.company_id = actor.companyId`
  (tường minh — system role company_id NULL dùng CHUNG cross-tenant, membership thì PER-tenant)
  AND `user_roles.deleted_at IS NULL` AND (`expires_at IS NULL OR expires_at > now()`)
  AND `users.deleted_at IS NULL`. Chạy trong `withTenant` (RLS lớp 2).
- Role không tồn tại (không phải system + không phải role tenant này) → 404 (mirror
  `findAssignableRole` của assignRole).
- Response: `{ members: [{ userId, email, fullName, status, expiresAt, grantedAt }] }` —
  KHÔNG lộ PII HR (lương/CCCD…), chỉ trường account-level đã lộ sẵn ở GET /auth/users.

### Contracts + web-core

- `packages/contracts/src/auth/role-permission-list.ts` (hoặc file mới `role-members.ts`):
  `roleMemberSchema` + `roleMemberListSchema` + types, export qua contracts index.
- `web-core roleAdminApi.getMembers(roleId)` + query-key `authKeys.roles.members(roleId)`.

### FE — RoleDetailPage tab switcher (Thông tin | Thành viên)

- Không có Tabs primitive trong packages/ui → tab switcher cục bộ (2 Button + state), KHÔNG
  thêm dependency.
- Tab Thành viên:
  - Bảng: email · họ tên · trạng thái · hết hạn · nút Gỡ. Gỡ = `DELETE /permissions/users/:id/roles/:roleId`
    (confirm dialog). Nút Gỡ + 2 nút Thêm bọc `PermissionGate assign-role:user`.
  - Dialog "Thêm người": search `authUsersApi.listUsers({search})`, multi-select, loại user đã
    là member; submit gọi TUẦN TỰ `POST /permissions/users/:id/roles` từng người (tái dùng
    audit/SoD per-user); hiển thị kết quả từng dòng (ok/lỗi), refetch members.
  - Dialog "Thêm theo phòng ban": chọn org unit từ `orgApi.getTree()` (flatten select), fetch
    `hrApi.listEmployees({orgUnitId, limit lớn})` → phân loại: có `userId` & chưa member → gán;
    đã member → bỏ qua; `userId` null (chưa link tài khoản) → liệt kê không-gán-được. Preview
    số lượng trước khi bấm gán. Submit tuần tự như trên.
  - SoD phía server sẽ 403 nếu admin tự gán mình → hiển thị lỗi dòng đó, không chặn cả batch.
- i18n: `apps/app/src/i18n/locales/vi/system.ts` thêm khối `roleMembers.*`.

### Test

- **BE int-spec RED-trước** (`apps/api/test/integration/role-members.int-spec.ts`, gate
  `hasDb && LANE_DB`):
  - N1 employee (0008, không view:user) → 403.
  - N2 cross-tenant: 2 tenant cùng SYSTEM role 0001; member tenant A KHÔNG lộ khi admin tenant B gọi.
  - N3 role UUID lạ → 404.
  - N4 soft-deleted user_roles (revoke xong) + expired (expires_at quá khứ) → KHÔNG xuất hiện.
  - P1 admin sau assign 2 user → thấy đúng 2 member với field đúng.
- **FE spec**: tab render, bảng member từ mock API, PermissionGate ẩn nút khi thiếu
  assign-role:user, dialog thêm-người submit gọi đúng endpoint.

## Rủi ro & chốt

- KHÔNG thêm bulk-mutation endpoint → không mở rộng attack-surface gán role; trade-off: N request
  tuần tự cho phòng ban lớn (chấp nhận ở N=1 company, ~200ms/req tunnel).
- System role membership là per-tenant qua user_roles.company_id — lọc tường minh + RLS.
- Members chỉ lộ account-level fields; PII HR không đi qua endpoint này.
