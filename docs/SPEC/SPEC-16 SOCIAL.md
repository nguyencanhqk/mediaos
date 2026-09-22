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
| Trạng thái | **Approved** — owner chốt 10 quyết định §22 ngày 02/09/2026; §2–§21 + §23–§25 viết ở WO `S16-SOCIAL-DOC-1` ngày 18/09/2026 |
| Giai đoạn | **Phase 4 kéo lên · wave S16-SOCIAL** |
| Ngày tạo | 02/09/2026 |
| Ngày cập nhật | 18/09/2026 |

> **Đọc §5.1 trước.** Cấp phát v1 đã ĐÓNG ở mức **19 bảng · 12 màn · 53 route · 14 cặp quyền · 22 mã lỗi ·
> 9 sự kiện NOTI · 2 widget**. Ba con số đầu **khác** ước lượng ghi lúc seed wave (15 bảng / 13 cặp / ~45 route) —
> lý do và bảng đối chiếu ở **§23.1**; mọi WO hạ nguồn lấy theo §5.1, không lấy theo chữ trong `harness/backlog.mjs`.
>
> Bản đồ khoảng cách so với benchmark và 14 bẫy thi công vẫn nằm ở [kế hoạch wave](<../plans/S16-SOCIAL-WAVE.md>).

---

## 2. Mục đích tài liệu

Tài liệu này đặc tả nghiệp vụ module **SOCIAL — Mạng xã hội nội bộ**: bảng tin, tin tức công ty, bình luận, cảm xúc, nhóm, bình chọn, sáng kiến, vinh danh, kiểm duyệt và thống kê tương tác.

SPEC-16 là **nguồn sự thật nghiệp vụ** cho module: màn hình, luật, mã lỗi, trạng thái, quyền, sự kiện thông báo. Schema chi tiết nằm ở **DB-17**, hợp đồng endpoint ở **API-19**, ma trận quyền hợp nhất ở **`docs/permission-matrix-spec.md` §9h**. Ba tài liệu đó **không nhân bản** rule của SPEC-16 mà trỏ về đây.

Đối tượng đọc: kỹ sư backend/frontend thi công wave `S16-SOCIAL`, QA viết ca kiểm thử, và người rà soát bảo mật/phân quyền.

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 `SOCIAL` là mạng xã hội nội bộ — fbpost là tiện ích con

Mã module `SOCIAL` **chỉ có một nghĩa**: mạng xã hội nội bộ của công ty (đúng [SPEC-01 §7](<SPEC-01 Tổng quan.md>) và hàng `modules` do migration `0435` seed).

App vệ tinh **đăng bài Facebook** (wave S9, [DECISIONS-08](<../DECISIONS/DECISIONS-08_Social_Satellite_App.md>)) là một **tiện ích con** nằm trong module này, xuất hiện như mục cuối sidebar SOCIAL với nhãn «Đăng bài Facebook». Nó **giữ nguyên** ba cặp quyền `view:social-post` · `create:social-post` · `manage:social-account`, dịch vụ cổng 3500 và đường SSO — wave S16 **không đụng** vào chúng (SOC-DEC-002).

> ⚠️ **Hệ quả bắt buộc cho mọi WO của wave:** resource của mạng xã hội nội bộ **luôn mang tiền tố `feed-`**. Migration `0544` có bước verify **đếm grant `social*` của vai `employee`** và RAISE nếu khác 0; đặt tên resource mới là `social-*` sẽ làm đỏ verify đó trên PROD.

### 3.2 Tương tác cá nhân đi theo `view:feed` + quyền sở hữu hàng

Thích · bỏ phiếu · lưu · đánh dấu đã xem · xác nhận đã đọc là **hành vi cá nhân trên dữ liệu của chính mình**. Chúng **không đẻ cặp quyền mới** (giữ đúng bộ verb của [DECISIONS-06](<../DECISIONS/>)): điều kiện là `view:feed` trên bài đó **và** hàng ghi ra phải có `user_id = actor` (SOC-DEC-004).

Hệ quả kiểm thử: không có ca «thiếu cặp `create:feed-reaction`» — ca đúng là «không thấy bài thì không thích được» và «không ghi được hàng mang `user_id` của người khác».

### 3.3 Phạm vi bài (`audience`) là bộ lọc đọc, không phải data_scope

`audience ∈ {company, group, org_unit}` quyết định **ai đọc được một bài**, và được ép **trong câu SQL của truy vấn danh sách**, không lọc ở tầng JS sau khi đã lấy về.

`data_scope` của cặp `view:feed` vẫn là `Company` cho mọi vai được cấp — hai khái niệm này độc lập: `data_scope` giới hạn *tenant/đơn vị mà cặp quyền có hiệu lực*, `audience` giới hạn *từng hàng bài*.

### 3.4 Thành viên nhóm là ranh giới đọc mà RLS không biết

RLS chỉ ép `company_id`. Việc «bài trong nhóm riêng tư chỉ thành viên thấy» **phải** ép ở service bằng phép nối membership **trong SQL** (SOC-DEC-006). Đây là điểm dễ thủng nhất của module ⇒ QA bắt buộc có ca IDOR đọc bài nhóm riêng tư khi không phải thành viên.

### 3.5 Ngày sinh lộ ở mức ngày+tháng, không bao giờ lộ năm

Widget sinh nhật đọc `employees.date_of_birth` nhưng DTO **chỉ** chở `{employeeId, fullName, avatar, day, month}` — không năm, không tuổi, không ngày đầy đủ. Đây là **cửa sau tiềm năng vào PII của HR** nên gate là `view:feed` và **không** cấp thêm cặp HR nào (SOC-DEC-007). Nhân viên tự ẩn bằng `user_preferences.feed.showBirthday = false`.

> **Phạm vi của cờ — chốt 22/09/2026 (S16-SOCIAL-BE-1B, D10).** Cờ `showBirthday` gate ĐÚNG hai trường `day`/`month` của widget `026` và mọi trường phái sinh từ `date_of_birth`. Nó **KHÔNG** ẩn danh tính nhân viên (tên/avatar) khỏi tìm kiếm `023` · thẻ `024` · trang cá nhân `025`: ba đường đó vốn **không chở** `day`/`month`, và ẩn danh tính ở đó sẽ làm bài viết của người ẩn sinh nhật biến mất khỏi tìm kiếm — một hệ quả không ai chọn. **Lưu trữ:** cột phẳng `user_preferences.show_birthday` (`boolean` NULLABLE, **không** DEFAULT — migration `0584`); `NULL` = kế thừa mặc định **hiện**. Đường ghi: `PATCH /me/preferences { "showBirthday": false }`.

### 3.6 Xoá là xoá mềm; ẩn không phải xoá

Xoá bài/bình luận = `deleted_at` + vào thùng rác (BẤT BIẾN 2 của CLAUDE.md). **Ẩn** (`status = hidden`) là hành vi kiểm duyệt khác hẳn: bài vẫn tồn tại, tác giả và người có `manage:feed-post` vẫn thấy, người khác thì không (SOC-DEC-005).

