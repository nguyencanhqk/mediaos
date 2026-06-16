-- Migration 0190: B4 — task_attachments (real file upload metadata) + RLS + GRANT + audit CHECK.
-- Gate: FULL (security-reviewer [file-upload/path-traversal] + database-reviewer + silent-failure-hunter).
--
-- BAND 0190-0199 (lane b4 — task attachments). Hook guard-migration-band cho b4 = [[190,199]].
-- ⚠️ Journal (RECONCILED khi land lên master 60b3ea0→5c2c231): idx 89 (= master_max 88 + 1 sau khi land
--   C-batch 0121/0122/0220 + b1 0180), when 1717500240000 (> high-water 230000 của b1) → migrator drizzle
--   chỉ apply entry có when STRICTLY GREATER max(created_at), nên 0190 chạy SAU mọi migration master+b1.
--
-- MỤC TIÊU: file đính kèm THẬT cho Task Hub (G9 descoped chỉ link). Bytes nằm ở S3/MinIO dưới key
--   SERVER sinh `{company_id}/tasks/{task_id}/{uuid}` (client KHÔNG bao giờ truyền key/path). Bảng này
--   chỉ lưu METADATA + storage_key (KHÔNG signed URL, KHÔNG credential — BẤT BIẾN #3).
--
-- BẤT BIẾN:
--   #1 company_id NOT NULL + RLS ENABLE/FORCE + policy tenant_isolation USING+WITH CHECK.
--   #2 APPEND-ONLY: GRANT app SELECT,INSERT (KHÔNG UPDATE/DELETE). Xoá = soft-delete deleted_at qua
--      đường privileged (KHÔNG phải app-role UPDATE). worker SELECT-only (đọc để dọn object orphan sau).
--   #4 task_attachments là BẢNG CON của tasks (FK task_id ON DELETE CASCADE) — KHÔNG bảng attachment
--      riêng cho module khác.

CREATE TABLE task_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL
                 DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                 REFERENCES companies(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  storage_key  text NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE task_attachments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON task_attachments
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX task_attachments_company_id_idx ON task_attachments(company_id);
--> statement-breakpoint
CREATE INDEX task_attachments_company_task_idx ON task_attachments(company_id, task_id);
--> statement-breakpoint
ALTER TABLE task_attachments
  ADD CONSTRAINT task_attachments_size_check CHECK (size_bytes >= 0);
--> statement-breakpoint
-- APPEND-ONLY (BẤT BIẾN #2): app role SELECT,INSERT + UPDATE CHỈ cột deleted_at (column-level grant).
-- Nội dung (storage_key/file_name/content_type/size_bytes) BẤT BIẾN sau khi ghi — app KHÔNG có quyền
-- UPDATE chúng (column-grant chỉ phủ deleted_at) ⇒ "UPDATE file_name" thất bại, giữ append-only nội dung.
-- KHÔNG DELETE (hard-delete cấm — BẤT BIẾN #2). Soft-delete = UPDATE(deleted_at) qua đường app withTenant
-- (RLS-scoped, app có INSERT audit_logs nên audit + soft-delete CÙNG tx — KHÔNG cần worker, tránh
-- worker-thiếu-grant-audit_logs). Tiền lệ column-grant: ADR append-only + payslip/finance giữ ledger bất biến.
GRANT SELECT, INSERT, UPDATE (deleted_at) ON task_attachments TO mediaos_app;
--> statement-breakpoint
-- worker: SELECT-only (dọn object orphan sau khi soft-delete; KHÔNG UPDATE/DELETE).
GRANT SELECT ON task_attachments TO mediaos_worker;
--> statement-breakpoint

-- ── audit_logs CHECK +'task_attachment' (HOT-FILE §5.3: UNION mọi lane, DO-block ADD-only) ──────────
-- Tiền lệ 0099/0132/0150: KHÔNG drop re-stamp full-list ⇒ an toàn song song, KHÔNG rớt type lane khác.
-- Đọc CẢ HAI dạng constraint: `IN ('a','b')` VÀ `= ANY ('{a,b}'::text[])`. Sync AUDIT_OBJECT_TYPES
-- (schema/audit.ts) CÙNG commit.
DO $$
DECLARE
  v_oid    oid;
  v_con    text;
  v_def    text;
  v_cur    text[];
  v_new    text[] := ARRAY['task_attachment'];
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
    -- Dạng `= ANY ('{a,b,c}'::text[])` → cast literal mảng về text[].
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

-- -------- Down (manual) --------
-- DROP TABLE IF EXISTS task_attachments;
-- (audit CHECK: re-stamp without 'task_attachment' — only if no audit_logs row uses it.)
