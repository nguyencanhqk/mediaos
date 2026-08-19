# S10-QA-ROUTEHTTP-2 — 12 route risk≥5 còn nợ: test HTTP THẬT

> Kế thừa `S10-QA-ROUTEHTTP-1` (KI-025). Danh sách 12 route là SỐ ĐO của
> `test/foundation/route-http-coverage.e2e-spec.ts` (14/08/2026), không phải ước lượng.
> Zone: **đỏ** · gate **FULL** · nhóm 7–10 là **crown-jewel** (leo thang đặc quyền).

## 0. Kết luận recon (đo trên cây hiện tại, TRƯỚC khi viết test)

| # | Route | Controller | Cặp quyền | `isSensitive` | `requiresReauth` |
| --- | --- | --- | --- | --- | --- |
| 1 | `POST /users/invite` | UserInvitesController#invite | `invite:user` | ✅ | ❌ |
| 2 | `POST /api-keys` | ApiKeysController#create | `manage:api-key` | ✅ | ❌ |
| 3 | `POST /api-keys/:id/revoke` | ApiKeysController#revoke | `manage:api-key` | ✅ | ❌ |
| 4 | `POST /auth/users/:id/password/reset` | AuthUsersController#resetPassword | `reset-password:user` | ✅ | ❌ |
| 5 | `POST /auth/users/:id/restore` | AuthUsersController#restore | `restore:user` | ✅ | ❌ |
| 6 | `DELETE /auth/users/:id` | AuthUsersController#softDelete | `delete:user` | ✅ | ❌ |
| 7 | `POST /permissions/users/:userId/roles` | PermissionAdminController#assignRole | `assign-role:user` | ✅ | ❌ |
| 8 | `DELETE /permissions/users/:userId/roles/:roleId` | PermissionAdminController#revokeRole | `assign-role:user` | ✅ | ❌ |
| 9 | `PUT /permissions/object` | PermissionAdminController#setObjectPermission | `grant-object-permission:permission` | ✅ | ❌ |
| 10 | `DELETE /permissions/object` | PermissionAdminController#removeObjectPermission | `grant-object-permission:permission` | ✅ | ❌ |
| 11 | `DELETE /auth/roles/:id` | RoleAdminController#deleteRole | `delete:role` | ❌ | ❌ |
| 12 | `DELETE /auth/roles/:id/permissions` | RoleAdminController#revokePermission | `assign:permission` | ✅ | ❌ |

**Phát hiện quan trọng #1 — KHÔNG route nào trong 12 route dính bẫy KI-065.**
`permission.decide.ts:96` tính `needsObjectGrant = objectGrantRequired ?? (isSensitive && requiresReauth)`.
Cả 12 route đều **không** khai `requiresReauth` ⇒ `needsObjectGrant = false` ⇒ ALLOW đạt được bằng
company-level grant. Ca ALLOW 2xx THẬT là khả thi cho cả 12 — không có route chết thứ hai.
(Ngược lại: `PATCH /settings/security-policy` khai `requiresReauth: true` ⇒ chết vĩnh viễn = KI-065.)

**Phát hiện quan trọng #2 — cổng sensitive đòi grant CHÍNH XÁC.**
11/12 route khai `isSensitive: true` ⇒ `decideCan` lọc bỏ grant wildcard (`action='*'`/`resourceType='*'`).
Fixture PHẢI seed đúng cặp `(action, resourceType)` với `is_sensitive=true` trong catalog, KHÔNG
dùng `*:*`. Actor test KHÔNG được là super-admin (SA = tautology — `superadmin-not-a-canonical-role`).

## 1. Ranh giới (chống phình)

- CHỈ viết test + siết ratchet + cập nhật KI-025. **KHÔNG sửa code sản phẩm.**
- Đào ra bug thật (guard thiếu / envelope sai / DTO không chặn) ⇒ mở **KI riêng có mức + chủ** và
  ghim bằng test có docblock nói rõ "GHIM BUG", KHÔNG tự vá, KHÔNG nới assert (tiền lệ: KI-065).
- KHÔNG chạy full-suite (`pnpm --filter @mediaos/api test`) — từng ENOBUFS + vitest worker crash.
  Chạy SCOPED theo đúng file spec mới.

## 2. Chia file (3 spec, mỗi file < 800 dòng, chạy scoped độc lập)

| File (mới, `apps/api/test/integration/`) | Route | Ghi chú |
| --- | --- | --- |
| `permadmin-roles-http.int-spec.ts` | 7 · 8 · 9 · 10 · 11 · 12 | **crown-jewel** — thêm assert AUDIT LOG (append-only) trong cùng ca ALLOW |
| `authusers-admin-http.int-spec.ts` | 4 · 5 · 6 | vòng đời soft-delete → restore → reset password |
| `invite-apikeys-http.int-spec.ts` | 1 · 2 · 3 | api-key: dùng được → revoke → hết dùng được |

