-- Migration 0569: S14-RECRUIT-FILEGRANT-1 (🔴 RED, zone=red, crown) — đóng gap tệp CV cho recruiter/hr.
--   Seed ĐÚNG MỘT cặp quyền mới `('upload','candidate-file')` is_sensitive=TRUE + 3 grant @Company
--   (recruiter · hr · company-admin). THUẦN DATA — KHÔNG DDL, KHÔNG db:generate, KHÔNG đụng CHECK
--   audit_logs.object_type (tệp CV ghi qua FileService: object_type 'file'/'file_link' đã có sẵn).
--
-- BỐI CẢNH (plan docs/plans/S14-RECRUIT-FILEGRANT-1.md §1 — ĐO TRÊN DB THẬT, không trích migration):
--   Luồng CV (SPEC-12 §15) đi qua Foundation Files GENERIC, gate `*:foundation-file` ở FilesController.
--   Census 4 hình dạng (permission-grant-census-must-cover-four-wildcard-shapes), mọi role, loại
--   super-admin theo TÊN: chỉ `company-admin` · `SA` · `QUẢN LÝ CẤP CAO` giữ 6 cặp foundation-file
--   @Company; `recruiter`/`hr` giữ 0 ⇒ không đính/tải được CV.
--
-- QUYẾT ĐỊNH CHỐT (owner 04/09 + plan §0/§3.2):
--   D1 KHÔNG cấp cặp `foundation-file` cho recruiter/hr. Đo được: `view:foundation-file` là cổng màn
--      quản trị System>Files (sidebar-registry:692) và `GET /foundation/files` KHÔNG gác per-file
--      (file.repository:308 bỏ qua moduleCode/entityType/entityId) ⇒ cấp = mở trình duyệt tệp toàn
--      tenant. Thay bằng wrapper RECRUIT (khuôn ChatFilesService/MeAvatarService, đã qua FULL gate 3 lần).
--   D2 KHÔNG cấp `update:candidate` cho hr để hr link được CV: SPEC-12 §11:276 chốt "người giữ cặp này
--      thấy email/phone KHÔNG che" ⇒ sẽ bỏ mask PII cho TOÀN role hr, hệ quả không ai yêu cầu.
--   D3 Resource là **`candidate-file`**, KHÔNG phải `('file-upload','candidate')` — LÝ DO KỸ THUẬT,
--      không phải sở thích đặt tên. `0560:336-347` (b1) RAISE nếu grant của 5 role hệ thống trên
--      resource_type IN ('recruit','job-opening','candidate','interview','offer') <> 42; `0560:431-444`
--      (b4) RAISE nếu company-admin/recruiter <> 14 cặp @Company trên đúng 5 resource đó; và int-spec
--      I1 (s12-recruit-db1-invariants:982-1016) ĐỌC 0560_*.sql TỪ ĐĨA rồi CHẠY LẠI. Đặt cặp mới trên
--      `candidate` ⇒ migration ĐÃ SHIP nổ khi replay, exception ném từ trong SQL nên không "cập nhật
--      kỳ vọng ở test" được. `IN (...)` so bằng chính xác ⇒ 'candidate-file' không khớp 'candidate'.
--      AI ĐỔI TÊN CẶP PHẢI ĐỌC ĐOẠN NÀY TRƯỚC.
--   D4 is_sensitive=TRUE (khác `file-*:employee` mig 0477 vốn false): CV là PII ứng viên, REC-DEC-003
--      chốt họ `candidate` sensitive. Kéo theo BẮT BUỘC cùng commit: APPEND "upload:candidate-file" vào
--      CẢ HAI mảng permission.service.ts (SENSITIVE_CAPABILITY_ALLOWLIST + SENSITIVE_SCREEN_GATE_PAIRS)
--      — thiếu ⇒ /auth/me không trả ⇒ nút ẩn với CHÍNH role được cấp (lặp lần 12+ của CAP-2).
--
-- BẤT BIẾN / HOT-FILE: role_permissions UNIQUE(role_id,permission_id,effect) KHÔNG gồm data_scope ⇒
--   đổi scope = DELETE đúng bộ scope SAI (per-pair, KHÔNG blanket) + INSERT ON CONFLICT DO NOTHING.
--   Mọi câu đếm role NEO `company_id IS NULL AND deleted_at IS NULL` (0506:215, 0560:161, 0477:76).
--
-- BAND 0569 (lane S14-RECRUIT-FILEGRANT-1). Journal: idx 236, when 1717587358000 (> 0568 idx 235).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (1) Catalog: 1 cặp `('upload','candidate-file')` is_sensitive=TRUE ───────────────
-- ⚠️ `ON CONFLICT DO NOTHING` NUỐT ca "cặp đã tồn tại với is_sensitive=false" trong im lặng — đúng hình
--    dạng fail-OPEN (empty-success-is-the-fail-open-shape): seed báo thành công, cổng sensitive TẮT, và
--    `('*','*')` mở được đường GHI tệp CV. Guard TRƯỚC khi insert.
DO $$
DECLARE v_sens boolean;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  SELECT is_sensitive INTO v_sens
    FROM permissions WHERE action = 'upload' AND resource_type = 'candidate-file';
  IF FOUND AND v_sens IS DISTINCT FROM true THEN
    RAISE EXCEPTION '[0569] cap (upload,candidate-file) DA ton tai voi is_sensitive=% (ky vong true) — co ai lat co', v_sens;
  END IF;
