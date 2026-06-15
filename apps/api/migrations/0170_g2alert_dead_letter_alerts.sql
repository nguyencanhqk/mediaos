-- Migration 0170: G2-4 alerting — dead_letter_alerts (APPEND-ONLY) + RLS + audit CHECK +'dead_letter_alert'.
--
-- BAND 0170-0179 (lane G2ALERT). idx 83, when 1717500171000 (> master max 1717500170000, đơn điệu tăng).
-- Mục đích: khi số dead_letter_events UNRESOLVED của 1 company vượt ngưỡng trong cửa sổ ⇒ ghi 1 alert
--   bất biến (1/window) + bắn AlertSink.thresholdBreached. Append-only = alert là sự thật KHÔNG sửa được.
--
-- BẤT BIẾN: company_id NOT NULL + RLS ENABLE/FORCE (cô lập chéo tenant, #1). App SELECT tenant-iso;
--   worker SELECT+INSERT (KHÔNG UPDATE/DELETE — append-only #2). unique(company_id, window_start) +
--   ON CONFLICT DO NOTHING (DeadLetterAlertMonitor) = chống BÁO ĐỘNG KÉP. KHÔNG lưu payload (#3).
-- HOT-FILE (TASKS §5.3): audit CHECK = UNION mọi lane qua DO-block ADD-only (parse cả IN(...) và =ANY('{...}')
--   như tiền lệ 0099) — KHÔNG drop-restamp full-list. Sync AUDIT_OBJECT_TYPES (audit.ts) cùng commit.

-- ── dead_letter_alerts (append-only; worker INSERT, app SELECT tenant-iso — KHÔNG UPDATE/DELETE) ──
CREATE TABLE dead_letter_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                      REFERENCES companies (id),
  window_start      timestamptz NOT NULL,
  dead_letter_count integer NOT NULL,
  threshold         integer NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- 1 alert / (company, cửa sổ): ON CONFLICT DO NOTHING ⇒ checkThresholds chạy lại KHÔNG báo động kép.
  CONSTRAINT dead_letter_alert_company_window_uq UNIQUE (company_id, window_start)
);
--> statement-breakpoint
CREATE INDEX dead_letter_alerts_company_idx ON dead_letter_alerts (company_id, window_start);
--> statement-breakpoint
ALTER TABLE dead_letter_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE dead_letter_alerts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App (admin UI tenant) chỉ XEM alert của tenant mình.
CREATE POLICY dead_letter_alerts_app_tenant_iso ON dead_letter_alerts
  FOR SELECT TO mediaos_app
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Worker: hạ tầng nền, ghi/đọc alert cho mọi tenant (đếm dead-letter xuyên tenant).
CREATE POLICY dead_letter_alerts_worker_all ON dead_letter_alerts
  TO mediaos_worker
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint
-- Append-only ép ở GRANT: app chỉ SELECT; worker SELECT+INSERT (KHÔNG UPDATE/DELETE — alert bất biến).
GRANT SELECT ON dead_letter_alerts TO mediaos_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON dead_letter_alerts TO mediaos_worker;
--> statement-breakpoint

-- ── audit_logs CHECK: ADD-only idempotent DO-block (chỉ thêm 'dead_letter_alert', an toàn song song). ──
-- Đọc CẢ HAI dạng constraint: `IN ('a','b')` (re-stamp full-list) VÀ `= ANY ('{a,b}'::text[])` (output
-- DO-block trước). 0170 chạy SAU 0053/0099/0140 (đọc dạng ANY) nên PHẢI parse mảng bằng cast text[] (tiền lệ 0099).
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['dead_letter_alert'];
  v_add    text[];
  v_union  text[];
BEGIN
  SELECT oid, conname INTO v_oid, v_con
    FROM pg_constraint
   WHERE conrelid = 'audit_logs'::regclass AND contype = 'c'
     AND conname LIKE '%object_type%'
   LIMIT 1;

  IF v_oid IS NULL THEN
    RETURN;
  END IF;

  v_def := pg_get_constraintdef(v_oid);
  IF position('ANY' IN upper(v_def)) > 0 THEN
    -- Dạng `= ANY ('{a,b,c}'::text[])` → cast literal mảng về text[] (đúng từng phần tử).
    v_cur := substring(v_def FROM '\{[^}]*\}')::text[];
  ELSE
    -- Dạng `IN ('a','b','c')` → tóm từng giá trị trong nháy đơn.
    SELECT array_agg(m[1]) INTO v_cur
      FROM (
        SELECT regexp_matches(v_def, '''([^'']+)''', 'g') AS m
      ) sub;
  END IF;

  SELECT array_agg(t) INTO v_add
    FROM unnest(v_new) AS t
   WHERE NOT (v_cur @> ARRAY[t]);

  IF v_add IS NULL OR array_length(v_add, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_union
    FROM unnest(v_cur || v_add) AS x;

  EXECUTE format('ALTER TABLE audit_logs DROP CONSTRAINT %I', v_con);
  EXECUTE format(
    'ALTER TABLE audit_logs ADD CONSTRAINT %I CHECK (object_type = ANY(%L::text[]))',
    v_con, v_union
  );
END;
$$;
