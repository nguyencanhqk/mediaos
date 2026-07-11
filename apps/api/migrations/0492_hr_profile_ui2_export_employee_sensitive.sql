-- Migration 0492: HR-PROFILE-UI-2 / MIG-EXPORT-SENSITIVE (🔴 RED, zone=red, crown) — FLIP độ nhạy cặp
--   quyền ('export','employee') false→true. THUẦN DATA — 1 câu UPDATE idempotent, KHÔNG DDL, KHÔNG RLS/
--   FORCE, KHÔNG db:generate (mirror kiểu 0481/0490 seed-only). RENUMBER 0491→0492 sau va chạm số với
--   0491_s4_dashbe3 (#162, merged trước). NỐI TIẾP head THẬT 0491_s4_dashbe3 (idx 171) → 0492 (idx 172).
--   Hot-file APPEND: KHÔNG rewrite 0444 (catalog gốc), KHÔNG đụng grant/role_permissions (0444 §13 nguyên vẹn).
--
-- VÌ SAO WO NÀY (parity + fail-closed):
--   • 0444 seed ('export','employee', is_sensitive=false) — LỆCH với export:attendance (0454 is_sensitive=true)
--     và export:leave (0455 is_sensitive=true). Export danh bạ nhân sự lộ PII toàn tenant ⇒ PHẢI là cặp
--     NHẠY CẢM, ngang hàng ATT/LEAVE.
--   • is_sensitive=true ⇒ PermissionService fail-closed: chỉ grant EXACT (action,resource_type) mới thoả;
--     grant wildcard '*:*' KHÔNG kế thừa cặp nhạy cảm (permissions.ts:37 "must be granted per-user only").
--     hr + company-admin GIỮ grant EXACT ('export','employee', scope Company — 0444 dòng 119/120) ⇒ vẫn
--     export được, KHÔNG cửa sổ 403. Endpoint GET /hr/employees/export là route MỚI (BE lane sau) ⇒ CHƯA có
--     consumer live tại thời điểm flip ⇒ không consumer nào bị mất quyền đột ngột (không expand-contract gap).
--
-- BỐI CẢNH (UPDATE qua migrator owner, KHÔNG qua app role — mirror 0481:6-11 / 0490):
--   permissions = catalog GLOBAL, KHÔNG có company_id ⇒ KHÔNG RLS (permissions.ts:36-37). App role CHỈ có
--   GRANT SELECT (không UPDATE/DELETE). Migrator chạy DATABASE_DIRECT_URL = role owner mediaos (privileged)
--   ⇒ UPDATE catalog chạy TRỰC TIẾP tại migrate-time. Runtime app role KHÔNG sửa được độ nhạy — bất biến giữ.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   #1 KHÔNG đụng cô lập tenant: permissions không có company_id/RLS; migration KHÔNG tạo/sửa policy, KHÔNG
--      backfill company_id. RLS+FORCE các bảng nghiệp vụ đã bật ở migration của chúng, KHÔNG liên quan.
--   #2 KHÔNG hard-delete, KHÔNG rewrite catalog: chỉ UPDATE cột is_sensitive IN-PLACE (giữ id ⇒ FK
--      role_permissions.permission_id nguyên vẹn). KHÔNG đổi (action,resource_type). KHÔNG chạm grant 0444.
--   #3 Idempotent: WHERE ... AND is_sensitive IS DISTINCT FROM true ⇒ chạy lại 0 hàng, KHÔNG đổi count,
--      KHÔNG ném exception. Nếu cặp chưa tồn tại (0444 chưa áp) ⇒ 0 hàng, an toàn (drizzle chỉ áp 1 lần).
--
-- BAND 0492 (lane MIG-EXPORT-SENSITIVE / HR-PROFILE-UI-2 — RENUMBER 0491→0492). Journal: idx 172,
--   when 1717500855000 (> head THẬT 0491_s4_dashbe3 idx 171 / 1717500850000). Nối tiếp ĐƠN ĐIỆU sau head.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────────────────────────────
-- FLIP is_sensitive false→true cho cặp EXACT ('export','employee'). Idempotent (IS DISTINCT FROM true).
--   Sau flip: export danh bạ = cặp nhạy cảm fail-closed (parity export:attendance/leave); wildcard *:* không
--   thoả; hr/company-admin giữ grant EXACT Company nên vẫn export.
-- ────────────────────────────────────────────────────────────────────────────────────────────────
UPDATE permissions
SET is_sensitive = true
WHERE action = 'export'
  AND resource_type = 'employee'
  AND is_sensitive IS DISTINCT FROM true;
