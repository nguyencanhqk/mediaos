-- Migration 0180: B1 — seed permission 'view-own-payslip' (employee self-service) + grant role employee.
--
-- BAND 0180-0189 (lane B1). idx 85 (master max 84 + 1, KHÔNG suy từ số file), when 1717500210000
--   (>1717500200000 của 0150 — đơn điệu tăng). Chạy SAU mọi migration master theo `when`.
-- HOT-FILE (TASKS §5.3): permission seed = INSERT … ON CONFLICT DO NOTHING — idempotent, cộng dồn,
--   KHÔNG sửa/drop hàng có sẵn. KHÔNG đụng 'view-payslip' (deny-path admin/HR GIỮ NGUYÊN).
-- AUDIT CHECK KHÔNG đụng: own-payslip là READ-ONLY → KHÔNG sinh object_type mới ('payslip' đã có trong
--   audit superset). Vì vậy KHÔNG có DO-block audit-CHECK ở migration này.
--
-- Permission (BẤT BIẾN #3 / ADR-0010 — nhân viên xem phiếu CỦA MÌNH):
--   - view-own-payslip: NHẠY CẢM (lương = dữ liệu nhạy cảm; xem chi tiết cần re-auth) → is_sensitive=TRUE
--     ⇒ KHÔNG kế thừa wildcard *:* (đúng tập người được xem). Action MỚI RIÊNG, không trùng 'view-payslip'.
--   - Ownership ('payslip của chính mình') ép Ở SERVICE (listOwn lọc user_id=self; getOwn kiểm row.userId===self).
--     objectGrantRequired:false (G12-4 TRAP) set tường minh ở getOwn — employee company-grant qua được.

-- ── Seed permission catalog (tiền lệ 0132, ON CONFLICT DO NOTHING). ──
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view-own-payslip', 'payslip', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ── Grant employee (…0008): xem phiếu lương CỦA MÌNH. Ownership ép ở service, KHÔNG nới view-payslip. ──
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000008', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'payslip' AND p.action = 'view-own-payslip'
ON CONFLICT DO NOTHING;
