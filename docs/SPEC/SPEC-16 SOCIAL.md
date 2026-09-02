# SPEC-16: SOCIAL — MẠNG XÃ HỘI NỘI BỘ (BẢNG TIN · TIN TỨC · NHÓM · BÌNH CHỌN · SÁNG KIẾN · VINH DANH)

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-12 RECRUIT](<SPEC-12 RECRUIT.md>) · [SPEC-15 CHAT](<SPEC-15 CHAT.md>) · **SPEC-16 SOCIAL**
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [Kế hoạch wave S16-SOCIAL](<../plans/S16-SOCIAL-WAVE.md>) · [DECISIONS-08 App vệ tinh fbpost](<../DECISIONS/DECISIONS-08_Social_Satellite_App.md>) · DB-17 · API-19 · Ma trận phân quyền §9h _(ba mục sau viết ở `S16-SOCIAL-DOC-1`)_
>
> **Đánh số:** SOCIAL giữ đúng số SPEC-16 đã khoá tại [SPEC-01 §7](<SPEC-01 Tổng quan.md>). Mã module `SOCIAL` trước đây bị app vệ tinh đăng bài Facebook (wave S9, DECISIONS-08) dùng — xem SOC-DEC-002 §22.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | SPEC-16 |
| Tên tài liệu | SOCIAL - Mạng xã hội nội bộ |
| Module code | SOCIAL |
| Tài liệu cha | SPEC-01: Tổng quan hệ thống (§12.13) |
| Module phụ thuộc trực tiếp | AUTH (RBAC · token WS), HR (employees · org_units · `date_of_birth` chỉ ngày+tháng), FOUNDATION (files · audit · user_preferences · recycle-bin · system-jobs), NOTI (outbox) |
| Module liên quan | ME (Bài viết của tôi · Đã lưu), DASH (widget), CHAT (bộ emoji dùng chung), RECRUIT (giới thiệu ứng viên — PARK-SOCIAL-002), fbpost (tiện ích con «Đăng bài Facebook») |
| Phiên bản | v1.0 |
| Trạng thái | **KHUNG — owner đã chốt 10 quyết định §22 ngày 02/09/2026**; các § nghiệp vụ còn lại (§2–§21) viết ở WO `S16-SOCIAL-DOC-1` trong CÙNG file này, sau đó flip **Approved** |
| Giai đoạn | **Phase 4 kéo lên · wave S16-SOCIAL** |
| Ngày tạo | 02/09/2026 |
| Ngày cập nhật | 02/09/2026 |

> ⚠️ **Khung, không phải spec đầy đủ.** File này được tạo lúc seed wave để giữ chỗ số hiệu và ghi nhận quyết định
> owner. Phạm vi v1 (SC-01..14), bản đồ khoảng cách, story, rủi ro nằm ở [kế hoạch wave](<../plans/S16-SOCIAL-WAVE.md>)
> cho tới khi DOC-1 chép vào đây theo khuôn SPEC-15.

---

## 22. Quyết định nghiệp vụ — **ĐÃ CHỐT 02/09/2026**

