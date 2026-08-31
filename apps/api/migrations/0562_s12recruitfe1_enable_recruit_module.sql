-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0562 — S12-RECRUIT-FE-1: BẬT module RECRUIT (modules.RECRUIT.is_active = false → true)
--
-- BÀN GIAO TỪ 0559/0560 (S12-RECRUIT-DB-1). Guard (e) của 0560 CỐ Ý forward-compatible: chỉ RAISE khi
-- hàng KHÔNG tồn tại, KHÔNG assert is_active — nên file này KHÔNG cần nới guard nào (khác 0557 phải vá
-- 0554; bài học module-enable-guard-blocks-next-wo đã áp từ lúc viết 0560). Cùng đường 0556 (ASSET) /
-- 0557 (ROOM) / 0538 (CHAT).
--
-- ⚠️ CỜ NÀY CƯỠNG CHẾ ĐƯỢC CÁI GÌ (đo 30/08/2026 ở 0557 — không đổi): KHÔNG chặn request backend nào
-- (không có ModuleActiveGuard — memory `module-is-active-is-not-a-gate`); CÓ tác dụng đúng một chỗ:
-- `module-catalog.repository.ts` lọc `WHERE is_active = true` cho catalog getMyApps/admin. Đây là
-- ghi-sổ "module đã launch" theo DB-10 §10.2, KHÔNG phải công tắc chức năng — quyền thật nằm ở
-- PermissionGuard + tầng 2 RecruitAccessService + RLS.
--
-- Hàng `modules.RECRUIT` ĐÃ TỒN TẠI từ 0435 (`Extension`, is_active=false, sort_order 9) ⇒ đây là
-- **UPDATE**, KHÔNG INSERT (`INSERT … ON CONFLICT DO NOTHING` là NO-OP im lặng — memory
-- `phase-modules-preseeded-inactive-in-0435`).
--
-- ĐI CÙNG COMMIT — HAI việc, thiếu một là đỏ:
--   (1) file này;
--   (2) gỡ `'RECRUIT'` khỏi `EXTENSION_INACTIVE_MODULES` trong
--       `apps/api/test/integration/migration-smoke.int-spec.ts` — pin đó khẳng định RECRUIT phải
--       inactive sau seed.
--
-- BAND 0562 (lane S12-RECRUIT-FE-1). Journal: idx 229, when 1717587351000 (> 0561 idx 228 / …350000).
--   Thiếu dòng journal ⇒ migration bị BỎ QUA TRONG IM LẶNG (memory
--   `migration-not-in-journal-is-silently-skipped`) — đã thêm cùng file này.
--
-- KHÔNG đụng: catalog quyền (0560 đã seed 22 cặp + 42 grant + role recruiter), audit CHECK,
-- NOTI catalog (0561).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Bật module RECRUIT; fail-loud nếu hàng không tồn tại ─────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- Đếm TRƯỚC khi update: `GET DIAGNOSTICS ROW_COUNT` sau UPDATE trả 0 cho CẢ HAI ca "không có hàng"
  -- và "hàng đã đúng giá trị rồi" (migration chạy lại) — không phân biệt được lỗi thật với no-op.
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'RECRUIT' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0562] modules.RECRUIT khong ton tai dung 1 hang (ky vong 1 tu mig 0435, dem duoc %)', v_n;
  END IF;

  UPDATE modules
     SET is_active = true,
         updated_at = now()
   WHERE module_code = 'RECRUIT'
     AND deleted_at IS NULL
     AND is_active = false;

  RAISE NOTICE '[0562] modules.RECRUIT.is_active = true (ban giao tu 0559/0560, tien le 0556/0557)';
END $$;
--> statement-breakpoint

-- ─────────────── (2) Hậu kiểm: module PHẢI active sau migration này ───────────────────────────────
DO $$
DECLARE
  v_active boolean;
BEGIN
  SELECT is_active INTO v_active FROM modules WHERE module_code = 'RECRUIT' AND deleted_at IS NULL;
  IF v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0562] modules.RECRUIT van chua active sau UPDATE (is_active = %)', v_active;
  END IF;
END $$;
