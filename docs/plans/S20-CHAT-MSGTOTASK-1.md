# S20-CHAT-MSGTOTASK-1 — Tạo việc từ một tin nhắn ngay trong phòng chat

Zone vàng · gate LIGHT · story US-CHAT-NV-10 (gộp US-CHAT-QL-07, US-X-10) · Q4 = A (chỉ chép văn bản +
link `?msg=`, không bảng nối) · Q25 = A.

## Quyết định chính

1. **Một form duy nhất.** `TaskFormDrawer` nhận 5 prop ADDITIVE (thêm `describedById` ở gate review), chỉ có nghĩa ở chế độ TẠO:
   `initialValues` (trộn vào giá trị mặc định ⇒ form vẫn «chưa sửa», hủy không hỏi lại — S20-GOAL-LINKEDTASKS-1
   dùng lại prop này) · `defaultAssigneeMe` (điền «Tôi» kể cả khi có dự án — luật cũ chỉ điền khi không có
   dự án) · `beforeFields` / `afterFields` (khe cho cảnh báo + ô «Gửi link việc vào phòng"). Guard, lỗi
   `submitErrorKey`, lỗi tại ô người phụ trách, invalidation board — dùng lại nguyên.
2. **Cổng quyền** ở `MessageActions`: `useCan(TASK_CORE_ENGINE_PAIRS.CREATE)` + caller phải truyền
   `onCreateTask`. Tin `system` (nhánh vẽ riêng) và tin thu hồi không vẽ thanh tác vụ (có sẵn) ⇒ không có mục. Menu ⋯ giờ hiện khi có chữ ĐỂ CHÉP **hoặc** tạo được việc (tin chỉ có tệp vẫn tạo việc được).
3. **Điền sẵn** (`components/chat/message-to-task.ts`, hàm thuần): tiêu đề = dòng đầu không rỗng, cắt
   ≤120 ký tự theo code point; tin chỉ có tệp ⇒ trống (schema bắt nhập). Mô tả = văn bản tin + «Từ tin nhắn
   của <người gửi> lúc <dd/MM HH:mm>» + `<origin>/chat/<room>?msg=<id>`. CHỈ đọc `message.body` — không
   bao giờ đọc `attachments` ⇒ không URL ký / objectKey / tên tệp.
4. **Dự án** = `room.refId` khi `roomType === "project"` (option riêng mang tên phòng nếu danh sách dự án
   chưa có). Phòng khác (direct/group/department) ⇒ dự án trống + cảnh báo nổi bật «Nội dung tin sẽ hiển
   thị cho những ai xem được việc này».
5. **Lưu xong** ⇒ đóng hộp, vẫn ở phòng, toast «Đã tạo việc» kèm hành động «Mở» = `useTaskDrawer().openTask`
   (drawer việc mở chồng trên trang hiện tại, 0 chuyển trang). Lưu lỗi ⇒ hành vi sẵn có của form (giữ dữ
   liệu, không đóng, banner theo `submitErrorKey`).
6. **Gửi link vào phòng**: checkbox mặc định TẮT; bật ⇒ sau khi tạo thành công gửi đúng MỘT tin có thân
   `<origin>/tasks/<id>` qua `submit` của `ConversationPanel` (cùng đường gửi/thử lại như ô soạn). Phòng lưu
   trữ ⇒ không có checkbox.
7. **Link `?msg=` cho người không phải thành viên**: S20-CHAT-DEEPLINK-1 đã xử lý — `ChatPage.tsx` (toast
   `deepLink.unavailable` = «Không mở được cuộc trò chuyện này»), test `routes/chat/ChatPage.deeplink.spec.tsx`.
   Không làm lại.
8. **Esc**: `ConversationPanel` nhường Esc khi hộp tạo việc mở (không thì một Esc vừa đóng hộp vừa hủy trả lời).

## Ánh xạ done_when → test

| done_when | Test |
| --- | --- |
| Mục chỉ khi `create:task`; ẩn tin thu hồi / hệ thống | `MessageActions.spec.tsx` (deny trước) |
| Điền sẵn tiêu đề/mô tả/dự án/«Tôi»; tin chỉ có tệp; phòng direct cảnh báo | `MessageToTaskDialog.spec.tsx` |
| Chưa lưu tới khi Lưu; lưu xong toast + «Mở»; lưu lỗi giữ dữ liệu | `MessageToTaskDialog.spec.tsx` |
| Chỉ chép văn bản; gửi link mặc định tắt / bật chỉ gửi `/tasks/<id>` | `MessageToTaskDialog.spec.tsx` |
| `initialValues` + `defaultAssigneeMe` additive | `TaskFormDrawer.spec.tsx` |
| KPI #6 đếm thao tác | `MessageToTaskDialog.spec.tsx` ca «KPI #6» |

## KPI #6 (đếm bằng `fireEvent` trong jsdom — kho không có `@testing-library/user-event`)

Xuất phát phòng dự án đang mở, tin có chữ: ⋯ (1) → «Tạo việc» (2) → «Tạo» (3) = **NV tự nhận 3 thao tác**
(≤5). QL giao người khác: + chọn người ở ô người phụ trách (4) = **4 thao tác** (≤7). 0 chuyển trang (hộp
mở chồng, lưu xong vẫn ở phòng). Deny-path: thiếu `create:task` ⇒ không có mục.

Đo trình duyệt thật: **chưa**, để luồng chính/owner (Cách kiểm KPI §4).

## Gate review 06/11

Đã vá (3):
1. [MEDIUM] Focus rơi về `body` khi đóng hộp mở từ menu ⋯ — `MessageActions` đưa focus về nút ⋯ TRƯỚC khi
   mở hộp (`Dialog` ghi phần tử kích hoạt = nút ⋯); `ConversationPanel` đưa focus về ô soạn nếu nút đã mất
   (tin bị thu hồi). Test: `ConversationPanel.spec` «Huỷ hộp ⇒ focus quay về nút ⋯» (đã thử bỏ vá ⇒ đỏ).
2. [MEDIUM] Hộp giữ ảnh chụp tin — `ConversationPanel` tra tin hiện tại từ store và chuyền `sourceRecalled`
   (xem lượt 2). Test: «tin bị THU HỒI qua realtime».
3. [LOW] Cảnh báo không được đọc khi mở hộp — prop additive `describedById` của `TaskFormDrawer` gắn
   `aria-describedby` của hộp tới cảnh báo (không sửa packages/ui). Test: `MessageToTaskDialog.spec` nhóm
   «trợ năng cảnh báo».

Lượt 2 (review hẹp bản vá `8405d918`):
4. [MEDIUM] Thu hồi TRONG LÚC đang gửi — cha không còn gỡ hộp; hộp nhận `sourceRecalled` + biết mình đang
   gửi (prop additive `onBusyChange` của `TaskFormDrawer`). Chưa gửi ⇒ đóng + `toTask.sourceGone`; đang gửi ⇒
   chờ: thành công ⇒ KHÔNG gửi link, toast cảnh báo `toTask.createdSourceRecalled` kèm «Mở»; lỗi ⇒ đóng +
   `sourceGone`. Test: «thu hồi TRONG LÚC đang gửi» (đã thử bỏ vá ⇒ đỏ).
5. [LOW] Tin bị cắt khỏi bộ nhớ bị coi như thu hồi — chỉ coi là thu hồi khi tin CÒN trong store và
   `recalledAt !== null`; không thấy ⇒ giữ hộp với bản chụp lúc mở. Drawer chat dùng chung một panel khi đổi
   phòng ⇒ hộp gắn `roomId`, đổi phòng thì bỏ. Test: «tin bị CẮT khỏi bộ nhớ».
6. [LOW] Thêm ca focus sau khi LƯU XONG ⇒ nút ⋯.

Bị bác (4): theo phán quyết đối kháng của luồng chính — không đổi code.

## Lệch paths (tối thiểu)

- `components/chat/MessageBubble.tsx` — chuyền `onCreateTask` (tuỳ chọn) xuống `MessageActions`.
- `components/chat/ConversationPanel.tsx` — giữ tin nguồn, mount hộp, gửi link qua `submit`, nhường Esc.
- `components/chat/message-to-task.ts` — hàm điền sẵn thuần (glob `MessageToTask*.tsx` không nhận `.ts`).

## Nợ

- **Chặn thu hồi ở SERVER** (đề xuất WO riêng): tạo việc kèm id tin nguồn, server từ chối nếu tin đã thu
  hồi. Client không thấy được thu hồi xảy ra SAU khi server đã ghi việc nhưng TRƯỚC khi WS báo về.

- Đo KPI #6 trong trình duyệt thật với API giả lập (owner/luồng chính).
- Phòng `department` có thể điền sẵn phòng ban (`refId`) — chưa làm, chờ đo mức dùng.
- Liên kết hai chiều bền việc ↔ tin = WO đỏ riêng (Q4 = A).