| Mã | Quyết định | Kết quả owner chốt | Trạng thái |
| --- | --- | --- | --- |
| SOC-DEC-001 | Đánh số & phạm vi tài liệu: wave `S16-SOCIAL` · SPEC-16 · DB-17 · API-19 · permission-matrix §9h · EPIC-21 §8.22 · Sprint 16 · `SOC-SCREEN-001+` · `SOCIAL-API-001+` · `SOCIAL-ERR-001+` · `SOCIAL-WIDGET-001+` · SPEC-01 §17.18 (bài) · §17.19 (sáng kiến) · §17.20 (bình chọn); story IMP02 và NOTI-EVENT **đo dải lúc chạy** (S15 giữ 191+ / 024+); migration nối tiếp head lúc merge — lane migration S15/S16 KHÔNG chạy song song | theo đề xuất | ✅ chốt |
| SOC-DEC-002 | **Mã `SOCIAL` = mạng xã hội nội bộ** (đúng SPEC-01 §7 + hàng `modules` 0435). App vệ tinh fbpost (DECISIONS-08) trở thành **tiện ích con «Đăng bài Facebook»** trong sidebar SOCIAL: giữ nguyên 3 cặp `social-post`/`social-account`, dịch vụ 3500, SSO; chỉ chuyển tile. **Resource mới tiền tố `feed-`** (`feed` · `feed-post` · `feed-comment` · `feed-news` · `feed-group` · `feed-poll` · `feed-idea` · `feed-kudos` · `feed-report`) — không đụng verify 0544, không migration đổi tên quyền trên PROD | theo đề xuất | ✅ chốt |
| SOC-DEC-003 | 5 loại bài v1: `share` · `news` (ghim · «yêu cầu xác nhận đã đọc» tuỳ chọn) · `idea` · `poll` · `kudos`. Phạm vi `audience`: `company` · `group` · `org_unit`. Hashtag `#tag` → bảng tag + lọc. **Không có bài hệ thống tự sinh** — sinh nhật là widget + nút «Gửi lời chúc» tạo bài `share` gắn thẻ | theo đề xuất | ✅ chốt |
| SOC-DEC-004 | **Employee được cấp mặc định**: `view:feed` (Company) · `create:feed-post` · `create:feed-comment` · `create:feed-poll` · `create:feed-idea` · `create:feed-kudos` · `create:feed-group`. Tương tác cá nhân (thích · bình chọn · lưu · đã xem · xác nhận đọc) **đi theo `view:feed` + quyền sở hữu hàng** (`user_id = actor`) — không verb mới ngoài DECISIONS-06. `manage:feed-news` · `manage:feed-post` · `manage:feed-group` · `approve:feed-idea` · `manage:feed-kudos` · `manage:feed-report` · `view:feed-report` cho company-admin + hr (manager: `view:feed-report` Department). Không cặp `is_sensitive`; mọi `manage/approve` ghi audit. _(Khác SOCIAL-DEC-006 của fbpost — cố ý: hai bề mặt khác nhau.)_ | theo đề xuất | ✅ chốt |
| SOC-DEC-005 | Chủ bài tự sửa/xoá (nhãn «đã chỉnh sửa», `edited_at`). `manage:feed-post`: ẩn/hiện · ghim/bỏ ghim · khoá bình luận · xoá bài người khác — mỗi hành động 1 dòng audit (object_type mới `feed_post` · `feed_comment` · `feed_group` · `feed_report`). Người dùng báo cáo bài/bình luận (`feed_reports`: `open → resolved/dismissed`). Xoá = **soft-delete** + thùng rác (BẤT BIẾN 2); ẩn ≠ xoá. Trạng thái bài §17.18: `published ⇄ hidden` · `→ deleted` | theo đề xuất | ✅ chốt |
| SOC-DEC-006 | Nhóm `public` (ai cũng xem/tham gia) · `private` (xin vào, admin nhóm duyệt; bài chỉ thành viên thấy). **Vai trò trong nhóm là hàng** `feed_group_members.role ∈ {owner, admin, member}` (khuôn DECISIONS-04), không phải cặp quyền. Quyền xem bài nhóm riêng tư **ép ở service (lọc trong SQL) + ca IDOR** — RLS chỉ biết tenant. `manage:feed-group` cho company-admin can thiệp nhóm bất kỳ | theo đề xuất | ✅ chốt |
| SOC-DEC-007 | Sinh nhật: route SOCIAL riêng trả **chỉ ngày + tháng** (`{employeeId, fullName, avatar, day, month}`) từ `employees.date_of_birth` — không năm, không tuổi — gate `view:feed`, **không cấp cặp HR**. Nhân viên ẩn sinh nhật qua `user_preferences.feed.showBirthday=false` (mặc định hiện). Widget «Hôm nay / Tuần này / Tháng này» | theo đề xuất | ✅ chốt |
| SOC-DEC-008 | Đính kèm tái dùng file-service: `file_links.object_type` UNION-ADD `feed_post` · `feed_comment`; ≤10 ảnh/bài · ≤1 video · ≤20MB/tệp (mirror hằng CHAT). **Bộ emoji = bộ CHAT**, một bảng `feed_reactions` cho bài và bình luận (UNIQUE user/target). **Bảng `feed_mentions` thật** (không lặp nợ `task_comment_mentions`). Lượt xem = `feed_post_views` UNIQUE(post,user) ghi lần đầu — «N người xem» là COUNT thật | theo đề xuất | ✅ chốt |
| SOC-DEC-009 | Sáng kiến §17.19: `submitted → under_review → accepted / rejected` (`approve:feed-idea`, `reviewed_by/at/note`, NOTI tác giả), vết ở audit. Bình chọn §17.20: `open → closed`; 2–10 lựa chọn · 1/nhiều phiếu · ẩn danh tuỳ chọn (vẫn lưu `user_id` chống phiếu đôi, DTO không lộ kể cả admin) · hạn đóng bằng job `system-jobs`; đổi phiếu khi còn mở | theo đề xuất | ✅ chốt |
| SOC-DEC-010 | Tìm kiếm PG `tsvector` cột sinh (`simple` + `unaccent` nếu extension có — đo ở DB-1, không thì ILIKE; KHÔNG `CREATE EXTENSION` mù), phạm vi tenant. Realtime v1 tối giản: `feed:post.created` · `feed:comment.created` · `feed:reaction.changed` vào room `co:{companyId}:feed` + `co:{companyId}:feedgroup:{groupId}`, payload = DTO đã mask; FE chỉ badge «N bài mới». Thống kê theo tuần & đơn vị: sàn scope Company (manager Department), KHÔNG cache, XLSX | theo đề xuất | ✅ chốt |

**Ngoài phạm vi v1 (PARK-SOCIAL-001 cập nhật ở DOC-1):** đăng lại có trích dẫn · khảo sát nhiều câu (form builder) · story/video ngắn · push mobile · dịch tự động · sự kiện + RSVP · đăng chéo ra Facebook qua fbpost. **PARK-SOCIAL-002:** giới thiệu ứng viên — cần đường Own «gửi giới thiệu» vào RECRUIT (nguồn REFERRAL), là việc của RECRUIT.