### 3.7 Không có bài do hệ thống tự sinh

Feed chỉ chứa bài do người thật đăng. Sinh nhật là **widget**, không phải bài tự sinh; nút «Gửi lời chúc» tạo một bài `share` gắn thẻ người được chúc (SOC-DEC-003). Lý do: feed đầy bài máy là nguyên nhân số một khiến người dùng tắt thông báo và bỏ sản phẩm.

### 3.8 Payload realtime là DTO đã mask

Sự kiện WS mang **đúng DTO** mà REST trả cho người nhận, không bao giờ mang hàng thô. Room `co:{companyId}:feed` cần gate `view:feed` lúc join; room `co:{companyId}:feedgroup:{groupId}` cần thêm membership (SOC-DEC-010).

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

1. Cho nhân viên một nơi chia sẻ thông tin nội bộ thay vì nhóm chat rời rạc.
2. Cho HR/Admin kênh phát **tin tức công ty** có ghim và đo được ai đã đọc.
3. Thu **sáng kiến** của nhân viên theo một quy trình xét duyệt có vết.
4. Lấy ý kiến nhanh bằng **bình chọn**, kể cả ẩn danh.
5. Ghi nhận đóng góp bằng **vinh danh** kèm huy hiệu.
6. Cho quản trị công cụ **kiểm duyệt** và số liệu **tương tác** để biết truyền thông nội bộ có sống hay không.

### 4.2 Mục tiêu kỹ thuật

1. Tái dùng hạ tầng sẵn có: file-service, bộ emoji CHAT, outbox NOTI, `user_preferences`, recycle-bin, `system-jobs`, RealtimeEmitter — **không dựng hạ tầng song song**.
2. Mọi truy vấn danh sách ép `company_id` + `audience` + membership **trong SQL**.
3. Bộ đếm (thích/bình luận/xem) cập nhật **trong cùng transaction** với hàng gốc và có script đối soát.
4. Tìm kiếm toàn văn bằng Postgres `tsvector`, không thêm hạ tầng tìm kiếm mới.

---

## 5. Phạm vi module

### 5.1 Trong wave S16-SOCIAL (v1) — SC-01..14

| Story | Nội dung | Track |
| --- | --- | --- |
| SC-01 | Đăng bài chia sẻ (văn bản · ảnh · video · hashtag · gắn thẻ) theo phạm vi công ty/đơn vị/nhóm; sửa, xoá bài của mình | A |
| SC-02 | Thích (emoji), bình luận, trả lời 1 cấp, mention @, đính kèm; xem số người xem | A |
| SC-03 | Lọc/sắp xếp bảng tin (tất cả · theo loại · hoạt động mới · mới đăng), tìm kiếm bài | A |
| SC-04 | Lưu bài, xem «Đã lưu»; xem «Bài viết của tôi» và trang bài của đồng nghiệp | A |
| SC-05 | HR/Admin đăng **tin tức**, ghim «Tin nổi bật», yêu cầu xác nhận đã đọc và xem ai đã đọc | A |
| SC-06 | Thấy sinh nhật hôm nay/tuần này (ngày+tháng) và gửi lời chúc; tự ẩn sinh nhật của mình | A |
| SC-07 | Tạo/tham gia nhóm công khai, xin vào nhóm riêng tư; admin nhóm duyệt thành viên, đăng bài trong nhóm | B |
| SC-08 | Tạo bình chọn (1/nhiều lựa chọn · ẩn danh · hạn), bỏ phiếu, xem kết quả; tự đóng khi hết hạn | B |
| SC-09 | Gửi sáng kiến; admin/HR xét duyệt kèm ghi chú; tác giả nhận thông báo | B |
| SC-10 | Gửi lời vinh danh kèm huy hiệu; HR quản lý catalog huy hiệu | B |
| SC-11 | NOTI: mention · bình luận vào bài của tôi · trả lời · tin tức mới · sáng kiến đổi trạng thái · vinh danh · nhóm duyệt · bình chọn đóng · bài bị báo cáo | B |
| SC-12 | Hàng đợi báo cáo: ẩn/hiện · khoá bình luận · xoá bài · xử lý báo cáo — mọi thao tác có audit | C |
| SC-13 | Thống kê tương tác theo tuần & đơn vị, xuất XLSX; widget DASH «Tương tác tuần» | C |
| SC-14 | Dải ô liên kết nhanh (Công việc · Nghỉ phép · Chấm công · Đặt phòng · Mục tiêu · Đào tạo · Đăng bài Facebook) hiện theo quyền | C |

Cấp phát **ĐÓNG** của v1 (con số chốt tại DOC-1 — xem §23.1 về chênh lệch với ước lượng lúc seed):

| Hạng mục | Số chốt |
| --- | --- |
| Bảng mới `feed_*` | **19** (Track A 10 · Track B 9) |
| Màn hình | **12** — `SOC-SCREEN-001..012` |
| Route | **53** — `SOCIAL-API-001..053` |
| Cặp quyền mới | **14** (§11) |
| Mã lỗi | **22** — `SOCIAL-ERR-001..022` |
| Sự kiện NOTI | **9** — `NOTI-EVENT-028..036` |
| Widget DASH | **2** — `SOCIAL-WIDGET-001/002` |
| Trạng thái mới ở SPEC-01 | **3** nhóm — §17.18 (bài) · §17.19 (sáng kiến) · §17.20 (bình chọn) |

### 5.2 Ngoài v1 — `PARK-SOCIAL-001` (cập nhật)

Chừa thiết kế, **không làm đợt này**: đăng lại có trích dẫn · khảo sát nhiều câu (form builder) · story/video ngắn · thông báo đẩy mobile · dịch tự động · sự kiện + RSVP · **đăng chéo ra Facebook qua fbpost** · trợ lý AI tổng hợp tin · widget doanh số/KPI (ngoài phạm vi sản phẩm sau de-media-fy).

### 5.3 `PARK-SOCIAL-002` — giới thiệu ứng viên

Màn MISA có «Giới thiệu ứng viên». Ở MediaOS đây là **việc của RECRUIT**, không của SOCIAL: cần một đường `Own` cho nhân viên gửi giới thiệu vào `candidates` với nguồn `REFERRAL`. Ghi ở RELEASE-14; SOCIAL v1 **không** tạo bảng hay route cho việc này.

---

## 6. Nhóm người dùng

| Vai | Quyền trong SOCIAL |
| --- | --- |
| **Nhân viên** (`employee`) | Đọc bảng tin công ty; đăng bài `share`/`idea`/`poll`/`kudos`; bình luận; thích; lưu; báo cáo; tạo/tham gia nhóm; bỏ phiếu; gửi vinh danh |
| **Quản lý** (`manager`) | Như nhân viên, cộng `view:feed-report` phạm vi `Department` |
| **HR** (`hr`) | Như nhân viên, cộng đăng **tin tức** (`manage:feed-news`), kiểm duyệt bài/nhóm/báo cáo, duyệt sáng kiến, quản lý huy hiệu, xem thống kê |
| **Quản trị công ty** (`company-admin`) | Toàn bộ quyền của HR |
| `payroll-officer` · `recruiter` | **Không có gì thêm** ngoài bộ mặc định của `employee` |

