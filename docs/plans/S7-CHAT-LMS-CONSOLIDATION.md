# Hợp nhất chat: gỡ chat khỏi LMS → module CHAT chung của MediaOS

> **Trạng thái:** đánh giá + đề xuất, **chờ owner chốt 1 mục** (§4).
> Owner ra hướng 2026-08-04: _"chuyển hết phần LMS ra, trong LMS sẽ không còn nữa mà chuyển thành module
> chat chung; tối ưu và kế thừa các tính năng hiện có để làm cho nhanh"_.
> Tài liệu này **đo trước khi đề xuất** — và số đo làm đổi khuyến nghị so với đề bài.

---

## 1. Số đo — đọc mục này trước

Nguồn: `apps/lms/data/app.db` (**SQLite**, DB RIÊNG của LMS — không phải Postgres của MediaOS),
đo ngày **2026-08-04**.

| Bảng | Số hàng |
| --- | --- |
| `direct_message_threads` | **6** |
| `direct_message_thread_members` | 12 |
| `direct_message_messages` | **84** |
| `direct_message_calls` | 24 (48 người tham gia) |
| `direct_message_polls` · `direct_message_poll_votes` · `direct_message_poll_events` | **0 · 0 · 0** |
| `direct_message_reactions` | **0** |
| `user_stickers` | **0** |

Mức độ dùng theo thời gian:

| | 2026-05 | 2026-06 | 2026-07 |
| --- | --- | --- | --- |
| Tin nhắn | 40 | 30 | 14 |
| Cuộc gọi (tổng / kết nối được) | 23 / 13 | 0 | 1 / 1 |

- **4** người gửi riêng biệt trong toàn bộ lịch sử.
- Tin gần nhất: **2026-07-24** — đúng ngày LMS chuyển SSO-only; im lặng 10 ngày qua.
- ⚠️ `chat_messages` (19 hàng) **KHÔNG** thuộc chat này — đó là **trợ lý AI**
  (`role`/`citations_json`/`confidence`, route `/api/chat`, màn `/ai-assistant`). Nó **Ở LẠI LMS**.

**Kết luận đọc được từ số:** chat LMS là **hàng thử nghiệm chưa vào đời sống thật** — 4 người, 84 tin
trong 3 tháng, xu hướng giảm, và toàn bộ nhóm tính năng "phong phú" (thăm dò · thả cảm xúc · sticker)
**chưa ai chạm một lần nào**.

---

## 2. Vì sao KHÔNG nên "kế thừa" 14.500 dòng

`apps/lms/components/chat/**` = **14.488 dòng** FE + một mặt API riêng (threads · members · mute ·
polls · read · search · stickers · presence · calls + ICE config).

Port khối đó sang MediaOS là **làm việc suy đoán**: nó dựng lại hạ tầng cho những tính năng có **0**
người dùng, và mỗi tính năng port sang đều kéo theo bảng mới + cặp quyền mới + RLS + audit + test
deny-path ở phía MediaOS (nơi kỷ luật cao hơn LMS nhiều).

Đối chiếu từng nhóm:

| Nhóm tính năng LMS | Dùng thật | MediaOS CHAT v1 | Đề xuất |
| --- | --- | --- | --- |
| Nhắn 1-1 / nhóm · trả lời · ghim · thu hồi · đã đọc · tìm kiếm · đính kèm | ✅ 84 tin | **Đã có đủ** | Không làm gì thêm |
| Tắt thông báo phòng (`mute`) | — | CHAT-FUNC-015 đã thiết kế, chưa dựng UI | Gộp vào FE-3/FE-4, rẻ |
| Chuyển tiếp tin · tin thoại · media dùng chung | không đo được riêng | ✗ | **Hoãn** — chờ nhu cầu thật |
| Thăm dò (poll) | **0** | ✗ | **KHÔNG port** |
| Thả cảm xúc (reaction) | **0** | ✗ (SPEC-15 §5.2 ngoài v1) | **KHÔNG port** |
| Sticker | **0** | ✗ | **KHÔNG port** |
| Presence / đang gõ | — | ✗ (SPEC-15 §5.2 ngoài v1) | **KHÔNG port** |
| **Gọi thoại/hình** | ✅ 14 cuộc kết nối được | ✗ (**§5.2: "ngoài phạm vi SẢN PHẨM"**) | **Cần owner chốt — §4** |

⇒ "Tối ưu để làm cho nhanh" ở đây nghĩa là **làm ít hơn đề bài**, không phải port nhanh hơn.

---

## 3. Ba việc thật sự cần làm

### 3.1 Gỡ chat khỏi LMS + trỏ lối vào sang MediaOS

