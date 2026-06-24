-- Migration 0434: FOUNDATION-DB-4 (🔴 RED) — sequence_counters + public_holidays theo DB-08 §8.9/8.10.
-- Gate: FULL (security-reviewer [RLS nullable-tenant] + database-reviewer + silent-failure-hunter).
--
-- BAND 0434 (lane foundation-db). Journal: idx 117, when 1717500520000 (> head 0433 idx 116 / 1717500510000).
-- Nối tiếp ĐƠN ĐIỆU sau head 0433_foundation_db3_files. Migration đơn điệu sau head 0430 (idx 113).
--
-- MỤC TIÊU (Foundation — sinh mã tự động + lịch nghỉ dùng chung cho ATT/LEAVE/DASH):
--   • sequence_counters : bộ đếm sinh mã (EMPLOYEE_CODE, LEAVE_REQUEST_CODE, PROJECT_CODE...). company_id
--                         NULLABLE — global/system sequence (company_id NULL) + company-scoped sequence.
--   • public_holidays   : ngày nghỉ lễ. company_id NULLABLE — global holiday theo country_code (company_id
--                         NULL) + holiday riêng công ty (company_id NOT NULL). Override company > global.
--
-- BẤT BIẾN (CLAUDE.md §2/§3) + DB-08 §5.3 (company_id nullable cho global default):
--   #1 Bảng nghiệp vụ có company_id ⇒ RLS ENABLE + FORCE + policy tenant_isolation TẠO TRƯỚC mọi
--      INSERT/backfill (WO này KHÔNG seed). company_id NULLABLE cho global rows ⇒ policy theo MẪU 0005
--      `roles` (precedent đã land):
--        USING      (company_id = current_setting OR company_id IS NULL)  → tenant đọc row CỦA MÌNH + global.
--        WITH CHECK (company_id = current_setting)                        → app role CHỈ ghi row tenant mình;
--                                                                            KHÔNG forge company_id tenant khác,
--                                                                            KHÔNG ghi global (company_id NULL).
--      ⇒ row company_id NULL chỉ ĐỌC chéo-tenant ở dạng GLOBAL CHUNG (không thuộc tenant nào), KHÔNG rò DỮ
--      LIỆU CỦA TENANT KHÁC (mọi row tenant-scoped vẫn lọc đúng company_id). Ghi global = seed/admin System
--      qua table-owner (bypass FORCE) — đường system/global, KHÔNG qua app role (DB-08 §5.3 #3/#4).
--      Policy tương thích set_config('app.current_company_id',$1,true) PgBouncer txn-mode (NULLIF(...,'')::uuid
--      → company chưa set thì current_setting='' → NULL → chỉ khớp company_id IS NULL, KHÔNG khớp tenant nào).
--   #2 sequence_counters / public_holidays = config/master-data MUTABLE (KHÔNG audit/snapshot) ⇒ KHÔNG
--      append-only. App SELECT/INSERT/UPDATE; KHÔNG DELETE (soft-delete deleted_at — DB-08 §8.9 rule, §8.10
--      rule 5: KHÔNG hard-delete holiday/counter đã dùng để tính công/phép, chỉ Inactive/soft-delete).
--   #5 UUID PK + timestamptz UTC-at-rest (ADR-0008).
--
-- ⚠️ LỆCH SPEC có chủ đích (xem report deviationsFromSpec):
--   • public_holidays.is_paid_holiday: HỢP ĐỒNG WO (backlog done_when) đặt tên cột `is_paid_holiday`; DB-08
--     §8.10 bảng cột ghi `is_paid`. Theo HỢP ĐỒNG WO làm chuẩn ⇒ dùng `is_paid_holiday`. Ngữ nghĩa giữ
--     nguyên (có hưởng lương ngày nghỉ không). HolidayService (FOUNDATION-BE-6) đọc theo tên cột này.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1) sequence_counters — bộ đếm sinh mã tự động (DB-08 §8.9). company_id NULLABLE (system sequence =
--    company_id NULL). RLS+FORCE + policy tenant_isolation (mẫu 0005 roles) TẠO TRƯỚC mọi INSERT.
--    KHÔNG đặt company_id DEFAULT current_setting (cột nullable — global counter cần ghi NULL tường minh
--    qua đường system/owner; app role chỉ ghi row tenant qua WITH CHECK).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE sequence_counters (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid REFERENCES companies(id) ON DELETE CASCADE,
  module_code          varchar(50) NOT NULL,
  sequence_key         varchar(150) NOT NULL,
  scope_type           varchar(50) NOT NULL DEFAULT 'Company',
  scope_reference_id   uuid,
  prefix               varchar(100),
  suffix               varchar(100),
  current_value        bigint NOT NULL DEFAULT 0,
  increment_by         integer NOT NULL DEFAULT 1,
  padding_length       integer NOT NULL DEFAULT 0,
  reset_policy         varchar(50) NOT NULL DEFAULT 'Never',
  reset_format         varchar(50),
  last_reset_at        timestamptz,
  last_generated_code  varchar(255),
  format_pattern       varchar(255),
  lock_version         integer NOT NULL DEFAULT 0,
  status               varchar(50) NOT NULL DEFAULT 'Active',
  metadata             jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at           timestamptz,
  deleted_by           uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) — nullable-tenant policy mẫu 0005 roles ──
