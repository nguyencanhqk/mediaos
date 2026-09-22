-- Migration 0585: S16-SOCIAL-BE-1B (🔴 RED, zone=red, crown) — sửa template NOTI
--   `SOCIAL_NEWS_PUBLISHED` (seed ở 0581): bỏ biến `{post_title}`. THUẦN UPDATE văn bản, KHÔNG DDL,
--   KHÔNG thêm/xoá hàng catalog.
--
-- VÌ SAO (quyết định A4/D12, owner ký 22/09/2026):
--   1. **Biến KHÔNG tồn tại.** Bài SOCIAL **không có tiêu đề** — nội dung là `feed_posts.body`
--      (SPEC-16, note backlog BE-1: «Tiêu đề bài không có — nội dung là body»). Template 0581 ghi
--      `title_template = 'Tin tức mới: {post_title}'` + `variables_schema` đòi `post_title` ⇒ producer
--      không có gì hợp lệ để điền, và `assertInternalTargetUrl`/render sẽ ném hoặc trả tiêu đề còn
--      nguyên placeholder `{post_title}`.
--   2. **Ranh giới dữ liệu.** Cách duy nhất để điền biến đó là cắt một trích đoạn `body` — tức đẩy
--      NỘI DUNG BÀI vào `notifications.payload`, một bảng có bề mặt đọc khác (và rộng hơn) bề mặt đọc
--      của chính bài viết. Bài `audience='org_unit'`/`hidden` sẽ rò trích đoạn qua đường thông báo.
--   `SOCIAL_POST_REPORTED` (0581:268-273) GIỮ NGUYÊN: `{target_type_label}`/`{reason_label}` là nhãn
--   phân loại từ một tập ĐÓNG (enum→nhãn trong code), không chở nội dung bài.
--
-- ⚠️ UPDATE, KHÔNG INSERT — số HÀNG catalog không đổi. Đừng vì thế giả định 3 ratchet canonical-seed
--   (`noti-seed-catalog-permissions` · `s5-noti-fix1-deeplink` · census template) không đổi: nếu một
--   trong chúng đối chiếu NỘI DUNG template chứ không chỉ đếm hàng, nó sẽ đỏ và phải cập nhật CÓ CHỦ
--   ĐÍCH, không nới ẩu (plan §7.2 + §8 Bước 5).
--
-- BẤT BIẾN (CLAUDE.md §2): #2 — `notification_templates` KHÔNG phải bảng append-only (app role có
--   UPDATE; append-only là `notification_delivery_logs`). #1 — hàng canonical `company_id IS NULL`
--   (catalog hệ thống), vị từ ghim tường minh cả ở UPDATE lẫn ở verify.

UPDATE notification_templates
   SET title_template    = 'Có tin tức công ty mới',
       body_template     = '{actor_name} đã đăng một tin tức công ty. Mở để đọc.',
       variables_schema  = '{"actor_name":"string","post_id":"uuid"}'::jsonb,
       updated_at        = now()
 WHERE template_code = 'SOCIAL_NEWS_PUBLISHED__IN_APP__vi-VN'
   AND company_id IS NULL AND deleted_at IS NULL;
--> statement-breakpoint

DO $$
DECLARE v_cnt int;
BEGIN
  -- Vi tu PHAI SOI GUONG vi tu cua UPDATE (company_id IS NULL AND deleted_at IS NULL): thieu chung,
  -- mot ban sao company-scope / da soft-delete (khong chua post_title) se duoc dem va verify PASS
  -- trong khi hang LIVE VAN con {post_title} => fail-OPEN.
  -- Va phai kiem CA title_template/body_template, khong chi variables_schema: thu render ra tieu de
  -- la TEMPLATE, khong phai schema.
  SELECT count(*) INTO v_cnt FROM notification_templates
   WHERE template_code = 'SOCIAL_NEWS_PUBLISHED__IN_APP__vi-VN'
     AND company_id IS NULL AND deleted_at IS NULL
     AND variables_schema::text NOT LIKE '%post_title%'
     AND title_template NOT LIKE '%{post_title}%'
     AND body_template  NOT LIKE '%{post_title}%'
     -- `short_body_template` la NULLABLE (schema/noti.ts): `NULL NOT LIKE ...` ra NULL => hang bi
     -- loai => v_cnt=0 => RAISE. Fail-closed nen khong nguy hiem, nhung `coalesce` lam no do doc
     -- dung y dinh: "cot nay khong duoc chua {post_title}", khong phai "cot nay phai khac NULL".
     AND coalesce(short_body_template, '') NOT LIKE '%{post_title}%';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION '[0585] UPDATE template SOCIAL_NEWS_PUBLISHED khong nhu ky vong (matched=%) — fail-closed', v_cnt;
  END IF;
END $$;
