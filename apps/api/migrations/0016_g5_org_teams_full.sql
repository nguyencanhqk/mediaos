-- Migration 0016: G5-2a/3a — mở rộng org_units + teams với các cột đầy đủ.
-- ⚠️ Verify trước ALTER org_units type check:
--    SELECT count(*) FROM org_units WHERE type NOT IN ('department','division','unit','office','branch');
--    Phải = 0 (dữ liệu G4 chỉ dùng 'department'/'division' — tập con của tập mới → safe).

-- G5-2: Mở rộng org_units
ALTER TABLE org_units
  ADD COLUMN code         TEXT,
  ADD COLUMN description  TEXT,
  ADD COLUMN head_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN status       TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE org_units DROP CONSTRAINT org_units_type_check;
--> statement-breakpoint
ALTER TABLE org_units
  ADD CONSTRAINT org_units_type_check
    CHECK (type IN ('department','division','unit','office','branch'));
--> statement-breakpoint
CREATE UNIQUE INDEX org_units_company_code_active_uq
  ON org_units (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
--> statement-breakpoint
ALTER TABLE org_units
  ADD CONSTRAINT org_units_status_check CHECK (status IN ('active','inactive'));

-- G5-3: Mở rộng teams
--> statement-breakpoint
ALTER TABLE teams
  ADD COLUMN code           TEXT,
  ADD COLUMN type           TEXT NOT NULL DEFAULT 'production_team',
  ADD COLUMN leader_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN description    TEXT,
  ADD COLUMN capacity       INT,
  ADD COLUMN status         TEXT NOT NULL DEFAULT 'active';
--> statement-breakpoint
ALTER TABLE teams
  ADD CONSTRAINT teams_type_check CHECK (
    type IN ('production_team','script_team','editor_team','thumbnail_team',
             'seo_team','qa_team','project_team','office_team')
  );
--> statement-breakpoint
ALTER TABLE teams
  ADD CONSTRAINT teams_status_check CHECK (status IN ('active','inactive'));
--> statement-breakpoint
CREATE UNIQUE INDEX teams_company_code_active_uq
  ON teams (company_id, code) WHERE deleted_at IS NULL AND code IS NOT NULL;
