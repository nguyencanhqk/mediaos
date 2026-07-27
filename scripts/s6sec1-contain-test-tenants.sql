-- S6-SEC-1 · S0-A — CHẶN ĐƯỜNG VÀO CỦA TÀI KHOẢN TENANT TEST CÒN SÓT TRONG PROD
--
-- VÌ SAO. FULL gate phát hiện trong DB PROD `mediaos` còn **16 tenant TEST** (17 công ty, chỉ
-- `funtime` là thật) với **25 user**. Trong đó **3 tài khoản giữ role `platform-admin`
-- (`…0000f0`, audience OPERATOR)** — role có đường ĐỌC CHÉO TENANT theo thiết kế
-- (`GET /foundation/audit-logs/all` → `withPlatformReadContext`; PROD `audit_logs` đang giữ 9.124 dòng
-- của `funtime`). Mật khẩu của chúng là chuỗi test `Passw0rd!test99` — có trong 86 file của repo
-- **PUBLIC**. Đã xác minh trực tiếp: `argon2.verify(<hash PROD>, "Passw0rd!test99")` → **true**.
--
-- Ngoài ra 9 user thuộc 5 tenant test có `assign:permission` ⇒ trước khi migration 0530 được áp cho
-- PROD, chúng còn xoá được grant của role hệ thống TOÀN CỤC mà `funtime` đang dùng (S0-B).
--
-- SCRIPT NÀY LÀM GÌ (chỉ CHẶN ĐƯỜNG VÀO — KHÔNG xoá dữ liệu):
--   1. Thu hồi mọi grant role operator (`…0000f0`) nằm ngoài `funtime`.
--   2. Vô hiệu hoá toàn bộ user của tenant test: `suspended` + soft-delete + băm mật khẩu không dùng được.
--   3. Xoá mọi refresh token còn sống của chúng (cắt phiên đang mở).
--
-- CỐ Ý KHÔNG hard-delete company/user: 11 FK tới `companies` là NO ACTION (gồm `audit_logs` append-only)
-- nên purge là một thao tác riêng, rủi ro cascade cao hơn hẳn — tách ra `S6-PERF-DB-1` (WS6 DB
-- readiness). Chặn đường vào đã đóng hết bề mặt bảo mật; purge chỉ còn là vệ sinh dữ liệu.
--
-- AN TOÀN:
--   • Chỉ chạm công ty khớp `slug ~ '-[0-9a-f]{8}$'` (hậu tố hex của seed test). `funtime` KHÔNG khớp.
--   • Chạy trong MỘT transaction; in số đo trước/sau; tự ROLLBACK nếu `funtime` lọt vào tập.
--   • Đảo ngược được: khôi phục từ bản dump đã tạo trước khi chạy.
--
-- CÁCH CHẠY (backup TRƯỚC):
--   docker exec mediaos-postgres pg_dump -U mediaos -Fc mediaos > /c/tmp/mediaos-pre-contain.dump
--   docker exec -i mediaos-postgres psql -U mediaos -d mediaos -v ON_ERROR_STOP=1 \
--     < scripts/s6sec1-contain-test-tenants.sql

\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _test_co ON COMMIT DROP AS
  SELECT id, slug FROM companies WHERE slug ~ '-[0-9a-f]{8}$';

-- Chốt an toàn: nếu công ty thật lọt vào tập thì DỪNG, không sửa gì.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM _test_co WHERE slug = 'funtime';
  IF n > 0 THEN
    RAISE EXCEPTION 'DỪNG: funtime lọt vào tập tenant test — kiểm lại mẫu slug trước khi chạy';
  END IF;
END $$;

\echo '--- TRƯỚC ---'
SELECT (SELECT count(*) FROM _test_co)                                             AS tenant_test,
       (SELECT count(*) FROM users u WHERE u.company_id IN (SELECT id FROM _test_co)
          AND u.deleted_at IS NULL)                                                AS user_con_song,
       (SELECT count(*) FROM user_roles ur
          WHERE ur.role_id = '00000000-0000-0000-0000-0000000000f0'
            AND ur.deleted_at IS NULL
            AND ur.company_id IN (SELECT id FROM _test_co))                        AS grant_operator;

-- 1) Thu hồi grant role operator (đường đọc chéo tenant).
UPDATE user_roles ur
   SET deleted_at = now()
 WHERE ur.role_id = '00000000-0000-0000-0000-0000000000f0'
   AND ur.deleted_at IS NULL
   AND ur.company_id IN (SELECT id FROM _test_co);

-- 2) Vô hiệu hoá tài khoản: không đăng nhập được nữa dù biết mật khẩu.
--    `status` dùng allow-list ('active' mới vào được — auth.service.ts:67-72) nên 'suspended' là đủ;
--    băm mật khẩu + soft-delete là hai lớp dự phòng.
UPDATE users
   SET status               = 'suspended',
       deleted_at           = COALESCE(deleted_at, now()),
       password_hash        = '!disabled-by-S6-SEC-1',
       must_change_password = true
 WHERE company_id IN (SELECT id FROM _test_co)
   AND deleted_at IS NULL;

-- 3) Cắt mọi phiên đang mở.
DELETE FROM refresh_tokens WHERE company_id IN (SELECT id FROM _test_co);

\echo '--- SAU ---'
SELECT (SELECT count(*) FROM users u
          WHERE u.company_id IN (SELECT id FROM _test_co) AND u.status = 'active')  AS user_con_active,
       (SELECT count(*) FROM user_roles ur
          WHERE ur.role_id = '00000000-0000-0000-0000-0000000000f0'
            AND ur.deleted_at IS NULL
            AND ur.company_id IN (SELECT id FROM _test_co))                         AS grant_operator_con_lai,
       (SELECT count(*) FROM users u JOIN companies c ON c.id = u.company_id
          WHERE c.slug = 'funtime' AND u.status = 'active')                         AS funtime_active_phai_giu_nguyen;

COMMIT;
