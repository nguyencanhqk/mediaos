# Kế hoạch wave S16-SOCIAL — Mạng xã hội nội bộ (SPEC-16) theo benchmark MISA AMIS

> **Trạng thái: OWNER ĐÃ DUYỆT 02/09/2026** («ok tôi duyệt» — nguyên gói hồ sơ `S16-SOCIAL-WAVE-review.html`,
> 10/10 quyết định §3 chốt theo cột Đề xuất). Đã tạo khung SPEC-16 với §22 (SOC-DEC-001..010) và seed 12 WO §5
> vào `harness/backlog.mjs` cùng ngày. Bản đầy đủ SPEC-16/DB-17/API-19 là việc của `S16-SOCIAL-DOC-1`.
>
> Tham chiếu benchmark: 1 ảnh chụp **MISA AMIS Mạng xã hội** (`amisapp.misa.vn/newsfeed`) owner cung cấp 02/09/2026:
> bảng tin 3 cột · composer 5 loại bài · sinh nhật · nhóm · đã lưu · sáng kiến · bình chọn · tin nổi bật · vinh danh
> · trợ lý AI · widget doanh số. Benchmark là **mốc so sánh chức năng + bố cục**, KHÔNG sao chép nhận diện thương hiệu.

---

## 1. Điểm xuất phát — ĐO THẬT trên master `fd29c167` (02/09/2026)

| Thứ đã có | Số đo |
| --- | --- |
| Định nghĩa module | SPEC-01 §7 xếp `SOCIAL` = **Mạng xã hội nội bộ**, số **SPEC-16**, Phase 4; §12.13 liệt kê 9 chức năng (đăng bài · like · comment · gắn thẻ · hashtag · thông báo công ty · chúc mừng sinh nhật · vinh danh · khảo sát). UI-02/UI-04: «Ẩn mặc định hoặc Coming soon». IMPLEMENTATION-10 §22: `PARK-SOCIAL-001` Newsfeed nội bộ — «cần moderation/notification» |
| Hàng `modules` | mig 0435 seed `('SOCIAL','Mạng xã hội nội bộ','Extension', is_active=false)` |
| **Mã `SOCIAL` đã bị dùng cho việc KHÁC** | Wave S9 (DECISIONS-08) nhập `apps/fbpost` = app vệ tinh **đăng bài Facebook Page** dưới mã `SOCIAL`: 3 cặp quyền `view/create:social-post` + `manage:social-account` (mig 0544, KHÔNG cấp cho employee/manager/hr — SOCIAL-DEC-006, có verify RAISE nếu employee có grant `social`), audit `social_sso`/`social_account` (0545), tile «Đăng bài» trong `registry.ts` (`moduleCode:"SOCIAL"`, mở thẳng SSO), route FE `apps/app/src/routes/social/` chỉ có `SocialRedirectPage` + `open-social.ts`. Dịch vụ `MediaOS-Social` cổng 3500 đang LIVE PROD |
| Spec/DB/API | **Không có** SPEC-16 · DB-17 · API-19 · permission-matrix §9h · EPIC-21 · SOC-SCREEN-* · SOCIAL-API-* · SOCIAL-ERR-* |
| Nền tái dùng được | CHAT: bộ emoji cố định (`chat-reactions.emoji-set`) · khuôn `chat_message_reactions` composite tenant-FK · `chat_attachments` qua file-service + giới hạn `CHAT_MAX_ATTACHMENTS_PER_MESSAGE` · RealtimeEmitter + room `co:{companyId}:…` (`rooms.ts`) · presence. TASK: `task_comments` + mention theo `mentionEmployeeIds` (**nợ đã ghi: bảng `task_comment_mentions` chưa từng được tạo — mention không truy vấn lại được**). HR: `employees.date_of_birth` (PII, mask). FOUNDATION: `files` + `file_links(object_type CHECK)` · `user_preferences` · `recycle-bin` (soft-delete) · `system-jobs` (job + NOTI) · outbox NOTI + catalog CHECK ở HAI bảng. ORG: `org_units` · `teams` · `team_members`. DASH: khuôn widget có sàn scope. RECRUIT: `candidates` (chưa có nguồn «giới thiệu nội bộ»). `packages/ui`: avatar · badge · card · dialog · popover · sheet · tabs · empty-state · skeleton · data-table (chưa có: composer văn bản, lưới ảnh, thanh reaction, thẻ bình chọn) |
| Chưa có | Bảng nào cho bài đăng/bình luận/nhóm/bình chọn; tìm kiếm toàn văn (chưa bảng nào có `tsvector`); layout 3 cột kiểu cổng thông tin (UI-07 là khuôn module 2 cột) |

