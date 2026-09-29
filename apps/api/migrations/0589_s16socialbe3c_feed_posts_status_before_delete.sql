-- Migration 0589: S16-SOCIAL-BE-3C (🔴 RED, crown) — `feed_posts.status_before_delete` + chỉ mục thùng rác.
--   DDL THUẦN, KHÔNG backfill, KHÔNG đụng RLS/FORCE/grant. Plan `docs/plans/S16-SOCIAL-BE-3C.md` §1 O2 · D2.
--
-- VÌ SAO CỘT NÀY TỒN TẠI (owner ký O2, 28/09/2026):
--   `softDeletePostTx` ghi `status='deleted'` và QUÊN status cũ. Hàm khôi phục cũ (`restorePostTx`) vì vậy
--   ghi CỨNG `published` ⇒ lỗ «moderator ẩn → tác giả xoá → HR khôi phục → bài hiện lại cho cả công ty»:
--   một thao tác KHÔI PHỤC dữ liệu biến thành một thao tác BỎ KIỂM DUYỆT mà không ai chủ ý làm.
--   Cột nhớ status ngay trước khi xoá; luật dùng nó nằm ở `restoreStatusSql()` (`social-counters.ts`, D4):
--   chỉ bài do NGƯỜI KHÁC tác giả xoá mới quay về status đã nhớ — mọi ca còn lại (tác giả tự xoá · người
--   xoá bị FK SET NULL · hàng legacy NULL) về `hidden` (fail-closed, O4).
--
-- ⚠️ KHÔNG CHECK CẶP `(deleted_at IS NULL) = (status_before_delete IS NULL)` — CÓ CHỦ ĐÍCH (D2):
--   ba fixture int-spec xoá mềm bằng SQL tay (be2b1 · be3a · be3b) và MỌI hàng đã xoá trước migration này
--   đều mang `deleted_at` NOT NULL + cột NULL ⇒ CHECK cặp ĐỎ ngay lúc `ADD CONSTRAINT` (quét xác thực) trên
--   PROD. NULL trên hàng chết đã có NGHĨA ở D4 (legacy ⇒ `hidden`), không phải một trạng thái hỏng.
--   Chiều ngược thì CHẶN được và phải chặn: hàng SỐNG mang giá trị là dấu vết của một lượt khôi phục
--   quên dọn cột ⇒ `chk_feed_posts_status_before_delete_dead`.
--
-- ⚠️ CHỈ MỤC khớp ĐÚNG `ORDER BY feed_posts.deleted_at DESC, feed_posts.id DESC` của `SOCIAL-API-057` —
--   partial `WHERE deleted_at IS NOT NULL` nên chỉ phủ phần thùng rác (nhỏ), không đè lên đường feed nóng.
--
-- 🔴 `lock_timeout` (khuôn `0587:35-48`): `ADD CONSTRAINT … CHECK` lấy ACCESS EXCLUSIVE + quét xác thực,
--   `CREATE INDEX` lấy SHARE trên `feed_posts`. Một transaction dài đang mở trên bảng tin mà không có trần
--   chờ ⇒ migrate treo VÔ HẠN, và vì khoá xếp hàng, MỌI lượt ghi bảng tin đến sau kẹt theo suốt lượt
--   deploy. Thà đỏ + chạy lại. PHẢI trả `DEFAULT` ở cuối: drizzle bọc MỌI migration pending trong MỘT
--   transaction ⇒ `SET LOCAL` không trả sẽ rò sang 0590 và mọi migration sau trong cùng band.
--
-- `ADD COLUMN … varchar(16)` NULL, KHÔNG DEFAULT ⇒ chỉ đổi catalog (không viết lại bảng).
-- GRANT `feed_posts` cấp ở mức BẢNG (`0577`) ⇒ cột mới tự thừa hưởng, không cần GRANT cột.
--
-- Rollback (tay, trong MỘT tx): SET LOCAL lock_timeout = '5s';
--   DROP INDEX idx_feed_posts_company_deleted;
--   ALTER TABLE feed_posts DROP CONSTRAINT chk_feed_posts_status_before_delete_dead;
--   ALTER TABLE feed_posts DROP CONSTRAINT chk_feed_posts_status_before_delete;
--   ALTER TABLE feed_posts DROP COLUMN status_before_delete;   -- viết thành migration ⇒ cần cờ DESTRUCTIVE-APPROVED
--   SET LOCAL lock_timeout = DEFAULT;
--
-- BAND 0589 (lane S16-SOCIAL-BE-3C). Journal: idx 256, when 1717587378000 (> 0588 idx 255 / 1717587377000).
-- ════════════════════════════════════════════════════════════════════════════════════════════════
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE feed_posts ADD COLUMN status_before_delete varchar(16);
--> statement-breakpoint
ALTER TABLE feed_posts
  ADD CONSTRAINT chk_feed_posts_status_before_delete
  CHECK (status_before_delete IN ('published', 'hidden'));
--> statement-breakpoint
ALTER TABLE feed_posts
  ADD CONSTRAINT chk_feed_posts_status_before_delete_dead
  CHECK (status_before_delete IS NULL OR deleted_at IS NOT NULL);
--> statement-breakpoint
CREATE INDEX idx_feed_posts_company_deleted
  ON feed_posts (company_id, deleted_at DESC, id DESC)
  WHERE deleted_at IS NOT NULL;
--> statement-breakpoint
SET LOCAL lock_timeout = DEFAULT;
