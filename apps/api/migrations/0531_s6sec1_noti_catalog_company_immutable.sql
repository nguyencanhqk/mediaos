-- S6-SEC-1 (re-gate) — CHẶN "RE-HOME" DANH MỤC NOTI TOÀN CỤC VÀO MỘT TENANT
--
-- LỖ HỔNG. `notification_events` (59 hàng toàn cục ở PROD) và `notification_templates` (45) là danh mục
-- **dùng chung mọi tenant** (`company_id IS NULL`). Chúng mang ĐÚNG hình dạng policy mà mig `0436` sinh
-- ra để bảo vệ — `USING (company_id = GUC OR company_id IS NULL)` + `WITH CHECK (company_id = GUC)` —
-- nhưng ra đời sau (`0479`) và được cấp `INSERT, UPDATE` cho `mediaos_app` muộn hơn nữa (`0487`), **mà
-- không ai gắn trigger `enforce_company_id_immutable`**.
--
-- Hệ quả: từ ngữ cảnh một tenant,
--     UPDATE notification_events SET company_id = '<tenant-cua-toi>' WHERE company_id IS NULL;
-- **thành công và commit được** — nuốt trọn danh mục toàn cục về một tenant. Mọi tenant khác lập tức
-- mất sạch catalog ⇒ theo `CHECK` hợp thành của NOTI, hệ thống KHÔNG tạo được thông báo nào nữa.
-- Và **không hoàn tác được qua ứng dụng**: `WITH CHECK` chặn đúng chiều ghi ngược lại.
--
-- Đây là **cùng một họ lỗi với S0-B** (`0530`): một khe hở `IS NULL` mở cho ĐỌC bị dùng để GHI.
-- Chú thích ở `0487:12-15` khẳng định `WITH CHECK` là "BACKSTOP CỨNG" — đúng cho việc TẠO hàng global,
-- vô dụng trước việc CƯỚP một hàng global, vì `SET company_id = <mine>` thoả `WITH CHECK`.
--
-- Hiện KHÔNG route nào của app đi đường này (cả hai repository đều dùng vị từ kép `id + company_id`),
-- nên ranh giới duy nhất đang là **kỷ luật của lập trình viên trong mệnh đề WHERE** — thứ mà CLAUDE §2
-- bất biến #1 cấm dùng làm cơ chế ép buộc. Vá ở tầng DB, đúng chỗ `0436` đã đặt ra chuẩn.
--
-- Additive, không đụng dữ liệu, idempotent. Tái dùng đúng hàm sẵn có của `0436` (ERRCODE
-- `check_violation`), KHÔNG phát minh cơ chế mới.

DROP TRIGGER IF EXISTS trg_notification_events_company_immutable ON notification_events;
--> statement-breakpoint

CREATE TRIGGER trg_notification_events_company_immutable
  BEFORE UPDATE ON notification_events
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_notification_templates_company_immutable ON notification_templates;
--> statement-breakpoint

CREATE TRIGGER trg_notification_templates_company_immutable
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION enforce_company_id_immutable();
