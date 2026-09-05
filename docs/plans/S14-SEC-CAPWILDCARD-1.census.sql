-- =====================================================================================
-- S14-SEC-CAPWILDCARD-1 — CENSUS PROD (done_when #1, ADR DECISIONS-12 §8)
--
-- CHẠY BỞI NGƯỜI (owner). Phiên agent KHÔNG chạm được DB PROD
-- (memory: classifier-blocks-prod-db-from-agent).
--
-- CHỈ ĐỌC — 0 câu ghi. Chạy bằng vai BỎ QUA RLS (postgres / chủ DB), vì `roles` /
-- `role_permissions` / `user_roles` đều FORCE RLS; chạy bằng app role sẽ trả THIẾU hàng
-- trong im lặng.
--
--   psql "$PROD_URL" -f docs/plans/S14-SEC-CAPWILDCARD-1.census.sql
--
-- Bốn hình dạng wildcard đều được phủ: ('*','*') · ('A','*') · ('*','T') · exact
-- (memory: permission-grant-census-must-cover-four-wildcard-shapes).
-- Chỉ đếm người SỐNG: user_roles.deleted_at IS NULL · roles.deleted_at IS NULL ·
-- users.deleted_at IS NULL · user_roles chưa hết hạn.
-- =====================================================================================

\echo '=== Q0 — nền: kích thước catalog ==='
SELECT count(*) AS pairs_total,
       count(*) FILTER (WHERE is_sensitive)                            AS pairs_sensitive,
       count(*) FILTER (WHERE action = '*' OR resource_type = '*')     AS pairs_wildcard
FROM permissions;

\echo ''
\echo '=== Q1 — HEADLINE: bao nhieu ACTOR SONG dang giu mot grant ALLOW wildcard ==='
\echo '(0 => no SACH: bo caps["*:*"] khong doi gi ai thay tren FE)'
WITH live_grants AS (
  SELECT ur.user_id, ur.company_id, r.id AS role_id, r.name AS role_name,
         p.action, p.resource_type, p.is_sensitive, rp.effect
  FROM user_roles ur
  JOIN users u            ON u.id  = ur.user_id  AND u.deleted_at IS NULL
  JOIN roles r            ON r.id  = ur.role_id  AND r.deleted_at IS NULL
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p       ON p.id  = rp.permission_id
  WHERE ur.deleted_at IS NULL
    AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
SELECT count(DISTINCT user_id) AS actors_with_wildcard_allow,
       count(DISTINCT role_id) AS roles_with_wildcard_allow
FROM live_grants
WHERE effect = 'ALLOW' AND (action = '*' OR resource_type = '*');

\echo ''
\echo '=== Q1b — chi tiet: role nao dang giu wildcard gi, bao nhieu nguoi ==='
WITH live_ur AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL
  WHERE ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
SELECT r.name AS role_name, r.company_id, p.action, p.resource_type, rp.effect,
       rp.data_scope, p.is_sensitive AS grant_row_is_sensitive,
       count(DISTINCT lu.user_id) AS holders_alive
FROM roles r
JOIN role_permissions rp ON rp.role_id = r.id
JOIN permissions p       ON p.id = rp.permission_id
LEFT JOIN live_ur lu     ON lu.role_id = r.id
WHERE r.deleted_at IS NULL
  AND (p.action = '*' OR p.resource_type = '*')
GROUP BY 1,2,3,4,5,6,7
ORDER BY holders_alive DESC, role_name;

\echo ''
\echo '=== Q2 — TIEU CHI ADR §8: actor duoc wildcard PHU mot cap SENSITIVE ma THIEU grant exact ==='
\echo '(day la nguoi HOM NAY thay man roi an 403; sau ban va man se AN — dung, khong phai hoi quy)'
WITH live_grants AS (
  SELECT ur.user_id, ur.company_id, p.action, p.resource_type, rp.effect
  FROM user_roles ur
  JOIN users u             ON u.id  = ur.user_id AND u.deleted_at IS NULL
  JOIN roles r             ON r.id  = ur.role_id AND r.deleted_at IS NULL
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p       ON p.id  = rp.permission_id
  WHERE ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())
),
sensitive_pairs AS (
  SELECT action, resource_type FROM permissions WHERE is_sensitive
)
SELECT g.user_id, g.company_id, sp.action, sp.resource_type
FROM live_grants g
JOIN sensitive_pairs sp
  ON (g.action = '*' OR g.action = sp.action)
 AND (g.resource_type = '*' OR g.resource_type = sp.resource_type)
WHERE g.effect = 'ALLOW'
  AND (g.action = '*' OR g.resource_type = '*')
  -- khong co ALLOW exact cho chinh cap sensitive do
  AND NOT EXISTS (
    SELECT 1 FROM live_grants x
    WHERE x.user_id = g.user_id AND x.company_id = g.company_id
      AND x.effect = 'ALLOW' AND x.action = sp.action AND x.resource_type = sp.resource_type
  )
  -- va khong bi DENY o BAT KY hinh dang nao (deny-override wildcard-aware)
  AND NOT EXISTS (
    SELECT 1 FROM live_grants d
    WHERE d.user_id = g.user_id AND d.company_id = g.company_id AND d.effect = 'DENY'
      AND d.action        IN (sp.action, '*')
      AND d.resource_type IN (sp.resource_type, '*')
  )
GROUP BY 1,2,3,4
ORDER BY 1,3,4;

\echo ''
\echo '=== Q3 — actor giu wildcard VA CO grant exact cho cap sensitive ==='
\echo '⚠️ Y NGHIA DOI THEO THIET KE (doc plan §12):'
\echo '  · v1 (DA BO): day la cong DUNG — nhung cap ngoai allowlist se bi AN voi nguoi van dung duoc.'
\echo '  · v2 (DANG LAM): day la nhom DUOC LOI — cap cua ho nay hien DUNG. Chi la so lieu, khong con la cong.'
\echo 'Danh sach man se hien them nam o Q4.'
WITH live_grants AS (
  SELECT ur.user_id, ur.company_id, p.action, p.resource_type, p.is_sensitive, rp.effect
  FROM user_roles ur
  JOIN users u             ON u.id  = ur.user_id AND u.deleted_at IS NULL
  JOIN roles r             ON r.id  = ur.role_id AND r.deleted_at IS NULL
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p       ON p.id  = rp.permission_id
  WHERE ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
SELECT g.action, g.resource_type, count(DISTINCT g.user_id) AS actors
FROM live_grants g
WHERE g.effect = 'ALLOW' AND g.is_sensitive
  AND g.action <> '*' AND g.resource_type <> '*'
  AND EXISTS (
    SELECT 1 FROM live_grants w
    WHERE w.user_id = g.user_id AND w.company_id = g.company_id
      AND w.effect = 'ALLOW' AND (w.action = '*' OR w.resource_type = '*')
  )
GROUP BY 1,2
ORDER BY actors DESC, 1, 2;

\echo ''
\echo '=== Q4 (v2) — MAN SE HIEN THEM: cap SENSITIVE ngoai allowlist ma actor giu bang grant EXACT ==='
\echo 'Duoi hop dong v2, moi hang o day = mot cap se XUAT HIEN tren FE cho so actor tuong ung.'
\echo 'Day KHONG phai rui ro (BE von da ALLOW) — la danh sach CS/owner can biet truoc.'
WITH allowlist(action, resource_type) AS (VALUES
  ('view','audit-log'),
  ('view-own','attendance'),
  ('view-team','attendance'),
  ('view-company','attendance'),
  ('view','leave'),
  ('export','leave'),
  ('view','leave-audit-log'),
  ('view','attendance-audit-log'),
  ('reset-2fa','user'),
  ('assign-role','user'),
  ('assign','permission'),
  ('delete','user'),
  ('restore','user'),
  ('reset-password','user'),
  ('export','attendance'),
  ('delete','project'),
  ('close','project'),
  ('archive','project'),
  ('manage-member','project'),
  ('view-report','project'),
  ('delete','task'),
  ('export','task'),
  ('view','task-audit-log'),
  ('view','notification-config'),
  ('update','notification-config'),
  ('view','notification-template'),
  ('update','notification-template'),
  ('view','notification-delivery-log'),
  ('view','notification-audit-log'),
  ('view-sensitive','employee'),
  ('view-salary','employee'),
  ('export','employee'),
  ('view','dashboard-config'),
  ('update','dashboard-config'),
  ('view-identity','employee'),
  ('import','employee'),
  ('view','leave-policy'),
  ('create','leave-policy'),
  ('update','leave-policy'),
  ('delete','leave-policy'),
  ('create','leave-type'),
  ('update','leave-type'),
  ('delete','leave-type'),
  ('view','leave-balance'),
  ('adjust','leave-balance'),
  ('view-transaction','leave-balance'),
  ('view','chat-oversight'),
  ('configure-security-policy','company'),
  ('view','candidate'),
  ('create','candidate'),
  ('update','candidate'),
  ('move-stage','candidate'),
  ('comment','candidate'),
  ('export','candidate'),
  ('convert','candidate'),
  ('calculate','payroll-period'),
  ('view-line','payroll-period'),
  ('approve','payroll-period'),
  ('publish','payroll-period'),
  ('reopen','payroll-period'),
  ('export','payroll'),
  ('view','salary-profile'),
  ('manage','salary-profile'),
  ('view','bonus-penalty'),
  ('manage','bonus-penalty'),
  ('approve','bonus-penalty'),
  ('view-payslip','payslip'),
  ('view-own-payslip','payslip'),
  ('upload','candidate-file')
),
live_grants AS (
  SELECT ur.user_id, ur.company_id, p.action, p.resource_type, p.is_sensitive, rp.effect
  FROM user_roles ur
  JOIN users u             ON u.id  = ur.user_id AND u.deleted_at IS NULL
  JOIN roles r             ON r.id  = ur.role_id AND r.deleted_at IS NULL
  JOIN role_permissions rp ON rp.role_id = r.id
  JOIN permissions p       ON p.id  = rp.permission_id
  WHERE ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
SELECT g.action, g.resource_type, count(DISTINCT g.user_id) AS actors_gaining_screen
FROM live_grants g
WHERE g.effect = 'ALLOW' AND g.is_sensitive
  AND g.action <> '*' AND g.resource_type <> '*'
  AND NOT EXISTS (SELECT 1 FROM allowlist a
                  WHERE a.action = g.action AND a.resource_type = g.resource_type)
  -- khong bi DENY o bat ky hinh dang nao
  AND NOT EXISTS (
    SELECT 1 FROM live_grants d
    WHERE d.user_id = g.user_id AND d.company_id = g.company_id AND d.effect = 'DENY'
      AND d.action IN (g.action,'*') AND d.resource_type IN (g.resource_type,'*')
  )
GROUP BY 1,2
ORDER BY actors_gaining_screen DESC, 1, 2;

\echo ''
\echo '=== Q5 (v3) — HANG CATALOG DANG WILDCARD kem CO is_sensitive ==='
\echo 'Q0 chi DEM. Q5 doc CO. Mot hang wildcard mang is_sensitive=true la tien de cua phan vi du'
\echo 'trong plan §8 (menh de "khong actor nao MAT khoa").'
SELECT id, action, resource_type, is_sensitive
FROM permissions
WHERE action = '*' OR resource_type = '*'
ORDER BY action, resource_type;

\echo ''
\echo '=== Q6 (v3) — CONG DUNG: grant DENY tro vao mot hang catalog WILDCARD ==='
\echo 'Hom nay getCapabilities gom denyKeys SAU khi da loc `!g.isSensitive` => DENY tren hang'
\echo 'wildcard SENSITIVE la VO HINH. Thiet ke moi gom DENY tren TOAN BO grant => no bat dau'
\echo 'suppress, va co the xoa ca khoa NON-sensitive actor giu bang grant exact.'
\echo '⛔ Q6 tra ve hang nao co is_sensitive=true => DUNG, KHONG merge (doc plan §8).'
WITH live_ur AS (
  SELECT ur.user_id, ur.role_id
  FROM user_roles ur
  JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL
  WHERE ur.deleted_at IS NULL AND (ur.expires_at IS NULL OR ur.expires_at > now())
)
SELECT r.name AS role_name, r.company_id, p.action, p.resource_type,
       p.is_sensitive, rp.effect, count(DISTINCT lu.user_id) AS holders_alive
FROM role_permissions rp
JOIN roles r         ON r.id = rp.role_id AND r.deleted_at IS NULL
JOIN permissions p   ON p.id = rp.permission_id
LEFT JOIN live_ur lu ON lu.role_id = r.id
WHERE (p.action = '*' OR p.resource_type = '*')
  AND rp.effect = 'DENY'
GROUP BY 1,2,3,4,5,6
ORDER BY p.is_sensitive DESC, holders_alive DESC;