ALTER TABLE sequence_counters ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sequence_counters FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- USING: tenant thấy counter CỦA MÌNH + system counter (company_id IS NULL — global, dùng chung).
-- WITH CHECK: app role CHỈ ghi counter tenant mình; KHÔNG ghi system counter (company_id NULL bị chặn).
CREATE POLICY tenant_isolation ON sequence_counters
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE sequence_counters
  ADD CONSTRAINT chk_sequence_counters_scope_type
  CHECK (scope_type IN ('System', 'Company', 'Department', 'Employee', 'Custom'));
--> statement-breakpoint
ALTER TABLE sequence_counters
  ADD CONSTRAINT chk_sequence_counters_reset_policy
  CHECK (reset_policy IN ('Never', 'Yearly', 'Monthly', 'Daily'));
--> statement-breakpoint
ALTER TABLE sequence_counters
  ADD CONSTRAINT chk_sequence_counters_status
  CHECK (status IN ('Active', 'Inactive'));
--> statement-breakpoint
ALTER TABLE sequence_counters
  ADD CONSTRAINT chk_sequence_counters_increment_positive
  CHECK (increment_by > 0);
--> statement-breakpoint
ALTER TABLE sequence_counters
  ADD CONSTRAINT chk_sequence_counters_padding_non_negative
  CHECK (padding_length >= 0);