---

## 7. Mối liên kết với các module khác

| Module | Quan hệ |
| --- | --- |
| **AUTH** | Cặp quyền + `data_scope`; token cho WS |
| **HR** | `employees` (tác giả · người được gắn thẻ · người được vinh danh), `org_units` (phạm vi `org_unit`), `date_of_birth` (chỉ ngày+tháng — §3.5) |
| **FOUNDATION** | `files` + `file_links` (đính kèm), `audit_logs`, `user_preferences` (ẩn sinh nhật), recycle-bin (khôi phục bài xoá), `system-jobs` (đóng bình chọn hết hạn) |
| **NOTI** | 9 sự kiện §17 qua outbox |
| **CHAT** | **Dùng chung bộ emoji** (`chat-reactions.emoji-set`) — không định nghĩa bộ thứ hai |
| **ME** | Sidebar ME thêm «Bài viết của tôi» · «Đã lưu» |
| **DASH** | 2 widget §17.3 |
| **RECRUIT** | `PARK-SOCIAL-002` (giới thiệu ứng viên) — chưa nối ở v1 |
| **fbpost** | Tiện ích con «Đăng bài Facebook» trong sidebar SOCIAL (§3.1) |

---

## 8. Cấu trúc thông tin — 19 bảng `feed_*`

### 8.1 Track A — 10 bảng (WO `S16-SOCIAL-DB-1`)

| # | Bảng | Vai trò |
| --- | --- | --- |
| 1 | `feed_posts` | Bài đăng: `type` · `audience` · `status` · `pinned` · `comments_locked` · bộ đếm · `search_vector` · `edited_at` · `deleted_at` |
| 2 | `feed_comments` | Bình luận 1 cấp (`parent_comment_id` chỉ trỏ bình luận gốc) |
| 3 | `feed_reactions` | Cảm xúc cho **cả** bài và bình luận (`target_type` · `target_id`), UNIQUE theo người |
| 4 | `feed_mentions` | Quan hệ mention THẬT (không lặp nợ `task_comment_mentions`) |
| 5 | `feed_tags` | Từ điển hashtag theo tenant |
| 6 | `feed_post_tags` | Nối bài ↔ hashtag |
| 7 | `feed_saved_posts` | Bài đã lưu, UNIQUE(company, user, post) |
| 8 | `feed_post_views` | Lượt xem lần đầu, UNIQUE(company, post, user) |
| 9 | `feed_post_acks` | Xác nhận đã đọc tin tức, UNIQUE(company, post, user) |
| 10 | `feed_reports` | Báo cáo bài/bình luận: lý do · `open → resolved/dismissed` |

### 8.2 Track B — 9 bảng (WO `S16-SOCIAL-DB-2`)

| # | Bảng | Vai trò |
| --- | --- | --- |
| 11 | `feed_groups` | Nhóm `public`/`private` |
| 12 | `feed_group_members` | Thành viên + **vai trò hàng** `owner`/`admin`/`member` + `status` `active`/`pending` |
| 13 | `feed_polls` | Bình chọn gắn 1-1 với bài `type='poll'` |
| 14 | `feed_poll_options` | 2–10 lựa chọn |
| 15 | `feed_poll_votes` | Phiếu; **lưu `user_id` kể cả poll ẩn danh** để chống phiếu đôi |
| 16 | `feed_ideas` | Sáng kiến gắn 1-1 với bài `type='idea'` + FSM + `reviewed_by/at/note` |
| 17 | `feed_kudos` | Lời vinh danh gắn 1-1 với bài `type='kudos'` |
| 18 | `feed_kudos_recipients` | Người được vinh danh (nhiều người / một lời) |
| 19 | `feed_kudos_badges` | Catalog huy hiệu (có seed ban đầu) |

> Chi tiết cột · kiểu · CHECK · index · RLS · composite tenant-FK: **DB-17**.

### 8.3 Bảng dùng lại — KHÔNG tạo mới

`files` · `file_links` (UNION-ADD `object_type` `feed_post` · `feed_comment`) · `audit_logs` (UNION-ADD `object_types`) · `user_preferences` · `employees` · `org_units` · `notification_*` (outbox) · `system_jobs`.

---

## 9. Danh sách màn hình — `SOC-SCREEN-001..012`

| Mã | Màn hình | Quyền vào | Track |
| --- | --- | --- | --- |
| `SOC-SCREEN-001` | **Bảng tin** — composer 5 nút · thẻ bài · lọc/sắp xếp · badge «N bài mới» · dải ô liên kết nhanh | `view:feed` | A |
| `SOC-SCREEN-002` | **Chi tiết bài** — bài + toàn bộ bình luận + người thích | `view:feed` | A |
| `SOC-SCREEN-003` | **Tin tức** — danh sách tin, tin ghim, xác nhận đã đọc, danh sách đã đọc | `view:feed` (danh sách đã đọc: `manage:feed-news`) | A |
| `SOC-SCREEN-004` | **Đã lưu** | `view:feed` | A |
| `SOC-SCREEN-005` | **Trang cá nhân** — «Bài viết của tôi» / bài của đồng nghiệp | `view:feed` | A |
| `SOC-SCREEN-006` | **Nhóm** — danh sách · trang nhóm · thành viên · xin vào/duyệt · cài đặt | `view:feed` (+ membership) | B |
| `SOC-SCREEN-007` | **Bình chọn** — thẻ poll trong feed + trang danh sách | `view:feed` | B |
| `SOC-SCREEN-008` | **Sáng kiến** — danh sách + màn xét duyệt | `view:feed`; xét duyệt: `approve:feed-idea` | B |
| `SOC-SCREEN-009` | **Vinh danh** — thẻ kudos + huy hiệu | `view:feed` | B |
| `SOC-SCREEN-010` | **Kiểm duyệt** — hàng đợi báo cáo + bài đang ẩn | `view:feed-report` (hành động: `manage:feed-report` · `manage:feed-post`) | C |
| `SOC-SCREEN-011` | **Thống kê tương tác** — theo tuần & đơn vị + XLSX | `view:feed-report` | C |
| `SOC-SCREEN-012` | **Thiết lập huy hiệu** — CRUD catalog | `manage:feed-kudos` | C |

> Bố cục **cổng thông tin 3 cột** dùng riêng cho SOCIAL: xem [UI-07](<../UI/UI-07_Module_Workspace_Template_Design.md>) biến thể «portal».

---

## 10. Chi tiết chức năng — `SOCIAL-FUNC-001..014`

