-- Migration 0552: S11-ROOM-DB-1 (🔴 RED, zone=red, crown) — ROOM EXPAND (DB-16 §6.1–6.3, bước A §9).
--
-- DESTRUCTIVE-APPROVED: ROOM-DEC-001 gỡ cột meeting_rooms.is_virtual ngoài phạm vi SPEC-14 (phòng ảo/link
--   họp online) — 0 hàng đo 29/08/2026 trên DB `mediaos`, tiền kiểm fail-loud "0 hàng true" ngay dưới
--   (owner ký gói wave S11-OFFICE 28/08/2026)
--
-- MỤC TIÊU (plan docs/plans/S11-ROOM-DB-1.md §2): ba việc trong một file, theo ROOM-DEC-001 (chốt 29/08/2026 sau
-- khi ĐO: 0 hàng cả 5 bảng meeting_*, 0 code sống):
--   • meeting_rooms          — TÁI DỤNG + ALTER: +equipment/description/requires_approval/is_active/sort_order/
--                              updated_at/updated_by/deleted_by; capacity SET NOT NULL + CHECK > 0; DROP is_virtual;
--                              unique lower(name) trên hàng sống; index (company_id, is_active, sort_order).
--                              GIỮ policy `meeting_rooms_tenant` (0052, USING-only — Postgres dùng USING làm check
--                              ngầm cho ghi; rls-coverage-assert (b) chấp nhận), GIỮ GRANT app, GIỮ cả hai FK created_by
--                              (0052 một-cột + 0535 composite `SET NULL (created_by)`).
--   • room_bookings          — MỚI, SỔ lượt đặt (không DELETE, UPDATE CẤP CỘT huỷ). CHỐT CUỐI chống trùng lịch =
--                              EXCLUDE USING gist (company_id, room_id, tstzrange [starts_at, ends_at)) WHERE Confirmed.
--   • room_booking_attendees — MỚI, SỔ người tham dự (chỉ SELECT, INSERT).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id NOT NULL + DEFAULT literal-GUC + RLS ENABLE + FORCE + policy tenant_isolation (USING + WITH CHECK)
--      cho 2 bảng MỚI TRƯỚC mọi INSERT (nguyên văn 0549/0504). MỌI FK chéo bảng nghiệp vụ là COMPOSITE tenant FK
--      (company_id, col) → parent (company_id, id) (KI-046: FK Postgres bỏ qua RLS). Verify (3) DƯƠNG đúng-bằng 10
--      composite FK — quên hẳn FK thì census/ratchet IM LẶNG.
--   #2 room_bookings: GRANT SELECT, INSERT + UPDATE CẤP CỘT (status, cancelled_at, cancelled_by, cancel_reason,
--      updated_at, updated_by) — KHÔNG GRANT UPDATE cấp bảng (revoke-table-grant-wipes-column-grants), KHÔNG DELETE.
--      room_booking_attendees: SELECT, INSERT. meeting_rooms: soft-delete = UPDATE, KHÔNG DELETE (giữ 0052).
--      *_by nullable trên room_bookings chia theo ALLOWLIST (plan D9, plan-reviewer B2): cancelled_by/updated_by
--      NẰM TRONG allowlist UPDATE ⇒ SET NULL (col) (RI action không ghi đè cột cố ý không grant);
--      booked_by_user_id KHÔNG trong allowlist (dấu vết đặt hộ — sổ) ⇒ NO ACTION như *_by sổ của 0549.
--      organizer_user_id NOT NULL ⇒ NO ACTION.
--   #3 module không lưu secret.
--   • FK nội bộ ON DELETE NO ACTION — TUYỆT ĐỐI KHÔNG RESTRICT (cascade từ companies theo thứ tự anh em bất định).
--   • mediaos_worker: SELECT trên cả 3 bảng — job ROOM_BOOKING_REMINDER (SPEC-14 §13.5) đọc qua dbw (tiền lệ 0549).
--   • DDL thủ công — KHÔNG db:generate. schema/rooms.ts là PARITY-only (thay schema/meeting.ts).
--   • `DROP INDEX meeting_rooms_active_idx` ngoài phạm vi quét migration-no-drop (thay bằng index có is_active).
--
-- BAND 0552 (lane S11-ROOM-DB-1, nối tiếp SAU S11-ASSET-DB-1). Journal: idx 219, when 1717587341000
--   (> 0551 idx 218 / 1717587340000).
--   Cùng commit: schema/rooms.ts (xoá meeting.ts) + schema/index.ts · test/helpers/seed.ts cleanupTenants()
--   (attendees → bookings TRƯỚC `DELETE FROM users`) · test/integration/rls-registry.ts (sửa seedRow meeting_rooms
--   thêm capacity; +2 case).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- btree_gist: cần cho EXCLUDE gist kết hợp uuid `=` + tstzrange `&&` (đã có từ 0052 trên DB thật; lane DB mới vẫn cần).
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- ─────────────── (0) TIỀN KIỂM fail-loud ───────────────
DO $$
DECLARE
  t     text;
  v_n   int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '[0552] can PostgreSQL >= 15 cho ON DELETE SET NULL (col) — server_version_num = %',
      current_setting('server_version_num');
  END IF;

  IF to_regclass('meeting_rooms') IS NULL THEN
    RAISE EXCEPTION '[0552] meeting_rooms KHONG ton tai — chuoi migration khong phai ban sau 0052';
  END IF;

  -- Bảng ĐÍCH của composite FK phải có UNIQUE (company_id, id). KHÔNG tự tạo (0535 đã phủ cả hai).
  FOREACH t IN ARRAY ARRAY['users', 'meeting_rooms'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0552] % thieu UNIQUE (company_id, id) (dem duoc %) — chay truoc: '
                      'ALTER TABLE % ADD CONSTRAINT %_company_id_id_uq UNIQUE (company_id, id);', t, v_n, t, t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY ARRAY['room_bookings', 'room_booking_attendees'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      RAISE EXCEPTION '[0552] bang % DA TON TAI — dung ten voi lane khac, abort', t;
    END IF;
  END LOOP;

  -- Dữ liệu thật phải cho phép SET NOT NULL / DROP COLUMN (đo 29/08/2026 = 0 hàng). Khác ⇒ DỪNG, người quyết.
  SELECT count(*) INTO v_n FROM meeting_rooms WHERE capacity IS NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0552] meeting_rooms co % hang capacity IS NULL — DUNG, nguoi quyet (khong tu dien gia tri)', v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'meeting_rooms'::regclass AND attname = 'is_virtual' AND NOT attisdropped) THEN
    EXECUTE 'SELECT count(*) FROM meeting_rooms WHERE is_virtual' INTO v_n;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0552] meeting_rooms co % hang is_virtual = true — DUNG, nguoi quyet (ROOM-DEC-001 gia dinh 0)', v_n;
    END IF;
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── 1. meeting_rooms — ALTER (DB-16 §6.1, idempotent cho lane DB) ───────────────
ALTER TABLE meeting_rooms
  ADD COLUMN IF NOT EXISTS equipment         text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description       text,
  ADD COLUMN IF NOT EXISTS requires_approval boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_active         boolean     NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order        integer     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by        uuid,
  ADD COLUMN IF NOT EXISTS deleted_by        uuid;
