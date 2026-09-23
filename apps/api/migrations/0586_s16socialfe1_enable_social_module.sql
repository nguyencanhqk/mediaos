-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0586 — S16-SOCIAL-FE-1: BẬT module SOCIAL (modules.SOCIAL.is_active = false → true)
--
-- BÀN GIAO TỪ 0577-0585 (S16-SOCIAL-DB-1/DB-2/BE-1/BE-1B/BE-2A/BE-2B-1) + 5 màn SOC-SCREEN-001..005
-- đã lên dây ở FE-1. Cùng đường 0567 (PAYROLL) / 0562 (RECRUIT) / 0557 (ROOM) / 0556 (ASSET).
--
-- ⚠️ CỜ NÀY CƯỠNG CHẾ ĐƯỢC CÁI GÌ (đo lại 23/09/2026, không đổi so với 0567): KHÔNG chặn request
-- backend nào (không có ModuleActiveGuard — memory `module-is-active-is-not-a-gate`); CÓ tác dụng đúng
-- một chỗ: `module-catalog.repository.ts` lọc `WHERE is_active = true` cho catalog getMyApps/admin. Đây
-- là ghi-sổ "module đã launch" theo DB-10 §10.2, KHÔNG phải công tắc chức năng — quyền thật nằm ở
-- PermissionGuard + tầng 2 SocialAccessService + sàn scope Company + RLS.
--
-- ⚠️ ĐIỀU NÀY **KHÔNG** TỰ LÀM Ô HOME ĐỔI HÀNH VI (plan M20): `ModuleWorkspaceLayout.buildSessionFromStore()`
-- hiện trả `modules: []` (còn `// TODO(BE)`), nên `getVisibleApps` rơi về `app.status` của hằng
-- `APP_REGISTRY`. Thứ quyết định ô Home hiện hay không là QUYỀN (`view:feed`). Đừng đọc migration này
-- như "bật tính năng cho người dùng".
--
-- ⚠️ KHÔNG cần nới guard nào của band 0577–0585: đã quét `grep -n "is_active" 057[7-9]*.sql 058[0-5]*.sql`
-- và mọi khớp đều là cột `feed_kudos_badges.is_active` (catalog huy hiệu), KHÔNG phải bảng `modules`.
-- Khác hẳn ca ROOM/ASSET — DB-1/DB-2 đã tuân SPEC-16 §23.1b (bài học
-- `module-enable-guard-blocks-next-wo` + `noti-check-baseline-guard-must-be-forward-compatible`).
--
-- Hàng `modules.SOCIAL` ĐÃ TỒN TẠI từ 0435:300 (`Extension`, is_active=false) ⇒ đây là **UPDATE**,
-- KHÔNG INSERT (`INSERT … ON CONFLICT DO NOTHING` là NO-OP im lặng — memory
-- `phase-modules-preseeded-inactive-in-0435`).
--
-- ĐI CÙNG COMMIT — BỐN việc, thiếu một là đỏ (plan T9):
--   (1) file này + dòng journal;
--   (2) `MODULE_APP_METADATA.SOCIAL` trong `apps/api/src/foundation/module-catalog/module-app-metadata.ts`;
--   (3) XOÁ `EXEMPT_MODULES.SOCIAL` ở `apps/api/test/foundation/module-app-metadata-ratchet.unit-spec.ts`
--       — quên là ratchet báo `DOUBLE_LISTED` (module vừa có metadata vừa được miễn);
--   (4) CHUYỂN 'SOCIAL' từ `EXTENSION_INACTIVE_MODULES` sang `EXTENSION_ACTIVE_MODULES` ở
--       `apps/api/test/integration/migration-smoke.int-spec.ts`. **CHUYỂN, không phải chỉ GỠ**: danh
--       sách ACTIVE assert DƯƠNG TÍNH `is_active = true`, còn "gỡ khỏi inactive" chỉ là phủ định và
--       để lọt ca migration quên chạy (chính lỗ mà describe "2a-ext" sinh ra để bịt).
--
-- Vì sao (2) BẮT BUỘC đi cùng: thiếu metadata thì `getMyApps` **im lặng bỏ qua** SOCIAL
-- (fail-soft `logger.warn` + `continue`) — module "đã bật" mà không có thẻ nào hiện ra, và KHÔNG test
-- nào đỏ nếu thiếu cả hai sổ (plan R5).
--
-- BAND 0586 (lane S16-SOCIAL-FE-1). Journal: idx 253, when 1717587375000 (> 0585 idx 252 / …374000).
--   `when` phải TĂNG NGẶT; thiếu dòng journal ⇒ migration bị BỎ QUA TRONG IM LẶNG (memory
--   `migration-not-in-journal-is-silently-skipped`) — đã thêm cùng file này.
--
-- KHÔNG đụng: catalog quyền (0578 đã seed 14 cặp `feed-*`), audit CHECK, NOTI catalog (0580/0585),
-- DDL social (0577/0579/0581-0584).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Bật module SOCIAL; fail-loud nếu hàng không tồn tại ──────────────────────────
DO $$
DECLARE
  v_n integer;
BEGIN
  -- Đếm TRƯỚC khi update: `GET DIAGNOSTICS ROW_COUNT` sau UPDATE trả 0 cho CẢ HAI ca "không có hàng"
  -- và "hàng đã đúng giá trị rồi" (migration chạy lại) — không phân biệt được lỗi thật với no-op.
  SELECT count(*) INTO v_n FROM modules WHERE module_code = 'SOCIAL' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0586] modules.SOCIAL khong ton tai dung 1 hang (ky vong 1 tu mig 0435, dem duoc %)', v_n;
  END IF;

  UPDATE modules
     SET is_active = true,
         updated_at = now()
   WHERE module_code = 'SOCIAL'
     AND deleted_at IS NULL
     AND is_active = false;

  RAISE NOTICE '[0586] modules.SOCIAL.is_active = true (ban giao tu 0577-0585, tien le 0556/0557/0562/0567)';
END $$;
--> statement-breakpoint

-- ─────────────── (2) Hậu kiểm: module PHẢI active sau migration này ───────────────────────────────
--
-- Guard FORWARD-COMPATIBLE: nó chỉ khẳng định điều CHÍNH FILE NÀY vừa làm, và replay nguyên file
-- không RAISE (UPDATE thành no-op, hậu kiểm vẫn thấy true). Nó **KHÔNG** assert trạng thái của bất kỳ
-- module nào khác — assert như vậy sẽ chặn WO kế tiếp bật module của họ (memory
-- `wiring-spec-must-not-pin-other-modules-state` · `module-enable-guard-blocks-next-wo`).
DO $$
DECLARE
  v_active boolean;
BEGIN
  SELECT is_active INTO v_active FROM modules WHERE module_code = 'SOCIAL' AND deleted_at IS NULL;
  IF v_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0586] modules.SOCIAL van chua active sau UPDATE (is_active = %)', v_active;
  END IF;
END $$;