## 2. Bản đồ khoảng cách — màn MISA ↔ MediaOS hiện tại

| # | Năng lực MISA (đọc từ ảnh) | MediaOS hôm nay | Khoảng cách | Xếp |
| --- | --- | --- | --- | --- |
| G1 | **Bảng tin** 3 cột: composer «Bạn muốn chia sẻ điều gì?» · thẻ bài (tác giả · thời gian · biểu tượng phạm vi · nội dung · 👍 3 · 31 người xem · Thích/Bình luận/Chia sẻ) · lọc «Tất cả» + sắp xếp «Hoạt động mới» | — | Thiếu toàn bộ: bài đăng, thích, đếm lượt xem, sắp xếp theo hoạt động | **V1 — Track A** |
| G2 | **Tin tức** / **Tin nổi bật** (thông báo công ty, ghim) | NOTI = thông báo hệ thống theo sự kiện, không phải bản tin do HR viết | Thiếu bài loại «tin tức» có ghim + (tuỳ chọn) xác nhận đã đọc | **V1 — Track A** |
| G3 | **Bình luận**: mention @ · đính kèm · emoji · gửi | CHAT có emoji + đính kèm; TASK có mention (không lưu quan hệ) | Thiếu bình luận trên bài, 1 cấp trả lời, mention lưu THẬT | **V1 — Track A** |
| G4 | **Đã lưu** | — | Thiếu | V1 — Track A |
| G5 | **Trang cá nhân** (avatar · «Trang cá nhân») | ME có tổng quan/avatar | Thiếu «Bài viết của tôi» + trang bài của người khác | V1 — Track A |
| G6 | **Tìm kiếm tin tức, chia sẻ** | — | Thiếu tìm toàn văn phạm vi tenant | V1 — Track A |
| G7 | **Sinh nhật** («Hôm nay ▾ · Không có sinh nhật») | `employees.date_of_birth` bị mask ở HR | Thiếu widget chỉ lộ ngày+tháng, không cấp cặp HR | V1 — Track A |
| G8 | **Nhóm** + «Nhóm của tôi» (badge số bài mới) | `teams` là đơn vị tổ chức, không phải cộng đồng | Thiếu nhóm công khai/riêng tư, vai trò trong nhóm, bài theo nhóm | **V1 — Track B** |
| G9 | **Bình chọn** (composer «Bình chọn») | — | Thiếu poll 1/nhiều lựa chọn · ẩn danh · hạn đóng | **V1 — Track B** |
| G10 | **Sáng kiến** (composer «Sáng kiến») | — | Thiếu bài loại sáng kiến có trạng thái xét duyệt | V1 — Track B |
| G11 | **Tôn vinh nhân viên** (widget «1 tin Tôn vinh nhân viên») | — | Thiếu kudos gắn thẻ người được vinh danh + huy hiệu | V1 — Track B |
| G12 | **Ô liên kết nhanh** (Quy trình · Lịch họp · Công việc · Lập đơn · Đánh giá · Đặt phòng · Chạy quy trình) | APP_REGISTRY + `useCan` đã có | Thiếu dải ô trên bảng tin trỏ TASK · LEAVE · ATT · ROOM · GOAL · LMS theo quyền | V1 — Track C (rẻ) |
| G13 | **Kiểm duyệt** (ẩn bài, xử lý báo cáo) — ngầm trong MISA | — | Thiếu hàng đợi báo cáo + ẩn/ghim/khoá bình luận + audit | **V1 — Track C** |
| G14 | **Widget Nhân sự** (số liệu HR bên phải) | DASH có widget HR có sàn scope | Nhúng lại widget DASH theo quyền — không viết mới | V1 — Track C |
| G15 | **Thống kê tương tác** (ngầm — MISA có báo cáo truyền thông nội bộ) | — | Thiếu bài/bình luận/thích theo tuần & đơn vị | V1 — Track C |
| G16 | **Bố cục**: 3 cột (rail trái · feed giữa · rail phải widget) · thanh tìm kiếm trên topbar · composer có 5 nút loại bài | UI-07 = khuôn module 2 cột | Thiếu **template cổng thông tin 3 cột** dùng riêng cho SOCIAL (rút gọn về 1 cột trên mobile) | V1 — Track A (FE-1) |
| G17 | **Chia sẻ** (đăng lại bài) | — | v1 = sao chép liên kết; đăng lại có trích dẫn = Phase sau | ✖ PARK |
| G18 | **Giới thiệu ứng viên** | RECRUIT `candidates` do recruiter tạo | Cần đường Own «gửi giới thiệu» vào RECRUIT (nguồn REFERRAL) — việc của RECRUIT, không của SOCIAL | ✖ PARK-SOCIAL-002 |
| G19 | **Trợ lý AI** tổng hợp tin | — | Phase 5 AI | ✖ |
| G20 | **Top Agent hiệu quả · Bán hàng xuất sắc** | — | Doanh số/KPI — **ngoài phạm vi** (de-media-fy) | ✖ |
| G21 | Tin «Đặt phòng họp», «Lịch họp», «Quy trình», «Đánh giá» | ROOM có; quy trình/đánh giá không có module | Chỉ link ROOM; phần còn lại ✖ | ✖ |

