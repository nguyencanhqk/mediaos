-- Migration 0122: G16-1b — security_alerts (APPEND-ONLY) + RLS + FORCE.
--
-- BAND 0120-0129 (lane G16). Journal: idx 86 / when 1717500211000 (> 0121 when 1717500210000, đơn điệu tăng).
--
-- Mục đích: ghi 1 bản ghi BẤT BIẾN khi phát hiện tín hiệu an ninh — re-auth fail lặp, cross-scope deny lặp,
--   đăng nhập bất thường. Append-only = alert là sự thật KHÔNG sửa/xoá được (BẤT BIẾN #2). KHÔNG lưu secret
--   trong detail (BẤT BIẾN #3) — chỉ subject + ngữ cảnh non-sensitive (count, ip, reason code).
--
-- BẤT BIẾN: company_id NOT NULL + RLS ENABLE/FORCE (cô lập chéo tenant #1). App SELECT+INSERT tenant-iso
--   (KHÔNG UPDATE/DELETE — append-only #2). detail JSONB KHÔNG chứa giá trị nhạy cảm (password/secret/code).

CREATE TABLE security_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL DEFAULT NULLIF(current_setting('app.current_company_id', true), '')::uuid
                REFERENCES companies (id),
  alert_type  text NOT NULL,
  severity    text NOT NULL DEFAULT 'medium',
  -- subject: định danh trừu tượng của đối tượng bị nghi (vd userId, accountId, email-hash) — KHÔNG secret.
  subject     text,
  -- subject_user_id: actor liên quan (nullable — anomalous login có thể chưa resolve user). NO ACTION FK.
  subject_user_id uuid REFERENCES users (id),
  -- detail JSONB: ngữ cảnh non-sensitive (count vượt ngưỡng, reason code, ip). CẤM secret/password/code.
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT security_alerts_severity_check CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT security_alerts_type_check CHECK (
    alert_type IN ('repeated_reauth_failure', 'repeated_cross_scope_deny', 'anomalous_login')
  )
);
--> statement-breakpoint
CREATE INDEX security_alerts_company_created_idx ON security_alerts (company_id, created_at);
--> statement-breakpoint
CREATE INDEX security_alerts_company_type_idx ON security_alerts (company_id, alert_type);
--> statement-breakpoint
ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE security_alerts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- App (admin UI tenant) XEM + GHI alert của tenant mình (emit từ đường app trong ngữ cảnh withTenant).
CREATE POLICY security_alerts_tenant_iso ON security_alerts
  USING (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.current_company_id', true), '')::uuid);
--> statement-breakpoint
-- Append-only ép ở GRANT: app chỉ SELECT+INSERT (KHÔNG UPDATE/DELETE — alert bất biến #2).
GRANT SELECT, INSERT ON security_alerts TO mediaos_app;
