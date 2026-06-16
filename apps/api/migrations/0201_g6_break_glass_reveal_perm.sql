-- Migration 0201: G6-2 PR-B ROUND 2 (🔴 CROWN-JEWEL) — seed `reveal-break-glass` sensitive permission.
--
-- BAND 0201 (lane bg2 — break-glass reveal). idx 95, when 1717500300000 (> max applied 1717500290000 = 0200).
--   Branch `feat/g6-breakglass-reveal` KHÔNG khớp regex g(\d+) → guard-migration-band fail-open (giống 0200).
--
-- MỤC TIÊU (ROUND 2): cổng (a) cho reveal-via-break-glass. Reveal 1 platform_account secret CHỈ KHI caller
--   (a) có quyền sensitive `reveal-break-glass` company-tier VÀ (b) có grant 'active' còn hạn của chính mình
--   trên đúng account (cổng (b) đọc break_glass_grants WHERE status='active' AND expires_at > now()). Cổng (b)
--   KHÔNG cần seed (đọc bảng sẵn có mig 0200). Đây CHỈ seed quyền (a).
--
-- KHÔNG bảng/cột mới · KHÔNG đổi audit CHECK: reveal-path audit tái dùng object_type 'break_glass_access'
--   (đã vào CHECK ở 0200 + AUDIT_OBJECT_TYPES) với action mới 'break_glass_access.secret_revealed' /
--   '.secret_reveal_failed' / '.reveal_denied' — audit_logs.action KHÔNG có CHECK nên action string tự do.
--
-- + 1 index forward: listGrantsForRequester (màn "grant của tôi") lọc (company_id, requester_user_id). Index
--   active partial của 0200 KHÔNG phủ (status='active' + requester ở cột 3). Thêm index phủ hot-path UI poll.
--
-- ADR-0010 anti-escalation (mirror 0027/0200): hành động break-glass nhạy cảm KHÔNG gán cho bất kỳ system
--   role nào mặc định. Mỗi tenant tự cấp tường minh cho role được uỷ quyền (vd security-officer). Wildcard
--   *:* KHÔNG thoả gate nhạy cảm (permission.service: chỉ exact non-wildcard ALLOW). ON CONFLICT DO NOTHING
--   (idempotent, hot-file permissions).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('reveal-break-glass', 'break-glass', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Index phủ listGrantsForRequester (company_id, requester_user_id). IF NOT EXISTS → idempotent/re-run an toàn.
CREATE INDEX IF NOT EXISTS break_glass_grants_requester_idx
  ON break_glass_grants(company_id, requester_user_id);
