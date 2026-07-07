# S2-AUTH-USEROPS-1 — Quản lý người dùng nâng cao (/system/users)

> Owner-request 2026-07-07 (chat + screenshot cian-dev /system/users): (1) thao tác hàng loạt,
> (2) chuyển trạng thái tài khoản, (3) reset mật khẩu, (4) xóa tài khoản có thể khôi phục.
> Zone: 🔴 RED (auth + permission seed + migration) → FULL gate, PR không auto-merge.

## 0. Hiện trạng (khảo sát 2026-07-07)

- Surface CANONICAL `/auth/users` (S2-AUTH-BE-3/9/12): list/get/create/update/**lock/unlock**/reset-2fa.
  Đã có: self-guard, revoke-all-sessions trong cùng tx, audit + security-event dual-write, data-scope.
- Màn hình screenshot = `apps/app/src/routes/system/UsersPage.tsx` (list view-only + create + chevron
  → detail). Lock/unlock CHỈ ở UserDetailPage. KHÔNG có: bulk, reset mật khẩu, xóa/khôi phục.
- Surface legacy ACCT-2 `/users/admin` (suspend/reactivate/soft-delete, cặp manage/suspend/delete-user)
  chỉ console dùng — **KHÔNG đụng** (tránh vỡ console), làm trên cặp canonical.
- `users`: có sẵn `deleted_at/deleted_by` + `must_change_password` (mig 0469, flow ép đổi mật khẩu đã
  chạy end-to-end) + login/forgot đã lọc `deleted_at IS NULL` (auth.service `findActiveUserByEmail`).
- Mail reset (`ResetPasswordMailService`) là mock no-op khi thiếu `RESET_PASSWORD_URL` ⇒ admin-reset
  qua email KHÔNG tin cậy được ở môi trường này → chọn phương án **temp password + must_change_password**.
- Catalog user hiện có: view/create/update/lock/unlock (is_sensitive=false) + reset-2fa (true).
  CHƯA có: delete/restore/reset-password (canonical).

## 1. Thiết kế

### Migration 0476 (idx 156, when 1717500775000) — mirror mig 0466
> **REVISED sau plan-review 2026-07-07 (verdict BLOCK → đã vá):** `delete:user` ĐÃ tồn tại từ mig 0005
> (is_sensitive=false) + ĐÃ grant company-admin (0005 bulk + 0441 backfill Company) — INSERT-only sẽ
> no-op ngầm. Chốt phương án B: **NÂNG** `delete:user` false→true (đồng bộ sensitive cả bộ ba,
> anti-escalation; đã grep — không controller/FE nào enforce/hiển thị theo pair này trước WO).
- INSERT catalog pair MỚI: `('restore','user',true)`, `('reset-password','user',true)` ON CONFLICT DO NOTHING.
- `UPDATE permissions SET is_sensitive=true WHERE ('delete','user') AND is_sensitive=false` (idempotent —
  SIẾT chứ không nới: wildcard mất hiệu lực, grant EXACT giữ nguyên).
- Grant company-admin (resolve theo name+company_id IS NULL+is_system, KHÔNG hard-code id) × ALLOW ×
  Company cho cả 3, ON CONFLICT (role_id,permission_id,effect) DO NOTHING (delete → no-op vì 0005/0441).
  Fail-LOUD verify cuối file (khẳng định trạng thái CUỐI, không phân biệt nguồn grant).
- Không đụng RLS/FORCE/policy `users`, không backfill dữ liệu.

### SENSITIVE_CAPABILITY_ALLOWLIST (permission.service.ts) — BẮT BUỘC (plan-review BLOCKING #1)
- APPEND `delete:user` + `restore:user` + `reset-password:user`. Thiếu ⇒ getCapabilities lọc mất cặp
  sensitive → useCanExact false với CẢ company-admin → tab Đã xóa/nút Reset/Xóa ẨN (bài học CAP-2).
