-- Migration 0546: S7-CALL-DB-1 (🔴 RED, zone=red, crown) — NỀN DỮ LIỆU CUỘC GỌI
--   Tạo `chat_calls` + `chat_call_participants` (company_id + RLS FORCE + APPEND-ONLY),
--   seed cặp quyền ('call','chat-room'), UNION-ADD 'chat_call' vào CHECK audit_logs.object_type.
--
-- CĂN CỨ: `docs/DECISIONS/DECISIONS-07_Chat_Call_Signalling.md` §7 **ĐÃ KÝ 08/08/2026** (3/3 ô).
--   Trước chữ ký, ADR ở trạng thái 🟡 và CẤM mọi WO `S7-CALL-*` khởi động — migration này không được
--   phép tồn tại. SPEC-15 §5.1c · §11 · §12 · §15a · §22b (CHAT-DEC-020) là nguồn chuẩn nghiệp vụ.
--
-- BẤT BIẾN (CLAUDE.md §2):
--   #1 company_id/RLS: hai bảng MỚI ⇒ ENABLE + FORCE + policy 2 vế `tenant_isolation` TẠO TRƯỚC mọi
--      lối ghi (CLAUDE.md §3). Bảng sinh ra RỖNG nên không có backfill, nhưng GIỮ ĐÚNG THỨ TỰ để khuôn
--      không bị sao chép sai ở lane sau. Composite tenant FK là LỚP THỨ HAI — khối (A)/(B).
--   #2 append-only: `chat_calls` + `chat_call_participants` là LỊCH SỬ CUỘC GỌI ⇒ app role KHÔNG có
--      DELETE, KHÔNG có UPDATE cấp bảng. Chỉ COLUMN-GRANT đúng các cột vòng đời (mẫu `0050` pinned_at,
--      `0543` avatar_file_id). Xem khối (D) và cảnh báo thứ tự REVOKE/GRANT trong đó.
--   #3 không secret: migration này không chạm secret nào. Credential TURN của `CHAT-API-029` sống ở
--      ENV (`CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN`), KHÔNG vào DB, KHÔNG vào bảng nào.
--
-- ⚠️ FK COMPOSITE, KHÔNG PHẢI MỘT-VẾ (memory `new-fk-column-needs-composite-tenant-fk`):
--   `(company_id, room_id) → chat_rooms(company_id, id)` và `(company_id, user_id) → users(company_id, id)`.
--   FK một-cột `room_id → chat_rooms(id)` cho phép một hàng trỏ sang phòng của tenant KHÁC ⇒ mở lại
--   KI-046 và làm `xtenant-fk-ratchet.int-spec.ts` ca (a) ĐỎ trên CI. `chat_rooms` đã có
--   `(company_id,id)` UNIQUE từ trước; `users` cũng có (đo ở 0538 tiền kiểm). `chat_calls` tự khai
--   `(company_id, id)` UNIQUE để làm ĐÍCH cho FK composite của `chat_call_participants`.
--
-- ⚠️ ON DELETE **RESTRICT** cho mọi FK trỏ `users` VÀ `chat_rooms` — KHÔNG phải CASCADE.
--   Đây là lựa chọn của `0540` (khối D) và lý do nguyên văn của nó áp đúng vào đây: CASCADE chạy ở
--   TẦNG OWNER và **bỏ qua mọi GRANT**, nên một `DELETE FROM users` hay `DELETE FROM chat_rooms`
--   (script dọn, migration sau, teardown test) sẽ XOÁ CỨNG lịch sử cuộc gọi append-only — đúng thứ
--   bất biến #2 dựng column-GRANT để chặn. RESTRICT kiểm NGAY (khác NO ACTION vốn hoãn tới cuối câu
--   lệnh, cho `DELETE users; INSERT users;` cùng tx lọt qua).
--   ⇒ `cleanupTenants` (test/helpers/seed.ts) PHẢI xoá `chat_call_participants` → `chat_calls` TRƯỚC
--      `chat_rooms` (599-601) và trước `DELETE FROM users`. Đã bổ sung CÙNG COMMIT.
--
-- ⚠️ `mediaos_worker` = 0 quyền trên hai bảng này (giữ least-privilege của `0540`:56 / `0543`:177).
--   ĐÃ ĐO, không suy đoán: job đối soát của CHAT (`chat-derived-rooms-reconcile.job-handler.ts`:67-109)
--   đi qua `DatabaseService.withTenant` ⇒ chạy bằng **`mediaos_app`**, không phải `mediaos_worker`.
--   Job quét `ringing` quá hạn → `missed` của `S7-CALL-BE-1` dùng cùng khuôn `@SystemJobHandler` ⇒ cũng
--   là `mediaos_app` ⇒ column-GRANT ở khối (D) đã phủ. Cấp cho worker ở đây là nới quyền cho một đường
--   KHÔNG AI đi. Nếu BE-1 đổi sang `workerDb` thì phải cấp tường minh — nếu không job **im lặng không
--   chạy**, đúng lỗ `mv-dashboard-refresh-path-dead` (worker thiếu quyền REFRESH, 0 cron, không ai biết).
--
-- BAND 0546 (lane S7-CALL-DB-1). Journal: idx 213, when 1717587335000 (> 0545 idx 212 / 1717587334000).
--   ⚠️ Migration KHÔNG có trong `meta/_journal.json` sẽ bị BỎ QUA IM LẶNG mà migrator vẫn in "applied"
--      + exit 0 (memory `migration-not-in-journal-is-silently-skipped`) ⇒ phải ĐO LẠI SCHEMA sau khi áp.
--   AUDIT_OBJECT_TYPES (src/db/schema/audit.ts) sync 'chat_call' CÙNG COMMIT.
--   ⚠ 0509/0528/0545 cũng UNION-ADD vào CHECK audit_logs.object_type — cả bốn GIAO HOÁN (mỗi cái đọc
--     def THẬT từ pg_constraint rồi cộng dồn, không dựng lại từ snapshot TS).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ═══════════════ (0) PREFLIGHT — đích của FK composite phải CÓ TRƯỚC (mẫu 0543 khối 0) ═══════════════
-- Fail-loud thay vì để `ADD CONSTRAINT ... REFERENCES x(company_id, id)` ném lỗi PG khó đọc. Cả hai
-- unique này long-standing (chat_rooms từ 0542, users từ 0533) nên khối này là phòng-thủ-chiều-sâu,
-- KHÔNG phải nghi ngờ — nhưng nếu lane nào áp thiếu band thì đây là chỗ nói ra, không phải chỗ đoán.
DO $$
DECLARE v_missing text[] := ARRAY[]::text[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'chat_rooms'::regclass AND contype = 'u'
                    AND conkey = ARRAY[
                      (SELECT attnum FROM pg_attribute WHERE attrelid='chat_rooms'::regclass AND attname='company_id'),
                      (SELECT attnum FROM pg_attribute WHERE attrelid='chat_rooms'::regclass AND attname='id')
                    ]::smallint[]) THEN
    v_missing := v_missing || 'chat_rooms(company_id,id)';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'users'::regclass AND contype = 'u'
                    AND conkey = ARRAY[
                      (SELECT attnum FROM pg_attribute WHERE attrelid='users'::regclass AND attname='company_id'),
                      (SELECT attnum FROM pg_attribute WHERE attrelid='users'::regclass AND attname='id')
                    ]::smallint[]) THEN
    v_missing := v_missing || 'users(company_id,id)';
  END IF;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0546] thieu UNIQUE dich cho FK composite: % — band truoc chua ap du',
      array_to_string(v_missing, ', ');
  END IF;