END;
$$;
--> statement-breakpoint
INSERT INTO permissions (action, resource_type, is_sensitive) VALUES
  ('upload', 'candidate-file', true)  -- RECRUIT.CANDIDATE-FILE.UPLOAD — đăng ký + xác nhận + gắn CV
ON CONFLICT (action, resource_type) DO NOTHING;
--> statement-breakpoint

-- ─────────────── (2) Grant per-(role, pair) = 3 hàng @Company (khuôn 0560 bước 4 / 0477 bước B) ───────────────
DO $$
DECLARE
  file_grants CONSTANT text[][] := ARRAY[
    ['recruiter',     'upload', 'candidate-file', 'Company'],
    ['hr',            'upload', 'candidate-file', 'Company'],
    ['company-admin', 'upload', 'candidate-file', 'Company']
  ];
  g          text[];
  v_role_id  uuid;
  v_perm_id  uuid;
  v_seeded   int := 0;
  v_rescoped int := 0;
  v_del      int;
BEGIN
  FOREACH g SLICE 1 IN ARRAY file_grants LOOP
    SELECT id INTO v_role_id
      FROM roles
     WHERE name = g[1] AND company_id IS NULL AND deleted_at IS NULL;
    IF v_role_id IS NULL THEN
      RAISE EXCEPTION '[0569] role he thong % khong ton tai — seed 0005/0444/0560 phai chay truoc', g[1];
    END IF;

    SELECT id INTO v_perm_id
      FROM permissions
     WHERE action = g[2] AND resource_type = g[3];
    IF v_perm_id IS NULL THEN
      RAISE EXCEPTION '[0569] permission (%:%) khong co trong catalog — buoc (1) phai chay truoc', g[2], g[3];
    END IF;

    DELETE FROM role_permissions
     WHERE role_id = v_role_id
       AND permission_id = v_perm_id
       AND effect = 'ALLOW'
       AND data_scope <> g[4];
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_rescoped := v_rescoped + v_del;

    INSERT INTO role_permissions (role_id, permission_id, effect, data_scope)
    VALUES (v_role_id, v_perm_id, 'ALLOW', g[4])
    ON CONFLICT (role_id, permission_id, effect) DO NOTHING;
    GET DIAGNOSTICS v_del = ROW_COUNT;
    v_seeded := v_seeded + v_del;
  END LOOP;

  RAISE NOTICE '[0569] upload:candidate-file grants: % INSERT moi, % re-scope (ky vong 3 role)', v_seeded, v_rescoped;
END;
$$;
--> statement-breakpoint

-- ─────────────── (3) Verify NEGATIVE: KHÔNG role hệ thống nào KHÁC giữ cặp này ───────────────
-- KHÔNG neo danh sách ['manager','employee','hr-manager']: repo còn ≥12 role company_id IS NULL khác
-- (asset-manager, office-admin, payroll-officer…) — đúng bài học MED-2 ghi ở
-- s12-recruit-db1-invariants:687-691 (neo vài role thì WO sau grant cho role thứ 13 KHÔNG gì đỏ).
DO $$
DECLARE v_extra text;
BEGIN
  SELECT string_agg(r.name, ', ' ORDER BY r.name) INTO v_extra
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'upload' AND p.resource_type = 'candidate-file'
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND r.name NOT IN ('recruiter', 'hr', 'company-admin');
  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION '[0569] role he thong NGOAI 3 role dich dang giu upload:candidate-file: %', v_extra;
  END IF;
END;
$$;
--> statement-breakpoint