## 3. Quyết định cần owner ký — SOC-DEC-001..010 (đề xuất ở cột Đề xuất)

| Mã | Câu hỏi | Đề xuất | Hệ quả nếu chọn khác |
| --- | --- | --- | --- |
| **SOC-DEC-001** | Đánh số & phạm vi tài liệu | Wave `S16-SOCIAL`; **SPEC-16** (số đã khoá ở SPEC-01 §7) · **DB-17** · **API-19** · permission-matrix **§9h** · IMPLEMENTATION-02 **EPIC-21 §8.22** · Sprint 16 · mã `SOC-SCREEN-001+` · `SOCIAL-API-001+` · `SOCIAL-ERR-001+` · `SOCIAL-WIDGET-001` · story `IMP02-STORY` **đo dải lúc chạy** (S15 đã giữ 191+) · SPEC-01 **§17.18** (trạng thái bài đăng) + **§17.19** (sáng kiến) + **§17.20** (bình chọn) · NOTI-EVENT **đo dải** (S15 giữ 024+; dự kiến 030+) · migration **nối tiếp head lúc merge** (S15-DB-1 đã ghi 0569+ — hai lane migration KHÔNG chạy song song) | Tách «FEED» thành module mới = trái SPEC-01 §7 và hàng `modules` 0435 |
| **SOC-DEC-002** | **Mã `SOCIAL` đang bị fbpost chiếm** | Mã `SOCIAL` = **mạng xã hội nội bộ** (đúng SPEC-01 + `modules`); fbpost trở thành **tiện ích con «Đăng bài Facebook» bên trong SOCIAL** — giữ nguyên 3 cặp `social-post`/`social-account`, dịch vụ 3500, SSO; chỉ đổi chỗ tile (từ ô riêng ở Home → mục cuối sidebar SOCIAL, vẫn gate bằng 3 cặp cũ). **Resource mới dùng tiền tố `feed-`** (`feed`, `feed-post`, `feed-comment`, `feed-news`, `feed-group`, `feed-poll`, `feed-idea`, `feed-kudos`, `feed-report`) — không đụng verify 0544 (đếm grant `social*` của employee), không migration đổi tên quyền trên PROD | Đổi tên 3 cặp fbpost = migration đổi quyền trên PROD đang chạy + sửa app vệ tinh; tạo module `FEED` = hai «mạng xã hội» trong catalog |
| **SOC-DEC-003** | Loại bài & phạm vi | **5 loại bài v1**: `share` (chia sẻ) · `news` (tin tức — có ghim, có «yêu cầu xác nhận đã đọc» tuỳ chọn) · `idea` (sáng kiến) · `poll` (bình chọn) · `kudos` (vinh danh). **Phạm vi** (`audience`): `company` · `group` · `org_unit`. **Hashtag** parse `#tag` → bảng tag + lọc. **KHÔNG có bài hệ thống tự sinh** (sinh nhật là widget + nút «Gửi lời chúc» tạo bài `share` gắn thẻ) | Tự sinh bài sinh nhật/nhập việc = feed đầy bài máy, người dùng tắt thông báo |
| **SOC-DEC-004** | **Ai được cấp mặc định** (khác SOCIAL-DEC-006 của fbpost) | **Employee được cấp mặc định**: `view:feed` (Company) · `create:feed-post` · `create:feed-comment` · `create:feed-poll` · `create:feed-idea` · `create:feed-kudos` · `create:feed-group`. **Tương tác cá nhân** (thích · bình chọn · lưu · đánh dấu đã xem · xác nhận đọc) **đi theo `view:feed` + quyền sở hữu hàng** (`user_id = actor`), ghi rõ ở SPEC-16 §11 — không đẻ verb mới ngoài DECISIONS-06. `manage:feed-news` · `manage:feed-post` · `manage:feed-group` · `approve:feed-idea` · `manage:feed-kudos` · `manage:feed-report` · `view:feed-report` cho **company-admin + hr** (manager: `view:feed-report` Department). Không cặp nào `is_sensitive` (không PII), nhưng mọi hành động `manage/approve` **ghi audit** | Không cấp đại trà = mạng xã hội không ai đăng được; cấp `manage` cho manager = kiểm duyệt phân tán khó truy |
| **SOC-DEC-005** | Kiểm duyệt & xoá | Chủ bài **tự sửa/xoá** bất kỳ lúc nào (nhãn «đã chỉnh sửa», sửa giữ lịch sử ở `edited_at`). `manage:feed-post`: **ẩn/hiện · ghim/bỏ ghim · khoá bình luận · xoá bài người khác** — mỗi hành động 1 dòng audit (`object_type` mới `feed_post`/`feed_comment`/`feed_group`/`feed_report` UNION-ADD). Người dùng **báo cáo** bài/bình luận (`feed_reports`: lý do · trạng thái `open → resolved/dismissed`). Xoá = **soft-delete** + thùng rác (BẤT BIẾN 2); ẩn ≠ xoá. Trạng thái bài §17.18: `published → hidden → published` · `→ deleted` | Hard-delete = phá BẤT BIẾN 2; không hàng đợi báo cáo = admin phải đọc hết feed |
| **SOC-DEC-006** | Mô hình nhóm | Nhóm `public` (ai cũng xem/tham gia) · `private` (xin vào, admin nhóm duyệt; bài chỉ thành viên thấy). **Vai trò trong nhóm là HÀNG** `feed_group_members.role ∈ {owner, admin, member}` (khuôn per-project role DECISIONS-04) — KHÔNG phải cặp quyền. Quyền xem bài nhóm riêng tư **ép ở service + ca IDOR** (RLS chỉ biết tenant, không biết membership); `manage:feed-group` cho company-admin để can thiệp nhóm bất kỳ | Nhóm = cặp quyền động = catalog quyền phình theo số nhóm |
| **SOC-DEC-007** | Sinh nhật & PII | Route `SOCIAL-API` riêng trả **CHỈ ngày + tháng** (`{employeeId, fullName, avatar, day, month}`) từ `employees.date_of_birth`, **không năm, không tuổi**, gate `view:feed` — **không cấp cặp HR**. Nhân viên **ẩn sinh nhật** qua `user_preferences.feed.showBirthday=false` (mặc định hiện). Widget «Hôm nay / Tuần này / Tháng này» | Lộ năm sinh = lộ PII qua cửa sau SOCIAL; không cho ẩn = vi phạm quyền riêng tư nhân viên |
| **SOC-DEC-008** | Đính kèm · mention · emoji · lượt xem | **Tái dùng** file-service: `file_links.object_type` UNION-ADD `feed_post` · `feed_comment`; giới hạn v1: **≤10 ảnh/bài, ≤1 video, ≤20MB/tệp** (mirror hằng CHAT), presign như CHAT. **Bộ emoji = bộ CHAT** (1 bảng `feed_reactions` cho cả bài và bình luận, UNIQUE per user/target). **Bảng `feed_mentions` THẬT** (không lặp nợ `task_comment_mentions`). **Lượt xem** = `feed_post_views` UNIQUE(post,user) ghi lần đầu (không đếm reload), số «N người xem» là COUNT thật | Emoji tự do = validate/normalize lại từ đầu; đếm xem theo request = số ảo |
| **SOC-DEC-009** | Sáng kiến · Bình chọn | **Sáng kiến** FSM §17.19: `submitted → under_review → accepted / rejected` (`approve:feed-idea`, ghi `reviewed_by/at/note`, NOTI cho tác giả), sổ vết ở audit. **Bình chọn** §17.20: `open → closed`; 2–10 lựa chọn · 1/nhiều phiếu · **ẩn danh tuỳ chọn** (vẫn lưu `user_id` để chống phiếu đôi, DTO không lộ) · hạn đóng (job đóng poll khuôn `system-jobs`, NOTI người tạo); đổi phiếu được khi còn mở | Không FSM sáng kiến = «Sáng kiến» chỉ là bài thường; ẩn danh không lưu user = vote vô hạn |
| **SOC-DEC-010** | Tìm kiếm · realtime · thống kê | **Tìm kiếm** PG `tsvector` cột sinh (`simple` + `unaccent` **nếu extension có — đo ở DB-1**, không thì ILIKE) phạm vi tenant, gate `view:feed`. **Realtime v1 tối giản**: phát `feed:post.created` · `feed:comment.created` · `feed:reaction.changed` vào room mới `co:{companyId}:feed` + `co:{companyId}:feedgroup:{groupId}` qua RealtimeEmitter, **payload = DTO đã mask** (cấm emit row); FE chỉ hiện badge «N bài mới» + cập nhật đếm. **Thống kê**: bài/bình luận/thích/thành viên hoạt động theo tuần & đơn vị — sàn scope Company cho admin/hr, manager Department, **KHÔNG cache**, XLSX | Realtime đầy đủ (feed tự chèn bài) = xáo cuộn, tốn WS; không tìm kiếm = feed chết sau 3 tháng |