| Mã | Chức năng | Màn | Ghi chú |
| --- | --- | --- | --- |
| `SOCIAL-FUNC-001` | Đăng / sửa / xoá bài (5 loại) | 001 · 002 | Sửa ghi `edited_at`, hiện nhãn «đã chỉnh sửa» |
| `SOCIAL-FUNC-002` | Bình luận 1 cấp + mention + đính kèm | 002 | Trả lời chỉ 1 cấp (§13.2) |
| `SOCIAL-FUNC-003` | Cảm xúc bài/bình luận (bộ emoji CHAT) | 001 · 002 | Đổi emoji = ghi đè hàng; UNIQUE theo người |
| `SOCIAL-FUNC-004` | Lưu / bỏ lưu bài | 001 · 004 | |
| `SOCIAL-FUNC-005` | Đếm lượt xem lần đầu | 001 · 002 | Reload **không** tăng |
| `SOCIAL-FUNC-006` | Tin tức: ghim · yêu cầu xác nhận đọc · danh sách đã đọc | 003 | Ghim và tạo tin cần `manage:feed-news` |
| `SOCIAL-FUNC-007` | Hashtag: parse `#tag` · lọc theo thẻ | 001 | |
| `SOCIAL-FUNC-008` | Tìm kiếm toàn văn | 001 | `tsvector`, phạm vi tenant (§13.5) |
| `SOCIAL-FUNC-009` | Sinh nhật ngày+tháng + gửi lời chúc | 001 | `day`/`month` không lộ ở **bất kỳ** đường ra nào; `showBirthday` gate widget `026` — **không** ẩn danh tính (xem §3.5) |
| `SOCIAL-FUNC-010` | Nhóm: tạo · xin vào · duyệt · vai trò hàng · bài trong nhóm | 006 | Membership ép trong SQL (§3.4) |
| `SOCIAL-FUNC-011` | Bình chọn: bỏ/đổi phiếu · ẩn danh · hạn đóng | 007 | Job đóng theo hạn (§13.4) |
| `SOCIAL-FUNC-012` | Sáng kiến: gửi · xét duyệt có ghi chú | 008 | FSM §13.3 |
| `SOCIAL-FUNC-013` | Vinh danh + catalog huy hiệu | 009 · 012 | |
| `SOCIAL-FUNC-014` | Kiểm duyệt: báo cáo · ẩn/ghim/khoá/xoá · thống kê | 010 · 011 | Mọi hành động ghi audit |

---

## 11. Permission — **14 cặp mới**, tiền tố `feed-`

### 11.1 Bảng cặp quyền

| # | Cặp | `data_scope` mặc định | Vai được cấp |
| --- | --- | --- | --- |
| 1 | `view:feed` | `Company` | employee · manager · hr · company-admin |
| 2 | `create:feed-post` | `Company` | employee · manager · hr · company-admin |
| 3 | `create:feed-comment` | `Company` | employee · manager · hr · company-admin |
| 4 | `create:feed-poll` | `Company` | employee · manager · hr · company-admin |
| 5 | `create:feed-idea` | `Company` | employee · manager · hr · company-admin |
| 6 | `create:feed-kudos` | `Company` | employee · manager · hr · company-admin |
| 7 | `create:feed-group` | `Company` | employee · manager · hr · company-admin |
| 8 | `manage:feed-news` | `Company` | hr · company-admin |
| 9 | `manage:feed-post` | `Company` | hr · company-admin |
| 10 | `manage:feed-group` | `Company` | hr · company-admin |
| 11 | `manage:feed-kudos` | `Company` | hr · company-admin |
| 12 | `manage:feed-report` | `Company` | hr · company-admin |
| 13 | `approve:feed-idea` | `Company` | hr · company-admin |
| 14 | `view:feed-report` | `Company` (manager: `Department`) | manager · hr · company-admin |

- **Không cặp nào `is_sensitive`** — SOCIAL không chở PII (sinh nhật đã cắt còn ngày+tháng, §3.5).
- Mọi hành động của nhóm `manage:*` và `approve:feed-idea` **ghi audit** (§18).
- Grant lưu **per-(permission, role)** — một hàng `role_permissions` cho mỗi cặp × vai, đúng khuôn §13 của ma trận quyền.

### 11.2 Luật «tương tác cá nhân không có cặp riêng»

| Hành vi | Điều kiện | KHÔNG có cặp |
| --- | --- | --- |
| Thích / bỏ thích | `view:feed` trên bài + hàng ghi `user_id = actor` | ~~`create:feed-reaction`~~ |
| Bỏ / đổi phiếu | `view:feed` + poll còn `open` + `user_id = actor` | ~~`create:feed-vote`~~ |
| Lưu / bỏ lưu | `view:feed` + `user_id = actor` | ~~`create:feed-save`~~ |
| Đánh dấu đã xem | `view:feed` + `user_id = actor` | ~~`create:feed-view`~~ |
| Xác nhận đã đọc | `view:feed` + bài `type='news'` yêu cầu ack + `user_id = actor` | ~~`create:feed-ack`~~ |
| Báo cáo | `view:feed` + `reporter_id = actor` | ~~`create:feed-report`~~ (đọc hàng đợi mới cần `view:feed-report`) |

### 11.3 Ba cặp của fbpost — KHÔNG đổi

`view:social-post` · `create:social-post` · `manage:social-account` giữ nguyên tên, nguyên grant, nguyên hành vi. Wave S16 **không sinh migration đổi tên quyền trên PROD** (SOC-DEC-002).

---

## 12. Quy tắc nghiệp vụ và mã lỗi — `SOCIAL-ERR-001..022`

| Mã | HTTP | Tình huống |
| --- | --- | --- |
| `SOCIAL-ERR-001` | 404 | Bài không tồn tại, đã xoá mềm, hoặc `hidden` với người không phải tác giả/`manage:feed-post` |
| `SOCIAL-ERR-002` | 403 | **Chỉ nhánh GHI:** đăng bài / bình luận vào `org_unit` hoặc `group` mà actor không thuộc. Actor tự biết đích tồn tại (tự chọn nó) nên 403 không rò gì. **Nhánh ĐỌC không dùng mã này** — xem luật rò rỉ dưới bảng |
| `SOCIAL-ERR-003` | 403 | Sửa/xoá bài của người khác mà không có `manage:feed-post` |
| `SOCIAL-ERR-004` | 409 | Bình luận vào bài đã khoá bình luận |
| `SOCIAL-ERR-005` | 422 | Trả lời quá 1 cấp (`parent_comment_id` trỏ vào một bình luận đã là trả lời) |
| `SOCIAL-ERR-006` | 422 | Emoji ngoài bộ CHAT |
| `SOCIAL-ERR-007` | 422 | Quá 10 ảnh / quá 1 video / tệp quá 20MB |
| `SOCIAL-ERR-008` | 422 | `audience='org_unit'` mà thiếu `org_unit_id`, hoặc `audience='group'` mà thiếu `group_id` |
| `SOCIAL-ERR-009` | — | **KHÔNG phải mã HTTP lỗi.** Mention người ngoài `audience` bị **bỏ im lặng**: request vẫn `201`, phần mention đó không được tạo, và response trả `data.droppedMentions[]` (danh sách id bị bỏ) để FE hiện chú thích. Trả 403 ở đây **chính là** rò — caller biết mention bị chặn vì lý do audience. Mã giữ chỗ trong bảng để census không coi là thiếu |
| `SOCIAL-ERR-010` | 403 | Tạo/ghim tin tức mà không có `manage:feed-news` |
| `SOCIAL-ERR-011` | 409 | Xác nhận đã đọc một bài không phải `news` hoặc không bật «yêu cầu xác nhận» |
| `SOCIAL-ERR-012` | 404 | Nhóm không tồn tại, hoặc nhóm `private` với người không phải thành viên |
| `SOCIAL-ERR-013` | 409 | Đã là thành viên / đã có yêu cầu vào nhóm đang chờ |
| `SOCIAL-ERR-014` | 403 | Duyệt thành viên / đổi vai trò mà không phải `owner`\|`admin` nhóm và không có `manage:feed-group` |
| `SOCIAL-ERR-015` | 409 | Rời nhóm khi là `owner` cuối cùng |
| `SOCIAL-ERR-016` | 409 | Bỏ phiếu vào bình chọn đã `closed` hoặc quá hạn |
| `SOCIAL-ERR-017` | 409 | Bỏ phiếu lần hai vào bình chọn một-lựa-chọn (đổi phiếu phải đi đường sửa) |
| `SOCIAL-ERR-018` | 422 | Bình chọn ngoài khoảng 2–10 lựa chọn |
| `SOCIAL-ERR-019` | 409 | Chuyển trạng thái sáng kiến sai (§13.3) |
| `SOCIAL-ERR-020` | 403 | Xét duyệt sáng kiến mà không có `approve:feed-idea` |
| `SOCIAL-ERR-021` | 409 | Xử lý một báo cáo đã `resolved`/`dismissed` |
| `SOCIAL-ERR-022` | 422 | Huy hiệu không có trong catalog hoặc đã tắt |