END;
$$;
--> statement-breakpoint

-- ═══════════════ (A) chat_calls — LỊCH SỬ CUỘC GỌI, APPEND-ONLY ═══════════════
-- Cột vòng đời theo `done_when` của WO: company_id · room_id · initiator_user_id · kind · status ·
-- started_at · accepted_at · ended_at.
--
-- ⚠️ KHÔNG có `deleted_at`. Đây là bảng LEDGER (nhóm append-only của BẤT BIẾN #2, cùng họ
--    `attendance_logs` / `leave_balance_transactions`), không phải bảng nghiệp vụ soft-delete. Thêm
--    `deleted_at` sẽ tạo ảo giác "xoá được cuộc gọi" trong khi app role không có DELETE.
CREATE TABLE chat_calls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ⚠️ DEFAULT theo GUC là KHUÔN CHUNG của mọi bảng tenant. Thiếu nó thì `withTenant` +
  --    `insert(...).values({roomId, ...})` của drizzle BỎ QUA cột company_id (schema khai
  --    `.default(currentCompanyDefault)` = "DB tự điền") ⇒ 23502 lúc chạy ở BE-1.
  company_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
             REFERENCES companies(id) ON DELETE CASCADE,
  room_id           uuid NOT NULL,
  initiator_user_id uuid NOT NULL,
  kind              varchar(10) NOT NULL,
  status            varchar(16) NOT NULL DEFAULT 'ringing',
  started_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at       timestamptz,
  ended_at          timestamptz,

  -- ĐÍCH cho FK composite của chat_call_participants (khối B).
  CONSTRAINT chat_calls_company_id_id_uq UNIQUE (company_id, id),

  CONSTRAINT chat_calls_room_id_company_fk
    FOREIGN KEY (company_id, room_id) REFERENCES chat_rooms (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chat_calls_initiator_user_id_company_fk
    FOREIGN KEY (company_id, initiator_user_id) REFERENCES users (company_id, id)
    ON DELETE RESTRICT,

  -- Bộ giá trị ĐÓNG, ép ở DB chứ không chỉ ở Zod (cùng lý lẽ bộ emoji của 0543).
  -- ⚠️ Hai bộ này sống ở HAI chỗ (CHECK đây + Zod ở packages/contracts/src/chat-call.ts). Thêm giá trị
  --    phải sửa CẢ HAI, và CHECK chỉ được NỚI bằng migration mới — không rewrite tại chỗ.
  CONSTRAINT chat_calls_kind_chk   CHECK (kind IN ('audio', 'video')),
  CONSTRAINT chat_calls_status_chk CHECK (status IN ('ringing', 'active', 'ended', 'rejected', 'cancelled', 'missed')),

  -- ⚠️ BA CHECK NÀY ÉP TÍNH NHẤT QUÁN *TRONG MỘT HÀNG*, **KHÔNG** ÉP CHUYỂN TIẾP.
  --    Bản đầu của file này ghi "FSM MỘT CHIỀU, ép ở DB" — SAI, và đã đo được là sai: một hàng
  --    `status='ended'` UPDATE ngược về `'ringing'` **lọt qua cả ba** (vì `ringing` không bị vế nào
  --    ràng buộc), `ended_at` giữ nguyên ⇒ hàng tự mâu thuẫn VÀ quay lại chiếm chỗ "cuộc gọi sống"
  --    của `chat_calls_one_live_per_room_uq`. Vế CHUYỂN TIẾP do TRIGGER ở khối (A3) ép — xem ở đó.
  --    Ghi rõ ranh giới này để `S7-CALL-BE-1` không đọc nhầm là DB đã lo hết rồi bỏ kiểm ở service.
  CONSTRAINT chat_calls_accepted_at_chk
    CHECK ((status = 'active' AND accepted_at IS NOT NULL) OR status <> 'active'),
  CONSTRAINT chat_calls_ended_at_chk
    CHECK ((status IN ('ended', 'rejected', 'cancelled', 'missed') AND ended_at IS NOT NULL)
           OR status NOT IN ('ended', 'rejected', 'cancelled', 'missed')),
  -- Cuộc gọi ĐANG ĐỔ CHUÔNG chưa từng được nhận và chưa kết thúc. Thiếu vế này thì một hàng
  -- `ringing` mang sẵn `ended_at` vẫn INSERT được (trigger (A3) chỉ chặn UPDATE, không chặn INSERT).
  CONSTRAINT chat_calls_ringing_clean_chk
    CHECK (status <> 'ringing' OR (accepted_at IS NULL AND ended_at IS NULL))
);
--> statement-breakpoint