- Regression int-spec (auth-me-capabilities.int.spec.ts, khối USEROPS): admin thấy đủ 3 cặp; employee
  không; wildcard `*:*` KHÔNG kế thừa (kể cả delete:user sau sensitive-hóa).

### Backend `/auth/users` (AuthUsersController/Service/Repository — additive)
- `DELETE /auth/users/:id` — gate `delete:user` isSensitive. Soft-delete: `deleted_at=now, deleted_by=actor`,
  **GIỮ NGUYÊN status** (khôi phục trả về đúng trạng thái trước xóa; login đã bị chặn bởi deleted_at).
  Self-guard 400. Revoke MỌI phiên (`revokeAllForUserTx`, reason `deleted`) cùng tx. Audit `user.deleted`
  (count phiên vào after). Security event `USER_DELETED` (severity high).
- `POST /auth/users/:id/restore` — gate `restore:user` isSensitive. Đòi row ĐANG deleted (lookup riêng
  `findDeletedByIdTx`); clear `deleted_at/deleted_by`. Audit `user.restored` + event `USER_RESTORED` (medium).
  Không self-guard (user đã xóa không thể là actor). Email đụng unique (company_id, normalized_email khi
  chưa xóa): nếu đã có user LIVE trùng email → 409 (check emailExists trước khi restore).
