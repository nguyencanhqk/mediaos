-- Migration 0360: CS-5 — Thông tin công ty hồ sơ đầy đủ (console settings).
-- Gate: LIGHT (CRUD settings — không chạm permission/RLS/secret/payroll).
--
-- BAND 0360-0369 (lane cs5). Journal: idx 106, when 1717500410000 (> high-water 1717500400000 = 0347_ac9_export_worker).
--
-- MỤC TIÊU: mở rộng bảng `companies` với hồ sơ đầy đủ MISA-style:
--   Thông tin chi tiết · Đăng ký kinh doanh · Liên hệ · Mô hình.
--   TẤT CẢ nullable (additive) — KHÔNG đổi RLS / FORCE RLS / grant sẵn có.
--
-- CỘT THÊM:
--   short_name         text  — tên viết tắt (Thông tin chi tiết)
--   tax_code           text  — mã số thuế / MST (Thông tin chi tiết)
--   business_type      text  — loại hình doanh nghiệp (Mô hình)
--   company_code       text  — mã công ty read-only sinh sẵn/seeded (Thông tin chi tiết)
--   reg_number         text  — số ĐKKD (Đăng ký kinh doanh)
--   reg_date           date  — ngày cấp ĐKKD (Đăng ký kinh doanh)
--   reg_place          text  — nơi cấp ĐKKD (Đăng ký kinh doanh)
--   legal_rep_name     text  — tên người đại diện pháp luật (Đăng ký kinh doanh)
--   legal_rep_title    text  — chức danh người đại diện (Đăng ký kinh doanh)
--   established_date   date  — ngày thành lập (Thông tin chi tiết)
--   address            text  — địa chỉ trụ sở (Liên hệ)
--   phone              text  — số điện thoại (Liên hệ)
--   fax                text  — số fax (Liên hệ)
--   email              text  — email công ty (Liên hệ)
--   website            text  — website (Liên hệ)
--
-- KHÔNG thêm RLS policy mới; companies đã có FORCE RLS + policies từ 0002.
-- GRANT: mediaos_app đã có UPDATE trên companies từ 0001/0015 — không cần grant thêm.

ALTER TABLE companies
  ADD COLUMN short_name       text,
  ADD COLUMN tax_code         text,
  ADD COLUMN business_type    text,
  ADD COLUMN company_code     text,
  ADD COLUMN reg_number       text,
  ADD COLUMN reg_date         date,
  ADD COLUMN reg_place        text,
  ADD COLUMN legal_rep_name   text,
  ADD COLUMN legal_rep_title  text,
  ADD COLUMN established_date date,
  ADD COLUMN address          text,
  ADD COLUMN phone            text,
  ADD COLUMN fax              text,
  ADD COLUMN email            text,
  ADD COLUMN website          text;

-- -------- Down (manual) --------
-- ALTER TABLE companies
--   DROP COLUMN website, DROP COLUMN email, DROP COLUMN fax, DROP COLUMN phone,
--   DROP COLUMN address, DROP COLUMN established_date, DROP COLUMN legal_rep_title,
--   DROP COLUMN legal_rep_name, DROP COLUMN reg_place, DROP COLUMN reg_date,
--   DROP COLUMN reg_number, DROP COLUMN company_code, DROP COLUMN business_type,
--   DROP COLUMN tax_code, DROP COLUMN short_name;
