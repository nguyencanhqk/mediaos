# API-13: CHAT API DESIGN (Chat nội bộ — 1-1 · Nhóm · Phòng ban · Dự án)

**MODULE CHAT - CHAT NỘI BỘ - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-11 ME](<API-11_ME_API_Design.md>) · [API-12 GOAL](<API-12_GOAL_API_Design.md>) · **API-13 CHAT**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-15 CHAT](<../SPEC/SPEC-15 CHAT.md>) · [Thiết kế DB: DB-12](<../DB/DB-12 CHAT Database Design.md>) · [DB-08 Files](<../DB/DB-08 Audit Files Settings Seeds Database Design.md>) · [Ma trận phân quyền §9c](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-13 |
| Tên tài liệu | CHAT API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | CHAT - Chat nội bộ |
| Phiên bản | v0.1 |
| Trạng thái | **Stub — Draft**, duyệt cùng SPEC-15. Khung endpoint đã chốt; DTO chi tiết bổ sung ở WO backend CHAT |
| Giai đoạn | Phase 4 · wave S7-CHAT — ngoài RC v1.0.0 |
| Tài liệu nguồn | SPEC-15 CHAT, API-01 Tổng quan, DB-12, DB-08, permission-matrix-spec |
| Ngày tạo | 01/08/2026 |
| Ngày cập nhật | 01/08/2026 |

> **Trạng thái Stub:** Tài liệu khoá **tên file + danh sách endpoint + nguyên tắc bắt buộc** để README/SPEC-15 §15 trỏ nhất quán. DTO/schema request-response đầy đủ và ví dụ payload bổ sung ở các WO backend (`S7-CHAT-BE-*`).

---

## 2. Mục đích tài liệu

Mô tả thiết kế API cho module **CHAT** — kênh trao đổi tức thời nội bộ (SPEC-15 §2). API-13 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO dưới prefix `/api/v1/chat`.
2. Frontend triển khai trang `/chat` full-screen + panel nổi toàn hệ thống, dùng **chung một** kết nối WebSocket.
3. QA viết test deny-path/IDOR/cross-tenant, đặc biệt là **ranh giới thành viên phòng** — bề mặt rủi ro lớn nhất của module này.

---

## 3. Căn cứ thiết kế

1. **API-01** — prefix `/api/v1`, envelope response/error thống nhất, pagination chuẩn, header `X-Request-Id`, bắt buộc kiểm authentication + permission + business validation + audit.
2. **SPEC-15 CHAT** — nguồn sự thật nghiệp vụ: loại phòng (§3.1), ranh giới quyền theo thành viên (§3.2–3.3), append-only (§3.4), WS một chiều (§3.5), permission (§11), mã lỗi (§12), lõi nghiệp vụ (§13), API (§15), thông báo (§17), bảo mật (§18), CHAT-DEC-001..012 (§22).
3. **DB-12** — `chat_rooms` / `chat_room_members` / `chat_messages` (RLS+FORCE, append-only, `seq` identity), `search_vector` generated, đính kèm qua `file_links`.
4. **DB-08 / API-09 FOUNDATION** — Files (presign upload, `file_links`, `FilePolicyService` fail-closed), audit, `sequence_counters`.
5. **permission-matrix-spec §9c** — 9 cặp `(action, resource_type)` mà permission engine thực thi.
6. **SPEC-08 / API-07 NOTI** — `CHAT_MENTIONED`, `CHAT_DIRECT_MESSAGE` qua OutboxNotificationBridge.

---

## 4. Phạm vi API-13

### 4.1 Bao gồm trong v1

| Nhóm API | Mô tả |
| --- | --- |
| Rooms | Danh sách phòng của tôi · tạo phòng nhóm · mở DM idempotent · chi tiết · sửa · lưu trữ · rời |
| Members | Xem/thêm/bớt/phong vai trò trong phòng nhóm (chặn trên phòng dẫn xuất) |
| Messages | Đọc theo con trỏ `seq` · gửi (idempotent) · thu hồi · ghim/bỏ ghim · danh sách tin ghim |
| Read state | Đánh dấu đã đọc (chỉ tiến) · tổng chưa đọc cho badge |
| Search | Tìm toàn văn tiếng Việt trong phạm vi phòng của người tìm |
| Files | Danh sách tệp đã gửi trong phòng (URL ký hạn ngắn) |
| Realtime | Kênh WS `/ws` một chiều server→client (không phải REST, mô tả ở §7) |

### 4.2 Không bao gồm (ngoài phạm vi v1)

- Sửa tin nhắn đã gửi (SPEC-15 §5.2, CHAT-ERR-007).
- Đang gõ / trạng thái online (typing, presence).
- Thả cảm xúc (reaction).
- Chat theo từng task (CHAT-DEC-009 — TASK đã có bình luận riêng).
- Kiểm duyệt / báo cáo tin nhắn (cần owner chốt chính sách trước).
- **Bất kỳ endpoint nào cho phép đọc phòng mà người gọi không thuộc** — kể cả cho vai trò quản trị (CHAT-DEC-004).

---

## 5. Endpoint tổng hợp CHAT (SPEC-15 §15)

Prefix: `/api/v1`

```http
GET    /api/v1/chat/rooms
POST   /api/v1/chat/rooms
POST   /api/v1/chat/rooms/direct
GET    /api/v1/chat/rooms/{room_id}
PATCH  /api/v1/chat/rooms/{room_id}
POST   /api/v1/chat/rooms/{room_id}/archive
POST   /api/v1/chat/rooms/{room_id}/leave
GET    /api/v1/chat/rooms/{room_id}/members
POST   /api/v1/chat/rooms/{room_id}/members
PATCH  /api/v1/chat/rooms/{room_id}/members/{user_id}
DELETE /api/v1/chat/rooms/{room_id}/members/{user_id}
GET    /api/v1/chat/rooms/{room_id}/messages
POST   /api/v1/chat/rooms/{room_id}/messages
POST   /api/v1/chat/rooms/{room_id}/read
GET    /api/v1/chat/rooms/{room_id}/pinned
GET    /api/v1/chat/rooms/{room_id}/files
POST   /api/v1/chat/messages/{message_id}/recall
POST   /api/v1/chat/messages/{message_id}/pin
DELETE /api/v1/chat/messages/{message_id}/pin
GET    /api/v1/chat/search
GET    /api/v1/chat/unread-count
```

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

Cột **Membership** ghi rõ endpoint có phải chạy `ChatAccessService.assertMember` hay không. Đây là cột quan trọng nhất của bảng: permission cho biết "được làm hành động gì", membership cho biết "ở phòng nào" (SPEC-15 §3.2).

| Mã | Method | Path | Chức năng | Permission (SPEC-15 §11) | Membership | Audit |
| --- | --- | --- | --- | --- | --- | --- |
| CHAT-API-001 | GET | `/chat/rooms` | Phòng của tôi + số chưa đọc + tin cuối; sắp theo `last_message_at`; filter `type`, `archived` | `('view','chat-room')` | tự-bound theo actor | — |
| CHAT-API-002 | POST | `/chat/rooms` | Tạo phòng nhóm (`name`, `memberUserIds[]`) — người tạo thành `admin` | `('create','chat-room')` | — | ✅ |
| CHAT-API-003 | POST | `/chat/rooms/direct` | Mở DM theo `peerUserId`, **idempotent** qua `direct_key`; gọi lại trả đúng phòng cũ (200) | `('create','chat-room')` | — | ✅ (lần tạo đầu) |
| CHAT-API-004 | GET | `/chat/rooms/{room_id}` | Chi tiết phòng + thành viên + vai trò của tôi | `('view','chat-room')` | ✅ **bắt buộc** | — |
| CHAT-API-005 | PATCH | `/chat/rooms/{room_id}` | Đổi `name`/`description` — chỉ phòng `group` | `('update','chat-room')` | ✅ + `role='admin'` | ✅ |
| CHAT-API-006 | POST | `/chat/rooms/{room_id}/archive` | Lưu trữ phòng nhóm (chỉ đọc sau đó) | `('archive','chat-room')` | ✅ + `role='admin'` | ✅ |
| CHAT-API-007a | GET | `/chat/rooms/{room_id}/members` | Danh sách thành viên + `lastReadSeq` (dựng "đã xem bởi") | `('view','chat-room')` | ✅ | — |
| CHAT-API-007b | POST | `/chat/rooms/{room_id}/members` | Thêm thành viên — **chặn** trên phòng dẫn xuất (CHAT-ERR-012) | `('manage','chat-member')` | ✅ + `role='admin'` | ✅ |
| CHAT-API-007c | PATCH | `/chat/rooms/{room_id}/members/{user_id}` | Phong/hạ `role` | `('manage','chat-member')` | ✅ + `role='admin'` | ✅ |
| CHAT-API-007d | DELETE | `/chat/rooms/{room_id}/members/{user_id}` | Bớt thành viên (set `left_at`) — chặn nếu là admin cuối (CHAT-ERR-011) | `('manage','chat-member')` | ✅ + `role='admin'` | ✅ |
| CHAT-API-008 | POST | `/chat/rooms/{room_id}/leave` | Tự rời — **chỉ** phòng `group` (CHAT-ERR-013) | `('view','chat-room')` | ✅ | ✅ |
| CHAT-API-009 | GET | `/chat/rooms/{room_id}/messages` | Đọc theo con trỏ `beforeSeq` **hoặc** `afterSeq` (không cả hai — CHAT-ERR-016), `limit ≤ 100` | `('view','chat-room')` | ✅ | — |
| CHAT-API-010 | POST | `/chat/rooms/{room_id}/messages` | Gửi tin: `body`, `clientMessageId`, `replyToMessageId?`, `fileIds[]?`, `mentions[]?`. **Idempotent** theo `clientMessageId` (CHAT-ERR-014) | `('send','chat-message')` | ✅ | — (nội dung KHÔNG vào audit) |
| CHAT-API-011 | POST | `/chat/messages/{message_id}/recall` | Thu hồi (§13.6): người gửi ≤ 15 phút, hoặc admin phòng nhóm | `('recall','chat-message')` | ✅ (phòng chứa tin) | ✅ |
| CHAT-API-012a | POST | `/chat/messages/{message_id}/pin` | Ghim — tối đa 20/phòng (CHAT-ERR-008) | `('pin','chat-message')` | ✅ + `role='admin'` | ✅ |
| CHAT-API-012b | DELETE | `/chat/messages/{message_id}/pin` | Bỏ ghim | `('pin','chat-message')` | ✅ + `role='admin'` | ✅ |
| CHAT-API-013 | GET | `/chat/rooms/{room_id}/pinned` | Danh sách tin đã ghim | `('view','chat-room')` | ✅ | — |
| CHAT-API-014 | POST | `/chat/rooms/{room_id}/read` | `{ seq }` → `last_read_seq = GREATEST(cũ, seq)`; gửi số nhỏ hơn → bỏ qua im lặng (CHAT-ERR-018) | `('view','chat-room')` | ✅ | — |
| CHAT-API-015 | GET | `/chat/search` | `q` (≥2 ký tự) + `roomId?` + con trỏ. **Luôn** giới hạn theo phòng người tìm là thành viên (`left_at IS NULL`) | `('view','chat-room')` | ✅ ngầm trong truy vấn | — |
| CHAT-API-016 | GET | `/chat/unread-count` | Tổng chưa đọc của tôi (badge header) — tính bằng phép trừ `seq` | `('view','chat-room')` | tự-bound theo actor | — |
| CHAT-API-017 | GET | `/chat/rooms/{room_id}/files` | Tệp đã gửi trong phòng, URL ký hạn ngắn | `('view','chat-room')` | ✅ | — |

> **Notation permission:** Chuỗi `('action','resource')` là **cặp engine thực thi** (permission-matrix-spec §9c + seed DB-12 §9 bước D) — không phải chuỗi dotted `MODULE.RESOURCE.ACTION` hiển thị FE.

### 5.2 Trạng thái hiện thực (đối chiếu code, 01/08/2026)

| Nhóm | Trạng thái | Ghi chú |
| --- | --- | --- |
| Toàn bộ CHAT-API-001..017 | ⏳ **Chưa có code** | Module `apps/api/src/chat/` đã bị `git rm` ở `2591db13` (de-media-fy) |
| Bảng DB | ✅ Đã tồn tại thật | `0010` + `0050`, RLS+FORCE + append-only + composite FK `0535` |
| DTO Zod | 🟡 Một phần | `packages/contracts/src/chat.ts` còn trong repo, **thiếu** nhiều trường v1 và **thừa** `room_type='channel'` |
| Gateway WS | ✅ Sẵn sàng | `apps/api/src/realtime/` — auth handshake, Valkey adapter, room `co:{companyId}:…`; cụm chat đã bị gỡ ở `CLEAN-DECOUPLE-1` |

> Bản chat cũ (`2591db13~1:apps/api/src/chat/`) chỉ kiểm membership, **không** permission guard, **không** audit, **không** data-scope, và trả `403` chỗ đáng lẽ `404`. Dùng làm **tham chiếu**, KHÔNG khôi phục nguyên trạng.

---

## 6. Nguyên tắc API BẮT BUỘC (SPEC-15 §3, §13, §18)

1. **Một điểm khẳng định membership.** Mọi endpoint có cột "Membership ✅" gọi **đúng một** hàm `ChatAccessService.assertMember(companyId, roomId, actorUserId)`; hàm này chứa sẵn `left_at IS NULL` và `deleted_at IS NULL`. Không controller nào tự viết lại điều kiện.
2. **404 chứ không 403 cho phòng lạ** (CHAT-ERR-001). `403` xác nhận phòng tồn tại ⇒ thành oracle dò. Chỉ trả `403` khi người gọi **đã** là thành viên nhưng thiếu quyền hành động.
3. **Cặp gate của tìm kiếm và tệp phải TRÙNG cặp của đường đọc** (`view:chat-room`). `data_scope` là per-(permission, role), nên tách cặp riêng sẽ đẻ ra role "tìm được mà đọc không được" — đúng lỗ đã gặp ở `S5-TASK-COVER-1`.
4. **Phân trang bằng con trỏ `seq`, cấm `offset`.** `beforeSeq` và `afterSeq` loại trừ nhau. `created_at` chỉ để hiển thị.
5. **Gửi tin là idempotent theo `clientMessageId`** — gửi lại trả về **cùng** bản ghi với `200`, không tạo bản sao, không báo lỗi. `clientMessageId` do client sinh **một lần khi bắt đầu soạn**, không sinh lại trong hàm gửi (khoá ngẫu nhiên trong thân hàm không chống trùng gì cả).
6. **Emit WS sau khi transaction commit**, không trong transaction — nếu không sẽ đẩy cả tin của transaction bị rollback, và người nhận `GET` lại sẽ không thấy.
7. **Che ở server.** Tin đã thu hồi trả `body: null` + `recalledAt`. FE **phải** khai `.nullable()` cho `body` trong schema Zod — thiếu là `ZodError` làm trắng trang dù HTTP 200.
8. **Nội dung tin nhắn không vào audit log, không vào payload notification.** Audit ghi hành động quản trị phòng và id tin; notification chỉ mang tên phòng/người gửi + liên kết.
9. **Không render HTML/Markdown thô** từ người dùng — body là văn bản thuần, nhận diện liên kết ở tầng hiển thị đã escape.
10. **Đính kèm phải có `ChatMessageFileResolver`.** `FilePolicyService.decideForLinkedFile` fail-closed với `(module_code, entity_type)` chưa đăng ký: trả `deny-no-resolver`, **không** rơi xuống fallback `FOUNDATION.FILE.*`. Thiếu resolver ⇒ gửi được tệp mà không ai tải được. `canLink` phải yêu cầu người gọi **là người đã tải lên chính tệp đó**.

---

## 7. Kênh realtime (không phải REST)

Namespace `/ws` (Socket.IO), auth ở handshake bằng access token — hạ tầng đã có tại `apps/api/src/realtime/`.

| Sự kiện | Chiều | Payload | Đích |
| --- | --- | --- | --- |
| `chat:message` | server → client | `ChatMessageDto` (cùng DTO REST) | `co:{companyId}:chatroom:{roomId}` |
| `chat:message-recalled` | server → client | `{ messageId, roomId, recalledAt }` | như trên |
| `chat:read` | server → client | `{ roomId, userId, lastReadSeq }` | như trên |
| `chat:room` | server → client | `{ roomId, action, room? }` | như trên + `co:{companyId}:user:{userId}` của người bị ảnh hưởng |

Ràng buộc:

- **Không có `@SubscribeMessage` nào** — client không ghi gì qua WS (CHAT-DEC-005). Gửi tin đi REST (CHAT-API-010).
- Socket **join tất cả phòng của user ngay tại kết nối**, danh sách đọc từ DB phía server; **không** nhận danh sách phòng từ client.
- Membership đổi → server buộc socket `join`/`leave` ngay, không đợi kết nối lại.
- Mọi payload `.parse()` qua schema contracts trước khi emit (`RealtimeEmitterService`) — cấm `io.emit` row DB thẳng.
- `REALTIME_ENABLED=false` → gateway từ chối mọi kết nối ở handshake; FE chuyển sang bù bằng `afterSeq` mỗi 10 giây. **Nghiệp vụ vẫn phải đúng hoàn toàn** ở chế độ này.

---

## 8. Mã lỗi

18 mã `CHAT-ERR-001..018` định nghĩa tại [SPEC-15 §12](<../SPEC/SPEC-15 CHAT.md>). Ánh xạ HTTP:

| HTTP | Dùng cho |
| --- | --- |
| `200` | Idempotent trả bản ghi đã có (CHAT-ERR-014, mở DM lần 2) |
| `400` / `422` | Validate đầu vào: CHAT-ERR-002/003/004/009/016/017 |
| `403` | Đã là thành viên nhưng thiếu quyền/vai trò: CHAT-ERR-006/011/012/013 · tệp CHAT-ERR-015 |
| `404` | **Không phải thành viên** hoặc phòng/tin không tồn tại: CHAT-ERR-001 |
| `409` | Xung đột trạng thái: gửi vào phòng đã lưu trữ (CHAT-ERR-005), ghim quá hạn mức (CHAT-ERR-008) |
| `501`/`405` | Sửa tin nhắn (CHAT-ERR-007) — không hỗ trợ ở v1 |

CHAT-ERR-010 (mention người ngoài phòng) và CHAT-ERR-018 (`last_read_seq` lùi) **không** trả lỗi — bỏ qua im lặng theo thiết kế.

---

## 9. Definition of Done cho API-13

- [ ] Danh sách endpoint §5.1 khớp SPEC-15 §15, không có endpoint nào bỏ qua cột Membership
- [ ] DTO chi tiết bổ sung ở từng WO backend, đồng bộ `packages/contracts/src/chat.ts` (bỏ `channel`, thêm trường v1)
- [ ] Cột "Trạng thái hiện thực" §5.2 cập nhật khi mỗi WO backend đóng
- [ ] Lệch giữa tài liệu và code ⇒ **sửa code**, không sửa ngầm tài liệu