--> statement-breakpoint
-- FK *_by COMPOSITE (DB-16 §4.2) — KHÔNG REFERENCES users (id) một cột (ratchet xtenant-fk đỏ + lỗ KI-046).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'meeting_rooms'::regclass AND conname = 'meeting_rooms_updated_by_tenant_fk') THEN
    ALTER TABLE meeting_rooms ADD CONSTRAINT meeting_rooms_updated_by_tenant_fk
      FOREIGN KEY (company_id, updated_by) REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'meeting_rooms'::regclass AND conname = 'meeting_rooms_deleted_by_tenant_fk') THEN
    ALTER TABLE meeting_rooms ADD CONSTRAINT meeting_rooms_deleted_by_tenant_fk
      FOREIGN KEY (company_id, deleted_by) REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
  END IF;
END;
$$;
--> statement-breakpoint
ALTER TABLE meeting_rooms ALTER COLUMN capacity SET NOT NULL;
--> statement-breakpoint
-- Cột ghi-rồi-bỏ ⇒ GỠ (write-only-column-means-delete-not-wire-up). 0052 không có CHECK chạm cột này (đo: 0 CHECK
-- trên meeting_rooms) — vẫn verify (5) chk_meeting_rooms_capacity còn sau DROP COLUMN (drop-column-silently-drops-check).
ALTER TABLE meeting_rooms DROP COLUMN IF EXISTS is_virtual;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'meeting_rooms'::regclass AND conname = 'chk_meeting_rooms_capacity') THEN
    ALTER TABLE meeting_rooms ADD CONSTRAINT chk_meeting_rooms_capacity CHECK (capacity > 0);
  END IF;