> **Luật rò rỉ — 404 TRƯỚC 403, không có ngoại lệ ở nhánh ĐỌC.**
>
> | Tình huống | Mã | Vì sao |
> | --- | --- | --- |
> | Đọc bài không thuộc audience (đơn vị khác · nhóm kín không là thành viên) · bài `hidden` với người ngoài · bài `deleted` | **404 `ERR-001`** | Trả 403 là xác nhận bài tồn tại |
> | Đọc **chính nhóm** `private` khi không là thành viên | **404 `ERR-012`** | như trên |
> | **Ghi** vào đích mà actor tự chọn nhưng không thuộc (đăng bài vào org_unit/nhóm lạ) | **403 `ERR-002`** | Actor đã biết đích tồn tại — không có gì để rò |
> | Thiếu cặp quyền hành động trên đối tượng **đã thấy được** | **403** (mã theo hành động) | Đã ở trong audience |
>
> Ranh giới một câu: **không thấy ⇒ 404; thấy rồi mà không được làm ⇒ 403.**

---

## 13. Lõi nghiệp vụ

### 13.1 Trạng thái bài — SPEC-01 §17.18

```text
published ⇄ hidden
published → deleted
hidden    → deleted
```

- `published → hidden` / `hidden → published`: cần `manage:feed-post`, ghi audit.
- `→ deleted`: xoá mềm (`deleted_at`), tác giả hoặc `manage:feed-post`; vào recycle-bin.
- Bài `deleted` phải **biến khỏi** feed, bộ đếm, tìm kiếm, hashtag và «Đã lưu» ngay trong cùng transaction — bằng **vị từ lọc**, KHÔNG bằng việc xoá hàng quan hệ (§16). Khôi phục từ thùng rác trả lại đủ vì không có gì bị mất.

### 13.2 Bình luận một cấp

`parent_comment_id` chỉ được trỏ vào bình luận **gốc** (`parent_comment_id IS NULL`). Trỏ vào một trả lời ⇒ `SOCIAL-ERR-005`. Ràng buộc này ép ở service (một câu kiểm tra trong cùng tx), vì CHECK cấp hàng không nhìn được hàng cha.

### 13.3 Trạng thái sáng kiến — SPEC-01 §17.19

```text
submitted → under_review → accepted
                        → rejected
```

- Chuyển tiếp cần `approve:feed-idea`; ghi `reviewed_by` · `reviewed_at` · `review_note`.
- `accepted` và `rejected` là **terminal**. Mọi chuyển tiếp khác ⇒ `SOCIAL-ERR-019`.
- `rejected` bắt buộc có `review_note`.
- Mỗi lần chuyển phát NOTI cho tác giả và ghi một dòng audit.

### 13.4 Trạng thái bình chọn — SPEC-01 §17.20

```text
open → closed
```

- Đóng bằng tay (tác giả hoặc `manage:feed-post`) hoặc bằng **job** khuôn `system-jobs` khi quá `closes_at`.
- Còn `open` thì đổi phiếu được; `closed` thì mọi ghi ⇒ `SOCIAL-ERR-016`.
- **Ẩn danh:** `feed_poll_votes.user_id` **vẫn lưu** (chống phiếu đôi) nhưng DTO kết quả **không chở `user_id`** — kể cả cho `company-admin`. QA có ca ghim chuyện này.
- 🔒 **`multiple_choice` và `is_anonymous` BẤT BIẾN sau khi tạo poll.** Chốt cuối chống phiếu đôi ở DB là partial unique dựa trên cờ dẫn xuất `single_choice` (DB-17 §7.5); đổi `multiple_choice` giữa chừng làm chốt đó **sai lệch im lặng**. Đổi `is_anonymous` sau khi có phiếu thì người đã bỏ phiếu bị đổi giao kèo riêng tư. Service chặn cả hai; có ca QA riêng.
- **Lựa chọn (`feed_poll_options`) cũng bất biến** sau khi tạo — DB-17 §7.4.

### 13.5 Tìm kiếm

Cột sinh `search_vector` trên `feed_posts` — **cột này LUÔN tồn tại** ở mọi môi trường (DB-17 §6.1b cấm nhánh «bỏ cột»). Dùng `unaccent` **nếu extension có mặt** — WO `S16-SOCIAL-DB-1` **đo `pg_extension` lúc chạy**; không có thì `to_tsvector('simple', …)` và ghi lại lựa chọn vào DB-17. Migration **không** `CREATE EXTENSION` mù (cần superuser, PROD có thể từ chối). Trường hợp xấu nhất là fallback `ILIKE` — và đó là quyết định ở **tầng service**, DDL không đổi.

### 13.6 Bộ đếm denormalized

Bộ đếm denormalized của module gồm **năm** cột, không phải ba — tất cả cập nhật **trong cùng transaction** với hàng nguồn:

| Cột | Đối soát với |
| --- | --- |
| `feed_posts.like_count` | `COUNT(*) feed_reactions` theo bài |
| `feed_posts.comment_count` | `COUNT(*) feed_comments` chưa xoá mềm |
| `feed_posts.view_count` | `COUNT(*) feed_post_views` |
| `feed_tags.usage_count` | `COUNT(*) feed_post_tags` qua bài chưa xoá mềm |
| `feed_groups.member_count` | `COUNT(*) feed_group_members` `status='active'` |

Có ca test race (hai lượt thích đồng thời) và **script đối soát cả năm cột** cho QA.

### 13.7 Realtime

