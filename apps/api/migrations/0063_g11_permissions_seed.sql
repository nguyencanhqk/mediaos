-- Migration 0063: G11-3 — Seed permissions catalog cho HR Attendance/Leave.
-- ⚠️ Chạy SAU 0061/0062. Tiền lệ: 0019 (G5 seed).
-- Không permission nào ở đây là is_sensitive (lương mới sensitive — G12); duyệt công/phép là
-- non-sensitive nhưng vẫn guard per-route + audit.

INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('check-in',    'attendance', false),
  ('read',        'attendance', false),
  ('adjust',      'attendance', false),
  ('approve',     'attendance', false),
  ('manage',      'attendance', false),
  ('lock-period', 'attendance', false),
  ('read',        'leave',      false),
  ('create',      'leave',      false),
  ('approve',     'leave',      false),
  ('manage',      'leave',      false)
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- company-admin: toàn bộ permission HR mới (tiền lệ 0019 — catalog seed sau 0005 phải grant tay).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000001', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('attendance', 'leave') AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- hr-manager: toàn bộ permission HR mới (duyệt, quản lý ca, khoá kỳ, quản lý phép).
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000009', p.id, 'ALLOW'
FROM permissions p
WHERE p.resource_type IN ('attendance', 'leave') AND p.is_sensitive = false
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- project-manager: tự chấm công + duyệt đơn công/phép của team.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT '00000000-0000-0000-0000-000000000002', p.id, 'ALLOW'
FROM permissions p
WHERE (p.action, p.resource_type) IN (
  ('check-in', 'attendance'),
  ('read',     'attendance'),
  ('adjust',   'attendance'),
  ('approve',  'attendance'),
  ('read',     'leave'),
  ('create',   'leave'),
  ('approve',  'leave')
)
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Mọi system role nhân sự còn lại (channel-manager → employee): tự chấm công + tự gửi đơn.
INSERT INTO role_permissions (role_id, permission_id, effect)
SELECT r.id, p.id, 'ALLOW'
FROM roles r
CROSS JOIN permissions p
WHERE r.id IN (
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000006',
    '00000000-0000-0000-0000-000000000007',
    '00000000-0000-0000-0000-000000000008'
  )
  AND (p.action, p.resource_type) IN (
    ('check-in', 'attendance'),
    ('read',     'attendance'),
    ('adjust',   'attendance'),
    ('read',     'leave'),
    ('create',   'leave')
  )
ON CONFLICT DO NOTHING;