App test dựng ĐÚNG như `main.ts`: `ZodValidationPipe` → `ResponseEnvelopeInterceptor` →
`AllExceptionsFilter`. Thiếu pipe thì mọi ca "sai DTO → 400" xanh-giả.

## 3. Ma trận ca cho MỖI route (thứ tự bắt buộc: ALLOW trước, DENY sau)

1. **ALLOW 2xx THẬT** — chứng minh bằng **HỆ QUẢ quan sát được**, không chỉ status code:
   - 1: invite tạo → xuất hiện ở `GET /users/pending` (đường HTTP)
   - 2+3: key mới **dùng được** (gọi được route bằng API key) → sau revoke thì **hết dùng được**
   - 4: `tempPassword` trả về **đăng nhập được** + `mustChangePassword`
   - 5+6: `deleted_at` set ⇒ 404/không login được; restore ⇒ trở lại 200
   - 7+8: target **thực sự** gọi được route bị gate sau khi gán role, và **mất quyền** sau khi thu
   - 9+10: quyết định permission **đổi chiều** theo object-grant (Tier-3 thắng company-tier)
   - 11: role bị xoá mềm ⇒ thành viên mất quyền
   - 12: grant biến mất khỏi `GET /auth/roles/:id/permissions`
2. **DENY 403** — actor có role RỖNG (không grant nào) ⇒ đo đúng nhánh `deny-default`; **không dùng
   super-admin**. Với route sensitive: thêm ca actor chỉ có wildcard `*:*` ⇒ vẫn 403 `deny-sensitive`.
3. **DTO 400 ở BIÊN** (route có body: 1 · 7 · 9 · 10 · 12) — body sai kiểu ⇒ 400 TRƯỚC khi service chạy.
   Route có `:id` ⇒ thêm ca id không phải UUID ⇒ 400 (`ParseUUIDPipe`).
4. **CROSS-TENANT** (mọi route có `:id`/`:userId`) — actor công ty A thao tác id của công ty B ⇒
   404/403, **không rò tồn tại** (không khác thông điệp với id không tồn tại).
5. **AUDIT** (7–10, crown-jewel) — hàng `audit_logs` được ghi trong cùng tx của ca ALLOW.

## 4. Fixture & bẫy đã biết

- Helper dùng chung: `seedCompany · seedUser · seedRole · seedPermissionCatalog · seedRolePermission ·
  seedUserRole · cleanupTenants` (`test/helpers/seed`), mật khẩu qua `loginPasswordFixture` —
  **cấm literal high-entropy** (gitleaks `generic-api-key` ⇒ đỏ oan cả nhánh).
- **Rate-limit per-user**: mỗi ca dùng USER RIÊNG (email random). KHÔNG nới ngưỡng env
  (nới = spec đo một cấu hình không phải PROD).
- **Cache quyền**: sau assign/revoke role, quyết định phải đổi NGAY — nếu không, đó là bug cache
  invalidation ⇒ ghim + mở KI, không "chờ cho qua".
- **LANE_DB bắt buộc**: `bash scripts/lane-db-setup.sh routehttp2` → `export LANE_DB=mediaos_routehttp2`.
  Thiếu ⇒ `describe.skipIf` bỏ qua = xanh-giả.

## 5. Ratchet & sổ sách (điều kiện đóng)

- Chạy lại `route-http-coverage.e2e-spec.ts`: `uncovered risk≥5` từ **12 → ≤2**.
- **SIẾT** `MAX_UNCOVERED_HIGH_RISK` (12) xuống đúng số đo mới và **NÂNG** `MIN_COVERED_COUNT` (370)
  lên số phủ mới. Ratchet chỉ có giá trị khi được siết.
- KI-025 (RELEASE-02) cập nhật bằng SỐ ĐO MỚI; giữ nguyên cách phát biểu "% là CẬN TRÊN".

## 6. Thứ tự thi công

1. Lane DB + chạy coverage spec lấy số đo NỀN (trước khi thêm test).
2. `invite-apikeys-http.int-spec.ts` (3 route, ít phụ thuộc nhất) → chạy scoped, xanh.
3. `authusers-admin-http.int-spec.ts` (3 route) → chạy scoped, xanh.
4. `permadmin-roles-http.int-spec.ts` (6 route, crown-jewel + audit) → chạy scoped, xanh.
5. Chạy lại coverage spec → siết ratchet → cập nhật KI-025 → `harness/check.sh`.