**NGOÀI phạm vi v1 (ghi để không ai tự thêm):** đăng lại có trích dẫn (G17) · giới thiệu ứng viên (G18 → `PARK-SOCIAL-002`, cần đường Own vào RECRUIT) · trợ lý AI (G19) · doanh số/KPI (G20) · quy trình/lịch họp/đánh giá (G21) · khảo sát nhiều câu (form builder) · story/video ngắn · thông báo đẩy mobile · dịch tự động · sự kiện + RSVP · tích hợp fbpost (đăng chéo ra Facebook) → `PARK-SOCIAL-001` cập nhật.

## 4. Story cấp wave (SC-01..14 — bản đầy đủ viết ở EPIC-21 trong WO DOC)

| Story | Vai | Muốn | Track |
| --- | --- | --- | --- |
| SC-01 | Nhân viên | Đăng bài chia sẻ (văn bản · ảnh · video · hashtag · gắn thẻ) cho toàn công ty / đơn vị / nhóm; sửa, xoá bài của mình | A |
| SC-02 | Nhân viên | Thích (emoji), bình luận, trả lời 1 cấp, mention @, đính kèm; xem số người xem | A |
| SC-03 | Nhân viên | Lọc/sắp xếp bảng tin (tất cả · theo loại · hoạt động mới · mới đăng), tìm kiếm bài | A |
| SC-04 | Nhân viên | Lưu bài, xem lại «Đã lưu»; xem «Bài viết của tôi» và trang bài của đồng nghiệp | A |
| SC-05 | HR / Admin | Đăng **tin tức** công ty, ghim «Tin nổi bật», yêu cầu xác nhận đã đọc và xem ai đã đọc | A |
| SC-06 | Nhân viên | Thấy sinh nhật hôm nay/tuần này (ngày+tháng) và gửi lời chúc; ẩn sinh nhật của mình | A |
| SC-07 | Nhân viên | Tạo/tham gia nhóm công khai, xin vào nhóm riêng tư; admin nhóm duyệt thành viên, đăng bài trong nhóm | B |
| SC-08 | Nhân viên | Tạo bình chọn (1/nhiều lựa chọn · ẩn danh · hạn), bỏ phiếu, xem kết quả; tự đóng khi hết hạn | B |
| SC-09 | Nhân viên / Admin | Gửi sáng kiến; admin/HR xét duyệt (đang xem xét · chấp nhận · từ chối) kèm ghi chú; tác giả nhận thông báo | B |
| SC-10 | Nhân viên / HR | Gửi lời vinh danh đồng nghiệp kèm huy hiệu; HR quản lý catalog huy hiệu và ghim vinh danh chính thức | B |
| SC-11 | Hệ thống | Thông báo NOTI: mention · bình luận vào bài của tôi · trả lời · tin tức mới · sáng kiến đổi trạng thái · vinh danh · nhóm duyệt · bình chọn đóng · bài bị báo cáo | B |
| SC-12 | Admin / HR | Hàng đợi báo cáo: ẩn/hiện · khoá bình luận · xoá bài · xử lý báo cáo — mọi thao tác có audit | C |
| SC-13 | Admin / HR / Manager | Thống kê tương tác theo tuần & đơn vị, xuất XLSX; widget DASH «tương tác tuần» | C |
| SC-14 | Nhân viên | Dải ô liên kết nhanh (Công việc · Nghỉ phép · Chấm công · Đặt phòng · Mục tiêu · Đào tạo · Đăng bài Facebook) hiện theo quyền | C |