| Sự kiện WS | Room | Payload |
| --- | --- | --- |
| `feed:post.created` | `co:{companyId}:feed` · `co:{companyId}:feedgroup:{groupId}` | DTO bài đã mask |
| `feed:comment.created` | như trên | DTO bình luận đã mask |
| `feed:reaction.changed` | như trên | `{targetType, targetId, likeCount}` — **đúng tên trường của DTO REST** (API-19 §7), để ca T20 so khớp được |

FE **chỉ** hiện badge «N bài mới» và cập nhật số đếm — **không tự chèn bài vào giữa dòng cuộn đang đọc**.

---

## 14. Trạng thái UI bắt buộc

Mọi màn §9 phải xử lý đủ: **loading** (skeleton thẻ bài) · **error** (kèm nút thử lại) · **empty** (khác nhau cho «chưa có bài nào», «không có kết quả tìm kiếm», «nhóm chưa có bài») · **forbidden** (ẩn mục khỏi sidebar thay vì hiện rồi báo lỗi) · **đang gửi** (composer khoá nút, hiện tiến trình tải tệp).

---

## 15. Yêu cầu API cấp SPEC — 53 route

Bảng endpoint đầy đủ kèm cặp quyền từng route, DTO và mã lỗi: **[API-19](<../API Design/API-19_SOCIAL_API_Design.md>)**. Tóm tắt cụm:

| Cụm | Mã | Số route |
| --- | --- | --- |
| Bảng tin & bài | `SOCIAL-API-001..013` | 13 |
| Bình luận | `SOCIAL-API-014..019` | 6 |
| Tin tức & xác nhận đọc | `SOCIAL-API-020..022` | 3 |
| Tìm kiếm · thẻ · trang cá nhân · sinh nhật | `SOCIAL-API-023..026` | 4 |
| Báo cáo | `SOCIAL-API-027..029` | 3 |
| Nhóm | `SOCIAL-API-030..039` | 10 |
| Bình chọn | `SOCIAL-API-040..044` | 5 |
| Sáng kiến | `SOCIAL-API-045..046` | 2 |
| Vinh danh & huy hiệu | `SOCIAL-API-047..051` | 5 |
| Thống kê | `SOCIAL-API-052..053` | 2 |

---

## 16. Dữ liệu và lưu trữ

- **Đính kèm** đi qua file-service như CHAT: presign → tải lên → `file_links` với `object_type` `feed_post`/`feed_comment`. Giới hạn v1: **≤10 ảnh/bài · ≤1 video · ≤20MB/tệp** (mirror hằng của CHAT).
- **Xoá mềm = LỌC, KHÔNG XOÁ quan hệ.** Đặt `deleted_at` trên `feed_posts`/`feed_comments`; các bảng quan hệ **giữ nguyên hàng**. Bài biến khỏi feed · tìm kiếm · hashtag · «Đã lưu» · danh sách người thích bằng **vị từ `deleted_at IS NULL` trong SQL**, không bằng DELETE. Nhờ vậy khôi phục từ thùng rác trả lại **đủ** quan hệ (§13.1, T18).
  - **Danh sách ĐÓNG những gì bị đụng khi xoá mềm một bài** (không có dấu «…»): `feed_posts.deleted_at` được set; `feed_tags.usage_count` và bộ đếm của bài (`like_count`/`comment_count`/`view_count`) **điều chỉnh được và đảo ngược được** khi khôi phục. **Không bảng nào bị DELETE.**
  - `feed_post_views` và `feed_post_acks` là **append-only, không có grant DELETE** (DB-17 §6.8/§6.9) ⇒ **không bao giờ** bị đụng, kể cả khi muốn.
- **Lưu trữ lâu dài:** bài không tự hết hạn ở v1; 19 bảng mới phải vào `RetentionService.PROTECTED_TABLES` cùng lượt migration.
- **Múi giờ:** lưu UTC, hiển thị theo múi giờ công ty; server trả ISO, FE format bằng `date-fns`.

---

## 17. Sự kiện và thông báo

### 17.1 NOTI-EVENT — dải **028..036** (đo tại DOC-1: cao nhất đang dùng là `NOTI-EVENT-027` của S15-PAYROLL-V2)

| Mã | Sự kiện | Người nhận |
| --- | --- | --- |
| `NOTI-EVENT-028` | Có người nhắc tên (@) trong bài hoặc bình luận | Người được nhắc (nếu trong audience) |
| `NOTI-EVENT-029` | Có bình luận mới vào bài của tôi | Tác giả bài (trừ người thao tác) |
| `NOTI-EVENT-030` | Có trả lời vào bình luận của tôi | Tác giả bình luận gốc (trừ người thao tác) |
| `NOTI-EVENT-031` | Tin tức công ty mới được đăng | Toàn bộ nhân viên trong audience |
| `NOTI-EVENT-032` | Sáng kiến đổi trạng thái | Tác giả sáng kiến |
| `NOTI-EVENT-033` | Được vinh danh | Người được vinh danh |
| `NOTI-EVENT-034` | Yêu cầu vào nhóm được duyệt / từ chối | Người xin vào |
| `NOTI-EVENT-035` | Bình chọn đã đóng | Người tạo bình chọn |
| `NOTI-EVENT-036` | Bài bị báo cáo | Người có `view:feed-report` |

> ⚠️ **Catalog NOTI sống ở HAI bảng có CHECK riêng** — migration của `S16-SOCIAL-DB-2` phải UNION-ADD **cả hai** cộng bản mẫu (template), không rewrite. Dải trên **đo lại lúc merge**: nếu wave khác đã lấy 028+ thì dịch lên, không hard-code.

### 17.2 Kênh

Trong ứng dụng (chuông NOTI) là kênh duy nhất ở v1. **Không** email, **không** push mobile (`PARK-SOCIAL-001`).

### 17.3 Widget DASH

| Mã | Widget | Gate |
| --- | --- | --- |
| `SOCIAL-WIDGET-001` | «Tương tác tuần» — bài · bình luận · thích · thành viên hoạt động | `view:feed-report` (sàn `Company`; manager `Department`) |
| `SOCIAL-WIDGET-002` | «Tin tức chưa đọc» — đếm tin yêu cầu ack mà tôi chưa xác nhận | `view:feed` (phạm vi `Own`) |

---

## 18. Audit và bảo mật

### 18.1 Hành động ghi audit

Mọi thao tác `manage:*` và `approve:feed-idea`: ẩn/hiện bài · ghim/bỏ ghim · khoá/mở bình luận · xoá bài người khác · xử lý báo cáo · duyệt/từ chối thành viên nhóm · đổi vai trò nhóm · xét duyệt sáng kiến · sửa catalog huy hiệu.

`object_type` mới **UNION-ADD** vào CHECK của `audit_logs`: `feed_post` · `feed_comment` · `feed_group` · `feed_report`.

### 18.2 Điểm rủi ro đã nhận diện

