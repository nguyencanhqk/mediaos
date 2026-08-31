-- Migration 0559: S12-RECRUIT-DB-1 (🔴 RED, zone=red, crown) — RECRUIT Core (DB-14 §6.1–6.8, bước A §9).
--
-- MỤC TIÊU (plan docs/plans/S12-RECRUIT-DB-1.md §2): BUILD 8 bảng MỚI của module RECRUIT (SPEC-12):
--   • job_openings           — vị trí tuyển, FSM 4 trạng thái ép ở service (mutable, soft-delete).
--   • candidates             — hồ sơ ứng viên, PII mask ở SERVER; stage là CỘT, lịch sử là SỔ (mutable,
--                              soft-delete). employee_id UNIQUE partial = CHỐT CUỐI double-convert.
--   • candidate_stage_events — SỔ chuyển stage, APPEND-ONLY TUYỆT ĐỐI (SELECT + INSERT, 0 UPDATE/DELETE).
--   • candidate_notes        — ghi chú nội bộ (mutable, soft-delete; sửa/xoá "của mình" ép ở service).
--   • interviews             — lượt phỏng vấn, FSM 3 trạng thái (không soft-delete — huỷ = 'Cancelled').
--   • interview_participants — interviewer của lượt, CHỈ INSERT (đổi người = huỷ lượt + tạo lượt mới).
--   • interview_feedbacks    — đánh giá per-interviewer (SELECT/INSERT + UPDATE CẤP CỘT; unique per lượt×người).
--   • offers                 — offer, FSM 5 trạng thái; `salary` mask theo ('manage','offer') ở service.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 company_id NOT NULL + DEFAULT literal-GUC + RLS ENABLE + FORCE + policy tenant_isolation (USING +
--      WITH CHECK) TẠO TRƯỚC mọi INSERT — nguyên văn mẫu 0479/0549. MỌI FK chéo bảng nghiệp vụ là COMPOSITE
--      tenant FK (company_id, col) → parent (company_id, id) (khuôn 0535/0549) — KHÔNG FK một-cột nào ngoài
--      company_id → companies (kiểm tra FK của Postgres KHÔNG áp RLS — KI-046). Verify (3) DƯƠNG đúng-bằng
--      27 composite FK: quên hẳn FK thì census/ratchet IM LẶNG (chỉ đếm FK đang tồn tại).
--   #2 candidate_stage_events: GRANT SELECT, INSERT — **KHÔNG UPDATE, KHÔNG DELETE** (sổ append-only, DB-14
--      §6.3). interview_participants: SELECT, INSERT. interview_feedbacks/offers: SELECT, INSERT + UPDATE
--      CẤP CỘT (allowlist §6.7/§6.8) — KHÔNG GRANT UPDATE cấp bảng rồi thu hồi
--      (revoke-table-grant-wipes-column-grants). 4 bảng mutable: SELECT/INSERT/UPDATE. **0 DELETE cả 8 bảng**
--      (soft delete = UPDATE deleted_at). Verify bằng aclexplode(relacl/attacl) — KHÔNG information_schema.
--      `acted_by` của sổ chỉ-INSERT = ON DELETE **NO ACTION** (KHÔNG SET NULL): RI action chạy ở tầng owner,
--      bỏ qua allowlist cột ⇒ SET NULL sẽ ghi đè đúng cột cố ý không grant (đính chính 0549, DB-14 §4.2).
--      Bảng mutable giữ SET NULL (col) — PHẢI liệt kê cột: SET NULL trần null luôn company_id (0535:682).
--   #3 module không lưu secret; PII ứng viên (email/phone) + offers.salary che ở SERVER theo cặp quyền
--      (SPEC-12 §18) — DB lưu thô, masking là việc của service; CV đi Foundation Files private.
--   • FK nội bộ ON DELETE NO ACTION (kiểm cuối câu lệnh) — TUYỆT ĐỐI KHÔNG RESTRICT: cascade từ companies xoá
--     candidates và interviews theo thứ tự anh em bất định ⇒ RESTRICT nổ giữa chừng ⇒ cleanupTenants() chết,
--     đỏ hàng loạt afterAll (DB-14 §4.2, bài học DB-15 §4.2). company_id → companies ON DELETE CASCADE.
--   • DDL thủ công — KHÔNG db:generate (sẽ DROP schema media/finance đang park). schema/recruit.ts PARITY-only.
--   • KHÔNG seed sequence_counters: convert dùng lại counter `employee_code` của HR (ensure-on-miss) — DB-14 §9.
--   • Ứng viên là người NGOÀI hệ thống ⇒ candidates KHÔNG có FK sang users. Danh tính nội bộ (recruiter,
--     interviewer) FK users/employee_profiles chuẩn.
--
-- BAND 0559 (lane S12-RECRUIT-DB-1). Journal: idx 226, when 1717587348000 (> 0558 idx 225 / 1717587347000).
--   Cùng commit: schema/recruit.ts + schema/index.ts · test/helpers/seed.ts cleanupTenants() (8 bảng con→cha,
--   TRƯỚC `DELETE FROM users`) · test/integration/rls-registry.ts (8 case) · packages/contracts/src/recruit.ts.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (0) TIỀN KIỂM fail-loud ───────────────
DO $$
DECLARE
  t   text;
  v_n int;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);

  -- SET NULL (col) trên FK composite cần PG >= 15 (đã dùng ở 0535/0549 trên chính cụm này).
  IF current_setting('server_version_num')::int < 150000 THEN
    RAISE EXCEPTION '[0559] can PostgreSQL >= 15 cho ON DELETE SET NULL (col) — server_version_num = %',
      current_setting('server_version_num');
  END IF;

  -- Bảng ĐÍCH của composite FK phải có UNIQUE (company_id, id). KHÔNG tự tạo (bảng thuộc lane khác).
  FOREACH t IN ARRAY ARRAY['users', 'employee_profiles', 'org_units', 'positions'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
              FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0559] % thieu UNIQUE (company_id, id) (dem duoc %) — chay truoc: '
                      'ALTER TABLE % ADD CONSTRAINT %_company_id_id_uq UNIQUE (company_id, id);', t, v_n, t, t;
    END IF;
  END LOOP;

  -- 8 bảng chưa được tồn tại (đụng tên = có lane khác dựng song song — DỪNG).
  FOREACH t IN ARRAY ARRAY['job_openings', 'candidates', 'candidate_stage_events', 'candidate_notes',
                           'interviews', 'interview_participants', 'interview_feedbacks', 'offers'] LOOP
    IF to_regclass(t) IS NOT NULL THEN
      RAISE EXCEPTION '[0559] bang % DA TON TAI — dung ten voi lane khac, abort', t;
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- ─────────────── 1. job_openings (DB-14 §6.1 — mutable, soft-delete) ───────────────
CREATE TABLE job_openings (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  title              varchar(255) NOT NULL,
  description        text,
  org_unit_id        uuid NOT NULL,
  position_id        uuid,
  headcount          integer NOT NULL DEFAULT 1,
  -- đổi ⇒ NOTI-EVENT-016 RECRUIT_JOB_ASSIGNED (dedupeKey theo LẦN gán, SPEC-12 §17).
  recruiter_user_id  uuid,
  -- Draft/Open/Paused/Closed — FSM ép ở service (SPEC-01 §17.12), DB chỉ CHECK tập giá trị.
  status             varchar(20) NOT NULL DEFAULT 'Draft',
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid,
  -- M9 (DB-14 §6.2): v1 KHÔNG có endpoint xoá ⇒ cột chưa có đường ghi, CÓ CHỦ ĐÍCH (chuẩn §16.2 +
  -- PARK-RECRUIT-001 mở đường xoá sau) — KHÔNG áp luật write-only-column-means-delete-not-wire-up.
  deleted_at         timestamptz,
  deleted_by         uuid,
  CONSTRAINT chk_job_openings_status    CHECK (status IN ('Draft', 'Open', 'Paused', 'Closed')),
  CONSTRAINT chk_job_openings_headcount CHECK (headcount > 0),
  CONSTRAINT job_openings_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE job_openings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE job_openings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON job_openings;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON job_openings
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE job_openings
  ADD CONSTRAINT job_openings_org_unit_tenant_fk FOREIGN KEY (company_id, org_unit_id)
    REFERENCES org_units (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT job_openings_position_tenant_fk FOREIGN KEY (company_id, position_id)
    REFERENCES positions (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT job_openings_recruiter_tenant_fk FOREIGN KEY (company_id, recruiter_user_id)
    REFERENCES users (company_id, id) ON DELETE SET NULL (recruiter_user_id),
  ADD CONSTRAINT job_openings_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT job_openings_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT job_openings_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE INDEX idx_job_openings_company_status ON job_openings (company_id, status) WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_job_openings_company_org ON job_openings (company_id, org_unit_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON job_openings TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON job_openings TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 2. candidates (DB-14 §6.2 — mutable, soft-delete; PII mask ở SERVER) ───────────────
CREATE TABLE candidates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL
                    DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                    REFERENCES companies(id) ON DELETE CASCADE,
  job_opening_id  uuid NOT NULL,
  full_name       varchar(255) NOT NULL,
  -- PII — mask ở SERVER (SPEC-12 §18). CỐ Ý KHÔNG UNIQUE (§4.8): ứng viên nộp lại sau 6 tháng là hợp lệ,
  -- trùng chỉ là CẢNH BÁO MỀM (RECRUIT-FUNC-003).
  email           varchar(255),
  phone           varchar(30),
  source          varchar(120),
  note            text,
  -- New/Screening/Interview/Offer/Hired/Rejected (SPEC-01 §17.11) — FSM ép ở service; Hired chỉ qua convert.
  stage           varchar(20) NOT NULL DEFAULT 'New',
  -- link convert → employee_profiles (DB-14 gọi `employees`; code thật là employee_profiles — erd A2).
  employee_id     uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  -- M9: v1 chưa có endpoint xoá (xem ghi chú job_openings) — REC-DEC-007 giữ cột theo chuẩn §16.2.
  deleted_at      timestamptz,
  deleted_by      uuid,
  CONSTRAINT chk_candidates_stage CHECK (
    stage IN ('New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected')
  ),
  CONSTRAINT candidates_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidates FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON candidates;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON candidates
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE candidates
  ADD CONSTRAINT candidates_job_opening_tenant_fk FOREIGN KEY (company_id, job_opening_id)
    REFERENCES job_openings (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT candidates_employee_tenant_fk FOREIGN KEY (company_id, employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT candidates_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT candidates_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT candidates_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
-- CHỐT CUỐI REC-DEC-005: một nhân viên chỉ link về ĐÚNG MỘT ứng viên. CỐ Ý **KHÔNG** partial theo deleted_at —
-- hồ sơ đã xoá mềm vẫn giữ chỗ link (race 2 convert song song đúng-1-thắng ⇒ 23505 → RECRUIT-ERR-008).
CREATE UNIQUE INDEX uq_candidates_company_employee
  ON candidates (company_id, employee_id) WHERE employee_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_candidates_company_stage_job
  ON candidates (company_id, stage, job_opening_id) WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Check-duplicate (RECRUIT-API-008): index đúng BIỂU THỨC mà service so sánh — khác một ký tự là planner bỏ
-- index. CỐ Ý KHÔNG partial theo deleted_at: cảnh báo trùng tính CẢ hồ sơ đã xoá mềm (FE hiện "hồ sơ cũ").
CREATE INDEX idx_candidates_company_email_expr
  ON candidates (company_id, lower(email)) WHERE email IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_candidates_company_phone_norm
  ON candidates (company_id, regexp_replace(phone, '[^0-9+]', '', 'g')) WHERE phone IS NOT NULL;
--> statement-breakpoint
-- GRANT UPDATE **cấp bảng** là chấp nhận CÓ CHỦ ĐÍCH (DB-14 §6.2 / plan-review H6): `stage` và `employee_id`
-- PHẢI ghi được bởi chính app role (move-stage/convert là đường ghi hợp lệ đi qua cùng role) — column-grant
-- không phân biệt được "đường đi" nên không mua thêm an toàn. Bất biến giữ bằng: một service method duy nhất
-- (moveStage/convert) + uq_candidates_company_employee + sổ candidate_stage_events append-only.
GRANT SELECT, INSERT, UPDATE ON candidates TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON candidates TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 3. candidate_stage_events (DB-14 §6.3 — SỔ APPEND-ONLY TUYỆT ĐỐI) ───────────────
CREATE TABLE candidate_stage_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL,
  from_stage    varchar(20) NOT NULL,
  to_stage      varchar(20) NOT NULL,
  -- 'move' (đổi stage tay) / 'convert' (hàng convert LUÔN là Offer → Hired).
  action        varchar(10) NOT NULL,
  -- BẮT BUỘC (SPEC-12 §13.1) — timeline không có lý do là timeline nói dối.
  reason        text NOT NULL,
  -- FK users **NO ACTION** (bảng chỉ-INSERT — §4.2): SET NULL sẽ ghi đè cột không có grant UPDATE.
  acted_by      uuid,
  acted_at      timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_cse_from CHECK (
    from_stage IN ('New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected')
  ),
  CONSTRAINT chk_cse_to CHECK (
    to_stage IN ('New', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected')
  ),
  CONSTRAINT chk_cse_moved  CHECK (from_stage <> to_stage),
  CONSTRAINT chk_cse_action CHECK (action IN ('move', 'convert'))
);
--> statement-breakpoint
ALTER TABLE candidate_stage_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_stage_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON candidate_stage_events;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON candidate_stage_events
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE candidate_stage_events
  ADD CONSTRAINT candidate_stage_events_candidate_tenant_fk FOREIGN KEY (company_id, candidate_id)
    REFERENCES candidates (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT candidate_stage_events_acted_by_tenant_fk FOREIGN KEY (company_id, acted_by)
    REFERENCES users (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
CREATE INDEX idx_cse_company_candidate_time
  ON candidate_stage_events (company_id, candidate_id, acted_at DESC);
--> statement-breakpoint
-- BẤT BIẾN #2: SELECT + INSERT DUY NHẤT. Verify (2) dưới ép 0 quyền UPDATE/DELETE (cấp bảng lẫn cấp cột).
GRANT SELECT, INSERT ON candidate_stage_events TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON candidate_stage_events TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 4. candidate_notes (DB-14 §6.4 — mutable, soft-delete "của mình") ───────────────
CREATE TABLE candidate_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL,
  body          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  -- CÓ đường ghi thật (RECRUIT-API-017 xoá ghi chú của mình) — khác job_openings/candidates ở v1.
  deleted_at    timestamptz,
  deleted_by    uuid
);
--> statement-breakpoint
ALTER TABLE candidate_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE candidate_notes FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON candidate_notes;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON candidate_notes
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE candidate_notes
  ADD CONSTRAINT candidate_notes_candidate_tenant_fk FOREIGN KEY (company_id, candidate_id)
    REFERENCES candidates (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT candidate_notes_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT candidate_notes_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by),
  ADD CONSTRAINT candidate_notes_deleted_by_tenant_fk FOREIGN KEY (company_id, deleted_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (deleted_by);
--> statement-breakpoint
CREATE INDEX idx_candidate_notes_company_candidate
  ON candidate_notes (company_id, candidate_id, created_at DESC) WHERE deleted_at IS NULL;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON candidate_notes TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON candidate_notes TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 5. interviews (DB-14 §6.5 — FSM 3 trạng thái, KHÔNG soft-delete) ───────────────
CREATE TABLE interviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL,
  round         integer NOT NULL DEFAULT 1,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  -- text/link tự do (REC-DEC-006) — phòng họp thật là việc của ROOM, RECRUIT không FK sang meeting_rooms.
  location      varchar(500),
  note          text,
  -- Scheduled/Completed/Cancelled (SPEC-01 §17.13) — huỷ = trạng thái, KHÔNG xoá.
  status        varchar(20) NOT NULL DEFAULT 'Scheduled',
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  CONSTRAINT chk_interviews_status CHECK (status IN ('Scheduled', 'Completed', 'Cancelled')),
  -- service kiểm TRƯỚC và trả RECRUIT-ERR-013 (422); CHECK là chốt cuối, không phải đường lỗi chính.
  CONSTRAINT chk_interviews_range  CHECK (ends_at > starts_at),
  CONSTRAINT chk_interviews_round  CHECK (round > 0),
  CONSTRAINT interviews_company_id_id_uq UNIQUE (company_id, id)
);
--> statement-breakpoint
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interviews FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON interviews;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON interviews
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE interviews
  ADD CONSTRAINT interviews_candidate_tenant_fk FOREIGN KEY (company_id, candidate_id)
    REFERENCES candidates (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT interviews_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT interviews_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);
--> statement-breakpoint
CREATE INDEX idx_interviews_company_candidate ON interviews (company_id, candidate_id, starts_at DESC);
--> statement-breakpoint
CREATE INDEX idx_interviews_company_start ON interviews (company_id, starts_at);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON interviews TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON interviews TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 6. interview_participants (DB-14 §6.6 — CHỈ INSERT) ───────────────
CREATE TABLE interview_participants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  interview_id  uuid NOT NULL,
  -- CHÂN của own-scope ('view','interview')@Own + NOTI-EVENT-017. KHÔNG cột FK users nào (DB-14 §4.2).
  employee_id   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE interview_participants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interview_participants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON interview_participants;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON interview_participants
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE interview_participants
  ADD CONSTRAINT interview_participants_interview_tenant_fk FOREIGN KEY (company_id, interview_id)
    REFERENCES interviews (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT interview_participants_employee_tenant_fk FOREIGN KEY (company_id, employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
CREATE UNIQUE INDEX uq_interview_participants
  ON interview_participants (company_id, interview_id, employee_id);
--> statement-breakpoint
-- own-scope ép bằng EXISTS trên bảng này (KHÔNG JOIN — một lượt nhiều interviewer ⇒ JOIN nhân bản hàng,
-- hỏng pagination: partial-unique-index-makes-join-duplicate).
CREATE INDEX idx_interview_participants_employee
  ON interview_participants (company_id, employee_id);
--> statement-breakpoint
-- Đổi người = huỷ lượt + tạo lượt mới (SPEC-12 §3.6) ⇒ KHÔNG UPDATE, KHÔNG DELETE.
GRANT SELECT, INSERT ON interview_participants TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON interview_participants TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 7. interview_feedbacks (DB-14 §6.7 — UPDATE CẤP CỘT) ───────────────
CREATE TABLE interview_feedbacks (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL
                             DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                             REFERENCES companies(id) ON DELETE CASCADE,
  interview_id             uuid NOT NULL,
  -- own-scope: service so employee của caller (RECRUIT-ERR-011). KHÔNG cột FK users (DB-14 §4.2).
  interviewer_employee_id  uuid NOT NULL,
  rating                   smallint NOT NULL,
  comment                  text,
  recommendation           varchar(20) NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_feedback_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT chk_feedback_reco   CHECK (recommendation IN ('Hire', 'No Hire', 'Consider'))
);
--> statement-breakpoint
ALTER TABLE interview_feedbacks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interview_feedbacks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON interview_feedbacks;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON interview_feedbacks
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE interview_feedbacks
  ADD CONSTRAINT interview_feedbacks_interview_tenant_fk FOREIGN KEY (company_id, interview_id)
    REFERENCES interviews (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT interview_feedbacks_interviewer_tenant_fk FOREIGN KEY (company_id, interviewer_employee_id)
    REFERENCES employee_profiles (company_id, id) ON DELETE NO ACTION;
--> statement-breakpoint
-- CHỐT CUỐI RECRUIT-ERR-012: mỗi interviewer đúng một feedback / lượt (POST lần 2 ⇒ 23505, service map 409).
CREATE UNIQUE INDEX uq_interview_feedbacks
  ON interview_feedbacks (company_id, interview_id, interviewer_employee_id);
--> statement-breakpoint
GRANT SELECT, INSERT ON interview_feedbacks TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (rating, comment, recommendation, updated_at) ON interview_feedbacks TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON interview_feedbacks TO mediaos_worker;
--> statement-breakpoint

-- ─────────────── 8. offers (DB-14 §6.8 — UPDATE CẤP CỘT; salary mask ở service) ───────────────
CREATE TABLE offers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL
                  DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                  REFERENCES companies(id) ON DELETE CASCADE,
  candidate_id  uuid NOT NULL,
  title         varchar(255),
  start_date    date NOT NULL,
  -- CHỈ trả cho ('manage','offer') — VẮNG KHOÁ với người khác (SPEC-12 §18). DB lưu thô, mask ở service.
  salary        numeric(18, 2) NOT NULL,
  note          text,
  -- Draft/Sent/Accepted/Declined/Withdrawn (SPEC-01 §17.14).
  status        varchar(20) NOT NULL DEFAULT 'Draft',
  responded_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid,
  CONSTRAINT chk_offers_status CHECK (status IN ('Draft', 'Sent', 'Accepted', 'Declined', 'Withdrawn')),
  CONSTRAINT chk_offers_salary CHECK (salary >= 0),
  -- Terminal ⇒ PHẢI có responded_at; Draft/Sent ⇒ NULL. ⚠️ Hệ quả cho WO BE: "đổi trạng thái sang terminal"
  -- là MỘT câu UPDATE đặt status + responded_at CÙNG LÚC (hai câu rời sẽ 23514 ở câu đầu).
  CONSTRAINT chk_offers_responded_pair CHECK (
    (status IN ('Draft', 'Sent')                        AND responded_at IS NULL) OR
    (status IN ('Accepted', 'Declined', 'Withdrawn')    AND responded_at IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE offers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE offers FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON offers;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON offers
  USING      (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE offers
  ADD CONSTRAINT offers_candidate_tenant_fk FOREIGN KEY (company_id, candidate_id)
    REFERENCES candidates (company_id, id) ON DELETE NO ACTION,
  ADD CONSTRAINT offers_created_by_tenant_fk FOREIGN KEY (company_id, created_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (created_by),
  ADD CONSTRAINT offers_updated_by_tenant_fk FOREIGN KEY (company_id, updated_by)
    REFERENCES users (company_id, id) ON DELETE SET NULL (updated_by);
--> statement-breakpoint
-- CHỐT CUỐI RECRUIT-ERR-006: một ứng viên một offer đang sống (race 2 POST ⇒ 23505, service map 409 — không 500).
CREATE UNIQUE INDEX uq_offers_candidate_open
  ON offers (company_id, candidate_id) WHERE status IN ('Draft', 'Sent');
--> statement-breakpoint
CREATE INDEX idx_offers_company_candidate_time
  ON offers (company_id, candidate_id, created_at DESC);
--> statement-breakpoint
GRANT SELECT, INSERT ON offers TO mediaos_app;
--> statement-breakpoint
GRANT UPDATE (title, start_date, salary, note, status, responded_at, updated_at, updated_by)
  ON offers TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON offers TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- (9) VERIFY fail-LOUD (RAISE EXCEPTION) — mọi assert có vế DƯƠNG đúng-bằng (khuôn 0549 §7).
--     Migrator chạy 1 transaction ⇒ EXCEPTION = rollback sạch cả 8 bảng.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  v_tables    CONSTANT text[] := ARRAY['job_openings', 'candidates', 'candidate_stage_events',
                                       'candidate_notes', 'interviews', 'interview_participants',
                                       'interview_feedbacks', 'offers'];
  -- Bảng app role CHỈ được SELECT + INSERT (append-only / chỉ-INSERT). interview_feedbacks + offers cũng
  -- nằm đây ở vế CẤP BẢNG: quyền ghi của chúng là UPDATE CẤP CỘT, không phải cấp bảng.
  v_no_tbl_up CONSTANT text[] := ARRAY['candidate_stage_events', 'interview_participants',
                                       'interview_feedbacks', 'offers'];
  t           text;
  v_n         int;
  v_privs     text[];
  v_cols      text[];
  v_exp       text[];
  v_bad       text;
  v_pred      text;
  r           record;
BEGIN
  -- (1) RLS ENABLE + FORCE + policy tenant_isolation soi GUC ở CẢ USING lẫn WITH CHECK
  FOREACH t IN ARRAY v_tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = t::regclass AND relrowsecurity AND relforcerowsecurity
    ) THEN
      RAISE EXCEPTION '[0559] verify: % thieu ENABLE/FORCE ROW LEVEL SECURITY', t;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy
       WHERE polrelid = t::regclass AND polname = 'tenant_isolation'
         AND pg_get_expr(polqual, polrelid)      LIKE '%app.current_company_id%'
         AND pg_get_expr(polwithcheck, polrelid) LIKE '%app.current_company_id%'
    ) THEN
      RAISE EXCEPTION '[0559] verify: % thieu policy tenant_isolation USING+WITH CHECK theo GUC', t;
    END IF;
  END LOOP;

  -- (2) GRANT bằng aclexplode (KHÔNG information_schema — 0540:137-139)
  FOREACH t IN ARRAY v_tables LOOP
    -- (2a) app cấp bảng — 0 DELETE ở MỌI bảng (bất biến #2)
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_app'::regrole;
    v_exp := CASE WHEN t = ANY (v_no_tbl_up) THEN ARRAY['INSERT', 'SELECT']
                  ELSE ARRAY['INSERT', 'SELECT', 'UPDATE'] END;
    IF v_privs IS DISTINCT FROM v_exp THEN
      RAISE EXCEPTION '[0559] verify: ACL cap bang cua mediaos_app tren % = % — ky vong % (bat bien #2)',
        t, v_privs, v_exp;
    END IF;

    -- (2b) app cấp cột UPDATE — so ĐÚNG BẰNG allowlist (thiếu HOẶC thừa đều đỏ).
    --      candidate_stage_events / interview_participants: PHẢI rỗng (append-only tuyệt đối / chỉ INSERT).
    SELECT array_agg(a.attname::text ORDER BY a.attname) INTO v_cols
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type = 'UPDATE';
    v_exp := CASE t
      WHEN 'interview_feedbacks' THEN ARRAY['comment', 'rating', 'recommendation', 'updated_at']
      WHEN 'offers'              THEN ARRAY['note', 'responded_at', 'salary', 'start_date', 'status',
                                            'title', 'updated_at', 'updated_by']
      ELSE ARRAY[]::text[] END;
    IF COALESCE(v_cols, ARRAY[]::text[]) IS DISTINCT FROM v_exp THEN
      RAISE EXCEPTION '[0559] verify: column-UPDATE cua mediaos_app tren % = % — ky vong % (allowlist DB-14 §6)',
        t, COALESCE(v_cols, ARRAY[]::text[]), v_exp;
    END IF;

    -- (2c) app KHÔNG có ACL cấp cột nào khác UPDATE (INSERT/SELECT cột lẻ = lệch khuôn)
    SELECT count(*) INTO v_n
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type <> 'UPDATE';
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0559] verify: % co % column-ACL ngoai UPDATE cho mediaos_app — lech khuon', t, v_n;
    END IF;

    -- (2d) worker: đúng {SELECT} cấp bảng, 0 column-ACL
    SELECT array_agg(x.privilege_type ORDER BY x.privilege_type) INTO v_privs
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
     WHERE c.oid = t::regclass AND x.grantee = 'mediaos_worker'::regrole;
    IF v_privs IS DISTINCT FROM ARRAY['SELECT'] THEN
      RAISE EXCEPTION '[0559] verify: ACL cua mediaos_worker tren % = % — ky vong {SELECT}', t, v_privs;
    END IF;
    SELECT count(*) INTO v_n
      FROM pg_attribute a CROSS JOIN LATERAL aclexplode(a.attacl) x
     WHERE a.attrelid = t::regclass AND a.attnum > 0 AND NOT a.attisdropped
       AND x.grantee = 'mediaos_worker'::regrole;
    IF v_n <> 0 THEN
      RAISE EXCEPTION '[0559] verify: mediaos_worker co % column-ACL tren % — ky vong 0', v_n, t;
    END IF;
  END LOOP;

  -- (2e) BẤT BIẾN #2 nhắc lại đích danh cho sổ append-only: 0 quyền UPDATE/DELETE ở CẢ hai tầng ACL.
  SELECT count(*) INTO v_n
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
   WHERE c.oid = 'candidate_stage_events'::regclass
     AND x.grantee = 'mediaos_app'::regrole AND x.privilege_type IN ('UPDATE', 'DELETE');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0559] verify: candidate_stage_events co % quyen UPDATE/DELETE cap bang — SO APPEND-ONLY', v_n;
  END IF;

  -- (3) COMPOSITE FK — DƯƠNG đúng-bằng 27 dòng (bảng, cột, đích, deltype, setcols). Thiếu/thừa ⇒ đỏ.
  --     conkey[1] ↔ confkey[1] (company_id), conkey[2] ↔ confkey[2] (col ↔ id).
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
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid  AND a.attnum = c.conkey[1])  = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) = 'company_id'
           AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[2]) = 'id'
      ), expected (tbl, col, tgt, del, setcols) AS (VALUES
        ('job_openings',           'org_unit_id',             'org_units',         'a', ARRAY[]::text[]),
        ('job_openings',           'position_id',             'positions',         'a', ARRAY[]::text[]),
        ('job_openings',           'recruiter_user_id',       'users',             'n', ARRAY['recruiter_user_id']),
        ('job_openings',           'created_by',              'users',             'n', ARRAY['created_by']),
        ('job_openings',           'updated_by',              'users',             'n', ARRAY['updated_by']),
        ('job_openings',           'deleted_by',              'users',             'n', ARRAY['deleted_by']),
        ('candidates',             'job_opening_id',          'job_openings',      'a', ARRAY[]::text[]),
        ('candidates',             'employee_id',             'employee_profiles', 'a', ARRAY[]::text[]),
        ('candidates',             'created_by',              'users',             'n', ARRAY['created_by']),
        ('candidates',             'updated_by',              'users',             'n', ARRAY['updated_by']),
        ('candidates',             'deleted_by',              'users',             'n', ARRAY['deleted_by']),
        ('candidate_stage_events', 'candidate_id',            'candidates',        'a', ARRAY[]::text[]),
        ('candidate_stage_events', 'acted_by',                'users',             'a', ARRAY[]::text[]),
        ('candidate_notes',        'candidate_id',            'candidates',        'a', ARRAY[]::text[]),
        ('candidate_notes',        'created_by',              'users',             'n', ARRAY['created_by']),
        ('candidate_notes',        'updated_by',              'users',             'n', ARRAY['updated_by']),
        ('candidate_notes',        'deleted_by',              'users',             'n', ARRAY['deleted_by']),
        ('interviews',             'candidate_id',            'candidates',        'a', ARRAY[]::text[]),
        ('interviews',             'created_by',              'users',             'n', ARRAY['created_by']),
        ('interviews',             'updated_by',              'users',             'n', ARRAY['updated_by']),
        ('interview_participants', 'interview_id',            'interviews',        'a', ARRAY[]::text[]),
        ('interview_participants', 'employee_id',             'employee_profiles', 'a', ARRAY[]::text[]),
        ('interview_feedbacks',    'interview_id',            'interviews',        'a', ARRAY[]::text[]),
        ('interview_feedbacks',    'interviewer_employee_id', 'employee_profiles', 'a', ARRAY[]::text[]),
        ('offers',                 'candidate_id',            'candidates',        'a', ARRAY[]::text[]),
        ('offers',                 'created_by',              'users',             'n', ARRAY['created_by']),
        ('offers',                 'updated_by',              'users',             'n', ARRAY['updated_by'])
      )
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) d;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0559] verify: composite FK LECH so voi 27 dong ky vong (thieu/thua): %', v_bad;
  END IF;

  -- (3a') MỌI FK >= 2 cột trên 8 bảng phải = 27 — bộ lọc "đúng hình dạng" ở trên sẽ RỚT FK lệch hình dạng
  --       khỏi CẢ HAI vế EXCEPT (điểm mù); đếm thô bịt lại.
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables) AND array_length(c.conkey, 1) >= 2;
  IF v_n <> 27 THEN
    RAISE EXCEPTION '[0559] verify: co % FK >= 2 cot tren 8 bang RECRUIT, ky vong dung 27 — co FK lech hinh dang', v_n;
  END IF;

  -- (3b) 0 FK một-cột từ 8 bảng tới bảng ≠ companies (đúng lớp lỗ KI-046)
  SELECT count(*) INTO v_n
    FROM pg_constraint c
   WHERE c.contype = 'f' AND c.conrelid::regclass::text = ANY (v_tables)
     AND array_length(c.conkey, 1) = 1 AND c.confrelid <> 'companies'::regclass;
  IF v_n <> 0 THEN
    RAISE EXCEPTION '[0559] verify: con % FK MOT COT tu bang RECRUIT toi bang khac companies — phai composite', v_n;
  END IF;

  -- (4) UNIQUE (company_id, id) hậu kiểm trên 3 bảng ĐÍCH nội bộ
  FOREACH t IN ARRAY ARRAY['job_openings', 'candidates', 'interviews'] LOOP
    SELECT count(*) INTO v_n
      FROM pg_constraint c
     WHERE c.conrelid = t::regclass AND c.contype = 'u'
       AND (SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['company_id', 'id']::text[];
    IF v_n <> 1 THEN
      RAISE EXCEPTION '[0559] verify: % thieu UNIQUE (company_id, id) (dem duoc %)', t, v_n;
    END IF;
  END LOOP;

  -- (5) INDEX unique: predicate so ĐÚNG CHUỖI pg_get_expr (không ILIKE '%WHERE%')
  FOR r IN SELECT * FROM (VALUES
      ('uq_candidates_company_employee', '(employee_id IS NOT NULL)'),
      ('uq_interview_participants',      NULL),
      ('uq_interview_feedbacks',         NULL),
      -- deparse THẬT của `status IN ('Draft','Sent')` trên PG16 (đo 2026-08-31) — KHÔNG phải dạng OR.
      ('uq_offers_candidate_open',       '((status)::text = ANY ((ARRAY[''Draft''::character varying, ''Sent''::character varying])::text[]))')
    ) AS v(idx, pred)
  LOOP
    SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
      FROM pg_index i WHERE i.indexrelid = r.idx::regclass AND i.indisunique;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[0559] verify: index % khong ton tai hoac khong UNIQUE', r.idx;
    END IF;
    IF v_pred IS DISTINCT FROM r.pred THEN
      RAISE EXCEPTION '[0559] verify: predicate cua % = % — ky vong %', r.idx, COALESCE(v_pred, '<NULL>'),
        COALESCE(r.pred, '<NULL>');
    END IF;
  END LOOP;

  -- (5b) 2 index check-duplicate CỐ Ý KHÔNG partial theo deleted_at (DB-14 §6.2): predicate chỉ có vế NOT NULL.
  FOR r IN SELECT * FROM (VALUES
      ('idx_candidates_company_email_expr', '(email IS NOT NULL)'),
      ('idx_candidates_company_phone_norm', '(phone IS NOT NULL)')
    ) AS v(idx, pred)
  LOOP
    SELECT pg_get_expr(i.indpred, i.indrelid) INTO v_pred
      FROM pg_index i WHERE i.indexrelid = r.idx::regclass;
    IF NOT FOUND THEN
      RAISE EXCEPTION '[0559] verify: index % khong ton tai', r.idx;
    END IF;
    IF v_pred IS DISTINCT FROM r.pred THEN
      RAISE EXCEPTION '[0559] verify: predicate cua % = % — ky vong % (KHONG duoc partial theo deleted_at)',
        r.idx, COALESCE(v_pred, '<NULL>'), r.pred;
    END IF;
  END LOOP;

  -- (5c) 7 index thường tồn tại theo tên
  FOREACH t IN ARRAY ARRAY['idx_job_openings_company_status', 'idx_job_openings_company_org',
                           'idx_candidates_company_stage_job', 'idx_cse_company_candidate_time',
                           'idx_candidate_notes_company_candidate', 'idx_interviews_company_candidate',
                           'idx_interviews_company_start', 'idx_interview_participants_employee',
                           'idx_offers_company_candidate_time'] LOOP
    IF to_regclass(t) IS NULL THEN
      RAISE EXCEPTION '[0559] verify: index thuong % khong ton tai', t;
    END IF;
  END LOOP;

  RAISE NOTICE '[0559] verify PASS: 8 bang RLS+FORCE · ACL app/worker dung khuon (0 DELETE, sổ append-only 0 UPDATE) · 27 composite FK · 4 unique + 11 index';
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy). Thứ tự con → cha.
-- DROP TABLE IF EXISTS interview_feedbacks;
-- DROP TABLE IF EXISTS interview_participants;
-- DROP TABLE IF EXISTS interviews;
-- DROP TABLE IF EXISTS offers;
-- DROP TABLE IF EXISTS candidate_notes;
-- DROP TABLE IF EXISTS candidate_stage_events;
-- DROP TABLE IF EXISTS candidates;
-- DROP TABLE IF EXISTS job_openings;
-- -- + gỡ 8 dòng cleanupTenants() + 8 case rls-registry + schema/recruit.ts cùng lúc.
