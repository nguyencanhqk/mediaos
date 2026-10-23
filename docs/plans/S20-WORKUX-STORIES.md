# S20-WORKUX — User story hoàn thiện & tối ưu Tin nhắn · Công việc · Mục tiêu

> **OWNER ĐÃ DUYỆT 23/10/2026 12:29 qua trang duyệt — 83 story, Q1–Q26 theo khuyến nghị.** Bổ sung cùng ngày §5.5 (liên kết tự động Việc ↔ Mục tiêu, 6 story): owner chốt hướng 1+2 trong chat ⇒ US-GOAL-NV-92, US-GOAL-NV-93, US-GOAL-QL-94 duyệt; US-GOAL-QL-93, US-X-94 chờ duyệt; US-GOAL-QL-95 hoãn; Q27–Q31 chờ trả lời. Tài liệu chỉ đề xuất, không đổi mã. Số thao tác và dẫn chứng `file:dòng` đo trên master `7c77dbce` (23/10/2026). Trạng thái WO trong `harness/backlog.mjs` đã đối chiếu với mã và git log (xem §8.3).

## 1. Mục đích, phạm vi, cách đọc

**Mục đích.** Hoàn thiện và tối ưu ba mục **Tin nhắn (CHAT, SPEC-15)**, **Công việc (TASK, SPEC-06)** và **Mục tiêu (GOAL, SPEC-10)**, cùng các đường nối giữa chúng với vỏ ứng dụng (thông báo, dashboard, /me, Ctrl+K). Mỗi story viết từ góc nhìn nhân viên hoặc quản lý. Đích chung là **ít thao tác nhất, ít chuyển trang nhất**, không đánh đổi bất biến nào.

**Trong phạm vi.** FE `apps/app`, BE `apps/api` của ba module, `packages/contracts|ui|web-core`. Chỉ đụng NOTI, DASH, ME, LEAVE, ATT ở chỗ nối.

**Ngoài phạm vi.** AI/agent (Phase 5), nội dung media/kênh, «mã hoá đầu-cuối», module mới hoàn toàn. Không viết lại phần đã ship ở S8-CHAT-UX, S17-CHAT-UX2. Không trùng việc đang làm: `S16-SOCIAL-FILEOPENUX-1` (mở tệp). `S17-CHAT-RTROOMOPS-1` và `S4-DASH-HROVERVIEW-FLOOR-1` đã merge hôm nay (#601, #599).

**Quyết định đã chốt, không story nào đi ngược.** DECISIONS-03 (cột pipeline tách khỏi FSM; theo D-18, Done được mở lại về Todo/In Progress/In Review/Cancelled), DECISIONS-04 (vai trò theo dự án), DECISIONS-05 (subtask + đếm lá), DECISIONS-07, CHAT-DEC-0xx. Story nào cần đổi một quyết định thì ghi rõ và đưa vào §7.

### Persona

| Mã | Vai | Bối cảnh | Cần gì |
| --- | --- | --- | --- |
| **NV** | Nhân viên, chuyên viên một phòng ban | 10–20 việc mở; 4–8 phòng chat; 2–3 mục tiêu/quý; laptop là chính, web di động khi đi lại | Biết ngay hôm nay làm gì; cập nhật trong 1–2 chạm; không lỡ tin/việc được giao; tìm lại nhanh |
| **QL** | Trưởng nhóm/trưởng phòng 6–15 người, quản 2–5 dự án, đồng thời là người làm | Đặt và phân rã mục tiêu phòng theo quý | Tình hình cả đội trên một màn; giao/điều phối/duyệt nhanh, kể cả hàng loạt; thấy trễ hạn và rủi ro sớm; ít phải hỏi «xong chưa?» |

### Cách đếm thao tác

1 thao tác = 1 click/chạm · 1 phím tắt · 1 lần mở dropdown · 1 lần chọn mục · 1 lần bấm gửi/lưu · 1 lần chuyển trang. Mỗi trường phải gõ tự do tính 1 thao tác «nhập». Rê chuột không tính. **Chuyển trang** đếm riêng. Mỗi luồng ghi rõ điểm xuất phát. Khi «trước» và «sau» xuất phát khác nhau, story ghi lại điểm xuất phát chung.

### Cách đọc zone (theo `harness/policy.md`)

| Zone | Nghĩa | Gate |
| --- | --- | --- |
| 🟢 green | FE/CRUD/list/form/UI/docs | LIGHT |
| 🟡 yellow | Luồng task/noti/phê duyệt, không đổi quyền hay schema | LIGHT + reviewer theo domain |
| 🟠 amber | FE/BE chạm sát vùng đỏ (DTO lộ thêm trường, truy vấn tổng hợp theo data-scope) | thêm security-reviewer |
| 🔴 red | Permission/RLS · secret · audit · auth · migration/schema (mọi đổi DB) · FSM phê duyệt · ADR · cặp quyền mới | FULL gate, deny-path RED trước, plan riêng |

**Quy ước id.** Giữ nguyên id của vòng soạn và phản biện. Story nhận story khác ghi «Gộp từ …». Id dạng `-9x` là story **bổ sung khi tổng hợp**, viết từ cơ hội phản biện chỉ ra và đã tự kiểm mã. Tổng cộng **83 story** (CHAT 17 · TASK 28 · GOAL 24 · Liên module 14) sau 25 lần gộp, cộng **6 story §5.5** bổ sung theo câu hỏi owner (GOAL 5 · Liên module 1) ⇒ **89 story**. Trong đó có 4 story ghi «bổ sung khi kiểm độ phủ» (US-X-92, US-X-93, US-TASK-NV-93, US-TASK-QL-92), thêm sau lượt soát độ phủ 23/10.

---

## 2. Hiện trạng đo

### 2.1 Tin nhắn — CHAT

- **Mức hoàn thiện:** cao ở tầng nền và khung chat (S7 lõi + gọi 1-1, S8-UX, S17-UX2). Mọi endpoint BE đều có FE gọi.
- **Chết hoặc thiếu ở FE:** deep-link `/chat/:roomId` (đích của thông báo CHAT); «đánh dấu đã đọc»/«đọc hết» (BE `/rooms/:id/read` đã có); vạch tin chưa đọc; dấu @; giữ nháp; báo tin khi ở trang khác; lối vào chat từ module khác; tạo việc từ tin; @cả phòng; phím tắt điều hướng phòng.
- **Ma sát lớn nhất:** (1) bấm thông báo chat ra trang 404; (2) NV không mở được tin nhắn riêng với người chưa từng nhắn, vì picker đi qua danh bạ HR theo `read:employee@Own`; (3) không bắt kịp tin chưa đọc; (4) chưa có nối CHAT ↔ TASK.
- **Ghi chú PROD:** gửi ảnh/tệp còn hỏng với người ở máy khác cho tới khi xong `S19-OPS-STORAGEPUBLIC-1`.

### 2.2 Công việc — TASK

- **Mức hoàn thiện:** việc cá nhân có lõi đủ (sửa tại chỗ trong chi tiết, checklist, việc con, bình luận @, tệp, theo dõi). Dự án đạt khoảng 70% so với SPEC-06 (workspace 7 tab, pipeline kéo-thả, vai trò dự án).
- **Chết ở FE:** `search` và `departmentId` của GET /tasks; `isRequiredForDone`; tạo checklist kèm `items[]`; `warnings[]` khi giao; lọc `dueFrom/dueTo`; `ownerEmployeeId` của GET /projects.
- **Lỗi BE người dùng không thấy:** job nhắc `TASK_DUE_SOON/OVERDUE` đọc cột legacy nên **không bao giờ nhắc** việc SPEC-06. Tạo việc, hoặc đổi người qua form Sửa, **không phát thông báo giao việc**.
- **Ma sát lớn nhất:** «Việc của tôi» không trả lời được câu «hôm nay làm gì». Mọi danh sách mở chi tiết bằng chuyển trang, và nút Quay lại luôn về `/tasks`. Không có thao tác hàng loạt. QL không có màn tổng hợp đội xuyên dự án. «Chờ duyệt» chỉ là một cột.

### 2.3 Mục tiêu — GOAL

- **Mức hoàn thiện:** BE đủ (CRUD 3 cấp, cây, đo 4 chế độ, check-in chỉ-thêm, chốt kỳ, gắn việc, phân rã mẫu, `/me/goals`, thông báo). Mọi hàm `goalApi` đều có chỗ gọi ở FE.
- **Chết hoặc thiếu ở FE:** lọc `employeeId/projectId`; người check-in (`actorUserId`) không hiển thị; At Risk dẫn xuất; gợi ý Completed khi đạt 100%; tab Mục tiêu trong dự án. Sổ ghi `S7-GOAL-PROJTAB-1` là done nhưng **mã không có**.
- **Ma sát lớn nhất:** mục tiêu mới mặc định Draft nên check-in bị khoá và mục tiêu không hiện ở /me. QL không thấy «của ai, chậm không, cập nhật khi nào» trên một màn. Không có thao tác hàng loạt. Bên Công việc gần như không thấy mục tiêu. Form không nhận prefill.

### 2.4 Vỏ ứng dụng & liên module

- **Đã có:** ChatBadge kèm drawer chat ở mọi trang, chuông kèm deep-link an toàn, Ctrl+K, /me, /dashboard, liên kết Task ↔ Goal.
- **Thiếu:** màn «Hôm nay» làm được việc ngay; hàng widget không bấm được; 4/7 quick action trỏ sai route; 9 widget có BE nhưng thiếu component (bị bỏ qua lặng lẽ); `notification:new` có BE nhưng FE không nghe (chuông poll 30 giây); không có tạo nhanh toàn cục; Ctrl+K chỉ tìm tên ứng dụng; link nội bộ trong chat mở tab mới; **app chưa có hệ toast** (`configureToast` của web-core chưa được gọi nên `showApiErrorToast` rơi về `console.error`).

### 2.5 Bảng luồng chính (đo hiện tại)

| Vai | Việc | Xuất phát | Thao tác | Chuyển trang |
| --- | --- | --- | --- | --- |
| NV | Trả lời tin từ thông báo | /tasks | 6 | 2 |
| NV | Nhắn riêng đồng nghiệp chưa từng nhắn | / | 8 (NV thường: ngõ cụt) | 1 |
| NV | Chat nhanh trong drawer rồi mở rộng | /tasks | 6 | 1 |
| NV | Tạo nhóm 4 người | /chat | 14 | 0 |
| NV | Đọc hết 6 phòng sau họp | /chat | 7 | 0 |
| NV | Tìm lại tin/tệp cũ | /chat | 4 | 0 |
| QL | Thông báo cả phòng ban, ghim, xem ai đã đọc | /chat | 6 (không biết ai chưa đọc) | 0 |
| QL | Bắt kịp 5 nhóm dự án | /chat | 10 | 0 |
| QL | Giao việc từ một tin nhắn | /chat | 15 | 2 |
| NV | Sáng biết hôm nay làm gì | / | 3 + tự dò ngày | 2 |
| NV | Tạo việc cho mình có hạn | /tasks/my-tasks | 9 | 2 |
| NV | Đổi trạng thái Đang làm → Hoàn thành | /tasks/my-tasks | 7 | 3 |
| NV | Thêm 3 checklist + 3 việc con | /tasks/:id | 20 | 0 |
| NV | Nhận việc được giao (qua form Tạo/Sửa) | bất kỳ | 3 (không có thông báo) | 2 |
| QL | Giao việc mới rồi tự báo NV | /tasks | 15 | 0 |
| QL | Chuyển 6 việc của NV nghỉ phép | /tasks | 26 | 0 |
| QL | Xem ai quá tải ở 4 dự án | / | 16 | 4 |
| QL | Giao 5 việc cho 3 người trong dự án | board dự án | 36 | 0 |
| QL | Duyệt một việc Chờ kiểm tra | /tasks | 8 | 2 |
| QL | Báo cáo tiến độ 5 dự án của phòng | / | 19 | 7 |
| NV | Xem mục tiêu của tôi | / | 4 | 1 |
| NV | Tạo mục tiêu cá nhân quý | /goals | 14 | 2 |
| NV | Check-in tuần | /me | 3–4 | 0 |
| QL | Phân rã mục tiêu phòng cho 6 NV | /goals/{cha} | 102 | ≈18 |
| QL | Sinh 10 việc từ mẫu | /goals/{id} | 35 | 1 |
| QL | Xem tiến độ và rủi ro 8 mục tiêu NV | / | 25 | 17 |
| QL | Chốt kỳ 12 mục tiêu | /goals | 48 | 24 |
| NV | Mở việc từ thông báo rồi quay lại chỗ cũ | /goals/{id} | 5 (Back trình duyệt) / 8 (nút Quay lại) | 2 / 4 |
| NV | Tạo việc nhanh khi ở trang khác | /goals | 8 | 3 |
| QL | Xử lý mục chờ mình (đơn nghỉ + việc review) | /dashboard | 7 | 3 |

---

## 3. Nguyên tắc

### 3.1 Nguyên tắc UX

1. **Việc lặp hằng ngày tối đa 2 thao tác:** đổi trạng thái, dời hạn, check-in, đọc hết, trả lời thông báo.
2. **Không chuyển trang chỉ để sửa một trường hay xem một bản ghi.** Sửa ngay trên dòng; xem trong drawer (`?task=`, drawer chat); đóng lại là về đúng chỗ cũ, giữ bộ lọc và vị trí cuộn.
3. **Thông báo đưa thẳng tới chỗ xử lý:** đúng phòng, đúng việc, đúng đơn, hộp thoại check-in mở sẵn. Không có link chết; có test ràng mọi đích phải là route có thật.
4. **URL là trạng thái.** Bộ lọc, tab, bản ghi đang mở nằm trên URL (`validateSearch` không ném). F5, Back hay gửi link đều giữ nguyên góc nhìn.
5. **Mặc định thông minh từ dữ liệu hệ thống đã biết** (tôi là ai, quý nào, dự án của phòng, cha của mục tiêu). Luôn sửa được. Không tự quyết thay người dùng.
6. **Một lệnh cho N phần tử** khi QL phải lặp từ 3 lần trở lên (giao, dời hạn, kích hoạt, chốt kỳ). Báo kết quả theo từng dòng, dòng lỗi không làm hỏng dòng thành công.
7. **Đưa tín hiệu tới người dùng thay vì bắt họ đi tìm:** dấu @, vạch chưa đọc, «Trễ N ngày», «Cần check-in», cờ Chậm, toast realtime. Các tín hiệu này là dẫn xuất, không lưu.
8. **Ẩn thứ người dùng không làm được** thay vì cho bấm rồi báo lỗi. Khi server từ chối: rollback và nêu lý do dễ hiểu, không bao giờ im lặng.
9. **Bàn phím và cảm ứng là hạng nhất.** Phím tắt có phím bổ trợ và không phá thao tác soạn. Mọi kéo-thả có lối thay bằng menu. Thay đổi quan trọng được đọc qua `aria-live`.
10. **Mỗi việc chỉ một bề mặt, dùng chung một component:** một drawer việc, một picker hạn, một hệ toast, một hàm «Chậm». Không dựng hai màn trùng chức năng.

### 3.2 Nguyên tắc riêng tư/an ninh

1. **Che ở SERVER, trả tối thiểu trường.** Mọi đường đọc mới (danh bạ chat, `ownerName/actorName`, workload, `assigneeUserId`, Ctrl+K) chỉ trả tên hiển thị, ảnh ký ngắn hạn và phòng ban. FE không che bằng cách «ẩn cột».
2. **Không phân biệt «không tồn tại» với «không có quyền».** Mọi deep-link (`/chat/:roomId`, `?task=`, `?request=`, `?peek=`, `?msg=`) dùng một thông điệp chung và không gọi API chi tiết trước khi xác nhận quyền hoặc membership.
3. **Nội dung hội thoại không tự chảy ra ngoài phòng.** Thông báo, toast và audit mặc định không chứa thân tin. Tạo việc từ tin chỉ chép văn bản sau khi người dùng xác nhận, kèm cảnh báo phạm vi người đọc, không chép URL tệp đã ký.
4. **Dữ liệu nghiệp vụ không nằm trong storage trình duyệt.** Nháp chat và kết quả tìm kiếm chỉ ở bộ nhớ. `localStorage` chỉ giữ tuỳ chọn hiển thị (tab, thu gọn, «để sau»), luôn bọc try/catch.
5. **Ít thao tác không có nghĩa là ít kiểm quyền.** Thao tác hàng loạt gọi đúng route action chuyên trách và đúng cặp quyền cho từng phần tử, báo kết quả theo dòng, audit từng phần tử.
6. **Trạng thái đọc và tiến độ cá nhân là dữ liệu hành vi.** «Đã xem/Chưa xem» chỉ có trên tin của chính mình trong một phòng. Cờ Chậm và số tải việc chỉ trong phạm vi `view:goal`/`read:task`. Không làm bảng giám sát xuyên phòng hay xuyên thời gian, không xuất file.
7. **Không nới điểm kiểm soát để bớt click.** Không tự duyệt đơn, không tự Hoàn thành mục tiêu, không chốt kỳ khi chưa xem trước và xác nhận. Đổi tiêu chí chặn (checklist bắt buộc) phải để lại dấu vết.
8. **Realtime và job đi theo tenant.** Payload WS và thông báo đi qua cùng DTO/masking như REST. Job và khoá giới hạn (Valkey) mang `company_id`, chạy trong `withTenant`, có test cross-tenant với `LANE_DB`.

---

## 4. KPI thao tác trước → sau

| # | Luồng (vai · xuất phát) | Trước | Sau | Chuyển trang trước→sau | Story |
| --- | --- | --- | --- | --- | --- |
| 1 | NV trả lời tin từ thông báo · /tasks | 6 | 4 | 2→0 | US-CHAT-NV-01 |
| 2 | NV nhắn riêng đồng nghiệp chung phòng · /chat | 7 | 4 | 0→0 | US-CHAT-NV-02 |
| 3 | NV bắt kịp phòng có 25 tin mới · /chat | ~4 | 1 | 0→0 | US-CHAT-NV-04 |
| 4 | NV/QL đọc hết 6 phòng sau họp · /chat | 7 | 2 | 0→0 | US-CHAT-NV-05 |
| 5 | QL thông báo cả phòng ban 8 người · /chat | 18 | 4 | 0→0 | US-CHAT-QL-09 |
| 6 | QL giao việc từ một tin nhắn · /chat | 15 | 7 | 2→0 | US-CHAT-NV-10 |
| 7 | NV đổi trạng thái việc (Đang làm → Hoàn thành) · /tasks/my-tasks | 7 | 4 | 3→0 | US-TASK-NV-03 |
| 8 | NV tạo việc cho mình có hạn · /tasks/my-tasks | 9 | 3 | 2→0 | US-TASK-NV-05, US-TASK-NV-08 |
| 9 | NV mở việc từ thông báo rồi quay lại · /goals/{id} | 5–8 | 4 | 2–4→0 | US-TASK-NV-04 |
| 10 | QL giao việc mới và báo NV · /tasks | 15 | 10 | 0→0 | US-TASK-QL-01 |
| 11 | QL chuyển 6 việc của NV nghỉ phép · /tasks | 26 | 7 | 0→0 | US-TASK-QL-03 |
| 12 | QL xem ai quá tải ở 4 dự án · / | 16 | 2 | 4→1 | US-TASK-QL-04 |
| 13 | QL giao 5 việc cho 3 người trong dự án · board | 36 | 17 | 0→0 | US-TASK-QL-06 |
| 14 | QL duyệt hoặc trả lại một việc Chờ kiểm tra · /tasks | 8 | 1 (duyệt) / 3 (trả lại) | 2→0 | US-TASK-QL-08 |
| 15 | NV tạo mục tiêu cá nhân quý · /goals | 14 | 5 | 2→1 | US-GOAL-NV-01 |
| 16 | QL xem tiến độ 8 mục tiêu NV · / | 25 | 1 | 17→1 | US-GOAL-QL-01 |
| 17 | QL phát hiện mục tiêu rủi ro · / | 25 | 2 | 17→1 | US-GOAL-QL-02 |
| 18 | QL phân rã mục tiêu phòng cho 6 NV · /goals/{cha} | 102 | 42 (QL-04) → 14 (QL-05) | ≈18→6 → 0 | US-GOAL-QL-04, US-GOAL-QL-05 |
| 19 | QL chốt kỳ 12 mục tiêu · /goals | 48 | 6 | 24→0 | US-GOAL-QL-06 |
| 20 | NV tạo việc nhanh khi ở trang khác · /goals | 8 | 3 | 3→0 | US-X-05 |
| 21 | NV xem việc hôm nay và đóng một việc · /home | 5 + dò ngày | A: 2 · B: 4 (3 với `defaultLanding`) | 3→1 (B + `defaultLanding`: 0) | US-X-08 (chờ Q21) |
| 22 | NV đổi trạng thái việc trên điện thoại 375px · /tasks/my-tasks | 4 | 2 | 2→0 | US-X-93 |
| 23 | NV check-in mục tiêu trên điện thoại 375px · /goals | 5 + cuộn ngang | 3 | 2→0 | US-X-93, US-GOAL-NV-91 |
| 24 | NV dời hạn một việc rơi vào kỳ nghỉ · chi tiết đơn nghỉ của tôi | 7 + dò ngày | 2 | 3→0 | US-TASK-NV-93 |
| 25 | QL chuyển 6 việc của NV sắp nghỉ · hộp thoại duyệt đơn | 30 | 6 | 1→1 | US-TASK-QL-92 |
| 26 | NV tạo việc rồi gắn vào mục tiêu cá nhân · /tasks | 6 | 3 | — | US-GOAL-NV-92 |
| 27 | QL gắn 8 việc trong kỳ vào mục tiêu · /goals/{id} | 11 | 3 | 0→0 | US-GOAL-QL-94 |
| 28 | QL gắn 10 việc của dự án vào mục tiêu dự án · /goals/{id} | 2 (đổi cách đo) | 0 | 0→0 | US-GOAL-QL-93 |

**Cách kiểm KPI sau khi ship (DoD chung của S20).** Mỗi WO nhận một dòng KPI ở trên phải nộp **một lượt đếm trong trình duyệt thật**:

- Xuất phát đúng điểm ghi trong bảng, với API giả lập. Công thức: Vite dev server trỏ API tới cổng chết + `page.route` trả fixture đã `schema.parse` bằng contracts; quyền của người dùng giả đổi qua `capabilities` của `/auth/me`.
- Script đi đúng chuỗi click/phím của cột «Sau» và **tự đếm**: số lần click/chạm, phím tắt, chọn mục, gửi; số lần đổi `location.pathname` (tách khỏi thay đổi `?task=`/`?msg=`); không tính gõ ký tự trong một trường.
- Ghi kết quả («KPI #n: đo x thao tác, y chuyển trang, ngày, commit») vào sổ vết của plan WO và mô tả PR. Số đo lớn hơn cột «Sau» thì WO chưa xong, hoặc phải sửa bảng kèm lý do.
- Thêm một ca deny-path cho mỗi luồng: người dùng thiếu quyền tương ứng không thấy lối tắt (đếm = ngõ cụt có chủ ý, không phải lỗi).
- `apps/app` **chưa có** gói Playwright: chỉ `apps/lms/package.json` có `playwright`, và repo không có `playwright.config`. Hôm nay lượt đếm chạy bằng Playwright MCP của phiên và lưu script vào thư mục plan của WO. Đưa thành E2E chạy trong CI (thêm `@playwright/test` vào `apps/app`) là quyết định riêng: §7 Q25.

---

## 5. Story theo module

### 5.1 Tin nhắn — CHAT

| Id | Tiêu đề | Loại | Ưu tiên | Cỡ | Zone | Thao tác trước→sau |
| --- | --- | --- | --- | --- | --- | --- |
| **Nhân viên** | | | | | | |
| US-CHAT-NV-01 | Bấm thông báo chat vào thẳng đúng phòng (drawer tại chỗ / `/chat/:roomId`), ⤢ giữ phòng | hoàn thiện | P0 | S | 🟡 | 6→4 (2→0 chuyển trang) |
| US-CHAT-NV-02 | «Nhắn riêng» 1 chạm từ danh sách thành viên và avatar/tên người gửi | ux | P0 | S | 🟢 | 7→4 |
| US-CHAT-NV-03 | Danh bạ nhẹ cho chat: tìm được mọi đồng nghiệp để nhắn riêng | hoàn thiện | P1 | M | 🔴 | ngõ cụt (8)→5 |
| US-CHAT-NV-04 | Mở phòng tại tin chưa đọc đầu tiên, vạch «Tin chưa đọc», «↓ N tin mới» | ux | P0 | M | 🟢 | ~4→1 |
| US-CHAT-NV-05 | «Đánh dấu đã đọc» ở dòng phòng và «Đọc hết» trên chip Chưa đọc | hoàn thiện | P1 | S | 🟢 | 7→2 |
| US-CHAT-NV-06 | Giữ nháp theo từng phòng (chỉ trong bộ nhớ) | ux | P1 | S | 🟢 | 4→2 |
| US-CHAT-NV-07 | Dấu @ trên dòng phòng và chip «Nhắc tôi» | hoàn thiện | P1 | M | 🟡 | ~6→2 |
| US-CHAT-NV-08 | Thanh tin ghim ở đầu hội thoại (cập nhật realtime) | ux | P1 | S | 🟡 | 4 (<1280px) / 2 (≥1280px)→1 |
| US-CHAT-NV-09 | «(N)» trên tiêu đề tab + toast tin riêng/@nhắc tôi | ux | P1 | M | 🟢 | 4→3 |
| US-CHAT-NV-10 | Tạo việc từ một tin nhắn mà không rời phòng | hoàn thiện | P1 | M | 🟡 | 14→5 (NV) · 15→7 (QL) |
| US-CHAT-NV-11 | Nút «Thảo luận» ở dự án/việc mở phòng dự án trong drawer | ux | P1 | S | 🟢 | 4→1 |
| US-CHAT-NV-12 | Tạo nhóm nhanh: «Gần đây», ô tìm nhúng, tên gợi ý | ux | P2 | M | 🟢 | 14→7 (người trong «Gần đây»); người mới với NV thường: ngõ cụt tới NV-03 |
| US-CHAT-NV-13 | Phím tắt chuyển phòng và nhảy tới phòng chưa đọc kế tiếp | tối ưu | P2 | S | 🟢 | 2→1 mỗi phòng |
| US-CHAT-NV-91 | «Cuộc trò chuyện mới» ngay trong drawer *(bổ sung khi tổng hợp)* | ux | P2 | S | 🟢 | 8→5 (1→0 chuyển trang) khi người đó trong danh bạ tôi được xem; NV thường + đồng nghiệp mới: ngõ cụt tới NV-03 |
| **Quản lý** | | | | | | |
| US-CHAT-QL-03 | Xem ai CHƯA đọc tin của tôi (popover «Đã xem · Chưa xem») | hoàn thiện | P1 | S | 🟢 | ~6→2 |
| US-CHAT-QL-09 | @cả phòng cho người có tư cách ở phòng ban/dự án | hoàn thiện | P1 | M | 🔴 | 18→4 |
| US-CHAT-QL-12 | Lời nhắc «thành viên dẫn xuất» thành liên kết sang nơi quản lý thành viên | ux | P2 | S | 🟢 | 7→3 |

#### 5.1.1 CHAT — Nhân viên

##### US-CHAT-NV-01 · Bấm thông báo chat vào thẳng đúng phòng; ⤢ giữ phòng đang đọc
*Gộp từ: US-CHAT-QL-01, US-X-01.* · **P0 · S · 🟡 yellow** · Lớp FE · Phụ thuộc: — · Spec: SPEC-15 §9 CHAT-SCREEN-001, §17; SPEC-08 NOTI-API-003; CHAT-DEC-026

- **Story.** Là nhân viên (hoặc trưởng nhóm), tôi muốn bấm thông báo «Tin nhắn mới từ …» hay «… đã nhắc bạn» là vào ngay đúng phòng, ô soạn sẵn sàng, để trả lời trong vài giây thay vì gặp trang 404 rồi tự tìm lại phòng.
- **Cơ chế.**
  - (a) `NotificationTargetLink` nhận diện đích `/chat/<uuid>`. Đang ở trang khác `/chat*` thì gọi `chat-dock openRoom(id)` (store tự mở drawer), không điều hướng. Đang ở `/chat*` thì điều hướng `/chat/<id>`.
  - (b) Thêm route con `/chat/$roomId`, dùng chung `beforeLoad`/cặp quyền với `/chat`. `selectedRoomId` chuyển từ `useState` lên tham số URL; chọn phòng trong danh sách là `replace`.
  - (c) Nút ⤢ của drawer điều hướng tới `/chat/{phòng đang mở}`.
  - (d) Vào bằng deep-link thì focus vào ô soạn. Có thể nhận thêm `?msg=<id>`, dùng lại `jumpToMessage`.
  - Giữ nguyên template NOTI `/chat/{room_id}`, không đổi DB.
- **Luồng.** Trả lời tin từ thông báo, xuất phát ở /tasks.
  - **Trước: 6 thao tác, 2 chuyển trang.** Chuông → bấm thông báo (ra 404, `router.tsx:3028` chỉ có `CHAT_PATH`; trên trang 404 badge chat là span tĩnh `ChatBadge.tsx:62-73` và drawer không render `ChatDrawer.tsx:88`) → mở «Tin nhắn» (`ChatPage.tsx:63` `selectedRoomId=null`) → tìm, bấm phòng → gõ → Enter.
  - **Sau: 4 thao tác, 0 chuyển trang.** Chuông → bấm thông báo (drawer mở đúng phòng, ô soạn đã focus) → gõ → Enter.
  - Luồng ⤢: 6→5.
- **Tiêu chí chấp nhận.**
  1. Cho tôi là thành viên phòng R, đang ở /tasks. Khi bấm thông báo `CHAT_DIRECT_MESSAGE`/`CHAT_MENTIONED` của R, thì drawer mở hội thoại R tại chỗ, URL trang không đổi, ô soạn có focus, thông báo được đánh dấu đã đọc.
  2. Cho tôi đang ở /chat với phòng khác. Khi bấm thông báo của R, thì URL thành `/chat/R` (replace), khung giữa hiện R (kể cả bố cục 1 cột trên điện thoại), không có drawer chồng lên.
  3. Khi dán `/chat/R` vào thanh địa chỉ hoặc mở tab mới, thì /chat hiện với R chọn sẵn, không 404.
  4. Cho drawer đang mở R. Khi bấm ⤢, thì `/chat/R` mở đúng R và drawer đóng.
  5. Cho R không tồn tại, đã xoá mềm, đã lưu trữ, hoặc tôi không (còn) là thành viên. Khi mở bằng thông báo hay URL, thì hiện **cùng một** thông điệp «Không mở được cuộc trò chuyện này» kèm danh sách phòng bình thường. Không lộ tên phòng. Không gọi API tin, chi tiết hay pinned của R trước khi xác nhận R có trong danh sách phòng của tôi. Drawer không mở R.
  6. Cho `roomId` không phải UUID. Thì trang `replace` về /chat, không gọi API nào. Thông báo có đích `/chat/abc` thì điều hướng /chat như link thường, không gọi `openRoom`.
  7. Cho tài khoản không có cặp quyền xem CHAT. Thì `/chat/R` bị chặn bởi cùng `ProtectedRoute` meta. Bấm thông báo chat cũ hiện «Không có quyền truy cập Tin nhắn», không mở drawer.
  8. Cho tôi ở `/chat/A` và chọn phòng B. Khi bấm Back của trình duyệt, thì về trang trước khi vào /chat. Chọn phòng trong trang dùng `replace` (Back giữa các phòng là câu hỏi owner, §7 Q5).
  9. Ở bố cục 1 cột, bấm quay lại danh sách trong `ConversationHeader` thì URL về /chat (replace).
- **Zone.** FE trên luồng NOTI → CHAT, không đổi quyền hay schema, template NOTI đã đúng sẵn. Membership do server ép.
- **Dẫn chứng.** `apps/app/src/router.tsx:3026-3038,3516-3527`; `routes/chat/ChatPage.tsx:63,116,169-185`; `components/chat/drawer/ChatDrawerBody.tsx:106-115`; `components/notifications/NotificationTargetLink.tsx:43-52`; `components/chat/chat-dock.store.ts:65-75,96-121`; `apps/api/migrations/0538_s7chatdb1_chat_v1.sql:740,746`.
- **Ghi chú.** Là nền cho NV-02, NV-09, NV-10 (liên kết `?msg=`), NV-11, QL-09, QL-12, X-12.

##### US-CHAT-NV-02 · «Nhắn riêng» 1 chạm từ danh sách thành viên và avatar/tên người gửi
*Gộp từ: US-CHAT-QL-04.* · **P0 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-CHAT-NV-01 · Spec: SPEC-15 §5.1, CHAT-FUNC-001, CHAT-SCREEN-003

- **Story.** Là nhân viên, tôi muốn bấm avatar hoặc tên đồng nghiệp trong phòng nhóm (hoặc trong danh sách thành viên) rồi chọn «Nhắn riêng», để mở tin nhắn riêng ngay với người đang thấy, thay vì đi qua hộp chọn danh bạ (với NV thường hộp này chỉ trả về chính tôi).
- **Cơ chế.** Thêm mục «Nhắn riêng» trên mỗi hàng của `RoomMembersSheet`, và popover nhỏ khi bấm avatar/tên trong `MessageBubble` (chỉ với tin của người khác). Hành động gọi `chatApi.openDirect({ peerUserId })` bằng `userId` đã có trong roster, rồi chọn phòng trả về: trên /chat dùng deep-link, trong drawer dùng `openRoom`. Gate `useCan('create','chat-room')`. BE `openDirect` đã idempotent.
- **Luồng.** Xuất phát /chat, đang mở phòng nhóm có B.
  - **Trước: 7 thao tác.** «+» (`RoomListPanel.tsx:515-519`) → «Chọn người» (`CreateRoomDialog.tsx:98`) → gõ tên → chọn → Xác nhận (`EmployeeMultiPickerDialog.tsx:143,184`) → gõ → Enter. Với `read:employee@Own` thì danh sách chỉ có chính mình, nên đây là **ngõ cụt**.
  - **Sau: 4 thao tác.** Avatar/tên B → «Nhắn riêng» (DM mở, ô soạn focus) → gõ → Enter.
- **Tiêu chí chấp nhận.**
  1. Cho tôi và B cùng phòng, tôi có `create:chat-room`. Khi chọn «Nhắn riêng» trên tin của B, thì DM với B mở (dùng lại phòng cũ nếu có, không tạo trùng) và ô soạn có focus.
  2. Từ danh sách thành viên, kết quả như trên. Hàng và avatar của chính tôi không có mục này.
  3. Cho tôi không có `create:chat-room`. Thì không có «Nhắn riêng» (dùng `useCan`, không hard-code role).
  4. Cho B đã khoá/nghỉ và CHƯA có DM cũ. Thì server trả `USER_INVALID`, UI hiện lỗi dễ hiểu, không tạo phòng, nút không treo. Nếu đã có DM cũ thì mở lại phòng cũ như hành vi hiện có của server.
  5. Cho tôi đang dùng drawer trên /tasks. Thì DM mở ngay trong drawer, không chuyển trang.
  6. Tin đã thu hồi hoặc tin hệ thống thì avatar không có popover.
- **Zone.** FE dùng lại endpoint sẵn có. Không mở thêm danh bạ, không đổi quyền.
- **Dẫn chứng.** `components/chat/RoomMembersSheet.tsx:164,204,219`; `MessageBubble.tsx:230`; `apps/api/src/chat/chat-rooms.service.ts:275-291`; `apps/api/src/employees/hr-read.service.ts:93-99`; `docs/permission-matrix-spec.md:83,113`.

##### US-CHAT-NV-03 · Danh bạ nhẹ cho chat: tìm được mọi đồng nghiệp để nhắn riêng
**P1 · M · 🔴 red** · Lớp BE, FE, DOC · Phụ thuộc: — · Spec: SPEC-15 §5.1, CHAT-SCREEN-003, CHAT-FUNC-001 · **Cần owner quyết (§7 Q1)**

- **Story.** Là nhân viên, tôi muốn gõ tên một đồng nghiệp phòng khác (chưa từng chung phòng) trong «Tin nhắn mới» và thấy họ, để liên hệ trực tiếp mà không phải nhờ quản lý tạo nhóm hộ.
- **Cơ chế.** Endpoint riêng của CHAT (vd `GET /chat/directory?q=`) chỉ trả `userId`, tên hiển thị, ảnh đã ký ngắn hạn và tên phòng ban. Truy vấn tối thiểu 2 ký tự, tối đa 20 kết quả, không phân trang, chạy trong `withTenant`, có giới hạn tần suất. FE thay `EmployeeMultiPickerDialog` bằng ô tìm nhúng trong `CreateRoomDialog`; chọn 1 người ở tab «Riêng» là mở DM ngay.
- **Luồng.** Xuất phát /chat. **Trước: 8 thao tác** («+» → «Chọn người» → gõ → (NV thường: rỗng, ngõ cụt) chọn → Xác nhận → gõ → Enter). **Sau: 5 thao tác** («+» → gõ tên → chọn (DM mở) → gõ → Enter).
- **Tiêu chí chấp nhận.**
  1. Cho NV chỉ có `read:employee@Own`. Khi gõ ít nhất 2 ký tự tên một đồng nghiệp đang làm việc ở phòng khác cùng công ty, thì người đó hiện với tên, ảnh, phòng ban và tôi mở được DM.
  2. Payload chỉ có userId/tên/ảnh/phòng ban, không có email, SĐT, ngày sinh, lương hay trường HR nào khác.
  3. Người công ty khác, hoặc tài khoản đã khoá/nghỉ việc, không xuất hiện kể cả khi gõ đúng tên.
  4. Truy vấn rỗng hoặc 1 ký tự thì trả lỗi validate hoặc danh sách rỗng, không liệt kê cả công ty.
  5. Không có kết quả thì hiện «Không tìm thấy đồng nghiệp».
  6. Gọi vượt ngưỡng tần suất (hằng số) thì 429. Người gọi không có cặp quyền chat thì 403.
- **Zone.** Mở một bề mặt đọc dữ liệu người dùng mới cho mọi nhân viên; có thể cần cặp quyền mới hoặc đổi data-scope. FULL gate.
- **Dẫn chứng.** `components/chat/CreateRoomDialog.tsx:38-46,95-101,151-176`; `hr-read.service.ts:93-99`; `permission-matrix-spec.md:83,113`; `chat-rooms.service.ts:290`. ROOM cũng vướng cùng giới hạn danh bạ (notes S11-ROOM trong `harness/backlog.mjs`).
- **Ghi chú.** Tách khỏi NV-02 để luồng trong phòng chung giao được ngay. NV-12, NV-91 và Ctrl+K (X-07) dùng lại ô tìm nhúng.

##### US-CHAT-NV-04 · Mở phòng tại tin chưa đọc đầu tiên, vạch «Tin chưa đọc», nút «↓ N tin mới»
*Gộp từ: US-CHAT-QL-02.* · **P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-15 §13.2, §14

- **Story.** Là nhân viên vừa họp xong (hoặc trưởng nhóm theo 3–5 nhóm), tôi muốn mở phòng có 25 tin mới là thấy ngay tin đầu tiên chưa đọc dưới một vạch phân cách, để đọc nối tiếp thay vì bị nhảy xuống đáy rồi phải cuộn ngược.
- **Cơ chế.** Khi mở phòng, chụp `firstUnreadSeq = lastMessageSeq − unreadCount + 1` (từ `chatRoomSchema`) TRƯỚC mọi `markRead`. Nếu `unreadCount > 0` thì khởi tạo `isNearBottom=false` cho lần mở này (hiện là `true` ở `MessageList.tsx:87`, nên markRead chạy ngay lần vẽ đầu). Lần vẽ đầu cuộn tới tin `roomSeq = firstUnreadSeq` và chèn vạch «N tin chưa đọc». Mốc nằm ngoài trang 50 tin đầu thì nạp thêm bằng `beforeSeq`, hoặc dừng ở tin cũ nhất kèm nhãn «còn tin chưa đọc phía trên». `markRead` chỉ chạy khi người dùng thật sự cuộn sát đáy. Nút «↓» hiện «N tin mới». `highlightMessageId` luôn được ưu tiên hơn vạch.
- **Luồng.** Mỗi phòng, xuất phát /chat. **Trước: ~4 thao tác** (bấm phòng → vẽ đầu luôn xuống đáy `MessageList.tsx:149` và tự markRead `:165-171` → cuộn ngược ~3 lần). **Sau: 1** (bấm phòng, khung mở tại vạch).
- **Tiêu chí chấp nhận.**
  1. Cho phòng R `unreadCount=25`, `lastMessageSeq=125`. Khi mở R, thì tin `roomSeq` 101 nằm trong khung nhìn ngay dưới vạch «25 tin chưa đọc», KHÔNG có `POST /chat/rooms/R/read` nào được gửi, badge của R chưa về 0 cho tới khi cuộn sát đáy.
  2. Số chưa đọc lớn hơn 50 thì nạp thêm tới mốc, hoặc dừng ở tin cũ nhất kèm nhãn. Không cuộn tới chỗ sai.
  3. Đang đọc giữa chừng mà có tin mới thì khung nhìn không bị kéo, nút «↓ N tin mới» hiện đúng số.
  4. `unreadCount=0` thì không có vạch, khung ở đáy như hiện tại.
  5. Mở qua liên kết nhảy-tới-tin thì ưu tiên tin được làm nổi.
  6. Tin đầu chưa đọc đã bị thu hồi thì vạch đặt trước tin chưa đọc kế tiếp còn hiển thị.
  7. Server cũ không trả `unreadCount/lastMessageSeq` thì rơi về hành vi cũ, không ZodError.
  8. Tab đang ẩn (`document.hidden`) thì không đánh dấu đã đọc.
- **Zone.** FE thuần, suy từ trường đã có. Con trỏ đọc vẫn chỉ tiến. Ca RED phải đỏ trên mã cũ («không gọi /read ở lần vẽ đầu»).
- **Dẫn chứng.** `components/chat/MessageList.tsx:87-88,135-151,165-171,356`; `packages/contracts/src/chat.ts:77,80-84`.

##### US-CHAT-NV-05 · «Đánh dấu đã đọc» ở dòng phòng và «Đọc hết» trên chip Chưa đọc
*Gộp từ: US-CHAT-QL-06.* · **P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-X-91 (thông báo lỗi) · Spec: CHAT-FUNC-009, CHAT-FUNC-017

- **Story.** Là nhân viên/quản lý vừa họp xong, tôi muốn xoá badge của các phòng đã nắm ý mà không phải mở từng phòng, để «Chưa đọc» chỉ còn những gì cần xử lý.
- **Cơ chế.** Thêm «Đánh dấu đã đọc» vào `RoomRowMenu` (hiện khi `unreadCount > 0` hoặc `markedUnreadAt ≠ null`), gọi `POST /chat/rooms/:id/read` với `lastMessageSeq`. Thêm «Đọc hết» khi chip «Chưa đọc» đang bật: áp cho các phòng đang hiển thị, tối đa 4 lời gọi song song, cập nhật badge lạc quan, phòng lỗi thì hoàn nguyên. Không đổi BE.
- **Luồng.** Xuất phát /chat, 6 phòng có tin mới. **Trước: 7** (chip → mở lần lượt 6 phòng; menu chỉ có ghim/tắt tiếng/đánh dấu CHƯA đọc/lưu trữ). **Sau: 2** (chip → «Đọc hết»); một phòng lẻ: ⋯ → «Đánh dấu đã đọc».
- **Tiêu chí chấp nhận.**
  1. 6 phòng chưa đọc, chip bật. Khi bấm «Đọc hết», thì 6 badge về 0 ngay và badge tổng trên header giảm tương ứng.
  2. Đang lọc «Phòng ban·Dự án» hoặc đang tìm thì chỉ đánh dấu phòng đang hiển thị; phòng direct bị lọc đi giữ badge.
  3. Phòng có `markedUnreadAt ≠ null`, `unreadCount=0`: «Đánh dấu đã đọc» làm hết in đậm.
  4. Một lời gọi lỗi (mạng/5xx/404): phòng thành công vẫn đã đọc, phòng lỗi khôi phục badge, banner/thông báo «Không đánh dấu được N phòng» có Thử lại.
  5. Không có phòng chưa đọc thì «Đọc hết» ẩn hoặc vô hiệu.
  6. FE gửi đúng `lastMessageSeq` của từng phòng, không gửi số «sentinel».
- **Zone.** Endpoint đã có, không đổi luật con trỏ chỉ-tiến.
- **Dẫn chứng.** `components/chat/RoomRowMenu.tsx:87-137`; `apps/api/src/chat/chat-messages.controller.ts:139`; `contracts/src/chat.ts:77,84,102`; `RoomListPanel.tsx:548-559`.
- **Ghi chú.** «Hoàn tác 5 giây» (ý của QL-06) chỉ làm được bằng cách hoãn gửi phía client, và cần US-X-91. Để sau.

##### US-CHAT-NV-06 · Giữ nháp theo từng phòng khi chuyển phòng
*Gộp từ: US-CHAT-QL-14.* · **P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-15 §9 CHAT-SCREEN-001, §14

- **Story.** Là người đang gõ dở câu trả lời dài, tôi muốn sang phòng khác tra một con số rồi quay lại vẫn thấy nguyên nháp (cả @mention và tin đang trả lời), để không phải gõ lại.
- **Cơ chế.** Store Zustand **chỉ trong bộ nhớ** theo `roomId`: chữ, mention đã chèn, `replyToMessageId`. Composer khôi phục khi mount, xoá khi gửi thành công, giữ khi gửi lỗi. Dòng phòng có nháp hiện «Nháp: …». Tệp đang chờ không được giữ; có cảnh báo nhẹ. Dùng chung store nên nháp đi theo khi bấm ⤢. Reset tường minh khi đăng xuất hoặc đổi phiên tại chỗ. Store này cũng làm điểm điền sẵn nháp cho GOAL-QL-13.
- **Luồng.** Xuất phát /chat, phòng A có nháp. **Trước: 4** (bấm B → bấm A → nháp mất `MessageComposer.tsx:61,96` → gõ lại → Enter). **Sau: 2** (bấm B → bấm A → nháp còn; Enter gửi như thường).
- **Tiêu chí chấp nhận.**
  1. Gõ «Anh xem giúp @Lan báo cáo» ở A, sang B rồi về A: ô soạn còn đúng nội dung, mention @Lan vẫn được gửi.
  2. Khung «đang trả lời» còn sau khi đổi phòng.
  3. Gõ dở trong drawer rồi bấm ⤢: `/chat/A` còn nguyên nháp.
  4. Gửi thành công thì ô trống và nhãn «Nháp:» biến mất. Gửi lỗi thì giữ nháp.
  5. Đăng xuất rồi người khác đăng nhập cùng tab thì không thấy nháp. Không có khoá nào chứa nội dung nháp, mention hay `replyToMessageId` trong session/local/IndexedDB.
  6. Có tệp chưa gửi mà đổi phòng thì cảnh báo tệp không được giữ, chữ vẫn giữ.
- **Zone.** FE thuần. Cố ý không dùng storage trình duyệt vì sessionStorage sống qua đăng xuất trong cùng tab.
- **Dẫn chứng.** `components/chat/MessageComposer.tsx:61,96-100,260-263`; `drawer/ChatDrawerBody.tsx` (nháp mất khi unmount).

##### US-CHAT-NV-07 · Dấu @ trên dòng phòng và chip lọc «Nhắc tôi»
**P1 · M · 🟡 yellow** · Lớp BE, FE, WS · Phụ thuộc: — · Spec: SPEC-15 CHAT-FUNC-014, CHAT-DEC-021

- **Story.** Là nhân viên ở 4–8 phòng, tôi muốn thấy ngay phòng nào có người @nhắc tôi mà tôi chưa đọc, để xử lý việc được giao qua chat trước tin chung.
- **Cơ chế.** BE thêm `mentionUnreadCount` (`.nullable().optional()`, additive) vào `chatRoomSchema`. Giá trị là số tin có `room_seq > last_read_seq`, `mentions ? :myUserId`, `recalled_at IS NULL`, chỉ cho membership của chính người gọi, trong `withTenant`. FE hiện dấu «@» cạnh badge và thêm chip «Nhắc tôi». Realtime: tăng khi `chat:message` có mentions chứa tôi và phòng không đang mở; về 0 khi `chat:read` của tôi.
- **Luồng.** Xuất phát /chat, 6 phòng chưa đọc. **Trước: ~6** (không có tín hiệu, phải mở từng phòng). **Sau: 2** (chip «Nhắc tôi» → bấm phòng có @).
- **Tiêu chí chấp nhận.**
  1. R có 10 tin chưa đọc, trong đó 2 tin nhắc tôi: dòng R có «@», chip «Nhắc tôi» liệt kê R.
  2. Đọc tới đáy R thì «@» biến mất (đồng bộ cả drawer).
  3. B nhắc C (không phải tôi) thì R không có «@» của tôi, payload phòng không chứa mention của người khác.
  4. Tin nhắc tôi đã thu hồi thì không tính.
  5. Server cũ chưa trả trường thì không ZodError và chip ẩn.
- **Zone.** Đổi DTO và truy vấn theo membership của người gọi, không đổi quyền. Không cần migration (`chat_messages.mentions` jsonb đã có). Nếu đo hiệu năng thấy cần index GIN thì phần đó tách WO red.
- **Dẫn chứng.** `contracts/src/chat.ts:66-110,258`; `apps/api/src/db/schema/communication.ts:365`; `contracts/src/realtime.ts:118`; `RoomListPanel.tsx:548-559`.

##### US-CHAT-NV-08 · Thanh tin ghim ở đầu hội thoại
*Gộp từ: US-CHAT-QL-05.* · **P1 · S · 🟡 yellow** · Lớp FE, BE, WS · Phụ thuộc: — · Spec: SPEC-15 CHAT-FUNC-010, CHAT-ERR-008

- **Story.** Là người dùng, tôi muốn tin quan trọng đã ghim (lịch họp, link tài liệu, quy định) hiện ngay đầu khung hội thoại, để không phải mở bảng thông tin rồi accordion mỗi lần xem lại.
- **Cơ chế.** Thanh mảnh dưới header: tin ghim mới nhất (1 dòng) kèm «1/N». Bấm thân thanh thì `jumpToMessage`, bấm mũi tên thì xoay sang tin kế. Dùng `chatApi.getPinned` với cùng query key như `RoomPinnedList`. Thu gọn được, nhớ theo phòng bằng `localStorage` có try/catch. Áp dụng cả trong drawer. **BE:** pin/unpin phát sự kiện sau commit (qua cùng DTO/masking) để người khác thấy ngay; hiện tại pin/unpin không emit.
- **Luồng.** Phòng đang mở. **Trước:** màn <1280px (hoặc điện thoại) 4 thao tác (ⓘ → accordion «Tin ghim» → bấm tin → đóng Sheet); màn ≥1280px 2 thao tác (cột thông tin mở sẵn: accordion → bấm tin); drawer phải ⤢ sang trang. **Sau: 1** (bấm thanh).
- **Tiêu chí chấp nhận.**
  1. Phòng có 3 tin ghim: mở phòng (trang hoặc drawer) thấy tin mới nhất kèm «1/3»; mũi tên chuyển tin kế.
  2. Tin đích ngoài cửa sổ đã nạp thì nạp ngữ cảnh và làm nổi tin.
  3. Admin khác ghim/bỏ ghim thì thanh của tôi cập nhật không cần tải lại; ở chế độ polling dự phòng thì cập nhật ở nhịp kế tiếp.
  4. Tin ghim bị thu hồi thì thanh bỏ tin đó hoặc ghi «Tin đã thu hồi», không hiện nội dung cũ trong cache.
  5. Không có tin ghim thì không vẽ thanh.
  6. Không đủ quyền bỏ ghim thì không có nút bỏ ghim; gọi API thẳng thì server từ chối.
  7. `getPinned` lỗi thì hội thoại vẫn bình thường, thanh không hiện, không chặn gửi tin.
- **Zone.** Phần thanh là FE. Phần emit sau commit là BE trong luồng chat. Không đổi quyền hay schema.
- **Dẫn chứng.** `components/chat/RoomInfoPanel.tsx:418-425`; `room-info/RoomPinnedList.tsx`; `ConversationPanel.tsx:206,213-217`; `apps/api/src/chat/chat-message-moderation.service.ts:104-137`; `hooks/use-chat-realtime.ts:124-164`.
- **Ghi chú.** Phòng phòng ban/dự án có 0 admin nên hiện không ai ghim được ở đó. Tư cách ghim theo loại phòng là quyết định red (§7 Q3).

##### US-CHAT-NV-09 · Báo tin mới khi ở trang khác: «(N)» trên tiêu đề tab và toast cho tin riêng/@nhắc tôi
*Gộp từ: US-CHAT-QL-10.* · **P1 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-CHAT-NV-01, US-X-91 · Spec: SPEC-15 §17, CHAT-FUNC-015, CHAT-DEC-013, CHAT-DEC-026

- **Story.** Là nhân viên/quản lý đang ở Công việc, Mục tiêu hoặc một tab khác, tôi muốn biết ngay khi có người nhắn riêng hay @nhắc tôi và trả lời trong 1 chạm, để không lỡ việc được giao qua chat mà không phải rời trang.
- **Cơ chế.** Dựa trên luồng WS sẵn có (`use-chat-realtime`):
  - (a) Tiêu đề tab có tiền tố «(N)», N đúng bằng badge header (`totalUnreadCount`).
  - (b) Toast nhẹ khi tin mới là DM hoặc nhắc tôi, phòng không đang mở và không tắt tiếng. Toast có nút «Trả lời» gọi `openRoom` (drawer đúng phòng, ô soạn focus).
  - Gộp toast cùng phòng trong 15 giây. Toast đọc qua `aria-live polite`.
  - **Mặc định toast chỉ có tên người gửi và tên phòng.** Xem trước một dòng nội dung chỉ bật khi người dùng tự bật tuỳ chọn cá nhân (prefs không đặt sau cổng quyền); nội dung lấy từ payload `chat:message` đã nhận, không gọi thêm API.
  - **Nơi lưu hai tuỳ chọn «Toast tin nhắn» (mặc định bật) và «Xem trước nội dung» (mặc định tắt).** `localStorage` theo khoá gắn `userId`, bọc try/catch; không đọc được thì dùng mặc định (bật toast, **tắt** xem trước), tức hỏng thì an toàn về phía riêng tư. Không lưu server: `user_preferences` có cột cố định, thêm khoá là migration (red). Công tắc đặt ở `/me/preferences/notifications`, cạnh công tắc toast của US-X-06, ghi «chỉ trên trình duyệt này». Muốn không nhận thông báo `CHAT_DIRECT_MESSAGE`/`CHAT_MENTIONED` thì dùng bảng loại × kênh sẵn có.
- **Luồng.** Xuất phát /tasks. **Trước: 4** (tự để ý badge → bấm badge → tìm phòng → gõ → Enter; tin nhóm không nhắc tên thì không có NOTI). **Sau: 3** («Trả lời» trên toast → gõ → Enter); tab nền vẫn thấy «(N)».
- **Tiêu chí chấp nhận.**
  1. Ở /tasks, B nhắn riêng: toast «B đã nhắn cho bạn» có «Trả lời»; bấm thì drawer mở đúng DM, ô soạn focus.
  2. Tin nhóm có nhắc tôi thì có toast. Tin nhóm không nhắc tôi chỉ tăng badge (chống spam §17).
  3. Phòng đang tắt tiếng thì không có toast, nhưng «(N)» vẫn bằng badge header.
  4. Đang mở chính phòng đó (trang hoặc drawer) thì không có toast.
  5. Nhiều tin cùng phòng trong 15 giây gộp thành một toast.
  6. Tin bị thu hồi thì toast bị gỡ.
  7. Tổng chưa đọc về 0 thì tiêu đề tab về gốc, không còn «(0)».
  8. Nút «Trả lời» với tới được bằng bàn phím.
  9. Chưa bật «Xem trước nội dung»: toast không có thân tin. `localStorage` bị chặn: toast vẫn không có thân tin. Đăng xuất rồi người khác đăng nhập trên cùng máy: dùng mặc định của họ, không thừa hưởng.
- **Zone.** FE dùng sự kiện WS đã qua DTO/masking. Không sinh thông báo hệ thống mới. Tuỳ chọn chỉ ở trình duyệt, không đổi schema.
- **Dẫn chứng.** `hooks/use-chat-realtime.ts`; `components/chat/ChatBadge.tsx:80`; `chat-dock.store.ts:65-75,96-121`; `apps/api/src/chat/chat-messages.service.ts:249-271`; `contracts/src/chat.ts:96`.

##### US-CHAT-NV-10 · Tạo việc từ một tin nhắn mà không rời phòng chat
*Gộp từ: US-CHAT-QL-07, US-X-10.* · **P1 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-CHAT-NV-01, US-X-91 · Spec: CHAT-DEC-009 (chỉ cấm phòng chat theo task); SPEC-06 · **Owner quyết liên kết hai chiều (§7 Q4)**

- **Story.** Là nhân viên được nhờ việc qua chat, hoặc trưởng nhóm nghe thành viên báo vấn đề, tôi muốn biến tin đó thành việc ngay tại chỗ (tiêu đề, mô tả, dự án điền sẵn), để không quên việc và không phải chép-dán sang /tasks rồi quay lại tìm phòng.
- **Cơ chế.** Thêm «Tạo việc» vào menu ⋯ của `MessageActions`, chỉ hiện khi `useCan('create','task')`; ẩn với tin thu hồi hoặc tin hệ thống. Thêm prop `initialValues` cho `TaskFormDrawer`, mở drawer chồng trên chat. Giá trị điền sẵn:
  - tiêu đề = dòng đầu của tin (tối đa 120 ký tự);
  - mô tả = văn bản tin + «Từ tin nhắn của <người gửi> lúc <giờ>» + liên kết `/chat/{roomId}?msg={id}`;
  - dự án = `refId` khi `roomType='project'`;
  - người thực hiện = `employeeId` của chính tôi (từ `/auth/me`), đổi được sang thành viên dự án. Không tự suy từ người gửi.
  
  Lưu xong vẫn ở phòng và có toast «Đã tạo việc · Mở». Tuỳ chọn «Gửi link việc vào phòng» mặc định **tắt**; nếu bật thì tin chỉ chứa URL `/tasks/<id>`. Không lưu liên kết ngược bền.
- **Luồng.** Phòng dự án đang mở.
  - **Trước: 14 thao tác (NV), 15 (QL), 2 chuyển trang.** ⋯ → Sao chép → sang /tasks → Tạo → dán → người (2) → hạn (2) → Lưu → về /chat → chọn lại phòng (`ChatPage.tsx:63` mất phòng) → gõ «đã tạo» → Enter.
  - **Sau: 5 thao tác, 0 chuyển trang** (NV tự nhận: ⋯ → «Tạo việc» → hạn (2) → Lưu). Giao cho người khác: +2, tức **7** (QL).
- **Tiêu chí chấp nhận.**
  1. Có `create:task`, ở phòng dự án P: drawer mở với tiêu đề/mô tả từ tin, dự án P, người thực hiện là tôi. Chưa lưu gì cho tới khi bấm Lưu. Lưu xong vẫn ở phòng.
  2. Không có `create:task` (hoặc vai trò dự án không cho tạo, nếu FE biết) thì không có mục. Gọi API thẳng thì server từ chối như luồng thường.
  3. Phòng direct/group: trường dự án trống, cảnh báo nổi bật «Nội dung tin sẽ hiển thị cho những ai xem được việc này».
  4. Tin thu hồi hoặc tin hệ thống không có mục. Tin chỉ có tệp thì tiêu đề trống và bắt buộc nhập.
  5. Lưu lỗi (validate/mạng/403) thì drawer giữ dữ liệu, hiện lỗi theo `submitErrorKey`, không đóng.
  6. Người mở liên kết `?msg=` mà không phải thành viên phòng chỉ thấy «Không mở được cuộc trò chuyện này».
  7. Tin có tệp/ảnh: chỉ chép văn bản, không chép URL ký, objectKey hay tên tệp. Không tự gửi gì vào phòng trừ khi người dùng bật tuỳ chọn; khi bật thì chỉ có URL việc.
- **Zone.** Chạm luồng tạo việc của TASK (dùng lại form và guard). Liên kết hai chiều bền là migration, tức red, tách WO riêng.
- **Dẫn chứng.** `components/chat/MessageActions.tsx:40-58,81-164`; `routes/tasks/TaskFormDrawer.tsx:37,54,65`; `contracts/src/chat.ts:69`; `ChatPage.tsx:63`.

##### US-CHAT-NV-11 · Nút «Thảo luận» ở trang dự án/chi tiết việc mở đúng phòng dự án trong drawer
*Gộp từ: US-CHAT-QL-08.* · **P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: CHAT-FUNC-003..005, CHAT-DEC-026, CHAT-DEC-009

- **Story.** Là người đang xem một việc hay tiến độ dự án, tôi muốn bấm «Thảo luận» để mở phòng chat của dự án bên phải màn hình, để hỏi nhóm mà không mất trang đang xem.
- **Cơ chế.** Nút trên header `ProjectDetailPage` và `TaskDetailContent` (khi việc có `projectId`). Tìm phòng `roomType='project' && refId=projectId` trong danh sách phòng đã cache, rồi gọi `openRoom(roomId)`. Chỉ hiện khi có quyền xem CHAT và phòng nằm trong danh sách của tôi. Không tạo phòng theo việc (CHAT-DEC-009).
- **Luồng.** Chi tiết việc trong /tasks. **Trước: 4** (badge chat → chip «Phòng ban·Dự án» → dò dự án → bấm phòng; ngoài `components/chat` không có nơi nào gọi `openRoom`). **Sau: 1**.
- **Tiêu chí chấp nhận.**
  1. Là thành viên dự án P: bấm «Thảo luận» thì drawer mở phòng P, trang giữ nguyên bên trái.
  2. Xem được việc nhưng phòng P không có trong danh sách phòng của tôi: nút không hiện, không lộ tên/nội dung phòng, không gọi API phòng.
  3. Không có cặp quyền xem CHAT thì nút ẩn.
  4. Phòng dự án chưa đồng bộ xong: nút vô hiệu kèm «Phòng dự án đang được tạo», không tạo phòng từ client.
  5. Việc không thuộc dự án thì không có nút.
- **Zone.** FE dùng store và danh sách phòng sẵn có; membership do BE quyết.
- **Dẫn chứng.** `components/chat/chat-dock.store.ts:65-79,96-121`; `routes/tasks/ProjectDetailPage.tsx:711-713`; `contracts/src/chat.ts:69-70`; `apps/api/src/chat/chat-derived-rooms-sync.service.ts`.
- **Ghi chú.** Ý điền sẵn link việc vào ô soạn (QL-08) làm sau, dựa trên store nháp của NV-06.

##### US-CHAT-NV-12 · Tạo nhóm nhanh: chọn từ người liên hệ gần đây, ô tìm nhúng, tên nhóm gợi ý
*Gộp từ: US-CHAT-QL-13.* · **P2 · M · 🟢 green** · Lớp FE · Phụ thuộc: —; **phụ thuộc mềm US-CHAT-NV-03** (ô tìm nhúng chỉ tìm được đồng nghiệp ngoài «Gần đây» khi có danh bạ nhẹ) · Spec: CHAT-FUNC-002, SPEC-15 §6

- **Story.** Là nhân viên/trưởng phòng, tôi muốn lập nhóm 4 người chỉ bằng vài chạm, để không phải mở dialog chồng dialog, gõ từng tên và tự nghĩ tên nhóm.
- **Cơ chế.** Tab «Nhóm» của `CreateRoomDialog`:
  - (a) Dải chip «Gần đây» lấy từ người đối thoại (peer) của các DM sẵn có.
  - (b) Ô tìm người nhúng thẳng, bỏ dialog thứ hai.
  - (c) Tên nhóm tự gợi ý «Lan, Minh, Hà +1» khi chưa gõ, vẫn thoả `min(1)`.
  - Lối tắt «Thêm người» trong bảng thông tin DM mở dialog nhóm đã chọn sẵn người đối thoại.
  - Không lấy gợi ý từ roster các phòng (roster chỉ có theo từng phòng, sẽ phải gọi N API).
- **Luồng.** /chat, nhóm 4 người.
  - **(a) Cả 4 người đã có DM với tôi** (có trong «Gần đây»). **Trước: 14** («+» → Nhóm → gõ tên → «Chọn thành viên» → 4×(gõ+tick) → Xác nhận → Tạo). **Sau: 7** («+» → Nhóm → 4 chip → Tạo).
  - **(b) Có người chưa từng DM.** Mỗi người như vậy thêm 2 thao tác (gõ tên vào ô tìm nhúng → chọn), **nếu** họ nằm trong danh bạ tôi được xem. Với NV thường (`read:employee@Own`) thì người đó không tìm được (ngõ cụt) cho tới khi có CHAT-NV-03; cách vòng hiện nay là nhờ người xem được họ trong danh bạ (vd QL) thêm họ vào nhóm.
- **Tiêu chí chấp nhận.**
  1. Có DM với Lan, Minh, Hà, Tú: cả 4 có ở «Gần đây»; chạm để thêm/bỏ.
  2. Chọn 4 người chưa gõ tên thì nhóm tạo với tên gợi ý, đổi tên được sau.
  3. Xoá trắng tên thì lỗi «Cần tên nhóm» tại ô, không gửi request.
  4. Chưa có DM nào thì «Gần đây» ẩn, ô tìm vẫn dùng theo phạm vi danh bạ hiện hành; không có kết quả thì «Không tìm thấy trong danh bạ bạn được xem».
  5. Peer `isActive=false` thì chip bị khoá kèm lý do. Server từ chối một người thì dialog giữ lựa chọn và nói rõ ai không thêm được.
  6. Không có `create:chat-room` thì không có nút «+».
- **Zone.** FE thuần; không đổi contracts, quyền hay schema.
- **Dẫn chứng.** `components/chat/CreateRoomDialog.tsx:49-58,62-145`; `contracts/src/chat.ts:153`; `EmployeeMultiPickerDialog.tsx:181-190`; `apps/api/src/chat/chat-rooms.repository.ts:472`.

##### US-CHAT-NV-13 · Phím tắt chuyển phòng và nhảy sang phòng chưa đọc kế tiếp
*Gộp từ: US-CHAT-QL-11.* · **P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-CHAT-NV-04 (US-CHAT-NV-06 để giữ nháp) · Spec: S17-CHAT-UX2 §2 G14

- **Story.** Là người dùng laptop cả ngày, tôi muốn chuyển phòng và nhảy tới phòng chưa đọc kế tiếp bằng bàn phím, để xử lý hết tin mới mà không với chuột.
- **Cơ chế.** Phím tắt cấp /chat và drawer: phòng trên/dưới theo danh sách đang lọc; phòng chưa đọc kế tiếp (ưu tiên phòng có @ khi đã có NV-07).
  - Tổ hợp không được trùng thao tác soạn. Windows dùng Alt+↑/↓ và Alt+Shift+↓. macOS **không** dùng Option+↑/↓ (vì đó là phím di chuyển con trỏ trong textarea), chốt tổ hợp khác như ⌘+Option+↑/↓.
  - Không dùng Ctrl+K. Không chạy khi popover hoặc dialog đang mở.
  - Đổi phòng xong thì focus vào ô soạn và đọc tên phòng qua `aria-live`. Có bảng gợi ý phím (?).
- **Luồng.** /chat, vừa đọc xong một phòng. **Trước: 2/phòng** (dò danh sách → bấm). **Sau: 1/phòng**.
- **Tiêu chí chấp nhận.**
  1. 3 phòng chưa đọc, nhấn tổ hợp «chưa đọc kế tiếp» 3 lần: mở lần lượt theo thứ tự danh sách, focus ô soạn. Lần thứ 4 hiện «Đã đọc hết».
  2. Ô soạn có chữ (kể cả macOS): không chèn ký tự, không di chuyển con trỏ, nháp phòng cũ được giữ.
  3. Popover @/emoji hoặc dialog đang mở thì phím do popover/dialog xử lý.
  4. Không nhảy sang phòng bị bộ lọc ẩn. Không có phòng thì không lỗi.
  5. Tên phòng mới được đọc qua `aria-live`.
- **Zone.** FE thuần.
- **Dẫn chứng.** `components/chat/ConversationPanel.tsx:317-343`; `RoomListPanel.tsx` (không bắt ArrowUp/Down); `docs/plans/S17-CHAT-UX2-WAVE.md:57`.

##### US-CHAT-NV-91 · «Cuộc trò chuyện mới» ngay trong drawer chat *(bổ sung khi tổng hợp)*
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-CHAT-NV-12 (ô tìm nhúng); **phụ thuộc mềm US-CHAT-NV-03** (NV thường chỉ tìm được đồng nghiệp mới sau khi có danh bạ nhẹ) · Spec: SPEC-15 CHAT-SCREEN-002 v2, CHAT-DEC-026

- **Story.** Là nhân viên đang dùng drawer chat ở /tasks, tôi muốn bắt đầu tin nhắn riêng hay nhóm mới ngay trong drawer, để không phải ⤢ sang /chat và mất trang đang làm.
- **Cơ chế.** Nút «+» trên header danh sách phòng của drawer mở `CreateRoomDialog` (dùng chung với /chat, kể cả ô tìm nhúng của NV-12). Tạo xong thì `openRoom` ngay trong drawer. Gate `useCan('create','chat-room')`.
- **Luồng.** /tasks, drawer mở. Số thao tác phụ thuộc người cần nhắn có nằm trong phạm vi danh bạ của tôi hay không (`read:employee` theo scope, `hr-read.service.ts:93-99`).
  - **(a) Người tìm được trong danh bạ** (người dùng có `read:employee` rộng hơn Own, vd QL; hoặc mọi NV sau khi có CHAT-NV-03). **Trước: 8, 1 chuyển trang** (⤢ → «+» → «Chọn người» → gõ → chọn → Xác nhận → gõ → Enter). **Sau: 5, 0 chuyển trang** («+» → gõ tên → chọn → gõ → Enter).
  - **(b) NV thường (`read:employee@Own`), đồng nghiệp chưa từng nhắn và không chung phòng.** Trước và sau Đợt 1B đều là **ngõ cụt**: ô tìm chỉ trả về chính mình. Story này không cứu ca này; phải chờ CHAT-NV-03 (Đợt 3, red).
  - **(c) NV thường, người đã chung phòng nhóm.** Dùng «Nhắn riêng» của CHAT-NV-02 (4 thao tác), không cần «+».
  - **(d) NV thường lập nhóm từ người đã có DM.** «+» → Nhóm → chạm chip «Gần đây» (NV-12) ×k → Tạo = 3 + k, 0 chuyển trang.
- **Tiêu chí chấp nhận.**
  1. Có `create:chat-room`: «+» trong drawer mở dialog. Tạo DM/nhóm xong thì hội thoại mở trong drawer, trang phía sau giữ nguyên.
  2. Không có cặp quyền thì không có «+».
  3. Server từ chối (người đã khoá…) thì dialog giữ lựa chọn và hiện lỗi; drawer không chuyển sang phòng rỗng.
  4. Drawer trên điện thoại (toàn màn) vẫn mở dialog đúng lớp, Esc đóng dialog trước rồi mới đóng drawer.
  5. NV chỉ có `read:employee@Own` gõ tên đồng nghiệp ngoài phạm vi: «Không tìm thấy trong danh bạ bạn được xem» kèm gợi ý «Nhắn riêng từ một phòng chung». Không gọi thêm endpoint nào để «tìm hộ».
- **Zone.** FE thuần, tái dùng dialog và endpoint sẵn có.
- **Dẫn chứng (đã kiểm 23/10).** `CreateRoomDialog` chỉ được import ở `routes/chat/ChatPage.tsx:32,427`; `components/chat/drawer/ChatDrawerBody.tsx:106-116` chỉ có nút mở toàn trang.

#### 5.1.2 CHAT — Quản lý

##### US-CHAT-QL-03 · Xem ai CHƯA đọc tin của tôi (popover «Đã xem · Chưa xem»)
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-CHAT-NV-02 (nút «Nhắn riêng» trên dòng «Chưa xem»; làm trước NV-02 thì popover chỉ đọc) · Spec: SPEC-15 §5.1, §13.2, CHAT-DEC-024

- **Story.** Là trưởng phòng vừa gửi thông báo vào phòng ban, tôi muốn bấm dãy «đã xem» để thấy «Đã xem (N)» và «Chưa xem (M)», cả trên điện thoại, để nhắc đúng người chưa đọc thay vì hỏi cả phòng.
- **Cơ chế.** `SeenByAvatars` thành nút mở popover (sheet khi dùng cảm ứng) có hai tab. Danh sách suy từ `members.lastReadSeq` đã có ở FE. Loại chính tôi và người vào phòng sau thời điểm gửi tin (`joinedAt > createdAt`). Mỗi dòng «Chưa xem» có «Nhắn riêng».
- **Luồng.** /chat. **Trước: ~6** (rê dãy 3 avatar `SeenByAvatars.tsx:19,41-52`; cảm ứng không xem được; không biết ai chưa đọc nên phải hỏi lại trong phòng). **Sau: 2** (bấm dãy → tab «Chưa xem»).
- **Tiêu chí chấp nhận.**
  1. Phòng 10 người, 7 người đã đọc tin của tôi: popover «Đã xem (7)» / «Chưa xem (2)», không tính tôi.
  2. Người vào phòng sau khi tin được gửi không nằm trong «Chưa xem».
  3. Chạm trên điện thoại mở được danh sách.
  4. Chưa ai xem thì có nhãn «Chưa ai xem» bấm được.
  5. Roster chưa tải hoặc lỗi thì hiện đang tải hoặc «Không tải được danh sách», không hiện danh sách sai.
  6. Rời phòng thì không thấy roster hay trạng thái đọc (server trả 404 đồng nhất).
  7. `aria-label` vẫn đọc đủ «Đã xem: …».
  8. Tin không phải của tôi thì không có popover. Không hiện thời điểm đọc, không thống kê xuyên phòng hay xuyên thời gian, không xuất file.
- **Zone.** FE dùng roster đã có, không lộ thêm gì ngoài thứ thành viên đã thấy.
- **Dẫn chứng.** `components/chat/SeenByAvatars.tsx:19,41-52`; `MessageList.tsx:177-193`; `MessageBubble.tsx:343`; `contracts/src/chat.ts:527`.

##### US-CHAT-QL-09 · @cả phòng cho người có tư cách ở phòng ban/dự án
**P1 · M · 🔴 red** · Lớp FE, BE, DOC · Phụ thuộc: US-CHAT-NV-01 · Spec: SPEC-15 §6, §17, CHAT-DEC-010, CHAT-FUNC-014, CHAT-DEC-016 · **Cần owner quyết (§7 Q2)**

- **Story.** Là trưởng phòng, tôi muốn gõ @cả phòng khi có thông báo quan trọng để mọi thành viên được báo như khi được nhắc tên, để không phải @ từng người hay nhắn riêng từng người.
- **Cơ chế.** «@cả phòng» trong `MentionPopover`, chỉ hiện khi server báo người dùng có tư cách. Tư cách theo loại phòng, mô phỏng §11b/CHAT-DEC-016:
  - group: admin phòng;
  - department: có `update:org_unit` với đơn vị neo của phòng (đúng data_scope);
  - project: vai trò quản lý dự án (DECISIONS-04);
  - direct: không ai.
  
  Client gửi cờ `mentionAll`, không gửi danh sách id (contracts giới hạn 20). Server mở rộng thành `CHAT_MENTIONED` cho thành viên đang hoạt động, trừ người gửi và người tắt tiếng. `dedupeKey` suy từ nội dung. Giới hạn 1 lần/phòng/15 phút bằng khoá Valkey có `companyId+roomId`. Payload NOTI không có nội dung tin. Audit mỗi lần phát, chỉ gồm roomId, actor và số người nhận. Ghi CHAT-DEC mới vào SPEC-15 §22 TRƯỚC khi code.
- **Luồng.** Phòng ban 8 người. **Trước: 18** (8×(gõ @ + chọn) + gõ + Enter; không mention thì chỉ có badge). **Sau: 4** (@ → «@cả phòng» → gõ → Enter).
- **Tiêu chí chấp nhận.**
  1. Có `update:org_unit` với đơn vị neo của phòng P (8 người, 1 người tắt tiếng): 6 người nhận `CHAT_MENTIONED`, payload chỉ có tên phòng + người gửi, có một bản ghi audit.
  2. Thành viên thường, hoặc có `update:org_unit` với **đơn vị khác**: không có mục. Gửi `mentionAll` qua API thì bị từ chối bằng mã CHAT-ERR và tin KHÔNG được lưu.
  3. Phòng hơn 20 thành viên thì mọi thành viên hợp lệ đều nhận.
  4. Dùng lại trong 15 phút thì server từ chối, nêu thời gian chờ, tin không gửi nửa chừng.
  5. Phòng direct không có mục.
  6. Bấm thông báo thì vào đúng phòng (NV-01).
  7. Khoá giới hạn không chặn nhầm công ty khác. Tin bị thu hồi trước khi job mở rộng chạy thì không phát.
- **Zone.** Luật authority mới, lật một phần CHAT-DEC-010. FULL gate. Test deny-path trước: thành viên thường, đơn vị khác, phòng direct.
- **Dẫn chứng.** `components/chat/use-mention-autocomplete.ts`; `apps/api/src/chat/chat-messages.service.ts:249-271`; `docs/SPEC/SPEC-15 CHAT.md:250,721-735,821`; `chat-derived-rooms-sync.service.ts:274-277` (phòng dẫn xuất luôn chèn role member).

##### US-CHAT-QL-12 · Lời nhắc «thành viên dẫn xuất» thành liên kết sang nơi quản lý thành viên
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-CHAT-NV-01 · Spec: SPEC-15 §13.3, CHAT-ERR-012

- **Story.** Là quản lý dự án, khi cần thêm người vào phòng chat dự án, tôi muốn có liên kết thẳng tới tab thành viên của dự án, để khỏi phải tự tìm dự án bên Công việc.
- **Cơ chế.** Dòng `derivedNotice` trong `RoomMembersSheet` thành liên kết. Phòng project dẫn tới `/tasks/projects/{refId}?tab=members`. Phòng department dẫn tới trang đơn vị HR nếu `useCan` cho phép, không thì giữ chữ thuần. Quay lại `/chat/:roomId` nhờ NV-01.
- **Luồng.** /chat, màn <1280px. **Trước: 7, 1 chuyển trang** (ⓘ → Thành viên → /tasks → Dự án → tìm → mở → tab Thành viên); ≥1280px là 6. **Sau: 3** (2 trên màn rộng).
- **Tiêu chí chấp nhận.**
  1. Phòng project `refId=D`, tôi xem được D: có liên kết «Quản lý thành viên ở dự án →».
  2. Phòng department mà tôi không có quyền xem trang phòng ban HR: chữ thuần.
  3. Phòng group: không có lời nhắc dẫn xuất.
  4. D đã lưu trữ hoặc xoá mềm: trang dự án hiện trạng thái tương ứng, không 404 trắng.
- **Zone.** FE; quyền thật do trang đích và server ép.
- **Dẫn chứng.** `components/chat/RoomMembersSheet.tsx:95,148-151`; `i18n/locales/vi/chat.ts:316`; `router.tsx:1497`; `ProjectDetailPage.tsx:519`.

### 5.2 Công việc — TASK

| Id | Tiêu đề | Loại | Ưu tiên | Cỡ | Zone | Thao tác trước→sau |
| --- | --- | --- | --- | --- | --- | --- |
| **Nhân viên** | | | | | | |
| US-TASK-NV-01 | «Việc của tôi» chia nhóm theo hạn, ẩn việc đã xong | ux | P0 | M | 🟢 | 3 + tự dò ngày→2 |
| US-TASK-NV-02 | «Việc của tôi» tải nhẹ: mặc định bỏ việc đã đóng, có trần | tối ưu | P1 | S | 🟡 | không đổi, giảm tải |
| US-TASK-NV-03 | Đổi trạng thái ngay trên dòng danh sách | ux | P0 | M | 🟡 | 7→4 (3→0 chuyển trang) |
| US-TASK-NV-04 | Drawer chi tiết việc ở mọi bề mặt (`?task=`), quay lại đúng chỗ | ux | P0 | M | 🟢 | danh sách 3→2 · thông báo 5–8→4 |
| US-TASK-NV-05 | Tạo nhanh việc cá nhân một dòng, mặc định giao cho mình | hoàn thiện | P0 | M | 🟡 | 9→3 |
| US-TASK-NV-06 | Nhắc sắp đến hạn/quá hạn chạy đúng cho việc SPEC-06 | hoàn thiện | P0 | M | 🟡 | NV 3→2 · QL 6→0 |
| US-TASK-NV-08 | Mốc hạn nhanh (Hôm nay / Ngày mai / Thứ Sáu / Tuần sau / Xoá) | ux | P1 | S | 🟢 | 4→2 |
| US-TASK-NV-10 | Nhập liên tiếp việc con/checklist, dán nhiều dòng | ux | P1 | M | 🟢 | 20→10 |
| US-TASK-NV-11 | Bình luận: Ctrl+Enter, gợi ý @ từ người tham gia việc | ux | P1 | S | 🟢 | 4→3 (@ dùng được với mọi NV) |
| US-TASK-NV-13 | Chỉ hiện nút sửa khi thật sự sửa được (`allowedActions`) | tối ưu | P1 | M | 🟠 | 3 thao tác vô ích→0 |
| US-TASK-NV-91 | «Chuyển sang cột…» trên thẻ board (di động/bàn phím) *(bổ sung)* | ux | P1 | S | 🟡 | 4→2 |
| US-TASK-NV-92 | Đính kèm nhiều tệp một lần, kéo-thả, dán ảnh *(bổ sung)* | ux | P2 | S | 🟢 | 6→1–2 |
| US-TASK-NV-93 | «Việc rơi vào kỳ nghỉ» trên đơn nghỉ của tôi: dời hạn / báo người giao tại chỗ *(bổ sung khi kiểm độ phủ)* | hoàn thiện | P1 | S | 🟡 | dời hạn 7→2 · báo người giao 6→3 (3→0 chuyển trang) |
| **Quản lý** | | | | | | |
| US-TASK-QL-01 | Giao việc qua form Tạo/Sửa cũng báo người được giao | hoàn thiện | P0 | M | 🟡 | 15→10 |
| US-TASK-QL-03 | Chọn nhiều việc: giao người, dời hạn, đổi trạng thái một lần | tối ưu | P0 | M | 🟡 | 26→7 |
| US-TASK-QL-04 | Màn «Đội của tôi»: tải việc và quá hạn theo người, xuyên dự án | hoàn thiện | P0 | M | 🟠 | 16→2 (4→1 chuyển trang) |
| US-TASK-QL-05 | Bộ lọc Danh sách/workspace trên URL, ô tìm, chip «Của tôi» | ux | P0 | M | 🟢 | mỗi việc 4→2 · tìm 5→3 |
| US-TASK-QL-06 | Tạo nhanh trong dự án kèm người và hạn «dính» | ux | P0 | S | 🟢 | 36→17 |
| US-TASK-QL-07 | Trang Quá hạn thành bàn xử lý (trễ bao lâu, dời hạn/đổi người trên dòng) | ux | P1 | M | 🟢 | 4→2 mỗi việc |
| US-TASK-QL-08 | Hàng đợi «Chờ duyệt»: Hoàn thành / Trả lại kèm lý do | ux | P1 | M | 🟡 | 8→1 (duyệt) / 3 (trả lại) |
| US-TASK-QL-09 | Báo chủ/quản lý dự án khi việc vào Chờ duyệt | hoàn thiện | P1 | S | 🟡 | 4→1 |
| US-TASK-QL-10 | Báo cáo dự án: quá hạn/sắp hạn theo người, bấm số mở bảng đã lọc | hoàn thiện | P1 | S | 🟡 | 4→2 |
| US-TASK-QL-11 | Danh sách dự án có cột tiến độ, lọc «Có việc quá hạn»/«Tôi phụ trách» | hoàn thiện | P1 | M | 🟠 | 19→3 |
| US-TASK-QL-12 | Đặt checklist «bắt buộc trước khi Hoàn thành» trên UI | hoàn thiện | P2 | S | 🟡 | không làm được→4 |
| US-TASK-QL-13 | Tạo dự án xong vào thẳng Thành viên; nhớ tab dùng gần nhất | ux | P2 | S | 🟢 | 19→16 · hằng ngày 2→1 |
| US-TASK-QL-14 | Chủ dự án xem Báo cáo dự án mình (theo vai trò dự án) | hoàn thiện | P2 | M | 🔴 | 6→2 |
| US-TASK-QL-91 | Hiện cảnh báo «đang nghỉ phép / không phải thành viên» khi giao *(bổ sung)* | hoàn thiện | P1 | S | 🟢 | 4→2 |
| US-TASK-QL-92 | Bàn giao quanh kỳ nghỉ: «Việc trong kỳ nghỉ (N)» từ đơn đang duyệt + dấu nghỉ trong picker *(bổ sung khi kiểm độ phủ)* | hoàn thiện | P1 | M | 🟡 | 30→6 (1 chuyển trang) |

#### 5.2.1 TASK — Nhân viên

##### US-TASK-NV-01 · «Việc của tôi» chia nhóm theo hạn và ẩn việc đã xong
**P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-X-92 · Spec: SPEC-06 §13.9 (TASK-SCREEN-009)

- **Story.** Là nhân viên có 10–20 việc mở, tôi muốn sáng mở «Việc của tôi» là thấy các nhóm Quá hạn / Hôm nay / Sắp đến hạn / Đang làm / Chờ kiểm tra và việc đã xong được ẩn, để biết hôm nay làm gì mà không dò ngày từng thẻ hay chuyển qua lại 3 tab.
- **Cơ chế.** Nhóm phía client từ DTO sẵn có của `GET /tasks/my` (`dueAt`, `isOverdue`, `status`, `source`). Mặc định gộp 3 nguồn; chip nguồn (Được giao / Tôi tạo / Theo dõi) làm bộ lọc. Done/Cancelled ẩn mặc định, có công tắc «Hiện việc đã xong». Nhóm và chip nằm trên URL (`?group=&source=&showDone=`). Nhóm rỗng thu gọn, đầu nhóm có số đếm. «Sắp đến hạn» là 3 ngày (hằng số). «Hôm nay/Sắp đến hạn» tính theo **giờ công ty** qua helper của US-X-92 (không hard-code múi giờ, không dùng múi máy). «Quá hạn» luôn theo `isOverdue` của server, kể cả khi hạn nằm trong hôm nay. Phím «/» focus ô lọc nhanh theo tiêu đề. Giữ thứ tự sắp xếp của server.
- **Luồng.** Xuất phát trang chủ /. **Trước: 3 thao tác + tự dò ngày, 2 chuyển trang** (thẻ Công việc → «Việc của tôi» → tab Theo dõi/Tôi tạo; `MyTasksPage.tsx:21` chỉ 3 tab nguồn, ngày dạng chuỗi `:35-36`, server không lọc Done `task-core.repository.ts:597-603`). **Sau: 2**, nhóm hiện sẵn; còn 1 chuyển trang khi đi từ dashboard (US-X-04).
- **Tiêu chí chấp nhận.**
  1. Có việc quá hạn, hạn hôm nay (giờ công ty), hạn trong 3 ngày, đang làm không hạn: mỗi việc nằm đúng một nhóm theo thứ tự Quá hạn → Hôm nay → Sắp đến hạn → Đang làm → Chờ kiểm tra → Khác; mỗi nhóm có số đếm. Máy đặt múi UTC lúc 06:30 giờ công ty cho kết quả y hệt. Việc hạn 09:00 hôm nay mà server trả `isOverdue=true` nằm ở «Quá hạn».
  2. Done/Cancelled ẩn mặc định. Bật «Hiện việc đã xong» thì hiện trong nhóm «Đã xong», URL có `showDone=1`.
  3. Chọn chip «Theo dõi» rồi tải lại hoặc mở lại link: vẫn chỉ hiện việc theo dõi.
  4. Tài khoản chưa liên kết hồ sơ nhân viên, hoặc không có việc: trạng thái rỗng có hướng dẫn.
  5. Không có `read:task`: màn «không có quyền» như hiện tại, không gọi API.
- **Zone.** FE trình bày và lọc client-side trên DTO sẵn có.
- **Dẫn chứng.** `routes/tasks/MyTasksPage.tsx:21,58-72,108-150`; `apps/api/src/tasks/task-core.repository.ts:567-605`.

##### US-TASK-NV-02 · «Việc của tôi» tải nhẹ: server mặc định bỏ việc đã đóng, có trần
**P1 · S · 🟡 yellow** · Lớp BE, FE · Phụ thuộc: US-TASK-NV-01 · Spec: SPEC-06 §13.9, TASK-API-210

- **Story.** Là nhân viên đã dùng hệ thống nhiều tháng, tôi muốn «Việc của tôi» vẫn mở nhanh dù tôi đã xong hàng trăm việc.
- **Cơ chế.** `GET /tasks/my` nhận `includeClosed` (mặc định false; boolean theo khuôn `taskCoreOptionalBooleanParam`). Nhánh việc đã đóng có trần số dòng (hằng số, vd 200). Phản hồi **giữ là mảng trần**; báo bị cắt bằng header `X-Truncated`, hoặc FE tự suy khi độ dài bằng trần. Việc đã đóng chỉ tải khi bật «Hiện việc đã xong». Vẫn qua `withTenant`, giữ 3 điều kiện nguồn.
- **Luồng.** Không đổi số thao tác. Hiện `findMyTasksTx` không có LIMIT và không lọc Done/Cancelled, nên mỗi lần mở trang tải toàn bộ lịch sử.
- **Tiêu chí chấp nhận.**
  1. 500 việc Done + 15 việc mở, gọi không tham số: trả 15 việc.
  2. `includeClosed=true`: có việc đã đóng nhưng không vượt trần, có tín hiệu bị cắt khi vượt.
  3. `includeClosed=abc`: 400 (Zod), không 500.
  4. Không trả dòng của công ty khác (int-spec cross-tenant với `LANE_DB`).
  5. FE cũ không gửi tham số vẫn parse được phản hồi (deploy lệch pha an toàn).
- **Zone.** Đổi contract và query đọc của luồng task. Không đổi quyền hay schema; index `idx_tasks_assignee_status_due` đã có.
- **Dẫn chứng.** `task-core.repository.ts:567-605`; `MyTasksPage.tsx:58-63`; `packages/web-core/src/lib/task-core-api.ts:33-35`; `apps/api/migrations/0478_s4_taskdb1_task_core.sql:373`. Chỉ `MyTasksPage` gọi `getMyTasks`; widget dashboard và /me có handler riêng.

##### US-TASK-NV-03 · Đổi trạng thái việc ngay trên dòng danh sách
**P0 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: — (nên làm cùng US-TASK-NV-13) · Spec: SPEC-06 §13.5, §13.9, §14.16; DECISIONS-03

- **Story.** Là nhân viên, tôi muốn bấm badge trạng thái ngay trên dòng ở Việc của tôi / Danh sách / Quá hạn để chuyển Đang làm → Chờ kiểm tra / Hoàn thành, để cập nhật trong 2 chạm mà không rời trang.
- **Cơ chế.** Dùng lại `TaskStatusField`/`BadgeSelect` của `TaskInlineFields` trên dòng `MyTasksPage`, cột Trạng thái của `TaskListPage` và `OverdueTasksPage`. Gọi route change-status sẵn có, lạc quan và rollback khi lỗi. Menu chỉ có chuyển trạng thái hợp lệ theo `task-fsm.ts`: từ Cancelled không có In Review/Done; Done được mở lại theo D-18. Lỗi `TASK-ERR-CHECKLIST-REQUIRED` hiện dưới dòng kèm link mở tab Checklist. Lưu xong thì invalidate `taskKeys.my()` và list.
- **Luồng.** /tasks/my-tasks. **Trước: 7 thao tác, 3 chuyển trang** (tiêu đề → /tasks/:id → badge → Đang làm; xong thì badge → Hoàn thành → Quay lại (về /tasks, `router.tsx:1574`) → sidebar Việc của tôi). **Sau: 4, 0 chuyển trang** (badge → Đang làm; badge → Hoàn thành).
- **Tiêu chí chấp nhận.**
  1. Việc Todo tôi phụ trách: chọn «Đang làm» trên dòng thì badge đổi ngay, việc sang nhóm Đang làm, server ghi activity và audit như khi đổi trong chi tiết.
  2. Checklist bắt buộc chưa xong mà chọn «Hoàn thành»: rollback, dòng hiện «Cần hoàn tất checklist» kèm link tab Checklist.
  3. Việc Cancelled chỉ có Todo/Đang làm. Việc Done có các trạng thái mở lại theo D-18.
  4. Việc thuộc dự án pipeline: đổi trạng thái thì cột trên board đổi theo (server đồng bộ qua `changeStatusTx`), không cần F5.
  5. Server trả 403 (tôi chỉ theo dõi): rollback và hiện «Bạn không có quyền đổi trạng thái việc này», không tải lại cả danh sách.
  6. Mất mạng: rollback, có Thử lại.
- **Zone.** Chạm FSM ở FE nhưng chỉ gọi route sẵn có; không đổi FSM, quyền hay schema.
- **Dẫn chứng.** `MyTasksPage.tsx:22-46,73`; `TaskInlineFields.tsx:167-186`; `task-columns.tsx:20-32`; `apps/api/src/tasks/task-fsm.ts:30-31`; `router.tsx:1564-1576`.

##### US-TASK-NV-04 · Drawer chi tiết việc tại chỗ ở mọi bề mặt; quay lại về đúng chỗ cũ
*Gộp từ: US-X-02.* · **P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: S5-TASK-BOARD-UX-1; SPEC-06 §13.7

- **Story.** Là nhân viên hay quản lý, tôi muốn mở một việc từ danh sách, thông báo, dashboard hay mục tiêu dưới dạng panel trượt bên phải, đổi trạng thái hay bình luận xong thì đóng lại vẫn đứng ở chỗ cũ, giữ nguyên bộ lọc và vị trí cuộn.
- **Cơ chế.**
  - Mount `TaskDetailDrawer` **một lần** ở `ProtectedShell`. Drawer đọc `?task=<uuid>` từ `location.search` (không phụ thuộc `validateSearch` của từng route) và kiểm UUID trước khi gọi API.
  - `ProjectDetailPage` bỏ drawer riêng, hoặc shell bỏ qua khi route đã tự xử lý `?task=`, để chỉ còn một instance.
  - Mở là push, đóng là replace.
  - Các điểm mở việc chỉ thêm `?task=` vào URL hiện tại: `task-columns` nhận `onOpen`, `MyTasksPage.openTask`, `OverdueTasksPage`, `ProjectTaskListTab` (truyền `onOpenTask`), `NotificationTargetLink` với `/tasks/<uuid>`, việc liên kết ở mục tiêu.
  - Việc con trong `TaskSubtaskPanel` thay `?task=` ngay trong drawer.
  - Nút «Mở toàn trang» giữ đường `/tasks/:id`. Nút `onBack` của trang chi tiết gọi `history.back()` khi có lịch sử trong app, nếu không thì về `/tasks/my-tasks`.
  - Màn hẹp hơn md: drawer việc ưu tiên, drawer chat thu lại.
- **Luồng.**
  - (a) Từ danh sách, xuất phát /tasks/my-tasks. **Trước: 3, 3 chuyển trang** (tiêu đề → Quay lại về /tasks → sidebar). **Sau: 2, 0 chuyển trang** (tiêu đề → Esc).
  - (b) Từ thông báo, xuất phát /goals/G. **Trước: 5, 2 chuyển trang** khi dùng Back trình duyệt; **8, 4 chuyển trang** khi dùng nút «Quay lại» của app. **Sau: 4, 0 chuyển trang** (chuông → dòng → mở + chọn trạng thái → Esc).
- **Tiêu chí chấp nhận.**
  1. Ở /tasks/my-tasks đang lọc «Hôm nay», bấm một việc: URL có `?task=<id>`, danh sách giữ nhóm và vị trí cuộn.
  2. Esc hoặc Back trình duyệt đóng drawer, URL bỏ `?task=`, bộ lọc còn nguyên.
  3. Ở /goals/G bấm thông báo TASK_ASSIGNED của T: URL thành `/goals/G?task=T`, trang mục tiêu vẫn nằm dưới drawer.
  4. Ở `/tasks/projects/P?task=T` chỉ có **một** drawer việc.
  5. `?task=` không phải UUID thì không gọi API. T không tồn tại, đã xoá mềm, thuộc công ty khác hoặc ngoài phạm vi đọc: **cùng một** thông điệp «Không mở được việc này», không hiện tiêu đề hay mã việc; danh sách phía sau vẫn dùng được.
  6. Vào `/tasks/T` từ tab mới (không có lịch sử) rồi bấm Quay lại: về `/tasks/my-tasks`. Có lịch sử thì về trang trước.
  7. Trong drawer việc cha bấm một việc con: drawer chuyển sang việc con, Back trở lại việc cha.
  8. Màn hẹp và drawer chat đang mở: drawer chat thu lại, drawer việc hiện trên cùng.
- **Zone.** FE thuần, tái dùng component và endpoint sẵn có; quyền do guard BE và `useCan` trong `TaskDetailContent` quyết.
- **Dẫn chứng.** `routes/tasks/TaskDetailDrawer.tsx:1-40`; `ProjectDetailPage.tsx:515-522,697-704,755`; `MyTasksPage.tsx:73-75`; `task-columns.tsx:20-32`; `TaskSubtaskPanel.tsx:133`; `router.tsx:1566-1574`; `NotificationTargetLink.tsx:51`.
- **Ghi chú.** Nền cho TASK-QL-05/07/08, GOAL-QL-14, X-03, X-05, X-07, X-11, X-14.

##### US-TASK-NV-05 · Tạo nhanh việc cá nhân một dòng, mặc định giao cho chính mình
**P0 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-NV-08 · Spec: SPEC-06 §13.6, TASK-FUNC-008

- **Story.** Là nhân viên, tôi muốn gõ tiêu đề rồi Enter ngay đầu «Việc của tôi» để tạo việc cho mình (tuỳ chọn gắn hạn), mà không mở form, không tìm tên mình trong danh sách nhân viên, không bị lỗi «không có quyền».
- **Cơ chế.** Ô quick-add đầu `MyTasksPage` theo mẫu `KanbanQuickCreate`: Enter tạo, ô vẫn mở để nhập tiếp; phím «n» focus ô. Người phụ trách = `employeeId` của tôi (`/me` employee link), không cần `read:employee`. Chip hạn (NV-08) «dính» cho lượt sau. Ở `TaskFormDrawer`: khi không chọn dự án thì mặc định người phụ trách là tôi, và luôn có lựa chọn «Tôi» dù dropdown nhân viên rỗng. 403 thiếu người phụ trách hiện «Hãy chọn người phụ trách trong phạm vi của bạn». Thêm nút «Tạo việc» trên trang. Component tạo nhanh dùng chung với US-X-05.
- **Luồng.** /tasks/my-tasks. **Trước: 9, 2 chuyển trang** (Danh sách → Tạo → tiêu đề → mở Người phụ trách → chọn mình (rỗng nếu thiếu `read:employee`) → ô hạn → chỉnh giờ → Lưu → Việc của tôi; thiếu người phụ trách thì 403). **Sau: 3, 0 chuyển trang** (tiêu đề → chip «Hôm nay» → Enter).
- **Tiêu chí chấp nhận.**
  1. Phạm vi tạo Own, không có `read:employee`: gõ tiêu đề + Enter thì việc tạo với người phụ trách là tôi, hiện ngay trong nhóm phù hợp, ô trống và vẫn focus.
  2. Form Tạo không chọn dự án thì người phụ trách điền sẵn là tôi, đổi được.
  3. Server vẫn trả 403 vì thiếu người phụ trách: lỗi hiện tại ô Người phụ trách với hướng dẫn cụ thể.
  4. Tài khoản chưa liên kết hồ sơ: ô quick-add ẩn hoặc vô hiệu kèm giải thích, không gửi request.
  5. Tiêu đề rỗng hoặc quá dài: không gửi, lỗi tại ô.
- **Zone.** FE gọi `POST /tasks` sẵn có; BE vẫn tự kiểm phạm vi người phụ trách. Không nới quyền.
- **Dẫn chứng.** `TaskFormDrawer.tsx:44-51,80-91,214-222`; `apps/api/src/tasks/task-core.service.ts:465-476`; `KanbanQuickCreate.tsx`; `contracts/src/me.ts:121-127`.

##### US-TASK-NV-06 · Nhắc việc sắp đến hạn/quá hạn chạy đúng cho việc SPEC-06
*Gộp từ: US-TASK-QL-02.* · **P0 · M · 🟡 yellow** · Lớp BE · Phụ thuộc: — · Spec: SPEC-06 §14.17, NOTI-EVENT-004/005 · **Owner quyết người nhận và deep-link (§7 Q6, Q7)**

- **Story.** Là nhân viên, tôi muốn được báo trước khi việc đến hạn và khi đã quá hạn, để không lỡ deadline. Là quản lý, tôi muốn hệ thống tự nhắc thay vì tôi rà danh sách mỗi sáng.
- **Cơ chế.** Sửa `queryDue` của `TaskReminderJobHandler`:
  - đọc `due_at` và `task_status` (bỏ Done/Cancelled; NULL coi như Todo) cùng `main_assignee_employee_id`, resolve sang `user_id` qua `employee_profiles`;
  - giữ nhánh `assignee_user_id` để tương thích ngược;
  - giữ cửa sổ 24h, `task_type='office'`, `deleted_at IS NULL`, `withTenant` từng công ty;
  - đổi dedupe thành (việc, sự kiện, mốc `due_at`): đổi hạn thì được nhắc lại, mốc cũ không nhắc trùng;
  - lỗi một việc không chặn các việc khác, metadata job ghi đúng số failed.
  
  Đích thông báo vẫn là template hiện hành `/tasks/my-tasks`; mở thẳng đúng việc cần sửa template, là WO red riêng. Thêm reporter vào danh sách nhận `TASK_OVERDUE` chỉ làm khi owner chốt.
- **Luồng.** **Trước:** không bao giờ có nhắc (job lọc cột legacy `due_date/status/assignee_user_id` mà task core không ghi). NV phải tự mở: 3 thao tác, 2 chuyển trang. QL tự rà và @nhắc: 6 thao tác/việc. **Sau:** NV bấm thông báo → bấm việc = **2**, 1 chuyển trang (1 thao tác nếu làm WO sửa template). QL: **0**.
- **Tiêu chí chấp nhận.**
  1. Việc office giao cho tôi, `due_at` trong 24h, chưa Done/Cancelled: tôi nhận đúng một `TASK_DUE_SOON`.
  2. Đã quá hạn, job chạy nhiều lần trong ngày: một `TASK_OVERDUE` cho mốc hạn đó. Đổi hạn rồi lại quá hạn thì được nhắc lại.
  3. Việc Done, Cancelled, xoá mềm, không hạn hoặc không người phụ trách: không phát.
  4. Chạy cho công ty A không đọc và không phát cho công ty B (`withTenant`, int-spec với `LANE_DB`).
  5. Engine ném lỗi ở một việc: các việc khác vẫn xử lý, kết quả ghi đúng số failed, không nuốt lỗi.
  6. Int-spec tạo việc qua task-core (không insert cột legacy).
- **Zone.** Job NOTI của task; không cần migration (index `(company_id, main_assignee_employee_id, task_status, due_at)` đã có ở 0478:374).
- **Dẫn chứng.** `apps/api/src/notifications/task-reminder.job-handler.ts:15-22,51-54,104-129`; `task-core.repository.ts:661-680`; `migrations/0478_s4_taskdb1_task_core.sql:336,374`; `migrations/0497_s5_notifix1_backfill_target_url_template.sql:84-93`; `dashboard-cache-invalidation.const.ts:94-100`.

##### US-TASK-NV-08 · Mốc hạn nhanh: Hôm nay / Ngày mai / Thứ Sáu / Tuần sau / Xoá hạn
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-X-92 · Spec: SPEC-06 §13.6–13.7

- **Story.** Là nhân viên, tôi muốn đặt hoặc dời hạn bằng một chạm vào mốc có sẵn, để không phải chỉnh ô ngày giờ và không mất thay đổi vì quên rời ô.
- **Cơ chế.** Popover hạn dùng chung cho `TaskInlineFields`, `TaskFormDrawer`, quick-add, `SubtaskInlineControls`, trang Quá hạn và thao tác hàng loạt. Chip: Hôm nay 17:00 · Ngày mai 17:00 · Thứ Sáu này 17:00 · Thứ Hai tuần sau 17:00 · Xoá hạn · «Tuỳ chỉnh» (datetime-local). Bấm chip là lưu ngay qua route change-deadline (lạc quan). Mốc tính theo giờ công ty bằng `deadlineAt`/`todayLocal` của US-X-92, lưu UTC; giờ mặc định là hằng số. Chỉ gọi route chuyên trách change-deadline.
- **Luồng.** Chi tiết việc. **Trước: 4** (ô hạn → ngày → giờ → rời ô). **Sau: 2** (ô hạn → «Ngày mai»).
- **Tiêu chí chấp nhận.**
  1. Thứ Năm 22/10/2026 giờ VN, «Thứ Sáu này» thì hạn là 23/10 17:00 VN (10:00 UTC).
  2. Hôm nay là Thứ Sáu thì chip «Thứ Sáu này» ẩn hoặc thành Thứ Sáu tuần sau, không đặt hạn vào quá khứ.
  3. Sau 17:00 VN thì «Hôm nay 17:00» ẩn (hoặc thành 23:59), không tạo việc quá hạn ngay khi đặt.
  4. `start_at` sau mốc chọn: server trả lỗi CHECK, rollback, thông báo dễ hiểu.
  5. 403: rollback và báo lỗi. Có `allowedActions` (NV-13) thì popover không mở.
  6. «Xoá hạn»: việc rời nhóm Quá hạn/Hôm nay.
- **Zone.** Component FE dùng chung, route sẵn có.
- **Dẫn chứng.** `TaskInlineFields.tsx:325-363`; `TaskFormDrawer.tsx:255-266`; `SubtaskInlineControls.tsx:253`; `migrations/0478…sql:364-365`.

##### US-TASK-NV-10 · Nhập liên tiếp việc con và checklist, dán nhiều dòng thành nhiều mục
**P1 · M · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-06 §14.16, §14.21, DECISIONS-05

- **Story.** Là nhân viên, tôi muốn chia việc thành vài việc con và vài mục checklist bằng cách gõ rồi Enter liên tục, hoặc dán danh sách nhiều dòng, để không mở/đóng hộp thoại cho từng mục.
- **Cơ chế.** Việc con: ô nhập inline cuối danh sách thay `AddSubtaskDialog`; Enter tạo, ô giữ focus; Esc thoát. Checklist: chưa có checklist thì ô «Thêm mục» vẫn hiện; mục đầu tiên tạo nhóm «Checklist» qua API create checklist với `items[]` (tối đa 50). Dán văn bản nhiều dòng thì mỗi dòng không rỗng thành một mục; quá 50 dòng thì báo lỗi, không gửi.
- **Luồng.** Chi tiết việc, thêm 3 mục checklist + 3 việc con. **Trước: 20** (checklist: tab → Thêm checklist → tên → xác nhận → 3×(nhập+Enter) = 10; việc con: tab → 3×(mở dialog+nhập+Lưu) = 10). **Sau: 10** (checklist: tab → dán 3 dòng → Enter = 3; việc con: tab → 3×(nhập+Enter) = 7).
- **Tiêu chí chấp nhận.**
  1. Chưa có checklist, gõ một mục + Enter: tạo nhóm «Checklist» chứa mục đó trong một request.
  2. Dán 5 dòng (1 dòng trống): tạo 4 mục đúng thứ tự.
  3. Dán 60 dòng: không gửi, lỗi «tối đa 50 mục mỗi lần».
  4. Việc con: Enter tạo, ô trống và vẫn focus; Esc đóng ô.
  5. 403 khi tạo: ô giữ nội dung đã gõ và hiện lỗi. Không có quyền thì ô nhập không hiện.
- **Zone.** FE dùng API sẵn có (`items[]` đã có trong contract); không đổi quy tắc đếm lá.
- **Dẫn chứng.** `TaskChecklistPanel.tsx:105,148-163,226-275`; `contracts/src/task-collab.ts:139-149`; `TaskSubtaskDialogs.tsx:115-188`; `TaskDetailContent.tsx:310`.

##### US-TASK-NV-11 · Bình luận: Ctrl+Enter để gửi, gợi ý @ từ người tham gia việc
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-06 §14.14 (TASK-FUNC-014)

- **Story.** Là nhân viên không có quyền xem danh bạ, tôi muốn gõ @ là thấy người phụ trách, người giao, người theo dõi (và thành viên dự án nếu tôi được xem), rồi gửi bằng Ctrl+Enter, để nhắc đúng người mà không rời bàn phím.
- **Cơ chế.** Nguồn gợi ý là hợp các **employee id** đã có trong chi tiết việc: `mainAssigneeEmployeeId/assigneeName`, `reporterEmployeeId/reporterName`, watchers `employeeId/employeeName`, cộng thành viên dự án nếu đọc được. Danh bạ HR chỉ là nguồn bổ sung khi có `read:employee`. Bỏ chính mình và mục không tên. Ctrl/Cmd+Enter gửi, Enter xuống dòng. Server resolve mention như hiện tại.
- **Luồng.** Tab Bình luận. **Trước: 4** (ô → nhập «@ten» → chọn gợi ý (không hiện khi thiếu `read:employee`) → Gửi). **Sau: 3** (ô → nhập kèm chọn gợi ý → Ctrl+Enter), và @ dùng được với mọi NV.
- **Tiêu chí chấp nhận.**
  1. Không có `read:employee`, việc có A phụ trách, B giao, C theo dõi: gõ «@» thì gợi ý A, B, C (trừ tôi), lọc theo ký tự gõ tiếp.
  2. Có `read:employee`: người tham gia việc xếp trước, kết quả danh bạ xếp sau.
  3. Ctrl+Enter (Cmd+Enter trên macOS) gửi và xoá ô. Enter xuống dòng.
  4. Ô rỗng hoặc chỉ có khoảng trắng: không gửi.
  5. Server từ chối mention hoặc 403: giữ nội dung đã gõ, hiện lỗi.
- **Zone.** FE dùng dữ liệu đã được phép đọc, không gọi thêm API nhạy cảm.
- **Dẫn chứng.** `TaskCommentThread.tsx:177-224,398,412-417`; `contracts/src/task-collab.ts:91`; `contracts/src/task-actions.ts:79-80`.
- **Ghi chú.** Thông báo bình luận chưa kèm `comment_id` (template 0497:86). Sửa phần đó là red; FE đã đọc `?comment_id`.

##### US-TASK-NV-13 · Chỉ hiện nút sửa khi tôi thật sự sửa được việc đó
**P1 · M · 🟠 amber** · Lớp BE, FE · Phụ thuộc: — · Spec: FRONTEND-11 §allowed_actions, SPEC-06 §13.7

- **Story.** Là nhân viên, ở việc tôi chỉ theo dõi, tôi muốn trạng thái, hạn và người phụ trách hiện dạng chỉ đọc thay vì cho bấm rồi báo lỗi.
- **Cơ chế.** Chi tiết việc (và dòng danh sách nếu chi phí truy vấn cho phép) trả `allowedActions` (changeStatus, changeDeadline, assign, changePriority, edit, delete). Server tính bằng chính `PermissionService` và scope hiện có, không thêm cặp quyền. FE dùng để quyết định ô sửa được hay chỉ đọc; thiếu trường thì quay về `useCan`.
- **Luồng.** Chi tiết một việc tôi chỉ theo dõi. **Trước: 3 thao tác vô ích** (badge → chọn → 403 + rollback). **Sau: 0** (chỉ đọc kèm tooltip lý do).
- **Tiêu chí chấp nhận.**
  1. Tôi là người phụ trách X: `allowedActions` có `changeStatus`, badge bấm được.
  2. Tôi chỉ theo dõi Y: badge, hạn, người phụ trách chỉ đọc kèm «Bạn chỉ theo dõi việc này»; bình luận vẫn dùng được.
  3. `allowedActions` nói được phép nhưng quyền vừa bị thu hồi: server vẫn 403, FE rollback; guard BE không bị nới.
  4. Việc công ty khác vẫn 404; `allowedActions` không làm lộ sự tồn tại.
  5. API cũ không có trường: FE dùng `useCan`, không vỡ.
- **Zone.** BE đọc kết quả `PermissionService` để trình bày; cần security-reviewer xác nhận `allowedActions` khớp guard thật. Không khớp thì dừng và tách WO red.
- **Dẫn chứng.** `TaskInlineFields.tsx:167-186,325-330,366-374`; `docs/FRONTEND/FRONTEND-11_Task_Frontend.md:881`; `contracts/src/task.ts` (chưa có `allowedActions`).

##### US-TASK-NV-91 · «Chuyển sang cột…» trên thẻ board cho điện thoại và bàn phím *(bổ sung khi tổng hợp)*
**P1 · S · 🟡 yellow** · Lớp FE · Phụ thuộc: — · Spec: SPEC-06 §13.8; DECISIONS-03

- **Story.** Là nhân viên dùng web di động (hoặc chỉ dùng bàn phím), tôi muốn đổi cột một việc trên board bằng menu ⋯ của thẻ, vì kéo-thả không chạy trên cảm ứng.
- **Cơ chế.** Thẻ board có nút ⋯ với mục «Chuyển sang cột…», danh sách cột của dự án (chế độ status thì là danh sách trạng thái hợp lệ). Gọi move-state/change-status sẵn có, lạc quan + rollback giống kéo-thả. Chỉ hiện khi thẻ kéo được (`canDrag`, cùng điều kiện quyền). Mở bằng Enter/Space, có `aria-label`.
- **Luồng.** Board trên điện thoại. **Trước: 4** (mở thẻ → mở ô cột trong panel → chọn → đóng). **Sau: 2** (⋯ → chọn cột).
- **Tiêu chí chấp nhận.**
  1. Thẻ kéo được: ⋯ → «Chuyển sang cột Chờ duyệt» thì thẻ dời cột ngay; cột khác nhóm thì trạng thái được server đồng bộ.
  2. Không có quyền kéo: không có mục «Chuyển sang cột…».
  3. Server từ chối: thẻ về cột cũ, hiện lý do.
  4. Dùng bàn phím: Tab tới thẻ → mở menu → chọn được cột, focus quay lại thẻ.
- **Zone.** Luồng task, route sẵn có, không đổi FSM.
- **Dẫn chứng (đã kiểm 23/10).** `routes/tasks/TaskKanbanPage.tsx:152-199` (thẻ chỉ có `draggable` HTML5), `:618-628` (`onDrop`); `apps/api/src/tasks/tasks.controller.ts:421` (move-state).

##### US-TASK-NV-92 · Đính kèm nhiều tệp một lần, kéo-thả hoặc dán ảnh vào việc *(bổ sung khi tổng hợp)*
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: — (trên PROD cần `S19-OPS-STORAGEPUBLIC-1`) · Spec: SPEC-06 TASK-FUNC-015

- **Story.** Là nhân viên, tôi muốn kéo 3 ảnh chụp màn hình vào việc (hoặc chọn nhiều, hoặc dán từ clipboard) trong một lần.
- **Cơ chế.** `TaskFilePanel`: input `multiple`; vùng thả tệp; dán ảnh từ clipboard. Mỗi tệp đi đúng luồng tải hiện có (một request mỗi tệp, giới hạn đồng thời là hằng số). Kiểm kích thước và kiểu theo từng tệp. Ô danh mục vẫn tuỳ chọn. Mẫu kéo-thả lấy từ CHAT (S17-CHAT-UX2). Không đụng phần **mở** tệp (thuộc `S16-SOCIAL-FILEOPENUX-1`).
- **Luồng.** Chi tiết việc, tải 3 ảnh. **Trước: 6** (3×(Tải lên → chọn tệp)). **Sau: 1** (kéo 3 tệp vào) hoặc 2 (Tải lên → chọn nhiều).
- **Tiêu chí chấp nhận.**
  1. Thả 3 tệp hợp lệ: 3 tệp tải song song có giới hạn, mỗi tệp có tiến độ riêng, xong thì hiện trong danh sách.
  2. Một tệp sai kiểu hoặc quá cỡ: chỉ tệp đó báo lỗi kèm tên, các tệp khác vẫn tải.
  3. Dán ảnh từ clipboard khi panel đang focus thì tải như một tệp.
  4. Không có quyền tải tệp: không có vùng thả, không có nút.
- **Zone.** FE thuần, dùng luồng tải sẵn có.
- **Dẫn chứng (đã kiểm 23/10).** `routes/tasks/TaskFilePanel.tsx:259-275` (danh mục tuỳ chọn), `:307-313` (`type="file"` không `multiple`).

##### US-TASK-NV-93 · «Việc rơi vào kỳ nghỉ» ngay trên đơn nghỉ của tôi: bàn giao trước khi nghỉ *(bổ sung khi kiểm độ phủ)*
**P1 · S · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-NV-04, US-TASK-NV-08, US-X-92 (nên có US-TASK-NV-11 cho Ctrl+Enter) · Spec: SPEC-05 (đơn nghỉ của tôi); SPEC-06 §13.9, §14.9, §14.14

- **Story.** Là nhân viên vừa gửi hoặc vừa được duyệt đơn nghỉ 27–31/10, tôi muốn thấy ngay trên đơn những việc của tôi đến hạn trong kỳ nghỉ và xử lý từng việc tại chỗ (dời hạn, báo người giao, đổi người nếu tôi được phép giao), để không ai phải phát hiện muộn khi tôi đã vắng mặt.
- **Cơ chế.**
  - Trên `LeaveRequestDetailPage`, chỉ với đơn **của chính tôi**, trạng thái Pending/Approved, `endDate ≥ hôm nay`: khối «Việc đến hạn trong kỳ nghỉ (N)».
  - Dữ liệu lấy từ `GET /tasks/my` (cùng query key của TASK-NV-01/02, không thêm endpoint). Lọc ở client: nguồn «Được giao», chưa Done/Cancelled, ngày hạn địa phương (giờ công ty, US-X-92) nằm trong `[startDate, endDate]`.
  - Mỗi dòng có ba lối. Tiêu đề mở drawer `?task=`. «Dời hạn» mở popover mốc nhanh của NV-08, thêm chip **«Sau kỳ nghỉ»** = ngày làm việc kế tiếp sau `endDate` lúc 17:00 (bỏ Thứ Bảy/Chủ Nhật; không tính ngày lễ vì FE chưa có lịch lễ). «Báo người giao» mở drawer ở tab Bình luận với ô soạn có focus; bình luận thường đã tới người giao (§8.1).
  - «Đổi người» chỉ hiện khi `useCan('assign','task')`, gọi route `/assign` sẵn có; `warnings[]` hiện qua QL-91.
  - Không tự dời hạn, không tự giao người: mọi thay đổi đều do người dùng bấm.
- **Luồng.** Đang ở trang chi tiết đơn nghỉ đã duyệt của tôi. Có 3 việc đến hạn trong kỳ nghỉ.
  - **Dời hạn một việc. Trước: 7 thao tác + tự dò ngày, 3 chuyển trang** (sidebar Công việc → «Việc của tôi» → so ngày từng thẻ với kỳ nghỉ bằng mắt, bấm tiêu đề → ô hạn → ngày → giờ → rời ô; `TaskInlineFields.tsx:325-363`). **Sau: 2, 0 chuyển trang** («Dời hạn» → «Sau kỳ nghỉ»).
  - **Báo người giao một việc. Trước: 6, 3 chuyển trang** (sidebar Công việc → «Việc của tôi» → tiêu đề → tab Bình luận → nhập → Gửi). **Sau: 3, 0 chuyển trang** («Báo người giao» → nhập → Ctrl+Enter).
- **Tiêu chí chấp nhận.**
  1. Đơn Approved 27–31/10. Tôi được giao việc hạn 28/10, 30/10 và 05/11, cùng một việc Done hạn 29/10: khối hiện đúng 2 việc (28/10, 30/10), N = 2.
  2. `endDate` là Thứ Sáu 31/10, chọn «Sau kỳ nghỉ»: hạn thành Thứ Hai 03/11 17:00 giờ công ty. Server từ chối (403 hoặc lỗi CHECK `start_at`) thì rollback kèm lý do.
  3. Không có `assign:task`: không có «Đổi người». Có thì gọi `/assign`; người mới đang nghỉ thì cảnh báo theo QL-91.
  4. Đơn Draft/Rejected/Cancelled, hoặc kỳ nghỉ đã qua: không có khối. QL xem đơn của người khác: khối này không hiện (QL dùng US-TASK-QL-92).
  5. Không có `read:task`: không có khối, không gọi `/tasks/my`.
  6. Không có việc nào trong kỳ: «Không có việc nào của bạn đến hạn trong kỳ nghỉ».
  7. `/tasks/my` lỗi: khối báo lỗi riêng kèm «Thử lại»; phần thông tin đơn nghỉ vẫn hiển thị đầy đủ.
- **Zone.** FE trên trang LEAVE: đọc việc của chính mình và gọi route task sẵn có. Không đổi FSM nghỉ phép, quyền hay schema; vàng vì chạm luồng task và màn của luồng phê duyệt.
- **Dẫn chứng (đã kiểm 23/10).** `routes/leave/LeaveRequestDetailPage.tsx:202,312-313,361` (trang chi tiết có `startDate/endDate`, chưa có gì về việc); `routes/tasks/MyTasksPage.tsx:58-63` (`getMyTasks`); `apps/api/src/tasks/task-actions.service.ts:619-659` (cảnh báo nghỉ phép chỉ phát **sau** khi giao); `routes/tasks/TaskInlineFields.tsx:325-363`; §8.1 (bình luận tới người giao).
- **Ghi chú.** Không đếm ngày nghỉ nửa ngày riêng: theo đúng `startDate/endDate` server trả.

#### 5.2.2 TASK — Quản lý

##### US-TASK-QL-01 · Giao việc qua form Tạo hoặc Sửa cũng báo cho người được giao
*Gộp từ: US-TASK-NV-07.* · **P0 · M · 🟡 yellow** · Lớp BE · Phụ thuộc: — · Spec: SPEC-06 NOTI TASK_ASSIGNED (NOTI-EVENT-002), TASK_ASSIGNEE_CHANGED

- **Story.** Là quản lý, khi giao việc bằng form Tạo hoặc đổi người/hạn/ưu tiên bằng form Sửa, tôi muốn người được giao nhận thông báo như khi đổi trong chi tiết. Là nhân viên, tôi muốn luôn được báo khi có việc mới.
- **Cơ chế.** Create (kèm `assigneeEmployeeId` khác người tạo) và PATCH (đổi `mainAssignee`, `dueAt`, `priority`) dùng chung helper phát outbox với `task-actions.service.ts`: `task.assigned`/`task.assignee_changed`, `TASK_DUE_DATE_CHANGED`, `TASK_PRIORITY_CHANGED`. Outbox ghi **cùng transaction** với activity và audit. Payload theo khuôn hiện hành (ID, enum, title, taskCode, actor), không có description. Create trả thêm `warnings[]` (đang nghỉ phép / không phải thành viên) như route `/assign`. Bridge và người nhận giữ nguyên. Không đổi cổng quyền nào.
- **Luồng.** /tasks, QL giao việc mới. **Trước: 15** (form 10 thao tác, rồi mở việc + bình luận @NV 5 thao tác vì create không phát thông báo). **Sau: 10**. Phía NV: **3→1** (bấm thông báo mở thẳng việc).
- **Tiêu chí chấp nhận.**
  1. QL tạo việc với người phụ trách là A: A nhận đúng 1 `TASK_ASSIGNED`; có 1 bản ghi outbox `task.assigned` cùng tx với bản ghi task.
  2. Tự tạo việc cho chính mình, hoặc không có người phụ trách: không có thông báo giao việc.
  3. Đổi người phụ trách A→B qua form Sửa: B nhận `TASK_ASSIGNEE_CHANGED`, người nhận khớp route `/assign` (người mới ∪ watchers), QL không tự nhận.
  4. PATCH chỉ đổi tiêu đề hoặc mô tả: không phát sự kiện giao việc.
  5. Ghi task lỗi giữa chừng (400/403), tx rollback: không còn bản ghi outbox nào.
  6. Người được giao đang nghỉ phép: response có `ASSIGNEE-ON-LEAVE`; int-spec xác nhận payload outbox không có description.
- **Zone.** Thêm phát sự kiện vào luồng task sẵn có; không đổi schema hay cặp quyền.
- **Dẫn chứng.** `apps/api/src/tasks/task-core.service.ts:540-600,692-710`; `task-actions.service.ts:140-172,278,348,416`; `apps/api/src/notifications/task-noti-bridge.registrar.ts:34-46`.

##### US-TASK-QL-03 · Chọn nhiều việc rồi giao người, dời hạn hoặc đổi trạng thái một lần
**P0 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-NV-08, US-X-91 · Spec: SPEC-06 §14.9

- **Story.** Là quản lý, tôi muốn tích chọn nhiều việc rồi giao cho một người, dời hạn hoặc đổi trạng thái bằng một lệnh, để khi có người nghỉ phép hay đổi kế hoạch thì không phải mở từng thẻ.
- **Cơ chế.**
  - Thêm prop `rowSelection` (additive) cho `DataTable` ở `packages/ui`.
  - `TaskListPage` và `ProjectTaskListTab`: khi có dòng được chọn thì hiện thanh hành động nổi gồm «Giao cho…», «Dời hạn» (mốc nhanh của NV-08), «Đổi trạng thái», «Chuyển cột» (dự án pipeline).
  - FE gọi lặp **route action chuyên trách** (`/assign`, change-deadline, change-status, move-state) bằng `Promise.allSettled`, giới hạn đồng thời là hằng số (vd 5), tối đa 50 việc.
  - Mỗi việc có audit và activity riêng. Báo kết quả theo từng dòng. Chưa làm endpoint bulk.
- **Luồng.** /tasks, chuyển 6 việc của NV nghỉ phép. **Trước: 26, 0 chuyển trang** (lọc người 2; mỗi việc: Sửa → mở Select → chọn → Lưu, ×6 = 24; người mới cũng không được báo). **Sau: 7** (lọc người 2 → Chọn tất cả → «Giao cho…» → gõ → chọn → Xác nhận).
- **Tiêu chí chấp nhận.**
  1. Chọn 6 việc → «Giao cho B»: 6 lời gọi `/assign`, mỗi việc 1 activity + 1 audit, B nhận thông báo cho từng việc.
  2. 2/6 trả 403/404: hiện «4/6 thành công». 2 dòng lỗi vẫn được chọn, mỗi dòng chỉ ghi «Không thực hiện được» (không phân biệt không tồn tại hay không có quyền). 4 dòng thành công cập nhật không cần F5.
  3. Không có `assign:task`: không có «Giao cho…»; các hành động khác theo đúng quyền tương ứng.
  4. Chưa chọn dòng nào thì thanh không hiện. Chọn quá 50 thì nút xác nhận bị khoá kèm lời giải thích.
  5. Người được giao đang nghỉ phép: cảnh báo tổng hợp từ `warnings[]` (vd «3 việc: B đang nghỉ phép»).
- **Zone.** Luồng task gọi lại endpoint sẵn có; không thêm endpoint bulk, không đổi quyền hay schema.
- **Dẫn chứng.** `apps/api/src/tasks/tasks.controller.ts:365-460`; `packages/ui/src/components/ui/data-table.tsx:27-41`; `components/EmployeeMultiPickerDialog.tsx:19,143` (khuôn allSettled, chưa có giới hạn đồng thời); `ProjectTaskListTab.tsx:179-191`; `TaskListPage.tsx:116-143`.

##### US-TASK-QL-04 · Màn «Đội của tôi»: tải việc và quá hạn theo từng người, xuyên dự án
**P0 · M · 🟠 amber** · Lớp BE, FE · Phụ thuộc: US-TASK-QL-05 (để bấm vào số) · Spec: SPEC-06 §14.17

- **Story.** Là quản lý, tôi muốn một màn liệt kê từng người trong phạm vi tôi quản cùng số việc đang làm, quá hạn, sắp hạn và chờ duyệt (gộp mọi dự án và việc cá nhân), để biết ngay ai quá tải hay trễ.
- **Cơ chế.**
  - BE thêm `GET /tasks/workload`, gate `read:task` (cặp sẵn có), dùng chung bộ dựng data-scope với `GET /tasks`.
  - Truy vấn `GROUP BY main_assignee` trong `withTenant`. Mỗi dòng trả: `activeCount`, `overdueCount`, `dueSoon7dCount`, `inReviewCount`, số ngày trễ của việc trễ lâu nhất. Có thêm một dòng «Chưa giao».
  - Lọc theo `projectId/departmentId`, trần 100 dòng. Contract Zod nằm ở `packages/contracts`.
  - FE: route `/tasks/team` trong sidebar Công việc, sắp theo số quá hạn giảm dần. Bấm một con số thì mở `/tasks?assignee=…&overdue=true`.
- **Luồng.** Xuất phát /, 4 dự án. **Trước: 16, 4 chuyển trang** (mỗi dự án: mở → tab Báo cáo → tab Bảng → tích Quá hạn; widget `TEAM_TASKS_TODAY` đang hoãn). **Sau: 2, 1 chuyển trang** (sidebar «Đội của tôi» → bấm số quá hạn).
- **Tiêu chí chấp nhận.**
  1. QL phạm vi Team với 8 NV: đúng 8 dòng (cộng «Chưa giao» nếu có). Mỗi số bằng đúng kết quả `GET /tasks` cùng bộ lọc.
  2. Người xem phạm vi Own: chỉ có dòng của chính mình, không có «Chưa giao». Người ngoài phạm vi không bao giờ xuất hiện, kể cả khi có việc trong dự án chung.
  3. Mỗi dòng người chỉ có `employeeId` và tên hiển thị. Định nghĩa «người xuất hiện» ghi trong plan, test cả hai chiều.
  4. Không trả dòng của công ty khác (int-spec cross-tenant).
  5. Không có việc mở: «Đội đang không có việc mở». Lỗi mạng: có Thử lại.
  6. Bấm «Quá hạn: 3» ở dòng A: sang danh sách lọc A + quá hạn, thấy đúng 3 việc.
- **Zone.** Endpoint đọc tổng hợp phải áp đúng data-scope; deny-path và cross-tenant là bắt buộc.
- **Dẫn chứng.** `routes/tasks/ProjectReportPage.tsx:150-190`; `contracts/src/task.ts:845-854`; `OverdueTasksPage.tsx:11-23`; `apps/api/src/dashboard/dashboard-widget-catalog.const.ts:145,732-737`.
- **Ghi chú.** Endpoint này dùng lại được cho widget `TEAM_TASKS_TODAY` sau này.

##### US-TASK-QL-05 · Bộ lọc Danh sách và workspace dự án nằm trên URL, kèm ô tìm và chip «Của tôi»
*Gộp từ: US-TASK-NV-12.* · **P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-TASK-NV-04 · Spec: SPEC-06 §13.5 (TASK-SCREEN-005, TASK-FUNC-018), §14.18

- **Story.** Là quản lý (và nhân viên), tôi muốn mở một việc từ danh sách đã lọc rồi đóng lại vẫn thấy đúng bộ lọc, gửi được link bộ lọc, và gõ vài chữ để tìm lại một việc cũ.
- **Cơ chế.**
  - Đưa bộ lọc `TaskListPage` lên URL qua `validateSearch` không ném (tham số rác thì dùng mặc định): status, priority, assignee, project, dueFrom/dueTo, overdue, page.
  - Toolbar và rail của workspace dự án cũng lên URL: q, status, priority, overdue, who.
  - Ô tìm (debounce 300ms, phím «/» để focus) nối với tham số `search` sẵn có của `GET /tasks`.
  - Chip «Của tôi» = `assigneeEmployeeId` của tôi lấy từ /me.
  - Lọc phòng ban (`departmentId`) chỉ hiện khi có `read:department`.
  - Tuỳ chọn nhớ cục bộ bằng `localStorage` có try/catch.
  - Không đụng `MyTasksPage` (thuộc NV-01). Drawer thuộc NV-04.
- **Luồng.** /tasks. **Trước:** mỗi việc 4 thao tác, 2 chuyển trang (mở → Quay lại → lọc lại 2 lần, vì bộ lọc nằm trong `useState`); tìm một việc cũ tối thiểu 5 thao tác, không có ô tìm. **Sau:** mỗi việc 2 thao tác (dòng → Esc); tìm 3 thao tác («/» → nhập → bấm kết quả).
- **Tiêu chí chấp nhận.**
  1. `/tasks?status=In%20Review&project=P`: tải lại hoặc Back từ trang chi tiết toàn trang thì giữ nguyên bộ lọc.
  2. Gõ «báo cáo»: chỉ còn việc khớp (không phân biệt hoa thường) trong phạm vi được xem; URL có `search=`.
  3. Gửi link cho người khác: họ thấy cùng bộ lọc nhưng chỉ thấy việc trong phạm vi của chính họ.
  4. Giá trị rác (`status=abc`, assignee không phải uuid): bỏ qua, dùng mặc định, không 404, back/forward không vỡ.
  5. Không có kết quả: trạng thái rỗng kèm «Xoá bộ lọc».
  6. Không có `read:department`: không có lọc phòng ban, không gọi API phòng ban.
  7. `localStorage` bị chặn: vẫn đúng với bộ lọc lấy từ URL.
- **Zone.** FE list/routing thuần, nối tham số BE đã có; BE vẫn ép data-scope.
- **Dẫn chứng.** `TaskListPage.tsx:62-99,207-220`; `ProjectDetailPage.tsx:551-552`; `contracts/src/task.ts:593-618`; `router.tsx:3128-3140` (mẫu `validateSearch` không ném).

##### US-TASK-QL-06 · Tạo nhanh trong dự án kèm người phụ trách và hạn «dính» cho lượt sau
**P0 · S · 🟢 green** · Lớp FE · Phụ thuộc: — (thông báo giao việc cần US-TASK-QL-01) · Spec: SPEC-06 §11.3, §13.8

- **Story.** Là quản lý, khi tạo nhanh ở đầu cột board, tôi muốn chọn sẵn người phụ trách và hạn, và giữ chúng cho các việc gõ tiếp, để chia việc đầu tuần cho cả nhóm trong một lượt.
- **Cơ chế.** `KanbanQuickCreate` thêm hai chip «Người» (picker có tìm, ưu tiên thành viên dự án) và «Hạn» (mốc nhanh của NV-08). Hai chip giữ giá trị qua các lần Enter, Esc thì xoá. Gửi `assigneeEmployeeId` và `dueAt` trong `POST /tasks` (schema đã nhận). Toolbar workspace thêm «Tạo công việc» mở `TaskFormDrawer` với `defaultProjectId`, để board chế độ status cũng tạo được việc.
- **Luồng.** Board pipeline, 5 việc cho 3 người. **Trước: 36** (+ Thêm, gõ+Enter ×5 = 10, rồi mỗi việc mở thẻ → avatar → gõ → chọn → Esc ×5 = 25). **Sau: 17** (+ Thêm, 3 lần đổi chip Người (mở + chọn = 6), gõ+Enter ×5 = 10).
- **Tiêu chí chấp nhận.**
  1. Chip Người = A, Hạn = Thứ 6, gõ 2 tiêu đề + Enter: 2 việc có người phụ trách A và hạn Thứ 6 (UTC-at-rest). A được báo (sau QL-01).
  2. Không có quyền giao: chip Người không hiện, việc vẫn tạo được (chưa giao). Chip Hạn chỉ hiện khi có quyền đặt hạn.
  3. Người ngoài phạm vi: server từ chối, dòng lỗi «Không giao được cho người này», tiêu đề trả lại vào ô.
  4. Board chế độ status: «Tạo công việc» mở form với dự án điền sẵn, lưu xong thẻ hiện không cần F5.
  5. Esc đóng ô và xoá chip.
- **Zone.** FE gọi `POST /tasks` sẵn có với các trường schema đã nhận.
- **Dẫn chứng.** `routes/tasks/KanbanQuickCreate.tsx:26-80`; `contracts/src/task.ts:625-640`; `TaskKanbanPage.tsx:392,684-691`; `TaskFormDrawer.tsx:199`; `task-core.service.ts:538-539`.

##### US-TASK-QL-07 · Trang Quá hạn thành bàn xử lý: trễ bao lâu, dời hạn và đổi người ngay trên dòng
**P1 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-TASK-NV-04, US-TASK-NV-08 · Spec: SPEC-06 §13.10

- **Story.** Là quản lý, tôi muốn trang Việc quá hạn cho biết mỗi việc trễ bao nhiêu ngày, cho dời hạn hoặc đổi người ngay trên dòng, và lọc theo dự án/người, để mỗi sáng xử lý xong cả đống việc trễ trong vài phút.
- **Cơ chế.** `OverdueTasksPage` thêm cột «Trễ» (số ngày từ `dueAt`, giờ VN; giữ thứ tự `byDueAtAsc`). Ô Hạn có popover mốc nhanh (+1 ngày / +3 ngày / Thứ 6 / chọn ngày) gọi change-deadline. Ô Người là picker gọi `/assign`. Cả hai lạc quan + rollback. Lọc client-side theo Dự án / Người / «Tôi giao» (`creatorUserId = tôi`), vì trang tải trọn tối đa 200 dòng. Bấm tiêu đề mở drawer. Dòng vừa dời hạn rời danh sách sau khi server xác nhận.
- **Luồng.** Mỗi việc trễ. **Trước:** từ /tasks tích Quá hạn rồi Sửa → ô hạn → ngày giờ → Lưu = 4 (đổi người cũng 4); từ trang Quá hạn thì 9 thao tác, 3 chuyển trang. **Sau:** dời hạn 2 (ô Hạn → «+1 ngày»), đổi người 3; 0 chuyển trang.
- **Tiêu chí chấp nhận.**
  1. `dueAt` cách 5 ngày thì cột Trễ hiện «5 ngày», việc trễ lâu nhất vẫn đứng đầu.
  2. «+1 ngày», server trả 200: dòng rời danh sách, người phụ trách nhận `TASK_DUE_DATE_CHANGED`.
  3. 403 hoặc lỗi CHECK `due_at >= start_at`: rollback, dòng ở lại, có thông báo giải thích.
  4. Không có quyền đổi hạn hoặc giao (`useCan`, hoặc `allowedActions` nếu có NV-13): ô Hạn và ô Người chỉ đọc. FE chỉ gọi route chuyên trách.
  5. «Tôi giao» không có kết quả: «Không có việc trễ trong số việc bạn giao».
- **Zone.** FE list + sửa tại ô qua action sẵn có.
- **Dẫn chứng.** `routes/tasks/OverdueTasksPage.tsx:22-23,45-56,98-108`; `TaskInlineFields.tsx:325-363,375-410`; `TaskListPage.tsx:68,116-143`.

##### US-TASK-QL-08 · Hàng đợi «Chờ duyệt» với Hoàn thành và «Trả lại kèm lý do» một bước
**P1 · M · 🟡 yellow** · Lớp FE, BE · Phụ thuộc: US-TASK-NV-04, US-TASK-QL-05 · Spec: SPEC-06 §5.2, §13.5; DECISIONS-03

- **Story.** Là quản lý, tôi muốn một hàng đợi gom các việc Chờ duyệt mà tôi giao (hoặc thuộc dự án tôi quản), có «Hoàn thành» và «Trả lại kèm lý do» trên dòng, để duyệt nhanh cuối ngày mà người làm vẫn biết vì sao bị trả.
- **Cơ chế.** Bộ lọc sẵn «Chờ duyệt» (`status=In Review`), chip «Tôi giao» bật mặc định. BE thêm tham số additive `reporterIsMe` (hoặc `creatorUserId=me`) vào `listTaskCoreQuerySchema`, chỉ **thu hẹp** trong data-scope (vì danh sách phân trang, lọc client sẽ thiếu dòng). «Hoàn thành» gọi đúng action change-status. «Trả lại…» mở popover lý do; FE đổi về In Progress trước, thành công thì đăng lý do thành bình luận. Chỉ là tiện ích giao diện: **không thêm bước duyệt bắt buộc, không dựng FSM duyệt** (SPEC-06 §5.2). Done vẫn mở lại được theo D-18 nên không cần hộp xác nhận nặng.
- **Luồng.** Mỗi việc, /tasks. **Trước: 8, 2 chuyển trang** (mở lọc → chọn → mở việc → badge → chọn → Quay lại → lọc lại 2 lần); trả lại phải đổi trạng thái rồi viết bình luận riêng. **Sau:** duyệt 1; trả lại 3 («Trả lại…» → lý do → Gửi); 0 chuyển trang.
- **Tiêu chí chấp nhận.**
  1. 4 việc In Review do QL giao: chip «Tôi giao» thấy đúng 4 việc (kể cả khi tổng In Review vượt một trang), kèm người làm, dự án, `updatedAt`.
  2. Trả lại kèm lý do: việc về In Progress, bình luận chứa lý do, người làm được báo đổi trạng thái và bình luận.
  3. Lý do trống thì không Gửi được. Đổi trạng thái thành công nhưng bình luận lỗi: giữ lý do, có thử lại riêng cho bình luận.
  4. Không có quyền đổi trạng thái: dòng chỉ có liên kết mở xem. Server vẫn 403 thì rollback.
  5. Checklist bắt buộc chưa xong mà bấm Hoàn thành: `TASK-ERR-CHECKLIST-REQUIRED` dễ hiểu, việc vẫn Chờ duyệt.
  6. `reporterIsMe` rác: 400 (Zod). Không trả dòng công ty khác (int-spec cross-tenant).
  7. Không có việc chờ: «Không có việc chờ bạn duyệt».
- **Zone.** Chạm luồng trạng thái task bằng action sẵn có + thêm một tham số lọc thu hẹp; không đổi quyền, FSM hay schema.
- **Dẫn chứng.** `TaskListPage.tsx:62-72,207-220`; `TaskInlineFields.tsx:167-186,231-276`; `apps/api/src/tasks/task-fsm.spec.ts:30-33`; `contracts/src/task.ts:593-612`; `docs/SPEC/SPEC-06 TASK.md:241`.

##### US-TASK-QL-09 · Báo chủ dự án và quản lý dự án khi một việc chuyển sang Chờ duyệt
**P1 · S · 🟡 yellow** · Lớp BE · Phụ thuộc: — · Spec: SPEC-06 §5.2, NOTI TASK_STATUS_CHANGED; DECISIONS-04

- **Story.** Là quản lý dự án, tôi muốn được báo khi một việc trong dự án tôi quản vào Chờ duyệt (đổi trạng thái hoặc kéo sang cột thuộc nhóm review), để duyệt kịp mà không phải dò cột từng dự án.
- **Cơ chế.** Mở rộng audience `TASK_STATUS_CHANGED` trong `TaskNotiBridgeRegistrar`/`TaskAudienceReader`. Khi trạng thái mới là In Review và việc thuộc dự án, thêm thành viên vai trò Owner/Manager còn hiệu lực (chưa xoá mềm), đọc trong `withTenant`. Kéo sang cột khác nhóm đã đi qua `changeStatusTx` nên đã phát sự kiện; kéo giữa hai cột cùng nhóm review thì không phát (đúng thiết kế). Engine tự loại actor. Không thêm mã sự kiện.
- **Luồng.** **Trước: ~4/dự án** (cây → tab Bảng → tìm cột → mở thẻ), vì audience hiện chỉ có creator ∪ assignee ∪ watchers. **Sau: 1** (bấm thông báo).
- **Tiêu chí chấp nhận.**
  1. Việc thuộc P (Owner QL1, Manager QL2) chuyển In Review: QL1 và QL2 nhận thông báo, người làm (actor) thì không.
  2. Kéo sang cột nhóm review: như trên. Kéo giữa hai cột cùng nhóm review: không phát.
  3. QL2 đã bị gỡ khỏi dự án: không nhận.
  4. Việc không thuộc dự án, hoặc trạng thái mới không phải In Review: người nhận giữ như hiện nay.
  5. QL1 vừa là người tạo vừa là Owner: chỉ nhận 1 thông báo.
  6. Thành viên công ty khác không bao giờ nằm trong danh sách nhận (int-spec cross-tenant).
- **Zone.** Thêm người nhận NOTI cho đúng những người DECISIONS-04 đã cho quản việc; không đổi schema, catalog hay quyền.
- **Dẫn chứng.** `apps/api/src/notifications/task-noti-bridge.registrar.ts:30-46`; `task-core.service.ts:878-888`; `task-actions.service.ts:278`.

##### US-TASK-QL-10 · Báo cáo dự án: quá hạn và sắp hạn theo người, bấm số để mở bảng đã lọc
**P1 · S · 🟡 yellow** · Lớp BE, FE · Phụ thuộc: US-TASK-QL-05 · Spec: SPEC-06 §13.11

- **Story.** Là quản lý, tôi muốn tab Báo cáo cho biết mỗi người bao nhiêu việc quá hạn và sắp hạn, kèm phân bổ theo ưu tiên, và bấm vào số là ra ngay danh sách đó.
- **Cơ chế.** `projectReportSchema` mở rộng additive: `assigneeWorkload` thêm `overdueCount`, `dueSoon7dCount`; thêm `countsByPriority` và `dueSoon7dCount` tổng. Tính bằng cùng truy vấn GROUP BY trong `projects.repository`, không N+1. FE: mỗi số là link sang `?tab=board` (hoặc list) với bộ lọc tương ứng trên URL.
- **Luồng.** **Trước: 4** (Báo cáo chỉ có `activeCount` → tab Bảng → tích Quá hạn → avatar trên rail). **Sau: 2** (Báo cáo → «Quá hạn 3»).
- **Tiêu chí chấp nhận.**
  1. A có 3 việc quá hạn và 2 việc đến hạn trong 7 ngày: dòng A «Quá hạn 3 · Sắp hạn 2», khớp kết quả lọc trên board.
  2. Bấm «Quá hạn 3»: tab Bảng đã lọc người = A + quá hạn, đúng 3 thẻ.
  3. Không có `view-report:project`: tab vẫn ẩn, gọi API thì 403.
  4. Dự án chưa có việc: mọi số bằng 0, không lỗi.
  5. `project_id` giả của công ty khác: 404, không trả số nào.
- **Zone.** DTO báo cáo additive + truy vấn đếm trong gate sẵn có.
- **Dẫn chứng.** `ProjectReportPage.tsx:40-190`; `contracts/src/task.ts:829-858`; `apps/api/src/tasks/projects.controller.ts:189-198`.

##### US-TASK-QL-11 · Danh sách dự án có cột tiến độ và lọc «Có việc quá hạn» / «Tôi phụ trách»
**P1 · M · 🟠 amber** · Lớp BE, FE · Phụ thuộc: — · Spec: SPEC-06 §13.1

- **Story.** Là trưởng phòng, tôi muốn danh sách dự án (kể cả khi mở từ «Xem báo cáo» của phòng ban) hiện số việc, số xong, số quá hạn, % tiến độ và deadline, lọc được dự án có việc quá hạn hoặc do tôi phụ trách, để nắm cả phòng trên một màn.
- **Cơ chế.** `GET /projects` trả thêm `taskTotal`, `taskDone`, `taskOverdue`, `progressPercent` (additive), tính bằng **một** subquery GROUP BY `project_id`. Chỉ đếm việc nằm trong phạm vi đọc task của **người xem**. Thêm tham số `hasOverdue`. FE `ProjectListPage` thêm 4 cột sắp xếp được, chip «Tôi phụ trách» (dùng `ownerEmployeeId` BE đã nhận) và «Có việc quá hạn»; bộ lọc trên URL.
- **Luồng.** **Trước: 19, 7 chuyển trang** (⋯ phòng ban → Xem báo cáo (danh sách không có số) → với 5 dự án: mở → Báo cáo → quay lại). **Sau: 3, 1 chuyển trang** (⋯ → Xem báo cáo → sắp theo cột Quá hạn).
- **Tiêu chí chấp nhận.**
  1. Dự án 20 việc, 12 Done, 3 quá hạn trong phạm vi QL: dòng «20 · 12 xong · 3 quá hạn · 60%» + deadline.
  2. Người xem phạm vi Own chỉ đọc được 4 việc của dự án: số chỉ phản ánh 4 việc đó, không lộ tổng của dự án.
  3. Chip «Có việc quá hạn»: chỉ còn dự án `taskOverdue > 0`; nếu không còn dự án nào thì hiện trạng thái rỗng.
  4. 200 dự án: vẫn một truy vấn gộp (int-spec đếm số truy vấn hoặc kiểm tra plan).
  5. Không cộng dữ liệu công ty khác (int-spec cross-tenant).
- **Zone.** Truy vấn đếm phải áp đúng data-scope của task; không đổi schema hay cặp quyền.
- **Dẫn chứng.** `ProjectListPage.tsx:141-162,~199-250`; `contracts/src/task.ts:489-511`; `layouts/workspace/TaskSidebarTree.tsx`.

##### US-TASK-QL-12 · Đặt checklist «bắt buộc trước khi Hoàn thành» ngay trên giao diện
**P2 · S · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-NV-10 · Spec: SPEC-06 §14.16, TASK-ERR-CHECKLIST-REQUIRED · **Owner quyết ai được tắt cờ (§7 Q8)**

- **Story.** Là quản lý, tôi muốn bật «bắt buộc xong trước khi Hoàn thành» cho checklist, để đặt tiêu chí nghiệm thu rõ ràng cho việc quan trọng.
- **Cơ chế.** Dialog tạo checklist thêm công tắc `isRequiredForDone`. Header checklist có menu bật/tắt qua PATCH checklist. Đổi sang Done khi checklist bắt buộc chưa xong thì `TASK-ERR-CHECKLIST-REQUIRED` hiện kèm số mục còn thiếu. Bật/tắt cờ phải được ghi vào lịch sử hoạt động; nếu BE chưa ghi thì bổ sung trong cùng WO (luồng task, không đổi schema). Dán nhiều dòng thuộc NV-10.
- **Luồng.** **Trước:** không có đường UI nào (dialog luôn gửi `isRequiredForDone: false`). **Sau:** khi tạo 4 thao tác (Thêm checklist → tên → bật Bắt buộc → Xác nhận); với checklist có sẵn 2 thao tác.
- **Tiêu chí chấp nhận.**
  1. Bật «Bắt buộc» khi tạo: checklist có badge Bắt buộc, server lưu `isRequiredForDone=true`.
  2. Còn 2 mục bắt buộc mà người làm đổi sang Hoàn thành: bị từ chối với «Còn 2 mục bắt buộc chưa xong», rollback.
  3. Không có `update:task`: không thấy Thêm checklist và công tắc. Server 403 thì rollback.
  4. Bật/tắt cờ có dòng trong lịch sử hoạt động của việc.
  5. PATCH lỗi mạng: công tắc về giá trị cũ, có Thử lại.
- **Zone.** FE nối API checklist sẵn có. Cờ là một điểm kiểm soát trước Hoàn thành nên phạm vi người được tắt cần owner chốt; khoá theo vai trò dự án là red.
- **Dẫn chứng.** `TaskChecklistPanel.tsx:191-193,226-275,234`; `contracts/src/task-collab.ts:136-155`; `apps/api/src/tasks/task-actions.service.ts:54-62`.

##### US-TASK-QL-13 · Tạo dự án xong vào thẳng Thành viên; lần sau mở lại tab dùng gần nhất
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-06 §13.2, §13.3

- **Story.** Là quản lý, tôi muốn tạo dự án xong là vào thẳng dự án với hộp thêm thành viên đang mở, và mỗi lần quay lại dự án thì mở đúng tab dùng lần trước (thường là Bảng).
- **Cơ chế.** `onSuccess` của `ProjectFormDrawer` (tạo mới) điều hướng `/tasks/projects/:id?tab=members&addMembers=1`; `ProjectMemberTable` tự mở `AddMemberDialog` khi có cờ và có quyền quản thành viên. Nhớ tab cuối theo `projectId` bằng `localStorage` (try/catch), chỉ dùng khi URL không có `?tab`. Link cây sidebar không gắn tab cố định.
- **Luồng.** **Trước:** tạo dự án 19 thao tác (sau Lưu vẫn ở danh sách → bấm tên → Thành viên → Thêm); mở hằng ngày 2 (cây → tab Bảng). **Sau:** 16 và 1.
- **Tiêu chí chấp nhận.**
  1. Tạo thành công: vào dự án mới ở tab Thành viên, hộp thêm thành viên đang mở.
  2. Không có quyền quản thành viên: vẫn vào dự án nhưng không tự mở hộp.
  3. Lần trước rời P ở tab Bảng thì mở từ cây vào Bảng. URL có `?tab=report` thì URL thắng.
  4. Tab đã nhớ không còn quyền xem: rơi về Tổng quan.
  5. `localStorage` bị chặn: hành vi như hiện nay.
- **Zone.** FE điều hướng + tuỳ chọn cá nhân.
- **Dẫn chứng.** `ProjectListPage.tsx:~420`; `ProjectMemberTable.tsx:86-126,213`; `workspace-constants.ts:32-37`; `ProjectDetailPage.tsx:516-530`; `TaskSidebarTree.tsx:252`.

##### US-TASK-QL-14 · Chủ dự án xem được Báo cáo của dự án mình (theo vai trò dự án)
**P2 · M · 🔴 red** · Lớp BE, FE, DOC · Phụ thuộc: — · Spec: DECISIONS-04, SPEC-06 §13.11 · **Cần owner quyết (§7 Q9)**

- **Story.** Là trưởng nhóm có vai trò Owner/Manager trong dự án nhưng vai trò hệ thống chỉ là nhân viên, tôi muốn xem tab Báo cáo của chính dự án mình mà không phải nhờ admin.
- **Cơ chế.** `GET /projects/:id/report` cho phép khi có `view-report:project` **hoặc** là Owner/Manager còn hiệu lực của chính dự án (kiểm membership trong cùng `withTenant`). FE hiện tab theo cùng điều kiện (`projectRole` từ DTO). Tab Hoạt động giữ nguyên, vẫn chỉ cho người có `view:task-audit-log` (DECISIONS-04 mục 3). Cập nhật DECISIONS-04 và `permission-matrix-spec.md` cùng WO.
- **Luồng.** **Trước: ~6** (không có tab Báo cáo; tự đếm trên board qua nhiều lần lọc). **Sau: 2** (mở dự án → Báo cáo).
- **Tiêu chí chấp nhận.**
  1. NV là Owner của P, không có `view-report:project`: xem được báo cáo P.
  2. Cùng NV với dự án Q mà mình chỉ là Member hoặc không tham gia: 403, FE không có tab.
  3. Owner bị gỡ khỏi P: mất quyền ngay (int-spec deny-path).
  4. Tab Hoạt động vẫn ẩn nếu không có `view:task-audit-log`.
  5. Dự án công ty khác: 404.
- **Zone.** Đổi logic cấp quyền đọc báo cáo. FULL gate, deny-path RED trước.
- **Dẫn chứng.** `apps/api/src/tasks/projects.controller.ts:189-215`; `ProjectDetailPage.tsx:479-483,620-633`; `docs/DECISIONS/DECISIONS-04_Task_Per_Project_Role.md:117-118`.

##### US-TASK-QL-91 · Hiện cảnh báo «người được giao đang nghỉ phép / không phải thành viên» khi giao việc *(bổ sung khi tổng hợp)*
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-X-91 · Spec: SPEC-06 §14.9

- **Story.** Là quản lý, khi giao việc cho người đang nghỉ phép hoặc không phải thành viên dự án, tôi muốn được cảnh báo ngay kèm lối «Đổi người», để khỏi phải phát hiện muộn rồi hỏi lại.
- **Cơ chế.** Hook `use-task-action-mutation` đọc `warnings[]` (`ASSIGNEE-ON-LEAVE`, `ASSIGNEE-NOT-MEMBER`) mà server đã trả, hiện thông báo cảnh báo (US-X-91) có nút «Đổi người» mở picker người phụ trách của việc đó. Áp cho route `/assign`, cho quick-add/Tạo (khi QL-01 trả `warnings[]` cho create) và cho hàng loạt (QL-03 gộp thành một cảnh báo tổng).
- **Luồng.** **Trước:** không có tín hiệu; phát hiện muộn thì mở lại việc → mở người phụ trách → chọn → đóng = 4. **Sau: 2** («Đổi người» → chọn).
- **Tiêu chí chấp nhận.**
  1. Giao cho B đang nghỉ phép: cảnh báo «B đang nghỉ phép (đến dd/MM)» nếu server trả hạn, kèm «Đổi người».
  2. Giao cho người không phải thành viên dự án: cảnh báo tương ứng; việc vẫn được giao như server đã chấp nhận.
  3. `warnings[]` rỗng: không có cảnh báo.
  4. Cảnh báo đọc qua `aria-live` và với tới được bằng bàn phím.
- **Zone.** FE thuần, đọc dữ liệu server đã trả.
- **Dẫn chứng (đã kiểm 23/10).** `routes/tasks/hooks/use-task-action-mutation.ts:15` (onSuccess chỉ ghi đè cache; `warnings` chỉ xuất hiện trong spec); `contracts/src/task-actions.ts:89-105`.

##### US-TASK-QL-92 · Bàn giao quanh kỳ nghỉ: lối «Việc trong kỳ nghỉ» từ đơn đang duyệt và dấu «Nghỉ dd/MM–dd/MM» trong picker người phụ trách *(bổ sung khi kiểm độ phủ)*
**P1 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-QL-05 (bộ lọc trên URL), US-TASK-QL-03 (thao tác hàng loạt), US-TASK-QL-91, US-X-92; nên có US-X-03 (`?request=`) · Spec: SPEC-05 (duyệt đơn, lịch nghỉ đội); SPEC-06 §14.9 · **Owner xác nhận Q23 áp luôn cho picker (không hiện loại nghỉ)**

- **Story.** Là quản lý, khi duyệt đơn nghỉ của một nhân viên tôi muốn thấy ngay số việc của người đó đến hạn trong kỳ nghỉ và một chạm tới danh sách đã lọc để chuyển hàng loạt. Khi giao việc, tôi muốn thấy «Nghỉ 28/10–30/10» cạnh tên **trước khi** chọn. Mục đích là không giao cho người vắng mặt rồi mới phát hiện.
- **Cơ chế.**
  - **(a) Lối từ đơn.** Trong `ApprovalDetailDialog` (và trang chi tiết đơn khi người xem không phải chủ đơn) thêm dòng «Việc của <tên> đến hạn trong kỳ nghỉ (N)».
    - `employeeId` lấy từ chi tiết đơn; null thì không hiện dòng.
    - N đếm bằng `GET /tasks?assigneeEmployeeId=&dueFrom=&dueTo=` trong phạm vi `read:task` của QL, nên chỉ đếm việc QL đọc được. Mốc là đầu `startDate` và cuối `endDate` theo giờ công ty (US-X-92). Không đọc được tổng thì hiện «50+» theo trần trang.
    - Bấm dòng thì sang `/tasks` với các tham số URL của QL-05 điền sẵn (người, `dueFrom`, `dueTo`). Ở đó QL chọn tất cả rồi «Giao cho…» (QL-03).
    - Đơn Pending và Approved đều có dòng này, để QL sắp xếp trước khi duyệt. Duyệt hay từ chối vẫn đi đúng nút và xác nhận cũ.
  - **(b) Dấu nghỉ trong picker** (`TaskFormDrawer`, «Giao cho…» của QL-03, đổi người ở trang Quá hạn QL-07).
    - Chỉ khi người dùng có `view-team:leave-calendar`: gọi một lần `GET /leave/calendar?scope=team&from=<hôm nay>&to=<+14 ngày>` (hằng số), chỉ lấy đơn Approved, khớp với người trong picker theo `userId`.
    - Hiện «Nghỉ đến dd/MM» hoặc «Nghỉ dd/MM–dd/MM». **Không** hiện loại nghỉ; lý do đã bị server che.
    - Chỉ là gợi ý, không chặn chọn. Không có quyền thì không gọi và không hiện dấu; cảnh báo sau khi giao của QL-91 vẫn chạy.
- **Luồng.** QL chuyển 6 việc của NV A sắp nghỉ, xuất phát hộp thoại duyệt đơn của A ở `/leave/approvals`.
  - **Trước: 30 thao tác, 1 chuyển trang.** (1) đóng dialog → (2) sidebar «Danh sách» việc (chuyển trang) → (3–4) lọc người → (5–6) từ ngày, đến ngày (bộ lọc ở `useState`, `TaskListPage.tsx:64-66,92-94`) → 6 × (Sửa → mở Select → chọn → Lưu) = 24. Không có dấu nghỉ nào trong picker.
  - **Sau: 6 thao tác, 1 chuyển trang.** (1) «Việc trong kỳ nghỉ (6)» (chuyển trang, bộ lọc đã điền) → (2) Chọn tất cả → (3) «Giao cho…» → (4) gõ tên → (5) chọn (thấy dấu nghỉ nếu người đó cũng sắp vắng) → (6) Xác nhận.
- **Tiêu chí chấp nhận.**
  1. QL mở đơn của A (27–31/10); A có 6 việc QL đọc được với hạn trong kỳ: dialog hiện «(6)». Bấm vào: `/tasks` lọc người = A, `dueFrom` = 27/10 00:00 và `dueTo` = 31/10 23:59:59 giờ công ty, đúng 6 dòng.
  2. A có thêm việc ngoài phạm vi đọc của QL: số đếm và danh sách không gồm việc đó, không lộ tổng thật.
  3. QL có `view-team:leave-calendar`, B nghỉ Approved 28–30/10: picker hiện «B · Nghỉ 28/10–30/10». DOM không có tên loại nghỉ hay lý do.
  4. QL không có `view-team:leave-calendar`: không có request `/leave/calendar`, picker như cũ, không lỗi console.
  5. Đơn Pending của B: picker không hiện dấu (chỉ đơn Approved).
  6. `/leave/calendar` lỗi hoặc timeout: picker vẫn chọn được, không dấu, không chặn giao.
  7. QL không có `read:task`: dialog không có dòng việc và không gọi `/tasks`.
- **Zone.** FE ghép dữ liệu LEAVE (endpoint, gate và che `reason` sẵn có, `contracts/src/leave.ts:163-208`) vào luồng giao việc. Không thêm trường DTO, không đổi quyền hay FSM nghỉ phép. Nếu khi lập plan thấy picker cần trường mới từ HR hoặc LEAVE thì dừng và tách WO amber.
- **Dẫn chứng (đã kiểm 23/10).** `routes/leave/LeaveApprovalPage.tsx:146,178-180` (dialog có kỳ nghỉ, không có gì về việc); `packages/contracts/src/leave.ts:191-204` (lịch nghỉ có `userId`, `startDate/endDate`, `reason` bị che), `:522-523` (chi tiết đơn có `employeeId`); `packages/contracts/src/hr/employee-read.ts:86,123` (`userId` trong danh sách nhân viên để khớp); `packages/web-core/src/lib/leave-api.ts:196-201`; `packages/contracts/src/task.ts:593-606` (GET /tasks đã nhận `assigneeEmployeeId`, `dueFrom/dueTo`); `routes/tasks/TaskFormDrawer.tsx:51-53` (picker lấy 100 nhân viên active); `apps/api/src/tasks/task-actions.service.ts:619-659`.
- **Ghi chú.** Dấu «đang nghỉ» trên roster/DM chat **không** làm ở đây: hiện lịch nghỉ cho mọi đồng nghiệp là nới phạm vi đọc dữ liệu nghỉ (NV thường không có `view-team:leave-calendar`). Xem §7 Q26.

### 5.3 Mục tiêu — GOAL

| Id | Tiêu đề | Loại | Ưu tiên | Cỡ | Zone | Thao tác trước→sau |
| --- | --- | --- | --- | --- | --- | --- |
| **Nhân viên** | | | | | | |
| US-GOAL-NV-01 | Tạo nhanh mục tiêu cá nhân quý: tự điền cấp, người, kỳ, Active | ux | P0 | M | 🟢 | 14→5 |
| US-GOAL-NV-02 | Đổi trạng thái 1 chạm: «Kích hoạt», gợi ý «Hoàn thành» khi 100%, lý do khoá Check-in | ux | P0 | S | 🟢 | 4→1 |
| US-GOAL-NV-03 | Check-in nhanh: điền sẵn số cũ, độ tự tin 1 chạm, Ctrl+Enter, toast | ux | P1 | S | 🟢 | 4→3 |
| US-GOAL-NV-04 | Thẻ «Mục tiêu của tôi» ở /me: cả Nháp, kỳ, tối đa 5 mục, link đã lọc | hoàn thiện | P0 | S | 🟢 | 8→3–4 (2→0 chuyển trang) |
| US-GOAL-NV-07 | Chip mục tiêu trên dòng việc và lọc /tasks theo mục tiêu | hoàn thiện | P1 | M | 🟡 | ~10→1 |
| US-GOAL-NV-08 | Tạo việc mới gắn sẵn mục tiêu từ trang mục tiêu | hoàn thiện | P1 | M | 🟡 | 7→3 |
| US-GOAL-NV-12 | Chọn mục tiêu cha bằng ô tìm, kế thừa kỳ, cảnh báo lệch kỳ | tối ưu | P2 | M | 🟢 | 5→3 |
| US-GOAL-NV-91 | Check-in ngay trên dòng /goals (danh sách và cây) *(bổ sung)* | ux | P1 | S | 🟢 | 5→3 (2→0 chuyển trang) |
| **Quản lý** | | | | | | |
| US-GOAL-QL-01 | Hiện tên người phụ trách, người check-in, lần check-in gần nhất | hoàn thiện | P0 | M | 🟠 | 25→1 |
| US-GOAL-QL-02 | Cờ «Chậm/Rủi ro» dẫn xuất và lọc «Chỉ mục tiêu rủi ro» | hoàn thiện | P0 | M | 🟡 | 25→2 |
| US-GOAL-QL-03 | /goals mặc định quý hiện tại + phòng của tôi; bộ lọc/tab trên URL; «Của tôi» | ux | P0 | M | 🟢 | 6→1 |
| US-GOAL-QL-04 | «Thêm mục tiêu con» kế thừa cha qua prefill URL, «Lưu và thêm tiếp» | ux | P0 | M | 🟢 | 17→7 |
| US-GOAL-QL-05 | Giao một mục tiêu con cho nhiều nhân viên một lần | tối ưu | P1 | L | 🔴 | 102 (42 sau QL-04)→14 |
| US-GOAL-QL-06 | Chốt kỳ hàng loạt cho mục tiêu của phòng | tối ưu | P1 | L | 🔴 | 48→6 |
| US-GOAL-QL-07 | Wizard phân rã: áp người/hạn cho tất cả, hạn theo giờ công ty, xem việc vừa tạo | ux | P1 | M | 🟢 | 35→8 |
| US-GOAL-QL-08 | Lối vào «Danh mục mẫu việc» từ /goals và từ wizard | hoàn thiện | P1 | S | 🟢 | không có đường→2 |
| US-GOAL-QL-09 | Xem nhanh lịch sử check-in trong drawer, có tên người check-in | ux | P1 | M | 🟢 | 24→9 |
| US-GOAL-QL-10 | Mở lại S7-GOAL-PROJTAB-1: tab «Mục tiêu» trong workspace dự án | hoàn thiện | P1 | M | 🟡 (lát A 🟢) | 8→1 |
| US-GOAL-QL-11 | Kích hoạt hàng loạt mục tiêu Nháp của đội | ux | P1 | M | 🟡 | 36→4 |
| US-GOAL-QL-12 | Nhắc check-in hằng tuần và báo quản lý khi mục tiêu chuyển «Chậm» | hoàn thiện | P2 | L | 🔴 | 25→1 |
| US-GOAL-QL-13 | «Phản hồi» check-in: mở chat riêng mang ngữ cảnh mục tiêu | ux | P2 | S | 🟡 | 5→3 |
| US-GOAL-QL-14 | Tab «Công việc gắn» bấm được, nhóm theo người, nổi bật quá hạn | ux | P1 | S | 🟢 | 6→2 |
| US-GOAL-QL-91 | Nhãn widget «Mục tiêu kỳ này» phân biệt được từng mục tiêu *(bổ sung)* | hoàn thiện | P2 | S | 🟢 | mở từng mục→0 |
| US-GOAL-QL-92 | Cây mục tiêu thu gọn/mở rộng và nhớ trạng thái *(bổ sung)* | ux | P2 | S | 🟢 | ~4 lần cuộn→2 |

#### 5.3.1 GOAL — Nhân viên

##### US-GOAL-NV-01 · Tạo nhanh mục tiêu cá nhân quý: tự điền cấp, người, kỳ và để Active
**P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-X-92 · Spec: SPEC-10 §9 GOAL-SCREEN-003 · **Owner quyết mặc định trạng thái (§7 Q11)**

- **Story.** Là nhân viên, tôi muốn tạo mục tiêu cá nhân của quý chỉ với tên và chỉ tiêu, để không phải chọn lại những gì hệ thống đã biết (tôi là ai, quý nào) và check-in được ngay sau khi lưu.
- **Cơ chế.** `/goals/new` dùng mặc định thông minh:
  - (1) Lấy `employee.id` và `scopes['create:goal']` từ `/auth/me` (không thêm request). Scope chỉ có Own thì đặt `level=employee`, `employeeId` = chính mình và ẩn hai ô này; scope rộng hơn thì vẫn hiện để sửa.
  - (2) `periodType` mặc định là quý. Chọn Quý/Năm thì tự điền ngày theo giờ công ty bằng `quarterRange`/`yearRange` của US-X-92 (dùng chung với QL-04 và NV-12).
  - (3) Trạng thái mặc định Active cho cấp Nhân viên, Draft cho cấp Phòng/Dự án.
  
  BE giữ nguyên validate.
- **Luồng.** /goals. **Trước: 14, 2 chuyển trang** (Tạo → tên → Cấp (2) → chọn mình (2) → 2 ngày → Kiểu đo (2) + chỉ tiêu → Draft→Active (2) → Lưu). **Sau: 5, 1 chuyển trang** (Tạo → tên → kiểu đo nếu khác mặc định → chỉ tiêu → Lưu).
- **Tiêu chí chấp nhận.**
  1. NV chỉ có `create:goal` Own: mở /goals/new thì Cấp = Nhân viên, Chủ thể = mình, Loại kỳ = Quý, hai ngày = đầu/cuối quý hiện tại (giờ công ty), Trạng thái = Active.
  2. Đổi Quý sang Năm thì ngày thành 01/01–31/12 năm nay. Chọn Tuỳ chỉnh thì giữ ngày để sửa tay.
  3. Lưu với mặc định: nút Check-in ở chi tiết bấm được ngay.
  4. Không lấy được hồ sơ của mình (chưa gắn hồ sơ hoặc lỗi mạng): ô Chủ thể hiện để chọn tay kèm thông báo, không chặn form.
  5. Sửa request gửi `level=department`: BE vẫn trả lỗi phạm vi như hiện nay.
- **Zone.** FE mặc định và tự điền; BE, quyền, schema không đổi. SPEC-10 không có luồng phê duyệt (GOAL-DEC-003) nên mặc định Active không phá bất biến.
- **Dẫn chứng.** `routes/goals/goal-form-schema.ts:70-82,108-126`; `GoalFormPage.tsx:110-134,229-350`; `apps/api/src/goals/goals.service.ts:428`; `contracts/src/auth.ts:136-153`; migration 0506:71.

##### US-GOAL-NV-02 · Đổi trạng thái 1 chạm: «Kích hoạt» mục tiêu Nháp, gợi ý «Hoàn thành» khi đạt 100%, giải thích vì sao Check-in bị khoá
*Gộp từ: US-GOAL-NV-11.* · **P0 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-X-91 · Spec: SPEC-10 GOAL-FUNC-003, §8, §12

- **Story.** Là nhân viên, tôi muốn bấm «Kích hoạt» ngay trên mục tiêu Nháp, được gợi ý «Đánh dấu Hoàn thành» khi đạt 100%, và biết vì sao chưa check-in được, để không phải vào form Sửa chỉ để đổi trạng thái.
- **Cơ chế.** Header chi tiết, gate theo cặp `update:goal` giống nút Sửa:
  - (a) Mục tiêu Draft có nút «Kích hoạt», gọi `PATCH {status:'Active'}`.
  - (b) Mục tiêu Active, chưa chốt kỳ, `progressPercent ≥ 100` thì hiện banner «Đã đạt 100%. Đánh dấu Hoàn thành?» (cả sau khi đóng hộp check-in), kèm «Để sau» lưu ở `localStorage` có try/catch. **Không tự đổi trạng thái** (SPEC-10 §12).
  - Nút Check-in đang khoá có chú thích lý do (Nháp / Đã chốt kỳ).
  - Cập nhật lạc quan; 403/422 thì rollback và báo lỗi theo mã.
  - Mutation viết thành hook dùng chung cho thẻ /me (NV-04) và kích hoạt hàng loạt (QL-11).
- **Luồng.** **Trước: 4, 2 chuyển trang** (Sửa → mở Trạng thái → chọn → Lưu). **Sau: 1**, không chuyển trang.
- **Tiêu chí chấp nhận.**
  1. Mục tiêu Draft của tôi, có `update:goal`: «Kích hoạt» chuyển sang Active, Check-in bật lên, có toast; audit ghi như PATCH hiện nay.
  2. Check-in đang khoá: thấy lý do «Mục tiêu đang ở Nháp» kèm lối tắt «Kích hoạt»; đã chốt kỳ thì lý do là «Đã chốt kỳ».
  3. Không có cặp `update:goal`: không có «Kích hoạt», không có banner.
  4. Có cặp nhưng mục tiêu ngoài phạm vi Own (vd mục tiêu phòng): BE 403, trạng thái về Draft, báo «Bạn không có quyền sửa mục tiêu này».
  5. Active, 100%, chưa chốt: có banner; bấm «Đánh dấu Hoàn thành» thì thành Completed.
  6. 99,5% hoặc `progressPercent = NULL`: không có banner.
  7. «Để sau» rồi tải lại: banner không hiện lại cho mục tiêu đó; `localStorage` không dùng được thì banner vẫn hiện, không lỗi.
  8. Completed mà % tụt dưới 100: không tự đổi trạng thái.
- **Zone.** FE dùng PATCH và cặp sẵn có; BE không có FSM trạng thái mục tiêu.
- **Dẫn chứng.** `routes/goals/GoalDetailPage.tsx:140-175,200-207`; `GoalFormPage.tsx:402-410`; `apps/api/src/goals/goals.controller.ts:96-98`; `goals.service.ts:462`; `packages/web-core/src/lib/use-can.ts:13-24`; `docs/SPEC/SPEC-10 GOAL.md:256`.

##### US-GOAL-NV-03 · Check-in nhanh: điền sẵn số cũ, chọn độ tự tin một chạm, Ctrl+Enter, toast
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-X-91 · Spec: SPEC-10 GOAL-FUNC-003, GOAL-API-007

- **Story.** Là nhân viên, tôi muốn check-in tuần chỉ bằng cách sửa con số đã điền sẵn và chọn mức tự tin, để cập nhật trong vài giây và biết chắc đã lưu.
- **Cơ chế.** `GoalCheckinDialog`:
  - (1) Điền sẵn `currentValue`/`progressPercent`, kèm dòng «Lần trước: X → chỉ tiêu Y».
  - (2) Độ tự tin là 3 nút Thấp/Vừa/Cao, ánh xạ sang hằng số trong khoảng 0–100. **Mặc định không chọn**; mức của lần trước chỉ hiện làm gợi ý, lấy từ `GET /goals/:id/updates?limit=1`.
  - (3) Focus vào ô số; Ctrl/Cmd+Enter để gửi.
  - (4) Thành công thì có toast kèm % mới.
- **Luồng.** /me. **Trước: 4** (Check-in → gõ số vào ô trống → gõ độ tự tin 0–100 → Gửi; không có toast). **Sau: 3** (Check-in → sửa số → Ctrl+Enter); +1 nếu chọn độ tự tin.
- **Tiêu chí chấp nhận.**
  1. Mục tiêu manual kiểu số `currentValue=40`: ô số hiện 40, có «Lần trước», con trỏ ở ô số.
  2. Ctrl+Enter (Cmd+Enter) gửi, đóng hộp, có toast % mới.
  3. Lần trước «Vừa»: không nút nào được chọn sẵn, chỉ có chú thích. Không chọn thì body không có `confidence`.
  4. Chế độ đo tự động (tasks/project/children): không có ô số, chỉ còn độ tự tin và ghi chú.
  5. `GOAL-ERR-005/006`: giữ dữ liệu, hiện lỗi rõ, không có toast thành công.
  6. Lấy lần trước bị lỗi: vẫn check-in được, «Lần trước» ghi «—».
- **Zone.** FE trong hộp thoại; body vẫn là `CheckinGoalRequest`, sổ `goal_updates` vẫn chỉ-thêm. Không tự mang độ tự tin cũ để tránh làm bẩn sổ.
- **Dẫn chứng.** `routes/goals/components/GoalCheckinDialog.tsx:38-60,150-224`; `routes/me/components/MeGoalsCard.tsx:98-110`; `contracts/src/goal.ts:191-197`.

##### US-GOAL-NV-04 · Thẻ «Mục tiêu của tôi» ở /me: thấy cả Nháp, kỳ, tối đa 5 mục và link sang danh sách đã lọc
**P0 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-GOAL-NV-02, US-GOAL-QL-03, US-X-92 · Spec: SPEC-10 §9 GOAL-SCREEN-005, GOAL-API-013

- **Story.** Là nhân viên, tôi muốn thẻ mục tiêu ở /me liệt kê mọi mục tiêu đang mở của tôi trong kỳ (kể cả Nháp, kèm nút kích hoạt), để không phải sang /goals lọc tay mới tìm thấy mục tiêu cần check-in.
- **Cơ chế.** `MeGoalsCard` gọi `GET /me/goals` với `periodFrom/periodTo` của kỳ hiện tại (giờ công ty), bỏ bộ lọc `status=Active`, `limit=20`. Ẩn Completed/Cancelled ở client, hiện 5 dòng đầu, tự đếm phần còn lại (API trả mảng, không có tổng). Mỗi dòng: tên bấm được để mở `/goals/$goalId`, nhãn kỳ (Q4/2026), badge Nháp kèm «Kích hoạt» (hook của NV-02). Check-in khoá với mục Nháp hoặc đã chốt. «Xem tất cả (N)» dẫn tới `/goals?mine=1`.
- **Luồng.** /me, mục tiêu không nằm trong top 3 Active. **Trước: 8, 2 chuyển trang** (sidebar → Danh sách → lọc người (2) → bấm dòng → Check-in → nhập → Gửi). **Sau: 3–4, 0 chuyển trang** (Check-in → sửa số → Ctrl+Enter; +1 nếu phải Kích hoạt).
- **Tiêu chí chấp nhận.**
  1. 2 Active + 1 Nháp trong quý: thẻ hiện cả 3; mục Nháp có badge, «Kích hoạt», Check-in khoá.
  2. 7 mục đang mở: hiện 5 + «Xem tất cả (7)» → `/goals?mine=1`.
  3. Bấm tên mục tiêu: mở chi tiết.
  4. Không có mục tiêu trong kỳ: trạng thái rỗng kèm «Tạo mục tiêu» (chỉ khi có `create:goal`).
  5. Thiếu `access:goal`: thẻ không render.
  6. API lỗi: báo lỗi + Thử lại.
- **Zone.** FE dùng tham số sẵn có của `meGoalsQuerySchema`; chủ thể vẫn lấy từ token.
- **Dẫn chứng.** `routes/me/components/MeGoalsCard.tsx:48,94-96,148`; `routes/goals/constants.ts:56`; `contracts/src/goal.ts:168-175`.

##### US-GOAL-NV-07 · Chip mục tiêu trên dòng «Việc của tôi» và lọc /tasks theo mục tiêu
**P1 · M · 🟡 yellow** · Lớp FE, BE · Phụ thuộc: — · Spec: SPEC-10 §7 (GOAL↔TASK)

- **Story.** Là nhân viên, tôi muốn thấy mỗi việc đang đóng góp cho mục tiêu nào và bấm vào chip để lọc mọi việc của mục tiêu đó, để ưu tiên đúng việc.
- **Cơ chế.** FE hiện chip `goalCode/goalName` (đã có trong `taskCoreResponseSchema`/`myTaskItemSchema`) trên dòng /tasks/my-tasks, dòng danh sách và thẻ board. Bấm chip điều hướng `/tasks?goalId=<id>` kèm nhãn «Đang lọc theo mục tiêu G» và nút bỏ lọc. BE thêm `goalId` (uuid, optional) vào `listTaskCoreQuerySchema`, nối với `filter.goalId` mà repository đã hỗ trợ, trong phạm vi đọc task của người gọi. `goalName/goalCode` chỉ trả khi người xem có `view:goal` trên mục tiêu đó (che ở server).
- **Luồng.** /tasks. **Trước: ~10** (mở từng việc để đọc ô Mục tiêu; không lọc được). **Sau: 1** (nhìn chip = 0, bấm chip = 1).
- **Tiêu chí chấp nhận.**
  1. Việc A gắn G: dòng A có chip mã + tên G; việc không gắn thì không có chip.
  2. Bấm chip G: URL `/tasks?goalId=<G>`, chỉ còn việc gắn G mà tôi đọc được, có nhãn lọc và nút bỏ lọc.
  3. `goalId` của công ty khác hoặc không tồn tại: danh sách rỗng, không 500. `goalId` không phải uuid: 400.
  4. Tên dài: chip cắt gọn, có title đầy đủ, không vỡ bố cục ở độ rộng điện thoại.
  5. Đọc được việc nhưng không có `view:goal` với G (vd mục tiêu cá nhân của đồng nghiệp): `goalName/goalCode` là null, không có chip. `?goalId=G` ngoài phạm vi thì trả rỗng như G không tồn tại.
- **Zone.** Thêm tham số lọc vào DTO query của luồng task; không đổi quyền hay schema.
- **Dẫn chứng.** `contracts/src/task.ts:596-601,768-770,816`; `apps/api/src/tasks/task-core.repository.ts:52,229,247,402`; `MyTasksPage.tsx:23-43`; `TaskGoalField.tsx:32-156`.
- **Ghi chú.** Khi lập plan, xác minh đường đọc /me/tasks và board thật sự điền `goalName`.

##### US-GOAL-NV-08 · Tạo việc mới gắn sẵn mục tiêu từ trang mục tiêu
**P1 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-GOAL-QL-14 · Spec: SPEC-10 GOAL-FUNC-006, GOAL-API-010 · **Owner quyết tính không nguyên tử (§7 Q13)**

- **Story.** Là nhân viên, tôi muốn bấm «Thêm việc» trong tab Công việc gắn và có việc mới tự gắn vào mục tiêu đó.
- **Cơ chế.** Nút «Thêm việc» trong tab (gate **cả** `update:goal` lẫn phạm vi ghi `update:task`, giống nút «Gắn việc», cộng `create:task`) mở `TaskFormDrawer`, điền sẵn `projectId` nếu mục tiêu ở cấp dự án. Lưu thì FE gọi `POST /tasks` rồi `POST /goals/:id/tasks {taskIds:[id mới]}`. Cả hai endpoint có sẵn với guard và audit đầy đủ. **Không thêm đường ghi BE.** Bước gắn lỗi thì việc vẫn còn và có «Thử gắn lại».
- **Luồng.** /goals/{id}. **Trước: 7, 1 chuyển trang** (Công việc → Tạo → tiêu đề → Lưu → mở việc → mở Mục tiêu → chọn). **Sau: 3, 0 chuyển trang** («Thêm việc» → tiêu đề → Lưu).
- **Tiêu chí chấp nhận.**
  1. Có đủ cặp: việc mới hiện ngay trong tab, `goalId=G`, % của G được tính lại (mode tasks).
  2. Thiếu `update:goal` hoặc `update:task`: không có «Thêm việc».
  3. Tạo xong nhưng gắn trả 403/422 (vd G vừa chốt kỳ): «Đã tạo việc [mã] nhưng chưa gắn vào mục tiêu» + «Thử gắn lại» + link mở việc; không báo thành công giả.
  4. `POST /tasks` lỗi validate: giữ dữ liệu, không gọi bước gắn.
  5. Activity và audit có ở cả hai đường như hiện nay.
- **Zone.** FE ghép hai endpoint ghi sẵn có trên luồng task. Phương án B (`POST /tasks` nhận `goalId` nguyên tử) là amber và chỉ làm khi owner chọn.
- **Dẫn chứng.** `apps/api/src/tasks/task-core.repository.ts:178-180,671-676`; `apps/api/src/goals/goals.controller.ts:180-182`; `goal-tasks-link.service.ts:27-99`; `routes/goals/constants.ts:57-64`; `GoalLinkedTasksTab.tsx:110-115`.

##### US-GOAL-NV-12 · Chọn mục tiêu cha bằng ô tìm kiếm, kế thừa kỳ của cha, cảnh báo mềm khi lệch kỳ
**P2 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-GOAL-NV-01 · Spec: SPEC-10 §12, GOAL-SCREEN-003

- **Story.** Là nhân viên, tôi muốn gõ vài chữ để chọn mục tiêu phòng mà mục tiêu của tôi đóng góp vào, và có kỳ tự lấy theo cha.
- **Cơ chế.** Thay `<select>` phẳng 200 mục bằng combobox có tìm, mặc định gợi ý mục tiêu cùng phòng và cùng kỳ (`GET /goals?departmentId=&periodFrom=&periodTo=`), tải theo trang. Chọn cha khi kỳ còn là mặc định thì tự điền `periodType/Start/End` theo cha. Kỳ con nằm ngoài kỳ cha thì hiện cảnh báo vàng, không chặn.
- **Luồng.** /goals/new. **Trước: 5** (mở select → cuộn chọn → loại kỳ → 2 ngày). **Sau: 3** (mở combobox → gõ → chọn).
- **Tiêu chí chấp nhận.**
  1. Phòng có 30 mục tiêu quý này, gõ «doanh»: chỉ hiện mục khớp tên hoặc mã trong phạm vi được xem.
  2. Chọn cha Q4/2026 khi kỳ đang mặc định: ba trường kỳ tự điền.
  3. Đã sửa tay sang Q1/2027 rồi chọn cha Q4/2026: cảnh báo «Kỳ nằm ngoài kỳ của mục tiêu cha», vẫn lưu được.
  4. Không khớp: «Không tìm thấy», cho bỏ chọn cha.
  5. Cha ngoài phạm vi `view:goal` không xuất hiện.
- **Zone.** FE dùng tham số lọc sẵn có.
- **Dẫn chứng.** `GoalFormPage.tsx:128-134,307-350`; `contracts/src/goal.ts:140-151`; `docs/SPEC/SPEC-10 GOAL.md:255`.

##### US-GOAL-NV-91 · Check-in ngay trên dòng /goals (danh sách và cây) *(bổ sung khi tổng hợp)*
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-GOAL-NV-03 (tuỳ chọn) · Spec: SPEC-10 GOAL-FUNC-003, GOAL-SCREEN-001

- **Story.** Là nhân viên đang xem danh sách mục tiêu, tôi muốn bấm biểu tượng Check-in ngay trên dòng, để cập nhật mà không vào trang chi tiết rồi quay lại.
- **Cơ chế.** Thêm biểu tượng Check-in ở cột cuối của `GoalListPage` và trên nút cây `GoalTreeView`. Gate cặp riêng `('checkin','goal')` giống `MeGoalsCard`. Khoá khi Nháp hoặc đã chốt, kèm lý do. Mở cùng `GoalCheckinDialog`, xong thì invalidate danh sách/cây. Bấm biểu tượng không kích hoạt `onRowClick`.
- **Luồng.** /goals. **Trước: 5, 2 chuyển trang** (bấm dòng → Check-in → nhập → Gửi → quay lại). **Sau: 3, 0 chuyển trang** (biểu tượng → sửa số → Ctrl+Enter).
- **Tiêu chí chấp nhận.**
  1. Có `checkin:goal`, mục tiêu Active: bấm biểu tượng mở hộp check-in tại chỗ; gửi xong thì % trên dòng/nút cây cập nhật.
  2. Mục tiêu Nháp hoặc đã chốt: biểu tượng khoá, tooltip nêu lý do.
  3. Không có cặp `checkin:goal`: không có biểu tượng.
  4. Bấm biểu tượng không mở trang chi tiết; bấm phần còn lại của dòng vẫn mở chi tiết.
  5. Dùng bàn phím: biểu tượng với tới được, có `aria-label` «Check-in <tên mục tiêu>».
- **Zone.** FE thuần, tái dùng hộp thoại và cặp quyền sẵn có.
- **Dẫn chứng (đã kiểm 23/10).** `routes/me/components/MeGoalsCard.tsx:10,42-46,98-110` (khuôn check-in tại chỗ + cặp riêng); `routes/goals/GoalListPage.tsx:128-161` (các cột không có hành động), `:329` (`onRowClick`); `components/GoalTreeView.tsx:39-60`.

#### 5.3.2 GOAL — Quản lý

##### US-GOAL-QL-01 · Mục tiêu hiện tên người phụ trách, tên người check-in và lần check-in gần nhất
*Gộp từ: US-GOAL-NV-10, US-GOAL-NV-13.* · **P0 · M · 🟠 amber** · Lớp FE, BE, DOC · Phụ thuộc: — · Spec: SPEC-10 §9 GOAL-SCREEN-001, §3.3, GOAL-API-001/003/006/008/013 · **Owner quyết việc lộ tên (§7 Q14)**

- **Story.** Là quản lý, tôi muốn thấy ngay trên cây/danh sách tên người phụ trách và lần check-in gần nhất của từng mục tiêu. Là nhân viên, tôi muốn biết ai phụ trách mục tiêu phòng tôi đóng góp, ai đã check-in, và mục tiêu nào của tôi đã lâu chưa cập nhật.
- **Cơ chế.** **Một** thay đổi DTO đọc, additive, optional, không `.default()`:
  - `GET /goals`, `/goals/tree`, `/goals/:id`, `/me/goals` trả thêm `ownerName` (chỉ tên hiển thị, join ở server dưới `withTenant`) và `lastCheckinAt` (MAX `created_at` của `goal_updates` loại checkin, một truy vấn gộp, không N+1).
  - `GET /goals/:id/updates` trả thêm `actorName`.
  
  FE:
  - Danh sách: cột «Phụ trách» và «Check-in cuối», sắp theo % và theo check-in cuối. Cây: hiện gọn.
  - Chi tiết: dòng «Phụ trách: …». Tab Lịch sử: cột «Người check-in».
  - Thẻ /me: «Check-in N ngày trước», nhãn «Cần check-in» cho mục tiêu manual Active quá 7 ngày (hằng số), đẩy các mục đó lên đầu.
- **Luồng.** Xuất phát /, QL xem 8 mục tiêu NV. **Trước: 25, 17 chuyển trang** (mỗi mục tiêu: mở → tab Lịch sử → quay lại). **Sau: 1, 1 chuyển trang** (sidebar, đọc thẳng trên bảng). Với NV: tên người phụ trách 3→0, «Cần check-in» trên /me 3→0.
- **Tiêu chí chấp nhận.**
  1. QL có `view:goal` phạm vi phòng, 8 mục tiêu NV: mỗi dòng/nút có tên người phụ trách và «Check-in cuối» (hoặc «Chưa check-in»).
  2. NV có `view:goal` Department nhưng `read:employee` Own: chi tiết mục tiêu phòng hiện tên trưởng phòng thay vì «—»; tab Lịch sử có tên người check-in từng dòng.
  3. Check-in cuối quá 7 ngày (giờ công ty): ô được tô cảnh báo, tooltip ngày giờ chính xác.
  4. Mục tiêu manual Active của tôi có check-in cuối 9 ngày trước: /me hiện «Check-in 9 ngày trước» + «Cần check-in», mục nằm đầu thẻ. Chế độ đo tự động không có nhãn.
  5. Bấm tiêu đề cột «Tiến độ» hoặc «Check-in cuối»: sắp tại chỗ.
  6. DTO chỉ thêm `ownerName/actorName` (tên hiển thị) và `lastCheckinAt`; không email, SĐT, mã nhân viên hay trường HR khác.
  7. NV chỉ có `view:goal` Own: chỉ thấy mục tiêu trong phạm vi (int-spec deny-path với `LANE_DB`).
  8. Người phụ trách đã nghỉ hoặc hồ sơ đã xoá mềm: tên kèm «Đã nghỉ» hoặc «—», không lỗi.
  9. Client cũ vẫn parse được. Test repository chứng minh không có truy vấn riêng cho từng mục tiêu.
- **Zone.** Lộ thêm tên nhân sự sang module GOAL cho role thấp; không đổi schema hay cặp quyền; review lộ dữ liệu một lần cho cả ba trường. Index `(company_id, goal_id, created_at desc)` đã có.
- **Dẫn chứng.** `components/GoalTreeView.tsx:51-59`; `contracts/src/goal.ts:80-106,168-175,214`; `GoalDetailPage.tsx:298-326`; `GoalCheckinsTab.tsx:51-75`; `apps/api/src/goals/goals.repository.ts:31,179`; `apps/api/src/db/schema/goals.ts:152`.

##### US-GOAL-QL-02 · Cờ «Chậm/Rủi ro» dẫn xuất và lọc «Chỉ mục tiêu rủi ro»
*Gộp từ: US-GOAL-NV-09.* · **P0 · M · 🟡 yellow** · Lớp FE, BE, DOC · Phụ thuộc: US-GOAL-QL-01 (chỉ cho vế «lâu không check-in») · Spec: SPEC-10 §8, GOAL-DEC-005, §7 DASH · **Owner chốt công thức (§7 Q15)**

- **Story.** Là quản lý, tôi muốn mỗi mục tiêu tự hiện cờ «Chậm» khi tiến độ tụt sau thời gian đã trôi của kỳ hoặc độ tự tin gần nhất thấp, và lọc nhanh chỉ những mục tiêu đó. Là nhân viên, tôi muốn thấy cờ trên mục tiêu của mình trước khi quản lý phải hỏi.
- **Cơ chế.**
  - Hàm thuần `computeGoalRisk` đặt ở `packages/contracts`, dùng chung FE, BE và widget, có unit test các mốc biên, tính theo giờ công ty. Chỉ dẫn xuất, không lưu.
  - «Chậm» khi % < % thời gian đã trôi − ngưỡng. «Rủi ro» khi độ tự tin lần cuối < ngưỡng. Vế «quá 14 ngày không check-in» chỉ bật khi đã có `lastCheckinAt`.
  - Không gắn cờ khi `progressPercent` NULL, đã chốt kỳ, Completed/Cancelled, hoặc kỳ chưa bắt đầu.
  - BE trả cờ trong list/tree/me-goals.
  - FE: badge kèm tooltip lý do trên /goals, cây, header chi tiết và thẻ /me. Chip «Rủi ro (n)» có tham số trên URL. Widget dashboard hiện số rủi ro.
  - Ghi công thức đã chốt vào SPEC-10 §8.
- **Luồng.** Xuất phát /. **Trước: 25, 17 chuyển trang** (không có khái niệm rủi ro, phải mở từng mục tiêu). **Sau: 2** (sidebar → chip «Rủi ro»). NV trên /me: 3→0.
- **Tiêu chí chấp nhận.**
  1. Kỳ đã trôi 60%, mục tiêu đạt 30%: badge «Chậm», tooltip «Kỳ vọng ~60%, đạt 30%» (cả /goals lẫn /me).
  2. 3 mục tiêu rủi ro: chip «Rủi ro (3)» lọc đúng 3; tham số trên URL, dán link mở lại đúng.
  3. NULL, đã chốt, Completed/Cancelled, `periodStart` tương lai: không gắn cờ.
  4. Không có rủi ro: «Không có mục tiêu rủi ro trong kỳ này».
  5. Người xem phạm vi Own: số đếm chỉ tính mục tiêu họ được xem.
  6. Unit test mốc biên (đầu kỳ, cuối kỳ, kỳ 1 ngày, `periodEnd` đã qua, máy khách khác múi giờ) đúng theo giờ công ty.
- **Zone.** Logic hiển thị dẫn xuất, không lưu cột, đổi DTO đọc nhỏ.
- **Dẫn chứng.** `docs/SPEC/SPEC-10 GOAL.md:176,402`; `components/dashboard/GoalProgressWidget.tsx:79`; `apps/api/src/dashboard/dashboard-widget-handlers.service.ts:736-758`.
- **Ghi chú.** Chỉ hiển thị, không phát thông báo (thông báo thuộc QL-12). Hai vế đầu làm được trước QL-01.

##### US-GOAL-QL-03 · /goals mặc định quý hiện tại + phòng của tôi; bộ lọc, chế độ xem, tab trên URL
*Gộp từ: US-GOAL-NV-05.* · **P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-X-92 (quý hiện tại theo giờ công ty) · Spec: SPEC-10 §9 GOAL-SCREEN-001/002, GOAL-API-001

- **Story.** Là quản lý (và nhân viên), tôi muốn vào /goals là thấy ngay mục tiêu quý hiện tại của phòng mình, bấm «Của tôi» khi cần, và bộ lọc/chế độ xem/tab chi tiết giữ nguyên qua F5, Back và link gửi đi.
- **Cơ chế.**
  - `validateSearch` không ném cho `/goals` (period, departmentId, status, level, view, mine, risk) và `/goals/$goalId` (tab).
  - URL trống thì kỳ = quý hiện tại theo giờ công ty; `departmentId` = phòng của tôi từ `/auth/me`, chỉ với scope `view:goal` rộng hơn Own.
  - Chip «Kỳ trước / Quý này / Năm nay».
  - «Của tôi» theo ngữ nghĩa của `/me/goals` (phụ trách **hoặc** chủ thể): ở danh sách gọi `GET /me/goals` kèm kỳ; ở cây thì làm nổi nhánh của tôi hoặc chuyển sang danh sách (chọn khi lập plan). **Không dùng `?employeeId=`** vì tham số này chỉ lọc chủ thể neo.
  - Nút «Quay lại» trong chi tiết giữ search của danh sách.
  - Nhớ lựa chọn gần nhất bằng `localStorage` (try/catch) khi URL trống.
- **Luồng.** Xuất phát /. **Trước: 6, 1 chuyển trang** (sidebar → Danh sách → từ ngày → đến ngày → phòng (2); lọc người thêm 2, lọc client trên tối đa 200 dòng; F5 hoặc «Quay lại» là mất). **Sau: 1** (sidebar).
- **Tiêu chí chấp nhận.**
  1. QL phòng Kinh doanh, ngày 23/10/2026, mở /goals không tham số: kỳ 01/10–31/12/2026 + phòng Kinh doanh, URL phản ánh các giá trị này.
  2. Chuyển sang danh sách + lọc Active, rồi F5, Back hoặc «Quay lại» từ chi tiết: góc nhìn khôi phục y nguyên.
  3. `/goals/{id}?tab=checkins` mở thẳng tab Lịch sử check-in.
  4. «Của tôi» thấy cả mục tiêu nhân viên của tôi LẪN mục tiêu phòng/dự án tôi phụ trách.
  5. Link `/goals?mine=1` từ người khác: thấy mục tiêu của chính người đang xem.
  6. Tham số rác (`?period=abc&departmentId=xyz&status=xyz`): bỏ qua, dùng mặc định, không màn lỗi.
  7. «Của tôi» rỗng: «Bạn chưa có mục tiêu trong kỳ này» + Tạo (nếu có `create:goal`) + «Xem kỳ trước».
  8. Không có `view:goal`: trạng thái không đủ quyền, không tải dữ liệu.
- **Zone.** FE thuần, dùng tham số BE sẵn có.
- **Dẫn chứng.** `routes/goals/GoalListPage.tsx:32-39,56-59,73,102-118,275-304`; `GoalDetailPage.tsx:63,224`; `router.tsx:2683,2696-2700,2761,3127-3141`; `apps/api/src/goals/goals.repository.ts:179,186`; `contracts/src/goal.ts:140-151`.

##### US-GOAL-QL-04 · «Thêm mục tiêu con» kế thừa cha (kỳ, phòng, cấp) qua prefill URL
**P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-GOAL-QL-03 · Spec: SPEC-10 §9 GOAL-SCREEN-002/003

- **Story.** Là quản lý, tôi muốn bấm «Thêm mục tiêu con» ngay trong mục tiêu phòng để form mở sẵn cha, kỳ, phòng, cấp gợi ý và Active, để phân rã xuống từng người chỉ còn gõ tên, chọn người, nhập chỉ tiêu.
- **Cơ chế.** `/goals/new` nhận search param `parentGoalId/level/departmentId/projectId/periodType/periodStart/periodEnd`. Đây chỉ là gợi ý; BE vẫn validate GOAL-ERR-001/011/012. Tab «Mục tiêu con» có «+ Thêm mục tiêu con» bọc `PermissionGate create:goal`. Chọn Quý/Năm thì tự điền ngày (helper `quarterRange`/`yearRange` của US-X-92, chung với NV-01). Tạo từ cha thì mặc định Active. Lưu xong về tab Mục tiêu con của cha. Có thêm «Lưu và thêm tiếp» giữ prefill. Cơ chế prefill làm **một lần**, dùng chung cho QL-10 (`level=project&projectId=`) và NV-12.
- **Luồng.** /goals/{cha}, 1 mục tiêu con. **Trước: 17, 3 chuyển trang** (về danh sách → Tạo → tên → cấp (2) → NV (2) → cha trong select 200 dòng (2) → 2 ngày → kiểu đo + chỉ tiêu (3) → Active (2) → Lưu). **Sau: 7, 1 chuyển trang** (Thêm mục tiêu con → tên → NV (2) → chỉ tiêu → kiểu đo nếu khác (0–1) → Lưu và thêm tiếp). 6 NV: 102→42.
- **Tiêu chí chấp nhận.**
  1. Mục tiêu phòng Q4/2026 Active: form mở với cha, kỳ Q4 (01/10–31/12), phòng, Active điền sẵn, cấp gợi ý «Nhân viên».
  2. «Lưu và thêm tiếp»: tạo xong có toast, form giữ cha/kỳ/phòng, xoá tên/người/chỉ tiêu.
  3. Form trống chọn Quý: ngày tự điền theo quý hiện tại, sửa tay được.
  4. Không có `create:goal`: không có nút. Tự gõ URL thì BE từ chối và form báo lỗi quyền.
  5. `parentGoalId` không tồn tại hoặc đã chốt kỳ: cảnh báo «Mục tiêu cha không hợp lệ», bỏ prefill cha.
- **Zone.** FE (route search + form + nút), dùng `POST /goals` sẵn có.
- **Dẫn chứng.** `GoalDetailPage.tsx:240-246,378-434`; `GoalFormPage.tsx:128-134,307-350`; `goal-form-schema.ts:108-126`; `router.tsx:2696-2700`.

##### US-GOAL-QL-05 · Giao một mục tiêu con cho nhiều nhân viên trong một lần
**P1 · L · 🔴 red** · Lớp FE, BE, DOC · Phụ thuộc: US-GOAL-QL-04 · Spec: SPEC-10 GOAL-FUNC-001/002, GOAL-API-002 (thêm GOAL-API batch) · **Owner quyết (§7 Q16)**

- **Story.** Là quản lý, tôi muốn chọn nhiều nhân viên và tạo cho mỗi người một mục tiêu con cùng tên/kiểu đo/chỉ tiêu (sửa được từng dòng trước khi lưu), để phân rã cho 6 người trong một màn.
- **Cơ chế.** Hộp thoại «Giao cho nhiều người» từ tab Mục tiêu con: chọn nhiều nhân viên, một dòng mẫu (tên, kiểu đo, target, unit), bảng xem trước sửa target từng người, một nút tạo. BE thêm `POST /goals/batch` dùng lại cặp `create:goal`:
  - kiểm scope **từng** mục tiêu;
  - tạo cả lô trong một transaction (tất cả hoặc không), trần 50 dòng;
  - audit từng mục tiêu, phát `GOAL_ASSIGNED` cho từng người;
  - `Idempotency-Key` suy từ nội dung payload.
- **Luồng.** /goals/{cha}, 6 NV. **Trước: 102** (khoảng 42 sau QL-04). **Sau: ~14, 0 chuyển trang** (Giao cho nhiều người → mở chọn → 6 người → tên → kiểu đo (2) → target → «Tạo 6 mục tiêu»).
- **Tiêu chí chấp nhận.**
  1. `create:goal` phạm vi phòng, 6 NV trong phòng: 6 mục tiêu cấp nhân viên dưới đúng cha, kế thừa kỳ, Active; mỗi người một `GOAL_ASSIGNED`.
  2. Lô có 1 NV ngoài phạm vi: BE trả lỗi quyền chỉ rõ dòng, KHÔNG mục tiêu nào được tạo (deny-path chạy trước, `LANE_DB`).
  3. Vượt trần hoặc thiếu tên/target: nút khoá kèm lý do; gọi thẳng thì BE trả 400.
  4. Mỗi mục tiêu có đúng một bản ghi audit (actor là QL), cùng transaction.
  5. Gửi lại cùng payload: không sinh trùng.
- **Zone.** Đường GHI mới tự kiểm quyền từng phần tử + audit theo lô; FULL gate (security + database + silent-failure).
- **Dẫn chứng.** `apps/api/src/goals/goals.controller.ts:80`; `goals.service.ts:210`; `apps/api/src/notifications/goal-noti-bridge.registrar.ts:54-83`.
- **Ghi chú.** Phân rã diễn ra mỗi quý một lần. Đo lại sau QL-04 rồi mới quyết làm.

##### US-GOAL-QL-06 · Chốt kỳ hàng loạt cho mục tiêu của phòng
**P1 · L · 🔴 red** · Lớp FE, BE, DOC · Phụ thuộc: US-GOAL-QL-03 · Spec: SPEC-10 GOAL-FUNC-005, GOAL-DEC-003 · **Owner quyết kiểu lô (§7 Q17)**

- **Story.** Là quản lý, cuối quý tôi muốn mở danh sách «Sẵn sàng chốt», chọn nhiều mục tiêu, xem trước số sẽ đóng băng và chốt một lần.
- **Cơ chế.** Danh sách /goals có chế độ chọn nhiều và hành động «Chốt kỳ (n)», chỉ hiện khi có `finalize:goal`. Chip «Sẵn sàng chốt» = chưa `finalizedAt`, trạng thái Active/Completed, `periodEnd ≤ hôm nay`. Hộp thoại xem trước bảng mục tiêu, % sẽ đóng băng và ghi chú chung. BE thêm `POST /goals/finalize-batch` dùng lại cặp `finalize:goal`:
  - kiểm scope và điều kiện từng mục tiêu;
  - ghi `goal_updates` loại finalize + audit từng mục tiêu, phát `GOAL_FINALIZED` như chốt lẻ;
  - trả kết quả từng dòng.
  
  Không có «mở lại hàng loạt».
- **Luồng.** /goals, 12 mục tiêu. **Trước: 48, 24 chuyển trang** (mỗi mục: mở → Chốt kỳ → xác nhận → quay lại). **Sau: ~6, 0 chuyển trang** (chip → chọn tất cả → «Chốt kỳ (12)» → ghi chú → xác nhận).
- **Tiêu chí chấp nhận.**
  1. 12 mục tiêu Q3 hết kỳ chưa chốt: chip «Sẵn sàng chốt» hiện đúng 12 kèm % hiện tại.
  2. Xác nhận: mỗi mục có `finalizedAt`, một `goal_updates` loại finalize, một audit; người phụ trách nhận `GOAL_FINALIZED`.
  3. Có mục đã chốt hoặc Draft/Cancelled trong lô: dòng đó bị từ chối với mã GOAL-ERR, hiện trong kết quả; các dòng hợp lệ xử lý theo quy tắc owner chốt.
  4. Không có `finalize:goal` hoặc ngoài phạm vi: bị từ chối (deny-path RED trước); FE không hiện checkbox hay hành động.
  5. Không có gì sẵn sàng: «Không có mục tiêu nào chờ chốt kỳ này».
  6. «Mở lại» lẻ ở chi tiết giữ nguyên hành vi.
- **Zone.** Chốt kỳ là điểm kiểm soát thay cho phê duyệt (GOAL-DEC-003); endpoint ghi mới đóng băng số liệu. FULL gate.
- **Dẫn chứng.** `GoalDetailPage.tsx:158-171,256-262`; `apps/api/src/goals/goals.controller.ts:148-169`; `GoalListPage.tsx:123-170`.

##### US-GOAL-QL-07 · Wizard phân rã: áp người/hạn cho tất cả, hạn theo giờ công ty, xem việc vừa tạo
**P1 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-X-92 (mở drawer việc cần US-TASK-NV-04) · Spec: SPEC-10 §9 GOAL-SCREEN-004, GOAL-FUNC-007, GOAL-API-011

- **Story.** Là quản lý, trong wizard phân rã tôi muốn đặt người làm và hạn một lần cho mọi dòng, hạn đúng cuối ngày giờ công ty, và sau khi tạo thấy ngay danh sách việc vừa sinh.
- **Cơ chế.** Hàng «Áp cho tất cả» (người + hạn) trên bảng xem trước; dòng đã sửa tay thì giữ. `dueAt` dựng bằng `endOfLocalDay` của US-X-92 theo giờ công ty (23:59:59 địa phương) thay chuỗi UTC cứng; nguồn múi giờ là `companyTimeZone()` mà US-X-92 đưa lên web-core. `onSuccess` chuyển sang bước «Đã tạo n việc» liệt kê `tasks[{id,taskCode,title}]` (response đã có), mỗi việc mở drawer, có «Mở board dự án».
- **Luồng.** /goals/{id}, mẫu 10 dòng. **Trước: ~35** (Phân rã → mẫu (2) → 10×(người 2 + hạn 1) → Tạo; đóng là không có kết quả). **Sau: 8** (Phân rã → mẫu (2) → áp người (2) → áp hạn → Tạo → mở board).
- **Tiêu chí chấp nhận.**
  1. Chọn người A và hạn 31/10 ở «Áp cho tất cả»: 10 dòng nhận A + 31/10; dòng đã sửa tay giữ giá trị riêng.
  2. Công ty UTC+7, hạn 31/10/2026: `dueAt` là 31/10 23:59:59 giờ công ty (không phải 01/11 06:59).
  3. Tạo xong: bước kết quả có đủ 10 việc (mã/tiêu đề); bấm một việc mở drawer.
  4. QL không có `read:employee`: không có ô «Áp người» (giữ hành vi fail-soft), vẫn tạo được việc chưa giao.
  5. BE lỗi (vượt `GOAL_DECOMPOSE_MAX`, mục tiêu đã chốt): giữ dữ liệu, báo lỗi, không đóng.
- **Zone.** FE thuần trên wizard và endpoint sẵn có.
- **Dẫn chứng.** `routes/goals/components/GoalDecomposeWizard.tsx:106-121,139-157,159-171`; `contracts/src/goal.ts:402-413`; `apps/app/src/routes/rooms/room-time.ts:31` (`companyTimeZone()`, đường dẫn đã sửa 23/10).

##### US-GOAL-QL-08 · Lối vào «Danh mục mẫu việc» từ /goals và từ wizard khi chưa có mẫu
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-10 §9 GOAL-SCREEN-006, GOAL-FUNC-008

- **Story.** Là quản lý, tôi muốn có nút «Mẫu việc» trên trang Mục tiêu và lối «Tạo mẫu» trong wizard khi chưa có mẫu, để tìm được nơi soạn mẫu mà không phải biết URL.
- **Cơ chế.** Nút «Mẫu việc» trên header /goals bọc `PermissionGate manage:task-template`, dẫn tới `/goals/templates`. Wizard rỗng mẫu thì có link «Tạo mẫu mới» (quay lại wizard sau khi lưu qua `?returnTo=`).
- **Luồng.** **Trước:** không có đường UI (route `showInSidebar:false`, wizard dừng ở bước chọn mẫu). **Sau: 2** (Mẫu việc → trang mẫu).
- **Tiêu chí chấp nhận.**
  1. Có `manage:task-template`: thấy nút, bấm mở `/goals/templates`.
  2. Không có cặp: không thấy nút; gõ URL thì trang báo không đủ quyền như hiện nay.
  3. Chưa có mẫu: wizard có thông điệp rỗng + «Tạo mẫu mới» (chỉ khi có quyền).
  4. Tạo mẫu xong quay lại: mẫu mới có trong danh sách chọn, không cần F5.
- **Zone.** Nút điều hướng có `PermissionGate`.
- **Dẫn chứng.** `router.tsx:2716-2735`; `GoalDecomposeWizard.tsx:252-254`. Nợ của `S5-GOAL-TPL-1`.

##### US-GOAL-QL-09 · Xem nhanh lịch sử check-in trong drawer, có tên người check-in
**P1 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-GOAL-QL-01 (`actorName`), US-GOAL-QL-03 · Spec: SPEC-10 GOAL-API-008, GOAL-SCREEN-001/002

- **Story.** Là quản lý, tôi muốn bấm biểu tượng «lịch sử» trên dòng mục tiêu để mở drawer bên phải xem 5 lần check-in gần nhất, để rà cả đội mà không rời danh sách.
- **Cơ chế.** Drawer phải dùng `GET /goals/:id/updates?limit=5` sẵn có, tên lấy từ `actorName` (QL-01). Khi drawer mở, phím ↑/↓ chuyển mục tiêu trong danh sách đang lọc. `?peek=<goalId>` nằm trên URL.
- **Luồng.** /goals, 8 mục tiêu. **Trước: 24, 16 chuyển trang** (3×8). **Sau: 9, 0 chuyển trang** (mở drawer → ↓×7 → đóng).
- **Tiêu chí chấp nhận.**
  1. Mỗi dòng trong drawer có thời điểm, giá trị/%, độ tự tin, ghi chú, tên người check-in.
  2. ↓ chuyển sang mục tiêu kế, URL cập nhật `?peek=`.
  3. Chưa có check-in: «Chưa có check-in nào» + «Mở chi tiết».
  4. Mục tiêu ngoài phạm vi (kể cả gõ `?peek=` tay): BE 403/404, drawer báo không đủ quyền, không lộ tên.
  5. Lỗi mạng: lỗi + Thử lại, danh sách phía sau không ảnh hưởng.
- **Zone.** FE thuần trên endpoint đọc sẵn có.
- **Dẫn chứng.** `GoalDetailPage.tsx:224-249`; `GoalCheckinsTab.tsx:51-75`; `contracts/src/goal.ts:214`; `apps/api/src/goals/goals.controller.ts:136`.

##### US-GOAL-QL-10 · Mở lại S7-GOAL-PROJTAB-1: tab «Mục tiêu» trong workspace dự án
**P1 · M · 🟡 yellow (lát A FE 🟢)** · Lớp FE, DOC · Phụ thuộc: US-GOAL-QL-04 · Spec: S7-GOAL-PROJTAB-1; SPEC-10 §7 · **Owner quyết endpoint coverage (§7 Q19)**

- **Story.** Là quản lý dự án, tôi muốn workspace dự án có tab «Mục tiêu» liệt kê mục tiêu gắn dự án kèm tiến độ và nút tạo mục tiêu dự án điền sẵn.
- **Cơ chế.** **Không tạo WO mới:** đổi `S7-GOAL-PROJTAB-1` về todo (sổ ghi done là sai: reconcile đóng dấu từ commit kế hoạch `984dfa24`) và thi công theo `docs/plans/S7-GOAL-PROJTAB-1.md`, tách lát.
  - **Lát A (green):** thêm `'goals'` vào `PROJECT_WORKSPACE_TABS` (deep-link `?tab=goals`), tab dùng `GET /goals?projectId=` sẵn có, nút «Tạo mục tiêu dự án» mở `/goals/new?level=project&projectId=…` (prefill QL-04).
  - **Lát B (yellow):** `GET /goals/project-coverage` hai cổng (`view:goal` + phạm vi `read:task`), deny-path RED.
- **Luồng.** Workspace dự án. **Trước: 5–8, 2 chuyển trang** (sang /goals → Danh sách → lọc cấp Dự án → dò tên dự án; FE không gửi `projectId`). **Sau: 1** (tab Mục tiêu).
- **Tiêu chí chấp nhận.**
  1. Dự án X có 2 mục tiêu cấp dự án: tab hiện 2 mục kèm tiến độ, trạng thái, người phụ trách; URL `?tab=goals`.
  2. Chưa có mục tiêu, có `create:goal`: trạng thái rỗng + «Tạo mục tiêu dự án» điền sẵn cấp Dự án + X.
  3. Không có `view:goal`: không có tab, `?tab=goals` rơi về tab mặc định.
  4. API lỗi: báo lỗi + Thử lại, các tab khác vẫn dùng được.
  5. Xong WO: reconcile ghi đúng trạng thái theo commit mã.
- **Zone.** Theo WO gốc (yellow); lát A là green.
- **Dẫn chứng.** `routes/tasks/workspace-constants.ts:21-29`; `contracts/src/goal.ts:143`; `GoalListPage.tsx:78-88`; `router.tsx:1499-1505`; `harness/backlog.mjs:9326-9365`.

##### US-GOAL-QL-11 · Kích hoạt hàng loạt các mục tiêu Nháp của đội từ danh sách
**P1 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-GOAL-QL-03, US-GOAL-NV-02 · Spec: SPEC-10 GOAL-API-004

- **Story.** Là quản lý, tôi muốn chọn nhiều mục tiêu Nháp của đội và kích hoạt cùng lúc, để không phải vào form Sửa của từng mục tiêu.
- **Cơ chế.** Danh sách /goals có chế độ chọn nhiều (gate cặp `update:goal`) và «Kích hoạt (n)», gọi `PATCH {status:'Active'}` cho từng mục (hook chung với NV-02), giới hạn đồng thời. Cập nhật lạc quan, dòng lỗi rollback, toast tổng kết. Chip «Nháp» dùng tham số status trên URL (QL-03). Mỗi PATCH vẫn được BE validate và ghi audit.
- **Luồng.** /goals, 6 mục Draft. **Trước: 36, 24 chuyển trang** (6×(mở → Sửa → Trạng thái (2) → Lưu → quay lại)). **Sau: 4** (chip Nháp → chọn tất cả → «Kích hoạt (6)» → xác nhận).
- **Tiêu chí chấp nhận.**
  1. 6 mục Draft trong phạm vi: cả 6 thành Active, toast «Đã kích hoạt 6 mục tiêu», mỗi mục một audit.
  2. 1/6 bị BE từ chối (ngoài phạm vi hoặc đã chốt): dòng đó về Draft, toast «5 thành công, 1 lỗi» kèm lý do.
  3. Không có cặp `update:goal`: không có checkbox hay hành động hàng loạt.
  4. Chọn lẫn mục không phải Draft: nút chỉ đếm và chỉ gửi mục Draft.
  5. Mất mạng giữa chừng: dòng chưa gửi giữ trạng thái, toast báo số dòng chưa xử lý, không có thành công giả.
- **Zone.** Luồng trạng thái mục tiêu qua PATCH sẵn có; lỗi từng phần phải báo rõ.
- **Dẫn chứng.** `GoalFormPage.tsx:402-410`; `GoalDetailPage.tsx:150,192-200`; `apps/api/src/goals/goals.controller.ts:96`; `goals.service.ts:290`.

##### US-GOAL-QL-12 · Nhắc check-in hằng tuần và báo quản lý khi mục tiêu chuyển «Chậm»
*Gộp từ: US-GOAL-NV-14.* · **P2 · L · 🔴 red** · Lớp BE, DB, FE, DOC · Phụ thuộc: US-GOAL-QL-02 · Spec: SPEC-10 §5.2, §17; SPEC-08 · **Owner quyết (§7 Q18)**

- **Story.** Là quản lý, tôi muốn hệ thống tự nhắc nhân viên check-in mỗi tuần và gửi tôi một thông báo gộp khi mục tiêu của đội chuyển «Chậm». Là nhân viên, tôi muốn bấm thông báo là mở luôn hộp check-in.
- **Cơ chế.** Job hằng tuần (`@SystemJobHandler`, cùng khuôn job đối soát đêm, theo giờ công ty):
  - Mục tiêu manual Active chưa check-in 7 ngày trở lên: **một** thông báo gộp cho mỗi người phụ trách mỗi tuần. Đích là `/goals/{id}?checkin=1` nếu chỉ một mục, `/me` nếu nhiều mục.
  - Mục tiêu mới chuyển «Chậm» (công thức QL-02): **một** thông báo gộp cho quản lý phạm vi, đích `/goals?risk=1`.
  
  Thêm 2 NOTI-EVENT vào catalog bằng migration seed (CHECK catalog ở **hai** bảng), đi qua outbox → bridge chung. Trang chi tiết đọc `?checkin=1` để tự mở hộp thoại. Người dùng tắt được qua tuỳ chọn thông báo cá nhân. Khoá idempotent theo người + tuần. Sửa SPEC-10 §5.2/§17 trong cùng WO.
- **Luồng.** **Trước:** không có thông báo; QL tự rà ~25 thao tác, 17 chuyển trang; NV tự nhớ rồi đi luồng 10 thao tác. **Sau:** QL bấm thông báo = 1; NV chuông → thông báo (hộp tự mở) → sửa số → Ctrl+Enter = 4.
- **Tiêu chí chấp nhận.**
  1. A có 2 mục tiêu chưa check-in 8 ngày: A nhận ĐÚNG 1 thông báo liệt kê 2 mục; chạy lại job cùng tuần không sinh trùng.
  2. Bấm thông báo một mục: `/goals/{id}?checkin=1` tự mở hộp thoại; mục đã chốt hoặc không Active thì hiện lý do khoá.
  3. 3 mục tiêu trong phòng vừa chuyển «Chậm»: quản lý phạm vi nhận 1 thông báo gộp mở `/goals?risk=1`.
  4. Người nhận không còn `view:goal`: không gửi (deny-path RED trước, `LANE_DB`).
  5. Đã tắt loại thông báo: không gửi. Đã check-in trong 7 ngày: không nhắc.
  6. Job lỗi giữa chừng: chạy lại không gửi trùng, lỗi được ghi log, không nuốt im.
  7. SPEC-10 §5.2/§17 và catalog NOTI-EVENT cập nhật cùng PR.
- **Zone.** Migration seed catalog + job mới + đổi phạm vi đã hoãn trong SPEC.
- **Dẫn chứng.** `apps/api/src/notifications/goal-noti-bridge.registrar.ts:40-83`; `docs/SPEC/SPEC-10 GOAL.md:133,346`; `apps/api/src/goals/goal-reconciliation.job-handler.ts:33`.
- **Ghi chú.** Nên tách: (a) docs + seed catalog (red); (b) job + FE `?checkin=1`. Chỉ mở sau khi nhãn «Cần check-in» (QL-01) đã chạy 2–4 tuần và vẫn thấy nhiều người quên.

##### US-GOAL-QL-13 · Phản hồi check-in: nút «Phản hồi» mở chat riêng mang ngữ cảnh mục tiêu
**P2 · S · 🟡 yellow** · Lớp FE · Phụ thuộc: US-GOAL-QL-09, US-CHAT-NV-06 (điền sẵn nháp) · Spec: SPEC-10 GOAL-API-008; SPEC-15 CHAT-DEC-026 · **Owner quyết bình luận gắn check-in (§7 Q20)**

- **Story.** Là quản lý, tôi muốn từ một lần check-in bấm «Phản hồi» để mở chat riêng với người check-in, ô soạn có sẵn link và tên mục tiêu, để góp ý trong 2–3 thao tác mà không mất ngữ cảnh.
- **Cơ chế.** Nút «Phản hồi» trên dòng check-in có `actorUserId` khác người xem. Gọi `chatApi.openDirect({peerUserId: actorUserId})` (luồng DM sẵn có, giữ mọi kiểm quyền CHAT), rồi `openRoom` mở drawer. Ô soạn điền sẵn «Về mục tiêu [mã — tên] (check-in ngày …): » + link `/goals/{id}?tab=checkins` bằng cách ghi trước vào store nháp của CHAT-NV-06. Không tự gửi. Không đổi schema GOAL. `S17-CHAT-RTROOMOPS-1` đã merge (#601) nên không còn đụng file CHAT với phiên khác.
- **Luồng.** /goals/{id} tab Lịch sử. **Trước: 5, 1 chuyển trang** (Tin nhắn → tìm người (2) → gõ + tự dán link → gửi). **Sau: 3, 0 chuyển trang** (Phản hồi → gõ → gửi).
- **Tiêu chí chấp nhận.**
  1. Check-in của A: «Phản hồi» mở drawer DM với A, ô soạn có tên/mã mục tiêu + link; trang mục tiêu giữ nguyên.
  2. Chưa có DM với A: tạo theo đúng luồng DM hiện có.
  3. Không có quyền CHAT hoặc A không còn hoạt động: nút ẩn hoặc vô hiệu kèm lý do.
  4. A mở link mà không có quyền xem mục tiêu: thông báo không đủ quyền của GOAL, không lộ nội dung.
  5. Dòng do chính QL check-in: không có «Phản hồi».
- **Zone.** FE nối GOAL → drawer CHAT, không đổi quyền hay schema.
- **Dẫn chứng.** `contracts/src/goal.ts:180,214`; `components/chat/chat-dock.store.ts:93-101`; `packages/web-core/src/lib/chat-api.ts:102`; `components/chat/MessageComposer.tsx:96`; `GoalCheckinsTab.tsx:51-75`.

##### US-GOAL-QL-14 · Tab «Công việc gắn» bấm được, nhóm theo người, nổi bật việc quá hạn
*Gộp từ: US-GOAL-NV-06.* · **P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-TASK-NV-04 · Spec: SPEC-10 GOAL-FUNC-006, GOAL-API-010

- **Story.** Là quản lý (và nhân viên), tôi muốn bấm vào dòng việc trong tab Công việc gắn để mở drawer chi tiết, xem việc nhóm theo người và thấy ngay việc quá hạn, để biết mục tiêu kẹt ở đâu, ở ai.
- **Cơ chế.** Dòng việc mở drawer việc qua `?task=<id>` (NV-04), Back đóng drawer. Đóng drawer thì invalidate tiến độ mục tiêu (`goalInvalidation.taskProgress`). Nút gạt «Nhóm theo người» (x/y xong), tô đỏ việc quá hạn (theo giờ công ty) và đưa lên đầu nhóm. Dữ liệu từ `GET /goals/:id/tasks` sẵn có (đã có `assigneeName`, `dueAt`).
- **Luồng.** /goals/{id}. **Trước: ~6, 2 chuyển trang** (nhớ tên → /tasks → tìm/lọc (2) → mở → quay lại). **Sau: 2, 0 chuyển trang** (tab → bấm dòng).
- **Tiêu chí chấp nhận.**
  1. Bấm một trong 10 việc gắn: drawer mở đè lên trang, URL có `?task=<id>`.
  2. Back hoặc Esc: drawer đóng, vẫn ở tab Công việc gắn.
  3. Đổi việc sang Done trong drawer với mục tiêu mode tasks: đóng drawer thì % được làm mới.
  4. «Nhóm theo người»: mỗi nhóm có tên + «x/y xong»; việc quá hạn tô đỏ, đứng đầu nhóm.
  5. Việc ngoài phạm vi đọc task: drawer báo «Không mở được việc này», không lộ nội dung.
  6. Chưa gắn việc: giữ trạng thái rỗng + «Gắn việc» theo quyền.
- **Zone.** FE thuần.
- **Dẫn chứng.** `routes/goals/components/GoalLinkedTasksTab.tsx:82,127-157`; `routes/tasks/ProjectDetailPage.tsx:520,755`.

##### US-GOAL-QL-91 · Nhãn widget «Mục tiêu kỳ này» phân biệt được từng mục tiêu *(bổ sung khi tổng hợp)*
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: — (phối hợp `S4-DASH-WIDGETCARD-VARIANT-1`, cùng `components/dashboard/**`) · Spec: SPEC-07 §7 DASH, SPEC-10

- **Story.** Là quản lý có phòng nhiều mục tiêu, tôi muốn mỗi dòng trong widget «Mục tiêu kỳ này» ghi rõ tên mục tiêu, vì hiện mọi dòng chỉ ghi tên phòng.
- **Cơ chế.** Nhãn dòng là «<tên phòng> — <tên mục tiêu>» (cắt gọn, có `title` đầy đủ); mục tiêu không có phòng thì chỉ ghi tên mục tiêu. Làm độc lập, không chờ công thức «Chậm».
- **Luồng.** Dashboard. **Trước:** không phân biệt được, phải mở từng dòng (1 thao tác + 1 chuyển trang mỗi dòng). **Sau: 0**.
- **Tiêu chí chấp nhận.**
  1. Phòng có 3 mục tiêu: 3 dòng có 3 nhãn khác nhau.
  2. Tên dài: cắt gọn không vỡ bố cục ở độ rộng điện thoại; trình đọc màn hình đọc đủ tên.
  3. Bấm dòng vẫn mở đúng `/goals/$goalId`.
- **Zone.** FE một dòng hiển thị.
- **Dẫn chứng (đã kiểm 23/10).** `components/dashboard/GoalProgressWidget.tsx:78-80` (`{item.departmentName ?? item.goalName}`).

##### US-GOAL-QL-92 · Cây mục tiêu thu gọn/mở rộng được và nhớ trạng thái *(bổ sung khi tổng hợp)*
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-10 GOAL-SCREEN-001

- **Story.** Là quản lý 2–5 dự án và 6–15 người, tôi muốn thu gọn các nhánh cây mục tiêu, để tìm một phòng/dự án mà không phải cuộn qua toàn bộ.
- **Cơ chế.** Nút thu gọn/mở trên mỗi nút có con. «Thu gọn tất cả» / «Mở tất cả». Phím ←/→ theo mẫu WAI-ARIA tree. `aria-expanded` phản ánh đúng trạng thái. Nhớ nhánh đang mở bằng `localStorage` (try/catch). Nhánh chứa kết quả lọc «Của tôi»/«Rủi ro» tự mở.
- **Luồng.** /goals chế độ cây. **Trước: ~4 lần cuộn** (cây luôn bung hết). **Sau: 2** (Thu gọn tất cả → mở nhánh cần xem).
- **Tiêu chí chấp nhận.**
  1. Thu gọn một nhánh: con ẩn, `aria-expanded=false`; tải lại vẫn thu gọn.
  2. «Thu gọn tất cả» chỉ còn các nút gốc.
  3. Bàn phím: ← thu gọn, → mở, focus không mất.
  4. `localStorage` bị chặn: cây mặc định bung như hiện tại, không lỗi.
- **Zone.** FE thuần.
- **Dẫn chứng (đã kiểm 23/10).** `routes/goals/components/GoalTreeView.tsx:38` (`aria-expanded={hasChildren ? true : undefined}`, không có thu gọn).

### 5.4 Liên module — vỏ ứng dụng, NOTI, DASH, ME, Ctrl+K

| Id | Tiêu đề | Vai | Loại | Ưu tiên | Cỡ | Zone | Thao tác trước→sau |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-X-91 | Hệ thông báo nổi dùng chung (toast + `aria-live`) cho apps/app *(bổ sung)* | cả hai | hoàn thiện | P0 | S | 🟢 | lỗi im lặng→phản hồi ngay |
| US-X-05 | «+ Tạo việc» trên topbar và phím tắt tạo việc chỉ cần tiêu đề | cả hai | ux | P0 | M | 🟢 | 8→3 (3→0 chuyển trang) |
| US-X-92 | Giờ công ty dùng chung trên web-core: hôm nay, đầu/cuối ngày, quý, năm *(bổ sung khi kiểm độ phủ)* | cả hai | hoàn thiện | P0 | S | 🟢 | nền; chặn lệch nhóm «Hôm nay» |
| US-X-08 | «Hôm nay» làm được việc ngay (biến thể A khối /me · B dashboard Employee, chờ Q21) | NV | ux | P0 | M | 🟡 | 5 (+dò ngày)→A: 2 · B: 4 (3 với `defaultLanding`) |
| US-X-93 | Luồng hằng ngày trên điện thoại (375px) cho Công việc và Mục tiêu *(bổ sung khi kiểm độ phủ)* | NV | ux | P1 | M | 🟢 | đổi trạng thái 4→2 · check-in 5→3 (2→0 chuyển trang) |
| US-X-03 | Hàng việc và đơn nghỉ trong widget dashboard bấm được | QL | hoàn thiện | P1 | S | 🟡 | 3→1 |
| US-X-04 | Quick action và lối tắt dashboard / me dẫn đúng chỗ; Check-in trên widget | cả hai | hoàn thiện | P1 | S | 🟡 | 4→1 |
| US-X-06 | Thông báo đến tức thì qua realtime, kèm toast bấm được | cả hai | tối ưu | P1 | S | 🟡 | 3→1 |
| US-X-07 | Ctrl+K tìm được cả việc, dự án và đồng nghiệp | cả hai | hoàn thiện | P1 | M | 🟠 | 6→3 |
| US-X-09 | Dashboard hiện đủ widget đã seed; widget thiếu component bị test chặn | QL | hoàn thiện | P1 | M | 🟢 | 4→0 |
| US-X-12 | Nút «Nhắn tin» cạnh người phụ trách việc và thành viên dự án | cả hai | ux | P1 | M | 🟠 | 9→3 |
| US-X-11 | Link nội bộ trong tin nhắn mở trong ứng dụng | cả hai | ux | P2 | S | 🟢 | 3→1 |
| US-X-13 | Trang Thông báo: bấm dòng đi thẳng tới đích, lọc theo module | cả hai | ux | P2 | S | 🟢 | 3→1 |
| US-X-14 | Hộp «Chờ tôi xử lý»: đơn nghỉ chờ duyệt và việc chờ review | QL | tối ưu | P2 | M | 🟡 | 7→2 |

##### US-X-91 · Hệ thông báo nổi dùng chung (toast + vùng `aria-live`) cho apps/app *(bổ sung khi tổng hợp)*
**P0 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: UI-02 (phản hồi thao tác); SPEC-01 §14 trạng thái UI

- **Story.** Là người dùng, tôi muốn mỗi hành động ghi (lưu, giao, đánh dấu đã đọc, check-in…) có phản hồi ngắn khi thành công và một thông báo rõ khi lỗi, để không bấm lại nhiều lần hay tưởng việc đã xong.
- **Cơ chế.** Một thành phần thông báo nổi ở `packages/ui`, mount **một lần** ở `ProtectedShell`, và gọi `configureToast` của web-core lúc khởi động (hiện chưa ai gọi, nên `showApiErrorToast` rơi về `console.error`).
  - Loại: success, error, warning, kèm hành động («Mở», «Trả lời», «Thử lại», «Đổi người»).
  - Gộp theo khoá (vd cùng phòng chat); hiển thị tối đa 3; vùng `aria-live` polite (lỗi dùng assertive); với tới được bằng bàn phím; tôn trọng `prefers-reduced-motion`.
  - Mặc định không chứa nội dung nhạy cảm (thân tin chat, mô tả việc).
  - Nếu dùng thư viện thì phải ghim phiên bản và kiểm giấy phép.
- **Luồng.** **Trước:** hành động ghi hỏng thì im lặng (module SOCIAL đo được 12 mutation và 0 `onError`); các story CHAT-NV-05/09/10, GOAL-NV-02/03, TASK-QL-03/91, X-05/06 đều phải tự dựng phản hồi. **Sau:** mọi story dùng chung một API.
- **Tiêu chí chấp nhận.**
  1. Gọi `showApiErrorToast(err)` ở bất kỳ màn nào: hiện thông báo lỗi theo `error-mapper`, không chỉ log ra console.
  2. Hai thông báo cùng khoá trong cửa sổ gộp: chỉ còn một, đếm số lần.
  3. Trình đọc màn hình đọc thông báo; nút hành động với tới được bằng Tab, Esc đóng.
  4. Hơn 3 thông báo: cái cũ nhất tự đóng; không che ô soạn chat trên điện thoại.
  5. Có test đơn vị cho gộp khoá, giới hạn số lượng và `aria-live`.
- **Zone.** FE thuần, nền dùng chung.
- **Dẫn chứng (đã kiểm 23/10).** `routes/social/feed/components/ActionErrorBanner.tsx:5-8` («App KHÔNG có hệ toast»); `packages/web-core/src/lib/error-mapper.ts:191-212` (`configureToast`; chưa có lời gọi trong `apps/app/src`); `routes/attendance/CheckInOutActions.tsx:13,110,125`.

##### US-X-92 · Giờ công ty dùng chung trên web-core: «hôm nay», đầu/cuối ngày, quý, năm *(bổ sung khi kiểm độ phủ)*
**P0 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: ADR-0008 (UTC-at-rest, wall-clock theo múi công ty); SPEC-01 §14; SPEC-06 §13.9; SPEC-10 §8

- **Story.** Là nhân viên hay quản lý, tôi muốn «hôm nay», «quý này» và mốc hạn «17:00» luôn hiểu theo giờ công ty, dù tôi mở app từ máy đặt múi giờ khác, để nhóm «Hôm nay», ngày đầu/cuối quý và hạn chọn nhanh không lệch so với đồng nghiệp và với cờ quá hạn do server tính.
- **Cơ chế.**
  - Đưa `companyTimeZone()` từ `apps/app/src/routes/rooms/room-time.ts:31` lên `packages/web-core`, kèm `partsIn`/`localDateOf`/`wallTimeToInstant`. `room-time.ts` re-export lại để ROOM, SOCIAL stats và kudos không phải sửa.
  - Thêm helper thuần, mọi hàm nhận `now` và `timeZone` làm tham số: `todayLocal`, `startOfLocalDay`/`endOfLocalDay` (trả instant UTC), `deadlineAt(localDate, "17:00")`, `quarterRange`, `yearRange` (trả `YYYY-MM-DD` đầu/cuối), `isSameLocalDay`.
  - Thân `companyTimeZone()` hôm nay vẫn trả `DEFAULT_TIMEZONE` (`packages/web-core/src/i18n/format.ts:10`), vì `/auth/me` chưa trả `company.timezone`. Khi có, chỉ sửa một hàm.
  - `timezone` cá nhân trong `/me/preferences` chỉ dùng để **hiển thị** giờ; mốc nghiệp vụ («hôm nay», «quý này», hạn nhanh) luôn theo giờ công ty.
  - Mọi story dưới đây dẫn chiếu helper này, không tự viết `Asia/Ho_Chi_Minh` hay `new Date(y, m, d)`: TASK-NV-01, TASK-NV-08, TASK-NV-05, GOAL-NV-01, GOAL-NV-04, GOAL-NV-12, GOAL-QL-03, GOAL-QL-04, GOAL-QL-07, X-08, TASK-NV-93.
- **Luồng.** Không thêm thao tác. Ca lỗi chặn được: NV ở máy múi UTC mở «Việc của tôi» lúc 06:30 sáng 23/10 giờ VN (tức 23:30 ngày 22/10 UTC). Không có helper thì việc hạn 23/10 rơi vào «Sắp đến hạn» thay vì «Hôm nay», và «Quý này» của form mục tiêu có thể lấy nhầm quý trong đêm 30/09.
- **Tiêu chí chấp nhận.**
  1. Unit test chạy với `TZ=UTC` và `TZ=America/Los_Angeles`: `todayLocal(2026-10-22T23:30Z, "Asia/Ho_Chi_Minh")` = `2026-10-23`.
  2. `quarterRange(2026-09-30T17:30Z, tz VN)` = `2026-10-01…2026-12-31`; `quarterRange(2026-09-30T16:59Z)` = `2026-07-01…2026-09-30`.
  3. `endOfLocalDay("2026-10-31", tz VN)` = `2026-10-31T16:59:59.999Z`; `deadlineAt("2026-10-24","17:00")` = `2026-10-24T10:00:00Z`.
  4. `timeZone` không phải IANA hợp lệ: helper ném lỗi rõ ràng trong test; `companyTimeZone()` không bao giờ trả chuỗi rỗng.
  5. Spec sẵn có của `room-time`, `stats-range`, `kudos-month` vẫn xanh sau khi chuyển chỗ (không đổi hành vi).
  6. Test tĩnh: không còn chuỗi `"Asia/Ho_Chi_Minh"` trong `apps/app/src/routes/{tasks,goals,me}` ngoài file spec.
- **Zone.** FE thuần, hàm thuần có test; không đổi contract, quyền hay schema.
- **Dẫn chứng (đã kiểm 23/10).** `apps/app/src/routes/rooms/room-time.ts:8-13` («`companies.timezone` KHÔNG có đường ra FE»), `:31-33`; `packages/web-core/src/i18n/format.ts:10`; `routes/social/stats/lib/stats-range.ts:22,76` và `routes/social/kudos/lib/kudos-month.ts:15,26` (đã dùng chung); `routes/goals/goal-form-schema.ts:29` (có `quarter` nhưng không có helper tính ngày); `apps/api/src/tasks/task-core.repository.ts:218-219` (`isOverdue` tính bằng `now()` của server).
- **Ghi chú.** Không đổi `isOverdue`: «Quá hạn» luôn theo server; helper chỉ quyết «Hôm nay/Sắp đến hạn» và các mốc ngày.

##### US-X-05 · Nút «+ Tạo việc» trên topbar và phím tắt tạo việc nhanh chỉ cần tiêu đề
**P0 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-TASK-NV-04, US-TASK-NV-05 (component tạo nhanh + mặc định «Tôi»), US-X-91 · Spec: UI-02 §14.1 (Quick Action bắt buộc MVP); SPEC-06

- **Story.** Là người dùng ở bất kỳ trang nào, tôi muốn bấm «+» hoặc một phím tắt để ghi lại một việc chỉ với tiêu đề, để không mất ý tưởng và không rời trang đang làm.
- **Cơ chế.**
  - Nút «+ Tạo việc» trên `GlobalTopbar`, gate `useCan('create','task')`.
  - Phím tắt **có phím bổ trợ** (vd Alt+N; tránh phím một ký tự để đáp ứng WCAG 2.1.4, không đụng Ctrl+K và CHAT-DEC-027). Bỏ qua khi focus ở ô nhập hoặc vùng `contenteditable`.
  - Mở form gọn (component chung với TASK-NV-05): chỉ có Tiêu đề; người phụ trách mặc định là chính mình; **dự án mặc định trống**, chỉ gợi ý «dự án gần nhất» dạng chip người dùng phải bấm (nhớ ở `localStorage` có try/catch). Link «Thêm chi tiết» mở form đầy đủ.
  - Enter để lưu. Toast «Đã tạo · Mở» mở drawer `?task=`.
- **Luồng.** /goals, drawer chat đang mở. **Trước: 8, 3 chuyển trang** (Ctrl+K → Công việc (Việc của tôi không có nút Tạo) → Danh sách → Tạo → tiêu đề → Lưu → quay lại /goals (2)). **Sau: 3, 0 chuyển trang** (phím tắt → tiêu đề → Enter).
- **Tiêu chí chấp nhận.**
  1. Có `create:task`, ở /goals (không focus ô nhập), nhấn phím tắt: form mở, ô tiêu đề có focus, người phụ trách là tôi, dự án trống.
  2. Tiêu đề rỗng hoặc chỉ khoảng trắng: không gửi, lỗi «Nhập tiêu đề».
  3. Không có `create:task`: không có «+», phím tắt không làm gì.
  4. Focus ở ô soạn chat hoặc ô nhập: phím tắt không mở form và không nuốt ký tự.
  5. Chip «dự án gần nhất» trỏ dự án đã lưu trữ hoặc tôi không còn là thành viên: chip không hiện. Dữ liệu sai thì server từ chối, form giữ nội dung.
  6. Lưu thành công, bấm «Mở» trong toast: drawer chi tiết việc mới mở tại chỗ.
  7. Server lỗi: form giữ tiêu đề và hiện lý do.
- **Zone.** FE dùng endpoint tạo việc sẵn có. Mặc định «Tôi» không nới quyền; giao người khác vẫn qua guard BE.
- **Dẫn chứng.** `layouts/topbar/GlobalTopbar.tsx:121-157` (đường dẫn đã sửa 23/10); `routes/tasks/MyTasksPage.tsx` (không có nút tạo); `TaskListPage.tsx:197,347-349`; `task-form-schema.ts:17-27`.

##### US-X-08 · «Hôm nay» làm được việc ngay: việc đến hạn, tin chưa đọc, mục tiêu cần check-in, chấm công
**P0 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-NV-04, US-X-03, US-X-92 · Spec: SPEC-09 ME-SCREEN-001; UI-06 §9–§10; SPEC-07 §13.3; SPEC-10 GOAL-SCREEN-005 · **Owner chọn MỘT biến thể (§7 Q21); story viết sẵn cả hai, WO chỉ làm biến thể được chọn**

- **Story.** Là nhân viên mở app buổi sáng, tôi muốn một màn duy nhất cho biết hôm nay làm gì (việc quá hạn và đến hạn hôm nay, phòng có tin chưa đọc, mục tiêu cần check-in, trạng thái chấm công) và xử lý được ngay, để khỏi đi qua bốn trang.
- **Phần chung của hai biến thể.**
  - «Quá hạn» lấy theo `isOverdue` server tính (`task-core.repository.ts:218-219`). «Hôm nay» là ngày địa phương theo **giờ công ty** qua helper của US-X-92, không theo múi giờ máy. Việc có `isOverdue=true` luôn ở «Quá hạn», kể cả khi hạn rơi vào hôm nay.
  - Bấm việc thì mở drawer `?task=`. Đổi trạng thái chỉ qua route change-status sẵn có và chờ server xác nhận. Việc đã Done không có nút mở lại ở đây.
  - Mỗi nhóm gate theo quyền riêng; không có quyền thì không gọi API của nhóm đó. Mỗi nhóm báo lỗi riêng. Chỉ dựng ở **một** bề mặt.
- **Biến thể A — khối đầu /me (Q21-A).** Khối «Hôm nay» trên đầu `MeOverviewPage`, gom 4 nhóm: việc (từ `GET /tasks/my`), phòng chưa đọc (danh sách phòng đã cache của chat), mục tiêu «Cần check-in» (`GET /me/goals`), ATT hôm nay. Dòng việc có nút «Xong». Trên `/home` thêm ô «Hôm nay (N)» dẫn tới /me.
- **Biến thể B — nâng dashboard Employee, không dựng khối mới (Q21-B, khuyến nghị).**
  - Hàng của MY_TASKS/TASK_ALERTS bấm được: dùng chung WO với US-X-03, không viết lại.
  - Thêm một **khối FE** «Mục tiêu cần check-in» ngay dưới lưới widget của dashboard Employee. Khối gọi `GET /me/goals` (khuôn của `MeGoalsCard`), gate `access:goal` + `checkin:goal`, bấm «Check-in» mở `GoalCheckinDialog`. **Không thêm mã widget BE** (thêm dòng cấu hình mặc định là seed, tức red, xem Q24).
  - Nhóm «Tin chưa đọc»: không thêm khối, vì badge chat ở topbar đã có trên mọi trang.
  - Tôn trọng `defaultLanding` của `/me/preferences` (cột đã có, `contracts/src/me.ts:300,336`; FE chưa đọc ở đâu). Chỉ nhận giá trị trong allowlist (`/home`, `/dashboard`, `/me`, `/tasks/my-tasks`); giá trị khác thì bỏ qua. Có mục chọn «Trang mở đầu» ở /me.
- **Luồng.** NV vừa đăng nhập, đang ở `/home`; mục đích là nhìn việc hôm nay rồi đóng một việc đã làm xong.
  - **Trước: 5 thao tác + tự dò ngày, 3 chuyển trang.** (1) thẻ «Công việc» → (2) «Việc của tôi» (chỉ chia tab nguồn, ngày là chuỗi: `MyTasksPage.tsx:21,35-36`) → (3) dò ngày bằng mắt, bấm tiêu đề, trang `/tasks/:id` mở (`MyTasksPage.tsx:73-75`) → (4) badge trạng thái → (5) «Hoàn thành». Muốn check-in thêm một mục tiêu thì phải qua avatar → /me → Check-in → nhập → Gửi (+5, +1 chuyển trang).
  - **Sau — A: 2 thao tác, 1 chuyển trang.** (1) ô «Hôm nay» trên /home → (2) «Xong» trên dòng việc. Check-in mục tiêu trong cùng khối: «Check-in» → sửa số → Ctrl+Enter (+3, 0 chuyển trang).
  - **Sau — B: 4 thao tác, 1 chuyển trang.** (1) thẻ «Dashboard» trên /home → (2) bấm hàng việc trong TASK_ALERTS/MY_TASKS, drawer mở → (3) badge trạng thái → (4) «Hoàn thành». Nếu `defaultLanding=/dashboard` thì bỏ bước (1): **3 thao tác, 0 chuyển trang**. Check-in qua khối «Mục tiêu cần check-in»: +3, 0 chuyển trang.
- **Tiêu chí chấp nhận (chung).**
  1. Hôm nay là 23/10 theo giờ công ty, máy người dùng đặt UTC. Có 2 việc `isOverdue=true` và 3 việc hạn 23/10 chưa tới giờ: đúng 2 ở «Quá hạn», 3 ở «Hôm nay», sắp theo hạn.
  2. Việc In Progress được phép sang Done: thao tác hoàn thành ở trạng thái chờ; server xác nhận thì việc rời nhóm; server từ chối (403, checklist bắt buộc) thì việc ở lại kèm lý do.
  3. Không có `access:goal`: không có nhóm/khối mục tiêu, không gọi `/me/goals`. Không có quyền chat: biến thể A không có nhóm «Tin chưa đọc».
  4. Một nguồn lỗi: nhóm hoặc khối đó báo lỗi riêng kèm «Thử lại», phần khác vẫn hiển thị.
  5. Không còn gì: «Hôm nay bạn đã xong hết».
- **Tiêu chí riêng.**
  - A6. Bấm «Xong» trên dòng của khối /me: không chuyển trang; dòng biến mất sau khi server xác nhận.
  - B6. `defaultLanding=/dashboard`: sau đăng nhập vào thẳng /dashboard. `defaultLanding=/evil` hoặc URL tuyệt đối: bỏ qua, vào `/home`, không điều hướng ra ngoài origin.
  - B7. Dashboard Employee hiện khối «Mục tiêu cần check-in» với tối đa 5 mục và «Xem tất cả» → `/goals?mine=1`. Mục Nháp có check-in khoá kèm lý do (hook của GOAL-NV-02).
- **Zone.** FE gom nhiều module, đổi trạng thái việc qua endpoint sẵn có; không đổi quyền, schema hay FSM. Biến thể A đổi IA của UI-06 nên owner chốt. Biến thể B chỉ dùng cột `defaultLanding` sẵn có, không thêm seed widget.
- **Dẫn chứng.** `layouts/home/HomePortalLayout.tsx:9-11,141-150`; `routes/me/MeOverviewPage.tsx:72-145`; `MeGoalsCard.tsx:99-110`; `apps/api/src/dashboard/dashboard-default-config.const.ts:33-36` (Employee: ATTENDANCE_TODAY, MY_TASKS, TASK_ALERTS, NOTIFICATIONS, LEAVE_BALANCE; không có GOAL), `:55-60` (GOAL_PROGRESS không mặc định cho Employee); `components/dashboard/MyTasksWidget.tsx:58`; `contracts/src/task.ts:606-607`; `contracts/src/me.ts:300,336` (`defaultLanding`); `router.tsx:42-50` (`/home`).
- **Ghi chú.** Không trùng TASK-NV-01: story đó là trang đầy đủ, còn đây là tóm tắt cá nhân dùng chung query. Nếu owner chọn **B**: WO = US-X-03 + US-X-08 (B), đi ở Đợt 1A ngay sau US-TASK-NV-04. Nếu chọn **A**: WO riêng ở Đợt 1A, US-X-03 vẫn đi cùng đợt.

##### US-X-93 · Luồng hằng ngày trên điện thoại (375px) cho Công việc và Mục tiêu *(bổ sung khi kiểm độ phủ)*
**P1 · M · 🟢 green** · Lớp FE · Phụ thuộc: US-TASK-NV-03, US-TASK-NV-04, US-GOAL-NV-91, US-X-91 · Spec: UI-02 (responsive); SPEC-06 §13.9; SPEC-10 GOAL-SCREEN-001

- **Story.** Là nhân viên dùng web trên điện thoại khi đi lại, tôi muốn xem «Việc của tôi», danh sách việc, trang Quá hạn và /goals mà không phải cuộn ngang, mở việc toàn màn rồi Back là về chỗ cũ, đổi trạng thái hay check-in trong 2–3 chạm và không bị bàn phím ảo hay toast che nút, để cập nhật ngay khi đang ở ngoài.
- **Cơ chế.**
  - `DataTable` (`packages/ui`) thêm prop additive `mobileRow` (render thẻ dọc dưới breakpoint `md`); không truyền thì giữ bảng như cũ. Áp cho `TaskListPage`, `OverdueTasksPage`, `GoalListPage`. Thẻ việc gồm tiêu đề, badge trạng thái bấm được (NV-03), hạn tương đối và người phụ trách. Thẻ mục tiêu gồm tên, % và biểu tượng Check-in (GOAL-NV-91).
  - Drawer việc: `Sheet` đã `w-full` nên trên điện thoại là toàn màn. Chỉ cần bảo đảm `?task=` (NV-04) để nút Back của trình duyệt/hệ điều hành đóng drawer, và nút đóng có vùng chạm tối thiểu 44×44px.
  - Hộp thoại (`GoalCheckinDialog`, chọn hạn, xác nhận): dưới `md` neo lên trên và dùng `max-h-[90dvh]` thay `90vh`, để bàn phím ảo không che nút Gửi.
  - Nút tạo nhanh (X-05) vẫn hiện trên topbar ở bề rộng điện thoại (phần chữ được ẩn, icon vẫn giữ). Toast (X-91) nằm phía trên vùng an toàn dưới đáy và không che ô soạn hay nút chính của hộp thoại.
  - Không tạo trang riêng cho điện thoại, không thêm route mới.
- **Luồng.**
  - (a) Đổi trạng thái một việc, xuất phát /tasks/my-tasks trên điện thoại 375px. **Trước: 4 thao tác, 2 chuyển trang** (1. tiêu đề, sang `/tasks/:id` → 2. badge → 3. chọn trạng thái → 4. Quay lại, về `/tasks` chứ không về Việc của tôi, `router.tsx:1574`). **Sau: 2, 0 chuyển trang** (badge trên thẻ → chọn).
  - (b) Check-in mục tiêu, xuất phát /goals trên điện thoại. **Trước: 5 thao tác, 2 chuyển trang**, chưa kể phải cuộn ngang bảng 5 cột để thấy % và cuộn để thấy nút Gửi bị bàn phím ảo che (1. bấm dòng → 2. Check-in → 3. nhập → 4. Gửi → 5. Quay lại). **Sau: 3, 0 chuyển trang, không cuộn** (biểu tượng Check-in trên thẻ → sửa số → Gửi).
- **Tiêu chí chấp nhận** (đo trong trình duyệt thật ở khung 375×812 bằng API giả lập, ghi số đo vào plan/PR).
  1. /tasks, /tasks/overdue, /tasks/my-tasks, /goals ở 375px: `document.scrollingElement.scrollWidth ≤ clientWidth` (không cuộn ngang trang) và mỗi việc/mục tiêu là một thẻ đọc được.
  2. Bấm thẻ việc: drawer toàn màn; Back của trình duyệt đóng drawer, URL bỏ `?task=`, vị trí cuộn danh sách giữ nguyên.
  3. Đổi trạng thái trên thẻ trong 2 chạm; server từ chối thì rollback kèm lý do (cùng hành vi NV-03).
  4. Hộp check-in mở, bàn phím ảo hiện (mô phỏng giảm `visualViewport.height` còn 400px): ô số và nút Gửi vẫn thấy được, không cần cuộn.
  5. Toast thành công hiện khi hộp check-in vừa đóng: không che badge trạng thái hay nút «+» tạo nhanh.
  6. Từ `md` trở lên giao diện bảng không đổi (spec snapshot cột hiện có vẫn xanh).
  7. Không có quyền đổi trạng thái hay check-in: thẻ chỉ đọc, không có nút (cùng gate của NV-03/GOAL-NV-91).
- **Zone.** FE trình bày; dùng route và gate sẵn có.
- **Dẫn chứng (đã kiểm 23/10).** `packages/ui/src/components/ui/data-table.tsx:163-165` (bảng bọc `overflow-x-auto`, không có chế độ thẻ); `GoalListPage.tsx:194` và 5 cột ở `:128-161`; `routes/tasks/task-columns.tsx:20-56` (6 cột); `packages/ui/src/components/ui/sheet.tsx:213` (`w-full max-w-2xl`); `routes/tasks/TaskDetailDrawer.tsx:57`; `packages/ui/src/components/ui/dialog.tsx:109,116` (`items-center`, `max-h-[90vh]`); `layouts/topbar/GlobalTopbar.tsx:94-115` (phần tử `hidden … sm:flex`); `MyTasksPage.tsx:26`.
- **Ghi chú.** CHAT đã responsive từ S17-CHAT-UX2, story này không đụng `components/chat/**`. Board kéo-thả trên điện thoại do TASK-NV-91 lo.

##### US-X-03 · Hàng việc và đơn nghỉ trong widget dashboard bấm được
**P1 · S · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-NV-04 · Spec: SPEC-07 §14.2 «Xem chi tiết task»; SPEC-05

- **Story.** Là quản lý (và nhân viên) xem dashboard buổi sáng, tôi muốn bấm thẳng vào một việc trễ hạn hay một đơn nghỉ chờ duyệt trong widget, để xử lý ngay.
- **Cơ chế.** Mỗi `<li>` của `MyTasksWidget` và `TaskAlertsWidget` thành nút mở drawer `?task=<id>` (nhận phần «dòng widget bấm được» của TASK-NV-09). `PendingLeaveWidget`: thêm search param `?request=<id>` cho `/leave/approvals` để `LeaveApprovalPage` mở sẵn `ApprovalDetailDialog` của đúng đơn (lấy qua endpoint chi tiết trong phạm vi duyệt). Duyệt/Từ chối vẫn qua nút và xác nhận của dialog. Theo mẫu `GoalProgressWidget.tsx:70-74`, có focus bàn phím và `aria-label`.
- **Luồng.** /dashboard (Manager). **Trước: 3 + tìm bằng mắt, 3 chuyển trang** (quick action (filter bị bỏ qua) → sidebar «Task quá hạn» → tìm và bấm việc). **Sau:** việc 1 thao tác, 0 chuyển trang; đơn nghỉ 1 thao tác, 1 chuyển trang.
- **Tiêu chí chấp nhận.**
  1. Bấm hàng T trong TASK_ALERTS: drawer chi tiết T mở trên /dashboard.
  2. Có `approve:leave`, bấm hàng L trong PENDING_LEAVE: tới `/leave/approvals?request=L` với dialog L mở sẵn; duyệt vẫn cần bấm và xác nhận.
  3. `?request=L` ngoài phạm vi duyệt hoặc đã xử lý: «Không tìm thấy đơn hoặc đơn đã được xử lý», danh sách vẫn hiện, không lộ thông tin đơn.
  4. Không có `approve:leave`: không thấy widget PENDING_LEAVE.
  5. Widget rỗng: trạng thái rỗng, không có hàng giả.
  6. Tab tới hàng rồi Enter: giống bấm chuột.
- **Zone.** Phần LEAVE thêm deep-link vào dialog duyệt sẵn có: chạm UI luồng phê duyệt, không đổi FSM, quyền hay schema.
- **Dẫn chứng.** `components/dashboard/MyTasksWidget.tsx:57-70`; `TaskAlertsWidget.tsx:65-77`; `PendingLeaveWidget.tsx:54`; `GoalProgressWidget.tsx:70-74`; `routes/leave/LeaveApprovalPage.tsx:358,523-529`; `router.tsx:1205,1260`.
- **Ghi chú.** Cùng `components/dashboard/**` với `S4-DASH-WIDGETCARD-VARIANT-1` (todo); xếp thứ tự hoặc gộp khi gieo WO.

##### US-X-04 · Quick action và lối tắt dashboard / me dẫn đúng chỗ; Check-in/Check-out ngay trên widget
*Gộp từ: US-TASK-NV-09.* · **P1 · S · 🟡 yellow** · Lớp BE, FE · Phụ thuộc: US-TASK-NV-01 (`?group=`), US-TASK-NV-04, US-TASK-NV-05 (`?create=1`) · Spec: SPEC-07 §20; FRONTEND-11 §7.2; UI-08 §24 QuickActionVM

- **Story.** Là người dùng dashboard và /me, tôi muốn các nút nhanh và con số («3 quá hạn») dẫn đúng nơi, và chấm công ngay trên widget, để không bấm vào trang lỗi.
- **Cơ chế.**
  - Sửa hằng BE quick action:
    - `/tasks/new` → `/tasks/my-tasks?create=1` (focus ô tạo nhanh);
    - `/tasks/my` → `/tasks/my-tasks`;
    - `/projects` → `/tasks/projects` (`projectScoped` → `/tasks/projects/:id`);
    - `/tasks?filter=due-soon` → `/tasks/my-tasks?group=dueSoon`; TASK_ALERTS dùng `/tasks/overdue`.
  - Badge Hôm nay / Quá hạn ở `MeSectionContents` thành link `/tasks/my-tasks?source=assigned&group=today|overdue`, khớp đúng định nghĩa đếm của `MeTaskSummary`. Số 0 thì không bấm được.
  - `WidgetCard`: với `API_CALL` có `actionCode` CHECK_IN/CHECK_OUT thì render lại `CheckInOutActions`/`useCheckIn` sẵn có (không gọi `apiEndpoint` từ server một cách tổng quát). Đổi trạng thái widget chỉ **sau khi server xác nhận**, rồi invalidate ATT today và widget.
  - Test tĩnh: mọi `targetUrl` trong hằng phải khớp một route khai báo trong `router.tsx`.
- **Luồng.** /dashboard. **Trước:** «Tạo task» rơi vào `/tasks/$taskId` với `taskId='new'`, phải đi vòng 4 thao tác; check-in phải sang /attendance/today (2 thao tác, 1 chuyển trang). **Sau: 1** mỗi lối tắt.
- **Tiêu chí chấp nhận.**
  1. «Tạo task» trên MY_TASKS: sang `/tasks/my-tasks` và ô tạo nhanh có focus, không ra «không tìm thấy việc».
  2. «Mở dự án» trên PROJECT_PROGRESS: tới đúng `/tasks/projects(/:id)`, không 404.
  3. Badge Quá hạn = 3 ở /me/tasks: danh sách mở đúng nhóm/nguồn với đúng 3 việc.
  4. Chưa check-in, có `check-in:attendance`: bấm thì nút ở trạng thái xử lý; server thành công thì «Đã check-in hh:mm» và nút thành Check-out.
  5. Server từ chối (kỳ công khoá, đơn nghỉ cả ngày…): hiện đúng lý do, widget giữ trạng thái cũ.
  6. Thiếu quyền của quick action: nút không hiện, không có link chết.
  7. Thêm một `targetUrl` không khớp route: test đỏ.
- **Zone.** Sửa hằng dữ liệu BE + gọi luồng chấm công sẵn có; không đổi quyền, schema hay FSM.
- **Dẫn chứng.** `apps/api/src/dashboard/dashboard-widget-quick-actions.const.ts:39-57,65,74,85,107,118`; `components/dashboard/WidgetCard.tsx:78-80`; `router.tsx:1460,1468,1483,1566`; `routes/me/components/MeSectionContents.tsx:77-81`; `routes/attendance/CheckInOutActions.tsx:79-103,157-166`; `contracts/src/dashboard-widget-data.ts:61`.

##### US-X-06 · Thông báo đến tức thì qua realtime, kèm toast bấm được
**P1 · S · 🟡 yellow** · Lớp FE, WS · Phụ thuộc: US-X-91 · Spec: SPEC-08 (realtime)

- **Story.** Là người dùng, tôi muốn biết ngay khi được giao việc hay được nhắc tên, thay vì đợi tới 30 giây hay tải lại trang.
- **Cơ chế.** Hook riêng `useNotificationRealtime`, mount một lần ở `ProtectedShell`, gate `read:notification`. **Không** đặt trong `useChatRealtime`, vì hook đó chỉ chạy khi có `view:chat-room`. Dùng chung socket singleton `/ws`, chỉ gắn/gỡ handler của mình, không ngắt socket. Nhận `notification:new` thì invalidate unread-count và danh sách dropdown, hiện toast có «Mở» (qua `NotificationTargetLink`). Polling giữ làm dự phòng: 120 giây khi socket nối, 30 giây khi mất. Không toast thông báo chat của phòng đang mở. Toast tắt được trong tuỳ chọn cá nhân.
  - **Nơi lưu tuỳ chọn «Hiện toast thông báo».** `localStorage` theo khoá gắn `userId` (vd `mediaos:noti-toast:<userId>`), đọc/ghi bọc try/catch, mặc định **bật** khi không đọc được. Đây chỉ là tuỳ chọn hiển thị: tắt toast không làm mất thông báo (chuông và trang Thông báo vẫn nhận). Muốn **không nhận** một loại thông báo thì dùng trang sẵn có `/me/preferences/notifications` (bật/tắt In-app theo loại, lưu server qua `PUT /notifications/preferences`). Không thêm cột vào `user_preferences`: bảng có cột cố định, thêm khoá mới là migration (red).
  - Công tắc nằm ở `/me/preferences/notifications`, ngay trên bảng loại × kênh, ghi rõ «chỉ áp dụng trên trình duyệt này».
- **Luồng.** Bất kỳ trang nào. **Trước: 3** (F5 → chuông → dòng). **Sau: 1** (toast hiện trong khoảng 2 giây → «Mở»).
- **Tiêu chí chấp nhận.**
  1. NV có `read:notification` nhưng KHÔNG có quyền chat, socket nối, QL giao việc: trong khoảng 2 giây chuông tăng và có toast «Bạn được giao: <tiêu đề>».
  2. Đang mở đúng phòng R, có `CHAT_MENTIONED` của R: không toast, chỉ cập nhật số.
  3. Socket ngắt: badge vẫn cập nhật nhờ polling 30 giây, không lặp lỗi console.
  4. Phiên hết hạn hoặc tài khoản bị khoá: không còn nhận toast, chuyển về luồng đăng nhập.
  5. `target_url` không an toàn hoặc rỗng: toast không có «Mở».
  6. Unmount hoặc đăng xuất: handler `notification:new` đã gỡ, socket chat không bị ngắt.
  7. Tắt «Hiện toast thông báo» rồi được giao việc: không có toast, chuông vẫn tăng. Trình duyệt chặn `localStorage` (chế độ riêng tư): toast vẫn hiện (mặc định bật), không lỗi console. Người dùng khác đăng nhập trên cùng máy không thừa hưởng tuỳ chọn này.
- **Zone.** Luồng NOTI/realtime ở FE; payload BE đã đi qua DTO. Tuỳ chọn toast chỉ ở trình duyệt, không đổi schema.
- **Dẫn chứng.** `apps/app/src/routes/me/MeNotificationPreferencesPage.tsx:5-8,151-168` (tuỳ chọn server chỉ theo loại × kênh); `packages/contracts/src/me.ts:265-341` (`user_preferences` cột cố định); `components/chat/room-list-sections.ts:109-132` (khuôn `localStorage` bọc try/catch); `contracts/src/realtime.ts:65,310`; `apps/api/src/realtime/realtime-emitter.service.ts:86-90`; `components/notifications/NotificationBadge.tsx:11,33`; `hooks/use-chat-realtime.ts:55,81,237-246`.

##### US-X-07 · Ctrl+K tìm được cả việc, dự án và đồng nghiệp, không chỉ tên ứng dụng
**P1 · M · 🟠 amber** · Lớp FE · Phụ thuộc: US-TASK-NV-04 · Spec: UI-02 §14.1, §18.1–18.3; UI-06 §4.2

- **Story.** Là người dùng, tôi muốn gõ vài chữ vào Ctrl+K để ra ngay việc, dự án hay đồng nghiệp cần tìm, khỏi nhớ mỗi loại nằm ở module nào.
- **Cơ chế.** `AppSwitcher` thành bảng lệnh:
  - debounce 250ms, gọi song song endpoint tìm kiếm sẵn có (task `search`, project `search`, HR employees `q`);
  - mỗi nhóm chỉ gọi và chỉ hiện khi `useCan` cho phép đọc;
  - tối đa 5 kết quả mỗi nhóm, điều hướng bằng mũi tên + Enter.
  
  Việc mở drawer `?task=`, người mở hồ sơ. Nhóm «Đồng nghiệp» chỉ hiện tên, ảnh, phòng ban. Không lưu truy vấn hay kết quả vào storage. Dưới 2 ký tự thì chỉ lọc tên ứng dụng. Khi CHAT-NV-03 có danh bạ nhẹ thì nhóm «Đồng nghiệp» dùng nguồn đó cho người không có quyền HR. Tìm tin chat ngoài phạm vi (đã có Ctrl+Shift+F).
- **Luồng.** Bất kỳ trang nào. **Trước: 6, 3 chuyển trang** (Ctrl+K chỉ khớp tên app → Công việc → Danh sách → ô tìm → kết quả). **Sau: 3, 0 chuyển trang** (Ctrl+K → gõ → Enter).
- **Tiêu chí chấp nhận.**
  1. Gõ «báo giá»: nhóm Ứng dụng, Việc, Dự án (mỗi nhóm tối đa 5), chỉ mục người dùng được xem theo data-scope server.
  2. Không có quyền đọc hồ sơ nhân viên: không có nhóm «Đồng nghiệp», không có request tới HR.
  3. Một endpoint lỗi hoặc timeout: nhóm đó hiện «Không tải được», các nhóm khác vẫn hiển thị.
  4. Không có kết quả: «Không tìm thấy “…”» kèm gợi ý trang tìm của module.
  5. Dưới 2 ký tự: không gọi API nào.
  6. Nhóm «Đồng nghiệp» chỉ có tên/ảnh/phòng ban dù endpoint trả thêm; không có «tìm gần đây» lưu bền.
- **Zone.** FE gom dữ liệu nhiều module, trong đó có HR; phải giữ đúng gate và dựa vào che dữ liệu ở server.
- **Dẫn chứng.** `layouts/AppSwitcher.tsx:57-60,165-175,232-240`; `contracts/src/task.ts:509,604`.
- **Ghi chú.** Xác định cách xử lý Ctrl+K khi focus ở ô soạn chat, để không chặn CHAT-DEC-027.

##### US-X-09 · Dashboard hiện đủ widget đã seed (Số dư phép, Lịch nghỉ, Cảnh báo chấm công); widget thiếu component bị test chặn
**P1 · M · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-07 DASH-WIDGET-009/010, §13.3 · **Owner xác nhận cách hiển thị loại nghỉ (§7 Q23)**

- **Story.** Là trưởng phòng, tôi muốn dashboard mặc định hiện lịch nghỉ và cảnh báo chấm công của đội. Là nhân viên, tôi muốn thấy số dư phép của mình. Mục đích là khỏi mở hai module khác.
- **Cơ chế.** Viết 3 component theo khuôn widget sẵn có (schema Zod + `WidgetCard`) và đăng ký vào `WIDGET_COMPONENTS`: `LeaveBalanceWidget` (Employee), `LeaveCalendarWidget` và `AttendanceAlertsWidget` (Manager). Mã widget chưa có component: chỉ log cảnh báo ở môi trường dev, **không** hiện thẻ rác cho người dùng. Unit test: mọi `widgetCode` trong cấu hình mặc định phải có component hoặc nằm trong allowlist DEFERRED kèm id WO. Hàng cảnh báo chấm công bấm được tới bản ghi trong phạm vi quyền.
- **Luồng.** /dashboard (Manager). **Trước: ~4, 2 chuyển trang** (sang LEAVE xem lịch, sang ATT xem cảnh báo). **Sau: 0**, đọc ngay trên dashboard.
- **Tiêu chí chấp nhận.**
  1. NV có `view-own:leave-balance`: thấy Số dư phép đúng số server trả.
  2. QL có `view-team:leave-calendar`: Lịch nghỉ hiện người nghỉ trong cửa sổ server trả, chỉ các trường server trả (tên, khoảng ngày, loại), FE không gọi thêm endpoint chi tiết đơn; `reason` không bao giờ có trong payload.
  3. Không có quyền dữ liệu đội: không thấy hai widget đội, không lỗi console.
  4. ATT lỗi, widget trả Degraded: widget báo lỗi riêng, widget khác vẫn hiển thị.
  5. Không có cảnh báo: «Không có cảnh báo hôm nay».
  6. Thêm mã vào cấu hình mặc định mà không có component và không trong allowlist: test đỏ.
- **Zone.** FE cho widget BE đã có handler, seed và gate.
- **Dẫn chứng.** `apps/api/src/dashboard/dashboard-default-config.const.ts:44-54`; `components/dashboard/DashboardWidgetGrid.tsx:51-66,75-77`; `dashboard-widget-handlers.service.ts:192,204-209`.
- **Ghi chú.** USER_SUMMARY, MODULE_STATUS, SYSTEM_LOGS, CONTRACT_EXPIRING để WO sau. EMPLOYEE_SUMMARY/NEW_EMPLOYEES dính `S4-DASH-SIBLINGFLOOR-1`, không đụng. Đo độ tươi số liệu (MV refresh) trước khi nghiệm thu.

##### US-X-12 · Nút «Nhắn tin» cạnh người phụ trách việc và thành viên dự án
**P1 · M · 🟠 amber** · Lớp BE, FE · Phụ thuộc: US-CHAT-NV-01 (khi đang ở /chat), dùng lại hành vi của US-CHAT-NV-02 · Spec: SPEC-15 §7

- **Story.** Là người cần hỏi nhanh người phụ trách một việc hay một thành viên dự án, tôi muốn bấm «Nhắn tin» ngay cạnh tên họ để mở cuộc trò chuyện riêng trong drawer.
- **Cơ chế.** BE thêm trường chỉ-đọc `assigneeUserId` vào `taskCoreResponseSchema` và `userId` vào `memberResponseSchema` (join `employee_profiles → users`; null khi chưa có tài khoản hoặc tài khoản không active), `.optional()` additive, không đổi DB, cùng data-scope với DTO hiện tại. FE thêm icon «Nhắn tin» cạnh người phụ trách trong chi tiết việc và trong danh sách thành viên dự án, gọi `openDirect({peerUserId})` (DM cũ nếu có) rồi `openRoom`. Gate `access:chat`; ẩn với chính mình; `userId` null thì nút vô hiệu.
- **Luồng.** Drawer chi tiết việc. **Trước: ~9, 1 chuyển trang** (badge → mở toàn trang → Tạo phòng → Chọn người → gõ → chọn → xác nhận → gõ → gửi; người chọn đi qua danh bạ HR). **Sau: 3, 0 chuyển trang** («Nhắn tin» → gõ → Enter).
- **Tiêu chí chấp nhận.**
  1. Có `access:chat`, việc T có người phụ trách U ≠ tôi, U có tài khoản active: drawer chat mở DM với U, không tạo trùng.
  2. Tôi là người phụ trách: không có nút cạnh tên mình.
  3. Không có `access:chat`: không có nút.
  4. `assigneeUserId` null: nút vô hiệu, tooltip «Người này chưa có tài khoản».
  5. `openDirect` bị từ chối: báo lý do server trả, không mở drawer rỗng.
  6. Không có quyền đọc việc T: response không chứa `assigneeUserId`.
- **Zone.** Mở rộng DTO TASK thêm định danh người dùng theo data-scope sẵn có; cần review che dữ liệu.
- **Dẫn chứng.** `contracts/src/task.ts:536-547,699-710`; `contracts/src/chat.ts:502-505`; `apps/api/src/chat/chat-rooms.service.ts:275-291`; `components/chat/drawer/ChatDrawerBody.tsx:106-116`; `EmployeeMultiPickerDialog.tsx:104`.
- **Ghi chú.** Mở rộng sang hồ sơ nhân viên HR để WO sau.

##### US-X-11 · Link nội bộ trong tin nhắn mở ngay trong ứng dụng thay vì tab mới
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: US-TASK-NV-04 · Spec: SPEC-15

- **Story.** Là người nhận link việc hay mục tiêu trong chat, tôi muốn bấm vào là xem ngay trong ứng dụng đang mở, không chờ tab mới tải lại toàn bộ và không mất drawer chat.
- **Cơ chế.** Trong `MessageBody`, parse link bằng `new URL(href)`. Chỉ coi là nội bộ khi origin trùng `location.origin` **và** pathname khớp allowlist tiền tố route (`/tasks/<uuid>`, `/goals/<uuid>`, `/chat/<uuid>`, `/notifications`…). Link nội bộ điều hướng bằng router; `/tasks/<uuid>` mở drawer `?task=` tại chỗ. Link còn lại giữ `target=_blank rel="noopener noreferrer nofollow"`. Ctrl/⌘+click hoặc chuột giữa vẫn mở tab mới.
- **Luồng.** Drawer chat mở. **Trước: 3, 1 chuyển trang** (bấm link → tab mới tải lại app → đóng tab quay lại). **Sau: 1, 0 chuyển trang**.
- **Tiêu chí chấp nhận.**
  1. Link `https://<cùng origin>/tasks/T`: drawer việc T mở tại chỗ, phòng chat giữ nguyên.
  2. Link ngoài: tab mới với `rel=noopener` như hiện tại.
  3. Khác origin, có `\` trong đường dẫn, hoặc ngoài allowlist: không coi là nội bộ.
  4. Không có quyền xem T: drawer báo «Không mở được việc này», không lộ tiêu đề.
  5. Ctrl/⌘+click: trình duyệt mở tab mới.
- **Zone.** FE hiển thị link.
- **Dẫn chứng.** `components/chat/MessageBubble.tsx:91-97`; `chat-format.ts:165`; `components/notifications/NotificationTargetLink.tsx:16-19`.
- **Ghi chú.** Thẻ xem trước việc trong bong bóng để story sau (cần gọi API theo quyền của từng người xem).

##### US-X-13 · Trang Thông báo: bấm dòng đi thẳng tới đích và lọc theo module
**P2 · S · 🟢 green** · Lớp FE · Phụ thuộc: — · Spec: SPEC-08 NOTI-API-001/002/003

- **Story.** Là người nhận nhiều thông báo, tôi muốn trang Thông báo cho bấm thẳng tới việc/phòng/mục tiêu và lọc theo nguồn (Công việc, Tin nhắn, Mục tiêu, Nghỉ phép), để dọn hộp thư nhanh.
- **Cơ chế.** Bấm dòng thì đánh dấu đã đọc và đi tới `target_url` qua `NotificationTargetLink` (giống dropdown); giữ nút «Chi tiết» phụ. Thêm chip lọc `source_module` và `priority` (contract đã hỗ trợ), lưu trên URL. «Đánh dấu đã đọc tất cả trong bộ lọc này» nếu endpoint mark-read hỗ trợ; không thì chỉ trong trang hiện tại.
- **Luồng.** /notifications. **Trước: 3, 2 chuyển trang** (dòng → trang chi tiết → bấm tới đích; lọc theo nguồn phải đọc bằng mắt). **Sau: 1**, 0 chuyển trang khi đích là drawer.
- **Tiêu chí chấp nhận.**
  1. Bấm dòng TASK_ASSIGNED: thông báo được đánh dấu đã đọc, drawer việc mở (hoặc tới trang đích), không qua trang chi tiết.
  2. Chip «Tin nhắn»: chỉ `source_module = CHAT`; URL có tham số, tải lại vẫn giữ.
  3. Lọc không có kết quả: «Không có thông báo nào trong mục này» + bỏ lọc.
  4. `target_url` không an toàn hoặc rỗng: mở trang chi tiết thông báo như cũ.
  5. mark-read lỗi: vẫn điều hướng, trạng thái chưa đọc được giữ.
- **Zone.** FE list/filter dùng tham số contract sẵn có.
- **Dẫn chứng.** `routes/notifications/NotificationListPage.tsx:34,82,103-172`; `contracts/src/my-notification.ts:40-58`; `NotificationTargetLink.tsx:31-57`.

##### US-X-14 · Hộp «Chờ tôi xử lý» cho quản lý: đơn nghỉ chờ duyệt và việc chờ review
**P2 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-TASK-NV-04, US-X-03 (`?request=`), nên có US-TASK-QL-08 (tham số «tôi giao») · Spec: SPEC-07 §13.3; SPEC-05; SPEC-06 · **Owner chọn vị trí (§7 Q22)**

- **Story.** Là quản lý, tôi muốn một chỗ cho biết những gì đang chờ tôi (đơn nghỉ chờ duyệt, việc In Review trong dự án tôi quản), mỗi mục một chạm tới đúng màn xử lý, để không bỏ sót và không ai phải hỏi «anh duyệt chưa?».
- **Cơ chế.** Khối FE trên dashboard Manager, ngay dưới PENDING_LEAVE:
  - (1) đơn nghỉ Pending trong phạm vi duyệt (endpoint danh sách duyệt sẵn có), mỗi mục mở `/leave/approvals?request=<id>`;
  - (2) việc In Review trong dự án tôi là Owner/Manager: lấy danh sách dự án, lọc theo vai trò, gọi list theo `projectId` cho **tối đa 5 dự án** (hằng số), gộp và lấy 5 mục đầu; mục mở drawer `?task=`. Khi có tham số «tôi giao» của TASK-QL-08 thì thêm nhóm «Việc tôi giao đang chờ duyệt».
  
  Không có nút duyệt hàng loạt hay duyệt tắt. Không thêm mã widget BE (cần seed tức migration, red).
- **Luồng.** /dashboard. **Trước: ~7, 3 chuyển trang** (quick action sang danh sách duyệt rồi chọn đơn; việc chờ review: Ctrl+K → Công việc → Danh sách → lọc trạng thái). **Sau: 2, 0–1 chuyển trang** (bấm mục → hành động trên màn của module).
- **Tiêu chí chấp nhận.**
  1. Có `approve:leave`, 3 đơn Pending trong phạm vi: «Đơn nghỉ chờ duyệt (3)»; bấm một đơn thì tới dialog đúng đơn đó.
  2. QL là Manager của 2 dự án có việc In Review: thấy các việc đó, bấm mở drawer tại chỗ.
  3. Không có `approve:leave` và không quản dự án nào: khối không hiện, không gọi API các nhóm đó.
  4. Số đếm chỉ gồm đơn server trả theo data-scope.
  5. Một nhóm lỗi: nhóm đó báo lỗi riêng, nhóm còn lại vẫn hiển thị.
  6. Không còn gì chờ: «Không có gì chờ bạn».
  7. Duyệt hay từ chối vẫn cần thao tác và xác nhận trên màn LEAVE; khối không tự duyệt.
- **Zone.** Gom lối vào luồng phê duyệt; không đổi FSM, không thêm cặp quyền hay schema.
- **Dẫn chứng.** `components/dashboard/PendingLeaveWidget.tsx:54`; `dashboard-widget-quick-actions.const.ts:107`; `contracts/src/task.ts:573`; `migrations/0497…sql:74`.

---

### 5.5 Liên kết tự động Việc ↔ Mục tiêu *(bổ sung 23/10 theo câu hỏi owner)*

Owner hỏi «có cách nào liên kết tự động giữa công việc và mục tiêu không», rồi chốt **làm hướng 1 (kế thừa/điền sẵn khi tạo) và hướng 2 (gợi ý một chạm) trước** (chat 23/10/2026). Mục này do một lượt khảo sát → thiết kế → phản biện đối chiếu mã viết ra.

**Trả lời ngắn.** Trả lời owner: có. Hệ thống đã có sẵn hai cách liên kết tự động. Thứ nhất là mode «Theo dự án»: mọi việc của dự án tự được tính, không gắn tay. Thứ hai là «Phân rã từ mẫu»: việc sinh ra đã mang sẵn mục tiêu. Phần còn thiếu chỉ là bề mặt FE. Thứ tự đề xuất: 1. Làm ngay US-GOAL-QL-93 (green, nhỏ nhất): mục tiêu cấp dự án mặc định đo «Theo dự án», kèm cảnh báo rõ «đếm toàn dự án, không theo kỳ». Cần owner trả lời Q31. 2. US-GOAL-NV-92, xếp ngay sau NV-08 vì dùng chung helper hai lời gọi: form Tạo việc chọn sẵn mục tiêu, chỉ khi đó là mục tiêu cá nhân của chính người tạo; các trường hợp khác là chip hoặc toast một chạm. 3. US-X-94 và US-GOAL-QL-94. Hai story này phải dùng khuôn «DELETE ở mục tiêu cũ rồi mới POST». Lý do và WO vùng đỏ đi kèm: xem «Phụ thuộc chung» bên dưới. WO này nên merge trước, hoặc ít nhất cùng lúc với QL-94. Những việc KHÔNG nên làm: - Server tự gắn: thêm goalId vào POST /tasks, việc con kế thừa ở server, hay quy tắc theo nhãn. Đi ngược Q13=A, nhân đôi đường quyền và cần cột nguồn gắn. - Chọn sẵn khi có hơn một ứng viên. - Tự chuyển một việc đang gắn mục tiêu khác. - Thêm mode «Theo việc được giao» (QL-95, red) trước khi đo 2–4 tuần.

**Hiện trạng gắn việc ↔ mục tiêu (đo trên mã).** Một việc gắn tối đa một mục tiêu (cột `tasks.goal_id`). Muốn gắn phải có đủ quyền sửa mục tiêu và sửa việc. Mục tiêu cá nhân chỉ nhận việc của chính người đó, mục tiêu dự án chỉ nhận việc cùng dự án. Chỉ cách đo «theo việc gắn» dùng tới liên kết. Cách đo «Theo dự án» tự tính mọi việc lá của dự án, không cần gắn; «Phân rã từ mẫu» sinh việc đã gắn sẵn. Chưa có: tạo việc kèm mục tiêu, việc con kế thừa, gợi ý mục tiêu.

| Phương án | Thuộc hướng | Mức tự động | Zone | Khuyến nghị sau phản biện | Bớt thao tác |
| --- | --- | --- | --- | --- | --- |
| Gợi ý một chạm trong ô «Mục tiêu» của chi tiết việc, ứng viên lọc ở server | Hướng 2 — gợi ý một chạm | goi-y-mot-cham | 🟡 yellow | làm ngay | Gắn từ chi tiết việc: 2 → 1 (mở dropdown + chọn → chạm chip). Không còn sót ứng viên khi tenant có hơn 200 mục tiêu. |
| Điền sẵn mục tiêu khi tạo việc (form Tạo việc, tạo từ chat, tạo trong workspace dự án) | Hướng 1 — điền sẵn khi tạo | ke-thua-mac-dinh | 🟡 yellow | làm ngay (đã sửa khi phản biện) | Tạo việc rồi gắn, tính từ /tasks: 6 → 3 khi được chọn sẵn, 4 khi qua chip, 5 khi có nhiều ứng viên (bỏ 1 lần mở lại việc). |
| Việc con đề xuất mục tiêu của việc cha (không tự gắn) | Hướng 1 — kế thừa từ việc cha (đề xuất) | ke-thua-mac-dinh | 🟡 yellow | làm ngay | Tạo việc con rồi gắn: 6 → 4 (Q28=A) hoặc 3 (Q28=B). |
| Gợi ý hàng loạt ở trang mục tiêu: «N việc trong phạm vi và kỳ chưa gắn mục tiêu nào» | Hướng 2 — gợi ý hàng loạt | goi-y-mot-cham | 🟡 yellow | làm ngay (đã sửa khi phản biện) | Gắn 8 việc: 11 → 3 (tab → dải → Gắn). Số thao tác không còn tăng theo N. |
| Lan truyền khi đổi: giao lại người, đổi dự án, và dò liên kết lệch neo ở phía mục tiêu | Hướng 4 — xử lý khi việc thay đổi | lan-truyen-khi-doi | 🟡 yellow | làm ngay (đã sửa khi phản biện) | Giao lại rồi chỉnh liên kết: 4 → 3, và từ «không ai biết» thành được nhắc ngay. Đổi dự án rồi gắn mục tiêu mới: 5 → 4. Dọn liên kết lệch ở trang mục tiêu: 2 thao tác mỗi dòng, có dấu hiệu nhìn thấy. |
| Mục tiêu cấp dự án mặc định đo «Theo dự án» — liên kết ngầm 0 thao tác | Hướng 3 — dùng cơ chế tự động có sẵn | quy-tac-tu-dong | 🟢 green | làm ngay (đã sửa khi phản biện) | Gắn 10 việc của dự án vào mục tiêu dự án: 13 → 0. Mỗi việc mới sau đó: 2 → 0. |
| Mode mới «Theo việc được giao trong kỳ» cho mục tiêu cá nhân (thành viên động theo người phụ trách) | Hướng 3 — quy tắc tự động mới | quy-tac-tu-dong | 🔴 red | làm sau | Gắn việc cá nhân vào mục tiêu cá nhân: 13 → 0 (10 việc), mỗi việc mới 2 → 0. |
| Server tự gắn: POST /tasks nhận goalId, việc con kế thừa ở server, hoặc quy tắc theo nhãn/mẫu | Server tự gắn | quy-tac-tu-dong | 🔴 red | không làm | Như B/C nhưng ít hơn 0–1 chạm. |

**Không làm:** server tự gắn (POST /tasks nhận `goalId`, việc con kế thừa ở server, quy tắc theo nhãn). Lý do: đi ngược Q13 = A, nhân đôi đường kiểm quyền, cần cột nguồn gắn (vùng đỏ), và tự quyết thay người ở chỗ ảnh hưởng số đánh giá.

**Phụ thuộc chung.** Hai story chạm việc đang gắn mục tiêu khác (US-GOAL-QL-94, US-X-94) dùng khuôn «gỡ khỏi mục tiêu cũ rồi mới gắn mục tiêu mới», để mục tiêu cũ được kiểm quyền và chốt kỳ. Kèm một WO vùng đỏ riêng ở đường gắn phía server (chi tiết ngoài repo); WO đó nên merge trước hoặc cùng lúc với US-GOAL-QL-94.

| Id | Tiêu đề | Loại | Ưu tiên | Cỡ | Zone | Thao tác trước→sau |
| --- | --- | --- | --- | --- | --- | --- |
| US-GOAL-QL-93 | Mục tiêu cấp dự án mặc định đo «Theo dự án»; việc của dự án hiện «Tự tính vào ‹G›» | tối ưu | P1 | S | 🟢 | 2→0 |
| US-GOAL-NV-92 | Tạo việc: tự điền sẵn mục tiêu cá nhân của chính mình; các trường hợp khác gợi ý một chạm (form, tạo nhanh, chi tiết việc) | tối ưu | P1 | M | 🟡 | 6→3 |
| US-GOAL-NV-93 | Việc con đề xuất «Tính vào mục tiêu của việc cha» (một chạm, không tự gắn) | tối ưu | P2 | S | 🟡 | 6→4 |
| US-GOAL-QL-94 | Gợi ý hàng loạt «N việc trong kỳ chưa gắn mục tiêu» trên tab Công việc gắn; picker không chuyển việc đang gắn mục tiêu khác | tối ưu | P1 | M | 🟡 | 11→3 |
| US-X-94 | Liên kết mục tiêu khi giao lại người hoặc đổi dự án: hỏi tại chỗ; tab mục tiêu đánh dấu liên kết lệch neo | hoàn thiện | P1 | M | 🟡 | 4→3 |
| US-GOAL-QL-95 | Mode «Theo việc được giao trong kỳ» cho mục tiêu cá nhân (thành viên động, không cần gắn) | tối ưu | P2 | L | 🔴 | 13→0 |

##### US-GOAL-QL-93 · Mục tiêu cấp dự án mặc định đo «Theo dự án»; việc của dự án hiện «Tự tính vào ‹G›» *(bổ sung theo câu hỏi owner)*
**P1 · S · 🟢 green** · Lớp FE · Phụ thuộc: Owner chọn Q31=A. Tuỳ chọn: US-GOAL-QL-04 (prefill /goals/new), US-GOAL-QL-10 lát A (tab Mục tiêu trong workspace). · Spec: SPEC-10 §3.2, §13.1 (mode project, DECISIONS-05 D-35), GOAL-ERR-012/013; GOAL-SCREEN-003

- **Story.** Là quản lý dự án, tôi muốn mục tiêu cấp dự án tự tính mọi việc của dự án ngay khi tạo, để không phải gắn từng việc và không phải biết rằng có một chế độ đo riêng. *(Vai: Quản lý.)*
- **Cơ chế.**
  - GoalFormPage (chỉ chế độ TẠO): khi `level` chuyển sang `project` mà ô «Cách đo» CHƯA bị người dùng chạm (dirty flag của RHF), đặt `progressMode='project'`.
  - Nếu dự án đã có một mục tiêu mode `project` Active trùng kỳ thì KHÔNG đặt mặc định. Kiểm bằng GET /goals?projectId=&status=Active&periodFrom=&periodTo= (view:goal) rồi lọc mode ở client. Trường hợp này hiện gợi ý «Dự án đã có ‹G› đo theo dự án; mục tiêu này nên đo theo việc gắn».
  - Rời cấp project trong khi giá trị đang là 'project' thì CHỦ ĐỘNG trả về `manual`. Hiện GoalFormPage.tsx:362 chỉ disable option, không trả giá trị, nên server sẽ trả ERR-012.
  - Gợi ý dưới ô «Cách đo»: «Tính mọi việc (việc lá) của dự án, của mọi người, KHÔNG giới hạn theo kỳ. Chọn ‹Theo việc được gắn› nếu mục tiêu chỉ nói về một phần dự án hoặc một kỳ.»
  - Form Sửa giữ nguyên mode đang lưu; không tự đổi mode của mục tiêu đã có.
  - TaskGoalField: thêm một truy vấn GET /goals?projectId=<dự án của việc>&status=Active, gate bằng view:goal, ĐỘC LẬP với canEdit (hiện chỉ truy vấn khi canEdit, :49-54). Mục tiêu mode `project` không vào danh sách gắn mà hiện dòng chỉ đọc «Tự tính vào ‹mã — tên› (theo dự án)»; đã chốt kỳ thì thêm «(đã chốt kỳ)».
- **Luồng.** /goals/new (hoặc tab Mục tiêu của workspace dự án → «Tạo mục tiêu dự án») → chọn cấp Dự án + dự án → Lưu. Sau đó việc của dự án được tạo như bình thường.
  - **Trước: 2 thao tác.** Người đã biết mode project: 2 thao tác thêm khi tạo (mở «Cách đo» → chọn «Theo dự án») vì mặc định là manual (goal-form-schema.ts:123). Người không biết thì đo theo việc gắn: 13 thao tác cho 10 việc (tab Công việc gắn → Gắn việc → tick 10 → Gắn; GoalLinkedTasksTab.tsx:76-90), cộng 2 thao tác cho mỗi việc mới (mở Mục tiêu → chọn).
  - **Sau: 0 thao tác.** 0 thao tác thêm. Mọi việc lá của dự án tự vào tập đo, và engine tính lại khi tạo việc, đổi trạng thái, đổi dự án hoặc xoá (task-core.service.ts:587-595,802-809; task-actions.service.ts:289-294).
- **Tiêu chí chấp nhận.**
  1. Given tạo mục tiêu mới cấp Dự án cho dự án X, X chưa có mục tiêu mode project trùng kỳ và tôi chưa chạm ô Cách đo, When xem form, Then Cách đo = «Theo dự án» kèm gợi ý «không giới hạn theo kỳ». Lưu xong thì % = việc lá Done / việc lá không Cancelled của X.
  2. Given X đã có mục tiêu mode project Active trùng kỳ, When chọn cấp Dự án + X, Then Cách đo giữ «Thủ công» và hiện gợi ý dùng «Theo việc được gắn».
  3. Given form đang ở Cách đo = «Theo dự án», When đổi cấp sang Phòng ban, Then Cách đo tự về «Thủ công», và Lưu không bị ERR-012.
  4. Given tôi đã tự chọn một Cách đo khác rồi đổi cấp qua lại, When đổi cấp, Then giá trị tôi đã chọn không bị ghi đè (trừ trường hợp ERR-012 ở trên).
  5. Given mục tiêu dự án mode project đã chốt kỳ, When thêm việc mới vào dự án, Then % không đổi và dòng «Tự tính vào» trên việc ghi «(đã chốt kỳ)».
  6. Given tôi có view:goal nhưng không có update:goal, When mở chi tiết một việc của X, Then vẫn thấy dòng chỉ đọc «Tự tính vào ‹G›». Không có view:goal thì không có dòng này và không gọi GET /goals.
- **Zone.** Chỉ đổi giá trị mặc định của form tạo và thêm dòng hiển thị ở FE. Mode `project`, CHECK chk_goals_mode_project và đếm lá D-35 đã có sẵn. Không đổi đường ghi, quyền, DTO hay schema; đổi mode ở form Sửa vẫn đi qua PATCH có tính lại + audit (GOAL-ERR-013).
- **Dẫn chứng.** apps/app/src/routes/goals/goal-form-schema.ts:108-126 (mặc định manual); apps/app/src/routes/goals/GoalFormPage.tsx:359-366 (chỉ disable option); apps/api/src/goals/goals-validation.service.ts:288 (ERR-012); apps/api/src/tasks/goal-progress-engine.service.ts:244-276 (đếm lá toàn dự án, không lọc kỳ); apps/app/src/routes/tasks/TaskGoalField.tsx:49-54.
- **Ghi chú.** Đây là «liên kết tự động» thật làm được mà không đụng BE: thành viên động theo dự án. Có thể sai nghĩa nếu mục tiêu chỉ nói về một kỳ hoặc một phần dự án, nên gợi ý phải ghi rõ và mặc định cần owner chốt (Q31). Mục tiêu cá nhân chưa có mode tương đương, xem Q30 / US-GOAL-QL-95.

##### US-GOAL-NV-92 · Tạo việc: tự điền sẵn mục tiêu cá nhân của chính mình; các trường hợp khác gợi ý một chạm (form, tạo nhanh, chi tiết việc) *(bổ sung theo câu hỏi owner)*
**P1 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-GOAL-NV-08 (helper hai lời gọi + «Thử gắn lại»), US-X-91 (toast có hành động), US-X-92 (hôm nay theo giờ công ty). Đường tạo nhanh hưởng qua US-TASK-NV-05; tạo từ chat hưởng qua US-CHAT-NV-10, vì story đó phải tự thêm `initialValues` cho TaskFormDrawer. · Spec: SPEC-10 GOAL-FUNC-006, GOAL-API-001/010, §12 GOAL-ERR-005/008, §13.2; SPEC-06 TASK-API-202

- **Story.** Là người tạo việc, tôi muốn việc mới tự được tính vào mục tiêu mà nó rõ ràng đóng góp, hoặc được gợi ý bằng một chạm, để không phải mở lại việc để gắn. *(Vai: Cả hai vai.)*
- **Cơ chế.**
  - Helper thuần `goal-suggest.ts`: tách `matchesTaskAnchor` (TaskGoalField.tsx:162-177) và thêm 3 luật: `progressMode==='tasks'` (sửa lỗi hiện có: dropdown đang cho gắn vào mục tiêu manual/children/project, nơi việc gắn không làm đổi số), kỳ chứa hạn việc (hoặc hôm nay theo giờ công ty), Active và chưa chốt. Thứ tự: cá nhân của người phụ trách > dự án > phòng.
  - Hook `useGoalSuggestions({projectId, assigneeEmployeeId, departmentId, dueAt})`: tối đa 3 truy vấn GET /goals hẹp (employeeId / projectId / departmentId + status=Active + periodFrom=periodTo=<ngày>, limit 50), lọc mode ở client vì server không có bộ lọc progressMode. Chỉ bật khi có cả update:goal và update:task. Không đưa ra ứng viên khi việc chưa có người phụ trách VÀ không thuộc dự án: việc như vậy nằm ngoài phạm vi ghi, bước gắn sẽ trả 404.
  - Luật CHỌN SẴN: đúng 1 ứng viên VÀ đó là mục tiêu cá nhân có `employeeId === ownerEmployeeId === employeeId của tôi` (lấy từ GET /me). Đây là trường hợp duy nhất FE chắc server cho ghi, vì phạm vi Own đòi cả hai vế (goal-access.service.ts:254-260) và useCan không cho biết scope. Kèm nhãn «Gợi ý».
  - Đúng 1 ứng viên mà không thoả luật chọn sẵn: hiện chip «Gắn vào ‹G›?». Nhiều ứng viên: dropdown, không chọn sẵn.
  - TaskFormDrawer (create): thêm ô «Mục tiêu», tính lại khi người phụ trách, dự án, phòng hoặc hạn đổi. Lưu: POST /tasks → nếu có giá trị thì POST /goals/:id/tasks {taskIds:[id]}. Bước 2 lỗi thì việc vẫn còn, hiện «Đã tạo việc ‹mã› nhưng chưa gắn: ‹lý do›» + «Thử gắn lại». Lỗi 404 ở bước này đổi thành «Bạn không có quyền ghi việc này vào mục tiêu». Thành công: toast «Đã gắn vào ‹G› · Gỡ». Cảnh báo mềm `warnings[]` của mục tiêu phòng hiện nguyên văn.
  - Tạo nhanh một dòng (US-TASK-NV-05) và KanbanQuickCreate: không thêm ô. Sau khi tạo thành công, nếu helper cho đúng 1 ứng viên thì hiện toast «Đã tạo ‹mã› · Tính vào ‹G›?»; chạm vào thì POST link.
  - TaskGoalField (chi tiết việc): dùng cùng hook. Việc CHƯA gắn mà có đúng 1 ứng viên thì hiện chip một chạm; việc đang gắn mục tiêu khác thì không gợi ý chuyển. Mục tiêu đang gắn nằm ngoài danh sách vẫn hiện như :132-139.
- **Luồng.** /tasks → «Tạo việc» → tiêu đề (người phụ trách/dự án/hạn nhập như hiện nay) → Lưu. Hoặc «Việc của tôi» → gõ dòng tạo nhanh → Enter → chạm toast.
  - **Trước: 6 thao tác.** 6 thao tác tính từ /tasks, với điều kiện người phụ trách/dự án đã nhập như nhau ở cả hai phía: Tạo → tiêu đề → Lưu → mở việc vừa tạo (drawer đóng sau khi lưu, TaskListPage.tsx:347-352) → mở dropdown Mục tiêu → chọn. Ứng viên chỉ lấy từ 200 mục tiêu Active đầu tiên (TaskGoalField.tsx:49-54). Tạo nhanh rồi gắn: Enter + 3 = 4 (+1 gõ tiêu đề).
  - **Sau: 3 thao tác.** 3 khi được chọn sẵn (Tạo → tiêu đề → Lưu); 4 khi qua chip; 5 khi có nhiều ứng viên. Tạo nhanh: gõ + Enter + chạm toast = 3. Gắn từ chi tiết việc: 2 → 1.
- **Tiêu chí chấp nhận.**
  1. Given NV có mục tiêu cá nhân G (mode tasks, Active, kỳ Q4/2026, employeeId = ownerEmployeeId = NV), When tạo việc giao cho chính mình, hạn 15/11/2026, Then ô Mục tiêu chọn sẵn G kèm «Gợi ý». Lưu xong việc có goalId=G, % của G tính lại, có toast «Đã gắn vào G · Gỡ».
  2. Given toast vừa hiện, When bấm «Gỡ», Then gọi DELETE /goals/G/tasks/:id, ô Mục tiêu của việc về «—», % của G tính lại, audit GoalTaskUnlinked ghi actor là người bấm.
  3. Given mục tiêu cá nhân của NV do quản lý tạo với ownerEmployeeId = quản lý, When NV tạo việc, Then KHÔNG chọn sẵn mà chỉ hiện chip. Chạm chip mà server trả 403 thì hiện thông điệp server, việc giữ trạng thái chưa gắn.
  4. Given người tạo thiếu update:goal hoặc update:task, When mở form, Then không có ô Mục tiêu và không gọi GET /goals.
  5. Given việc không có người phụ trách và không thuộc dự án, When mở form, Then ô Mục tiêu không đưa ra ứng viên nào và Lưu không gọi bước gắn.
  6. Given G bị chốt kỳ sau khi form đã tải, When Lưu, Then việc được tạo, bước gắn trả GOAL-ERR-005, hiện «Đã tạo việc ‹mã› nhưng chưa gắn: mục tiêu đã chốt kỳ»; không báo thành công giả.
  7. Given việc có 2 ứng viên (mục tiêu dự án mode tasks + mục tiêu cá nhân), When mở form, Then không chọn sẵn; dropdown xếp mục tiêu cá nhân trước; không chọn thì Lưu không gắn gì.
  8. Given tenant có hơn 200 mục tiêu Active, When mở chi tiết việc, Then mục tiêu cá nhân của người phụ trách vẫn được gợi ý. Mục tiêu mode manual/children/project không bao giờ xuất hiện trong danh sách gắn.
- **Zone.** FE ghép hai endpoint ghi sẵn có trên luồng task/goal (POST /tasks rồi POST /goals/:id/tasks), đúng khuôn NV-08 theo Q13=A. Đọc GET /goals bằng bộ lọc sẵn có, dưới view:goal. Không đổi DTO, quyền hay schema.
- **Dẫn chứng.** apps/app/src/routes/tasks/TaskFormDrawer.tsx:37-54,98-117 (không có initialValues; onSuccess đóng drawer); apps/app/src/routes/tasks/TaskListPage.tsx:347-352 (nơi duy nhất mount TaskFormDrawer create); apps/app/src/routes/tasks/KanbanQuickCreate.tsx:43; apps/app/src/routes/tasks/task-form-schema.ts:41-46 (người phụ trách mặc định rỗng); apps/app/src/routes/tasks/TaskGoalField.tsx:49-59,162-177; packages/contracts/src/goal.ts:135-151; apps/api/src/goals/goals.repository.ts:177-183; apps/api/src/goals/goal-access.service.ts:254-271; apps/api/src/tasks/task-core.repository.ts:314-352 (phạm vi ghi = người phụ trách hoặc Owner/Manager dự án); packages/web-core/src/hooks/use-can.ts:13-24; packages/contracts/src/me.ts:125.
- **Ghi chú.** Gộp phương án A (chip trong chi tiết việc) vào đây. Workspace dự án không có form Tạo việc đầy đủ, nên chỉ được hưởng qua toast sau KanbanQuickCreate. Audit hiện không phân biệt gắn qua gợi ý với gắn tay; chấp nhận được vì người dùng đã thấy ô và tự bấm Lưu hoặc chạm.

##### US-GOAL-NV-93 · Việc con đề xuất «Tính vào mục tiêu của việc cha» (một chạm, không tự gắn) *(bổ sung theo câu hỏi owner)*
**P2 · S · 🟡 yellow** · Lớp FE · Phụ thuộc: US-GOAL-NV-92 (helper + hai lời gọi), US-X-91 · Spec: SPEC-10 GOAL-DEC-006, §13.1 (mode tasks không kéo cây con), GOAL-ERR-005/008; SPEC-06 §3.8

- **Story.** Là nhân viên chia một việc thành việc con, tôi muốn được đề xuất tính việc con vào cùng mục tiêu với việc cha, để không phải mở từng việc con ra gắn lại. *(Vai: Nhân viên.)*
- **Cơ chế.**
  - TaskDetailContent truyền `parentGoalId={task.goalId}` vào TaskSubtaskPanel (hiện chỉ nhận taskId, :396), rồi tiếp xuống AddSubtaskDialog.
  - AddSubtaskDialog đọc G qua GET /goals/:id (view:goal, cache). Ô «Tính vào ‹mã — tên› của việc cha» chỉ hiện khi G có mode `tasks`, Active, chưa chốt, và người dùng có update:goal + update:task.
  - Khoá ô kèm lý do khi: G là mục tiêu cá nhân và người phụ trách việc con khác `G.employeeId`, HOẶC việc con chưa có người phụ trách (GOAL-ERR-008); hoặc việc con không có người phụ trách và cha không thuộc dự án (ngoài phạm vi ghi).
  - Chú thích: «Mục tiêu đếm từng việc: việc cha và việc con đều được tính.» Mặc định của ô theo Q28 (A = không chọn sẵn).
  - Lưu: tạo việc con rồi gắn bằng helper của NV-92. Lỗi thì «chưa gắn» + «Thử gắn lại»; thành công thì toast «Đã gắn vào ‹G› · Gỡ».
- **Luồng.** Chi tiết việc cha → «Thêm việc con» → tiêu đề → chạm ô «Tính vào ‹G›» → Lưu.
  - **Trước: 6 thao tác.** 6 thao tác: Thêm việc con → tiêu đề → Lưu → mở việc con → mở dropdown Mục tiêu → chọn. Việc con không kế thừa goal_id (task-core.service.ts:380-391: createTask không truyền goalId).
  - **Sau: 4 thao tác.** 4 (Q28=A: bật ô bằng 1 chạm); 3 nếu Q28=B.
- **Tiêu chí chấp nhận.**
  1. Given việc cha gắn G (mode tasks, Active), When mở «Thêm việc con», Then có ô «Tính vào G» kèm chú thích. Bật ô rồi Lưu thì việc con có goalId=G và % của G tính lại.
  2. Given không bật ô, When Lưu, Then việc con không gắn mục tiêu nào.
  3. Given thiếu update:goal, When mở hộp thoại, Then không có ô; tạo việc con chạy như hiện nay.
  4. Given G đã chốt kỳ hoặc Cancelled, When mở hộp thoại, Then không có ô và không gọi bước gắn.
  5. Given G là mục tiêu cá nhân của A, When chọn người phụ trách B hoặc để trống, Then ô bị khoá kèm lý do; chọn lại A thì bật được.
  6. Given việc con vừa được gắn qua ô này, When bấm «Gỡ» trên toast, Then liên kết bị gỡ, có audit GoalTaskUnlinked và % tính lại.
- **Zone.** FE ghép POST /tasks (parentTaskId) với POST /goals/:id/tasks sẵn có. Không kế thừa ở server, không đổi GOAL-DEC-006.
- **Dẫn chứng.** apps/app/src/routes/tasks/TaskSubtaskDialogs.tsx:115-148; apps/app/src/routes/tasks/TaskDetailContent.tsx:229,396; apps/api/src/tasks/task-core.service.ts:380-391,408-417; apps/api/src/goals/goal-tasks-link.service.ts:225-233 (ERR-008 employee); apps/api/src/tasks/task-core.repository.ts:321-352.
- **Ghi chú.** Không có «kế thừa ở server» (phương án H). Gắn cả cha lẫn con là cách đúng spec khi muốn đếm việc con (GOAL-DEC-006), nhưng làm đổi trọng số, nên mặc định không chọn sẵn.

##### US-GOAL-QL-94 · Gợi ý hàng loạt «N việc trong kỳ chưa gắn mục tiêu» trên tab Công việc gắn; picker không chuyển việc đang gắn mục tiêu khác *(bổ sung theo câu hỏi owner)*
**P1 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-GOAL-QL-14 (cùng file GoalLinkedTasksTab.tsx), US-X-91, US-X-92 (mốc kỳ theo giờ công ty). Nên merge sau, hoặc cùng lúc với, WO vùng đỏ ở đường gắn phía server (xem «Phụ thuộc chung»). · Spec: SPEC-10 GOAL-FUNC-006 (gắn bulk từ trang goal), GOAL-API-010, GOAL-ERR-005/008, §13.2

- **Story.** Là quản lý đầu kỳ, tôi muốn thấy ngay các việc thuộc phạm vi mục tiêu trong kỳ mà chưa gắn mục tiêu nào và gắn chúng bằng một lần xác nhận, để % phản ánh đúng khối việc mà không phải tick từng việc. *(Vai: Quản lý.)*
- **Cơ chế.**
  - Chỉ áp cho mục tiêu mode `tasks`, chưa chốt, khi có update:goal + update:task (cùng gate với «Gắn việc», GoalLinkedTasksTab.tsx:37-46,76-87).
  - Truy vấn ứng viên: neo theo cấp như GoalTaskPickerDialog.tsx:53-64, cộng `dueFrom`/`dueTo` = đầu periodStart / cuối periodEnd theo giờ công ty (US-X-92, ISO có offset), limit 100. Lọc ở client: `goalId == null`, khác Cancelled. Trang đầy thì N hiển thị «100+».
  - Dải: «N việc của ‹neo› có hạn trong kỳ chưa gắn mục tiêu nào · Xem và gắn» (việc không có hạn không vào gợi ý; có dòng chú thích).
  - Dialog chế độ «gợi ý»: tick sẵn ứng viên chưa gắn, TRỪ việc là cha của một ứng viên khác trong tập (suy từ parentTaskId; DTO danh sách không có subtaskTotal) để không vô tình đếm cả cha lẫn con. Nút «Gắn N việc» đếm theo số đang tick.
  - Việc đang gắn mục tiêu KHÁC (cả ở chế độ «Gắn việc» thường): hiện «Đang gắn ‹mã›», KHÔNG tick được trong bulk. Có nút theo dòng «Chuyển về đây» = DELETE /goals/<cũ>/tasks/:id rồi POST, để mục tiêu cũ được kiểm quyền và chốt kỳ; lỗi bước 1 thì hiện lý do và dừng.
  - Sau khi gắn: toast «Đã gắn N việc · Hoàn tác». Tập hoàn tác = các id đã gửi mà TRƯỚC đó có goalId == null (tính ở client vì response chỉ trả số đếm). Gọi DELETE tuần tự và báo dòng lỗi. `warnings[]` của mục tiêu phòng hiện trong dialog như hiện nay.
- **Luồng.** /goals/{id} → tab «Công việc gắn» → dải «8 việc chưa gắn · Xem và gắn» → «Gắn 8 việc».
  - **Trước: 11 thao tác.** 11 thao tác cho 8 việc: tab → «Gắn việc» → tick 8 → «Gắn» (3+N), +1 nếu gõ ô tìm ở cấp phòng. Picker lẫn việc đang gắn mục tiêu khác mà không báo (GoalTaskPickerDialog.tsx:87-91,93-99).
  - **Sau: 3 thao tác.** 3 thao tác bất kể N (tab → dải → Gắn); +1 cho mỗi việc muốn bỏ tick.
- **Tiêu chí chấp nhận.**
  1. Given mục tiêu phòng D mode tasks kỳ Q4 và 8 việc của D có hạn trong Q4 chưa gắn, When mở tab, Then thấy dải «8 việc… chưa gắn». Bấm rồi «Gắn 8 việc» thì cả 8 vào bảng và % tính lại.
  2. Given trong tập có việc cha P và việc con C của P, When mở dialog gợi ý, Then C được tick sẵn, P không tick sẵn nhưng tick tay được.
  3. Given có việc đang gắn mục tiêu E khác, When mở dialog (cả hai chế độ), Then việc đó hiện «Đang gắn E» và không tick được. Bấm «Chuyển về đây» khi E đã chốt kỳ thì báo lỗi GOAL-ERR-005 và việc giữ nguyên ở E.
  4. Given có hơn 100 ứng viên, When mở tab, Then dải ghi «100+» và dialog chỉ xử lý 100 việc đầu (đúng trần bulk).
  5. Given mục tiêu đã chốt, mode khác `tasks`, hoặc người xem thiếu update:goal/update:task, When mở tab, Then không có dải và không truy vấn ứng viên.
  6. Given vừa gắn 8 việc (trong đó 1 việc «đã gắn sẵn»), When bấm «Hoàn tác», Then chỉ 7 liên kết mới bị gỡ, mỗi liên kết có audit GoalTaskUnlinked, % trở về giá trị cũ.
- **Zone.** FE dùng GET /tasks với bộ lọc sẵn có (neo + dueFrom/dueTo) và POST/DELETE /goals/:id/tasks sẵn có. Không đổi quyền, DTO hay schema.
- **Dẫn chứng.** apps/app/src/routes/goals/components/GoalTaskPickerDialog.tsx:16,53-64,87-99; apps/app/src/routes/goals/components/GoalLinkedTasksTab.tsx:37-46,76-91; packages/contracts/src/task.ts:593-615 (dueFrom/dueTo datetime có offset, parentOnly; không có bộ lọc chưa-gắn), :758-770 (parentTaskId, goalId); apps/api/src/tasks/task-core.repository.ts:400-402; apps/api/src/goals/goal-tasks-link.service.ts:105-158 (bulk; response chỉ trả số đếm).
- **Ghi chú.** Việc FE không gửi bulk các việc đang gắn chỗ khác chỉ là phòng vệ ở giao diện. Phía server xử lý ở WO vùng đỏ riêng (chi tiết ngoài repo). Khi NV-07 thêm `goalId` vào listTaskCoreQuerySchema, có thể xét thêm một giá trị «chưa gắn» để đếm N chính xác; việc đó amber, không thuộc story này.

##### US-X-94 · Liên kết mục tiêu khi giao lại người hoặc đổi dự án: hỏi tại chỗ; tab mục tiêu đánh dấu liên kết lệch neo *(bổ sung theo câu hỏi owner)*
**P1 · M · 🟡 yellow** · Lớp FE · Phụ thuộc: US-GOAL-NV-92 (helper tìm đích mới), US-X-91, US-GOAL-QL-14 (bảng Công việc gắn), US-GOAL-QL-01 (tên người phụ trách mục tiêu, Q14=B) · Spec: SPEC-10 §13.3 («đổi dự án… giữ liên kết + cảnh báo trên UI»), §12 GOAL-ERR-005/008, GOAL-DEC-008

- **Story.** Là người giao lại hoặc chuyển dự án cho một việc, tôi muốn được báo khi việc đang tính vào mục tiêu của người cũ hoặc dự án cũ và xử lý bằng một chạm. Là quản lý, tôi muốn thấy những việc đã không còn khớp mục tiêu, để % đánh giá không bị đẩy bởi việc không còn thuộc về người đó. *(Vai: Cả hai vai.)*
- **Cơ chế.**
  - Sau khi giao lại thành công (TaskAssigneeField, TaskInlineFields.tsx:375-402, cần assign:task; hoặc đổi người trong form Sửa), nếu `task.goalId` có giá trị thì đọc G qua GET /goals/:id (view:goal; không có quyền thì không hiện gì). G là mục tiêu cá nhân có `G.employeeId` = người cũ: hiện dải «Việc này đang tính vào mục tiêu của ‹A›: ‹G›» với các nút [Chuyển sang ‹G2›] (chỉ khi helper NV-92 cho đúng 1 ứng viên của B), [Gỡ], [Giữ]. Nút ghi chỉ hiện khi có update:goal + update:task.
  - «Chuyển» = DELETE /goals/G/tasks/:id rồi POST /goals/G2/tasks; KHÔNG gắn thẳng sang G2 bằng một lời gọi: tách hai bước để G được kiểm quyền và chốt kỳ. Bước 1 lỗi (403/ERR-005) thì hiện lý do và không gắn G2. Bước 2 lỗi thì «Đã gỡ khỏi G nhưng chưa gắn G2 · Thử gắn lại». G đã chốt thì chỉ hiện thông tin «Mục tiêu đã chốt kỳ, liên kết được giữ».
  - TaskMoveProjectDialog: việc đang gắn mục tiêu cấp dự án của dự án cũ thì hiện cảnh báo vàng trước khi xác nhận (SPEC-10 §13.3). Sau khi chuyển, nếu dự án mới có đúng 1 mục tiêu dự án mode tasks thì toast «Gắn vào ‹G mới›?»; nếu là mode project thì báo «Tự tính vào ‹G mới›».
  - GoalLinkedTasksTab: dòng lệch neo có nhãn «Đã giao cho người khác» (cấp employee, mainAssigneeEmployeeId ≠ goal.employeeId) hoặc «Đã chuyển dự án» (cấp project, projectId ≠ goal.projectId), kèm nút «Gỡ» sẵn có và bộ đếm trên đầu bảng. Cách này bắt được mọi đường đổi (bulk QL-03, PATCH, assign).
  - Giới hạn đã biết: tab chỉ liệt kê việc trong phạm vi read:task của người xem (goal-tasks-link.service.ts:74-100). NV phạm vi Own sẽ không thấy việc đã bị giao sang người khác, dù việc đó vẫn được tính vào % của NV, nên việc dọn liên kết thuộc về quản lý. Không tự gỡ ở server.
- **Luồng.** Chi tiết việc → đổi Người phụ trách A → B → dải «đang tính vào mục tiêu của A» → «Chuyển sang mục tiêu của B» (hoặc Gỡ / Giữ).
  - **Trước: 4 thao tác.** 4 thao tác, và người dùng phải tự biết là có liên kết cần sửa: mở picker người → chọn B → mở dropdown Mục tiêu → chọn mục tiêu của B hoặc «—». Server không kiểm và không báo (task-actions.service.ts chỉ tính lại khi đổi trạng thái, :289-294). TaskMoveProjectDialog không nhắc gì về mục tiêu (:90).
  - **Sau: 3 thao tác.** 3 thao tác: mở picker người → chọn B → chạm «Chuyển sang ‹G2›» hoặc «Gỡ». Đổi dự án rồi gắn mục tiêu mới: 5 → 4.
- **Tiêu chí chấp nhận.**
  1. Given việc gắn mục tiêu cá nhân G của A (chưa chốt) và B có đúng 1 mục tiêu cá nhân mode tasks đang chạy, When giao lại cho B rồi chạm «Chuyển», Then gọi DELETE ở G rồi POST ở G2. Việc có goalId=G2, % của G và G2 cùng tính lại, có cả GoalTaskUnlinked (G) lẫn GoalTaskLinked (G2).
  2. Given người giao lại không có phạm vi ghi trên G, When chạm «Chuyển» hoặc «Gỡ», Then DELETE trả 403, hiện lý do; việc vẫn gắn G và KHÔNG được gắn sang G2.
  3. Given G đã chốt kỳ, When giao lại, Then dải chỉ hiện thông tin, không có nút ghi; số đã chốt của G không đổi.
  4. Given người giao lại không có view:goal, When giao lại xong, Then không hiện dải và không gọi GET /goals/:id.
  5. Given việc gắn mục tiêu dự án của P1, When mở hộp chuyển sang P2, Then thấy cảnh báo giữ liên kết trước khi xác nhận. Sau khi chuyển, tab Công việc gắn của mục tiêu P1 (với người xem có quyền đọc việc) hiện dòng đó với nhãn «Đã chuyển dự án» + «Gỡ».
  6. Given chọn «Giữ», When đóng dải, Then không gọi API nào và liên kết giữ nguyên.
- **Zone.** FE đọc dữ liệu sẵn có (goalId của việc, GET /goals/:id, listLinkedTasks) và gọi các endpoint gắn/gỡ đã có audit. Server không tự gỡ; không đổi quyền hay schema.
- **Dẫn chứng.** apps/app/src/routes/tasks/TaskInlineFields.tsx:375-402 (assign cần assign:task); apps/app/src/routes/tasks/TaskMoveProjectDialog.tsx:90; apps/api/src/tasks/task-actions.service.ts:289-294; apps/api/src/tasks/task-core.service.ts:802-811; apps/api/src/goals/goal-tasks-link.service.ts:74-100 (tab lọc theo read:task của người xem), :161-189 (unlink kiểm cổng); packages/web-core/src/lib/goal-api.ts:86; packages/contracts/src/task.ts:765-770 (DTO việc không có level của mục tiêu).
- **Ghi chú.** Phương án server tự gỡ khi giao lại để ở Q29-B (amber). Muốn NV thấy «số việc gắn mục tiêu của bạn mà bạn không còn thấy» thì cần BE trả số đếm (amber); xét sau một kỳ đo.

##### US-GOAL-QL-95 · Mode «Theo việc được giao trong kỳ» cho mục tiêu cá nhân (thành viên động, không cần gắn) *(bổ sung theo câu hỏi owner)*
**P2 · L · 🔴 red** · Lớp DB, BE, contracts, FE, DOC · Phụ thuộc: Owner chọn Q30=B; trước đó đo US-GOAL-NV-92 + US-GOAL-QL-94 trong 2–4 tuần · Spec: SPEC-10 §3.2 (GOAL-DEC-005), §13.1–§13.4, GOAL-ERR-013; DECISIONS-05 D-35

- **Story.** Là quản lý đặt mục tiêu cá nhân kiểu «hoàn thành việc được giao trong quý», tôi muốn mục tiêu tự đo mọi việc nhân viên đó phụ trách chính có hạn trong kỳ, để không ai phải gắn từng việc. *(Vai: Quản lý.)*
- **Cơ chế.**
  - Migration (số tiếp theo head): CHECK chk_goals_mode thêm 'assignee'; CHECK mới `progress_mode <> 'assignee' OR level = 'employee'`. Contracts `goalProgressModeSchema` thêm giá trị; FE chỉ bật lựa chọn này cho cấp Nhân viên.
  - Engine: nhánh mới đếm việc lá có `main_assignee_employee_id = goal.employee_id`, `due_at` nằm trong kỳ (giờ công ty), chưa xoá mềm; loại Cancelled khỏi cả tử và mẫu; chạy trong withTenant. 0 việc thì null.
  - Recompute cùng tx: giao lại (cả người cũ lẫn người mới), dời hạn qua ranh kỳ, đổi trạng thái, xoá mềm. Goal đã chốt bị bỏ qua; job đối soát đêm phủ thêm mode mới.
  - ADR mới nêu rõ tác động lên số đánh giá khi giao lại hoặc dời hạn.
  - Int-spec: deny-path, cross-tenant, chốt kỳ, giao lại A→B làm đổi số của cả hai.
- **Luồng.** /goals/new → cấp Nhân viên → Cách đo «Theo việc được giao trong kỳ» → Lưu; sau đó giao việc như bình thường.
  - **Trước: 13 thao tác.** 13 thao tác để gắn 10 việc qua tab Công việc gắn, +2 cho mỗi việc mới (GoalLinkedTasksTab.tsx:76-90; TaskGoalField.tsx:114-145).
  - **Sau: 0 thao tác.** 0 thao tác gắn.
- **Tiêu chí chấp nhận.**
  1. Given mục tiêu cá nhân của A mode mới, kỳ Q4, A phụ trách 10 việc hạn trong Q4 (2 Done, 1 Cancelled), When xem mục tiêu, Then % = 2/9.
  2. Given giao lại 1 việc từ A sang B (B cũng dùng mode này), When giao xong, Then % của A và B được tính lại trong cùng tx.
  3. Given mục tiêu của A đã chốt kỳ, When giao lại hoặc dời hạn một việc của kỳ đó, Then số đã chốt không đổi.
  4. Given không có update:goal, When PATCH progressMode='assignee', Then 403; mục tiêu cấp phòng hoặc dự án dùng mode này thì 422.
  5. Given đổi Cách đo về «Theo việc được gắn», When lưu, Then % tính lại theo liên kết (null nếu chưa gắn việc nào) và có audit đổi mode.
  6. Given company khác, When tính, Then không đếm việc của tenant khác (int-spec cross-tenant).
- **Zone.** Thêm giá trị progress_mode nghĩa là phải có migration sửa CHECK chk_goals_mode + CHECK mới theo level, ADR bổ sung GOAL-DEC-005/006, sửa SPEC-10 §13.1/§13.3, đổi cách tính số dùng để đánh giá người, và thêm hook recompute ở luồng giao việc/dời hạn. Phải qua FULL gate.
- **Dẫn chứng.** apps/api/src/db/schema/goals.ts:66,111-112; apps/api/src/tasks/goal-progress-engine.service.ts:232-276; apps/api/src/tasks/task-actions.service.ts:289-294; apps/api/src/goals/goals-validation.service.ts:288.
- **Ghi chú.** Chỉ làm khi Q30=B.

---

## 6. Lộ trình đề xuất

Thứ tự trong mỗi đợt là thứ tự gợi ý; **1 WO mỗi phiên** theo CLAUDE.md §9. Story cùng file nên gom thành một WO (vd TASK-NV-04 + TASK-QL-05; GOAL-QL-03 + GOAL-QL-04; CHAT-NV-01 + CHAT-NV-02).

### Đợt 1A — Nền và P0 chỉ FE (green/yellow, không BE)

- **Mục tiêu:** sửa các chỗ chết (404 chat, link chết, mất bộ lọc), dựng nền dùng chung (toast, drawer việc, URL làm trạng thái), và có ngay các luồng hằng ngày tối đa 2 thao tác.
- **Thứ tự:**
  1. **Nền:** US-X-91 → US-X-92 (giờ công ty, đặt trước mọi story tính «hôm nay/quý») → US-CHAT-NV-01 → US-TASK-NV-04 → US-TASK-QL-05 → US-GOAL-QL-03.
  2. **P0:** US-CHAT-NV-02, US-CHAT-NV-04 · US-TASK-NV-01, US-TASK-NV-08 → US-TASK-NV-05, US-TASK-NV-03, US-TASK-QL-06 · US-GOAL-NV-01, US-GOAL-NV-02 → US-GOAL-NV-04, US-GOAL-QL-04 · US-X-05.
  3. **«Hôm nay» (P0, chỉ FE):** US-X-03 + US-X-08 sau US-TASK-NV-04 và US-TASK-NV-01. Q21 = B thì gộp **một WO**; Q21 = A thì hai WO liền nhau.
- **Phụ thuộc ngoài:** owner chốt Q21 trước khi gieo WO của mục 3. Mọi WO có dòng KPI §4 nộp lượt đếm theo «Cách kiểm KPI».
- **Cỡ:** 20 story (9 S + 11 M).

### Đợt 1B — P1/P2 chỉ FE

- **Mục tiêu:** hoàn thiện trải nghiệm từng module trên nền 1A.
- **Story:**
  - **CHAT:** NV-05, NV-06, NV-09, NV-10, NV-11, NV-12, NV-13, NV-91, QL-03, QL-12.
  - **TASK:** NV-10, NV-11, NV-91, NV-92, QL-03, QL-07, QL-13, QL-91, rồi **QL-92** (sau QL-03, QL-05, QL-91) và **NV-93** (sau NV-08).
  - **GOAL:** NV-03, NV-08, NV-12, NV-91, QL-07, QL-08, QL-10 (lát A), QL-11, QL-14, QL-91, QL-92.
  - **Liên module:** X-06, X-09, X-11, X-13, **X-93** (điện thoại; sau TASK-NV-03 và GOAL-NV-91).
  - **Liên kết tự động §5.5:** US-GOAL-QL-93, US-GOAL-NV-92 (sau GOAL-NV-08), US-GOAL-NV-93, US-GOAL-QL-94 (sau GOAL-QL-14), US-X-94.
- **Phụ thuộc:** 1A. `X-09`, `GOAL-QL-91` chung `components/dashboard/**` với `S4-DASH-WIDGETCARD-VARIANT-1`, nên xếp thứ tự hoặc gộp (X-03 đã lên 1A, cũng phải xếp thứ tự với WO này). `TASK-NV-92` trên PROD phụ thuộc `S19-OPS-STORAGEPUBLIC-1`. `X-93` thêm prop vào `DataTable` của `packages/ui`, cùng file với `rowSelection` của TASK-QL-03, nên làm sau QL-03.
- **Cỡ:** 41 story (24 S + 17 M), gồm 5 story §5.5.

### Đợt 2 — Cần BE nhỏ (yellow/amber, không đổi schema hay quyền)

- **Mục tiêu:** sửa hai lỗi BE người dùng không thấy (nhắc hạn, thông báo giao việc), thêm DTO/tham số đọc cho tín hiệu (tên, check-in cuối, @, rủi ro, tải việc), và phục vụ màn tổng hợp cho QL.
- **Story:**
  - **TASK (trước hết):** QL-01, NV-06, rồi NV-02, NV-13, QL-04, QL-08, QL-09, QL-10, QL-11, QL-12.
  - **GOAL:** QL-01 (review lộ dữ liệu một lần) → QL-02 → QL-09 → QL-13; NV-07.
  - **CHAT:** NV-07, NV-08.
  - **Liên module:** X-04, X-07, X-12, X-14. (X-08 đã chuyển lên Đợt 1A vì chỉ là FE.)
- **Phụ thuộc:**
  - Amber (TASK-NV-13, TASK-QL-04, TASK-QL-11, GOAL-QL-01, X-07, X-12) cần security-reviewer và int-spec deny-path/cross-tenant với `LANE_DB`.
  - GOAL-QL-02 đụng `dashboard-widget-handlers.service.ts` (792/800 dòng): phải tách handler theo nợ N6 của HROVERVIEW-FLOOR **trước** khi thêm mã.
- **Cỡ:** 21 story (7 S + 14 M).

### Đợt 3 — Vùng đỏ (DB/quyền/ADR), mỗi việc cần plan riêng và FULL gate

- **Mục tiêu:** các thay đổi chính sách cần owner chốt trước.
- **Story:** US-CHAT-NV-03 (danh bạ nhẹ), US-CHAT-QL-09 (@cả phòng; nên đi cùng CHAT-DEC về tư cách ghim, Q3), US-TASK-QL-14 (báo cáo theo vai trò dự án), US-GOAL-QL-05 (tạo mục tiêu theo lô), US-GOAL-QL-06 (chốt kỳ theo lô), US-GOAL-QL-12 (nhắc check-in + catalog NOTI), US-GOAL-QL-95 (mục tiêu cá nhân tự đo việc được giao; hoãn tới khi đo 2–4 tuần, Q30).
- **WO red đề xuất ngoài story:** một migration sửa template `target_url` để thông báo mở đúng bản ghi (nhắc hạn → việc, đơn nghỉ → `?request=`, bình luận → `comment_id`), xem Q7.
- **Phụ thuộc:** quyết định owner ở §7. GOAL-QL-05 chỉ làm sau khi đo QL-04. GOAL-QL-12 chỉ làm sau khi QL-01 đã chạy 2–4 tuần.
- **Cỡ:** 7 story (3 M + 4 L), gồm US-GOAL-QL-95 đang hoãn.

---

## 7. Câu hỏi cần owner quyết

| # | Câu hỏi | Phương án | Khuyến nghị | Story |
| --- | --- | --- | --- | --- |
| Q1 | Có cho mọi nhân viên tra danh bạ tối thiểu toàn công ty để nhắn tin? | (A) Không, giữ `read:employee` theo scope · (B) Endpoint riêng của CHAT, 4 trường, gate cặp chat sẵn có · (C) Nới `read:employee` | **B**, ghi vào permission-matrix và SPEC-15 | CHAT-NV-03 (liên quan NV-12, NV-91, X-07) |
| Q2 | Mở ngoại lệ CHAT-DEC-010 bằng @cả phòng? Ai có tư cách? | (A) Không · (B) Có, tư cách theo loại phòng (group: admin; department: `update:org_unit` đơn vị neo; project: quản lý dự án), 15 phút/phòng, tái dùng `CHAT_MENTIONED` | **B**, ghi CHAT-DEC mới vào §22 trước khi code | CHAT-QL-09 |
| Q3 | Ai được ghim tin trong phòng phòng ban/dự án (hiện 0 admin nên không ai ghim được)? | (A) Giữ nguyên · (B) Cùng luật tư cách theo loại phòng như Q2 | **B**, cùng một CHAT-DEC với Q2 | CHAT-NV-08, CHAT-QL-09 |
| Q4 | Cho tạo việc từ tin nhắn? Lưu liên kết hai chiều bền tin ↔ việc? | (A) Chỉ chép văn bản + link `?msg=` vào mô tả · (B) Thêm bảng nối (migration) | Cho phép (không trái CHAT-DEC-009); **A** ở đợt này, B là WO red sau khi đo mức dùng | CHAT-NV-10 |
| Q5 | Back trình duyệt có chuyển giữa các phòng chat không? | (A) `replace` khi chọn phòng (Back rời /chat) · (B) `push` (Back qua lại giữa các phòng) | **A**, tránh kẹt vòng lịch sử | CHAT-NV-01 |
| Q6 | Thêm người giao việc (reporter/người tạo) vào người nhận `TASK_OVERDUE`? | (A) Chỉ người phụ trách · (B) + reporter/người tạo của chính việc | **B**, không suy «quản lý» từ sơ đồ tổ chức; chưa chốt thì sửa cột trước | TASK-NV-06 |
| Q7 | Sửa template `target_url` để thông báo mở đúng bản ghi? | (A) Giữ đích danh sách · (B) Một WO migration: nhắc hạn → `/tasks/{taskId}`, đơn nghỉ → `/leave/approvals?request={id}`, bình luận kèm `comment_id` | **B**, sau Đợt 1 (cần drawer `?task=` và `?request=`) | TASK-NV-06, TASK-NV-11, X-03, X-14 |
| Q8 | Ai được tắt cờ «checklist bắt buộc»? | (A) Mọi người có `update:task`, kèm lịch sử hoạt động · (B) Chỉ Owner/Manager dự án (red) | **A** cho v1; B nếu thấy bị lạm dụng | TASK-QL-12 |
| Q9 | Owner/Manager dự án xem Báo cáo dự án mình mà không cần `view-report:project`? | (A) Không · (B) Có, chỉ tab Báo cáo · (C) Admin cấp cặp cho vai trò trưởng nhóm qua cấu hình role | **B**; tab Hoạt động giữ DECISIONS-04 mục 3 | TASK-QL-14 |
| Q10 | QL có thêm người khác vào danh sách theo dõi việc được không (hiện chỉ tự theo dõi)? | (A) Giữ · (B) Cho người có `assign:task` thêm watcher (red) | Đo sau Đợt 1; nếu QL vẫn phải @ nhiều thì B | (chưa thành story) |
| Q11 | Mặc định trạng thái khi tạo mục tiêu trên form? | (A) Draft cho mọi cấp · (B) Active cho cấp Nhân viên, Draft cho Phòng/Dự án | **B** (SPEC không chốt; không có phê duyệt) | GOAL-NV-01 |
| Q12 | BE trả cờ quyền theo bản ghi (`canUpdate`) cho mục tiêu? | (A) Chưa, gate theo cặp + rollback khi 403 · (B) Có (amber) | **A** | GOAL-NV-02, GOAL-QL-11 |
| Q13 | Chấp nhận tạo việc rồi gắn mục tiêu không nguyên tử? | (A) Hai lời gọi, lỗi bước 2 có «Thử gắn lại» · (B) `POST /tasks` nhận `goalId` (amber) | **A** | GOAL-NV-08 |
| Q14 | Cho người có `view:goal` thấy tên hiển thị người phụ trách/người check-in khi không có `read:employee` với họ? | (A) Không · (B) Có, chỉ tên hiển thị (như `assigneeName` của task) | **B** | GOAL-QL-01 |
| Q15 | Công thức «Chậm/Rủi ro»? | (A) % < % thời gian − 15 điểm; tự tin < 50; manual quá 14 ngày không check-in · (B) % < 80% kỳ vọng sau khi kỳ trôi ≥15%; tự tin < 40 | **A** + điều kiện «kỳ đã trôi ≥15%» của B để không báo động đầu kỳ; hằng số đặt tên; ghi vào SPEC-10 §8 | GOAL-QL-02, GOAL-QL-12 |
| Q16 | Thêm endpoint tạo mục tiêu theo lô? | (A) Chỉ prefill + «Lưu và thêm tiếp» · (B) `POST /goals/batch` nguyên tử, trần 50 | **A** trước, đo; B nếu vẫn chậm | GOAL-QL-05 |
| Q17 | Chốt kỳ theo lô chạy «tất cả hoặc không» hay «từng dòng»? | (A) Tất cả hoặc không · (B) Mỗi mục một transaction, báo dòng hỏng | **B** | GOAL-QL-06 |
| Q18 | Kéo nhắc check-in + cảnh báo «Chậm» (SPEC-10 §5.2 đang hoãn) vào bây giờ? | (A) Có ngay · (B) Sau khi nhãn «Cần check-in» chạy 2–4 tuần | **B**; nếu làm thì sửa SPEC-10 §5.2/§17 cùng WO | GOAL-QL-12 |
| Q19 | Cần `GET /goals/project-coverage` như done_when cũ của S7-GOAL-PROJTAB-1? | (A) Tab trước bằng bộ lọc sẵn có, coverage sau · (B) Làm cả hai một lần | **A** | GOAL-QL-10 |
| Q20 | Phản hồi gắn thẳng vào check-in (bảng bình luận mới)? | (A) Phương án chat (QL-13) · (B) Bảng bình luận (red) | **A** trước, đo nhu cầu | GOAL-QL-13 |
| Q21 | Khối «Hôm nay» đặt ở đâu? | (A) Đầu /me + ô «Hôm nay» trên Home dẫn tới /me · (B) Nâng dashboard Employee (hàng bấm được của X-03 + khối FE «Mục tiêu cần check-in» + tôn trọng `defaultLanding`), không dựng khối mới, không seed widget | **B**: tái dùng widget có gate/scope, tránh hai bề mặt lệch nhau. Story X-08 đã viết sẵn cả hai biến thể kèm luồng từng bước (A: 2 thao tác; B: 4, hoặc 3 với `defaultLanding`); **chốt trước khi gieo WO Đợt 1A** | X-08 (B gộp WO với X-03) |
| Q22 | Hộp «Chờ tôi xử lý» là widget FE hay widget BE có mã riêng? | (A) Khối FE trên dashboard Manager · (B) Mã widget BE + seed (red) | **A** | X-14 |
| Q23 | Widget lịch nghỉ cấp đội hiển thị loại nghỉ thế nào? | (A) Như server đang trả · (B) Cấp đội chỉ thấy «Nghỉ» + khoảng ngày, loại cụ thể chỉ cho người duyệt (che ở server, WO riêng) | **B** nếu có loại nhạy cảm (ốm, thai sản); FE hiển thị đúng thứ server trả | X-09 |
| Q24 | Dashboard Manager mặc định có «Việc của tôi» (MY_TASKS)? | (A) Giữ · (B) Thêm (cần xác minh cơ chế áp cấu hình mặc định; nếu là seed DB thì red) | **B**: QL cũng là người làm việc | (chưa thành story) |
| Q25 | Đưa lượt đếm KPI thao tác (§4) thành E2E chạy trong CI? | (A) Lượt Playwright MCP với API giả lập, script lưu ở plan WO, chạy tay trước khi mở PR · (B) Thêm `@playwright/test` (dev-dep, ghim phiên bản) vào `apps/app` + job CI chạy các kịch bản KPI với API giả lập | **A** ngay từ Đợt 1A (không đổi deps); **B** thành WO riêng sau Đợt 1A, khi đã có ≥5 kịch bản ổn định | §4 (DoD chung), mọi story có dòng KPI |
| Q26 | Hiện dấu «đang nghỉ» trên roster/DM chat cho mọi đồng nghiệp? | (A) Không; chỉ trong picker giao việc cho người có `view-team:leave-calendar` · (B) Có, chỉ «Vắng đến dd/MM» không loại nghỉ, qua trường dẫn xuất ở server (nới phạm vi đọc dữ liệu nghỉ: red) | **A**; xét B sau khi đo QL-92 | TASK-QL-92 (liên quan CHAT-NV-02) |
| Q27 | Khi tạo việc mà hệ thống tìm ra đúng MỘT mục tiêu phù hợp (đang chạy trong kỳ, đo theo việc gắn), có tự chọn sẵn không? | (A) Không chọn sẵn, chỉ hiện chip hoặc toast «Gắn vào ‹G›?» một chạm (4 thao tác) · (B) Chọn sẵn CHỈ khi đó là mục tiêu cá nhân của chính người tạo (người được giao = người phụ trách = tôi); các trường hợp khác dùng chip (3–4 thao tác) · (C) Luôn chọn sẵn khi có đúng 1 ứng viên (3 thao tác, nhưng nhân viên dễ gặp lỗi «không có quyền» ở bước gắn) | **B. Đây là trường hợp duy nhất giao diện chắc chắn server cho ghi. Ô luôn hiện, toast có «Gỡ», audit ghi người bấm, nên vẫn đúng nguyên tắc «có dấu vết và đường gỡ».** | US-GOAL-NV-92 |
| Q28 | Việc con có mặc định «Tính vào mục tiêu của việc cha» không? (cách đo theo việc gắn đếm từng việc, nên cha và con cùng gắn thì đều được đếm) | (A) Đề xuất, ô KHÔNG chọn sẵn, 1 chạm để bật (6→4) · (B) Chọn sẵn khi việc cha đang gắn (6→3) · (C) Không làm | **A. Tránh làm lệch % mà người dùng không để ý. Đo tỉ lệ bật ô trong 2–4 tuần rồi mới xét B.** | US-GOAL-NV-93 |
| Q29 | Khi giao lại người phụ trách, liên kết vào mục tiêu cá nhân của người CŨ xử lý thế nào? | (A) Giao diện hỏi tại chỗ (Chuyển/Gỡ/Giữ); tab mục tiêu đánh dấu liên kết lệch cho quản lý; server giữ nguyên · (B) Server tự gỡ liên kết lệch trong cùng thao tác giao việc, ghi audit kèm lý do (amber: tự đổi số đánh giá) · (C) Giữ như hiện nay | **A ở Đợt 1B. Chỉ xét B nếu sau 1 kỳ vẫn còn nhiều liên kết lệch không ai xử lý; lưu ý nhân viên không tự thấy được những việc đã bị giao đi.** | US-X-94 |
| Q30 | Có muốn mục tiêu CÁ NHÂN tự đo mọi việc người đó được giao trong kỳ (tự động như «Theo dự án» của mục tiêu dự án)? | (A) Không; mục tiêu cá nhân vẫn đo theo việc được gắn, dựa vào gợi ý, điền sẵn và gắn hàng loạt · (B) Thêm cách đo «Theo việc được giao trong kỳ» (đổi DB + ADR + review đầy đủ, Đợt 3) | **A trước. Mục tiêu cá nhân nên đo kết quả, không đo khối lượng việc. Đo số lần gắn tay sau NV-92/QL-94 trong 2–4 tuần; nếu vẫn cao mới làm B.** | US-GOAL-QL-95 |
| Q31 | Mục tiêu cấp dự án có mặc định đo «Theo dự án» không? (tự tính mọi việc của dự án, 0 thao tác gắn, nhưng tính toàn bộ dự án, KHÔNG giới hạn theo kỳ) | (A) Mặc định «Theo dự án» khi tạo, có dòng giải thích rõ; không áp nếu dự án đã có mục tiêu đo theo dự án trùng kỳ · (B) Giữ mặc định «Thủ công», chỉ thêm gợi ý «Chọn Theo dự án để tự tính» · (C) Giữ như hiện nay | **A. Đây là liên kết tự động có sẵn mạnh nhất. Người tạo thấy rõ lựa chọn và đổi được, mỗi lần đổi đều có tính lại + audit; mục tiêu đang có không bị đổi.** | US-GOAL-QL-93 |

---

## 8. Phụ lục

### 8.1 Story bị loại

| Id | Tiêu đề | Lý do |
| --- | --- | --- |
| US-TASK-NV-14 | Báo vướng / xin dời hạn bằng một nút | Tiền đề sai. `TASK_COMMENT_CREATED` đã tới assignee ∪ reporter ∪ watchers, nên bình luận thường không cần @ vẫn tới người giao. Đường hiện tại 3 thao tác, ít hơn mục tiêu 4 của story. Cờ «vướng» có cấu trúc là red; gieo WO riêng nếu owner muốn. |

### 8.2 Cơ hội phản biện chỉ ra và cách xử lý

| Cơ hội | Xử lý |
| --- | --- |
| Bấm thông báo chat khi ở trang khác thì mở drawer tại chỗ | Gộp vào US-CHAT-NV-01 (cùng US-X-01) |
| Hệ toast/live-region dùng chung | Thành **US-X-91** |
| Ghim/bỏ ghim không phát realtime | Đưa vào US-CHAT-NV-08 (phần BE emit) |
| Trưởng đơn vị/quản lý dự án không ghim được ở phòng phòng ban/dự án | Câu hỏi Q3 (red); làm cùng WO với CHAT-QL-09 khi chốt |
| Tạo cuộc trò chuyện mới ngay trong drawer | Thành **US-CHAT-NV-91** |
| Đổi cột trên board khi dùng điện thoại | Thành **US-TASK-NV-91** |
| Cảnh báo người được giao đang nghỉ/không phải thành viên | Thành **US-TASK-QL-91** |
| Đính kèm nhiều tệp, kéo-thả, dán ảnh | Thành **US-TASK-NV-92** |
| QL thêm người khác vào danh sách theo dõi | Câu hỏi Q10 (red), chưa thành story |
| Check-in nhanh trên dòng /goals | Thành **US-GOAL-NV-91** |
| Nhãn widget «Mục tiêu kỳ này» | Thành **US-GOAL-QL-91** (tách khỏi công thức rủi ro) |
| Cây mục tiêu thu gọn/mở rộng | Thành **US-GOAL-QL-92** |
| Cảnh báo việc đổi dự án mà vẫn gắn mục tiêu dự án cũ (SPEC-10 §13.3) | Chưa thành story. Ứng viên đợt sau (FE yellow, cảnh báo mềm + «Tháo khỏi mục tiêu»); cần đo luồng đổi dự án trong `TaskGoalField` trước |
| Thông báo đơn nghỉ mở đúng đơn | Phần FE (`?request=`) trong US-X-03; phần template là Q7 |
| Thông báo nhắc hạn mở đúng việc | Q7 (migration template, red) |
| Dashboard Manager mặc định thiếu MY_TASKS | Q24 |
| *(Soát độ phủ 23/10)* X-08 chưa build được vì cơ chế lệch khuyến nghị Q21 | X-08 viết lại hai biến thể A/B, mỗi biến thể có luồng từng bước; chuyển lên Đợt 1A (chỉ FE), B gộp WO với X-03 |
| *(Soát độ phủ 23/10)* Thiếu nền «giờ công ty» cho FE; các story lệch nhau (cứng múi, sai đường dẫn, «FE chưa có timezone») | Thành **US-X-92**; TASK-NV-01/08, GOAL-NV-01/04, GOAL-QL-03/04/07 trỏ về helper; sửa đường dẫn `routes/rooms/room-time.ts` |
| *(Soát độ phủ 23/10)* TASK và GOAL chưa có story cho web di động | Thành **US-X-93** (đo ở 375px) |
| *(Soát độ phủ 23/10)* Tuỳ chọn toast và xem trước chat chưa nói lưu ở đâu | Ghi rõ trong X-06 và CHAT-NV-09: `localStorage` theo `userId`, chỉ là tuỳ chọn hiển thị, hỏng thì mặc định an toàn; không thêm cột `user_preferences` (red) |
| *(Soát độ phủ 23/10)* Bàn giao khi nghỉ phép chỉ có góc QL và chỉ phát hiện sau khi giao | Thành **US-TASK-NV-93** (NV tự bàn giao từ đơn nghỉ) và **US-TASK-QL-92** (lối từ đơn đang duyệt + dấu nghỉ trong picker); dấu nghỉ trên chat là Q26 |
| *(Soát độ phủ 23/10)* Số «Sau» của CHAT-NV-91/NV-12 không đúng với NV thường (danh bạ Own) | Tách số theo trường hợp, thêm phụ thuộc mềm CHAT-NV-03 |
| *(Soát độ phủ 23/10)* KPI §4 không có cách kiểm sau khi ship | DoD chung «Cách kiểm KPI» ở §4 (lượt đếm trong trình duyệt với API giả lập); E2E trong CI là Q25 |
| *(Soát độ phủ 23/10, mức thấp)* /goals chưa có ô tìm theo tên/mã mục tiêu; QL nhiều mục tiêu phải cuộn hoặc lọc tay | Chưa thành story. Ứng viên gộp vào WO của US-GOAL-QL-03 (bộ lọc trên URL) khi gieo, kiểm BE `listGoals` có tham số tìm chưa trước khi ước cỡ |

### 8.3 Gộp story (25 lần)

| Từ | Vào | Ghi chú |
| --- | --- | --- |
| US-CHAT-QL-01, US-X-01 | US-CHAT-NV-01 | Deep-link + drawer tại chỗ + ⤢ |
| US-CHAT-QL-02 | US-CHAT-NV-04 | Mở tại tin chưa đọc |
| US-CHAT-QL-04 | US-CHAT-NV-02 | Nhắn riêng từ roster/avatar |
| US-CHAT-QL-05 | US-CHAT-NV-08 | Thanh ghim |
| US-CHAT-QL-06 | US-CHAT-NV-05 | Đọc hết |
| US-CHAT-QL-07, US-X-10 | US-CHAT-NV-10 | Tạo việc từ tin |
| US-CHAT-QL-08 | US-CHAT-NV-11 | Nút Thảo luận |
| US-CHAT-QL-10 | US-CHAT-NV-09 | (N) + toast |
| US-CHAT-QL-11 | US-CHAT-NV-13 | Phím tắt |
| US-CHAT-QL-13 | US-CHAT-NV-12 | Tạo nhóm nhanh |
| US-CHAT-QL-14 | US-CHAT-NV-06 | Giữ nháp |
| US-TASK-NV-07 | US-TASK-QL-01 | Thông báo giao việc |
| US-TASK-NV-12 | US-TASK-QL-05 | Bộ lọc URL + tìm |
| US-TASK-QL-02 | US-TASK-NV-06 | Job nhắc hạn |
| US-X-02 | US-TASK-NV-04 | Drawer việc toàn cục |
| US-TASK-NV-09 | US-X-04 | Quick action/lối tắt (dòng widget bấm được sang US-X-03) |
| US-GOAL-NV-05 | US-GOAL-QL-03 | URL + «Của tôi» |
| US-GOAL-NV-06 | US-GOAL-QL-14 | Tab Công việc gắn |
| US-GOAL-NV-09 | US-GOAL-QL-02 | Cờ Chậm |
| US-GOAL-NV-10, US-GOAL-NV-13 | US-GOAL-QL-01 | Một lần đổi DTO đọc |
| US-GOAL-NV-11 | US-GOAL-NV-02 | Gợi ý Hoàn thành |
| US-GOAL-NV-14 | US-GOAL-QL-12 | Nhắc check-in |

### 8.4 Đối chiếu WO backlog liên quan (đo 23/10/2026)

| WO | Trạng thái trong sổ | Thực tế đo | Ảnh hưởng tới S20 |
| --- | --- | --- | --- |
| S17-CHAT-RTROOMOPS-1 | — | Đã merge #601 `32db6308` (23/10) | Hết nguy cơ đụng file CHAT với CHAT-NV-01/06, GOAL-QL-13 |
| S4-DASH-HROVERVIEW-FLOOR-1 | — | Đã merge #599 `c8aec03b` (23/10) | Nợ N6: tách `dashboard-widget-handlers.service.ts` (792/800 dòng) trước GOAL-QL-02 |
| S4-DASH-SIBLINGFLOOR-1 | gieo 23/10 (nợ N3) | Chưa làm | X-09 không đụng EMPLOYEE_SUMMARY/NEW_EMPLOYEES |
| S4-DASH-WIDGETCARD-VARIANT-1 | todo, amber | Chung `components/dashboard/**` | Xếp thứ tự hoặc gộp với X-03, X-09, GOAL-QL-91 |
| S16-SOCIAL-FILEOPENUX-1 | đang làm | Điều kiện merge O5 | TASK-NV-92 chỉ làm phần tải lên, không đụng mở tệp |
| S19-OPS-STORAGEPUBLIC-1 | blocked | #583 đã merge, chưa chuyển PROD | Ảnh/tệp chat và TASK-NV-92 chỉ chạy với người ở máy khác sau khi xong |
| S7-GOAL-PROJTAB-1 | **done** | **Mã không có** (chỉ commit kế hoạch `984dfa24`) | GOAL-QL-10 mở lại WO này, không gieo WO mới |
| S5-GOAL-TPL-1 | — | Màn mẫu có route nhưng không có lối vào | GOAL-QL-08 |
| S5-TASK-BOARD-UX-1 | — | Khuôn drawer `?task=` của board dự án | TASK-NV-04 mở rộng ra toàn ứng dụng |
| S17-CHAT-UX2 (G14) | đã ship một phần | Chỉ có Esc + Ctrl/⌘+Shift+F | CHAT-NV-13 làm nốt |
| S8-CHAT-UX, S17-CHAT-UX2 | đã ship | — | Không story nào viết lại phần đã có |
