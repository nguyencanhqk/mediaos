# Kế hoạch thi công `S8-CHAT-UX-BE-3` — thả cảm xúc (CHAT-API-022a/022b)

> Vùng **VÀNG**. Gate = **LIGHT**.
> Nguồn: `SPEC-15 §5.1b · §10 CHAT-FUNC-019 · §12 (CHAT-ERR-024/025)` · `API-13 §5.1b · §7` ·
> `CHAT-DEC-018`. Nền DB: bảng `chat_message_reactions` từ mig `0543` (đã land). Ngày lập: 06/08/2026.

---

## 1. Điểm xuất phát (ĐO THẬT)

| Thứ | Trạng thái |
| --- | --- |
| Bảng `chat_message_reactions` | CÓ (mig `0543` khối D) — RLS + FORCE + policy 2 vế + unique 4 cột + CHECK emoji |
| Quyền app role | `SELECT, INSERT, DELETE` cấp bảng — **KHÔNG có UPDATE** (đổi cảm xúc = DELETE + INSERT) |
| Drizzle schema | CÓ (`communication.ts:425`) + hằng `CHAT_REACTION_EMOJIS` 6 mã |
| Đường dựng `ChatMessageDto` | **DUY NHẤT** `ChatAttachmentPresignService.decorate()` — đã có sẵn khuôn 1-truy-vấn-lô cho tệp |
| Điểm khẳng định cho route theo `messageId` | `ChatAccessService.assertMessageAccess` — đã mang vị từ §13.4, trả 404 hằng |
| WS | `WS_EVENTS` chưa có `chat:reaction`; emitter có `emitToRoom` dùng chung |

---

## 2. Năm quyết định thi công

### 2.1 Tổng hợp reaction đi CHUNG lô với tệp, trong `decorate()`

`decorate()` đã là đường dựng DTO duy nhất và đã chạy đúng **một** truy vấn lô cho tệp. Reaction đi
cùng chỗ đó bằng **một truy vấn lô thứ hai** (`GROUP BY message_id, emoji`), KHÔNG phải một truy vấn
mỗi tin. `decorate` chỉ **gọi** `ChatReactionsService.aggregateForMessages` — logic reaction không
chui vào một class tên `…AttachmentPresign…`.

### 2.2 DTO mang TỔNG HỢP, không mang danh sách người

`{ emoji, count, mine }`. **Không** trả `userIds[]`: ai-thả-gì cho cả phòng là một quyết định về
quyền riêng tư, không được làm ngầm như tác dụng phụ của một tính năng UI (`done_when` #4).

### 2.3 Payload WS HẸP HƠN DTO REST — bỏ `mine`

`chat:reaction` phát tới **cả phòng**, mà `mine` chỉ đúng với MỘT người. Giữ `mine` trong payload là
gửi trạng thái của người này cho người khác. Khuôn đã có: `wsChatRoomEventSchema` strip `unreadCount`
đúng vì lý do ấy (memory `ws-payload-narrower-than-rest-dto`).

### 2.4 Bộ emoji ĐÓNG sống ở BA chỗ — buộc chúng bằng một ratchet

CHECK ở DB (`0543`) · hằng drizzle (`communication.ts`) · Zod ở contracts. Ba bản sao sẽ trôi, mà
schema `apps/api/src/db/schema/**` **chưa từng** import `@mediaos/contracts` (đo: 0 kết quả) nên hợp
nhất là đổi quy ước cho một hằng 6 phần tử — không đáng. Thay vào đó: **spec đối chiếu** hằng drizzle
với `chatReactionEmojiSchema.options`, thêm emoji thứ 7 mà quên một chỗ là ĐỎ.

### 2.5 Mã lỗi + xoá nợ census

`CHAT-ERR-024` (react tin đã thu hồi → 422) · `CHAT-ERR-025` (emoji ngoài bộ → 422). WO này **phải gỡ
cả hai khỏi `PENDING_CODES`** trong `chat-error-code-census.spec.ts` — ca "nợ đã trả" mà BE-1 vừa thêm
sẽ ĐỎ nếu quên.

---

## 3. Hình dạng API

| Mã | Method | Path | Mã trả | Ghi chú |
| --- | --- | --- | --- | --- |
| CHAT-API-022a | `PUT` | `/chat/messages/:id/reactions/:emoji` | **200** + tổng hợp của tin | idempotent (thả 2 lần = 1 hàng) |
| CHAT-API-022b | `DELETE` | `/chat/messages/:id/reactions/:emoji` | **204** | chưa thả cũng 204, KHÔNG 404 |

Cặp quyền cả hai: **`('send','chat-message')`** (API-13 §5.1b) — thả cảm xúc là một hành động GHI vào
phòng, cùng năng lực với gửi tin. `assertMessageAccess` lo ranh giới dữ liệu.

Bất đối xứng 200/204 là chủ ý: `PUT` là chiều CÓ THỂ bị từ chối (tin đã thu hồi · emoji lạ), trả tổng
hợp để FE hoà lại cập-nhật-lạc-quan mà không phải tải lại trang tin. `DELETE` không có gì để báo.

---

## 4. Thứ tự RED → GREEN

1. **RED deny-path** — react tin ở phòng KHÔNG thuộc ⇒ **404 mang mã CHAT-ERR-001** (không 403).
2. **RED tin đã thu hồi** ⇒ 422 `CHAT-ERR-024`.
3. **RED emoji lạ** ⇒ 422 `CHAT-ERR-025` (chặn ở Zod TRƯỚC khi chạm DB — CHECK là đai thứ hai).
4. **RED idempotent** — `PUT` hai lần: đếm hàng DB = 1. `DELETE` khi chưa thả = 204.
5. **RED N+1** — đọc trang 20 tin: đếm số câu SQL, reaction chỉ thêm **1**.
6. **RED payload WS** — `chat:reaction` KHÔNG có khoá `mine`, KHÔNG có `userIds`.
7. GREEN → build contracts + web-core → regen route census → LIGHT gate.

---

## 5. Rủi ro đã biết

| # | Rủi ro | Chặn bằng |
| --- | --- | --- |
| 1 | Quên gỡ `PENDING_CODES` ⇒ census ĐỎ | bước 7 + §2.5 |
| 2 | Quên regen route census ⇒ `route-guard-coverage` ĐỎ | bước 7 |
| 3 | `reactions` required trong `chatMessageSchema` ⇒ mọi consumer cũ ăn ZodError | `.optional()` |
| 4 | Thả cảm xúc vào tin của phòng đã LƯU TRỮ | chặn: phòng lưu trữ CHỈ ĐỌC (CHAT-ERR-005), cùng luật `sendMessage` |
| 5 | Đua hai người cùng thả 1 emoji | unique 4 cột ở DB + `ON CONFLICT DO NOTHING` — không cần khoá |
