-- Migration 0070: G13-1 — audit object_type (+5 finance) + revenue_records (APPEND-ONLY sổ cái).
--
-- ╔═══════════════════════════════════════════════════════════════════════════════════════════════╗
-- ║ MERGE NOTE (đọc TRƯỚC khi land — G13 land CUỐI sau G9→G10→G11):                                  ║
-- ║  • File dải 0070–0074 CHƯA wire vào meta/_journal.json (cố ý — tránh conflict journal mỗi lần    ║
-- ║    rebase lane trước). Lúc land: thêm 5 entry journal idx nối tiếp ĐỈNH journal hiện hành,       ║
-- ║    when = 1717500080000..1717500084000 (+1000/entry; > mọi when của G9/G10/G11 ⇒ drizzle không   ║
-- ║    skip). Kiểm `SELECT max(created_at) FROM drizzle.__drizzle_migrations` < 1717500080000 trước.  ║
-- ║  • CHECK audit_logs_object_type_chk DƯỚI ĐÂY phải là SUPERSET của trạng thái master LÚC LAND —   ║
-- ║    nếu G9/G10/G11 đã thêm object_type mới, PHẢI gộp thêm vào danh sách này (và audit.ts) NGAY     ║
-- ║    trước khi land, nếu không DROP+ADD sẽ xoá mất type của lane khác. Danh sách hiện = 24 (master  ║
-- ║    tới 0033) + 5 (G13). Đồng bộ AUDIT_OBJECT_TYPES (db/schema/audit.ts) CÙNG commit.              ║
-- ╚═══════════════════════════════════════════════════════════════════════════════════════════════╝
--
-- Append-only (BẤT BIẾN #2) áp cho app-role DML, KHÔNG phải migration DDL → DROP/ADD CONSTRAINT hợp lệ.
-- Tiền lệ: 0011/0014/0020/0033 (DROP+ADD CHECK). PHẢI chạy TRƯỚC mọi audit ghi type finance.

ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_object_type_chk;
--> statement-breakpoint
ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_object_type_chk CHECK (object_type IN (
    'company',
    'user',
    'auth',
    'outbox_event',
    'workflow_instance',
    'workflow_step',
    'task',
    'approval_request',
    'employee',
    'position',
    'org_unit',
    'team',
    'channel',
    'platform_account',
    'channel_account',
    'channel_member',
    'project',
    'project_team',
    'project_member',
    'content',
    'content_channel',
    'content_asset',
    'content_type',
    'workflow_template',
    -- G11 HR attendance/leave — UNION khi land sau g11 (mig 0060). KHÔNG drop type lane khác.
    'work_schedule',
    'attendance_record',
    'attendance_adjustment_request',
    'attendance_period',
    'leave_type',
    'leave_request',
    'leave_balance',
    -- G10 communication (chat realtime / notification center / meeting) — UNION khi land sau g10 (mig 0050).
    'chat_room',
    'chat_message',
    'notification',
    'notification_rule',
    'notification_preference',
    'meeting',
    'meeting_room',
    -- G13 finance (đồng bộ audit.ts). Duyệt chi audit trên 'expense_request' (KHÔNG type cho bảng log).
    'revenue_record',
    'cost_record',
    'cost_allocation',
    'profit_snapshot',
    'expense_request'
  ));
--> statement-breakpoint

-- ═══ revenue_records — sổ cái doanh thu APPEND-ONLY (GRANT SELECT,INSERT — không UPDATE/DELETE) ═══
-- "Sửa/xoá" = ghi bản ghi mới: entry_kind adjustment|void + replaces_record_id (chain). Không cột
-- updated_at/deleted_at. ERD có cột `status` trên revenue — BỎ (append-only không UPDATE status; trạng
-- thái suy ra từ chain: hiệu lực = entry_kind != 'void' AND NOT EXISTS bản ghi thay thế). Lệch ERD có chủ ý.
CREATE TABLE revenue_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL
                       DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                       REFERENCES companies(id) ON DELETE CASCADE,
  platform_id        uuid REFERENCES platforms(id) ON DELETE SET NULL,
  channel_id         uuid REFERENCES channels(id) ON DELETE SET NULL,
  project_id         uuid REFERENCES projects(id) ON DELETE SET NULL,
  content_item_id    uuid REFERENCES content_items(id) ON DELETE SET NULL,
  amount             numeric(18,2) NOT NULL,
  currency           text NOT NULL DEFAULT 'VND',
  revenue_date       date NOT NULL,
  period_start       date,
  period_end         date,
  source             text NOT NULL,
  description        text,
  attachment_url     text,
  entered_by         uuid NOT NULL REFERENCES users(id),
  entry_kind         text NOT NULL DEFAULT 'original',
  replaces_record_id uuid REFERENCES revenue_records(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revenue_records_source_check CHECK (source IN
    ('youtube_adsense','tiktok','facebook','sponsorship','affiliate','manual','other')),
  CONSTRAINT revenue_records_entry_kind_check CHECK (entry_kind IN ('original','adjustment','void')),
  -- original ⟺ replaces NULL; adjustment/void ⟺ replaces NOT NULL.
  CONSTRAINT revenue_records_chain_check CHECK (
    (entry_kind = 'original' AND replaces_record_id IS NULL)
    OR (entry_kind IN ('adjustment','void') AND replaces_record_id IS NOT NULL)
  )
);
--> statement-breakpoint
ALTER TABLE revenue_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE revenue_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY revenue_records_app_tenant_iso ON revenue_records
  TO mediaos_app
  USING     (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK(company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
CREATE INDEX revenue_records_company_date_idx    ON revenue_records (company_id, revenue_date);
--> statement-breakpoint
CREATE INDEX revenue_records_company_channel_idx ON revenue_records (company_id, channel_id);
--> statement-breakpoint
CREATE INDEX revenue_records_company_project_idx ON revenue_records (company_id, project_id);
--> statement-breakpoint
CREATE INDEX revenue_records_company_content_idx ON revenue_records (company_id, content_item_id);
--> statement-breakpoint
-- Mỗi bản ghi chỉ bị thay thế ĐÚNG 1 lần (chặn race double-adjust ở DB).
CREATE UNIQUE INDEX revenue_records_replaces_uq
  ON revenue_records (replaces_record_id) WHERE replaces_record_id IS NOT NULL;
--> statement-breakpoint
-- APPEND-ONLY: app role chỉ SELECT + INSERT. KHÔNG UPDATE/DELETE (bất biến #2). worker chỉ đọc.
GRANT SELECT, INSERT ON revenue_records TO mediaos_app;
--> statement-breakpoint
GRANT SELECT ON revenue_records TO mediaos_worker;

-- Down (chỉ khi hỏng nặng, DB dev chung — không rollback tự động):
--   DROP TABLE revenue_records;
--   ALTER TABLE audit_logs DROP CONSTRAINT audit_logs_object_type_chk;
--   -- (rồi ADD lại CHECK theo danh sách 0033 + bất kỳ type lane khác đã thêm)