## 5. Phân rã Work Order (12 WO — SEED SAU KHI DUYỆT)

```text
duyệt ✅ → S16-SOCIAL-DOC-1 🟢* → S16-SOCIAL-DB-1 🔴 ─┬─ Track A: BE-1 🔴 → FE-1 🟡
                                                    ├─ Track B: DB-2 🔴 (sau DB-1) → BE-2 🔴 → FE-2 🟡
                                                    └─ Track C: BE-3 🟡 (sau BE-2) → FE-3 🟡
                            S16-SOCIAL-FBPOST-1 🟢 (sau DOC-1, song song)          └→ QA-1 🟡 → DASH-1 🟢
```

| WO | Zone | Nội dung | depends_on |
| --- | --- | --- | --- |
| `S16-SOCIAL-DOC-1` | 🟢* | SPEC-16 (§5 phạm vi v1 + PARK · §8 bảng · §9 SOC-SCREEN-001..010 · §11 13 cặp `feed-*` + luật «tương tác đi theo view:feed» · §12 SOCIAL-ERR-001+ · §13 FSM bài/sáng kiến/bình chọn · §17 NOTI-EVENT đo dải · §22 SOC-DEC-001..010) · DB-17 (15 bảng) · API-19 (~45 route) · §9h · SPEC-01 §17.18–17.20 + §12.13 + §7 ghi chú fbpost là tiện ích con · DECISIONS-08 §7 bổ sung SOC-DEC-002 · EPIC-21 §8.22 SC-01..14 · UI-07 thêm **template cổng thông tin 3 cột** · README §8/§9 · erd-current · RELEASE-14 PARK-SOCIAL-001/002 · `stories.mjs`/dashboard MODULE_SPEC · plan-reviewer PASS (tối đa 2 vòng). *(*xanh nhưng chi phí vùng đỏ)* | — |
| `S16-SOCIAL-DB-1` | 🔴 | mig nối tiếp head: `feed_posts` (type · audience · status · pinned · comments_locked · counters · `search_vector`) · `feed_comments` · `feed_reactions` · `feed_mentions` · `feed_post_tags` + `feed_tags` · `feed_saved_posts` · `feed_post_views` · `feed_post_acks` · `feed_reports`; RLS+FORCE TRƯỚC dữ liệu; composite tenant-FK; `file_links.object_type` + `audit_logs.object_types` UNION-ADD; seed 13 cặp `feed-*` + grant §9h (employee được cấp — KHÔNG đụng 3 cặp `social-*`); đo `unaccent`; contracts Zod mirror CHECK hai chiều | DOC-1 |
| `S16-SOCIAL-BE-1` | 🔴 | Module `apps/api/src/social/` (mới — fbpost ở `integrations/social/` giữ nguyên): bài + tin tức (ghim · ack) · bình luận 1 cấp · reaction (bộ emoji CHAT) · mention (`feed_mentions` + NOTI) · hashtag · lưu · lượt xem · báo cáo · tìm kiếm · sinh nhật (ngày+tháng, tôn trọng preference) · guard 2 tầng + audience check (org_unit) · audit manage · `@Idempotent` · RealtimeEmitter room `feed` payload DTO; deny-path RED trước (xem bài `hidden`/`deleted` của người khác · sửa bài người khác · ack giả) | DB-1 |
| `S16-SOCIAL-FE-1` | 🟡 | **Template cổng thông tin 3 cột** (`apps/app/src/layouts/portal/`, rút 1 cột < 1024px) · SOC-SCREEN-001 Bảng tin (composer 5 nút · thẻ bài · lọc/sắp xếp · badge bài mới) · 002 Chi tiết bài · 003 Tin tức (+ xác nhận đọc + danh sách đã đọc) · 004 Đã lưu · 005 Trang cá nhân (Bài viết của tôi/của X) · rail phải: Sinh nhật · Tin nổi bật · thanh tìm kiếm topbar; ME sidebar thêm «Bài viết của tôi» · «Đã lưu»; **bật `modules.is_active` SOCIAL** (khuôn 0567 — guard forward-compat); MODULE_APP_METADATA SOCIAL (phối hợp `S14-FND-MODULEMETA-1`) | BE-1 |
| `S16-SOCIAL-DB-2` | 🔴 | mig: `feed_groups` · `feed_group_members` (role hàng) · `feed_polls` · `feed_poll_options` · `feed_poll_votes` · `feed_ideas` (FSM + vết duyệt) · `feed_kudos` · `feed_kudos_recipients` · `feed_kudos_badges` (seed catalog) · NOTI-EVENT mới (~9) ở CẢ HAI bảng catalog + template; cặp `manage:feed-group` · `approve:feed-idea` · `manage:feed-kudos` (nếu chưa ở DB-1) | DB-1 |
| `S16-SOCIAL-BE-2` | 🔴 | Nhóm (tạo · xin vào · duyệt · vai trò hàng · bài trong nhóm — **membership check ở service**) · bình chọn (bỏ/đổi phiếu · ẩn danh · job đóng theo hạn) · sáng kiến FSM `assertIdeaTransition` · kudos + huy hiệu · outbox NOTI 9 sự kiện · room `feedgroup:{id}`; deny-path RED: đọc bài nhóm riêng tư khi không là thành viên · vote poll đã đóng · duyệt sáng kiến không có cặp | DB-2, BE-1 |
| `S16-SOCIAL-FE-2` | 🟡 | SOC-SCREEN-006 Nhóm (danh sách · trang nhóm · thành viên · xin vào/duyệt) · 007 Bình chọn (thẻ poll trong feed + trang danh sách) · 008 Sáng kiến (danh sách + xét duyệt) · 009 Vinh danh (thẻ kudos + huy hiệu); rail phải: Bình chọn đang mở · Vinh danh tháng này · Nhóm của tôi (badge) | BE-2, FE-1 |
| `S16-SOCIAL-BE-3` | 🟡 | Kiểm duyệt: hàng đợi báo cáo (resolve/dismiss) · ẩn/ghim/khoá/xoá người khác (audit) · thống kê tương tác (SQL set-based · tuần/đơn vị · sàn scope · XLSX · không cache) · catalog huy hiệu CRUD · dữ liệu widget DASH | BE-2 |
| `S16-SOCIAL-FE-3` | 🟡 | SOC-SCREEN-010 Kiểm duyệt (báo cáo + bài ẩn) · 011 Thống kê · 012 Thiết lập (huy hiệu) · dải ô liên kết nhanh theo `useCan` · nhúng widget DASH «Nhân sự» vào rail phải theo quyền | BE-3, FE-2 |
| `S16-SOCIAL-FBPOST-1` | 🟢 | Chuyển tile «Đăng bài» (fbpost) từ ô Home riêng → mục cuối sidebar SOCIAL «Đăng bài Facebook» (gate 3 cặp cũ, mở SSO như cũ) · i18n nav · registry `moduleCode:"SOCIAL"` giữ · KHÔNG đụng `apps/fbpost` hay quyền; test AppSwitcher/registry giữ số ca | DOC-1 |
| `S16-SOCIAL-QA-1` | 🟡 | Ma trận per-pair TỪNG route (employee · manager · hr · company-admin · payroll-officer/recruiter không có gì thêm) · IDOR: bài nhóm riêng tư · bài `hidden` · sửa/xoá bài người khác · ack giả · vote đôi · poll đã đóng · kết quả ẩn danh không lộ user · sinh nhật không lộ năm · cross-tenant 2 công ty · fuzz mention/hashtag/emoji · race counters · WS payload = DTO (không có cột thừa) · coverage `social/` ≥85% trên LANE_DB | FE-3 |
| `S16-SOCIAL-DASH-1` | 🟢 | Widget DASH «Tương tác tuần» (bài · bình luận · thích · thành viên hoạt động) + «Tin tức chưa đọc» (Own) — catalog BE + sàn scope 2 tầng + slug FE Grid + `useCanExact`, đăng ký `SOCIAL-WIDGET-001/002` | QA-1 |