--> statement-breakpoint
-- uq (company_id, sequence_key) tránh trùng counter — scope-aware (scope_type + scope_reference_id) theo
-- DB-08 §8.9 (nhiều counter cùng key khác scope: Department/Employee). COALESCE scope_reference_id để NULL
-- không né uq. WHERE deleted_at IS NULL (soft-delete không chiếm slot). company_id NULL (system) cũng 1 slot.
CREATE UNIQUE INDEX uq_sequence_counters_company_key_scope_active
  ON sequence_counters (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    sequence_key,
    scope_type,
    COALESCE(scope_reference_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX idx_sequence_counters_company_module
  ON sequence_counters (company_id, module_code, status)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX sequence_counters_company_id_idx ON sequence_counters (company_id);
--> statement-breakpoint
-- Mutable counter + soft-delete. App SELECT/INSERT/UPDATE — KHÔNG DELETE (BẤT BIẾN #2 không hard-delete).
-- SequenceService dùng SELECT ... FOR UPDATE + UPDATE current_value trong tx (DB-08 §8.9 rule 1/2).
GRANT SELECT, INSERT, UPDATE ON sequence_counters TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON sequence_counters TO mediaos_worker;
--> statement-breakpoint

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2) public_holidays — ngày nghỉ lễ dùng chung (DB-08 §8.10). company_id NULLABLE: NULL = global holiday
--    theo country_code; NOT NULL = holiday riêng công ty (override global cùng ngày). RLS+FORCE + policy
--    tenant_isolation (mẫu 0005 roles) TẠO TRƯỚC mọi INSERT.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE public_holidays (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid REFERENCES companies(id) ON DELETE CASCADE,
  holiday_code              varchar(100) NOT NULL,
  name                      varchar(255) NOT NULL,
  holiday_date              date NOT NULL,
  holiday_type              varchar(50) NOT NULL DEFAULT 'PublicHoliday',
  country_code              varchar(10),
  region_code               varchar(50),
  is_recurring              boolean NOT NULL DEFAULT false,
  recurring_rule            jsonb,
  affects_attendance        boolean NOT NULL DEFAULT true,
  affects_leave_calculation boolean NOT NULL DEFAULT true,
  -- LỆCH SPEC tên cột: HỢP ĐỒNG WO dùng `is_paid_holiday` (DB-08 §8.10 ghi `is_paid`). Ngữ nghĩa giữ nguyên.
  is_paid_holiday           boolean NOT NULL DEFAULT true,
  status                    varchar(50) NOT NULL DEFAULT 'Active',
  source                    varchar(100),
  description               text,
  metadata                  jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at                timestamptz,
  deleted_by                uuid REFERENCES users(id) ON DELETE SET NULL
);
--> statement-breakpoint
-- ── RLS TRƯỚC mọi INSERT/backfill (CLAUDE.md §3) — nullable-tenant policy mẫu 0005 roles ──
ALTER TABLE public_holidays ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public_holidays FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- USING: tenant thấy holiday CỦA MÌNH + global holiday (company_id IS NULL — dùng chung theo country).
-- WITH CHECK: app role CHỈ ghi holiday tenant mình; KHÔNG ghi global holiday (company_id NULL bị chặn —
-- global holiday seed/import qua đường system/owner, DB-08 §5.3).
CREATE POLICY tenant_isolation ON public_holidays
  USING (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
    OR company_id IS NULL
  )
  WITH CHECK (
    company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid
  );
--> statement-breakpoint
ALTER TABLE public_holidays
  ADD CONSTRAINT chk_public_holidays_type
  CHECK (holiday_type IN ('PublicHoliday', 'CompanyHoliday', 'WorkingDayOverride', 'SpecialDay'));
--> statement-breakpoint
ALTER TABLE public_holidays
  ADD CONSTRAINT chk_public_holidays_status
  CHECK (status IN ('Active', 'Inactive'));
--> statement-breakpoint
-- uq tránh trùng holiday GLOBAL: (country_code, holiday_date, holiday_code) WHERE company_id IS NULL.
CREATE UNIQUE INDEX uq_public_holidays_global_date_code_active
  ON public_holidays (country_code, holiday_date, holiday_code)
  WHERE company_id IS NULL AND deleted_at IS NULL;
--> statement-breakpoint
-- uq tránh trùng holiday CÔNG TY: (company_id, holiday_date, holiday_code) WHERE company_id IS NOT NULL.
CREATE UNIQUE INDEX uq_public_holidays_company_date_code_active
  ON public_holidays (company_id, holiday_date, holiday_code)
  WHERE company_id IS NOT NULL AND deleted_at IS NULL;
--> statement-breakpoint
-- Index holiday_date range (getHolidaysInRange — DB-08 §8.10 / FOUNDATION-BE-6 batch theo company).
CREATE INDEX idx_public_holidays_company_date
  ON public_holidays (company_id, holiday_date, status)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
-- Index global holiday theo country + ngày (tra cứu global default theo country_code).
CREATE INDEX idx_public_holidays_country_date
  ON public_holidays (country_code, holiday_date, status)
  WHERE deleted_at IS NULL;
--> statement-breakpoint
CREATE INDEX public_holidays_company_id_idx ON public_holidays (company_id);
--> statement-breakpoint
-- Master-data mutable + soft-delete (KHÔNG hard-delete holiday đã dùng tính công/phép — DB-08 §8.10 rule 5).
-- App SELECT/INSERT/UPDATE — KHÔNG DELETE (BẤT BIẾN #2).
GRANT SELECT, INSERT, UPDATE ON public_holidays TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON public_holidays TO mediaos_worker;

-- -------- Down (manual) --------
-- DROP TABLE IF EXISTS public_holidays;
-- DROP TABLE IF EXISTS sequence_counters;