-- ── RLS TRƯỚC mọi lối ghi (CLAUDE.md §3) — khuôn literal-GUC của 0479/0495/0504/0543 ──
ALTER TABLE chat_calls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_calls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON chat_calls;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON chat_calls
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ═══════════════ (A3) FSM MỘT CHIỀU — ép CHUYỂN TIẾP bằng TRIGGER ═══════════════
-- SPEC-15 CHAT-ERR-029 (422): cuộc gọi đã kết thúc KHÔNG hồi sinh.
--
-- ⚠️ VÌ SAO PHẢI LÀ TRIGGER, KHÔNG PHẢI CHECK. CHECK chỉ nhìn được MỘT hàng ở MỘT thời điểm — nó
--    không biết giá trị CŨ, nên không diễn đạt được "không được đi ngược". Đo thật trước khi thêm
--    trigger này: `UPDATE chat_calls SET status='ringing'` trên hàng `ended` **thành công**, cả ba
--    CHECK đều thoả. Hệ quả không chỉ là dữ liệu xấu: hàng hồi sinh **quay lại tập "sống"** của
--    partial unique index ⇒ phòng bị một cuộc gọi ma chiếm chỗ, mọi lời mời sau đó 409 vĩnh viễn.
--
-- ⚠️ VÌ SAO KHÔNG ĐỂ SERVICE LO. `GRANT UPDATE (status, accepted_at, ended_at)` là đường ghi THẬT;
--    bất kỳ writer nào (service hôm nay, job quét `missed` ngày mai, script vá tay) đều đi qua nó.
--    Ép ở DB là chỗ DUY NHẤT phủ được cả ba. Service VẪN phải trả 422 cho người dùng — trigger là
--    lưới cuối, không phải thứ thay cho kiểm ở tầng ứng dụng.
--
-- ERRCODE 23514 (check_violation) cố ý: BE-1 ánh xạ nó sang CHAT-ERR-029 → 422, cùng họ với các CHECK.
CREATE OR REPLACE FUNCTION chat_calls_forbid_revive() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Trạng thái KẾT THÚC là hấp thụ: ra khỏi nó bằng bất kỳ đường nào đều bị chặn.
  IF OLD.status IN ('ended', 'rejected', 'cancelled', 'missed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION
      '[chat_calls] cuoc goi da ket thuc (%) khong duoc chuyen sang % — FSM mot chieu (CHAT-ERR-029)',
      OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;

  -- Đã nối máy thì không quay lại đổ chuông.
  IF OLD.status = 'active' AND NEW.status = 'ringing' THEN
    RAISE EXCEPTION
      '[chat_calls] khong duoc lui active -> ringing — FSM mot chieu (CHAT-ERR-029)'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER chat_calls_forbid_revive_trg
  BEFORE UPDATE ON chat_calls
  FOR EACH ROW EXECUTE FUNCTION chat_calls_forbid_revive();
--> statement-breakpoint

-- ═══════════════ (A2) MỘT cuộc gọi SỐNG trên mỗi phòng — ép ở DB, không chỉ ở service ═══════════════
-- SPEC-15 CHAT-ERR-028 (409). Ép bằng PARTIAL UNIQUE INDEX chứ không bằng kiểm-rồi-ghi ở tầng ứng dụng:
-- hai lời mời đồng thời cùng đọc "chưa có cuộc gọi nào" rồi cùng INSERT — kiểm ở service KHÔNG chặn được
-- đường đua đó, chỉ ràng buộc DB mới chặn.
--
-- ⚠️ KHÔNG có vế `deleted_at IS NULL` ở đây và ĐÓ LÀ ĐÚNG (khác bẫy `partial-unique-index-makes-join-duplicate`):
--    bảng này cố ý không có cột `deleted_at` (xem khối A). Vị từ sống/chết đã nằm trọn trong `status`.
CREATE UNIQUE INDEX chat_calls_one_live_per_room_uq
  ON chat_calls (company_id, room_id)
  WHERE status IN ('ringing', 'active');
--> statement-breakpoint

-- Đường đọc "cuộc gọi của phòng, mới nhất trước" + đường quét job `ringing` quá hạn.
-- KHÔNG tạo index `(company_id, room_id)` trần: nó là TIỀN TỐ CHẶT của `chat_calls_room_started_idx`
-- NGAY DƯỚI ĐÂY (3 cột, KHÔNG partial) — bài học 0541 về index trùng.
-- ⚠️ KHÔNG phải tiền tố của `chat_calls_one_live_per_room_uq`: index đó **partial**
--    (`WHERE status IN ('ringing','active')`) nên KHÔNG phục vụ được truy vấn mọi-trạng-thái. Đừng
--    đọc nhầm nó là đã phủ đường đọc chung.
CREATE INDEX chat_calls_room_started_idx
  ON chat_calls (company_id, room_id, started_at DESC);
--> statement-breakpoint
CREATE INDEX chat_calls_status_started_idx
  ON chat_calls (company_id, status, started_at);
--> statement-breakpoint

-- ═══════════════ (B) chat_call_participants — AI ĐƯỢC MỜI / AI ĐÃ VÀO ═══════════════
-- Vế `outcome` NULL = còn đang đổ chuông, chưa ngã ngũ.
CREATE TABLE chat_call_participants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
             REFERENCES companies(id) ON DELETE CASCADE,
  call_id     uuid NOT NULL,
  user_id     uuid NOT NULL,
  invited_at  timestamptz NOT NULL DEFAULT now(),
  joined_at   timestamptz,
  left_at     timestamptz,
  outcome     varchar(16),

  CONSTRAINT chat_call_participants_uq UNIQUE (company_id, call_id, user_id),

  CONSTRAINT chat_call_participants_call_id_company_fk
    FOREIGN KEY (company_id, call_id) REFERENCES chat_calls (company_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT chat_call_participants_user_id_company_fk
    FOREIGN KEY (company_id, user_id) REFERENCES users (company_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT chat_call_participants_outcome_chk
    CHECK (outcome IS NULL OR outcome IN ('accepted', 'rejected', 'missed', 'cancelled', 'left'))
);
--> statement-breakpoint

ALTER TABLE chat_call_participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_call_participants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON chat_call_participants;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON chat_call_participants
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- Đường đọc "tôi có đang được gọi không" (chuông đến, CHAT-SCREEN-009).
CREATE INDEX chat_call_participants_user_idx
  ON chat_call_participants (company_id, user_id, invited_at DESC);
--> statement-breakpoint

-- ═══════════════ (C) GRANT — APPEND-ONLY, CHỈ COLUMN-GRANT CHO CỘT VÒNG ĐỜI ═══════════════
-- ⚠️ THỨ TỰ VÀ HÌNH DẠNG LÀ BẤT BIẾN #2, KHÔNG PHẢI SỞ THÍCH:
--    • KHÔNG `GRANT DELETE` — lịch sử cuộc gọi không được xoá qua app role.
--    • KHÔNG `GRANT UPDATE` CẤP BẢNG — chỉ đúng các cột vòng đời, mẫu `0050` (pinned_at) / `0543`.
--    • TUYỆT ĐỐI KHÔNG chữa bằng `REVOKE UPDATE ON <bảng>` ở migration sau: Postgres cuốn theo
--      MỌI column-GRANT của chính bảng đó, để lại bảng KHÔNG CỘT NÀO ghi được, VĨNH VIỄN
--      (memory `revoke-table-grant-wipes-column-grants` — đã cắn thật ở 0540).
--    Hai bảng này MỚI TINH ⇒ chưa có ACL cấp bảng nào để phải REVOKE trước; chỉ cần KHÔNG cấp.
GRANT SELECT, INSERT ON chat_calls TO mediaos_app;
--> statement-breakpoint
-- Vòng đời: ringing → active (accepted_at) → ended/rejected/cancelled/missed (ended_at).
-- `room_id` · `initiator_user_id` · `kind` · `started_at` KHÔNG nằm trong danh sách: sửa được chúng là
-- viết lại lịch sử một cuộc gọi đã xảy ra.
GRANT UPDATE (status, accepted_at, ended_at) ON chat_calls TO mediaos_app;
--> statement-breakpoint

GRANT SELECT, INSERT ON chat_call_participants TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (joined_at, left_at, outcome) ON chat_call_participants TO mediaos_app;
--> statement-breakpoint

-- ═══════════════ (D) SEED cặp quyền ('call','chat-room') ═══════════════
-- SPEC-15 §11: `is_sensitive = false`, grant cho role canonical như 9 cặp CHAT thường.
-- ⚠️ Khác wave S8 (0 cặp mới) — wave này CÓ cặp mới ⇒ CÓ rủi ro `canonical-seed-pin-regression`.
--    Pin `auth-seed-canonical-roles.int-spec.ts` cập nhật CÙNG COMMIT (REQUIRED_CATALOG).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('call', 'chat-room', false)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant per-pair cho 4 role canonical — mirror khuôn 0538 (resolve role THEO THUỘC TÍNH, không hard-code id).
-- data_scope: SPEC-15 §11 ghi 'all' cho cặp này; 'all' KHÔNG phải giá trị hợp lệ (chỉ
-- Own/Team/Department/Company/System) ⇒ ánh xạ 'all' → 'Company', đúng như 9 cặp CHAT ở 0538.
DO $$
DECLARE
  v_role_id uuid;
  v_perm_id uuid;
  v_role    text;
BEGIN
  SELECT id INTO v_perm_id FROM permissions WHERE action = 'call' AND resource_type = 'chat-room';
  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION '[0546] permission (call:chat-room) khong co trong catalog — khoi INSERT phai chay truoc';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['employee', 'manager', 'hr', 'company-admin'] LOOP
    SELECT id INTO v_role_id FROM roles
     WHERE name = v_role AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0546] role canonical % khong ton tai — seed 0005/0444 phai chay truoc', v_role;
    END IF;

    -- DELETE-wrong-scope + INSERT ON CONFLICT: idempotent, chống drift scope khi chạy lại.
    DELETE FROM role_permissions
     WHERE role_id = v_role_id AND permission_id = v_perm_id AND effect = 'ALLOW' AND data_scope <> 'Company';
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', 'Company')
    ON CONFLICT DO NOTHING;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Role "giữ TOÀN BỘ catalog" (SA và tương đương) cũng phải nhận cặp mới — mirror khuôn 0538:508-560.
-- Không làm bước này thì SA mất cặp `call` trong khi giữ đủ 10 cặp CHAT còn lại ⇒ lỗ quyền im lặng.
DO $$
DECLARE
  v_non_chat int;
  v_role     record;
  v_scope    text;
  v_perm_id  uuid;
  v_found    int := 0;
BEGIN
  SELECT id INTO v_perm_id FROM permissions WHERE action = 'call' AND resource_type = 'chat-room';

  SELECT count(*) INTO v_non_chat FROM permissions
   WHERE resource_type NOT IN ('chat', 'chat-room', 'chat-member', 'chat-message', 'chat-oversight');

  -- Chặn suy biến: catalog rỗng ⇒ MỌI role "giữ đủ 0 cặp" ⇒ cấp bừa cho tất cả (bẫy 0538 đã dựng).
  IF v_non_chat = 0 THEN
    RAISE EXCEPTION '[0546] catalog ngoai CHAT rong — abort (luat "giu toan bo catalog" se khop moi role)';
  END IF;

  FOR v_role IN
    SELECT r2.id, r2.name
      FROM roles r2
     WHERE r2.deleted_at IS NULL
       AND (SELECT count(DISTINCT rp.permission_id)
              FROM role_permissions rp
              JOIN permissions p ON p.id = rp.permission_id
             WHERE rp.role_id = r2.id AND rp.effect = 'ALLOW'
               AND p.resource_type NOT IN ('chat','chat-room','chat-member','chat-message','chat-oversight')
           ) = v_non_chat
  LOOP
    v_found := v_found + 1;

    SELECT rp.data_scope INTO v_scope
      FROM role_permissions rp
     WHERE rp.role_id = v_role.id AND rp.effect = 'ALLOW'
     GROUP BY rp.data_scope
     ORDER BY count(*) DESC
     LIMIT 1;

    DELETE FROM role_permissions
     WHERE role_id = v_role.id AND permission_id = v_perm_id AND effect = 'ALLOW' AND data_scope <> v_scope;
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role.id, v_perm_id, 'ALLOW', v_scope)
    ON CONFLICT DO NOTHING;
  END LOOP;

  RAISE NOTICE '[0546] cap (call:chat-room) cho % role giu-toan-bo-catalog', v_found;
