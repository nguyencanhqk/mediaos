-- Migration 0489: HR-PROFILE-UI-1b (🔴 RED, zone=red, FULL gate) — MỞ RỘNG HỒ SƠ NHÂN SỰ theo thiết kế
--   HYBRID (owner chốt 2026-07-11): 4 cột typed + 1 cột JSONB. THUẦN DDL ADDITIVE — KHÔNG backfill,
--   KHÔNG đổi RLS (policy tenant_isolation của employee_profiles đã FORCE từ mig 0018, áp mọi cột),
--   KHÔNG db:generate.
--
-- BAND 0489 (phiên interactive 2026-07-11). Journal: idx 169, when 1717500840000
--   (> head 0488 idx 168 / 1717500835000). Nối tiếp ĐƠN ĐIỆU.
--
-- ══════════════════════ THIẾT KẾ HYBRID (owner 2026-07-11) ══════════════════════
--   CỘT RIÊNG = field cần sort/lọc/index HOẶC nhạy cảm cấp riêng (DB-03 §7.2 đã thiết kế sẵn):
--     tax_code            VARCHAR(100)  — MST cá nhân, NHẠY CẢM (DB-03 masking: High → VIEW_SENSITIVE)
--     official_date       DATE          — Ngày chính thức (directory-class, cột bảng + sort tương lai)
--     probation_end_date  DATE          — Ngày kết thúc thử việc (directory-class)
--     work_location       VARCHAR(255)  — Nơi làm việc (directory-class, filter tương lai)
--   JSONB personal_extra = nhóm nhân khẩu HIỂN THỊ-THUẦN, hiếm truy vấn, mở rộng dần KHÔNG cần
--   migration (bổ sung DB-03 §7.2 cùng commit — owner 2026-07-11):
--     { placeOfBirth?, nativePlace?, ethnicity?, religion?, nationality? } — key allowlist khóa bằng
--     Zod .strict() ở packages/contracts (hrPersonalExtraSchema). QUY ƯỚC MỘT CHIỀU: mọi key trong
--     blob đều thuộc lớp PII; key nào về sau cần lọc/tìm kiếm → THĂNG CẤP thành cột qua migration.
--
-- ══════════════════════ MASKING (BẤT BIẾN #3) ══════════════════════
--   tax_code + TOÀN BỘ personal_extra mask SERVER-side theo cặp sensitive `view-sensitive:employee`
--   (CÙNG lớp phone/date_of_birth mig 0451) — blob gate NGUYÊN KHỐI, thiếu quyền → null (fail-closed).
--   Đường ghi: PATCH /hr/employees/:id chỉ nhận field PII khi caller có view-sensitive per-row
--   (fail-closed) và audit_logs CHỈ ghi TÊN field — giá trị bị mask (append-only, rò là vĩnh viễn).
--   identity_* + bank_* TIẾP TỤC ngoài mọi read/write surface (WO HR-IDENTITY-READ-1).
--
--   Idempotent: ADD COLUMN IF NOT EXISTS. KHÔNG CHECK cho text tự do; ngày dùng kiểu DATE.

ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS tax_code varchar(100);
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS official_date date;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS probation_end_date date;
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS work_location varchar(255);
ALTER TABLE employee_profiles ADD COLUMN IF NOT EXISTS personal_extra jsonb;
