-- Migration 0553: S11-ROOM-DB-1 (🔴 RED, zone=red) — CONTRACT: DROP 4 bảng meeting_* di sản hub G10 + dọn 6 cặp
--   quyền `meeting`/`meeting_room` (DB-16 §3.3 / §9 bước B · ROOM-DEC-001 chốt 29/08/2026 sau khi ĐO).
--
-- DESTRUCTIVE-APPROVED: ROOM-DEC-001 DROP 4 bảng meetings · meeting_attendees · meeting_notes · meeting_tasks —
--   0 hàng cả 4 bảng đo 29/08/2026 trên DB `mediaos` (PROD + dev-online dùng chung), 0 service/controller/guard
--   sống trong apps/api/src, tiền kiểm "0 hàng" fail-loud ngay dưới (owner ký gói wave S11-OFFICE 28/08/2026)
--
-- ── VÌ SAO ─────────────────────────────────────────────────────────────────────────────────────
-- SPEC-14 thay `meetings`/`meeting_attendees` bằng `room_bookings`/`room_booking_attendees` (0552) vì schema cũ lệch
-- 5 điểm (SPEC-14 §3.4: room nullable + SET NULL, status chữ thường 3 giá trị, organizer CASCADE, agenda/metadata
-- jsonb, soft-delete trên lượt). `meeting_notes`/`meeting_tasks` (biên bản + link task) ngoài phạm vi SPEC-14 v1
-- (§5.2). Expand (0552) và contract (file này) nằm CÙNG WO vì **0 code sống** đọc/ghi 4 bảng — điều kiện của
-- `migration-expand-contract-required` (cửa sổ 403/500 chỉ có khi guard/service đang chạy).
--
-- ── SỐ ĐO TRƯỚC KHI CHẠY (29/08/2026, logs/measure-meeting-legacy.mjs + logs/measure-room-extra.mjs) ────
--   • meetings 0 · meeting_attendees 0 · meeting_notes 0 · meeting_tasks 0 hàng (total lẫn live).
--   • FK rơi theo DROP: 8 FK một-cột (meetings.meeting_room_id/organizer_id · meeting_attendees.meeting_id/user_id ·
--     meeting_notes.meeting_id/author_user_id · meeting_tasks.meeting_id/task_id) + 8 composite 0535 tương ứng
--     ⇒ census `xtenant-fk-ratchet` giảm ĐÚNG 8: sàn FK_SINGLE_COL_PAIRS_FLOOR 423 → 415, đo hai lane
--     (mediaos_roombase551 = 423 · mediaos_roomdb1 sau 0555 = 415) — ghi ở fk-tenant-verdicts.ts.
--   • Trigger: meetings_updated_at_trg + meeting_notes_updated_at_trg → meetings_set_updated_at() (2 hộ, rơi theo).
--   • 0 VIEW/MATVIEW phụ thuộc (pg_depend). `meeting_tasks.task_id → tasks` là FK TỪ bảng bị DROP — rơi theo,
--     `tasks` KHÔNG bị đụng (task_type 'meeting_action' là chuỗi của TASK, giữ nguyên).
--   • 6 cặp quyền `('view'|'create'|'update'|'cancel','meeting')` · `('view'|'manage','meeting_room')`: 12 hàng
--     role_permissions — CẢ 12 thuộc 2 role TENANT («QUẢN LÝ CẤP CAO», «SA»), 0 role hệ thống; 0 object_permissions;
--     0 guard dùng ⇒ xoá không mở cửa sổ 403. `permissions` KHÔNG có cột deleted_at (0005) ⇒ HARD-DELETE (khuôn
--     0548:109-121), không "xoá mềm" như DB-16 §9B viết (đã đính chính).
--   ⇒ File này KHÔNG mất dữ liệu nghiệp vụ nào. Nếu số hàng ≠ 0 khi bạn đọc lại: tiền kiểm DỪNG, người quyết.
--
-- ── THỨ TỰ CÓ CHỦ ĐÍCH ─────────────────────────────────────────────────────────────────────────
-- (1) tiền kiểm 0 hàng fail-loud (KHÔNG tự migrate dữ liệu) · (2) DROP 4 bảng trong MỘT câu, KHÔNG CASCADE — một
-- phụ thuộc ngoài danh sách phải làm migration ĐỎ chứ không được biến mất lặng lẽ · (3) DROP FUNCTION · (4) quyền:
-- role_permissions → object_permissions → permissions.
-- Cùng commit: rls-registry.ts gỡ 4 entry (hai entry sau còn `INSERT INTO meetings` trong seedRow — để lại là 42P01)
-- · demo-seed-full.mjs gỡ khối MEETINGS + 2 dòng đếm (nằm TRONG transaction trước COMMIT — không gỡ là demo-seed
-- ROLLBACK toàn bộ) · AUDIT_OBJECT_TYPES (TS) gỡ 'meeting'/'meeting_note' (CHECK DB GIỮ — union chỉ tăng, bất biến #2)
-- · packages/contracts/src/meeting.ts (DTO park, 0 consumer) gỡ.
--
-- BAND 0553 (lane S11-ROOM-DB-1). Journal: idx 220, when 1717587342000 (> 0552 idx 219 / 1717587341000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) TIỀN KIỂM fail-loud: 0 hàng trên 4 bảng; 0552 đã áp ───────────────
DO $$
DECLARE
  t    text;
  v_n  bigint;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF to_regclass('room_bookings') IS NULL OR to_regclass('meeting_rooms') IS NULL THEN
    RAISE EXCEPTION '[0553] room_bookings/meeting_rooms chua ton tai — 0552 (expand) phai ap TRUOC contract';
  END IF;

  FOREACH t IN ARRAY ARRAY['meetings', 'meeting_attendees', 'meeting_notes', 'meeting_tasks'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE NOTICE '[0553] bang % khong ton tai — bo qua (lane DB da DROP truoc?)', t;
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I', t) INTO v_n;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0553] % con % hang — DUNG, nguoi quyet (ROOM-DEC-001 gia dinh 0 hang; KHONG tu migrate du lieu)', t, v_n;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ─────────────── (2) DROP 4 bảng — MỘT câu, KHÔNG CASCADE (con → cha; RLS policy/index/FK/trigger rơi theo) ───────────────
DROP TABLE IF EXISTS meeting_tasks, meeting_notes, meeting_attendees, meetings;
--> statement-breakpoint

-- ─────────────── (3) Hàm trigger updated_at (0052) — 2 hộ đã rơi cùng bảng ───────────────
DROP FUNCTION IF EXISTS meetings_set_updated_at();
--> statement-breakpoint

-- ─────────────── (4) Quyền di sản: HARD-DELETE 6 cặp + grant (permissions KHÔNG có deleted_at — khuôn 0548) ───────────────
-- ⛔ KHÔNG đụng cặp nào khác: 'channel'/'project'/'content'/'platform-account' (park, auth-seed-canonical-roles §F
-- đo grant park > 0). Tập xoá = ĐÚNG 2 resource_type gắn chặt với bảng vừa DROP.
DO $$
DECLARE
  v_rp  int;
  v_op  int;
  v_p   int;
BEGIN
  DELETE FROM role_permissions
   WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type IN ('meeting', 'meeting_room'));
  GET DIAGNOSTICS v_rp = ROW_COUNT;

  DELETE FROM object_permissions
   WHERE permission_id IN (SELECT id FROM permissions WHERE resource_type IN ('meeting', 'meeting_room'));
  GET DIAGNOSTICS v_op = ROW_COUNT;

  DELETE FROM permissions WHERE resource_type IN ('meeting', 'meeting_room');
  GET DIAGNOSTICS v_p = ROW_COUNT;

  -- Fail-loud theo số đo 29/08/2026 (12 · 0 · 6 trên DB mediaos; lane mới = 0 · 0 · 6 vì 2 role tenant không có ở
  -- lane): xoá NHIỀU hơn số đo = catalog đã trôi sau ngày đo ⇒ DỪNG, đo lại (security-reviewer LOW). 0 cặp = 0553
  -- đã chạy trước đó (không xảy ra qua migrator) — cũng không phải 6 ⇒ đỏ để người nhìn.
  IF v_p <> 6 OR v_rp > 12 OR v_op > 0 THEN
    RAISE EXCEPTION '[0553] quyen di san meeting* lech so do: xoa % role_permissions · % object_permissions · % permissions (ky vong <=12 · 0 · =6) — DUNG, do lai',
      v_rp, v_op, v_p;
  END IF;
  RAISE NOTICE '[0553] quyen di san meeting*: xoa % role_permissions · % object_permissions · % permissions (do 29/08/2026: 12 · 0 · 6)',
    v_rp, v_op, v_p;
END;
$$;
--> statement-breakpoint

-- ─────────────── (5) VERIFY fail-loud ───────────────
DO $$
DECLARE
  t    text;
  v_n  int;
BEGIN
  FOREACH t IN ARRAY ARRAY['meetings', 'meeting_attendees', 'meeting_notes', 'meeting_tasks'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      RAISE EXCEPTION '[0553] verify: bang % van con', t;
    END IF;
  END LOOP;
  IF to_regproc('meetings_set_updated_at') IS NOT NULL THEN
    RAISE EXCEPTION '[0553] verify: ham meetings_set_updated_at() van con';
  END IF;

  SELECT count(*) INTO v_n FROM permissions WHERE resource_type IN ('meeting', 'meeting_room');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0553] verify: con % cap quyen meeting/meeting_room', v_n;
  END IF;

  -- Bảng tái dụng còn nguyên RLS + FORCE; bảng ngoài cụm không bị đụng
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'meeting_rooms'::regclass AND relrowsecurity AND relforcerowsecurity) THEN
    RAISE EXCEPTION '[0553] verify: meeting_rooms mat RLS/FORCE';
  END IF;
  IF to_regclass('tasks') IS NULL OR to_regclass('users') IS NULL THEN
    RAISE EXCEPTION '[0553] verify: bang ngoai cum (tasks/users) bien mat — DROP da keo theo thu ngoai danh sach';
  END IF;

  RAISE NOTICE '[0553] verify PASS: 4 bang meeting_* + ham trigger da go · 0 cap quyen meeting* · meeting_rooms nguyen ven';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy): 0 hàng nên không có dữ liệu để khôi phục; DDL tham khảo ở
-- -- 0052_g10_meeting.sql + 0053 (meeting_notes/meeting_tasks) + 0535 (composite FK). Quyền: INSERT lại 6 cặp từ 0052.
