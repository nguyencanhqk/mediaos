-- Migration 0577: S16-SOCIAL-DB-1 (🔴 RED, zone=red, crown) — SOCIAL Track A (DB-17 §4/§6, plan §3 b1).
--
-- MỤC TIÊU (plan docs/plans/S16-SOCIAL-DB-1.md §1): BUILD 10 bảng MỚI của module SOCIAL (SPEC-16):
--   • feed_posts       — bài đăng (share/news/idea/poll/kudos), soft-delete, bộ đếm denormalized,
--                        search_vector cột sinh, 2 cột mốc sắp xếp (published_at/last_activity_at).
--   • feed_comments    — bình luận 1 cấp (ép ở SERVICE — CHECK cấp hàng không nhìn được hàng cha), soft-delete.
--   • feed_tags        — từ điển hashtag (usage_count), KHÔNG xoá.
--   • feed_post_tags   — nối bài↔thẻ, PK tổ hợp.
--   • feed_reactions   — thích đa hình post|comment, UNIQUE target×user; emoji KHÔNG CHECK (xem dưới).
--   • feed_mentions    — bảng THẬT (không lặp nợ task_comment_mentions), UNIQUE target×người-được-nhắc.
--   • feed_saved_posts — "đã lưu" cá nhân, PK tổ hợp.
--   • feed_post_views  — SỔ lượt xem APPEND-ONLY (SELECT, INSERT duy nhất — bất biến #2), PK tổ hợp.
--   • feed_post_acks   — SỔ xác nhận đã đọc tin APPEND-ONLY, PK tổ hợp (bằng chứng "ai đã đọc tin").
--   • feed_reports     — báo cáo vi phạm, partial-unique 1 báo cáo 'open' mỗi (đối tượng, người báo).
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id NOT NULL + DEFAULT literal-GUC + RLS ENABLE + FORCE + policy tenant_isolation
--      (USING + WITH CHECK) TẠO TRƯỚC mọi FK/GRANT/dữ liệu — nguyên văn khuôn 0559. MỌI FK chéo bảng
--      nghiệp vụ là COMPOSITE tenant FK (company_id, col) → parent (company_id, id) — KHÔNG có FK
--      một-cột nào ngoài company_id → companies (FK Postgres KHÔNG áp RLS — KI-046).
--      VERIFY (3) dùng BẢNG TUPLE 26 DÒNG `EXCEPT` hai chiều, KHÔNG con số trần: quên hẳn một FK thì
--      fk-tenant-census/xtenant-fk-ratchet IM LẶNG (chỉ đếm FK ĐANG TỒN TẠI — 0559:613), VERIFY này
--      là lưới DUY NHẤT.
--   #2 feed_post_views / feed_post_acks: GRANT SELECT, INSERT — KHÔNG UPDATE/DELETE (append-only).
--      Verify bằng aclexplode(relacl/attacl) — KHÔNG information_schema (0540:137-139).
--      FK users chia theo tính NULL của cột (DB-17 §4.2b — bảng này THẮNG nếu §6.x mâu thuẫn):
--        · cột NOT NULL (chủ thể của hàng) → NO ACTION. SET NULL trên cột NOT NULL NỔ lúc DELETE,
--          đúng kịch bản companies CASCADE xoá users TRƯỚC feed_posts ⇒ teardown lane DB đỏ hàng loạt.
--        · cột nullable (vết kiểm toán) → SET NULL (<cột>) — PHẢI liệt kê cột; SET NULL trần null
--          LUÔN company_id (0535:682) ⇒ hàng rơi khỏi tenant.
--        · bảng chỉ-INSERT (views/acks/mentions) → NO ACTION: RI action chạy tầng owner, SET NULL ghi
--          đè cột KHÔNG có grant UPDATE (đính chính 0549).
--   #3 SOCIAL không lưu secret nào. Ngày sinh KHÔNG lưu lại ở đây (đọc từ employee_profiles, cắt
--      còn ngày+tháng ở DTO — SPEC-16 §3.5).
--   • FK nội bộ ON DELETE NO ACTION — TUYỆT ĐỐI KHÔNG RESTRICT: cascade từ companies xoá các bảng anh
--     em theo thứ tự bất định ⇒ RESTRICT nổ giữa chừng ⇒ cleanupTenants() chết (DB-17 §4.2b).
--   • DDL thủ công — KHÔNG db:generate (sẽ DROP schema media/finance đang park). schema/social.ts PARITY-only.
--
-- HAI ĐIỂM LỆCH DB-17 ĐÃ ĐO LẠI (plan §0 — đo trên mediaos PG 17.10 ngày 19/09/2026, file plan THẮNG):
--   §0.2 `feed_posts.group_id` — DB-17 §6.1 ghi composite FK → feed_groups (company_id, id). feed_groups
--        thuộc Track B (S16-SOCIAL-DB-2) và CHƯA TỒN TẠI ⇒ DB-1 tạo cột UUID nullable KHÔNG kèm FK.
--        ⚠️ NGOẠI LỆ DUY NHẤT của luật "mọi FK mới kèm composite tenant-FK". DB-2 PHẢI thêm:
--          ALTER TABLE feed_posts ADD CONSTRAINT feed_posts_group_fk
--            FOREIGN KEY (company_id, group_id) REFERENCES feed_groups (company_id, id) ON DELETE NO ACTION;
--        Nợ này KHÔNG dựa vào ai đọc ghi chú: s16-social-db1-invariants.int-spec.ts có assert TỰ LÊN
--        NÒNG — khi to_regclass('feed_groups') khác NULL mà FK chưa có thì spec ĐỎ.
--   §0.5 `published_at` + `last_activity_at` — DB-17 §6.1 KHÔNG có, nhưng done_when của S16-SOCIAL-BE-1
--        (backlog.mjs:16879) đòi keyset (last_activity_at,id) và (published_at,id), mà BE-1 KHÔNG có
--        migrations/** trong paths ⇒ DB-1 là lane DUY NHẤT cấp được. Luật ghi:
--          · published_at     — set 1 lần lúc tạo, KHÔNG đổi khi sửa bài.
--          · last_activity_at — service bump CÙNG TX khi có bình luận/reaction mới.
--            ⚠️ KHÔNG bump theo feed_post_views: bump là biến "Hoạt động mới" thành "vừa có người xem".
--
-- search_vector — PHƯƠNG ÁN A của DB-17 §6.1b (nợ ĐO đã đóng ở plan §0.0):
--   unaccent ĐÃ CÀI (v1.1) và public.f_unaccent(text) ĐÃ TỒN TẠI IMMUTABLE từ 0538:365-372 ⇒ TÁI DÙNG,
--   KHÔNG tạo hàm mới (tạo thêm = tách nguồn sự thật), KHÔNG CREATE EXTENSION (cần superuser).
--   schema-qualify TUYỆT ĐỐI (public.f_unaccent): cột sinh NEO VÀO OID HÀM — sai search_path lúc
--   migrate là hỏng VĨNH VIỄN (phải rewrite bảng để sửa). Tiền-kiểm (0) hậu kiểm hàm, KHÔNG tin không đo.
--
-- feed_reactions.emoji KHÔNG CÓ CHECK — quyết định tường minh (DB-17 §6.3, plan §0.6/§5):
--   nguồn sự thật của bộ emoji là hằng CHAT_REACTION_EMOJIS (communication.ts:427) dùng chung với CHAT.
--   Sao vào CHECK = đẻ nguồn sự thật thứ hai (CHAT đổi bộ ⇒ CHECK cũ lặng lẽ chặn reaction hợp lệ).
--   Lưới nằm ở Zod/service. Đây là NGOẠI LỆ DUY NHẤT của luật mirror CHECK↔Zod — đọc "thiếu CHECK
--   emoji" là hiểu nhầm mà dòng này dựng ra để chặn.
--
-- BAND 0577 (lane S16-SOCIAL-DB-1). Journal: idx 244, when 1717587366000 (> 0576 idx 243 / 1717587365000).
--   Cùng commit: schema/social.ts + schema/index.ts · packages/contracts/src/social.ts (+ barrel) ·
--   test/helpers/seed.ts cleanupTenants() (10 bảng con→cha, TRƯỚC `DELETE FROM org_units`) ·
--   test/integration/rls-registry.ts (10 case, 4 case khai idColumn vì PK tổ hợp) ·
--   foundation/retention/retention.service.ts PROTECTED_TABLES (+10 = trọn Track A).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (0) TIỀN KIỂM fail-loud ───────────────
DO $$
DECLARE
  t     text;
  v_n   int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- SET NULL (col) trên FK composite cần PG >= 15 (đã dùng ở 0535/0549/0559 trên chính cụm này).
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '[0577] can PostgreSQL >= 15 cho ON DELETE SET NULL (col) — server_version_num = %',
      current_setting('server_version_num');
  END IF;

  -- Bảng ĐÍCH của composite FK phải có UNIQUE (company_id, id). KHÔNG tự tạo (bảng thuộc lane khác):
  -- users (0533) · employee_profiles · org_units (0535). ⚠️ KHÔNG có bảng tên `employees` — HR là
  -- employee_profiles (DB-17 §4.2a). Plan §0 đã đo; hậu kiểm ở đây (không tin không đo).
  FOREACH t IN ARRAY ARRAY['users', 'employee_profiles', 'org_units'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0577] % thieu UNIQUE (company_id, id) (dem duoc %) — chay truoc: '
                      'ALTER TABLE % ADD CONSTRAINT %_company_id_id_uq UNIQUE (company_id, id);', t, v_n, t, t;
    END IF;
  END LOOP;

  -- public.f_unaccent(text) PHẢI tồn tại và PHẢI IMMUTABLE (provolatile='i'). unaccent() gốc chỉ STABLE
  -- ⇒ dùng thẳng trong cột generated là migration ĐỎ. KHÔNG tạo lại hàm ở đây (0538 là chủ sở hữu).
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'f_unaccent'
     AND p.pronargs = 1 AND p.proargtypes[0] = 'text'::regtype AND p.provolatile = 'i';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '[0577] public.f_unaccent(text) IMMUTABLE khong ton tai (dem duoc %) — 0538 phai chay truoc', v_n;
  END IF;

  -- 10 bảng chưa được tồn tại (đụng tên = có lane khác dựng song song — DỪNG).
  -- ⚠️ Đây là lý do 0577 chạy lại PHẢI RAISE — tính năng, không phải lỗi (plan §7.7).
  FOREACH t IN ARRAY ARRAY['feed_posts', 'feed_comments', 'feed_tags', 'feed_post_tags', 'feed_reactions',
                           'feed_mentions', 'feed_saved_posts', 'feed_post_views', 'feed_post_acks',
                           'feed_reports'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      RAISE EXCEPTION '[0577] bang % DA TON TAI — dung ten voi lane khac, abort', t;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ─────────────── 1. feed_posts (DB-17 §6.1 — mutable, soft-delete) ───────────────
CREATE TABLE feed_posts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  author_user_id      uuid NOT NULL,
  author_employee_id  uuid,
  type                varchar(16) NOT NULL,
  audience            varchar(16) NOT NULL DEFAULT 'company',
  group_id            uuid,                                  -- §0.2: KHÔNG FK ở DB-1 (feed_groups = Track B)
  org_unit_id         uuid,
  body                text,
  status              varchar(16) NOT NULL DEFAULT 'published',
  pinned              boolean NOT NULL DEFAULT false,
  comments_locked     boolean NOT NULL DEFAULT false,
  requires_ack        boolean NOT NULL DEFAULT false,
  like_count          integer NOT NULL DEFAULT 0,
  comment_count       integer NOT NULL DEFAULT 0,
  view_count          integer NOT NULL DEFAULT 0,
  published_at        timestamptz NOT NULL DEFAULT now(),    -- §0.5: set 1 lần lúc tạo, KHÔNG đổi khi sửa
  last_activity_at    timestamptz NOT NULL DEFAULT now(),    -- §0.5: bump cùng tx khi có comment/reaction
  edited_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  CONSTRAINT chk_feed_posts_type     CHECK (type IN ('share', 'news', 'idea', 'poll', 'kudos')),
  CONSTRAINT chk_feed_posts_audience CHECK (audience IN ('company', 'group', 'org_unit')),
  CONSTRAINT chk_feed_posts_status   CHECK (status IN ('published', 'hidden', 'deleted')),
  -- CHECK CẶP dạng KÉO THEO (KHÔNG vế "IS NULL OR" rỗng — vế rỗng đúng vĩnh viễn, chặn được 0 thứ)
  CONSTRAINT chk_feed_posts_audience_group   CHECK (audience <> 'group'    OR group_id    IS NOT NULL),
  CONSTRAINT chk_feed_posts_audience_org     CHECK (audience <> 'org_unit' OR org_unit_id IS NOT NULL),
  -- chiều ngược: mỗi phạm vi CHỈ mang đúng khoá của nó — hai khoá loại trừ nhau
  CONSTRAINT chk_feed_posts_audience_company CHECK (audience <> 'company'
                                                    OR (group_id IS NULL AND org_unit_id IS NULL)),
  CONSTRAINT chk_feed_posts_audience_group_excl CHECK (audience <> 'group'    OR org_unit_id IS NULL),
  CONSTRAINT chk_feed_posts_audience_org_excl   CHECK (audience <> 'org_unit' OR group_id    IS NULL),
  -- ghim và yêu cầu xác nhận đọc CHỈ dành cho bài tin tức
  CONSTRAINT chk_feed_posts_pinned_news CHECK (pinned       = false OR type = 'news'),
  CONSTRAINT chk_feed_posts_ack_news    CHECK (requires_ack = false OR type = 'news'),
  -- ba loại bài kể chuyện bằng body; poll/kudos mang nội dung ở bảng con (Track B)
  CONSTRAINT chk_feed_posts_body_required
    CHECK (type IN ('poll', 'kudos') OR (body IS NOT NULL AND length(btrim(body)) > 0)),
  -- body NULL ⇒ length(NULL) IS NULL ⇒ CHECK trả NULL ⇒ PASS (đúng ý: giới hạn chỉ áp khi có nội dung)
  CONSTRAINT chk_feed_posts_body_len CHECK (length(body) <= 20000),
  CONSTRAINT chk_feed_posts_counts
    CHECK (like_count >= 0 AND comment_count >= 0 AND view_count >= 0),
  CONSTRAINT feed_posts_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_posts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_posts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_posts;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_posts
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 2. feed_comments (DB-17 §6.2 — mutable, soft-delete, 1 cấp ép ở SERVICE) ───────────────
CREATE TABLE feed_comments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL
                        DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                        REFERENCES companies(id) ON DELETE CASCADE,
  post_id             uuid NOT NULL,
  parent_comment_id   uuid,
  author_user_id      uuid NOT NULL,
  author_employee_id  uuid,
  body                text NOT NULL,
  like_count          integer NOT NULL DEFAULT 0,
  edited_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  CONSTRAINT chk_feed_comments_body_len    CHECK (length(body) <= 5000),
  CONSTRAINT chk_feed_comments_like_count  CHECK (like_count >= 0),
  CONSTRAINT feed_comments_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_comments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_comments;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_comments
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 3. feed_tags (DB-17 §6.5 — từ điển, KHÔNG xoá) ───────────────
CREATE TABLE feed_tags (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  tag          varchar(64) NOT NULL,   -- đã chuẩn hoá ở service: lowercase, bỏ '#'
  usage_count  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feed_tags_usage CHECK (usage_count >= 0),
  CONSTRAINT feed_tags_company_tag_uq  UNIQUE (company_id, tag),
  CONSTRAINT feed_tags_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_tags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_tags;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_tags
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 4. feed_post_tags (DB-17 §6.6 — PK tổ hợp, KHÔNG cột id) ───────────────
CREATE TABLE feed_post_tags (
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  post_id     uuid NOT NULL,
  tag_id      uuid NOT NULL,
  CONSTRAINT feed_post_tags_pk PRIMARY KEY (company_id, post_id, tag_id)
);
--> statement-breakpoint
ALTER TABLE feed_post_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_post_tags FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_post_tags;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_post_tags
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 5. feed_reactions (DB-17 §6.3 — đa hình; emoji KHÔNG CHECK, xem header) ───────────────
CREATE TABLE feed_reactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  target_type  varchar(16) NOT NULL,
  target_id    uuid NOT NULL,          -- KHÔNG FK: đích đa hình (feed_posts | feed_comments) — DB-17 R1
  user_id      uuid NOT NULL,
  emoji        varchar(32) NOT NULL,   -- KHÔNG CHECK — nguồn là CHAT_REACTION_EMOJIS (xem header)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feed_reactions_target CHECK (target_type IN ('post', 'comment')),
  CONSTRAINT feed_reactions_target_user_uq UNIQUE (company_id, target_type, target_id, user_id)
);
--> statement-breakpoint
ALTER TABLE feed_reactions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_reactions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_reactions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_reactions
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 6. feed_mentions (DB-17 §6.4 — bảng THẬT, chỉ INSERT/DELETE) ───────────────
CREATE TABLE feed_mentions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL
                           DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                           REFERENCES companies(id) ON DELETE CASCADE,
  target_type            varchar(16) NOT NULL,
  target_id              uuid NOT NULL,   -- đa hình như §6.3
  mentioned_user_id      uuid NOT NULL,
  mentioned_employee_id  uuid,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feed_mentions_target CHECK (target_type IN ('post', 'comment')),
  CONSTRAINT feed_mentions_uq UNIQUE (company_id, target_type, target_id, mentioned_user_id)
);
--> statement-breakpoint
ALTER TABLE feed_mentions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_mentions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_mentions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_mentions
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 7. feed_saved_posts (DB-17 §6.7 — PK tổ hợp) ───────────────
CREATE TABLE feed_saved_posts (
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  post_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_saved_posts_pk PRIMARY KEY (company_id, user_id, post_id)
);
--> statement-breakpoint
ALTER TABLE feed_saved_posts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_saved_posts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_saved_posts;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_saved_posts
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 8. feed_post_views (DB-17 §6.8 — APPEND-ONLY, PK tổ hợp) ───────────────
CREATE TABLE feed_post_views (
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  post_id     uuid NOT NULL,
  user_id     uuid NOT NULL,
  viewed_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_post_views_pk PRIMARY KEY (company_id, post_id, user_id)
);
--> statement-breakpoint
ALTER TABLE feed_post_views ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_post_views FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_post_views;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_post_views
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 9. feed_post_acks (DB-17 §6.9 — APPEND-ONLY, PK tổ hợp) ───────────────
CREATE TABLE feed_post_acks (
  company_id  uuid NOT NULL
                DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies(id) ON DELETE CASCADE,
  post_id     uuid NOT NULL,
  user_id     uuid NOT NULL,
  acked_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT feed_post_acks_pk PRIMARY KEY (company_id, post_id, user_id)
);
--> statement-breakpoint
ALTER TABLE feed_post_acks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_post_acks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_post_acks;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_post_acks
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ─────────────── 10. feed_reports (DB-17 §6.10 — mutable, KHÔNG soft-delete) ───────────────
CREATE TABLE feed_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL
                      DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies(id) ON DELETE CASCADE,
  target_type       varchar(16) NOT NULL,
  target_id         uuid NOT NULL,     -- đa hình như §6.3
  reporter_user_id  uuid NOT NULL,
  reason            varchar(32) NOT NULL,
  note              text,
  status            varchar(16) NOT NULL DEFAULT 'open',
  resolved_by       uuid,
  resolved_at       timestamptz,
  resolution_note   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feed_reports_target CHECK (target_type IN ('post', 'comment')),
  CONSTRAINT chk_feed_reports_reason
    CHECK (reason IN ('spam', 'harassment', 'inappropriate', 'misinformation', 'other')),
  CONSTRAINT chk_feed_reports_status CHECK (status IN ('open', 'resolved', 'dismissed')),
  -- đã xử lý thì phải có người xử lý và mốc thời gian (CHECK cặp dạng kéo theo)
  CONSTRAINT chk_feed_reports_resolved_pair
    CHECK (status = 'open' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CONSTRAINT feed_reports_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE feed_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE feed_reports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON feed_reports;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON feed_reports
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (11) COMPOSITE TENANT-FK — 26 ràng buộc, ĐẶT SAU khi RLS+FORCE+policy đã bật trên cả 10 bảng
--      (BẤT BIẾN 1: RLS TRƯỚC mọi FK/GRANT/dữ liệu — khuôn 0559).
--      deltype 'a' = NO ACTION (19 dòng) · 'n' = SET NULL (col) (7 dòng, TOÀN BỘ là cột nullable).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE feed_posts
  ADD CONSTRAINT feed_posts_author_user_tenant_fk FOREIGN KEY (company_id, author_user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_posts_author_employee_tenant_fk FOREIGN KEY (company_id, author_employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_posts_org_unit_tenant_fk FOREIGN KEY (company_id, org_unit_id)
    REFERENCES org_units (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_posts_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT feed_posts_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT feed_posts_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
ALTER TABLE feed_comments
  ADD CONSTRAINT feed_comments_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_comments_parent_tenant_fk FOREIGN KEY (company_id, parent_comment_id)
    REFERENCES feed_comments (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_comments_author_user_tenant_fk FOREIGN KEY (company_id, author_user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_comments_author_employee_tenant_fk FOREIGN KEY (company_id, author_employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_comments_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT feed_comments_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT feed_comments_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
ALTER TABLE feed_post_tags
  ADD CONSTRAINT feed_post_tags_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_post_tags_tag_tenant_fk FOREIGN KEY (company_id, tag_id)
    REFERENCES feed_tags (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
-- feed_reactions.target_id KHÔNG có FK (đa hình) — chỉ user_id. Cột NOT NULL ⇒ NO ACTION (§4.2b).
ALTER TABLE feed_reactions
  ADD CONSTRAINT feed_reactions_user_tenant_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
-- feed_mentions: bảng chỉ-INSERT/DELETE ⇒ CẢ HAI cột users/employee dùng NO ACTION (§4.2b nhóm 3).
ALTER TABLE feed_mentions
  ADD CONSTRAINT feed_mentions_user_tenant_fk FOREIGN KEY (company_id, mentioned_user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_mentions_employee_tenant_fk FOREIGN KEY (company_id, mentioned_employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_saved_posts
  ADD CONSTRAINT feed_saved_posts_user_tenant_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_saved_posts_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_post_views
  ADD CONSTRAINT feed_post_views_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_post_views_user_tenant_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_post_acks
  ADD CONSTRAINT feed_post_acks_post_tenant_fk FOREIGN KEY (company_id, post_id)
    REFERENCES feed_posts (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_post_acks_user_tenant_fk FOREIGN KEY (company_id, user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
ALTER TABLE feed_reports
  ADD CONSTRAINT feed_reports_reporter_tenant_fk FOREIGN KEY (company_id, reporter_user_id)
    REFERENCES users (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT feed_reports_resolved_by_tenant_fk FOREIGN KEY (company_id, resolved_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (resolved_by);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (12) search_vector — PHƯƠNG ÁN A (DB-17 §6.1b): TÁI DÙNG public.f_unaccent (0538), KHÔNG tạo hàm mới.
--      schema-qualify TUYỆT ĐỐI — cột sinh neo vào OID hàm (xem header).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE feed_posts ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', public.f_unaccent(coalesce(body, '')))) STORED;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (13) INDEX — DB-17 §6.1–§6.10 + 2 index mốc sắp xếp của plan §0.5
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE INDEX idx_feed_posts_company_created ON feed_posts (company_id, created_at DESC)
  WHERE deleted_at IS NULL AND status = 'published';
--> statement-breakpoint
CREATE INDEX idx_feed_posts_company_group ON feed_posts (company_id, group_id, created_at DESC)
  WHERE deleted_at IS NULL AND group_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_feed_posts_company_org ON feed_posts (company_id, org_unit_id, created_at DESC)
  WHERE deleted_at IS NULL AND org_unit_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_feed_posts_company_type ON feed_posts (company_id, type, created_at DESC)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_feed_posts_company_pinned ON feed_posts (company_id, created_at DESC)
  WHERE deleted_at IS NULL AND pinned = true;
--> statement-breakpoint
CREATE INDEX idx_feed_posts_company_author ON feed_posts (company_id, author_user_id, created_at DESC)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- plan §0.5 — keyset của BE-1: «Hoạt động mới» (last_activity_at,id) · «Mới đăng» (published_at,id)
CREATE INDEX idx_feed_posts_company_activity ON feed_posts (company_id, last_activity_at DESC, id)
  WHERE deleted_at IS NULL AND status = 'published';
--> statement-breakpoint
CREATE INDEX idx_feed_posts_company_published ON feed_posts (company_id, published_at DESC, id)
  WHERE deleted_at IS NULL AND status = 'published';
--> statement-breakpoint
CREATE INDEX idx_feed_posts_search ON feed_posts USING GIN (search_vector);
--> statement-breakpoint
CREATE INDEX idx_feed_comments_company_post ON feed_comments (company_id, post_id, created_at)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_feed_comments_company_parent ON feed_comments (company_id, parent_comment_id)
  WHERE deleted_at IS NULL AND parent_comment_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_feed_tags_company_usage ON feed_tags (company_id, usage_count DESC);
--> statement-breakpoint
CREATE INDEX idx_feed_post_tags_company_tag ON feed_post_tags (company_id, tag_id);
--> statement-breakpoint
CREATE INDEX idx_feed_reactions_company_target ON feed_reactions (company_id, target_type, target_id);
--> statement-breakpoint
CREATE INDEX idx_feed_mentions_company_user ON feed_mentions (company_id, mentioned_user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_feed_saved_posts_company_user ON feed_saved_posts (company_id, user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_feed_post_views_company_post ON feed_post_views (company_id, post_id);
--> statement-breakpoint
CREATE INDEX idx_feed_post_acks_company_post ON feed_post_acks (company_id, post_id);
--> statement-breakpoint
-- một người báo cáo một đối tượng một lần khi còn 'open' (partial UNIQUE INDEX — KHÔNG pg_constraint)
CREATE UNIQUE INDEX feed_reports_open_uq ON feed_reports (company_id, target_type, target_id, reporter_user_id)
  WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX idx_feed_reports_company_status ON feed_reports (company_id, status, created_at DESC);
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (14) GRANT theo DB-17 §4.9 — phát MỘT LẦN đúng bộ verb, KHÔNG GRANT-rồi-REVOKE
--      (revoke-table-grant-wipes-column-grants). KHÔNG bảng nào có DELETE ngoài 4 bảng tương tác cá
--      nhân/gán-lại của §4.9. mediaos_worker: CHỈ feed_posts (DB-17 §4.3 — job đóng bình chọn của
--      Track B sẽ tự thêm feed_polls/options/votes ở DB-2).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE ON feed_posts TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON feed_posts TO mediaos_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_comments TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_tags TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON feed_post_tags TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON feed_reactions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON feed_mentions TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON feed_saved_posts TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON feed_post_views TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON feed_post_acks TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON feed_reports TO mediaos_app;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (15) VERIFY fail-LOUD (RAISE EXCEPTION) — mọi assert có vế DƯƠNG đúng-bằng (khuôn 0559 (9)).
--      Migrator chạy 1 transaction ⇒ EXCEPTION = rollback sạch cả 10 bảng.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_tables   CONSTANT text[] := ARRAY['feed_posts', 'feed_comments', 'feed_tags', 'feed_post_tags',
                                      'feed_reactions', 'feed_mentions', 'feed_saved_posts',
                                      'feed_post_views', 'feed_post_acks', 'feed_reports'];
  -- ⚠️ Chuỗi này là pg_get_expr RENDER LẠI, KHÔNG phải chữ ta viết trong CREATE TABLE: PG bọc thêm
  --    một lớp ngoặc quanh NULLIF và thêm ::text cho hằng. So đúng-bằng nên phải chép ĐÚNG bản render.
  v_guc      CONSTANT text := '(NULLIF(current_setting(''app.current_company_id''::text, true), ''''::text))::uuid';
  t          text;
  v_n        int;
  v_privs    text[];
  v_exp      text[];
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
      RAISE EXCEPTION '[0577] verify: % thieu ENABLE/FORCE ROW LEVEL SECURITY', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = t::regclass AND polname = 'tenant_isolation'
         AND pg_get_expr(polqual, polrelid)      LIKE '%app.current_company_id%'
         AND pg_get_expr(polwithcheck, polrelid) LIKE '%app.current_company_id%'
    ) THEN
      RAISE EXCEPTION '[0577] verify: % thieu policy tenant_isolation USING+WITH CHECK theo GUC', t;
    END IF;
  END LOOP;

  -- (1b) company_id NOT NULL + DEFAULT literal-GUC trên CẢ 10 BẢNG — so ĐÚNG CHUỖI pg_get_expr.
  --      Thiếu default ⇒ đường ghi dựa vào GUC ăn 23502 và currentCompanyDefault ở schema/social.ts
  --      lệch parity với DB (plan §4).
  FOREACH t IN ARRAY v_tables LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = t::regclass AND a.attname = 'company_id' AND a.attnum > 0 AND NOT a.attisdropped;
    IF v_def IS DISTINCT FROM v_guc THEN
      RAISE EXCEPTION '[0577] verify: DEFAULT cua %.company_id = % — ky vong %',
        t, COALESCE(v_def, '<NULL>'), v_guc;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = t::regclass AND attname = 'company_id' AND attnotnull
    ) THEN
      RAISE EXCEPTION '[0577] verify: %.company_id khong NOT NULL', t;
    END IF;
  END LOOP;

  -- (2) GRANT bằng aclexplode (KHÔNG information_schema — 0540:137-139), đúng-bằng DB-17 §4.9.
  FOR r IN SELECT * FROM (VALUES
      ('feed_posts',       ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_comments',    ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_tags',        ARRAY['INSERT', 'SELECT', 'UPDATE']),
      ('feed_post_tags',   ARRAY['DELETE', 'INSERT', 'SELECT']),
      ('feed_reactions',   ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']),
      ('feed_mentions',    ARRAY['DELETE', 'INSERT', 'SELECT']),
      ('feed_saved_posts', ARRAY['DELETE', 'INSERT', 'SELECT']),
      ('feed_post_views',  ARRAY['INSERT', 'SELECT']),
      ('feed_post_acks',   ARRAY['INSERT', 'SELECT']),
      ('feed_reports',     ARRAY['INSERT', 'SELECT', 'UPDATE'])
    ) AS v(tbl, privs)
  LOOP
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = r.tbl::regclass AND x.grantee = 'mediaos_app'::regrole;
    IF v_privs IS DISTINCT FROM r.privs THEN
      RAISE EXCEPTION '[0577] verify: ACL cap bang cua mediaos_app tren % = % — ky vong % (DB-17 §4.9)',
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
      RAISE EXCEPTION '[0577] verify: % co % column-ACL cho mediaos_app — Track A grant o CAP BANG', t, v_n;
    END IF;
  END LOOP;

  -- (2b) BẤT BIẾN #2 đích danh: app role 0 quyền UPDATE/DELETE (bảng LẪN cột) trên 2 sổ append-only.
  FOREACH t IN ARRAY ARRAY['feed_post_views', 'feed_post_acks'] LOOP
    SELECT count(*) INTO v_n FROM (
      SELECT x.privilege_type
        FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
       WHERE c.oid = t::regclass AND x.grantee = 'mediaos_app'::regrole
         AND x.privilege_type IN ('UPDATE', 'DELETE')
      UNION ALL
      SELECT x.privilege_type
        FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
       WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
         AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type IN ('UPDATE', 'DELETE')
    ) z;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0577] verify: % co % quyen UPDATE/DELETE cho app — pha append-only (bat bien #2)', t, v_n;
    END IF;
  END LOOP;

  -- (2c) worker: ĐÚNG {SELECT} trên feed_posts, KHÔNG ACL nào trên 9 bảng còn lại (DB-17 §4.3).
  SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
   WHERE c.oid = 'feed_posts'::regclass AND x.grantee = 'mediaos_worker'::regrole;
  IF v_privs IS DISTINCT FROM ARRAY['SELECT'] THEN
    RAISE EXCEPTION '[0577] verify: ACL cua mediaos_worker tren feed_posts = % — ky vong {SELECT}', v_privs;
  END IF;
  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
   WHERE c.oid::regclass::text = ANY (v_tables) AND c.oid <> 'feed_posts'::regclass
     AND x.grantee = 'mediaos_worker'::regrole;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0577] verify: mediaos_worker co % ACL ngoai feed_posts — ky vong 0 (DB-17 §4.3)', v_n;
  END IF;

  -- (3) COMPOSITE FK — DƯƠNG đúng-bằng 26 dòng (bảng, cột, đích, deltype, setcols). Thiếu/thừa ⇒ đỏ.
  --     ⚠️ CON SỐ TRẦN KHÔNG ĐỦ (plan §4.11): bản plan đầu ghi "20" vì bỏ sót 6 cột vết-kiểm-toán của
  --     feed_posts/feed_comments; "sửa cho khớp 20" bằng cách bỏ 6 FK audit ⇒ created_by của tenant A
  --     trỏ được sang users của tenant B và KHÔNG lưới nào bắt (0559:613 — census chỉ đếm FK ĐANG
  --     TỒN TẠI; xtenant-fk-ratchet chỉ soi FK MỘT-CỘT, mà bảng kiểu này không có FK một-cột nào).
  --     deltype: 'a' = NO ACTION · 'n' = SET NULL. conkey[1] ↔ confkey[1] (company_id), [2] (col ↔ id).
  --     ⚠️ feed_posts.group_id CỐ Ý VẮNG khỏi bảng này — §0.2, nợ đăng ký cho DB-2, cổng ở §7.5 int-spec.
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
        ('feed_posts',       'author_user_id',        'users',             'a', ARRAY[]::text[]),
        ('feed_posts',       'author_employee_id',    'employee_profiles', 'a', ARRAY[]::text[]),
        ('feed_posts',       'org_unit_id',           'org_units',         'a', ARRAY[]::text[]),
        ('feed_posts',       'created_by',            'users',             'n', ARRAY['created_by']),
        ('feed_posts',       'updated_by',            'users',             'n', ARRAY['updated_by']),
        ('feed_posts',       'deleted_by',            'users',             'n', ARRAY['deleted_by']),
        ('feed_comments',    'post_id',               'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_comments',    'parent_comment_id',     'feed_comments',     'a', ARRAY[]::text[]),
        ('feed_comments',    'author_user_id',        'users',             'a', ARRAY[]::text[]),
        ('feed_comments',    'author_employee_id',    'employee_profiles', 'a', ARRAY[]::text[]),
        ('feed_comments',    'created_by',            'users',             'n', ARRAY['created_by']),
        ('feed_comments',    'updated_by',            'users',             'n', ARRAY['updated_by']),
        ('feed_comments',    'deleted_by',            'users',             'n', ARRAY['deleted_by']),
        ('feed_post_tags',   'post_id',               'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_post_tags',   'tag_id',                'feed_tags',         'a', ARRAY[]::text[]),
        ('feed_reactions',   'user_id',               'users',             'a', ARRAY[]::text[]),
        ('feed_mentions',    'mentioned_user_id',     'users',             'a', ARRAY[]::text[]),
        ('feed_mentions',    'mentioned_employee_id', 'employee_profiles', 'a', ARRAY[]::text[]),
        ('feed_saved_posts', 'user_id',               'users',             'a', ARRAY[]::text[]),
        ('feed_saved_posts', 'post_id',               'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_post_views',  'post_id',               'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_post_views',  'user_id',               'users',             'a', ARRAY[]::text[]),
        ('feed_post_acks',   'post_id',               'feed_posts',        'a', ARRAY[]::text[]),
        ('feed_post_acks',   'user_id',               'users',             'a', ARRAY[]::text[]),
        ('feed_reports',     'reporter_user_id',      'users',             'a', ARRAY[]::text[]),
        ('feed_reports',     'resolved_by',           'users',             'n', ARRAY['resolved_by'])
      )
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0577] verify: composite FK LECH so voi 26 dong ky vong (thieu/thua): %', v_bad;
  END IF;

  -- (3a) MỌI FK ≥ 2 cột trên 10 bảng phải = 26 — bộ lọc "đúng hình dạng" ở trên RỚT FK lệch hình dạng
  --      khỏi CẢ HAI vế EXCEPT; đếm thô bịt lại (khuôn 0559 (3a')).
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables) AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 26 THEN
    RAISE EXCEPTION '[0577] verify: co % FK >= 2 cot tren 10 bang feed, ky vong dung 26 — co FK lech hinh dang', v_n;
  END IF;

  -- (3b) 0 FK một-cột từ 10 bảng tới bảng ≠ companies (đúng lớp lỗ KI-046)
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables)
     AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0577] verify: con % FK MOT COT tu bang feed toi bang khac companies — phai composite', v_n;
  END IF;

  -- (3c) §0.2 tường minh: feed_posts.group_id KHÔNG có FK nào ở DB-1 (nợ đăng ký cho DB-2).
  --      Assert DƯƠNG để không ai "tiện tay" trỏ sang bảng khác.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid = 'feed_posts'::regclass
     AND (SELECT a.attname FROM pg_attribute a
           WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey) AND a.attname = 'group_id') IS NOT NULL;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0577] verify: feed_posts.group_id co % FK — DB-1 KHONG duoc tao (feed_groups = Track B, §0.2)', v_n;
  END IF;

  -- (4) CHECK constraint — đúng-bằng 22 (13 posts + 2 comments + 1 reactions + 1 mentions + 1 tags
  --     + 4 reports). Thừa = ai đó thêm CHECK ngoài thiết kế; thiếu = rơi CHECK cặp.
  --     ⚠️ feed_reactions PHẢI đúng 1 CHECK (target_type) — CHECK thứ hai nghĩa là có người thêm CHECK
  --     emoji, đúng thứ DB-17 §6.3 cấm (nguồn sự thật thứ hai).
  FOR r IN SELECT * FROM (VALUES
      ('feed_posts', 13), ('feed_comments', 2), ('feed_tags', 1), ('feed_post_tags', 0),
      ('feed_reactions', 1), ('feed_mentions', 1), ('feed_saved_posts', 0),
      ('feed_post_views', 0), ('feed_post_acks', 0), ('feed_reports', 4)
    ) AS v(tbl, n)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c WHERE c.conrelid = r.tbl::regclass AND c.contype = 'c';
    IF v_n <> r.n THEN
      RAISE EXCEPTION '[0577] verify: % co % CHECK, ky vong dung % (DB-17 §6)', r.tbl, v_n, r.n;
    END IF;
  END LOOP;

  -- (4a) feed_reactions.emoji KHÔNG được có CHECK nào NHẮC TỚI nó — assert đích danh, vì (4) chỉ đếm.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.conrelid = 'feed_reactions'::regclass AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) LIKE '%emoji%';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0577] verify: feed_reactions co % CHECK nhac toi emoji — DB-17 §6.3 CAM (nguon su that thu hai)', v_n;
  END IF;

  -- (5) PK tổ hợp (contype='p') của 4 bảng quan hệ — KHÔNG viết contype='u' trơn (plan §7.6):
  --     lẫn loại ⇒ hoặc đỏ oan, hoặc đẻ một UNIQUE trùng PK.
  FOR r IN SELECT * FROM (VALUES
      ('feed_post_tags',   ARRAY['company_id', 'post_id', 'tag_id']),
      ('feed_saved_posts', ARRAY['company_id', 'post_id', 'user_id']),
      ('feed_post_views',  ARRAY['company_id', 'post_id', 'user_id']),
      ('feed_post_acks',   ARRAY['company_id', 'post_id', 'user_id'])
    ) AS v(tbl, cols)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = r.tbl::regclass AND c.contype = 'p'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = r.cols;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0577] verify: % thieu PRIMARY KEY to hop % (dem duoc %)', r.tbl, r.cols, v_n;
    END IF;
  END LOOP;

  -- (6) UNIQUE constraint (contype='u') — đúng-bằng theo tên + cột
  FOR r IN SELECT * FROM (VALUES
      ('feed_posts_company_id_id_uq',    'feed_posts',     ARRAY['company_id', 'id']),
      ('feed_comments_company_id_id_uq', 'feed_comments',  ARRAY['company_id', 'id']),
      ('feed_tags_company_id_id_uq',     'feed_tags',      ARRAY['company_id', 'id']),
      ('feed_tags_company_tag_uq',       'feed_tags',      ARRAY['company_id', 'tag']),
      ('feed_reports_company_id_id_uq',  'feed_reports',   ARRAY['company_id', 'id']),
      ('feed_reactions_target_user_uq',  'feed_reactions', ARRAY['company_id', 'target_id', 'target_type', 'user_id']),
      ('feed_mentions_uq',               'feed_mentions',  ARRAY['company_id', 'mentioned_user_id', 'target_id', 'target_type'])
    ) AS v(con, tbl, cols)
  LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conname = r.con AND c.conrelid = r.tbl::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = r.cols;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0577] verify: UNIQUE % tren % (%) khong dung (dem duoc %)', r.con, r.tbl, r.cols, v_n;
    END IF;
  END LOOP;

  -- (7) partial unique INDEX feed_reports_open_uq — KHÔNG có trong pg_constraint; so ĐÚNG CHUỖI
  --     pg_get_expr(indpred) (KHÔNG ILIKE '%WHERE%' — khuôn 0559 (5)).
  SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
    FROM pg_index i WHERE i.indexrelid = 'feed_reports_open_uq'::regclass AND i.indisunique;
  IF NOT FOUND THEN
    RAISE EXCEPTION '[0577] verify: index feed_reports_open_uq khong ton tai hoac khong UNIQUE';
  END IF;
  IF v_pred IS DISTINCT FROM '((status)::text = ''open''::text)' THEN
    RAISE EXCEPTION '[0577] verify: predicate cua feed_reports_open_uq = % — ky vong ((status)::text = ''open''::text)',
      COALESCE(v_pred, '<NULL>');
  END IF;

  -- (8) search_vector: cột SINH (attgenerated='s') và biểu thức NEO public.f_unaccent — nhánh "bỏ cột"
  --     bị CẤM (DB-17 §6.1b: đẻ hình dạng schema thứ ba ⇒ drizzle drift + contracts optional theo môi trường).
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
    FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attrelid = 'feed_posts'::regclass AND a.attname = 'search_vector' AND a.attgenerated = 's';
  IF v_def IS NULL THEN
    RAISE EXCEPTION '[0577] verify: feed_posts.search_vector khong phai cot SINH (STORED) — xem DB-17 §6.1b';
  END IF;
  IF v_def NOT LIKE '%f_unaccent%' THEN
    RAISE EXCEPTION '[0577] verify: bieu thuc search_vector = % — ky vong co public.f_unaccent (phuong an A)', v_def;
  END IF;

  -- (9) 20 index theo tên (9 feed_posts + 11 còn lại). Thiếu index = đường đọc của BE-1 quét bảng.
  FOREACH t IN ARRAY ARRAY['idx_feed_posts_company_created', 'idx_feed_posts_company_group',
                           'idx_feed_posts_company_org', 'idx_feed_posts_company_type',
                           'idx_feed_posts_company_pinned', 'idx_feed_posts_company_author',
                           'idx_feed_posts_company_activity', 'idx_feed_posts_company_published',
                           'idx_feed_posts_search', 'idx_feed_comments_company_post',
                           'idx_feed_comments_company_parent', 'idx_feed_tags_company_usage',
                           'idx_feed_post_tags_company_tag', 'idx_feed_reactions_company_target',
                           'idx_feed_mentions_company_user', 'idx_feed_saved_posts_company_user',
                           'idx_feed_post_views_company_post', 'idx_feed_post_acks_company_post',
                           'feed_reports_open_uq', 'idx_feed_reports_company_status'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '[0577] verify: index % khong ton tai', t;
    END IF;
  END LOOP;

  -- (10) 2 cột mốc sắp xếp (§0.5) tồn tại, NOT NULL, DEFAULT now() — BE-1 keyset dựa vào cả ba tính chất.
  FOREACH t IN ARRAY ARRAY['published_at', 'last_activity_at'] LOOP
    SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'feed_posts'::regclass AND a.attname = t AND a.attnotnull;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[0577] verify: feed_posts.% khong ton tai hoac khong NOT NULL (plan §0.5)', t;
    END IF;
    IF v_def IS DISTINCT FROM 'now()' THEN
      RAISE EXCEPTION '[0577] verify: DEFAULT cua feed_posts.% = % — ky vong now()', t, COALESCE(v_def, '<NULL>');
    END IF;
  END LOOP;

  RAISE NOTICE '[0577] verify PASS: 10 bang RLS+FORCE · company_id DEFAULT literal-GUC · ACL §4.9 (2 so append-only) · 26 composite FK · 22 CHECK · 4 PK to hop + 7 UNIQUE + 1 partial-unique · search_vector A · 20 index';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy). Thứ tự con → cha.
-- DROP TABLE IF EXISTS feed_reports;
-- DROP TABLE IF EXISTS feed_mentions;
-- DROP TABLE IF EXISTS feed_reactions;
-- DROP TABLE IF EXISTS feed_post_acks;
-- DROP TABLE IF EXISTS feed_post_views;
-- DROP TABLE IF EXISTS feed_saved_posts;
-- DROP TABLE IF EXISTS feed_post_tags;
-- DROP TABLE IF EXISTS feed_comments;
-- DROP TABLE IF EXISTS feed_posts;
-- DROP TABLE IF EXISTS feed_tags;
-- -- + gỡ 10 dòng cleanupTenants() + 10 case rls-registry + 10 tên PROTECTED_TABLES
-- --   + schema/social.ts + packages/contracts/src/social.ts cùng lúc.