- `apps/lms/components/sidebar/app-sidebar.tsx:163` — mục "Trò chuyện" → `/chat` của LMS.
- Đổi thành liên kết sang `/chat` của MediaOS (cùng tab; MediaOS tự chặn quyền khi tới — đúng chốt
  owner 2026-07-25).
- Gỡ `apps/lms/app/(app)/chat/**` + `components/chat/**` (trừ phần **trợ lý AI**) + các route
  `app/api/messages/**`, `app/api/polls/**`.
- ⚠️ `apps/lms` có **repo git RIÊNG** — commit vào repo local trong `apps/lms`, không vào MediaOS.
- ⚠️ `next build` của LMS **ghi chung `dist` với PROD** — không build LMS trong lúc PROD đang chạy.

### 3.2 Xử lý 84 tin lịch sử

Không dựng đường di trú SQLite → Postgres cho 84 tin của 4 người: chi phí (map user LMS→MediaOS,
attachment, FTS, quyền) không tương xứng. Đề xuất **xuất ra tệp lưu trữ** (JSON/CSV) giao owner giữ,
rồi khoá bảng cũ. Ai cần tra thì tra tệp.

### 3.3 Phần còn lại của wave CHAT giữ nguyên

`S7-CHAT-FE-3` (panel nổi · badge header · lối vào sidebar) · `FE-4` (tìm kiếm + tab Tệp) · `FE-5`
(đọc-vượt) · `QA-1` · `BE-8` (presign đính kèm — xem `S7-CHAT-FE-2` §0.1). Việc gỡ LMS **không** chặn
mấy WO này; nó chỉ thay phần "lối vào LMS" trong `done_when` của FE-3.

---

## 4. 🔴 MỘT mục chờ owner chốt: cuộc gọi thoại/hình

Đây là tính năng DUY NHẤT có người dùng thật mà MediaOS không có (14 cuộc kết nối được, chủ yếu 05/2026;
1 cuộc trong 07/2026). Nếu gỡ chat LMS mà không làm gì thêm thì **tính năng gọi biến mất**.

Làm nó ở MediaOS **không phải là port UI** — nó đụng hai thứ đã đóng đinh:

1. **SPEC-15 §5.2** ghi cuộc gọi thoại/hình là _"Ngoài phạm vi sản phẩm"_ (không phải "hoãn"). Muốn làm
   thì owner phải ký sửa SPEC — SPEC là nguồn sự thật, không sửa lén trong code.
2. **CHAT-DEC-005 / §3.5: _"Client không bao giờ ghi qua WebSocket"_.** WebRTC signalling **bắt buộc**
   hai chiều (offer/answer/ICE candidate). Đây là **bất biến kiến trúc vùng đỏ**: nới nó ra là mở đường
   ghi qua WS cho toàn hệ thống, phải qua ADR + FULL gate, không phải một WO FE.

Thêm nữa: gọi cần **TURN/STUN server** (LMS có `/api/messages/calls/ice-config`) — hạ tầng vận hành mới,
không chỉ là code.

**Ba lựa chọn:**

| | Nội dung | Chi phí |
| --- | --- | --- |
| **A. Bỏ tính năng gọi** *(khuyến nghị)* | Gỡ chat LMS, không làm gọi ở MediaOS. 14 cuộc/3 tháng của 4 người — dùng Zalo/Meet như hiện tại cho việc gọi. | 0 |
| **B. Hoãn có chủ đích** | Gỡ chat LMS ngay, ghi "gọi" thành WO Phase sau + sửa SPEC-15 §5.2 từ "ngoài phạm vi sản phẩm" → "phase sau". | ~0 giờ, chỉ sửa doc |
| **C. Làm gọi ở MediaOS** | ADR sửa CHAT-DEC-005 (vùng đỏ) + kênh signalling 2 chiều + TURN/STUN + UI gọi + test. | Lớn — một wave riêng |

---

## 5. Đề xuất WO (chờ §4 rồi seed)

| WO | Nội dung | Vùng |
| --- | --- | --- |
| `S7-CHAT-LMS-1` | Gỡ chat khỏi LMS (giữ trợ lý AI) + trỏ sidebar sang `/chat` MediaOS + xuất 84 tin ra tệp lưu trữ | vàng |
| `S7-CHAT-FE-3` | **Sửa `done_when`**: bỏ vế "thay lối vào /chat tạm của LMS" (đã tách sang `LMS-1`) | vàng |
| `S7-CHAT-BE-9` *(chỉ khi chọn C)* | ADR + kênh signalling 2 chiều + TURN/STUN | **đỏ** |