END;
$$;
--> statement-breakpoint

-- ═══════════════ (E) audit_logs.object_type UNION-ADD 'chat_call' ═══════════════
-- Clone 0545 (bản đã NEO 2 TẦNG). Đọc tập giá trị TỪ pg_constraint THẬT rồi CỘNG DỒN — TUYỆT ĐỐI
-- KHÔNG dựng lại CHECK từ snapshot TS/file (canary 'defect' chỉ có ở DB — 0086 — sẽ mất ⇒ audit cũ vỡ 23514).
-- NEO 2 TẦNG (memory `audit-check-union-parse-anchor-trap`): parse NEO vào vế `object_type = ANY (…)`,
-- KHÔNG quét `{…}`/`ARRAY[…]` trên CẢ constraintdef — nếu không thì vế phủ định `other <> ALL('{ghost}')`
-- đứng trước bị hút nhầm và cả NO-LOSS lẫn NO-GAIN đều PASS-OAN vì tính trên tập đã parse SAI.
DO $$
DECLARE
  v_oid     oid;
  v_con     text;
  v_def     text;
  v_raw     text;
  v_matched boolean := false;
  v_cnt     int;
  v_cur     text[];
  v_new     text[] := ARRAY['chat_call'];
  v_add     text[];
  v_union   text[];
  v_after   text[];
  v_missing text[];
  v_extra   text[];
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname = 'audit_logs_object_type_chk';

  IF v_oid IS NULL THEN
    SELECT count(*) INTO v_cnt
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';

    IF v_cnt <> 1 THEN
      RAISE EXCEPTION '[0546] khong xac dinh duoc CHECK object_type tren audit_logs (so match = %) — DUNG fail-closed', v_cnt;
    END IF;

    SELECT oid, conname INTO v_oid, v_con
      FROM pg_constraint
     WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
       AND conname LIKE '%object_type%';
  END IF;

  v_def := pg_get_constraintdef(v_oid);

  v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''');
  IF v_raw IS NOT NULL THEN
    v_cur := v_raw::text[];
    v_matched := true;
  ELSE
    v_raw := substring(v_def FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*(ARRAY\[[^]]*\])');
    IF v_raw IS NOT NULL THEN
      SELECT array_agg(m[1]) INTO v_cur
        FROM (
          SELECT regexp_matches(v_raw, '''([^'']+)''', 'g') AS m
        ) sub;
      v_matched := v_cur IS NOT NULL;
    END IF;
  END IF;

  IF NOT v_matched OR v_cur IS NULL THEN
    RAISE EXCEPTION '[0546] khong parse duoc allow-list cua object_type = ANY(...) cho % : % — DUNG fail-closed', v_con, v_def;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) IS NULL THEN
    RAISE NOTICE '[0546] chat_call da co trong CHECK — idempotent skip';
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  IF NOT (v_union @> v_cur) THEN
    RAISE EXCEPTION '[0546] union danh mat gia tri cu — DUNG (bat bien #2 append-only)';
  END IF;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );

  SELECT substring(pg_get_constraintdef(oid) FROM 'object_type[[:space:]]*=[[:space:]]*ANY[[:space:]]*\([[:space:]]*''(\{[^}]*\})''')::text[]
    INTO v_after
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c' AND conname = v_con;

  SELECT array_agg(t) INTO v_missing
    FROM unnest(v_cur || v_new) AS t
   WHERE v_after IS NULL OR NOT (v_after @> ARRAY[t]);

  IF v_missing IS NOT NULL AND array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION '[0546] verify NO-LOSS that bai — CHECK thieu: %', array_to_string(v_missing, ', ');
  END IF;

  SELECT array_agg(t) INTO v_extra
    FROM unnest(COALESCE(v_after, ARRAY[]::text[])) AS t
   WHERE NOT ((v_cur || v_new) @> ARRAY[t]);

  IF v_extra IS NOT NULL AND array_length(v_extra, 1) > 0 THEN
    RAISE EXCEPTION '[0546] verify NO-GAIN that bai — CHECK phinh them: %', array_to_string(v_extra, ', ');
  END IF;

  RAISE NOTICE '[0546] da them % vao CHECK object_type cua audit_logs (tong % gia tri)',
    array_to_string(v_add, ', '), array_length(v_after, 1);