END;
$$;
--> statement-breakpoint
-- Tên phòng unique theo company KHÔNG phân biệt hoa/thường trên hàng còn sống (DB-16 §6.1 / §11).
CREATE UNIQUE INDEX IF NOT EXISTS uq_meeting_rooms_company_name_active
  ON meeting_rooms (company_id, lower(name)) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Thay index 0052 (company_id) WHERE deleted_at IS NULL bằng index có is_active/sort_order (phòng trống / form đặt).
DROP INDEX IF EXISTS meeting_rooms_active_idx;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_meeting_rooms_company_active
  ON meeting_rooms (company_id, is_active, sort_order) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Job nhắc lịch đọc tên phòng qua worker pool (D4). GRANT app (INSERT, SELECT, UPDATE — không DELETE) GIỮ từ 0052.
GRANT SELECT ON meeting_rooms TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 2. room_bookings (DB-16 §6.2 — SỔ lượt đặt, KHÔNG deleted_at: huỷ là trạng thái) ───────────────
CREATE TABLE room_bookings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  room_id            uuid NOT NULL,
  title              varchar(255) NOT NULL,
  description        text,
  starts_at          timestamptz NOT NULL,
  ends_at            timestamptz NOT NULL,
  organizer_user_id  uuid NOT NULL,
  -- người thao tác (≠ organizer khi Office Admin đặt hộ — SPEC-14 §18: dấu vết đặt hộ).
  booked_by_user_id  uuid,
  status             varchar(20) NOT NULL DEFAULT 'Confirmed',
  cancelled_at       timestamptz,
  cancelled_by       uuid,
  cancel_reason      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  -- SPEC-01 §17.10: Confirmed · Cancelled; Completed DẪN XUẤT (ends_at ≤ now()), không cột.
  CONSTRAINT chk_room_bookings_status     CHECK (status IN ('Confirmed', 'Cancelled')),
  -- Thời lượng 15′–8h kiểm ở service (ROOM-ERR-002) — DB KHÔNG CHECK thời lượng (hằng nghiệp vụ có thể đổi).
  CONSTRAINT chk_room_bookings_time_order CHECK (ends_at > starts_at),
  -- Cancelled ⇔ cancelled_at NOT NULL: "huỷ" = MỘT câu UPDATE đặt status + cancelled_at (+cancelled_by, cancel_reason).
  CONSTRAINT chk_room_bookings_cancel_pair CHECK (
    (status = 'Confirmed' AND cancelled_at IS NULL) OR
    (status = 'Cancelled' AND cancelled_at IS NOT NULL)
  ),
  CONSTRAINT room_bookings_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE room_bookings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE room_bookings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON room_bookings;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON room_bookings
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE room_bookings
  ADD CONSTRAINT room_bookings_room_tenant_fk FOREIGN KEY (company_id, room_id)
    REFERENCES meeting_rooms (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT room_bookings_organizer_tenant_fk FOREIGN KEY (company_id, organizer_user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  -- booked_by_user_id KHÔNG nằm trong allowlist UPDATE (dấu vết đặt hộ — sổ) ⇒ NO ACTION: RI action SET NULL chạy ở
  -- tầng owner, bỏ qua column-grant, sẽ ghi đè đúng cột cố ý không grant (khuôn 0549 *_by sổ; plan-reviewer B2).
  ADD CONSTRAINT room_bookings_booked_by_tenant_fk FOREIGN KEY (company_id, booked_by_user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  -- cancelled_by / updated_by nằm TRONG allowlist UPDATE ⇒ SET NULL (col) theo DB-16 §6.2 — có danh sách cột, KHÔNG
  -- SET NULL trần (null luôn company_id).
  ADD CONSTRAINT room_bookings_cancelled_by_tenant_fk FOREIGN KEY (company_id, cancelled_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (cancelled_by),
  ADD CONSTRAINT room_bookings_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);
--> statement-breakpoint
-- CHỐT CUỐI SPEC-14 §3.1: hai lượt Confirmed trên cùng phòng không giao nhau. '[)' nửa-mở ⇒ 10:00–11:00 và
-- 11:00–12:00 KHÔNG trùng. Lượt Cancelled không chặn (predicate). Service kiểm trước để trả 409 có nội dung;
-- vi phạm ở đây (23P01) map về cùng 409 (S11-ROOM-BE-1). company_id WITH = giữ quy ước "mọi index dẫn đầu bằng
-- company_id" (DB-16 §6.2 ghi chú).
ALTER TABLE room_bookings ADD CONSTRAINT room_bookings_no_overlap_excl
  EXCLUDE USING gist (
    company_id WITH =,
    room_id    WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status = 'Confirmed');
--> statement-breakpoint
CREATE INDEX idx_room_bookings_company_start ON room_bookings (company_id, starts_at);
--> statement-breakpoint
CREATE INDEX idx_room_bookings_room_start ON room_bookings (company_id, room_id, starts_at) WHERE status = 'Confirmed';
--> statement-breakpoint
CREATE INDEX idx_room_bookings_organizer ON room_bookings (company_id, organizer_user_id, starts_at DESC);
--> statement-breakpoint
-- SỔ (bất biến #2): SELECT, INSERT + UPDATE CẤP CỘT — KHÔNG GRANT UPDATE cấp bảng, KHÔNG DELETE.
GRANT SELECT, INSERT ON room_bookings TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (status, cancelled_at, cancelled_by, cancel_reason, updated_at, updated_by)
  ON room_bookings TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON room_bookings TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 3. room_booking_attendees (DB-16 §6.3 — SỔ người tham dự, cố định lúc đặt) ───────────────
CREATE TABLE room_booking_attendees (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  booking_id  uuid NOT NULL,
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE room_booking_attendees ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE room_booking_attendees FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON room_booking_attendees;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON room_booking_attendees
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE room_booking_attendees
  ADD CONSTRAINT room_booking_attendees_booking_tenant_fk FOREIGN KEY (company_id, booking_id)
    REFERENCES room_bookings (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT room_booking_attendees_user_tenant_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_room_booking_attendees_booking_user
  ON room_booking_attendees (company_id, booking_id, user_id);
--> statement-breakpoint
CREATE INDEX idx_room_booking_attendees_user ON room_booking_attendees (company_id, user_id, booking_id);
--> statement-breakpoint
-- SỔ: chỉ SELECT, INSERT (người tham dự cố định lúc đặt — SPEC-14 §5.2). Organizer KHÔNG chèn vào bảng này.
GRANT SELECT, INSERT ON room_booking_attendees TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON room_booking_attendees TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (4) VERIFY fail-LOUD (RAISE EXCEPTION) — mọi assert có vế DƯƠNG đúng-bằng (plan §2.3). Migrator 1 tx ⇒ rollback sạch.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_tables   CONSTANT text[] := ARRAY['meeting_rooms', 'room_bookings', 'room_booking_attendees'];
  t          text;
  v_n        int;
  v_privs    text[];
  v_cols     text[];
  v_exp      text[];
  v_bad      text;
  v_pred     text;
  v_def      text;
  r          record;
BEGIN
  -- (1) RLS ENABLE + FORCE cả 3; 2 bảng mới policy tenant_isolation USING + WITH CHECK theo GUC;
  --     meeting_rooms giữ policy 0052 `meeting_rooms_tenant` USING-only (polwithcheck NULL ⇒ Postgres dùng USING làm
  --     check ngầm — D5) — chấp nhận NULL HOẶC WITH CHECK có GUC, nhưng KHÔNG chấp nhận WITH CHECK lệch GUC.
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = t::regclass AND relrowsecurity AND relforcerowsecurity) THEN
      RAISE EXCEPTION '[0552] verify: % thieu ENABLE/FORCE ROW LEVEL SECURITY', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['room_bookings', 'room_booking_attendees'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = t::regclass AND polname = 'tenant_isolation'
         AND pg_get_expr(polqual, polrelid)      LIKE '%app.current_company_id%'
         AND pg_get_expr(polwithcheck, polrelid) LIKE '%app.current_company_id%'
    ) THEN
      RAISE EXCEPTION '[0552] verify: % thieu policy tenant_isolation USING+WITH CHECK theo GUC', t;
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'meeting_rooms'::regclass AND polname = 'meeting_rooms_tenant'
       AND pg_get_expr(polqual, polrelid) LIKE '%app.current_company_id%'
       AND (polwithcheck IS NULL OR pg_get_expr(polwithcheck, polrelid) LIKE '%app.current_company_id%')
  ) THEN
    RAISE EXCEPTION '[0552] verify: meeting_rooms thieu policy meeting_rooms_tenant (0052) theo GUC';
  END IF;

  -- (2) GRANT bằng aclexplode (KHÔNG information_schema — 0540:137-139)
  FOREACH t IN ARRAY v_tables LOOP
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_app'::regrole;
    v_exp := CASE WHEN t = 'meeting_rooms' THEN ARRAY['INSERT', 'SELECT', 'UPDATE'] ELSE ARRAY['INSERT', 'SELECT'] END;
    IF v_privs IS DISTINCT FROM v_exp THEN
      RAISE EXCEPTION '[0552] verify: ACL cap bang cua mediaos_app tren % = % — ky vong % (bat bien #2)', t, v_privs, v_exp;
    END IF;

    -- (2b) column-UPDATE ĐÚNG BẰNG allowlist (thiếu HOẶC thừa đều đỏ); meeting_rooms/attendees: 0 column-ACL
    SELECT array_agg(a.attname::text ORDER BY a.attname) INTO v_cols
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type = 'UPDATE';
    v_exp := CASE t
      WHEN 'room_bookings' THEN ARRAY['cancel_reason', 'cancelled_at', 'cancelled_by', 'status', 'updated_at', 'updated_by']
      ELSE NULL END;
    IF NOT (COALESCE(v_cols, ARRAY[]::text[]) @> COALESCE(v_exp, ARRAY[]::text[])
            AND COALESCE(v_exp, ARRAY[]::text[]) @> COALESCE(v_cols, ARRAY[]::text[])) THEN
      RAISE EXCEPTION '[0552] verify: column-UPDATE cua mediaos_app tren % = % — ky vong % (allowlist DB-16 §6.2)', t, v_cols, v_exp;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type <> 'UPDATE';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0552] verify: % co % column-ACL ngoai UPDATE cho mediaos_app — lech khuon', t, v_n;
    END IF;

    -- (2c) worker: đúng {SELECT}, 0 column-ACL
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_worker'::regrole;
    IF v_privs IS DISTINCT FROM ARRAY['SELECT'] THEN
      RAISE EXCEPTION '[0552] verify: ACL cua mediaos_worker tren % = % — ky vong {SELECT}', t, v_privs;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped AND x.grantee = 'mediaos_worker'::regrole;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0552] verify: mediaos_worker co % column-ACL tren % — ky vong 0', v_n, t;
    END IF;
  END LOOP;

  -- (3) COMPOSITE FK — DƯƠNG đúng-bằng 10 dòng (bảng, cột, đích, deltype, setcols). Thiếu/thừa ⇒ đỏ.
  SELECT string_agg(format('%s.%s -> %s [%s|%s]', d.tbl, d.col, d.tgt, d.del, d.setcols), ' ; ') INTO v_bad
    FROM (
      WITH actual AS (
        SELECT c.conrelid::regclass::text AS tbl,
               (SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[2]) AS col,
               c.confrelid::regclass::text AS tgt,
               c.confdeltype::text AS del,
               COALESCE((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
                          WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.confdelsetcols)), ARRAY[]::text[]) AS setcols
          FROM pg_constraint c
         WHERE c.contype = 'f'
           AND c.conrelid::regclass::text = ANY (v_tables)
           AND array_length(c.conkey, 1) = 2
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[2]) = 'id'
      ), expected (tbl, col, tgt, del, setcols) AS (VALUES
        ('meeting_rooms',          'created_by',        'users',         'n', ARRAY['created_by']),
        ('meeting_rooms',          'updated_by',        'users',         'n', ARRAY['updated_by']),
        ('meeting_rooms',          'deleted_by',        'users',         'n', ARRAY['deleted_by']),
        ('room_bookings',          'room_id',           'meeting_rooms', 'a', ARRAY[]::text[]),
        ('room_bookings',          'organizer_user_id', 'users',         'a', ARRAY[]::text[]),
        ('room_bookings',          'booked_by_user_id', 'users',         'a', ARRAY[]::text[]),
        ('room_bookings',          'cancelled_by',      'users',         'n', ARRAY['cancelled_by']),
        ('room_bookings',          'updated_by',        'users',         'n', ARRAY['updated_by']),
        ('room_booking_attendees', 'booking_id',        'room_bookings', 'a', ARRAY[]::text[]),
        ('room_booking_attendees', 'user_id',           'users',         'a', ARRAY[]::text[])
      )
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0552] verify: composite FK LECH so voi 10 dong ky vong (thieu/thua): %', v_bad;
  END IF;
  -- (3a') mọi FK ≥ 2 cột trên 3 bảng = 10 (bịt điểm mù FK lệch hình dạng rớt khỏi cả hai vế EXCEPT)
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables) AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 10 THEN
    RAISE EXCEPTION '[0552] verify: co % FK >= 2 cot tren 3 bang ROOM, ky vong dung 10 — co FK lech hinh dang', v_n;
  END IF;
  -- (3b) FK một-cột ngoài companies: meeting_rooms ĐÚNG 1 (created_by 0052, đã được 0535 phủ composite — D6);
  --      2 bảng mới = 0 (đúng lớp lỗ KI-046).
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid = 'meeting_rooms'::regclass
     AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass
     AND c.conname = 'meeting_rooms_created_by_fkey';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0552] verify: meeting_rooms_created_by_fkey (0052) = % — ky vong 1 (khong dong vao FK di san)', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables)
     AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass
     AND c.conname <> 'meeting_rooms_created_by_fkey';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0552] verify: con % FK MOT COT ngoai companies tren bang ROOM — phai composite', v_n;
  END IF;

  -- (4) UNIQUE (company_id, id) trên 2 bảng ĐÍCH nội bộ
  FOREACH t IN ARRAY ARRAY['meeting_rooms', 'room_bookings'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0552] verify: % thieu UNIQUE (company_id, id) (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (5) Cột meeting_rooms sau ALTER: is_virtual biến mất; capacity NOT NULL; 8 cột mới; CHECK còn sau DROP COLUMN.
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'meeting_rooms'::regclass AND attname = 'is_virtual' AND NOT attisdropped) THEN
    RAISE EXCEPTION '[0552] verify: meeting_rooms.is_virtual van con';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'meeting_rooms'::regclass AND attname = 'capacity' AND attnotnull) THEN
    RAISE EXCEPTION '[0552] verify: meeting_rooms.capacity chua NOT NULL';
  END IF;
  FOREACH t IN ARRAY ARRAY['equipment', 'description', 'requires_approval', 'is_active', 'sort_order',
                           'updated_at', 'updated_by', 'deleted_by'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'meeting_rooms'::regclass AND attname = t AND NOT attisdropped) THEN
      RAISE EXCEPTION '[0552] verify: meeting_rooms thieu cot %', t;
    END IF;
  END LOOP;
  FOR r IN SELECT * FROM (VALUES
      ('meeting_rooms', 'chk_meeting_rooms_capacity'),
      ('room_bookings', 'chk_room_bookings_status'),
      ('room_bookings', 'chk_room_bookings_time_order'),
      ('room_bookings', 'chk_room_bookings_cancel_pair')
    ) AS v(tbl, con)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = r.tbl::regclass AND contype = 'c' AND conname = r.con) THEN
      RAISE EXCEPTION '[0552] verify: CHECK % khong ton tai tren % (drop-column-silently-drops-check?)', r.con, r.tbl;
    END IF;
  END LOOP;

  -- (6) INDEX/EXCLUDE: predicate so ĐÚNG CHUỖI pg_get_expr (chép từ lane mediaos_roomdb1)
  FOR r IN SELECT * FROM (VALUES
      ('uq_meeting_rooms_company_name_active',     true,  '(deleted_at IS NULL)'),
      ('uq_room_booking_attendees_booking_user',   true,  NULL),
      ('idx_room_bookings_room_start',             false, '((status)::text = ''Confirmed''::text)')
    ) AS v(idx, uniq, pred)
  LOOP
    SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
      FROM pg_index i WHERE i.indexrelid = r.idx::regclass AND i.indisunique = r.uniq;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[0552] verify: index % khong ton tai hoac sai unique', r.idx;
    END IF;
    IF v_pred IS DISTINCT FROM r.pred THEN
      RAISE EXCEPTION '[0552] verify: predicate cua % = % — ky vong %', r.idx, COALESCE(v_pred, '<NULL>'), COALESCE(r.pred, '<NULL>');
    END IF;
  END LOOP;
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint WHERE conrelid = 'room_bookings'::regclass AND contype = 'x' AND conname = 'room_bookings_no_overlap_excl';
  IF v_def IS NULL OR v_def NOT LIKE '%gist%' OR v_def NOT LIKE '%''Confirmed''%' OR v_def NOT LIKE '%''[)''%' THEN
    RAISE EXCEPTION '[0552] verify: EXCLUDE room_bookings_no_overlap_excl thieu/lech: %', COALESCE(v_def, '<NULL>');
  END IF;
  FOREACH t IN ARRAY ARRAY['idx_meeting_rooms_company_active', 'meeting_rooms_company_idx', 'idx_room_bookings_company_start',
                           'idx_room_bookings_organizer', 'idx_room_booking_attendees_user'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '[0552] verify: index thuong % khong ton tai', t;
    END IF;
  END LOOP;
  IF to_regclass('meeting_rooms_active_idx') IS NOT NULL THEN
    RAISE EXCEPTION '[0552] verify: meeting_rooms_active_idx (0052) van con — phai thay bang idx_meeting_rooms_company_active';
  END IF;

  RAISE NOTICE '[0552] verify PASS: 3 bang RLS+FORCE · ACL app/worker dung khuon · 10 composite FK · EXCLUDE gist · meeting_rooms ALTER xong';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy). Thứ tự con → cha.
-- DROP TABLE IF EXISTS room_booking_attendees;
-- DROP TABLE IF EXISTS room_bookings;
-- ALTER TABLE meeting_rooms DROP CONSTRAINT IF EXISTS chk_meeting_rooms_capacity,
--   DROP CONSTRAINT IF EXISTS meeting_rooms_updated_by_tenant_fk, DROP CONSTRAINT IF EXISTS meeting_rooms_deleted_by_tenant_fk;
-- DROP INDEX IF EXISTS uq_meeting_rooms_company_name_active; DROP INDEX IF EXISTS idx_meeting_rooms_company_active;
-- ALTER TABLE meeting_rooms ALTER COLUMN capacity DROP NOT NULL, ADD COLUMN is_virtual boolean NOT NULL DEFAULT false,
--   DROP COLUMN equipment, DROP COLUMN description, DROP COLUMN requires_approval, DROP COLUMN is_active,
--   DROP COLUMN sort_order, DROP COLUMN updated_at, DROP COLUMN updated_by, DROP COLUMN deleted_by;
-- REVOKE SELECT ON meeting_rooms FROM mediaos_worker;
-- -- + khôi phục schema/meeting.ts, cleanupTenants, rls-registry cùng lúc.
