-- Migration 0027: G6-2d — Seed sensitive permission `edit-platform-account` + grant platform-account
-- metadata (non-secret) to channel-manager.
--
-- ⚠️ `reveal-secret` + platform-account CRUD catalog ALREADY seeded in 0005 (lines 276-281); ON CONFLICT
--    protects, so we only ADD `edit-platform-account` here (Matrix §11 splits it from generic `update`).
-- ⚠️ SENSITIVE actions (reveal-secret, edit-platform-account) are granted to NO system role by default
--    (ADR-0010 anti-escalation; mirror 0019:78-86). Per-tenant access is provisioned explicitly:
--      • reveal-secret → object_permissions per account (Tầng-3, forwarded by the 2e0 guard) — never a
--        company-level blanket (a company exact-ALLOW would reveal EVERY account of the tenant).
--      • edit-platform-account → assigned to a tenant role explicitly (company-tier, not a system role).
-- ⚠️ Journal: this file is 0027 but 0022 took idx 27 (when 1717500030000); its journal entry is
--    idx 28 / when 1717500031000 (strictly > max-applied) so the migrator does NOT skip it.

-- Add the sensitive edit-platform-account permission (separate from non-sensitive `update`).
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('edit-platform-account', 'platform-account', true)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- Grant platform-account METADATA (read/update/manage — NON-secret) to channel-manager (…003).
-- The is_sensitive=false filter EXCLUDES reveal-secret + edit-platform-account (anti-escalation): a
-- channel manager administers account metadata but cannot reveal or rotate the stored secret.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000003', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type = 'platform-account'
  AND p.action IN ('read', 'update', 'manage')
  AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