-- ─────────────── (3b) Verify DƯƠNG: đúng 3 ALLOW@Company + 0 hàng DENY (khuôn 0477 khối C) ───────────────
-- Vì sao vế DENY: UNIQUE là (role_id, permission_id, effect) ⇒ `DELETE … data_scope <> 'Company'` +
-- `INSERT ON CONFLICT DO NOTHING` KHÔNG dọn một hàng effect='DENY' có sẵn. DENY đẩy resolve về NULL
-- (permission.service:589) ⇒ grant CHẾT mà migration vẫn báo thành công — fail-OPEN ngược (fail-shut
-- im lặng), người vận hành không có cách nào biết ngoài việc thử.
DO $$
DECLARE v_allow int; v_deny int;
BEGIN
  SELECT
    count(*) FILTER (WHERE rp.effect = 'ALLOW' AND rp.data_scope = 'Company'),
    count(*) FILTER (WHERE rp.effect = 'DENY')
  INTO v_allow, v_deny
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE p.action = 'upload' AND p.resource_type = 'candidate-file'
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND r.name IN ('recruiter', 'hr', 'company-admin');

  IF v_allow <> 3 THEN
    RAISE EXCEPTION '[0569] verify: % grant ALLOW@Company cho upload:candidate-file, ky vong 3', v_allow;
  END IF;
  IF v_deny <> 0 THEN
    RAISE EXCEPTION '[0569] verify: % hang DENY cho upload:candidate-file — DELETE+INSERT khong don duoc DENY (UNIQUE gom effect)', v_deny;
  END IF;
  RAISE NOTICE '[0569] verify OK: 3 ALLOW@Company, 0 DENY';
END;
$$;
--> statement-breakpoint

-- ─────────────── (4) Verify BẤT BIẾN TRUNG TÂM: WO này KHÔNG nới quyền `foundation-file` ───────────────
-- ⚠️ CỐ Ý KHÔNG đếm tổng số hàng foundation-file. Đo được (plan §4): DB có dump PROD = 18 hàng (3 role,
--    trong đó `SA`/`QUẢN LÝ CẤP CAO` là role TUỲ BIẾN TENANT), lane/CI dựng từ migration = 6 hàng
--    (chỉ company-admin). RAISE theo con số ⇒ db:migrate FAIL trên mọi DB sạch.
--
-- ⚠️ CẢ HAI vế NEO `r.company_id IS NULL` — thiếu là nổ CHỈ TRÊN DB THẬT:
--    • SuperAdminBootstrapRepository grant TOÀN BỘ catalog không lọc (:127-128) cho role `super-admin`
--      COMPANY-SCOPED (:44). Catalog CÓ cặp ('*','*') ⇒ vế wildcard không neo sẽ RAISE trên mọi DB đã
--      bootstrap. (DB dev hiện chưa bootstrap nên bẫy này KHÔNG lộ ra khi thử local.)
--    • roles_system_name_active_uq chỉ ép duy nhất cho role HỆ THỐNG; một tenant hoàn toàn có thể có
--      role company-scoped tên 'hr' (đúng cách SA / QUẢN LÝ CẤP CAO tồn tại). Role đó giữ
--      foundation-file là chuyện của tenant, KHÔNG phải seed của ta ⇒ không được RAISE.
DO $$
DECLARE v_bad text; v_wild text;
BEGIN
  -- (4a) recruiter/hr KHÔNG được chạm foundation-file qua BẤT KỲ hình dạng nào trong bốn.
  SELECT string_agg(DISTINCT r.name || ':' || p.action || ':' || p.resource_type, ', ') INTO v_bad
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.name IN ('recruiter', 'hr')
     AND r.company_id IS NULL AND r.deleted_at IS NULL
     AND p.action IN ('upload', 'view', 'download', 'delete', 'link', 'unlink', '*')
     AND p.resource_type IN ('foundation-file', '*');
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '[0569] BAT BIEN VO: recruiter/hr dang giu grant foundation-file (%) — WO nay CHU DICH khong cap', v_bad;
  END IF;

  -- (4b) Không role HỆ THỐNG nào giữ wildcard (đường ngầm vào cặp sensitive, mirror E2 của 0560).
  SELECT string_agg(DISTINCT r.name || ':' || p.action || ':' || p.resource_type, ', ') INTO v_wild
    FROM role_permissions rp
    JOIN roles r       ON r.id = rp.role_id
    JOIN permissions p ON p.id = rp.permission_id
   WHERE r.company_id IS NULL AND r.deleted_at IS NULL
     AND (p.action = '*' OR p.resource_type = '*');
  IF v_wild IS NOT NULL THEN
    RAISE EXCEPTION '[0569] role he thong giu grant wildcard (%) — duong ngam vao cap sensitive', v_wild;
  END IF;

  RAISE NOTICE '[0569] verify OK: 0 grant foundation-file cho recruiter/hr, 0 wildcard cho role he thong';
END;
$$;

-- -------- Down (manual) --------
-- DELETE FROM role_permissions rp USING roles r, permissions p
--   WHERE rp.role_id = r.id AND rp.permission_id = p.id
--     AND r.name IN ('recruiter','hr','company-admin') AND r.company_id IS NULL
--     AND p.action = 'upload' AND p.resource_type = 'candidate-file';
-- DELETE FROM permissions WHERE action = 'upload' AND resource_type = 'candidate-file';
-- ⚠️ KHÔNG có feature-flag: modules.is_active KHÔNG phải cổng (module-is-active-is-not-a-gate) ⇒ 5 route
--    RECRUIT-API-033..037 sống ngay khi merge. Đường lùi thật = revert code + chạy khối Down này.
