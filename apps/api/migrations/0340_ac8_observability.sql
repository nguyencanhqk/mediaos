-- Migration 0340: AC-8 Observability — audit viewer + queue monitor (READ-ONLY).
-- Gate: FULL (security-reviewer [cross-tenant RLS read GUC] + database-reviewer + silent-failure-hunter + santa).
--
-- BAND 0340-0344 (lane ac8). Journal: idx 101, when 1717500360000 (> high-water 350000 = 0320_ac6_webhooks)
--   khi land — RECONCILE theo master max mỗi rebase. Hook guard-migration-band: BANDS.ac8 = [[340,344]].
--
-- MỤC TIÊU: 2 tầng đọc CHỈ-ĐỌC vào audit_logs + event queue (outbox_events + dead_letter_events):
--   - TENANT self: company-admin xem audit của tenant MÌNH qua withTenant(JWT.companyId) — RLS *_tenant_iso
--     sẵn có (0003) ÉP. KHÔNG cần policy/GUC mới cho đường này.
--   - OPERATOR cross-tenant: platform-admin xem audit + queue của MỌI tenant.
--
-- THIẾT KẾ TENANCY (cross-tenant primitive #2): KHÔNG mở rộng escape-hatch app.platform_admin (mig 0230 —
--   CHỈ nới policy `companies`, blast-radius hẹp cố ý). Thêm GUC HẸP MỚI `app.platform_audit_read` cho
--   ĐÚNG 3 bảng quan sát. Mỗi bảng thêm 1 policy PERMISSIVE RIÊNG `FOR SELECT TO mediaos_app USING
--   (current_setting('app.platform_audit_read',true)='on')`. Postgres OR-COMBINE permissive policies ⇒
--   KHÔNG đụng *_tenant_iso (tenant isolation nguyên vẹn); SELECT-ONLY by construction (KHÔNG WITH CHECK
--   ⇒ KHÔNG có nhánh cross-tenant INSERT/UPDATE ⇒ append-only #2 + isolation giữ vững).
--   Default-DENY: GUC chưa set ⇒ current_setting(...,true)=NULL ⇒ 'NULL = on' là NULL ⇒ false ⇒ 0 row chéo.
--   `withPlatformReadContext` (db.service.ts) set GUC này LOCAL (SELECT-only by contract) — TÁI DÙNG bởi AC-9.
--
-- BẤT BIẾN: #1 GUC mới default-deny + chỉ 3 bảng quan sát, RLS mọi bảng nghiệp vụ khác nguyên vẹn.
--   #2 append-only — policy mới FOR SELECT only, KHÔNG nới UPDATE/DELETE grant. #3 không secret —
--   redact before/after phía app (audit-redact.helper), DDL không đụng.
--
-- KHÔNG bảng mới. Audit operator-action TÁI DÙNG object_type='company' ⇒ KHÔNG đổi audit CHECK.

-- ── Seed: permissions catalog (is_sensitive=TRUE — wildcard *:* KHÔNG kế thừa) ────────────────────────
-- view:audit-log    = per-tenant (company-admin xem audit của mình).
-- view:platform-audit = cross-tenant (platform operator xem audit + queue mọi tenant).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('view', 'audit-log',      true),
  ('view', 'platform-audit', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Grant view:audit-log cho company-admin (00000001) TƯỜNG MINH (sensitive ⇒ không tự vào qua wildcard).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) = ('view', 'audit-log')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Grant view:platform-audit cho platform-admin (…f0) TƯỜNG MINH (Operator tier, cross-tenant).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-0000000000f0', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) = ('view', 'platform-audit')
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- ── RLS: policy cross-tenant READ-ONLY HẸP qua GUC app.platform_audit_read (3 bảng quan sát) ──────────
-- Mỗi policy là PERMISSIVE RIÊNG (OR-combine với *_tenant_iso sẵn có). FOR SELECT only + USING only
-- (KHÔNG WITH CHECK) ⇒ không thể INSERT/UPDATE chéo tenant qua GUC này (SELECT-only by construction).
-- current_setting(...,true)='on' = bật cross-tenant read; chưa set ⇒ NULL ⇒ false ⇒ default-DENY.
CREATE POLICY audit_logs_platform_audit_read ON audit_logs
  FOR SELECT TO mediaos_app
  USING (current_setting('app.platform_audit_read', true) = 'on');
--> statement-breakpoint
CREATE POLICY outbox_events_platform_audit_read ON outbox_events
  FOR SELECT TO mediaos_app
  USING (current_setting('app.platform_audit_read', true) = 'on');
--> statement-breakpoint
CREATE POLICY dead_letter_platform_audit_read ON dead_letter_events
  FOR SELECT TO mediaos_app
  USING (current_setting('app.platform_audit_read', true) = 'on');
--> statement-breakpoint

-- (Audit object_type KHÔNG đổi — operator.audit_read / operator.queue_read TÁI DÙNG 'company'.)

-- -------- Down (manual) --------
-- DROP POLICY audit_logs_platform_audit_read ON audit_logs;
-- DROP POLICY outbox_events_platform_audit_read ON outbox_events;
-- DROP POLICY dead_letter_platform_audit_read ON dead_letter_events;
-- DELETE FROM role_permissions WHERE permission_id IN
--   (SELECT id FROM permissions WHERE resource_type IN ('audit-log','platform-audit'));
-- DELETE FROM permissions WHERE resource_type IN ('audit-log','platform-audit');
