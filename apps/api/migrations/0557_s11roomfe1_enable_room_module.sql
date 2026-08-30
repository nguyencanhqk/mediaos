-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0557 — S11-ROOM-FE-1: BẬT module ROOM (modules.ROOM.is_active = false → true)
--
-- BÀN GIAO TỪ 0554 (S11-ROOM-DB-1). Migration đó CỐ Ý giữ `is_active=false` và ghi rõ lý do ở dòng
-- 9/38: "chua co endpoint — S11-ROOM-FE-1 moi bat". Cùng đường với 0556 (ASSET) và 0538 (CHAT).
--
-- ⚠️ CỜ NÀY CƯỠNG CHẾ ĐƯỢC CÁI GÌ — đo lại 30/08/2026, ĐỪNG dùng nó làm đệm an toàn:
--   · KHÔNG chặn request nào ở backend: `grep ModuleActiveGuard apps/api/src` = 0 file. Ai cầm token
--     + đủ cặp quyền là gọi được 13 route ROOM kể cả khi cờ = false (memory
--     `module-is-active-is-not-a-gate`).
--   · KHÔNG gate route FE hôm nay: `/auth/me` chưa expand danh sách module ⇒ `buildSessionFromStore()`
--     để `modules: []` và `evaluateRouteFromStore` BỎ `moduleCode` khi mảng rỗng (chống false-404).
--   · CÓ tác dụng ở ĐÚNG một chỗ: `module-catalog.repository.ts` lọc `WHERE is_active = true` cho
--     catalog `getMyApps`/admin. Đây là ghi-sổ "module đã launch" cho đúng DB-10 §10.2 + hợp đồng
--     smoke, KHÔNG phải một công tắc chức năng.
--
-- Hàng `modules.ROOM` ĐÃ TỒN TẠI từ 0435:298 (`Extension`, `is_active=false`) ⇒ đây là **UPDATE**,
-- KHÔNG phải INSERT. `INSERT … ON CONFLICT DO NOTHING` ở đây là NO-OP im lặng và module vẫn tắt
-- (memory `phase-modules-preseeded-inactive-in-0435`).
--
-- ĐI CÙNG COMMIT — BA việc, thiếu một là đỏ:
--   (1) file này;
--   (2) gỡ `'ROOM'` khỏi `EXTENSION_INACTIVE_MODULES` trong
--       `apps/api/test/integration/migration-smoke.int-spec.ts` — pin đó khẳng định ROOM phải inactive
--       sau seed;
--   (3) **NỚI guard verify (e) của 0554**: khối đó assert `is_active = false` VÔ ĐIỀU KIỆN, mà ca H1
--       của `s11-room-db1-invariants.int-spec.ts` replay NGUYÊN file 0554 ⇒ P0001 ngay khi cờ đã bật.
--       ASSET đã dính đúng lỗ này và vá ở 0550 hôm 30/08 (memory `module-enable-guard-blocks-next-wo`).
--       Guard baseline phải verify thứ migration đó TỰ CHỊU TRÁCH NHIỆM (hàng `modules.ROOM` tồn tại),
--       KHÔNG verify một cờ mà chính thông điệp của nó nói là WO sau sẽ đổi.
--
-- BAND 0557 (lane S11-ROOM-FE-1). Journal: idx 224, when 1717587346000 (> 0556 idx 223 / …345000).
--   Thiếu dòng journal ⇒ migration bị BỎ QUA TRONG IM LẶNG (memory
--   `migration-not-in-journal-is-silently-skipped`) — đã thêm cùng file này.
--
-- KHÔNG đụng: catalog quyền (0554 đã seed đủ 5 cặp + 22 grant), role `office-admin`, audit CHECK,
-- NOTI catalog (0555).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Bật module ROOM; fail-loud nếu hàng không tồn tại ────────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- Đếm TRƯỚC khi update: `GET DIAGNOSTICS ROW_COUNT` sau UPDATE trả 0 cho CẢ HAI ca "không có hàng"
  -- và "hàng đã đúng giá trị rồi" (migration chạy lại) — không phân biệt được lỗi thật với no-op.
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'ROOM' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0557] modules.ROOM khong ton tai dung 1 hang (ky vong 1 tu mig 0435, dem duoc %)', v_n;
  END IF;

  UPDATE modules
     SET is_active = true,
         updated_at = now()
   WHERE module_code = 'ROOM'
     AND deleted_at IS NULL
     AND is_active = false;

  RAISE NOTICE '[0557] modules.ROOM.is_active = true (ban giao tu 0554, tien le 0556 ASSET / 0538 CHAT)';
END $$;
--> statement-breakpoint

-- ─────────────── (2) Hậu kiểm: module PHẢI active sau migration này ───────────────────────────────
DO $$
DECLARE
  v_active boolean;
BEGIN
  SELECT is_active INTO v_active FROM modules WHERE module_code = 'ROOM' AND deleted_at IS NULL;
  IF v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0557] modules.ROOM van chua active sau UPDATE (is_active = %)', v_active;
  END IF;
END $$;