| Rủi ro | Biện pháp |
| --- | --- |
| Đọc bài nhóm riêng tư khi không là thành viên | Lọc membership **trong SQL** + ca IDOR bắt buộc (§3.4) |
| Lộ năm sinh qua cửa sau SOCIAL | DTO chỉ `day`/`month`; ca test grep response không chứa `date_of_birth` hay năm (§3.5) |
| Lộ người bỏ phiếu ở poll ẩn danh | DTO kết quả không có `user_id`, kể cả cho admin (§13.4) |
| Mention dùng để dò sự tồn tại của bài kín | Bỏ mention im lặng, không trả thông tin bài (`SOCIAL-ERR-009`) |
| Bài `hidden` vẫn đọc được qua đường chi tiết | `SOCIAL-ERR-001` trả 404 cho người không phải tác giả/`manage` |
| Payload WS chở cột thừa | WS dùng **đúng** DTO của REST (§3.8); QA có ca so khớp trường |
| Ngày/tháng sinh rò qua một đường đọc khác widget | Hai trường `day`/`month` (và mọi trường phái sinh `date_of_birth`) không có mặt trong DTO của `023`/`024`/`025` — không đường ra nào chở chúng |

---

## 19. Non-functional requirements

| Tiêu chí | Ngưỡng |
| --- | --- |
| Tải bảng tin trang đầu (20 bài) | < 500ms p95 |
| Tìm kiếm toàn văn | < 800ms p95 |
| Thống kê tương tác | < 2s p95, **không cache** (số phải tươi) |
| Phân trang | cursor-based cho feed; offset cho các danh sách quản trị |
| Coverage `apps/api/src/social/` | **≥ 85%** trên LANE_DB |

---

## 20. Tiêu chí nghiệm thu tổng quát

1. 19 bảng có RLS + FORCE, composite tenant-FK, CHECK mirror contracts hai chiều.
2. 14 cặp quyền seed `ON CONFLICT DO NOTHING`, grant per-(cặp, vai) đúng §11.1; ba cặp `social-*` của fbpost **không đổi**.
3. 53 route có guard hai tầng + kiểm tra audience/membership; `manage/approve` ghi audit.
4. 12 màn đủ loading/error/empty/forbidden; bố cục 3 cột gập đúng dưới 1024px.
5. 9 sự kiện NOTI phát qua outbox, có mặt ở **cả hai** bảng catalog + template.
6. Bài xoá mềm biến khỏi feed/đếm/tìm kiếm/thẻ/đã lưu; khôi phục trả lại đủ.
7. Sinh nhật không lộ năm; poll ẩn danh không lộ người bỏ phiếu.
8. Coverage `social/` ≥ 85% trên LANE_DB.

---

## 21. Test scenario cấp cao

| # | Ca | Kỳ vọng |
| --- | --- | --- |
| T1 | `employee` đăng bài `share` phạm vi công ty | 201; bài hiện trong feed của đồng nghiệp |
| T2 | `employee` đăng bài phạm vi `org_unit` khác đơn vị người đọc | Người đọc **không** thấy bài |
| T3 | Người không là thành viên đọc **bài** trong nhóm `private` | 404 **`SOCIAL-ERR-001`** (đọc bài ⇒ mã của bài) |
| T3b | Người không là thành viên đọc **chính nhóm** `private` | 404 **`SOCIAL-ERR-012`** (đọc nhóm ⇒ mã của nhóm) |
| T4 | `employee` sửa bài của người khác | 403 `SOCIAL-ERR-003` |
| T5 | `employee` ghim tin tức | 403 `SOCIAL-ERR-010` |
| T6 | Bình luận vào bài đã khoá bình luận | 409 `SOCIAL-ERR-004` |
| T7 | Trả lời vào một trả lời | 422 `SOCIAL-ERR-005` |
| T8 | Thích hai lần | Hàng UNIQUE — lần hai ghi đè, `like_count` **không** tăng gấp đôi |
| T9 | Hai lượt thích đồng thời | Bộ đếm khớp `COUNT(*)` (race) |
| T10 | Bỏ phiếu vào poll đã đóng | 409 `SOCIAL-ERR-016` |
| T11 | Xem kết quả poll ẩn danh bằng `company-admin` | Response **không** chứa `user_id` |
| T12 | Đọc widget sinh nhật | Response **không** chứa năm sinh / `date_of_birth` |
| T13 | Người đã đặt `showBirthday=false` | Không xuất hiện ở widget sinh nhật (`026`); **vẫn** tìm được ở `023`/`024`/`025` (cờ không ẩn danh tính), và các đường đó không chở `day`/`month` |
| T14 | Xác nhận đã đọc một bài không phải `news` | 409 `SOCIAL-ERR-011` |
| T15 | Chuyển sáng kiến `submitted → accepted` (bỏ qua `under_review`) | 409 `SOCIAL-ERR-019` |
| T16 | Xét duyệt sáng kiến không có `approve:feed-idea` | 403 `SOCIAL-ERR-020` |
| T17 | Xoá mềm bài | Biến khỏi feed · tìm kiếm · thẻ · đã lưu · bộ đếm, cùng tx |
| T18 | Khôi phục bài từ thùng rác | Trả lại đủ quan hệ |
| T19 | Cross-tenant: công ty B đọc bài công ty A | 404, RLS chặn |
| T20 | So payload WS với DTO REST | Trùng tập trường, không có cột thừa |
| T21 | `payroll-officer` / `recruiter` gọi route SOCIAL | Đúng bộ mặc định của `employee`, không hơn |
| T22 | Census mã lỗi | Mọi `SOCIAL-ERR-*` phát ra đều có trong §12 |

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
| SOC-DEC-011 | **Danh tính người tố giác chỉ lộ ở scope `Company`** (`SOCIAL-API-028`/`029`): trường `reporter` của DTO báo cáo = `null` với mọi người đọc hẹp hơn Company — tức manager mang `view:feed-report@Department`. Lý do: vị từ phạm vi tính theo đơn vị của BÀI, nên khi tác giả bài bị tố chính là trưởng đơn vị đó, họ đọc được tên người vừa tố giác mình — kênh trả đũa trực tiếp. Trách nhiệm giải trình (chống báo cáo bừa) giữ nguyên: HR/company-admin — vai DUY NHẤT xử lý được báo cáo (`manage:feed-report` sàn `Company`) — vẫn thấy đủ. Khoá `reporter` VẪN có mặt, che bằng `null` chứ không bỏ khoá. **Kênh NOTI bịt cùng lượt:** `NOTI-EVENT-036` không đưa `actorUserId` (user_id người tố giác) vào `notifications.payload` — hàng thông báo sống lâu hơn grant, nên che ở DTO mà để hở ở thông báo là vô nghĩa (cột `created_by` vẫn giữ, làm neo điều tra — nó không nằm trong DTO thông báo). **Phạm vi của quyết định này là trường `reporter`, KHÔNG phải `note`** — chữ tự do do người tố giác viết vẫn trả nguyên cho mọi người đọc được hàng đợi, nên họ có thể tự lộ qua nội dung (nợ FE: cảnh báo lúc soạn báo cáo). _(Khác bình chọn ẩn danh ở SOC-DEC-009: đó là ẩn với MỌI người đọc; đây là che theo scope.)_ | owner ký 22/09/2026 (S16-SOCIAL-BE-1B, D13-a) | ✅ chốt |

