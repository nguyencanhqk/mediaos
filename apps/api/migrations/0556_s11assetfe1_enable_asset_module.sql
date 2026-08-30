-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0556 — S11-ASSET-FE-1: BẬT module ASSET (modules.ASSET.is_active = false → true)
--
-- BÀN GIAO TỪ 0550 (S11-ASSET-DB-1). Migration đó CỐ Ý giữ `is_active=false` và ghi rõ lý do ở dòng
-- 10/43: "chua co endpoint — S11-ASSET-FE-1 moi bat". Tiền lệ 0538 (CHAT).
--
-- ⚠️ CỜ NÀY CƯỠNG CHẾ ĐƯỢC CÁI GÌ — đo 30/08/2026, ĐỪNG dùng nó làm đệm an toàn:
--   · KHÔNG chặn request nào ở backend: `grep ModuleActiveGuard apps/api/src` = 0 file. Ai cầm token
--     + đủ cặp quyền là gọi được 26 route ASSET kể cả khi cờ = false (memory module-is-active-is-not-a-gate).
--   · KHÔNG gate route FE hôm nay: `evaluateRouteAccess` CÓ nhánh MODULE_HIDDEN/MODULE_DISABLED đọc
--     `session.modules`, nhưng `/auth/me` chưa expand danh sách module ⇒ `buildSessionFromStore()` để
--     `modules: []` và `evaluateRouteFromStore` BỎ `moduleCode` khi mảng rỗng (chống false-404,
--     ProtectedRoute.tsx:13-17). Nên 7 màn ASSET chạy được BẤT KỂ cờ này.
--   · CÓ tác dụng ở ĐÚNG một chỗ: `module-catalog.repository.ts:24` lọc `WHERE is_active = true` cho
--     catalog `getMyApps`/admin. Lưới "Ứng dụng của tôi" của FE lại dựng 100% từ APP_REGISTRY tĩnh
--     (ghi chú S8-CHAT-ENTRY-1 ở registry.ts), nên hôm nay đây là ghi-sổ "module đã launch" cho đúng
--     DB-10 §10.2 + hợp đồng smoke, KHÔNG phải một công tắc chức năng.
--
-- ĐÃ BIẾT (không vá ở WO này — ngoài `paths`): module active mà vắng `MODULE_APP_METADATA` thì
-- `getMyApps` bỏ qua kèm log warn. GOAL (active từ 0506) đã ở đúng tình trạng đó từ trước ⇒ hành vi
-- có sẵn, không phải hồi quy do 0556. Ghi vào plan §12 để WO chạm module-catalog dọn một thể.
--
-- Hàng `modules.ASSET` ĐÃ TỒN TẠI từ 0435:297 (`('ASSET','Tài sản','Extension',false,false,false,10)`)
-- ⇒ đây là **UPDATE**, KHÔNG phải INSERT. `INSERT … ON CONFLICT DO NOTHING` ở đây sẽ là NO-OP im lặng
-- và module vẫn tắt (memory `phase-modules-preseeded-inactive-in-0435`).
--
-- ĐI CÙNG COMMIT: gỡ 'ASSET' khỏi `EXTENSION_INACTIVE_MODULES` trong
-- `apps/api/test/integration/migration-smoke.int-spec.ts` — pin đó khẳng định ASSET phải inactive sau
-- seed; tách hai việc ra hai commit là tự tạo một commit ĐỎ ở giữa (DB-10 §10.2).
--
-- BAND 0556 (lane S11-ASSET-FE-1). Journal: idx 223, when 1717587345000 (> 0555 idx 222 / …344000).
--   Thiếu dòng journal ⇒ migration bị BỎ QUA TRONG IM LẶNG (memory
--   `migration-not-in-journal-is-silently-skipped`) — đã thêm cùng file này.
--
-- KHÔNG đụng: catalog quyền (0550 đã seed đủ 11 cặp), role `asset-manager`, audit CHECK, NOTI catalog.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Bật module ASSET; fail-loud nếu hàng không tồn tại ───────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- Đếm TRƯỚC khi update: `GET DIAGNOSTICS ROW_COUNT` sau UPDATE trả 0 cho CẢ HAI ca "không có hàng"
  -- và "hàng đã đúng giá trị rồi" (migration chạy lại) — không phân biệt được lỗi thật với no-op.
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'ASSET' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0556] modules.ASSET khong ton tai dung 1 hang (ky vong 1 tu mig 0435, dem duoc %)', v_n;
  END IF;

  UPDATE modules
     SET is_active = true,
         updated_at = now()
   WHERE module_code = 'ASSET'
     AND deleted_at IS NULL
     AND is_active = false;

  RAISE NOTICE '[0556] modules.ASSET.is_active = true (ban giao tu 0550, tien le 0538 CHAT)';
END $$;
--> statement-breakpoint

-- ─────────────── (2) Hậu kiểm: module PHẢI active sau migration này ───────────────────────────────
DO $$
DECLARE
  v_active boolean;
BEGIN
  SELECT is_active INTO v_active FROM modules WHERE module_code = 'ASSET' AND deleted_at IS NULL;
  IF v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0556] modules.ASSET van chua active sau UPDATE (is_active = %)', v_active;
  END IF;
END $$;
