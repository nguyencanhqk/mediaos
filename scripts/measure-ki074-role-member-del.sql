-- measure-ki074-role-member-del.sql — số đo cho KI-074 (S10-SEC-ROLEMEMBERDEL-1).
--
-- CÂU HỎI: có ai gọi được `DELETE /permissions/users/:userId/roles/:roleId` mà rơi vào **nhánh 204
-- MỚI** của hướng (b) không? Tức: giữ `assign-role:user` NHƯNG scope mạnh nhất của cặp danh bạ
-- `view:user` KHÔNG thuộc {Company, System}.
--
-- ⚠️ HAI CẶP, KHÔNG PHẢI MỘT. Cặp `assign-role:user` quyết định AI GỌI ĐƯỢC route; cặp `view:user`
-- quyết định HÌNH DẠNG CÂU TRẢ LỜI. Đo scope của `assign-role:user` là đo nhầm cặp.
--
-- ⚠️ BỐN HÌNH DẠNG WILDCARD, HAI VẾ ĐỘC LẬP: `action IN (…,'*') AND resource_type IN (…,'*')`.
--    Viết `(action, resource_type) IN (('view','user'),('*','*'))` là MÙ với ('view','*') và ('*','user').
--
-- ⚠️ Mô phỏng ĐÚNG `PermissionService.resolveStrongestScope`: DENY-overrides trước → EXACT thắng
--    WILDCARD (vì `view:user` là is_sensitive=false) → lấy scope MẠNH NHẤT trong tập eligible.
--    Một vai giữ `*:*@Company` mà được cấp thêm `view:user@Own` sẽ TỤT xuống nhánh 204.
--
-- ⚠️ KHÔNG thấy super-admin ở đây nếu SA không đi qua `user_roles`: SA được
--    `SuperAdminBootstrapRepository.grantPermissionWithScope` cấp toàn catalog ở data_scope='System'.
--
-- CHẠY (PROD):
--   docker exec -i <pg> psql -U <user> -d <db> -f - < scripts/measure-ki074-role-member-del.sql
--   (hoặc: psql "$DATABASE_DIRECT_URL" -f scripts/measure-ki074-role-member-del.sql)

\echo '== 1. Cờ is_sensitive của các cặp liên quan (CỔNG của route — xem DECISIONS-11 §6)'
SELECT action, resource_type, is_sensitive
  FROM permissions
 WHERE action IN ('view', 'assign-role', '*')
   AND resource_type IN ('user', '*')
 ORDER BY action, resource_type;

\echo ''
\echo '== 2. Grant khớp assign-role:user (4 hình dạng wildcard) — AI gọi được route'
SELECT r.name AS role_name, r.company_id, p.action, p.resource_type, rp.effect, rp.data_scope
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id AND r.deleted_at IS NULL
  JOIN permissions p ON p.id = rp.permission_id
 WHERE p.action IN ('assign-role', '*')
   AND p.resource_type IN ('user', '*')
 ORDER BY r.name, p.action, p.resource_type;

\echo ''
\echo '== 3. Grant khớp view:user (4 hình dạng wildcard) — bit lái HÌNH DẠNG câu trả lời'
SELECT r.name AS role_name, p.action, p.resource_type, p.is_sensitive, rp.effect, rp.data_scope
  FROM role_permissions rp
  JOIN roles r ON r.id = rp.role_id AND r.deleted_at IS NULL
  JOIN permissions p ON p.id = rp.permission_id
 WHERE p.action IN ('view', '*')
   AND p.resource_type IN ('user', '*')
 ORDER BY r.name, p.action, p.resource_type;