END;
$$;
--> statement-breakpoint

-- ═══════════════ (F) VERIFY FAIL-LOUD ═══════════════
-- Migration tự chứng minh mình đã làm đúng thứ nó nói. Đo bằng catalog THẬT, không tin câu lệnh ở trên
-- đã chạy: `has_table_privilege` chỉ trả `t` cho quyền CẤP BẢNG — column-GRANT KHÔNG làm nó `t`, nên nó
-- đúng là primitive để chứng minh vế "không có UPDATE/DELETE cấp bảng" (đối chứng 0540:148).
DO $$
DECLARE
  v_tbl      text;
  v_relrls   boolean;
  v_relforce boolean;
  v_pol      int;
  v_cols     text[];
  v_fk       int;
  v_n        int;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY['chat_calls', 'chat_call_participants'] LOOP
    -- (1) RLS + FORCE + policy 2 vế
    SELECT relrowsecurity, relforcerowsecurity INTO v_relrls, v_relforce
      FROM pg_class WHERE oid = v_tbl::regclass;
    IF NOT v_relrls OR NOT v_relforce THEN
      RAISE EXCEPTION '[0546] % thieu RLS/FORCE (rls=%, force=%) — BAT BIEN #1', v_tbl, v_relrls, v_relforce;
    END IF;

    SELECT count(*) INTO v_pol FROM pg_policies
     WHERE schemaname = 'public' AND tablename = v_tbl AND policyname = 'tenant_isolation'
       AND qual IS NOT NULL AND with_check IS NOT NULL;
    IF v_pol <> 1 THEN
      RAISE EXCEPTION '[0546] % thieu policy tenant_isolation DU 2 VE USING+WITH CHECK (dem=%)', v_tbl, v_pol;
    END IF;

    -- (2) APPEND-ONLY: KHÔNG UPDATE/DELETE cấp bảng cho app role (BẤT BIẾN #2)
    IF has_table_privilege('mediaos_app', v_tbl, 'DELETE') THEN
      RAISE EXCEPTION '[0546] % CO quyen DELETE cap bang cho mediaos_app — BAT BIEN #2 append-only', v_tbl;
    END IF;
    IF has_table_privilege('mediaos_app', v_tbl, 'UPDATE') THEN
      RAISE EXCEPTION '[0546] % CO quyen UPDATE CAP BANG cho mediaos_app — chi duoc column-GRANT', v_tbl;
    END IF;
    IF NOT has_table_privilege('mediaos_app', v_tbl, 'SELECT')
       OR NOT has_table_privilege('mediaos_app', v_tbl, 'INSERT') THEN
      RAISE EXCEPTION '[0546] % thieu SELECT/INSERT cho mediaos_app', v_tbl;
    END IF;

    -- (3) mediaos_worker KHÔNG được cấp gì (least-privilege 0540/0543)
    IF has_table_privilege('mediaos_worker', v_tbl, 'SELECT')
       OR has_table_privilege('mediaos_worker', v_tbl, 'INSERT') THEN
      RAISE EXCEPTION '[0546] % da cap quyen cho mediaos_worker — ngoai y do (job chay bang mediaos_app)', v_tbl;
    END IF;
  END LOOP;

  -- (4) column-GRANT ĐÚNG CỘT — không thừa, không thiếu
  SELECT array_agg(column_name::text ORDER BY column_name) INTO v_cols
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'chat_calls'
     AND grantee = 'mediaos_app' AND privilege_type = 'UPDATE';
  IF v_cols IS DISTINCT FROM ARRAY['accepted_at','ended_at','status'] THEN
    RAISE EXCEPTION '[0546] chat_calls column-GRANT UPDATE lech: % (ky vong accepted_at,ended_at,status)',
      COALESCE(array_to_string(v_cols, ','), '<rong>');
  END IF;

  SELECT array_agg(column_name::text ORDER BY column_name) INTO v_cols
    FROM information_schema.column_privileges
   WHERE table_schema = 'public' AND table_name = 'chat_call_participants'
     AND grantee = 'mediaos_app' AND privilege_type = 'UPDATE';
  IF v_cols IS DISTINCT FROM ARRAY['joined_at','left_at','outcome'] THEN
    RAISE EXCEPTION '[0546] chat_call_participants column-GRANT UPDATE lech: % (ky vong joined_at,left_at,outcome)',
      COALESCE(array_to_string(v_cols, ','), '<rong>');
  END IF;

  -- (5) FK phải là COMPOSITE 2 CỘT (chống KI-046 + xtenant-fk-ratchet)
  SELECT count(*) INTO v_fk
    FROM pg_constraint
   WHERE contype = 'f'
     AND conname IN ('chat_calls_room_id_company_fk',
                     'chat_calls_initiator_user_id_company_fk',
                     'chat_call_participants_call_id_company_fk',
                     'chat_call_participants_user_id_company_fk')
     AND array_length(conkey, 1) = 2
     AND confdeltype = 'r';   -- 'r' = RESTRICT
  IF v_fk <> 4 THEN
    RAISE EXCEPTION '[0546] ky vong 4 FK composite 2-cot ON DELETE RESTRICT, dem duoc %', v_fk;
  END IF;

  -- (6) partial unique index MỘT cuộc gọi sống / phòng (CHAT-ERR-028)
  SELECT count(*) INTO v_n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'chat_calls'
     AND indexname = 'chat_calls_one_live_per_room_uq'
     AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%WHERE%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0546] thieu partial UNIQUE index chat_calls_one_live_per_room_uq (dem=%)', v_n;
  END IF;

  -- (7) cặp quyền đã seed, is_sensitive=false
  SELECT count(*) INTO v_n FROM permissions
   WHERE action = 'call' AND resource_type = 'chat-room' AND is_sensitive = false;
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0546] cap (call:chat-room) is_sensitive=false phai co dung 1 hang, dem=%', v_n;
  END IF;

  -- (8) 4 role canonical đều nhận cặp mới
  SELECT count(DISTINCT r.name) INTO v_n
    FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id AND rp.effect = 'ALLOW'
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'call' AND p.resource_type = 'chat-room'
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND r.name IN ('employee', 'manager', 'hr', 'company-admin');
  IF v_n <> 4 THEN
    RAISE EXCEPTION '[0546] ky vong 4 role canonical co (call:chat-room), dem duoc %', v_n;
  END IF;

  -- (9) 'chat_call' đã vào CHECK audit
  SELECT count(*) INTO v_n FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%chat_call%';
  IF v_n < 1 THEN
    RAISE EXCEPTION '[0546] chat_call chua vao CHECK object_type cua audit_logs';
  END IF;

  -- (10) TRIGGER chặn hồi sinh phải TỒN TẠI và ĐANG BẬT (khối A3).
  -- `tgenabled = 'O'` = bật ở chế độ origin thường. Trigger bị DISABLE vẫn nằm trong pg_trigger ⇒
  -- chỉ đếm sự tồn tại là PASS-oan cho đúng trạng thái nguy hiểm nhất.
  SELECT count(*) INTO v_n FROM pg_trigger
   WHERE tgrelid = 'chat_calls'::regclass
     AND tgname = 'chat_calls_forbid_revive_trg'
     AND NOT tgisinternal
     AND tgenabled = 'O';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0546] trigger chat_calls_forbid_revive_trg thieu hoac bi DISABLE (dem=%)', v_n;
  END IF;

  RAISE NOTICE '[0546] VERIFY OK: 2 bang RLS+FORCE+policy 2 ve · 0 UPDATE/DELETE cap bang · column-GRANT 3/3 khop · 4 FK composite RESTRICT · partial unique 1-cuoc-goi-song · trigger FSM mot chieu BAT · cap quyen seed + 4 role canonical · audit CHECK co chat_call';
END;
$$;

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- DROP TABLE chat_call_participants;   -- trước chat_calls (FK RESTRICT)
-- DROP TABLE chat_calls;
-- DELETE FROM role_permissions WHERE permission_id = (SELECT id FROM permissions WHERE action='call' AND resource_type='chat-room');
-- DELETE FROM permissions WHERE action='call' AND resource_type='chat-room';
-- ⚠️ KHÔNG gỡ 'chat_call' khỏi CHECK audit_logs.object_type: mọi hàng audit đã ghi giá trị đó sẽ vỡ
--    constraint (bất biến #2 append-only). Rollback phần audit = revert code S7-CALL-BE-1.