- **Track A ‖ FBPOST-1 song song sau DOC-1**; Track B sau DB-2 (lane migration duy nhất — nối tiếp DB-1 **và** không chạy cùng lúc với `S15-PAYROLL-DB-1/DB-2`). Vẫn **1 WO/phiên**.
- Crown routing: DB-1/DB-2/BE-1/BE-2 = 🔴 FULL gate + Opus (permission seed · RLS · audit · FSM · membership); FE/BE-3/QA = 🟡; DOC/FBPOST/DASH = 🟢.
- **Ước chi phí:** 4 WO đỏ × ~$136 + 6 vàng × ~$60 + 2 xanh × ~$30 ≈ **$950–1 150** (`red-zone-wo-cost-profile`).
- **Nếu `S15-UI-SHELL-1` đã merge trước FE-1**: dùng sidebar nhóm gập + StatusPill; nếu chưa, FE-1 **không chờ** (SOCIAL dùng template cổng thông tin riêng, không phụ thuộc DataTable).

## 6. UI dự kiến (wireframe ở hồ sơ HTML §05)

**Template cổng thông tin 3 cột** (chỉ SOCIAL dùng, ghi vào UI-07 như biến thể): rail trái **240px** (thẻ danh tính: avatar · tên · «Trang cá nhân» → mục: Bảng tin · Tin tức · Sáng kiến · Bình chọn · Nhóm · Đã lưu → «Nhóm của tôi» + → «Đăng bài Facebook» khi có quyền) · **feed giữa max 680px** (dải ô liên kết nhanh → composer «Bạn muốn chia sẻ điều gì?» + 5 nút Chia sẻ · Tin tức (chỉ khi có `manage:feed-news`) · Sáng kiến · Bình chọn · Vinh danh → thanh Sinh nhật «Hôm nay ▾» → lọc «Tất cả ▾» · sắp xếp «Hoạt động mới ⇅» → thẻ bài) · rail phải **300px** (Tin nổi bật · Bình chọn đang mở · Vinh danh tháng này · widget DASH Nhân sự theo quyền). Dưới 1024px: rail trái thành thanh tab ngang, rail phải gập xuống cuối.
**Thẻ bài**: avatar · tên · «1 tuần trước» · biểu tượng phạm vi (🏢 công ty / 👥 nhóm / 🏷 đơn vị) · ⋯ (sửa · xoá · lưu · báo cáo · [ghim · ẩn · khoá bình luận] theo quyền) · nội dung (xem thêm > 6 dòng) · lưới ảnh 1–10 · khối poll/idea/kudos theo loại · hàng đếm «👍 3 · 31 người xem» · Thích/Bình luận/Sao chép liên kết · ô bình luận (mention · đính kèm · emoji · gửi). Mọi thời gian theo múi giờ công ty (server trả ISO, FE format `date-fns`).

