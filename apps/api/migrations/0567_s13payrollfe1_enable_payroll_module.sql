-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0567 — S13-PAYROLL-FE-1: BẬT module PAYROLL (modules.PAYROLL.is_active = false → true)
--
-- BÀN GIAO TỪ 0564/0565/0566 (S13-PAYROLL-DB-1) + 35/35 route đã lên dây ở BE-1/BE-2. Cùng đường
-- 0556 (ASSET) / 0557 (ROOM) / 0562 (RECRUIT) / 0538 (CHAT).
--
-- ⚠️ CỜ NÀY CƯỠNG CHẾ ĐƯỢC CÁI GÌ (đo lại 01/09/2026, không đổi so với 0562): KHÔNG chặn request
-- backend nào (không có ModuleActiveGuard — memory `module-is-active-is-not-a-gate`); CÓ tác dụng đúng
-- một chỗ: `module-catalog.repository.ts` lọc `WHERE is_active = true` cho catalog getMyApps/admin. Đây
-- là ghi-sổ "module đã launch" theo DB-10 §10.2, KHÔNG phải công tắc chức năng — quyền thật nằm ở
-- PermissionGuard + tầng 2 PayrollAccessService + sàn scope Company + RLS.
--
-- ⚠️ KHÔNG cần nới guard nào của band 0564–0566: chúng chỉ RAISE khi hàng/cặp KHÔNG tồn tại và CỐ Ý
-- không assert `is_active` (bài học `module-enable-guard-blocks-next-wo` đã áp từ lúc viết 0564; xem
-- cả `noti-check-baseline-guard-must-be-forward-compatible`).
--
-- Hàng `modules.PAYROLL` ĐÃ TỒN TẠI từ 0435 (`Extension`, is_active=false) ⇒ đây là **UPDATE**, KHÔNG
-- INSERT (`INSERT … ON CONFLICT DO NOTHING` là NO-OP im lặng — memory
-- `phase-modules-preseeded-inactive-in-0435`).
--
-- ĐI CÙNG COMMIT — HAI việc, thiếu một là đỏ:
--   (1) file này;
--   (2) chuyển 'PAYROLL' từ `EXTENSION_INACTIVE_MODULES` sang `EXTENSION_ACTIVE_MODULES` trong
--       `apps/api/test/integration/migration-smoke.int-spec.ts`. CHUYỂN, không phải chỉ GỠ: danh sách
--       ACTIVE assert DƯƠNG TÍNH `is_active = true`, còn "gỡ khỏi inactive" chỉ là phủ định và để lọt
--       ca migration quên chạy (chính lỗ mà describe "2a-ext" sinh ra để bịt).
--
-- BAND 0567 (lane S13-PAYROLL-FE-1). Journal: idx 234, when 1717587356000 (> 0566 idx 233 / …355000).
--   Thiếu dòng journal ⇒ migration bị BỎ QUA TRONG IM LẶNG (memory
--   `migration-not-in-journal-is-silently-skipped`) — đã thêm cùng file này.
--
-- KHÔNG đụng: catalog quyền (0565 đã seed 17 cặp + 32 grant + role payroll-officer), audit CHECK,
-- NOTI catalog (0566), DDL payroll (0564).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Bật module PAYROLL; fail-loud nếu hàng không tồn tại ─────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- Đếm TRƯỚC khi update: `GET DIAGNOSTICS ROW_COUNT` sau UPDATE trả 0 cho CẢ HAI ca "không có hàng"
  -- và "hàng đã đúng giá trị rồi" (migration chạy lại) — không phân biệt được lỗi thật với no-op.
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'PAYROLL' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0567] modules.PAYROLL khong ton tai dung 1 hang (ky vong 1 tu mig 0435, dem duoc %)', v_n;
  END IF;

  UPDATE modules
     SET is_active = true,
         updated_at = now()
   WHERE module_code = 'PAYROLL'
     AND deleted_at IS NULL
     AND is_active = false;

  RAISE NOTICE '[0567] modules.PAYROLL.is_active = true (ban giao tu 0564-0566, tien le 0556/0557/0562)';
END $$;
--> statement-breakpoint

-- ─────────────── (2) Hậu kiểm: module PHẢI active sau migration này ───────────────────────────────
DO $$
DECLARE
  v_active boolean;
BEGIN
  SELECT is_active INTO v_active FROM modules WHERE module_code = 'PAYROLL' AND deleted_at IS NULL;
  IF v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0567] modules.PAYROLL van chua active sau UPDATE (is_active = %)', v_active;
  END IF;
END $$;
