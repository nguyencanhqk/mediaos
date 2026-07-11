-- Migration 0488: S4-DASH-SEED-2 (🔴 RED, zone=red, FULL gate) — BACKFILL grant (read,dashboard) cho
--   role GLOBAL canonical `manager` + `hr` bị lỡ ở blanket mig 0100. THUẦN ADDITIVE DATA (per-pair
--   INSERT trong DO-block) — KHÔNG DDL, KHÔNG db:generate. NỐI TIẾP 0487 (S4-NOTI-BE-4).
--
-- BAND 0488 (lane dashseed2). Journal: idx 168, when 1717500835000 (> head 0487 idx 167 / 1717500830000).
--   Nối tiếp ĐƠN ĐIỆU sau 0487_s4_notibe4_admin_config_grant.
--
-- ═══════════════════════ ROOT CAUSE — blanket-timing gap 0100 ↔ 0444 ═══════════════════════
--   Mig 0100 (G14-1, idx 53) seed (read,dashboard) cho "MỌI system role" bằng:
--     INSERT INTO role_permissions ... FROM roles r CROSS JOIN permissions p
--      WHERE p.resource_type='dashboard' ...
--   Blanket CROSS JOIN đó chỉ phủ các role TỒN TẠI TẠI THỜI ĐIỂM 0100 chạy (10 role legacy của
--   0005/0019/0074: company-admin, project-manager, channel-manager, script-writer, editor, qa-reviewer,
--   uploader, employee, hr-manager, finance-manager). Hai role canonical `manager` + `hr` sinh SAU ở
--   mig 0444 (S2-AUTH-SEED-1, idx 127) ⇒ blanket-0100 KHÔNG BAO GIỜ chạm tới chúng ⇒ (read,dashboard)
--   thiếu vĩnh viễn cho manager/hr. Hệ quả runtime: GET /dashboard/me|/types|/summary (gate
--   @RequirePermission('read','dashboard')) trả 403 cho 2/4 persona canonical (manager, hr) — 3 int-spec
--   đỏ của lane S4-DASH-BE-1, đã xác minh psql độc lập trên DB cô lập.
--
--   Bằng chứng tài liệu: 0484 (S4-DASH-SEED-1) dòng ~65 ghi comment "KHÔNG đụng ('read','dashboard') của
--   mig 0100" — lane DASH-SEED-1 GIẢ ĐỊNH (SAI) rằng 0100 đã phủ mọi role kể cả manager/hr, nên chỉ seed
--   các cặp view-*:dashboard MỚI mà không rà lại blanket cũ. 0488 sửa đúng lỗ hổng đó.
--
-- ═══════════════════════ data_scope = 'Company' (mirror ĐÚNG 0100, KHÔNG 'Own') ═══════════════════════
--   0100 chạy TRƯỚC khi cột role_permissions.data_scope ra đời (thêm ở mig 0441 S2-AUTH-DB-1 dưới dạng
--   `text NOT NULL DEFAULT 'Company'`). Backfill DEFAULT của 0441 gán 'Company' cho MỌI row có sẵn của
--   0100 — bao gồm employee/company-admin/…/read:dashboard. Xác minh empirically trên LANE_DB
--   mediaos_dashseed2 (chain 0000→0487): 10 role legacy read:dashboard đều data_scope='Company'.
--   ⇒ 'Company' là giá trị ĐÚNG-THEO-DỮ-LIỆU để mirror cho manager+hr. KHÔNG dùng 'Own': 'Own' là lựa
--   chọn least-privilege RIÊNG của 0484 cho các cặp view-*:dashboard (per-widget, semantically scope-less)
--   — KHÁC hoàn toàn cặp (read,dashboard). Masking chi tiết vẫn do DashboardService ép server-side theo
--   perm task/attendance/leave sẵn có (0100 header), 'Company' ở đây chỉ mở cửa endpoint tổng hợp.
--
-- ═══════════════════════ RÀ 3 blanket tiền-0444 CÒN LẠI (0063/0101/0132) — DOC-ONLY ═══════════════════════
--   • 0101 (G14-2 report_permissions_seed): CÙNG cơ chế time-of-run drift như 0100 — enumerate
--     `WHERE r.name IN (...,'hr','manager')` CHẠY TRƯỚC khi hr/manager tồn tại ⇒ các cặp
--     employee_report/attendance_report/... cho hr/manager cũng KHÔNG landed. CỐ Ý KHÔNG sửa ở đây:
--     report/finance-theo-kênh là domain PARK (out-of-scope, fail-closed — CLAUDE.md reframe 2026-06-20).
--     Chỉ backfill (read,dashboard). GHI NHẬN để WO report tương lai xử lý.
--   • 0063 (G11 permissions_seed) & 0132 (G12 approval_audit_perms): dùng fixed-UUID legacy liệt kê tường
--     minh (company-admin …0001, hr-manager …0009, project-manager …0002, …) — KHÔNG match theo `name`
--     trên bảng roles đang đổi. Cơ chế KHÁC 0100/0101: chúng cấu trúc KHÔNG BAO GIỜ nhắm role manager/hr
--     (2 role đó không có trong danh sách UUID cố định) ⇒ đây KHÔNG phải cùng một bug. Phân biệt rạch ròi
--     để người đọc sau không gộp "cùng 1 lỗi cần cùng 1 fix".
--   • OUT-OF-SCOPE: 'platform-admin' (mig 0230) cũng lỡ (read,dashboard) qua CÙNG lỗ 0100, nhưng là role
--     SaaS/platform-tier — KHÔNG thuộc 4 persona canonical S4-DASH-BE-1. KHÔNG grant, KHÔNG assert ở WO này.
--
-- ═══════════════════════ BÀI HỌC QUY TRÌNH (done_when#4) ═══════════════════════
--   Tạo ROLE MỚI (0444 thêm manager/hr) PHẢI rà + backfill mọi blanket-grant tiền-nhiệm (0100 read:dashboard,
--   0101 report) đã chạy TRƯỚC nó — nếu không role mới im lặng thiếu quyền mà seed sau (0484) tưởng đã có.
--   Chuẩn hoá: mọi migration tạo role canonical mới đi kèm audit "predecessor blanket grants".
--
-- ═══════════════════════ BẤT BIẾN (CLAUDE.md §2/§3/§9) ═══════════════════════
--   #1 tenant: role_permissions/roles/permissions là catalog GLOBAL (company_id IS NULL cho system role).
--      Ghi qua migrator OWNER (DATABASE_DIRECT_URL, rolbypassrls) — KHÔNG qua app runtime. KHÔNG ĐỤNG
--      RLS/FORCE/policy của bất kỳ bảng nào (thuần DML, zero DDL) — mirror 0444/0480/0484.
--   #2 no hard-delete / append-only: KHÔNG DELETE/UPDATE. Không ghi audit_logs lúc migrate-time (nhất quán
--      0444/0480/0484/0487 — seed grant migrate-time không audit-log trong codebase này).
--   #3 no secret: thuần metadata catalog (role name / action / resource_type / data_scope) — 0 PII/secret.
--
--   PER-PAIR ONLY (KHÔNG blanket): mỗi vòng lặp resolve + filter theo CẢ role_id VÀ permission_id (RAISE
--     EXCEPTION nếu thiếu) — KHÔNG có DELETE/UPDATE lọc-theo-role_id-đơn-độc (sẽ vô tình strip các grant
--     KHÁC của manager/hr: 0444 view:me, 0484 view-employee/view-manager/view-hr:dashboard).
--   Idempotent: (manager|hr, read:dashboard) CHƯA từng tồn tại ở BẤT KỲ scope nào ⇒ plain INSERT ...
--     ON CONFLICT (role_id,permission_id,effect) DO NOTHING là ĐỦ — KHÔNG cần bước DELETE-wrong-scope (khác
--     0444/0480/0484 vốn sửa scope-sai trên cặp đã-granted). Chạy lại = no-op, không drift scope.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- {role, action, resource_type, data_scope}
  dash_grants CONSTANT text[][] := ARRAY[
    ['manager', 'read', 'dashboard', 'Company'],  -- backfill blanket-0100 (manager sinh ở 0444)
    ['hr',      'read', 'dashboard', 'Company']    -- backfill blanket-0100 (hr sinh ở 0444)
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY dash_grants LOOP
    -- Resolve role_id (role GLOBAL, chưa soft-delete). RAISE nếu thiếu — 0444 phải chạy trước.
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0488] role canonical % không tồn tại — seed 0444 phải chạy trước', g[1];
    END IF;

    -- Resolve permission_id. Catalog (read,dashboard) đã tồn tại từ 0100 — KHÔNG re-insert catalog.
    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0488] permission (%:%) không có trong catalog — mig 0100 phải chạy trước', g[2], g[3];
    END IF;

    -- Per-pair INSERT: lọc theo CẢ role_id VÀ permission_id. ON CONFLICT(role_id,permission_id,effect)
    -- DO NOTHING ⇒ idempotent, KHÔNG drift scope, KHÔNG đụng grant khác của role.
    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0488] DASH read:dashboard backfill (manager+hr): % INSERT mới', v_seeded;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- -- Down (manual — chỉ tham khảo, KHÔNG tự chạy)
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id = r.id AND rp.permission_id = p.id
--     AND r.name IN ('manager','hr') AND r.company_id IS NULL
--     AND rp.effect = 'ALLOW' AND p.action = 'read' AND p.resource_type = 'dashboard';