- `POST /auth/users/:id/password/reset` — gate `reset-password:user` isSensitive. Self-guard 400 (tự đổi
  → dùng change-password). Server sinh temp password 16 ký tự CHẮC CHẮN đạt policy (hoa+thường+số, crypto
  random), hash argon2, set `must_change_password=true` cùng UPDATE, revoke MỌI phiên (reason
  `admin_password_reset`) cùng tx. Audit `user.password_reset_by_admin` — TUYỆT ĐỐI không chứa temp
  password/hash (chỉ revokedSessionCount). Event `PASSWORD_RESET_BY_ADMIN` (high). Response trả
  `{tempPassword, revokedSessionCount}` — hiển thị đúng 1 lần, KHÔNG log (BẤT BIẾN #3).
- `GET /auth/users?deleted=true` — repo `findManyTx` nhận cờ `deleted` → `isNotNull(deleted_at)`
  (mặc định giữ `isNull` như cũ). DTO `authUserSchema` thêm `deletedAt` nullable.

### Contracts
- `AUTH_USER` += DELETE/RESTORE/RESET_PASSWORD; `authUserSchema` += `deletedAt`; query += `deleted`
  (enum "true"/"false" → boolean, KHÔNG z.coerce.boolean vì "false"→true); schema kết quả reset password.
- `SECURITY_EVENT_TYPES` += USER_DELETED/USER_RESTORED/PASSWORD_RESET_BY_ADMIN + severity map (exhaustive
  Record ⇒ thiếu là typecheck đỏ).

### web-core
- `authUsersApi` += `deleteUser/restoreUser/resetPassword`, `listUsers` nhận `deleted`. Spec mở rộng.

### FE apps/app `/system/users`
- `SYSTEM_ENGINE_PAIRS` += DELETE_USER/RESTORE_USER/RESET_PASSWORD_USER (SENSITIVE → `useCanExact`,
  mirror RESET_2FA_USER; wildcard `*:*` không mở cổng).
- UsersPage: cột checkbox (chọn trang hiện tại), thanh bulk khi ≥1 chọn: Khóa / Mở khóa / Xóa (và
  Khôi phục ở tab Đã xóa) — chạy TUẦN TỰ per-item qua endpoint đơn sẵn có (mỗi item tự audit; partial
  failure rõ ràng), kết quả tổng hợp thành công/lỗi từng email; self-row tự loại khỏi bulk (server vẫn
  là chốt chặn). ConfirmDialog trước khi chạy.
- Menu thao tác từng dòng: Chi tiết · Khóa/Mở khóa (useCan lock/unlock) · Đặt lại mật khẩu (useCanExact)
  · Xóa (useCanExact). Dòng self: disable Khóa/Xóa/Reset.
- Tab "Đang dùng | Đã xóa": tab Đã xóa chỉ hiện khi `useCanExact("restore","user")`; bảng deleted có
  cột deletedAt + nút Khôi phục.
- Dialog kết quả reset mật khẩu: hiển thị temp password 1 lần + nút copy + cảnh báo "bắt buộc đổi khi
  đăng nhập"; đóng là mất (không cache/query).
- i18n `vi/system.ts` đủ key. KHÔNG đụng UserDetailPage ngoài phạm vi (giữ WO gọn) — hành động mới nằm
  ở list; detail đã có lock/unlock.
- Bulk reset mật khẩu KHÔNG làm (trả N mật khẩu tạm một lượt = rủi ro lộ; ngoài scope, ghi chú cho owner).

## 2. Test (RED trước)
- Unit `auth-users.service.spec.ts` mở rộng: self-delete/self-reset → 400 + 0 audit/0 revoke;
  not-found/cross-tenant → 404 + 0 audit; delete: revoke đúng 1 lần + audit count + GIỮ status;
  restore: đòi row deleted, email-live trùng → 409; reset: hash được gọi với temp password đạt policy
  (≥12, hoa+thường+số), must_change_password=true, audit KHÔNG chứa temp password, response có tempPassword.
- web-core `auth-users-api.spec.ts`: 3 method mới + query deleted.
- FE spec: gating (không quyền → không nút), bulk chọn + chạy tuần tự + summary, tab Đã xóa + restore.

## 3. Rủi ro & chốt chặn
- **Pair drift** (bài học s1-fnd): FE dùng đúng cặp seed 0476; BE decorator khai isSensitive khớp catalog.
- **Restore vs unique email**: check emailExists(live) trước restore → 409 thay vì vỡ constraint 500.
- **Audit/log không secret**: temp password chỉ ở RAM + response; masker phòng thủ nhưng KHÔNG dựa vào.
- **Session revoke**: delete/reset đều revoke cùng tx (mirror lock) — access token stateless còn sống tối đa
  ~15' (giới hạn đã chấp nhận ở S2-AUTH-BE-9, không mở rộng ở đây).
- **Console legacy không đổi**: /users/admin + trang console cũ giữ nguyên hành vi.

## 4. Quyết định sau plan-review (2026-07-07, verdict BLOCK → REVISED, các finding đã xử lý)

1. **BLOCKING #1 (allowlist)** → ĐÃ VÁ: APPEND 3 cặp vào SENSITIVE_CAPABILITY_ALLOWLIST + int-spec USEROPS.
2. **BLOCKING #2 (delete:user no-op)** → ĐÃ VÁ: chọn phương án B (UPDATE sensitive-hóa + allowlist), mig
   0476 viết lại, comment nêu rõ nguồn grant 0005/0441.
3. **Temp password không hết hạn / login chưa ép đổi ở BE** → CHẤP NHẬN có chủ đích (nhất quán flow
   bootstrap super-admin mig 0469; FE đã có must-change flow qua /auth/me). Follow-up đề xuất: ép đổi
   tại BE login. Temp password giao out-of-band, hiện đúng 1 lần.
4. **Restore race unique** → ĐÃ VÁ: catch 23505 (db-error.ts walk cause-chain) → 409 + unit test.
5. **GET ?deleted=true gate view:user (không đòi restore:user)** → CHẤP NHẬN: danh sách deleted không lộ
   thêm field nào so với live (cùng DTO, cùng data-scope bound); FE ẩn tab theo restore:user chỉ là UX.
6. **Response logger**: main.ts chỉ có ResponseEnvelopeInterceptor (wrap, không log) — tempPassword không
   lọt log ở tầng global.