## 7. Rủi ro & bẫy đã biết (viết sẵn vào done_when)

1. **Mã `SOCIAL` hai nghĩa** (SOC-DEC-002): mọi doc/registry phải nói rõ «SOCIAL = mạng xã hội nội bộ, trong đó có tiện ích Đăng bài Facebook»; 0544 verify đếm grant `social*` của employee — resource mới **bắt buộc** tiền tố `feed-`, có ca test ghim.
2. **Bật `modules.is_active` SOCIAL** ở FE-1: khuôn 0567; guard migration **không assert trạng thái module khác** (`wiring-spec-must-not-pin-other-modules-state`); nhớ `module-enable-guard-blocks-next-wo`.
3. **Membership nhóm riêng tư không ép được bằng RLS** — service phải lọc + ca IDOR bắt buộc; listing feed phải LEFT JOIN membership trong SQL, không lọc ở JS (`clamp-must-be-sql-not-js`).
4. **Counters denormalized** (like/comment/view): cập nhật trong cùng tx với hàng gốc, có ca race (2 like đồng thời), có script đối soát `COUNT` ↔ counter cho QA.
5. **PII sinh nhật**: DTO chỉ `day/month`; ca test grep response không có `date_of_birth`/năm; preference ẩn phải được tôn trọng cả ở tìm kiếm/tag.
6. **Bình chọn ẩn danh**: `feed_poll_votes.user_id` lưu nhưng DTO kết quả không có; ca test route kết quả với poll ẩn danh không lộ `user_id` kể cả cho admin.
7. **NOTI catalog CHECK ở HAI bảng** (`noti-catalog-check-lives-on-two-tables`) + dải NOTI-EVENT **đo lại** trước khi ghi (S15 đang giữ 024+).
8. **file_links object_type / audit object_types = hot-file UNION-ADD** (`audit-check-union-parse-anchor-trap`), không rewrite.
9. **Mention**: không lặp nợ TASK — bảng thật, FK composite tenant, NOTI qua outbox; mention người ngoài audience (bài nhóm riêng tư) → chặn hoặc bỏ qua có mã lỗi riêng, không rò bài.
10. **WS payload = DTO** (`ws-payload-narrower-than-rest-dto`), room `co:{c}:feed` cần join có gate `view:feed` (`ws-permission-gate-needs-its-own-room`).
11. **`unaccent`** có thể không có trên PROD Postgres — DB-1 đo `pg_extension`, migration KHÔNG `CREATE EXTENSION` mù (cần superuser); fallback ILIKE ghi vào DB-17.
12. **Soft-delete + thùng rác**: bài xoá phải biến khỏi feed, đếm, tìm kiếm, tag, saved trong cùng tx; khôi phục từ recycle-bin trả lại đủ.
13. **Two migration lanes** (S15 và S16) cùng «nối tiếp head»: seed WO phải ghi rõ **không chạy DB-1 hai wave trong cùng ngày**; số migration chốt lúc merge.
14. Nhân bản WO đỏ: tối đa **1 vòng plan-review** (`plan-review-rounds-inject-new-holes`).

## 8. Definition of Done cấp wave

- Bộ tài liệu SPEC-16 · DB-17 · API-19 · §9h · SPEC-01 §17.18–17.20 · DECISIONS-08 bổ sung · EPIC-21 · UI-07 biến thể 3 cột · README · erd-current · RELEASE-14 đồng bộ; plan-reviewer PASS.
- DB: 15 bảng mới RLS+FORCE, composite tenant-FK, CHECK mirror contracts; seed 13 cặp + grant employee; NOTI ~9 sự kiện ở hai bảng.
- BE: `apps/api/src/social/` ~45 route guard 2 tầng + audience/membership check + audit manage + `@Idempotent` + WS payload DTO; FSM sáng kiến/bình chọn; tìm kiếm; sinh nhật không lộ năm.
- FE: template cổng thông tin 3 cột + 12 màn SOC-SCREEN-001..012; ME thêm 2 mục; tile fbpost gộp vào SOCIAL; module SOCIAL bật.
- QA ≥85% `social/` trên LANE_DB; `docs/TESTABLE-FEATURES.md` cập nhật; 12 WO đóng dấu; widget DASH đăng ký.
