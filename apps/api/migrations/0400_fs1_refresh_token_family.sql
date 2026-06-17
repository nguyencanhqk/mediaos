-- Migration 0400: FS-1a (🔴 CROWN-JEWEL auth) — refresh-token FAMILY cho rotation + reuse-detection (SSO cookie).
--
-- BAND 0400-0409 (lane feauth-api — nền phiên SSO cookie-subdomain). idx 101, when 1717500360000
--   (re-stamp khi land: master tiến ac4/ac6 sau fork → > max applied 1717500350000 = 0320_ac6_webhooks).
--   Branch `feat/fe-split-feauth-api` KHÔNG khớp
--   regex g(\d+)/ac(\d+) → guard-migration-band fail-open (giống b1/b4/b5). Band cấp riêng (admin ở 0300s).
--
-- MỤC TIÊU (plan §7.4, frontend-split-plan): refresh token XOAY mỗi lần (rotation) + phát hiện DÙNG LẠI
--   (reuse-detection) → thu hồi cả HỌ token (family) buộc đăng nhập lại. Chống replay khi refresh cookie bị lộ.
--
-- THIẾT KẾ: thêm CỘT family_id vào refresh_tokens (KHÔNG bảng mới — tiền lệ rotation dùng replaced_by sẵn có).
--   • DEFAULT gen_random_uuid()  → mỗi token mặc định là 1 family ĐƠN LẺ (an toàn): hàng cũ + seed harness
--     KHÔNG cần backfill, KHÔNG cửa sổ rò chéo tenant (chỉ thêm cột, KHÔNG đụng company_id). RLS+FORCE đã bật
--     từ 0004 → cột mới nằm trong policy sẵn có (không cần policy mới).
--   • Login  → token mới để DEFAULT (family đơn lẻ MỚI).  Rotation → token mới KẾ THỪA family_id của token cũ.
--   • Reuse-detection → token đã revoke bị trình lại ⇒ UPDATE revoked_at MỌI token cùng family_id (thu hồi họ).
--   • Logout → thu hồi MỌI token cùng family_id (đăng xuất toàn cục).
--
-- BẤT BIẾN: không grant mới (GRANT SELECT/INSERT/UPDATE refresh_tokens cấp Ở 0004 phủ cột mới — column-grant
--   table-level). KHÔNG đổi audit object_type (hành động phiên dùng 'auth' đã có trong CHECK). KHÔNG secret
--   plaintext (#3): family_id là uuid ngẫu nhiên, KHÔNG phải token material.

ALTER TABLE refresh_tokens
  ADD COLUMN family_id uuid NOT NULL DEFAULT gen_random_uuid();
--> statement-breakpoint
-- Index PARTIAL cho đường nóng DUY NHẤT keyed-family: thu hồi cả họ (reuse/logout) luôn lọc
-- `revoked_at IS NULL`. company_id dẫn đầu (RLS-aligned, NULL-safe) — mirror refresh_tokens_user_idx (0004).
-- Partial (chỉ token CÒN SỐNG) → index nhỏ, không quét hàng đã revoke tích luỹ theo thời gian. Reuse-SELECT
-- đi qua unique index token_hash (không cần index này).
CREATE INDEX refresh_tokens_family_active_idx
  ON refresh_tokens (company_id, family_id)
  WHERE revoked_at IS NULL;
