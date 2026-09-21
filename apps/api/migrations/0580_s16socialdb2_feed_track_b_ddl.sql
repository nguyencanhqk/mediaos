-- Migration 0580: S16-SOCIAL-DB-2 (🔴 RED, zone=red, crown) — SOCIAL Track B (DB-17 §4/§7,
--   plan docs/plans/S16-SOCIAL-DB-2.md §4). BUILD 9 bảng MỚI + TRẢ NỢ 1 FK của Track A:
--   • feed_groups           — nhóm nội bộ (public/private), soft-delete, member_count denormalized.
--   • feed_group_members    — thành viên nhóm, PK tổ hợp; rời/mời-ra = DELETE CỨNG (DB-17 §4.9).
--   • feed_polls            — bình chọn 1-1 với bài type='poll'.
--   • feed_poll_options     — lựa chọn, BẤT BIẾN sau khi tạo poll (ép ở SERVICE).
--   • feed_poll_votes       — phiếu, PK tổ hợp + cột dẫn xuất `single_choice` (D1 — xem dưới).
--   • feed_ideas            — sáng kiến 1-1 với bài type='idea', FSM ép ở SERVICE.
--   • feed_kudos            — vinh danh 1-1 với bài type='kudos'.
--   • feed_kudos_recipients — người được vinh danh, PK tổ hợp.
--   • feed_kudos_badges     — CATALOG huy hiệu per-company (seed ở 0582).
--   + ALTER feed_posts ADD CONSTRAINT feed_posts_group_fk — nợ §0.2 của DB-1 (0577:41-46).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9) — khuôn NGUYÊN DẠNG 0577:
--   #1 company_id NOT NULL + DEFAULT literal-GUC + RLS ENABLE + FORCE + policy tenant_isolation
--      (USING + WITH CHECK) TẠO TRƯỚC mọi FK/GRANT/dữ liệu. MỌI FK chéo bảng nghiệp vụ là COMPOSITE
--      tenant FK (company_id, col) → parent (company_id, id) — KHÔNG FK một-cột nào ngoài
--      company_id → companies (FK Postgres KHÔNG áp RLS — KI-046).
--      VERIFY (3) dùng BẢNG TUPLE 21 DÒNG `EXCEPT` hai chiều, KHÔNG con số trần.
--   #2 KHÔNG hard-delete dữ liệu quan trọng: feed_groups soft-delete (deleted_at); feed_kudos_badges
--      là catalog ⇒ "xoá" = UPDATE is_active=false (KHÔNG có GRANT DELETE, KHÔNG có deleted_at).
--      feed_group_members / feed_poll_votes / feed_kudos_recipients CÓ DELETE có chủ ý (DB-17 §4.9:
--      rời nhóm · rút phiếu · gán lại người nhận) — vết nằm ở audit_logs, KHÔNG cột status='removed'.
--   #3 SOCIAL không lưu secret nào. feed_poll_votes.user_id lưu KỂ CẢ poll ẩn danh nhưng KHÔNG BAO
--      GIỜ ra DTO khi is_anonymous=true (SOC-DEC-009) — lưới ở tầng repository, ngoài phạm vi DB.
--   • RI action theo DB-17 §4.2b (bảng này THẮNG nếu §7.x mâu thuẫn):
--       · cột NOT NULL (chủ thể của hàng) → NO ACTION. SET NULL trên cột NOT NULL NỔ lúc DELETE.
--       · cột nullable "vết kiểm toán" (created_by/updated_by/deleted_by/reviewed_by) → SET NULL (<cột>)
--         — PHẢI liệt kê cột; SET NULL trần null LUÔN company_id (0535:682) ⇒ hàng rơi khỏi tenant.
--       · cột nullable "business FK" (avatar_file_id · employee_id · badge_id) → VẪN NO ACTION.
--     TUYỆT ĐỐI KHÔNG RESTRICT: cascade từ companies xoá bảng anh em theo thứ tự bất định ⇒ RESTRICT
--     nổ giữa chừng ⇒ cleanupTenants() chết (DB-17 §4.2b).
--   • KHÔNG TRIGGER (bẫy frozen-table-triggers-break-db-init): bộ đếm member_count/vote_count cập nhật
--     CÙNG TX ở service, như like_count/comment_count của Track A (DB-17 §4.7).
--   • DDL thủ công — KHÔNG db:generate (sẽ DROP schema media/finance đang park). schema/social.ts PARITY-only.
--
-- D1 — feed_poll_votes.single_choice (plan §2): cột dẫn xuất + partial unique
--   `feed_poll_votes_single_uq (company_id, poll_id, user_id) WHERE single_choice` là lớp phòng thủ DB
--   THẬT DUY NHẤT chống phiếu đôi ở poll một-lựa-chọn. Cột khai THẲNG trong CREATE TABLE (tương đương
--   ALTER ADD COLUMN của plan §2 D1 — bảng vừa tạo, 0 hàng ⇒ cùng một trạng thái cuối, ít hơn 1 câu).
--   ⚠️ CỐ Ý KHÔNG có DEFAULT: `DEFAULT false` biến một lần quên ghi của BE-2 thành vô hiệu hoá chốt
--   chống-phiếu-đôi IM LẶNG (fail-open). Không DEFAULT ⇒ hỏng thì hỏng ồn ào bằng 23502 (fail-closed).
--   Điều kiện đi kèm (nợ BE-2, plan §10): service ghi single_choice = NOT feed_polls.multiple_choice
--   CÙNG câu INSERT phiếu, và CHẶN UPDATE feed_polls.multiple_choice/is_anonymous sau khi poll tồn tại
--   — partial unique không đọc được bảng khác, đổi multiple_choice giữa chừng làm chốt SAI LỆCH IM LẶNG.
--   Cửa sổ DB-2 → BE-2 KHÔNG fail-open: module apps/api/src/social/** chưa tồn tại, 0 đường ghi.
--
-- CHECK MỚI ngoài DB-17 §7.3 (plan §0): `chk_feed_polls_closes_future` — done_when #1 của WO đòi
--   `closes_at > created_at`. Vế `closes_at IS NULL OR` KHÔNG vi phạm nullable-escape-clause-makes-check-
--   vacuous vì NULL là giá trị HỢP LỆ (poll không hạn) và CHECK có tác dụng thật khi có giá trị.
--   Ghi ngược vào DB-17 §7.3 cùng PR.
--
-- ⚠️ PHẠM VI CỦA VERIFY (3)/(3a) — chỗ dễ sai nhất của cả file (plan §4.10): feed_posts ĐÃ CÓ SẴN 6
--   composite FK từ 0577 và 0577:779 tự chốt = 26 cho 10 bảng Track A. Nếu tập `actual` lấy nguyên
--   feed_posts thì đo ra 27 chứ không phải 21 ⇒ EXCEPT báo 6 dòng "THỪA" của Track A ⇒ RAISE SAI ⇒
--   chặn migrate. Tập actual PHẢI thu hẹp về 9 bảng Track B ∪ conname='feed_posts_group_fk'
--   (invariant-count-must-filter-owned-rows).
--
-- BAND 0580 (lane S16-SOCIAL-DB-2). Journal: idx 247, when 1717587369000 (> 0579 idx 246 / 1717587368000).
--   Cùng commit: schema/social.ts (+9 bảng PARITY) · packages/contracts/src/social.ts ·
--   test/helpers/seed.ts cleanupTenants() (19 dòng, DỜI LÊN trước DELETE FROM file_access_logs vì
--   feed_groups.avatar_file_id → files) · test/integration/rls-registry.ts (+9 case) ·
--   foundation/retention/retention.service.ts PROTECTED_TABLES (+9 = 19/19) ·
--   BUMP ratchet s16-social-db1-invariants.int-spec.ts: 26 → 27 composite FK (feed_posts_group_fk).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (0) TIỀN KIỂM fail-loud ───────────────
DO $$
DECLARE
  t     text;
  v_n   int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- SET NULL (col) trên FK composite cần PG >= 15 (đã dùng ở 0535/0549/0559/0577 trên chính cụm này).
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '[0580] can PostgreSQL >= 15 cho ON DELETE SET NULL (col) — server_version_num = %',
      current_setting('server_version_num');
  END IF;

  -- Bảng ĐÍCH của composite FK phải có UNIQUE (company_id, id). KHÔNG tự tạo (thuộc lane khác):
  -- users (0533) · employee_profiles (0535) · files (0535) · feed_posts (0577).
  -- ⚠️ KHÔNG có bảng tên `employees` — HR là employee_profiles (DB-17 §4.2a).
  FOREACH t IN ARRAY ARRAY['users', 'employee_profiles', 'files', 'feed_posts'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '[0580] bang dich % khong ton tai — chuoi migration khong day du', t;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0580] % thieu UNIQUE (company_id, id) (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- 9 bảng chưa được tồn tại (đụng tên = có lane khác dựng song song — DỪNG).
  -- ⚠️ Đây là lý do 0580 chạy lại PHẢI RAISE — tính năng, không phải lỗi (khuôn 0577, plan §7 Nhóm 10).
  FOREACH t IN ARRAY ARRAY['feed_groups', 'feed_group_members', 'feed_polls', 'feed_poll_options',
                           'feed_poll_votes', 'feed_ideas', 'feed_kudos', 'feed_kudos_recipients',
                           'feed_kudos_badges'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      RAISE EXCEPTION '[0580] bang % DA TON TAI — dung ten voi lane khac, abort', t;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ─────────────── 1. feed_groups (DB-17 §7.1 — mutable, soft-delete) ───────────────
CREATE TABLE feed_groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  name            varchar(255) NOT NULL,
  description     text,
  visibility      varchar(16) NOT NULL,
  avatar_file_id  uuid,                                   -- business FK nullable ⇒ NO ACTION (§4.2b)
  member_count    integer NOT NULL DEFAULT 0,             -- denormalized, bump CÙNG TX ở service
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  CONSTRAINT chk_feed_groups_visibility   CHECK (visibility IN ('public', 'private')),
  CONSTRAINT chk_feed_groups_member_count CHECK (member_count >= 0),
  CONSTRAINT feed_groups_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_groups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_groups FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_groups;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_groups
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 2. feed_group_members (DB-17 §7.2 — PK tổ hợp, không cột id) ───────────────
CREATE TABLE feed_group_members (
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL,
  user_id      uuid NOT NULL,
  employee_id  uuid,                                      -- business FK nullable ⇒ NO ACTION (§4.2b)
  role         varchar(16) NOT NULL,
  status       varchar(16) NOT NULL DEFAULT 'pending',
  joined_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feed_group_members_role   CHECK (role   IN ('owner', 'admin', 'member')),
  CONSTRAINT chk_feed_group_members_status CHECK (status IN ('active', 'pending')),
  -- Yêu cầu chờ duyệt KHÔNG được mang vai trò quản trị (CHECK cặp dạng kéo theo).
  CONSTRAINT chk_feed_group_members_pending_role CHECK (status = 'active' OR role = 'member'),
  CONSTRAINT feed_group_members_pk PRIMARY KEY (company_id, group_id, user_id)
);
--> statement-breakpoint
ALTER TABLE feed_group_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_group_members FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_group_members;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_group_members
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 3. feed_polls (DB-17 §7.3 — 1-1 với bài type='poll') ───────────────
CREATE TABLE feed_polls (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL
                     DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                     REFERENCES companies(id) ON DELETE CASCADE,
  post_id          uuid NOT NULL,
  question         varchar(500) NOT NULL,
  multiple_choice  boolean NOT NULL DEFAULT false,        -- ⚠️ BẤT BIẾN sau khi tạo (nợ BE-2 — D1)
  is_anonymous     boolean NOT NULL DEFAULT false,        -- ⚠️ BẤT BIẾN sau khi tạo (nợ BE-2 — D1)
  status           varchar(16) NOT NULL DEFAULT 'open',
  closes_at        timestamptz,
  closed_at        timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feed_polls_status      CHECK (status IN ('open', 'closed')),
  CONSTRAINT chk_feed_polls_closed_pair CHECK (status = 'open' OR closed_at IS NOT NULL),
  -- MỚI (plan §0): hạn đóng phải ở TƯƠNG LAI so với lúc tạo. NULL = poll không hạn (hợp lệ).
  CONSTRAINT chk_feed_polls_closes_future CHECK (closes_at IS NULL OR closes_at > created_at),
  CONSTRAINT feed_polls_company_post_uq UNIQUE (company_id, post_id),
  CONSTRAINT feed_polls_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_polls ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_polls FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_polls;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_polls
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 4. feed_poll_options (DB-17 §7.4 — BẤT BIẾN sau khi tạo poll) ───────────────
-- Giới hạn 2-10 lựa chọn ép ở SERVICE (SOCIAL-ERR-018) — CHECK cấp hàng không đếm được hàng anh em.
CREATE TABLE feed_poll_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  poll_id     uuid NOT NULL,
  label       varchar(255) NOT NULL,
  position    smallint NOT NULL,
  vote_count  integer NOT NULL DEFAULT 0,                 -- denormalized, bump CÙNG TX ở service
  CONSTRAINT chk_feed_poll_options_vote_count CHECK (vote_count >= 0),
  CONSTRAINT feed_poll_options_company_id_id_uq UNIQUE (company_id, id),
  CONSTRAINT feed_poll_options_position_uq UNIQUE (company_id, poll_id, position)
);
--> statement-breakpoint
ALTER TABLE feed_poll_options ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_poll_options FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_poll_options;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_poll_options
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 5. feed_poll_votes (DB-17 §7.5 — PK tổ hợp; D1 PHƯƠNG ÁN A) ───────────────
CREATE TABLE feed_poll_votes (
  company_id     uuid NOT NULL
                   DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                   REFERENCES companies(id) ON DELETE CASCADE,
  poll_id        uuid NOT NULL,
  option_id      uuid NOT NULL,
  user_id        uuid NOT NULL,                           -- lưu CẢ khi poll ẩn danh, KHÔNG ra DTO
  -- D1: cột dẫn xuất = NOT feed_polls.multiple_choice, service ghi tường minh CÙNG câu INSERT.
  -- ⚠️ KHÔNG DEFAULT — xem header (fail-closed thay vì fail-open im lặng).
  single_choice  boolean NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_poll_votes_pk PRIMARY KEY (company_id, poll_id, option_id, user_id)
);
--> statement-breakpoint
ALTER TABLE feed_poll_votes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_poll_votes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_poll_votes;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_poll_votes
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 6. feed_ideas (DB-17 §7.6 — 1-1 với bài type='idea') ───────────────
-- FSM (submitted → under_review → accepted/rejected, 2 trạng thái cuối là TERMINAL) ép ở SERVICE bằng
-- assertIdeaTransition ⇒ SOCIAL-ERR-019. CHECK chỉ giữ TẬP GIÁ TRỊ + tính đầy đủ của vết duyệt —
-- KHÔNG giữ thứ tự chuyển (bẫy check-cannot-enforce-fsm-transitions).
CREATE TABLE feed_ideas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  post_id      uuid NOT NULL,
  status       varchar(16) NOT NULL,
  reviewed_by  uuid,                                      -- vết kiểm toán nullable ⇒ SET NULL (cột)
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feed_ideas_status
    CHECK (status IN ('submitted', 'under_review', 'accepted', 'rejected')),
  -- Đã quyết (accepted/rejected) thì phải có người duyệt VÀ mốc thời gian.
  CONSTRAINT chk_feed_ideas_reviewed_pair
    CHECK (status IN ('submitted', 'under_review')
           OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
  -- Từ chối thì phải nêu lý do (chuỗi trắng KHÔNG tính).
  CONSTRAINT chk_feed_ideas_reject_note
    CHECK (status <> 'rejected' OR (review_note IS NOT NULL AND length(btrim(review_note)) > 0)),
  CONSTRAINT feed_ideas_company_post_uq UNIQUE (company_id, post_id),
  CONSTRAINT feed_ideas_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_ideas ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_ideas FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_ideas;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_ideas
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 7. feed_kudos (DB-17 §7.7 — 1-1 với bài type='kudos') ───────────────
CREATE TABLE feed_kudos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  post_id      uuid NOT NULL,
  badge_id     uuid,                                      -- business FK nullable ⇒ NO ACTION (§4.2b)
  message      text,
  is_official  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_kudos_company_post_uq UNIQUE (company_id, post_id),
  CONSTRAINT feed_kudos_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_kudos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_kudos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_kudos;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_kudos
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 8. feed_kudos_recipients (DB-17 §7.8 — PK tổ hợp, KHÔNG có created_at) ───────────────
CREATE TABLE feed_kudos_recipients (
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  kudos_id     uuid NOT NULL,
  employee_id  uuid NOT NULL,
  CONSTRAINT feed_kudos_recipients_pk PRIMARY KEY (company_id, kudos_id, employee_id)
);
--> statement-breakpoint
ALTER TABLE feed_kudos_recipients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_kudos_recipients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_kudos_recipients;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_kudos_recipients
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 9. feed_kudos_badges (DB-17 §7.9 — CATALOG per-company; seed ở 0582) ───────────────
-- "Xoá" = UPDATE is_active=false (BẤT BIẾN #2) ⇒ KHÔNG GRANT DELETE, KHÔNG cột deleted_at (catalog).
CREATE TABLE feed_kudos_badges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  code         varchar(32) NOT NULL,
  name         varchar(255) NOT NULL,
  description  text,
  icon         varchar(64),                               -- tên icon lucide (mỹ quan, FE đổi được)
  is_active    boolean NOT NULL DEFAULT true,
  position     smallint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid,
  CONSTRAINT feed_kudos_badges_company_code_uq UNIQUE (company_id, code),
  CONSTRAINT feed_kudos_badges_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_kudos_badges ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_kudos_badges FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_kudos_badges;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_kudos_badges
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (10) COMPOSITE TENANT-FK — 20 ràng buộc của Track B, ĐẶT SAU khi RLS+FORCE+policy đã bật trên cả 9
--      bảng (BẤT BIẾN 1: RLS TRƯỚC mọi FK/GRANT/dữ liệu — khuôn 0559/0577).
--      deltype 'a' = NO ACTION (14 dòng ở đây) · 'n' = SET NULL (col) (6 dòng, TOÀN BỘ là cột nullable
--      "vết kiểm toán"). Dòng thứ 21 = feed_posts_group_fk, phát ở (11) sau hậu-kiểm mồ côi.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE feed_groups
  ADD CONSTRAINT feed_groups_avatar_file_tenant_fk FOREIGN KEY (company_id, avatar_file_id)
    REFERENCES files (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_groups_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT feed_groups_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT feed_groups_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
-- employee_id là BUSINESS FK (không phải vết kiểm toán) ⇒ NO ACTION, KHÔNG SET NULL (§4.2b).
ALTER TABLE feed_group_members
  ADD CONSTRAINT feed_group_members_group_tenant_fk FOREIGN KEY (company_id, group_id)
    REFERENCES feed_groups (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_group_members_user_tenant_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_group_members_employee_tenant_fk FOREIGN KEY (company_id, employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_polls
  ADD CONSTRAINT feed_polls_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_poll_options
  ADD CONSTRAINT feed_poll_options_poll_tenant_fk FOREIGN KEY (company_id, poll_id)
    REFERENCES feed_polls (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_poll_votes
  ADD CONSTRAINT feed_poll_votes_poll_tenant_fk FOREIGN KEY (company_id, poll_id)
    REFERENCES feed_polls (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_poll_votes_option_tenant_fk FOREIGN KEY (company_id, option_id)
    REFERENCES feed_poll_options (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_poll_votes_user_tenant_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_ideas
  ADD CONSTRAINT feed_ideas_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_ideas_reviewed_by_tenant_fk FOREIGN KEY (company_id, reviewed_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (reviewed_by);
--> statement-breakpoint
ALTER TABLE feed_kudos
  ADD CONSTRAINT feed_kudos_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_kudos_badge_tenant_fk FOREIGN KEY (company_id, badge_id)
    REFERENCES feed_kudos_badges (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_kudos_recipients
  ADD CONSTRAINT feed_kudos_recipients_kudos_tenant_fk FOREIGN KEY (company_id, kudos_id)
    REFERENCES feed_kudos (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_kudos_recipients_employee_tenant_fk FOREIGN KEY (company_id, employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_kudos_badges
  ADD CONSTRAINT feed_kudos_badges_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT feed_kudos_badges_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (11) TRẢ NỢ §0.2 của DB-1 — feed_posts_group_fk. HẬU-KIỂM MỒ CÔI TRƯỚC KHI PHÁT ALTER.
--      Cửa sổ DB-1 → DB-2 để lọt hàng `audience='group'` với group_id trỏ vào hư vô; ALTER sẽ ăn
--      23503 với thông điệp của Postgres (khó truy). RAISE tường minh ở đây nêu ĐÍCH DANH số hàng —
--      KHÔNG âm thầm bỏ qua, KHÔNG NOT VALID (NOT VALID = để lại nợ ngầm, đúng thứ bất biến #1 cấm).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_n int;
  v_can_bypass boolean;
BEGIN
  -- CỔNG FAIL-CLOSED (cùng khuôn 0582 khối (0) — FULL gate DB-2 H1): `feed_posts` ENABLE + FORCE RLS
  -- từ 0577. Migrate bằng vai KHÔNG BYPASSRLS ⇒ SELECT dưới đây bị policy lọc còn 0 ⇒ v_n = 0 ⇒
  -- RAISE NOTICE khẳng định "an toàn" TRONG KHI vẫn có thể đang có hàng mồ côi. Hậu-kiểm mất tác
  -- dụng chẩn đoán đúng lúc cần nhất. Không để hai chuẩn khác nhau trong cùng một commit.
  SELECT rolsuper OR rolbypassrls INTO v_can_bypass FROM pg_roles WHERE rolname = current_user;
  IF NOT COALESCE(v_can_bypass, false) THEN
    RAISE EXCEPTION '[0580] DUNG: vai migrate "%" khong co SUPERUSER/BYPASSRLS. feed_posts la RLS+FORCE => hau-kiem mo coi bi loc con 0 hang va se bao "an toan" MOT CACH SAI truoc khi them feed_posts_group_fk. Chay migrate bang vai co BYPASSRLS.', current_user;
  END IF;

  SELECT count(*) INTO v_n
    FROM feed_posts p
   WHERE p.group_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM feed_groups g
                      WHERE g.company_id = p.company_id AND g.id = p.group_id);
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0580] % hang feed_posts MO COI (group_id khong khop feed_groups cung tenant) — '
                    'don du lieu truoc khi them feed_posts_group_fk (plan §4.10 (c))', v_n;
  END IF;
  RAISE NOTICE '[0580] hau-kiem mo coi: 0 hang feed_posts.group_id lac — an toan de them feed_posts_group_fk';
END;
$$;
--> statement-breakpoint
ALTER TABLE feed_posts
  ADD CONSTRAINT feed_posts_group_fk FOREIGN KEY (company_id, group_id)
    REFERENCES feed_groups (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (12) INDEX — DB-17 §7.1–§7.9
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- Tên nhóm duy nhất trong công ty, không phân biệt hoa/thường, chỉ tính nhóm còn sống (partial UNIQUE).
CREATE UNIQUE INDEX feed_groups_company_name_uq ON feed_groups (company_id, lower(name))
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_feed_groups_company_visibility ON feed_groups (company_id, visibility)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- INDEX NÓNG NHẤT MODULE (SOC-DEC-006): mọi truy vấn bài nhóm riêng tư lọc membership qua 2 index này.
CREATE INDEX idx_feed_group_members_company_group_role
  ON feed_group_members (company_id, group_id, role) WHERE status = 'active';
--> statement-breakpoint
CREATE INDEX idx_feed_group_members_company_user
  ON feed_group_members (company_id, user_id, status);
--> statement-breakpoint
-- Job đóng bình chọn theo hạn quét qua index này.
CREATE INDEX idx_feed_polls_open_deadline ON feed_polls (company_id, closes_at)
  WHERE status = 'open' AND closes_at IS NOT NULL;
--> statement-breakpoint
-- KHONG tao index (company_id, poll_id, position) cho feed_poll_options: CONSTRAINT
-- feed_poll_options_position_uq UNIQUE (company_id, poll_id, position) da sinh index ngam TRUNG 100%
-- (cung cot, cung thu tu) — them nua chi gap doi chi phi ghi, 0 loi ich doc. FULL gate DB-2 (M-1).
-- D1 PHƯƠNG ÁN A — CHỐT CUỐI chống phiếu đôi ở poll một-lựa-chọn (partial theo cột dẫn xuất).
CREATE UNIQUE INDEX feed_poll_votes_single_uq ON feed_poll_votes (company_id, poll_id, user_id)
  WHERE single_choice;
--> statement-breakpoint
-- KHONG dung (company_id, poll_id): do la PREFIX CHAT cua PK (company_id, poll_id, option_id,
-- user_id) nen index PK da phuc vu — mot index thua tren dung bang LON NHAT module = write
-- amplification o duong nong. (company_id, poll_id, user_id) KHONG phai prefix cua PK, tra loi
-- "toi da bo phieu gi trong poll nay" cho poll DA-LUA-CHON (feed_poll_votes_single_uq la partial
-- WHERE single_choice nen khong dung duoc cho nhanh do). FULL gate DB-2 (M-2).
CREATE INDEX idx_feed_poll_votes_company_poll_user ON feed_poll_votes (company_id, poll_id, user_id);
--> statement-breakpoint
CREATE INDEX idx_feed_ideas_company_status ON feed_ideas (company_id, status, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_feed_kudos_company_created ON feed_kudos (company_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_feed_kudos_recipients_company_emp ON feed_kudos_recipients (company_id, employee_id);
--> statement-breakpoint
CREATE INDEX idx_feed_kudos_badges_company_active
  ON feed_kudos_badges (company_id, is_active, position);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (13) GRANT theo DB-17 §4.9 / plan §4.1-§4.9 — phát MỘT LẦN đúng bộ verb, KHÔNG GRANT-rồi-REVOKE
--      (revoke-table-grant-wipes-column-grants). mediaos_worker: CHỈ SELECT trên 3 bảng bình chọn
--      (job đóng bình chọn theo hạn — DB-17 §4.3).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON feed_groups TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON feed_group_members TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_polls TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON feed_polls TO mediaos_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_poll_options TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON feed_poll_options TO mediaos_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON feed_poll_votes TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON feed_poll_votes TO mediaos_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_ideas TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_kudos TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON feed_kudos_recipients TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_kudos_badges TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (14) VERIFY fail-LOUD (RAISE EXCEPTION) — mọi assert có vế DƯƠNG đúng-bằng (khuôn 0577 (15)).
--      Migrator chạy 1 transaction ⇒ EXCEPTION = rollback sạch cả 9 bảng + FK trả nợ.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_tables   CONSTANT text[] := ARRAY['feed_groups', 'feed_group_members', 'feed_polls',
                                      'feed_poll_options', 'feed_poll_votes', 'feed_ideas',
                                      'feed_kudos', 'feed_kudos_recipients', 'feed_kudos_badges'];
  -- ⚠️ Chuỗi này là pg_get_expr RENDER LẠI, KHÔNG phải chữ ta viết trong CREATE TABLE (khuôn 0577).
  v_guc      CONSTANT text := '(NULLIF(current_setting(''app.current_company_id''::text, true), ''''::text))::uuid';
  t          text;
  v_n        int;
  v_privs    text[];
  v_bad      text;
  v_pred     text;
  v_def      text;
  r          record;
BEGIN
  -- (1) RLS ENABLE + FORCE + policy tenant_isolation soi GUC ở CẢ USING lẫn WITH CHECK
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = t::regclass AND relrowsecurity AND relforcerowsecurity
    ) THEN
      RAISE EXCEPTION '[0580] verify: % thieu ENABLE/FORCE ROW LEVEL SECURITY', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = t::regclass AND polname = 'tenant_isolation'
         AND pg_get_expr(polqual, polrelid)      LIKE '%app.current_company_id%'
         AND pg_get_expr(polwithcheck, polrelid) LIKE '%app.current_company_id%'
    ) THEN
      RAISE EXCEPTION '[0580] verify: % thieu policy tenant_isolation USING+WITH CHECK theo GUC', t;
    END IF;
  END LOOP;

  -- (1b) company_id NOT NULL + DEFAULT literal-GUC trên CẢ 9 BẢNG — so ĐÚNG CHUỖI pg_get_expr.
  FOREACH t IN ARRAY v_tables LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = t::regclass AND a.attname = 'company_id' AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_def IS DISTINCT FROM v_guc THEN
      RAISE EXCEPTION '[0580] verify: DEFAULT cua %.company_id = % — ky vong %',
        t, COALESCE(v_def, '<NULL>'), v_guc;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = t::regclass AND attname = 'company_id' AND attnotnull
    ) THEN
      RAISE EXCEPTION '[0580] verify: %.company_id khong NOT NULL', t;
    END IF;
  END LOOP;

  -- (2) GRANT bằng aclexplode (KHÔNG information_schema — 0540:137-139), đúng-bằng DB-17 §4.9.
  FOR r IN SELECT * FROM (VALUES
      ('feed_groups',           ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_group_members',    ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']),
      ('feed_polls',            ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_poll_options',     ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_poll_votes',       ARRAY['DELETE', 'INSERT', 'SELECT']),
      ('feed_ideas',            ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_kudos',            ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_kudos_recipients', ARRAY['DELETE', 'INSERT', 'SELECT']),
      ('feed_kudos_badges',     ARRAY['INSERT', 'SELECT', 'UPDATE'])
    ) AS v(tbl, privs)
  LOOP
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = r.tbl::regclass AND x.grantee = 'mediaos_app'::regrole;
    IF v_privs IS DISTINCT FROM r.privs THEN
      RAISE EXCEPTION '[0580] verify: ACL cap bang cua mediaos_app tren % = % — ky vong % (DB-17 §4.9)',
        r.tbl, v_privs, r.privs;
    END IF;
  END LOOP;

  -- (2a) KHÔNG bảng nào có ACL cấp CỘT cho app (khuôn Track A: toàn bộ grant ở cấp bảng).
  FOREACH t IN ARRAY v_tables LOOP
    SELECT count(*) INTO v_n
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_app'::regrole;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0580] verify: % co % column-ACL cho mediaos_app — Track B grant o CAP BANG', t, v_n;
    END IF;
  END LOOP;

  -- (2b) BẤT BIẾN #2 đích danh: 0 quyền DELETE (bảng LẪN cột) trên 6 bảng KHÔNG được hard-delete.
  FOREACH t IN ARRAY ARRAY['feed_groups', 'feed_polls', 'feed_poll_options', 'feed_ideas',
                           'feed_kudos', 'feed_kudos_badges'] LOOP
    SELECT count(*) INTO v_n FROM (
      SELECT x.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
       WHERE c.oid = t::regclass AND x.grantee = 'mediaos_app'::regrole
         AND x.privilege_type = 'DELETE'
      UNION ALL
      SELECT x.privilege_type
        FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
       WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type = 'DELETE'
    ) z;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0580] verify: % co quyen DELETE cho app — pha bat bien #2 (soft-delete/catalog)', t;
    END IF;
  END LOOP;

  -- (2c) worker: ĐÚNG {SELECT} trên 3 bảng bình chọn, KHÔNG ACL nào trên 6 bảng còn lại (DB-17 §4.3).
  FOREACH t IN ARRAY ARRAY['feed_polls', 'feed_poll_options', 'feed_poll_votes'] LOOP
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_worker'::regrole;
    IF v_privs IS DISTINCT FROM ARRAY['SELECT'] THEN
      RAISE EXCEPTION '[0580] verify: ACL cua mediaos_worker tren % = % — ky vong {SELECT}', t, v_privs;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
   WHERE c.oid::regclass::text = ANY (v_tables)
     AND c.oid <> ALL (ARRAY['feed_polls', 'feed_poll_options', 'feed_poll_votes']::regclass[])
     AND x.grantee = 'mediaos_worker'::regrole;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0580] verify: mediaos_worker co % ACL ngoai 3 bang binh chon — ky vong 0 (DB-17 §4.3)', v_n;
  END IF;

  -- (3) COMPOSITE FK — DƯƠNG đúng-bằng 21 dòng (bảng, cột, đích, deltype, setcols). Thiếu/thừa ⇒ đỏ.
  --     ⚠️ PHẠM VI: 9 bảng Track B ∪ conname='feed_posts_group_fk'. KHÔNG lấy nguyên feed_posts —
  --     nó đã có 6 FK của 0577 ⇒ đo ra 27 và EXCEPT báo 6 dòng THỪA oan (plan §4.10).
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
           AND (c.conrelid::regclass::text = ANY (v_tables) OR c.conname = 'feed_posts_group_fk')
           AND array_length(c.conkey, 1) = 2
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[2]) = 'id'
      ), expected (tbl, col, tgt, del, setcols) AS (VALUES
        ('feed_groups',           'avatar_file_id', 'files',             'a', ARRAY[]::text[]),
        ('feed_groups',           'created_by',     'users',             'n', ARRAY['created_by']),
        ('feed_groups',           'updated_by',     'users',             'n', ARRAY['updated_by']),
        ('feed_groups',           'deleted_by',     'users',             'n', ARRAY['deleted_by']),
        ('feed_group_members',    'group_id',       'feed_groups',       'a', ARRAY[]::text[]),
        ('feed_group_members',    'user_id',        'users',             'a', ARRAY[]::text[]),
        ('feed_group_members',    'employee_id',    'employee_profiles', 'a', ARRAY[]::text[]),
        ('feed_polls',            'post_id',        'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_poll_options',     'poll_id',        'feed_polls',        'a', ARRAY[]::text[]),
        ('feed_poll_votes',       'poll_id',        'feed_polls',        'a', ARRAY[]::text[]),
        ('feed_poll_votes',       'option_id',      'feed_poll_options', 'a', ARRAY[]::text[]),
        ('feed_poll_votes',       'user_id',        'users',             'a', ARRAY[]::text[]),
        ('feed_ideas',            'post_id',        'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_ideas',            'reviewed_by',    'users',             'n', ARRAY['reviewed_by']),
        ('feed_kudos',            'post_id',        'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_kudos',            'badge_id',       'feed_kudos_badges', 'a', ARRAY[]::text[]),
        ('feed_kudos_recipients', 'kudos_id',       'feed_kudos',        'a', ARRAY[]::text[]),
        ('feed_kudos_recipients', 'employee_id',    'employee_profiles', 'a', ARRAY[]::text[]),
        ('feed_kudos_badges',     'created_by',     'users',             'n', ARRAY['created_by']),
        ('feed_kudos_badges',     'updated_by',     'users',             'n', ARRAY['updated_by']),
        -- dòng DUY NHẤT của Track A mà 0580 sở hữu (nợ §0.2 của DB-1)
        ('feed_posts',            'group_id',       'feed_groups',       'a', ARRAY[]::text[])
      )
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0580] verify: composite FK LECH so voi 21 dong ky vong (thieu/thua): %', v_bad;
  END IF;

  -- (3a) MỌI FK >= 2 cột trong ĐÚNG PHẠM VI SỞ HỮU phải = 21 — bộ lọc "đúng hình dạng" ở trên RỚT FK
  --      lệch hình dạng khỏi CẢ HAI vế EXCEPT; đếm thô bịt lại (khuôn 0559 (3a')/0577 (3a)).
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND (c.conrelid::regclass::text = ANY (v_tables) OR c.conname = 'feed_posts_group_fk')
     AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 21 THEN
    RAISE EXCEPTION '[0580] verify: co % FK >= 2 cot trong pham vi 0580, ky vong dung 21 — co FK lech hinh dang', v_n;
  END IF;

  -- (3b) 0 FK một-cột từ 9 bảng Track B tới bảng khác companies (đúng lớp lỗ KI-046).
  --      feed_posts do 0577 canh (0577 (3b)) — KHÔNG đo lại ở đây.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables)
     AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0580] verify: con % FK MOT COT tu bang Track B toi bang khac companies — phai composite', v_n;
  END IF;

  -- (3c) feed_posts_group_fk tồn tại ĐÍCH DANH với deltype 'a' và ĐÚNG 2 cột (cổng nợ §0.2 khép lại).
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.conname = 'feed_posts_group_fk' AND c.conrelid = 'feed_posts'::regclass
     AND c.contype = 'f' AND c.confrelid = 'feed_groups'::regclass
     AND array_length(c.conkey, 1) = 2 AND c.confdeltype = 'a';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0580] verify: feed_posts_group_fk khong dung hinh dang (dem duoc %) — no §0.2 chua tra', v_n;
  END IF;

  -- (4) CHECK constraint — đúng-bằng per bảng (2 groups + 3 members + 3 polls + 1 options + 3 ideas).
  --     Thừa = ai đó thêm CHECK ngoài thiết kế; thiếu = rơi CHECK cặp.
  FOR r IN SELECT * FROM (VALUES
      ('feed_groups', 2), ('feed_group_members', 3), ('feed_polls', 3), ('feed_poll_options', 1),
      ('feed_poll_votes', 0), ('feed_ideas', 3), ('feed_kudos', 0), ('feed_kudos_recipients', 0),
      ('feed_kudos_badges', 0)
    ) AS v(tbl, n)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c WHERE c.conrelid = r.tbl::regclass AND c.contype = 'c';
    IF v_n <> r.n THEN
      RAISE EXCEPTION '[0580] verify: % co % CHECK, ky vong dung % (DB-17 §7 + plan §4)', r.tbl, v_n, r.n;
    END IF;
  END LOOP;

  -- (4a) CHECK MỚI của plan §0 tồn tại ĐÍCH DANH (đếm ở (4) không phân biệt được tên).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'feed_polls'::regclass AND contype = 'c'
       AND conname = 'chk_feed_polls_closes_future'
  ) THEN
    RAISE EXCEPTION '[0580] verify: thieu chk_feed_polls_closes_future (done_when #1, plan §0)';
  END IF;

  -- (5) PK tổ hợp (contype='p') của 3 bảng quan hệ — KHÔNG viết contype='u' trơn (bẫy DB-1 §7.6).
  FOR r IN SELECT * FROM (VALUES
      ('feed_group_members',    ARRAY['company_id', 'group_id', 'user_id']),
      ('feed_poll_votes',       ARRAY['company_id', 'option_id', 'poll_id', 'user_id']),
      ('feed_kudos_recipients', ARRAY['company_id', 'employee_id', 'kudos_id'])
    ) AS v(tbl, cols)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = r.tbl::regclass AND c.contype = 'p'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = r.cols;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0580] verify: % thieu PRIMARY KEY to hop % (dem duoc %)', r.tbl, r.cols, v_n;
    END IF;
  END LOOP;

  -- (6) UNIQUE constraint (contype='u') — đúng-bằng theo tên + cột.
  FOR r IN SELECT * FROM (VALUES
      ('feed_groups_company_id_id_uq',       'feed_groups',       ARRAY['company_id', 'id']),
      ('feed_polls_company_id_id_uq',        'feed_polls',        ARRAY['company_id', 'id']),
      ('feed_polls_company_post_uq',         'feed_polls',        ARRAY['company_id', 'post_id']),
      ('feed_poll_options_company_id_id_uq', 'feed_poll_options', ARRAY['company_id', 'id']),
      ('feed_poll_options_position_uq',      'feed_poll_options', ARRAY['company_id', 'poll_id', 'position']),
      ('feed_ideas_company_id_id_uq',        'feed_ideas',        ARRAY['company_id', 'id']),
      ('feed_ideas_company_post_uq',         'feed_ideas',        ARRAY['company_id', 'post_id']),
      ('feed_kudos_company_id_id_uq',        'feed_kudos',        ARRAY['company_id', 'id']),
      ('feed_kudos_company_post_uq',         'feed_kudos',        ARRAY['company_id', 'post_id']),
      ('feed_kudos_badges_company_id_id_uq', 'feed_kudos_badges', ARRAY['company_id', 'id']),
      ('feed_kudos_badges_company_code_uq',  'feed_kudos_badges', ARRAY['code', 'company_id'])
    ) AS v(con, tbl, cols)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conname = r.con AND c.conrelid = r.tbl::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = r.cols;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0580] verify: UNIQUE % tren % (%) khong dung (dem duoc %)', r.con, r.tbl, r.cols, v_n;
    END IF;
  END LOOP;

  -- (7) 2 partial UNIQUE INDEX — KHÔNG có trong pg_constraint; so ĐÚNG CHUỖI pg_get_expr(indpred)
  --     (KHÔNG ILIKE '%WHERE%' — khuôn 0559 (5)/0577 (7)).
  SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
    FROM pg_index i WHERE i.indexrelid = 'feed_groups_company_name_uq'::regclass AND i.indisunique;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[0580] verify: index feed_groups_company_name_uq khong ton tai hoac khong UNIQUE';
  END IF;
  IF v_pred IS DISTINCT FROM '(deleted_at IS NULL)' THEN
    RAISE EXCEPTION '[0580] verify: predicate cua feed_groups_company_name_uq = % — ky vong (deleted_at IS NULL)',
      COALESCE(v_pred, '<NULL>');
  END IF;

  SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
    FROM pg_index i WHERE i.indexrelid = 'feed_poll_votes_single_uq'::regclass AND i.indisunique;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[0580] verify: index feed_poll_votes_single_uq khong ton tai hoac khong UNIQUE (D1)';
  END IF;
  IF v_pred IS DISTINCT FROM 'single_choice' THEN
    RAISE EXCEPTION '[0580] verify: predicate cua feed_poll_votes_single_uq = % — ky vong single_choice (D1)',
      COALESCE(v_pred, '<NULL>');
  END IF;

  -- (7a) D1 — single_choice PHẢI NOT NULL và PHẢI KHÔNG có DEFAULT (fail-closed, xem header).
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'feed_poll_votes'::regclass AND a.attname = 'single_choice' AND a.attnotnull;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[0580] verify: feed_poll_votes.single_choice khong ton tai hoac khong NOT NULL (D1)';
  END IF;
  IF v_def IS NOT NULL THEN
    RAISE EXCEPTION '[0580] verify: single_choice CO DEFAULT (%) — phai KHONG default de mot lan quen ghi '
                    'cua BE-2 la 23502 chu khong phai vo hieu hoa chot chong-phieu-doi im lang (D1)', v_def;
  END IF;

  -- (8) 11 index theo tên. Thiếu index = đường đọc của BE-2 quét bảng.
  --     11 chứ không phải 12 như plan §4: FULL gate DB-2 gỡ idx_feed_poll_options_company_poll
  --     (trùng 100% index ngầm của feed_poll_options_position_uq — M-1) và đổi
  --     idx_feed_poll_votes_company_poll (prefix chặt của PK) thành _company_poll_user (M-2).
  FOREACH t IN ARRAY ARRAY['feed_groups_company_name_uq', 'idx_feed_groups_company_visibility',
                           'idx_feed_group_members_company_group_role', 'idx_feed_group_members_company_user',
                           'idx_feed_polls_open_deadline',
                           'feed_poll_votes_single_uq', 'idx_feed_poll_votes_company_poll_user',
                           'idx_feed_ideas_company_status', 'idx_feed_kudos_company_created',
                           'idx_feed_kudos_recipients_company_emp', 'idx_feed_kudos_badges_company_active'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '[0580] verify: index % khong ton tai', t;
    END IF;
  END LOOP;

  RAISE NOTICE '[0580] verify PASS: 9 bang Track B RLS+FORCE · company_id DEFAULT literal-GUC · ACL §4.9 '
               '(6 bang 0 DELETE, worker SELECT tren 3 bang binh chon) · 21 composite FK (gom feed_posts_group_fk) '
               '· 12 CHECK · 3 PK to hop + 11 UNIQUE + 2 partial-unique · 12 index';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy). Thứ tự con → cha.
-- ALTER TABLE feed_posts DROP CONSTRAINT feed_posts_group_fk;
-- DROP TABLE IF EXISTS feed_poll_votes;
-- DROP TABLE IF EXISTS feed_poll_options;
-- DROP TABLE IF EXISTS feed_polls;
-- DROP TABLE IF EXISTS feed_kudos_recipients;
-- DROP TABLE IF EXISTS feed_kudos;
-- DROP TABLE IF EXISTS feed_kudos_badges;
-- DROP TABLE IF EXISTS feed_ideas;
-- DROP TABLE IF EXISTS feed_group_members;
-- DROP TABLE IF EXISTS feed_groups;
-- -- + gỡ 19 dòng cleanupTenants() về lại 10 + 9 case rls-registry + 9 tên PROTECTED_TABLES
-- --   + khối Track B ở schema/social.ts + packages/contracts/src/social.ts cùng lúc.