\echo ''
\echo '== 4. KẾT LUẬN — mỗi người giữ assign-role:user rơi vào nhánh nào của hướng (b)'
WITH assigners AS (
  SELECT DISTINCT ur.user_id
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ur.deleted_at IS NULL
     AND (ur.expires_at IS NULL OR ur.expires_at > now())
     AND rp.effect = 'ALLOW'
     AND p.action IN ('assign-role', '*')
     AND p.resource_type IN ('user', '*')
), vu AS (
  SELECT ur.user_id, rp.effect, rp.data_scope,
         (p.action = 'view' AND p.resource_type = 'user') AS is_exact
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ur.deleted_at IS NULL
     AND (ur.expires_at IS NULL OR ur.expires_at > now())
     AND p.action IN ('view', '*')
     AND p.resource_type IN ('user', '*')
), denied AS (
  SELECT DISTINCT user_id FROM vu WHERE effect = 'DENY'
), allow AS (
  SELECT user_id, data_scope, is_exact FROM vu WHERE effect = 'ALLOW'
), eligible AS (
  -- EXACT thắng WILDCARD (cặp non-sensitive) — mirror permission.service.ts:606-607.
  SELECT a.user_id, a.data_scope
    FROM allow a
   WHERE a.is_exact
      OR NOT EXISTS (SELECT 1 FROM allow x WHERE x.user_id = a.user_id AND x.is_exact)
), strongest AS (
  SELECT s.user_id,
         (d.user_id IS NOT NULL) AS is_denied,
         (SELECT e.data_scope FROM eligible e
           WHERE e.user_id = s.user_id
           ORDER BY CASE e.data_scope
                      WHEN 'System' THEN 5 WHEN 'Company' THEN 4 WHEN 'Department' THEN 3
                      WHEN 'Team' THEN 2 WHEN 'Own' THEN 1 ELSE 0 END DESC
           LIMIT 1) AS sc
    FROM assigners s
    LEFT JOIN denied d ON d.user_id = s.user_id
)
SELECT u.email,
       CASE WHEN st.is_denied THEN NULL ELSE st.sc END AS strongest_view_user_scope,
       CASE WHEN st.is_denied           THEN '204 (DENY view:user)'
            WHEN st.sc IN ('Company', 'System') THEN '404 (GIỮ NGUYÊN)'
            ELSE '204 (NHÁNH MỚI)' END AS branch_under_b
  FROM strongest st
  JOIN users u ON u.id = st.user_id
 ORDER BY branch_under_b, u.email;

\echo ''
\echo '== 5. Số phải bằng 0 để (b) là no-op trên thực địa'
WITH assigners AS (
  SELECT DISTINCT ur.user_id
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ur.deleted_at IS NULL
     AND (ur.expires_at IS NULL OR ur.expires_at > now())
     AND rp.effect = 'ALLOW'
     AND p.action IN ('assign-role', '*')
     AND p.resource_type IN ('user', '*')
), vu AS (
  SELECT ur.user_id, rp.effect, rp.data_scope,
         (p.action = 'view' AND p.resource_type = 'user') AS is_exact
    FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE ur.deleted_at IS NULL
     AND (ur.expires_at IS NULL OR ur.expires_at > now())
     AND p.action IN ('view', '*')
     AND p.resource_type IN ('user', '*')
), allow AS (
  SELECT user_id, data_scope, is_exact FROM vu WHERE effect = 'ALLOW'
), eligible AS (
  SELECT a.user_id, a.data_scope FROM allow a
   WHERE a.is_exact
      OR NOT EXISTS (SELECT 1 FROM allow x WHERE x.user_id = a.user_id AND x.is_exact)
)
SELECT count(*) AS actors_falling_into_new_204_branch
  FROM assigners s
 WHERE COALESCE(
         (SELECT e.data_scope FROM eligible e
           WHERE e.user_id = s.user_id
           ORDER BY CASE e.data_scope
                      WHEN 'System' THEN 5 WHEN 'Company' THEN 4 WHEN 'Department' THEN 3
                      WHEN 'Team' THEN 2 WHEN 'Own' THEN 1 ELSE 0 END DESC
           LIMIT 1), 'NONE') NOT IN ('Company', 'System')
    OR EXISTS (SELECT 1 FROM vu d WHERE d.user_id = s.user_id AND d.effect = 'DENY');
