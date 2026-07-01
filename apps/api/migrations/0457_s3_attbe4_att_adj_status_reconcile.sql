-- Migration 0457: S3-ATT-BE-4-MIG (🔴 red-zone, crown) — reconcile attendance_adjustment_requests
--   status LOWERCASE → TitleCase canonical (DB-04 §7.6) + unique-pending-guard §7.6.1.
--
-- MỤC TIÊU (WO S3-ATT-BE-4, lane MIG — owner chốt stance reconcile TitleCase):
--   (a) RECONCILE status: bảng cũ (mig 0061) dùng lowercase 'pending'/'approved'/'rejected'/'cancelled'
--       + CHECK att_adj_status_check. Canonical DB-04 §7.6 = 'Draft'/'Pending'/'Approved'/'Rejected'/
--       'Cancelled'. Trình tự AN TOÀN: DROP CHECK cũ → UPDATE rows lowercase→TitleCase (idempotent) →
--       SET DEFAULT 'Pending' → ADD CHECK MỚI chk_att_adj_requests_status. KHÔNG đổi cột status kiểu.
--   (b) UNIQUE chống trùng request pending §7.6.1: uq_att_adj_pending_employee_date_type trên
--       (company_id, employee_id, work_date, request_type) WHERE deleted_at IS NULL AND status='Pending'.
--       DROP guard cũ att_adj_requests_pending_uq (user_id, work_date, status='pending') — không còn khớp
--       sau reconcile (predicate lowercase chết) + quá chặt (chặn mọi type/ngày). Guard MỚI theo request_type.
--   (c) VERIFY đủ cột §7.6 — 0452 đã ADD toàn bộ (employee_id/request_type/submitted_at/requested_by/
--       current_approver_*/reviewed_by/reviewed_at/review_note/request_code/attachment_file_id/metadata/
--       created_by/updated_by/deleted_by). Belt-and-suspenders ADD COLUMN IF NOT EXISTS (no-op nếu có).
--   (d) AUDIT object_types: KHÔNG thêm type mới. Approve/reject/adjust-direct ghi audit trên object_type
--       ĐÃ CÓ: 'attendance_adjustment_request' (Requested/Approved/Rejected) + 'attendance_record'
--       (RecordAdjusted) — mig 0014/schema audit.ts §90. CHECK audit_logs GIỮ NGUYÊN (append-only #2).
--
-- ⚠️ COORDINATION CROWN (owner chốt — red-zone merge gate): writer cũ /attendance/adjustments
--   (attendance.service.ts:488) INSERT status='pending' (lowercase) TƯỜNG MINH + so sánh status='pending'.
--   Sau migration này CHECK chỉ nhận TitleCase ⇒ writer cũ INSERT sẽ vỡ (23514) tới khi lane SVC/converge
--   flip 'pending'→'Pending' (WO bước 3–4). Migration này ĐÚNG canonical spec; convergence là điều kiện
--   MERGE (không merge lẻ trước khi writer converge). Không có 2 writer lệch status sau converge.
--
-- BẤT BIẾN / HOT-FILE (CLAUDE.md §2/§3/§9):
--   • RLS + FORCE ROW LEVEL SECURITY: GIỮ NGUYÊN (đã bật mig 0061) — KHÔNG DROP/đụng policy tenant_isolation.
--   • Grant append-only attendance_adjustment_items (SELECT,INSERT — mig 0452): KHÔNG đổi.
--   • Audit append-only (#2): KHÔNG đụng CHECK object_type / grant audit_logs.
--   • Soft-delete deleted_at giữ; UUID PK; timestamptz UTC-at-rest (ADR-0008). KHÔNG hard-delete.
--   • DDL thủ công (status reconcile + CHECK swap + partial unique không biểu diễn được bằng db:generate) —
--     KHÔNG db:generate cho file này; schema/hr.ts sync canonical CÙNG commit.
--   • Idempotent: DROP/ADD CONSTRAINT IF EXISTS · UPDATE chỉ khớp lowercase · CREATE/DROP INDEX IF (NOT) EXISTS.
--
-- BAND 0457 (lane S3-ATT-BE-4-MIG / db-migration). Journal: idx 137, when 1717500680000
--   (> head 0456 idx 136 / 1717500675000). NỐI TIẾP ĐƠN ĐIỆU sau head thực tế 0456_s2_fndbe3_retention_audit_object_type.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ─────────────── (c) VERIFY cột §7.6 (0452 đã ADD — no-op idempotent) ───────────────
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS request_code text;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS request_type text;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS current_approver_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS current_approver_employee_id uuid REFERENCES employee_profiles(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS attachment_file_id uuid REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance_adjustment_requests ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES users(id) ON DELETE SET NULL;

-- ─────────────── (a) RECONCILE status lowercase → TitleCase ───────────────
-- STEP 1: DROP CHECK cũ (att_adj_status_check = lowercase) TRƯỚC — để UPDATE sang TitleCase KHÔNG vỡ CHECK.
--         CHECK là ràng buộc kiểm cả trên UPDATE ⇒ phải gỡ trước khi đổi giá trị.
ALTER TABLE attendance_adjustment_requests DROP CONSTRAINT IF EXISTS att_adj_status_check;

-- STEP 2: UPDATE rows cũ lowercase → TitleCase. Idempotent (chỉ khớp 4 giá trị lowercase; chạy lại = no-op).
--         Migrator = owner role → bypass RLS (áp cho MỌI công ty). initcap không dùng để tránh lệ thuộc locale.
UPDATE attendance_adjustment_requests
   SET status = CASE status
                  WHEN 'pending'   THEN 'Pending'
                  WHEN 'approved'  THEN 'Approved'
                  WHEN 'rejected'  THEN 'Rejected'
                  WHEN 'cancelled' THEN 'Cancelled'
                  WHEN 'draft'     THEN 'Draft'
                  ELSE status
                END
 WHERE status IN ('pending','approved','rejected','cancelled','draft');

-- STEP 3: SET DEFAULT 'Pending' (cũ = 'pending'). Writer converge sẽ set tường minh; default = phòng hờ.
ALTER TABLE attendance_adjustment_requests ALTER COLUMN status SET DEFAULT 'Pending';

-- STEP 4: ADD CHECK MỚI canonical (DB-04 §7.6) — DROP-then-ADD idempotent. Mọi row đã TitleCase ở STEP 2.
ALTER TABLE attendance_adjustment_requests DROP CONSTRAINT IF EXISTS chk_att_adj_requests_status;
ALTER TABLE attendance_adjustment_requests ADD CONSTRAINT chk_att_adj_requests_status
  CHECK (status IN ('Draft','Pending','Approved','Rejected','Cancelled'));

-- ─────────────── (b) UNIQUE chống trùng request pending §7.6.1 ───────────────
-- Guard cũ (user_id, work_date, status='pending') = chết sau reconcile + quá chặt (mọi type/ngày). Thay bằng
-- guard theo request_type: 1 pending / (company, employee, work_date, request_type). employee_id NULL (row
-- legacy chưa link) = distinct trong unique partial ⇒ KHÔNG chặn (chấp nhận — Option A; writer mới luôn set
-- employee_id resolve từ actor). DROP guard cũ TRƯỚC (tránh chặn nhầm khi writer mới ghi nhiều type/ngày).
DROP INDEX IF EXISTS att_adj_requests_pending_uq;
CREATE UNIQUE INDEX IF NOT EXISTS uq_att_adj_pending_employee_date_type
  ON attendance_adjustment_requests (company_id, employee_id, work_date, request_type)
  WHERE deleted_at IS NULL AND status = 'Pending';

-- ─────────────── RLS/FORCE/grant — XÁC NHẬN GIỮ NGUYÊN (KHÔNG đụng ở migration này) ───────────────
-- attendance_adjustment_requests: ENABLE+FORCE RLS + POLICY tenant_isolation (mig 0061) — không DROP/tạo lại.
-- attendance_adjustment_items: GRANT SELECT,INSERT app (append-only, mig 0452) — không đổi.
-- audit_logs CHECK object_type: không đổi (approve/reject/adjust ghi type đã có).

-- -------- Down (manual — chỉ tham khảo, KHÔNG tự chạy) --------
-- ALTER TABLE attendance_adjustment_requests DROP CONSTRAINT IF EXISTS chk_att_adj_requests_status;
-- ALTER TABLE attendance_adjustment_requests ALTER COLUMN status SET DEFAULT 'pending';
-- UPDATE attendance_adjustment_requests SET status = lower(status) WHERE status IN ('Draft','Pending','Approved','Rejected','Cancelled');
-- ALTER TABLE attendance_adjustment_requests ADD CONSTRAINT att_adj_status_check CHECK (status IN ('pending','approved','rejected','cancelled'));
-- DROP INDEX IF EXISTS uq_att_adj_pending_employee_date_type;
-- CREATE UNIQUE INDEX att_adj_requests_pending_uq ON attendance_adjustment_requests(company_id, user_id, work_date) WHERE status = 'pending' AND deleted_at IS NULL;