**Ngoài phạm vi v1 (PARK-SOCIAL-001 cập nhật ở DOC-1):** đăng lại có trích dẫn · khảo sát nhiều câu (form builder) · story/video ngắn · push mobile · dịch tự động · sự kiện + RSVP · đăng chéo ra Facebook qua fbpost. **PARK-SOCIAL-002:** giới thiệu ứng viên — cần đường Own «gửi giới thiệu» vào RECRUIT (nguồn REFERRAL), là việc của RECRUIT.

---

## 23. Tác động đến bộ tài liệu (WO `S16-SOCIAL-DOC-1`)

### 23.1 Ba con số ĐÓNG lại khác ước lượng lúc seed

Lúc seed wave (02/09/2026) các con số trong `harness/backlog.mjs` và [kế hoạch wave](<../plans/S16-SOCIAL-WAVE.md>) là **ước lượng**. DOC-1 đếm lại từ chính danh sách liệt kê và **chốt**:

| Hạng mục | Ghi lúc seed | **Chốt tại DOC-1** | Vì sao lệch |
| --- | --- | --- | --- |
| Bảng `feed_*` | «15 bảng» | **19** | Liệt kê của `S16-SOCIAL-DB-1` là 10 bảng, của `DB-2` là 9 — tổng 19. Con số 15 không khớp danh sách nào |
| Cặp quyền | «13 cặp» | **14** | SOC-DEC-004 liệt kê 7 cặp `view/create` + 7 cặp `manage/approve/view-report` = 14 |
| Route | «~45 route» | **53** | Con số «~» là ước lượng; §15 liệt kê đủ cụm |

> Danh sách liệt kê là nguồn sự thật (đó là thứ DB-1/DB-2/BE-1 sẽ thi công); con số tiêu đề chỉ là nhãn. Các WO hạ nguồn phải đối chiếu **19 / 14 / 53**, và mọi phép census (đếm bảng · đếm cặp · đếm route) lấy theo §5.1.

### 23.1b Điều DB-1/DB-2 **KHÔNG** được làm

**Không bật `modules.is_active` cho SOCIAL.** Việc đó thuộc `S16-SOCIAL-FE-1` (khuôn migration `0567`), khi màn hình đã có. Bật sớm ⇒ mục sidebar trỏ vào màn chưa tồn tại. Guard/verify của migration SOCIAL **không** được assert trạng thái `is_active` của module khác (bẫy `wiring-spec-must-not-pin-other-modules-state`) và phải forward-compatible với `is_active=true`.

### 23.2 Tài liệu đã cập nhật cùng WO này

| Tài liệu | Thay đổi |
| --- | --- |
| **SPEC-16** (file này) | §2–§21 + §23–§25; §1 lên `v1.0 Approved` |
| **DB-17** | Mới — 19 bảng, enum mirror contracts, index, seed, kế hoạch migration |
| **API-19** | Mới — 53 route kèm cặp quyền từng route, DTO, WS event |
| **SPEC-01** | §17.18 (bài) · §17.19 (sáng kiến) · §17.20 (bình chọn); §12.13 trỏ SPEC-16 + ghi chú fbpost; §20.2 thêm `NOTI-EVENT-028..036` |
| **permission-matrix §9h** | 14 cặp + grant per-(cặp, vai) |
| **DECISIONS-08 §7** | Bổ sung SOC-DEC-002 — `SOCIAL` = mạng xã hội nội bộ, fbpost là tiện ích con, resource mới tiền tố `feed-` |
| **IMPLEMENTATION-02** | EPIC-21 §8.22 — SC-01..14 ↔ `IMP02-STORY-205..218`, Sprint 16 |
| **UI-07** | Biến thể **cổng thông tin 3 cột** (rail 240 · feed ≤680 · rail 300; gập dưới 1024px) |
| **README** §8/§9 · **erd-current** · **RELEASE-14** | Dòng SOCIAL; `PARK-SOCIAL-001` cập nhật + `PARK-SOCIAL-002` |
| `harness/lib/stories.mjs` · `harness/dashboard/server.mjs` | EPIC-21 → SOCIAL; dải story mới → Sprint 16; `MODULE_SPEC` SOCIAL → SPEC-16 |

---

## 24. Definition of Done cho SPEC-16

- [x] §5 phạm vi v1 (SC-01..14) + §5.2/§5.3 PARK
- [x] §8 danh sách 19 bảng chia theo hai WO migration
- [x] §9 `SOC-SCREEN-001..012`
- [x] §11 14 cặp + luật «tương tác cá nhân đi theo `view:feed`»
- [x] §12 `SOCIAL-ERR-001..022` + luật rò rỉ 404-trước-403
- [x] §13 FSM bài · sáng kiến · bình chọn
- [x] §17 `NOTI-EVENT-028..036` (đo dải, không hard-code)
- [x] §22 quyết định owner giữ nguyên văn
- [x] `plan-reviewer` đối kháng — **2 vòng, đã dùng hết hạn mức** (backlog `done_when`; kế hoạch wave §7.14 ghi «1 vòng» là bản cũ — lấy theo backlog).
  - **Vòng 1 (18/09/2026): REVISE** — 5 CRITICAL · 8 HIGH · 11 MEDIUM · 3 LOW, kèm 13 điều kiện tự-mở-cổng. Đã vá toàn bộ 13 + các mục MEDIUM/LOW.
  - **Vòng 2: REVISE hẹp** — xác nhận **11/13** đạt; còn 2 mục chặn (ô cột `author_user_id`/`reporter_user_id` ở §6.x chưa khớp luật §4.2b · thiếu văn bản quyết định emoji) + 4 cảnh báo cấu trúc. **Đã vá cả 6 và tự kiểm chứng bằng script đối chiếu** (đúng khuyến nghị của chính vòng 2: vá thẳng, không mở vòng ba).
  - ⚠️ **Một đề xuất của vòng 1 đã bị BÁC có chứng cứ:** vòng 1 yêu cầu `ALTER TABLE employees ADD CONSTRAINT employees_company_id_id_uq`. Đo lại cho thấy **không tồn tại bảng `employees`** (code dùng `employee_profiles`) và bảng đó **đã có** `UNIQUE (company_id, id)` từ `0535`. Vòng 2 đã **xác nhận bác bỏ này là đúng**. Bản vá dùng bản đồ tên ở §4.2a, **không** ALTER.

---

## 25. Kết luận

SPEC-16 khoá phạm vi v1 của mạng xã hội nội bộ ở mức **19 bảng · 12 màn · 53 route · 14 cặp quyền · 22 mã lỗi · 9 sự kiện NOTI · 2 widget**, chia làm ba track thi công nối tiếp nhau qua 12 Work Order.

Hai điểm rủi ro cao nhất của module **không** nằm ở khối lượng mà ở hai chỗ RLS không đỡ được: **membership nhóm riêng tư** (§3.4) và **PII ngày sinh** (§3.5). Cả hai đều phải ép ở service, và cả hai đều có ca kiểm thử bắt buộc ở §21.
