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
2. Frontend triển khai trang `/chat` full-screen + drawer chat toàn hệ thống (v2 từ S17 — CHAT-SCREEN-002, thay cửa sổ nổi cũ), dùng **chung một** kết nối WebSocket.
3. QA viết test deny-path/IDOR/cross-tenant, đặc biệt là **ranh giới thành viên phòng** — bề mặt rủi ro lớn nhất của module này.

---

## 3. Căn cứ thiết kế

1. **API-01** — prefix `/api/v1`, envelope response/error thống nhất, pagination chuẩn, header `X-Request-Id`, bắt buộc kiểm authentication + permission + business validation + audit.
2. **SPEC-15 CHAT** — nguồn sự thật nghiệp vụ: loại phòng (§3.1), ranh giới quyền theo thành viên (§3.2–3.3), append-only (§3.4), WS một chiều (§3.5), permission (§11), mã lỗi (§12), lõi nghiệp vụ (§13), API (§15), thông báo (§17), bảo mật (§18), CHAT-DEC-001..012 (§22).
3. **DB-12** — `chat_rooms` / `chat_room_members` / `chat_messages` (RLS+FORCE, append-only, `seq` identity), `search_vector` generated, đính kèm qua `file_links`.
4. **DB-08 / API-09 FOUNDATION** — Files (presign upload, `file_links`, `FilePolicyService` fail-closed), audit, `sequence_counters`.
5. **permission-matrix-spec §9c** — 10 cặp `(action, resource_type)` mà permission engine thực thi (9 cặp thường + `('view','chat-oversight')` cho đường đọc-vượt §5.3).
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
- ~~Đang gõ / trạng thái online (typing, presence).~~ → **ĐÃ VÀO PHẠM VI** ở wave S8-CHAT-UX (CHAT-DEC-017): `CHAT-API-023` + sự kiện `chat:typing`/`chat:presence` §7.
- ~~Thả cảm xúc (reaction).~~ → **ĐÃ VÀO PHẠM VI** ở wave S8-CHAT-UX (CHAT-DEC-018): `CHAT-API-022a/b` + sự kiện `chat:reaction` §7.
- **Thư mục hội thoại tự đặt** — owner chốt mục cố định theo `room_type` (CHAT-DEC-014), chia mục làm **hoàn toàn ở FE**, không endpoint.
- Chat theo từng task (CHAT-DEC-009 — TASK đã có bình luận riêng).
- Kiểm duyệt / báo cáo tin nhắn (cần owner chốt chính sách trước).
- **Tìm kiếm vượt membership** — `GET /chat/search` giữ nguyên vị từ membership cho **mọi** role, kể cả Super Admin (SPEC-15 §3.3). Không có `/chat/oversight/search`.
- **Mọi biến thể GHI trên đường đọc-vượt** — `/chat/oversight/*` chỉ đọc; Super Admin không gửi/ghim/thu hồi/sửa thành viên được ở phòng mình không thuộc.

> **Đổi so với bản 01/08/2026:** dòng "bất kỳ endpoint nào cho phép đọc phòng mà người gọi không thuộc" đã bị **gỡ** khỏi danh sách ngoài-phạm-vi. Owner chốt CHAT-DEC-004 ngược đề xuất Draft ngày 02/08/2026 ⇒ đường đọc-vượt **có** trong v1, đóng khung ở §5.3.

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

# wave S8-CHAT-UX — nâng cấp giao diện (§5.1b). KHÔNG cặp quyền mới.
PUT    /api/v1/chat/rooms/{room_id}/pin
DELETE /api/v1/chat/rooms/{room_id}/pin
PUT    /api/v1/chat/rooms/{room_id}/mute
POST   /api/v1/chat/rooms/{room_id}/unread
POST   /api/v1/chat/rooms/{room_id}/typing
POST   /api/v1/chat/rooms/{room_id}/avatar
DELETE /api/v1/chat/rooms/{room_id}/avatar
POST   /api/v1/chat/rooms/{room_id}/avatar/upload-url
PUT    /api/v1/chat/messages/{message_id}/reactions/{emoji}
DELETE /api/v1/chat/messages/{message_id}/reactions/{emoji}

# wave S17-CHAT-UX2 — bố cục/thao tác (API-13 §5.1d). KHÔNG cặp quyền mới.
GET    /api/v1/chat/rooms/{room_id}/links

# 🔒 đọc-vượt membership — cặp riêng, chỉ đọc, có audit (§5.3)
GET    /api/v1/chat/oversight/rooms
GET    /api/v1/chat/oversight/rooms/{room_id}
GET    /api/v1/chat/oversight/rooms/{room_id}/messages
GET    /api/v1/chat/oversight/audit
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
| CHAT-API-017 | GET | `/chat/rooms/{room_id}/files` | Tệp đã gửi trong phòng, URL ký hạn ngắn. *(S17)* Tham số `kind=image\|file` — xem API-13 §5.1d | `('view','chat-room')` | ✅ | — |

> **Notation permission:** Chuỗi `('action','resource')` là **cặp engine thực thi** (permission-matrix-spec §9c + seed DB-12 §9 bước D) — không phải chuỗi dotted `MODULE.RESOURCE.ACTION` hiển thị FE.

#### 5.1b Endpoint bổ sung — wave S8-CHAT-UX (SPEC-15 §5.1b · CHAT-DEC-014…019)

> **KHÔNG cặp quyền mới.** Cả 8 endpoint dưới đây dùng lại đúng 3 cặp đã seed ở v1 — xem SPEC-15 §11a. Hệ quả: 0 migration seed quyền, 0 đổi `SENSITIVE_CAPABILITY_ALLOWLIST`.

| Mã | Method | Path | Chức năng | Permission | Membership | Audit |
| --- | --- | --- | --- | --- | --- | --- |
| CHAT-API-024a | PUT | `/chat/rooms/{room_id}/pin` | Ghim hội thoại (per-user). Vượt **10** → 409 CHAT-ERR-021 | `('view','chat-room')` | ✅ | — |
| CHAT-API-024b | DELETE | `/chat/rooms/{room_id}/pin` | Bỏ ghim | `('view','chat-room')` | ✅ | — |
| CHAT-API-025 | PUT | `/chat/rooms/{room_id}/mute` | `{ mutedUntil \| null }` — tắt/bật thông báo phòng. **Đóng lỗ v1**: cột có từ `0538` mà chưa từng có đường ghi. Mốc **đã qua** được chuẩn hoá về `null` (xem ghi chú dưới bảng) | `('view','chat-room')` | ✅ | — |
| CHAT-API-020 | POST | `/chat/rooms/{room_id}/unread` | Đánh dấu chưa đọc thủ công (`marked_unread_at`). **KHÔNG** lùi `last_read_seq` | `('view','chat-room')` | ✅ | — |
| CHAT-API-021a | POST | `/chat/rooms/{room_id}/avatar` | Đặt ảnh đại diện phòng từ `fileId` đã upload+confirm. `direct` → 422 CHAT-ERR-022; không đủ tư cách → 403 CHAT-ERR-023 | `('update','chat-room')` | ✅ + tư cách theo **SPEC-15 §11b** | ✅ |
| CHAT-API-021b | DELETE | `/chat/rooms/{room_id}/avatar` | Gỡ ảnh đại diện | `('update','chat-room')` | ✅ + §11b | ✅ |
| CHAT-API-021c | POST | `/chat/rooms/{room_id}/avatar/upload-url` | Presign upload — **wrapper riêng của CHAT**, sao khuôn `ChatFilesService` (S7-CHAT-BE-8) | `('update','chat-room')` | ✅ + §11b | — |
| CHAT-API-022a | PUT | `/chat/messages/{message_id}/reactions/{emoji}` | Thả cảm xúc. Idempotent (thả 2 lần = 1 hàng). **200** + tổng hợp mới của tin. Tin đã thu hồi → 422 CHAT-ERR-024; phòng đã lưu trữ → 422 CHAT-ERR-005; emoji ngoài bộ đóng → 422 CHAT-ERR-025 | `('send','chat-message')` | ✅ (phòng chứa tin) | — |
| CHAT-API-022b | DELETE | `/chat/messages/{message_id}/reactions/{emoji}` | Bỏ thả. Chưa thả → **204**, không 404. **Chạy được cả trên tin đã thu hồi / phòng đã lưu trữ** (xem ghi chú dưới bảng) | `('send','chat-message')` | ✅ | — |
| CHAT-API-023 | POST | `/chat/rooms/{room_id}/typing` | Báo "đang gõ" → fan-out WS. **204**, 0 ghi DB, 0 audit | `('send','chat-message')` | ✅ | — |

⛔ **ĐÍNH CHÍNH ĐÁNH SỐ (S8-CHAT-UX-BE-1, 06/08/2026).** Bản seed đầu của bảng này cấp `CHAT-API-018a/018b/019` cho ghim/tắt-thông-báo — nhưng **ba mã đó đã thuộc `/chat/oversight/*` từ wave S7** (§5.3 dưới đây), và literal `'018a'|'018b'|'018c'|'019'` là giá trị của `CHAT_OVERSIGHT_ENDPOINT` (`chat-oversight.audit.ts:25-28`) đang nằm trong `audit_logs.metadata.endpoint` **trên PROD** — không viết lại được. Vì vậy **bên S8 dời**: ghim → `024a/024b`, tắt thông báo → `025`. `020` · `021a-c` · `022a/b` · `023` không va, giữ nguyên. Đo lại dải rỗng bằng grep trước khi cấp mã mới — đừng tin con số của một bảng seed.

⚠️ **`CHAT-API-025` chuẩn hoá mốc đã qua về `null` thay vì báo lỗi.** Đường đọc (`ChatAudienceReader.stillReceiving`) coi `muted_until <= now()` là **không tắt**; lưu nguyên một mốc quá khứ nghĩa là DB giữ giá trị mà chính hệ thống đọc ngược lại, và client nào kiểm `mutedUntil !== null` sẽ vẽ biểu tượng chuông-gạch cho một phòng vẫn gửi thông báo bình thường. **Client PHẢI so với thời điểm hiện tại** (`mutedUntil > now`) — mốc còn hết hạn được trong lúc dữ liệu nằm trong cache. (Không chọn 422 vì lệch đồng hồ client vài giây sẽ biến thao tác hợp lệ thành lỗi.)

⚠️ **`CHAT-API-022b` cố ý KHÔNG chặn ở tin đã thu hồi / phòng đã lưu trữ,** trong khi `022a` thì chặn. Đường **ghi** phải chặt, đường **gỡ** thì không: chặn cả hai nghĩa là một cảm xúc lỡ tay thả vào tin ngay trước khi tin bị thu hồi (hoặc phòng bị đóng) sẽ dính **vĩnh viễn**, không có đường sửa qua API. Ranh giới dữ liệu (`assertMessageAccess` → 404) vẫn áp cho cả hai — nới đúng vế cần nới.

⚠️ **Payload WS `chat:reaction` HẸP HƠN DTO REST:** không có `mine` (per-user — phát cho cả phòng thì mọi client vẽ dấu tích của người vừa bấm), không có `actorUserId`, không có danh sách người thả. Client nhận sự kiện phải **giữ nguyên `mine` nó đang có** và chỉ thay `count`. Cùng khuôn `chat:room` strip `unreadCount`.

⚠️ **Vì sao ghim/tắt/đánh-dấu gate bằng `('view','chat-room')` chứ không phải một cặp mạnh hơn:** ba thứ đó là **tuỳ chọn cá nhân trên hàng membership của chính mình**. Gate mạnh hơn tạo ra role "đọc được phòng mà không tắt nổi thông báo của chính mình" — đúng họ lỗi `read-path-gate-pair-must-match-download-pair`.

⚠️ **CHAT-API-021c KHÔNG được thay bằng `POST /foundation/files/upload`.** Cặp `('upload','foundation-file')` chỉ có ở `SA` · `company-admin` · `QUẢN LÝ CẤP CAO` (mig `0435:376`) ⇒ trưởng nhóm thường sẽ không đặt được avatar. Đây đúng là lỗ đã phải vá ở `S7-CHAT-BE-8` cho đính kèm; đừng lặp lại.

⚠️ **CHAT-API-007a phải trả thêm `avatarUrl` cho từng thành viên** (CHAT-DEC-019) — đó là **nguồn duy nhất** để FE vẽ avatar người gửi trong khung chat. Ký **1 lần/phòng** ở đây, **không** ký theo từng tin. Người đã rời phòng vẫn phải có trong danh sách (kèm `leftAt`), nếu không tin cũ của họ mất cả avatar lẫn tên.

✅ **Đã thi công `S8-CHAT-UX-FE-3` (07/08/2026).** `GET /chat/rooms/:id/members` giờ là **ROSTER**: thành viên đang hoạt động **và người đã rời**, mỗi người kèm `avatarUrl` (ký 1 lô qua `AvatarPresignService`), `isOnline` (ảnh chụp từ `ChatPresenceReaderService`) và `leftAt`. Ba khoá đều `.optional()` trong `chatRoomMemberSchema` — schema này đã có consumer đang chạy, thêm khoá **required** làm mọi consumer ăn ZodError khi FE lên trước BE.

⚠️ **`GET /chat/rooms/:id` (CHAT-API-004) GIỮ NGUYÊN `members` = ACTIVE-ONLY** — hai đường, hai ngữ nghĩa, cố ý. Detail trả lời "ai đang ở trong phòng" và nuôi số đếm ở đầu phòng, danh sách quản trị, cùng bộ lọc "đã ở trong phòng" của hộp thêm thành viên. Nhét người đã rời vào đó làm bộ lọc coi họ là thành viên ⇒ **không thêm lại được vào phòng**, không thông báo, không lý do.

⚠️ **`isOnline` ở CHAT-API-007a là ẢNH CHỤP, không phải luồng sống.** Sự kiện `chat:presence` chỉ fan-out tới peer của phòng `direct` (§7) — cố ý, vì phát trạng thái online của mọi người tới mọi phòng họ tham gia đúng là thứ `CHAT-DEC-017` gọi là rò lịch làm việc. Với phòng nhóm/phòng ban/dự án, giá trị này chỉ mới lại khi client refetch roster. FE phải hiển thị nó như trạng thái tại-thời-điểm-nạp, không được đọc là thời-gian-thực.

### 5.1c Wave S7-CALL — cuộc gọi thoại/hình *(CHAT-DEC-020, owner ký ADR 08/08/2026)*

> ⚠️ **Đánh số `026..029`, KHÔNG phải `024..027`** như bản seed Work Order ghi. Đo lại 08/08/2026: `024a`/`024b`/`025` đã bị chính wave S8 ở bảng trên chiếm. Đây là lần **thứ hai** dải trong WO lỗi thời — đọc lại đính chính ⛔ phía trên: **đo bằng grep, đừng tin con số của bảng seed**.
>
> **CÓ cặp quyền mới:** `('call','chat-room')`, `is_sensitive=false`, seed ở `S7-CALL-DB-1`. Khác wave S8 (0 cặp mới) ⇒ wave này **CÓ** rủi ro `canonical-seed-pin-regression`: seed phải cùng commit với cập nhật pin canonical.

Toàn bộ vòng đời đi **REST** — hàng rào **R4** của `CHAT-DEC-020`. `/ws-call` chỉ relay SDP/ICE, **không ghi gì** (§7a).

| Mã | Method | Path | Chức năng | Permission | Membership | Audit |
| --- | --- | --- | --- | --- | --- | --- |
| CHAT-API-026 | POST | `/chat/rooms/{room_id}/calls` | **Mời** — `{ kind: 'audio' \| 'video' }`, tạo `chat_calls` trạng thái `ringing`. Phòng đã có cuộc gọi sống → 409 CHAT-ERR-028 | `('call','chat-room')` | ✅ | ✅ |
| CHAT-API-027 | POST | `/chat/calls/{call_id}/accept` · `/reject` | **Nhận / từ chối** — chỉ người được mời. Cuộc gọi đã kết thúc → 422 CHAT-ERR-029 | `('call','chat-room')` | ✅ (phòng chứa cuộc gọi) | ✅ |
| CHAT-API-028 | POST | `/chat/calls/{call_id}/cancel` · `/hangup` | **Huỷ** (người gọi rút trước khi được nhận) · **kết thúc** (bên nào cũng gác được sau khi nối) | `('call','chat-room')` | ✅ | ✅ |
| CHAT-API-029 | GET | `/chat/calls/ice-config` | Cấu hình ICE — credential TURN sinh **phía server** từ env, STUN Google dự phòng. **204/200 không thân nhạy cảm ghi log** | `('call','chat-room')` | — | — |

⚠️ **Người ngoài phòng nhận `404`, KHÔNG phải `403`** (CHAT-ERR-026) — đồng dạng CHAT-ERR-001, thông điệp **giống hệt** phòng không tồn tại. Là thành viên nhưng thiếu cặp `('call','chat-room')` mới là `403` (CHAT-ERR-027): lúc đó người gọi đã chứng minh được tư cách thành viên nên không còn gì để dò. Trả `403` cho cả hai biến endpoint gọi thành oracle dò sự tồn tại của phòng.

⚠️ **`('view','chat-oversight')` KHÔNG miễn `assertMember` ở bất kỳ dòng nào trong bảng này.** Đọc-vượt (§5.3) là quyền đọc **lịch sử tin nhắn**, không phải quyền nghe cuộc gọi. Super Admin không thuộc phòng gọi vào → **404** như mọi người ngoài. Không có `/chat/oversight/calls`, và **không** được thêm.

⚠️ **`CHAT-API-029` KHÔNG log credential.** `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN` lấy từ **env** (BẤT BIẾN #3) — không hard-code, không vào DTO, không vào log kể cả ở mức debug. Credential TURN có hạn ngắn nhưng vẫn là bí mật đi được ra ngoài.

⚠️ **`ringing` quá hạn → `missed` do SERVER chuyển**, bằng `@SystemJobHandler` idempotent + `@Optional()` cho DI (memory `systemjobhandler-optional-dbw-di` — thiếu `@Optional()` sập `AppModule`, kéo đỏ dây chuyền hàng trăm spec). Để client tự đóng khung mà server không đổi trạng thái ⇒ phòng kẹt "đang có cuộc gọi sống" và **mọi lời mời sau đó 409 vĩnh viễn**.

⚠️ **Chưa cấp endpoint ĐỌC lịch sử cuộc gọi.** `chat_calls` append-only có dữ liệu nhưng wave này không mở đường liệt kê — ADR không đặt phạm vi đó. Ai làm màn "nhật ký cuộc gọi" phải cấp mã mới và **đo lại dải trống**, đừng mặc định `030` còn trống.

### 5.1d Wave S17-CHAT-UX2 — bố cục · mật độ thông tin · thao tác (API-13 §5.1d, owner duyệt 02/09/2026)

> Nguồn quyết định: [SPEC-15 §5.1d](<../SPEC/SPEC-15 CHAT.md>) (khối owner đã ký — **0 dòng đổi** ở WO này, mọi con trỏ mới đi vào [SPEC-15 §15b](<../SPEC/SPEC-15 CHAT.md>)) · [`docs/plans/S17-CHAT-UX2-WAVE.md`](../plans/S17-CHAT-UX2-WAVE.md). **KHÔNG cặp quyền mới, KHÔNG migration, KHÔNG mở bề mặt WebSocket** — ratchet 0 `@SubscribeMessage` (§7) giữ nguyên.

| Mã | Method | Path | Chức năng | Permission | Membership | Audit |
| --- | --- | --- | --- | --- | --- | --- |
| CHAT-API-031 | GET | `/chat/rooms/{room_id}/links` | Liên kết đã chia sẻ trong phòng — trích `https?://` từ `body` tin **chưa thu hồi**; keyset `room_seq DESC` + tie-break chỉ số liên kết trong tin; trần 50; **không dedupe URL ở server** | `('view','chat-room')` | ✅ | — |

`CHAT-API-017` (`GET /chat/rooms/{room_id}/files`) nhận thêm tham số query **`kind=image|file`** — permission/membership/audit **không đổi** so với bảng §5.1. Vị từ nguồn là **`mime_type LIKE 'image/%'` ở SQL**, và đây là **ĐỊNH NGHĨA DUY NHẤT** dùng chung với khoá `isImage` của `chatAttachmentSchema` (`packages/contracts/src/chat.ts`) — `isImage` là khoá DTO **suy ra ở tầng mapper**, **không phải cột DB** (memory `clamp-must-be-sql-not-js`). Chi tiết hợp đồng: [SPEC-15 §15b](<../SPEC/SPEC-15 CHAT.md>).

`kind` NGOÀI tập `{image, file}` ⇒ **400 `VALIDATION-ERR-001`** (API-01: 400 = sai format/validation; KHÔNG dùng 422 — 422 chỉ dành cho vi phạm rule nghiệp vụ). `kind` vắng mặt ⇒ trả TOÀN BỘ tệp, giữ nguyên hành vi `CHAT-API-017` hiện tại.

#### (1) Ba khoá DTO mới trên `chatRoomSchema` — TẤT CẢ `.nullable().optional()`

`/chat/rooms` có **7 consumer đang chạy** (memory `server-masking-needs-optional-fe-schema`) — thêm khoá **required** làm mọi consumer ăn `ZodError` khi FE lên trước BE.

| Khoá | Hình dạng | Quyết định |
| --- | --- | --- |
| `lastMessage` | `{ senderId, senderName, kind: 'text'\|'file'\|'system'\|'recalled', excerpt: string \| null, attachmentCount: number } \| null` | CHAT-DEC-022 |
| `peer` | `{ userId, name, avatarUrl, isActive } \| null` — chỉ khác `null` ở phòng `direct` | CHAT-DEC-023 |
| `createdByName` | `string \| null` | thêm vào `getRoom` (CHAT-API-004) |

Ràng buộc ngữ nghĩa của `lastMessage` — **bắt buộc test contract cho từng vế**:

- **Ưu tiên `kind` khi tin có CẢ body LẪN đính kèm:** `kind` = `'text'` **thắng** (không phải `'file'`), và `attachmentCount` **vẫn xuất hiện** (> 0) trong cùng bản ghi — hai trường **không loại trừ nhau**.
- `excerpt` ≤ **120 ký tự**, cắt **Ở SERVER theo grapheme** (không cắt giữa một cụm ký tự tổ hợp/emoji nhiều-codepoint), **strip** xuống dòng (`\n`) + ký tự điều khiển **trước khi** cắt.
- Tin `kind:'recalled'` ⇒ `excerpt: null` (che ở server — SPEC-15 §13.6).
- **Nguồn `senderName`** khi người gửi **đã rời phòng** hoặc **bị vô hiệu hoá**: vẫn **hiện tên** — nhất quán với roster `CHAT-API-007a` (§5.1b), vốn **cố ý giữ** người đã rời kèm `leftAt` thay vì ẩn tên.
- Lấy bằng **một** LATERAL trên `idx_chat_messages_room_seq` trong `listRoomsForUser` — **không N+1** (một câu SQL cho N phòng; phần vị từ §13.4 xem mục (3) BLOCKING 1 dưới đây).

#### (2) Strip `peer.avatarUrl` khỏi payload WS `chat:room`

`wsChatRoomEventSchema.room = chatRoomSchema.omit({unreadCount, pinnedAt, mutedUntil, markedUnreadAt, avatarUrl})` (`packages/contracts/src/realtime.ts:164-176`). Khoá **mới** thêm vào `chatRoomSchema` gốc (`lastMessage`, `peer`, `createdByName`) **tự động lọt ra WS** vì `.omit()` chỉ loại các khoá đã liệt kê tên — không cần sửa gì thêm cho ba khoá đó. Nhưng **`.omit()` KHÔNG với tới khoá LỒNG**: Zod không có cú pháp `.omit({'peer.avatarUrl': true})`. Muốn strip `peer.avatarUrl` thì `room` trong payload WS **PHẢI `.extend({ peer: … })`** bằng một bản `peer` đã strip sẵn `avatarUrl` ngay tại schema WS.

Ký avatar: ghim **tái dùng** `AvatarPresignService.resolveEmployeeAvatars` (đã dùng ở `chat-members.service.ts:74`, CHAT-API-007a) — **ký MỘT LÔ cho cả trang** danh sách phòng (chống N+1 lần ký), **KHÔNG cache / KHÔNG persist** — cùng nguyên tắc docblock `chatRoomSchema.avatarUrl` (`packages/contracts/src/chat.ts`).

Ca âm bắt buộc ở `packages/contracts/src/**/*.spec.ts`: parse một `room` có `peer.avatarUrl` khác null qua `wsChatRoomEventSchema` ⇒ khoá `avatarUrl` KHÔNG được có mặt trong kết quả. Thêm khoá LỒNG mới vào `chatRoomSchema` mà quên `.extend()` bản đã strip ở schema WS ⇒ spec này phải ĐỎ; không có ca âm thì luật strip sẽ trôi ở wave sau (memory `ws-payload-narrower-than-rest-dto`).

#### (3) §13.4 — hai đường đọc MỚI phải qua vị từ visibility (BLOCKING 1)

S17 mở **ĐÚNG HAI** đường đọc mới trên `chat_messages`: (a) LATERAL lấy `lastMessage` trong `listRoomsForUser`, (b) trích link từ `body` ở `CHAT-API-031`. SPEC-15 §13.4 bắt MỌI đường đọc mang vị từ `(m.visible_from_seq IS NULL OR msg.room_seq >= m.visible_from_seq)` qua nguồn duy nhất `apps/api/src/chat/chat-visibility.ts`.

⚠️ **`chat-visibility.spec.ts` là census THEO FILE, không phải "toàn bộ module".** Census per-method hiện chỉ quét `chat-messages.repository.ts` · `chat-attachments.repository.ts` · `chat-search.repository.ts`. `chat-rooms.repository.ts` chỉ xuất hiện trong khẳng định "không file chat nào tự viết chuỗi thô `visible_from_seq`" — khẳng định đó **cấm chuỗi thô nhưng KHÔNG đòi gọi helper** ⇒ đặt LATERAL của `lastMessage` trong `chat-rooms.repository.ts` mà quên gọi helper thì **ratchet vẫn XANH** dù đường đọc đã thoát §13.4.

Bắt buộc:

1. Cả hai đường đọc mới gọi `visibleFromSeqColumn()` hoặc `visibleFromSeqScalar()` (`apps/api/src/chat/chat-visibility.ts`).
2. File chứa chúng (dự kiến `chat-rooms.repository.ts` cho (a); file trích link mới cho (b)) **PHẢI được thêm vào danh sách census** của `chat-visibility.spec.ts`; `S17-CHAT-UX2-BE-1`/`BE-2` **PHẢI khai** `apps/api/src/chat/chat-visibility.spec.ts` trong `paths` của WO.
3. **CẤM** thêm tên vào `DOCUMENTED_EXCEPTIONS` (hiện đúng 2 phần tử: `countPinned`, `findByClientMessageId`) — thêm là đóng đinh lỗ mở (memory `tests-can-pin-a-hole-open`).
4. testTask RED bắt buộc: gỡ lời gọi helper khỏi đường đọc mới ⇒ `chat-visibility.spec.ts` phải **ĐỎ**.

#### (4) Oversight KHÔNG miễn `assertMember` (BLOCKING 2)

**Oversight KHÔNG miễn `assertMember` ở `CHAT-API-031`; KHÔNG có `/chat/oversight/**/links`** — cùng khuôn tiền lệ S7-CALL đã ghi ở §5.1c dòng ~212.

`chatOversightRoomSummarySchema` (`packages/contracts/src/chat.ts`, gần dòng 637) là schema **ĐỘC LẬP có chủ ý** (docblock: không `members`, không `directKey`, không `unreadCount`) và `chatOversightRoomDetailSchema` (gần dòng 671) **`.extend()`** nó. **CẤM** cho `chatOversightRoomSummarySchema` (và do đó `chatOversightRoomDetailSchema`) `.extend()`/`.pick()`/`.omit()` từ `chatRoomSchema` — nếu BE-1 "dọn trùng lặp" cho nó thừa hưởng `chatRoomSchema` thì hai khoá mới (`lastMessage`, `peer`) biến **CẢ `018a` LẪN `018b`** thành cổng xem trước nội dung tin + đồ thị DM toàn công ty.

testTask bắt buộc: unit assert `chatOversightRoomSummarySchema` **KHÔNG chứa** khoá `lastMessage`/`peer`; deny-path 404 cho actor có `('view','chat-oversight')` nhưng **không thuộc phòng** gọi `GET /chat/rooms/:id/links` (kèm ca ALLOW đối chứng bắt buộc: thành viên phòng gọi cùng route → 200 — memory `deny-cases-vacuous-without-allow-case`).

Ca ALLOW đối chứng (thành viên CÓ `('view','chat-room')`) phải assert MÃ TRẠNG THÁI CHÍNH XÁC `expect(res.status).toBe(200)`; **CẤM** `.not.toBe(403)` — vế phủ định nuốt luôn 500 và biến ca ALLOW thành xanh rỗng (memory `allow-counter-case-not-403-lets-500-through`).

#### (5) Route-census — `CHAT-API-031` là route MỚI (BLOCKING 3)

Theo đúng tiền lệ §5.3 dòng ~271: `S17-CHAT-UX2-BE-2` **PHẢI**:

- Đặt `@RequirePermission('view', 'chat-room')` + `PermissionGuard` trong chuỗi guard của controller mới.
- Khai `apps/api/test/foundation/**` và `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` trong `paths` của WO.
- Regen census bằng `ROUTE_CENSUS_WRITE=1` và **ký phán quyết** (`route-verdicts.ts`).

Thiếu bước này → `route-guard-coverage.e2e-spec.ts` đỏ, hoặc **tệ hơn** route rơi vào `needVerdict` = **fail-open** (memory `route-census-runtime-gate`).

#### (6) Ngữ nghĩa chạm trần của `CHAT-API-031` (BLOCKING 4)

`CHAT-API-031` có trần quét **50** nhưng phải chốt hợp đồng khi chạm trần — theo đúng tiền lệ đã bịt ở `018a` (`chatOversightRoomListSchema` — "cắt trang mà im lặng đọc ra y hệt đã trả hết" là lỗi). Chốt:

- DTO trả **`truncated: true`** khi dừng quét vì chạm trần (không phải vì hết dữ liệu thật).
- **Vẫn trả `nextCursor`** khi `truncated: true` — khác `018a` (`018a` không phân trang); `CHAT-API-031` **có** phân trang nên phải cho lật tiếp.
- testTask bắt buộc: phòng gieo N tin **không có link** vượt trần quét 50 ⇒ phản hồi `truncated: true` **và** `nextCursor` khác null; lật tiếp con trỏ đó ra được trang sau, không treo, không đọc nhầm thành "hết dữ liệu". Ca âm: phòng ít tin, quét hết ⇒ `truncated: false`.

### 5.2 Trạng thái hiện thực (đối chiếu code, 01/08/2026)

| Nhóm | Trạng thái | Ghi chú |
| --- | --- | --- |
| Toàn bộ CHAT-API-001..017 | ⏳ **Chưa có code** | Module `apps/api/src/chat/` đã bị `git rm` ở `2591db13` (de-media-fy) |
| Bảng DB | ✅ Đã tồn tại thật | `0010` + `0050`, RLS+FORCE + append-only + composite FK `0535` |
| DTO Zod | 🟡 Một phần | `packages/contracts/src/chat.ts` còn trong repo, **thiếu** nhiều trường v1 và **thừa** `room_type='channel'` |
| Gateway WS | ✅ Sẵn sàng | `apps/api/src/realtime/` — auth handshake, Valkey adapter, room `co:{companyId}:…`; cụm chat đã bị gỡ ở `CLEAN-DECOUPLE-1` |

> Bản chat cũ (`2591db13~1:apps/api/src/chat/`) chỉ kiểm membership, **không** permission guard, **không** audit, **không** data-scope, và trả `403` chỗ đáng lẽ `404`. Dùng làm **tham chiếu**, KHÔNG khôi phục nguyên trạng.

### 5.3 🔒 Đường đọc-vượt membership (CHAT-DEC-004 — owner chốt 02/08/2026)

```http
GET /api/v1/chat/oversight/rooms
GET /api/v1/chat/oversight/rooms/{room_id}
GET /api/v1/chat/oversight/rooms/{room_id}/messages
GET /api/v1/chat/oversight/audit
```

| Mã | Method | Path | Chức năng | Permission | Membership | Audit |
| --- | --- | --- | --- | --- | --- | --- |
| CHAT-API-018a | GET | `/chat/oversight/rooms` | Tra phòng theo mã/tên/loại — trả **siêu dữ liệu** phòng (tên · loại · số thành viên · hoạt động cuối), **không** kèm nội dung tin | `('view','chat-oversight')` | ❌ bỏ qua (đó là mục đích) | ✅ |
| CHAT-API-018b | GET | `/chat/oversight/rooms/{room_id}` | Chi tiết phòng + danh sách thành viên | `('view','chat-oversight')` | ❌ bỏ qua | ✅ **mỗi lần gọi** |
| CHAT-API-018c | GET | `/chat/oversight/rooms/{room_id}/messages` | Đọc tin theo con trỏ `seq` — **chỉ đọc** | `('view','chat-oversight')` | ❌ bỏ qua | ✅ **mỗi lần gọi** |
| CHAT-API-019 | GET | `/chat/oversight/audit` | Nhật ký đọc-vượt cho CHAT-SCREEN-008 (ai · phòng nào · lúc nào · thành công/từ chối). Query: `cursor` · `limit` · `actorUserId` · `from`/`to` (**NGÀY** `YYYY-MM-DD`) | `('view','chat-oversight')` | — | — |

**Ràng buộc thi công — cả 8 điều đều là điều kiện PASS của FULL gate:**

1. **Path riêng, controller riêng, service method riêng.** Không tái dùng handler của CHAT-API-001/004/009 kèm cờ `isOversight`. Lý do: đường đọc thường phải giữ được tính chất "gọi `assertMember` vô điều kiện" để đọc code là chứng minh được — thêm một nhánh `if` vào đó là mất tính chất ấy vĩnh viễn.
2. **Đường THÀNH CÔNG — audit trong CÙNG transaction, ghi TRƯỚC khi trả dữ liệu.** Ghi audit lỗi ⇒ rollback ⇒ **0 byte** dữ liệu ra ngoài (CHAT-ERR-020). Ghi audit sau khi trả, hoặc ở interceptor ngoài transaction, là **không đạt**.
3. **Đường BỊ TỪ CHỐI — `ChatOversightAuditGuard` chạy TRƯỚC `PermissionGuard`** (CHAT-ERR-019).

   Ba cạm bẫy, cả ba đều PASS review code rồi hỏng lặng lẽ hoặc làm đỏ CI:
   - `AuditService.record(tx, …)` chỉ ghi **trong** tx. Ném 403 trong chính tx đó ⇒ dòng audit từ chối **bị rollback mất** — đúng cái ta định ghi lại.
   - Dùng `PermissionGuard` **class-level** rồi trông chờ ghi audit trong thân controller ⇒ thân controller **không bao giờ chạy** ⇒ **không có dòng audit nào cả**.
   - Nhưng **bỏ `PermissionGuard` cũng không được**: `apps/api/test/foundation/route-guard-coverage.e2e-spec.ts` ép "route khai `@RequirePermission` mà không có `PermissionGuard` trong chuỗi guard ⇒ **ĐỎ** (quyền khai ra chỉ để trang trí)"; còn bỏ luôn metadata thì route rơi vào `needVerdict` và phải ký `route-verdicts.ts`, tức là đưa **route nguy hiểm nhất module** vào rổ "không gate" của census và lật controller sang fail-open cho mọi route thêm sau.

   ⇒ **Chốt — giữ CẢ HAI, đúng thứ tự:**

   ```ts
   @RequirePermission('view', 'chat-oversight', { isSensitive: true })
   @UseGuards(ChatOversightAuditGuard, PermissionGuard)   // ⚠️ THỨ TỰ có ý nghĩa
   ```

   `ChatOversightAuditGuard` chạy trước, tự gọi `PermissionService.can()`; thấy **deny** thì ghi `audit_logs` `resultStatus:'Denied'` trong `withTenant` tx **riêng đã commit**, rồi **`return true`** để **`PermissionGuard` mới là bên ném 403**. Nhờ vậy fail-closed vẫn là mặc định (guard audit không bao giờ tự cho qua), census vẫn xanh, và dòng audit từ chối đã commit trước khi 403 rời server.

   **Lỗi hạ tầng bên trong `ChatOversightAuditGuard` (ghi audit hỏng) → `logger.error` + `return true`, KHÔNG biến thành allow và KHÔNG ném 503** — `PermissionGuard` phía sau vẫn quyết định cuối cùng, nên đường xấu nhất chỉ mất một dòng audit *từ chối*, không mở thêm quyền nào. (Đường **thành công** thì ngược lại: mất audit là **rollback**, xem ràng buộc 2 — vì ở đó audit là điều kiện để dữ liệu được rời server.)

   Thành công ghi `resultStatus:'Success'` trong **cùng** tx với truy vấn đọc ở service. Ca test bắt buộc: *sau khi request trả 403, đếm `audit_logs` vẫn phải **+1***.

   > Vì thêm ~21 route, `S7-CHAT-BE-1` và `S7-CHAT-BE-7` phải khai `apps/api/test/foundation/**` + `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` trong `paths` và **regen census** (`ROUTE_CENSUS_WRITE=1`) kèm ký phán quyết — nếu không, route-census runtime gate đỏ (memory `route-census-runtime-gate`).
4. **Không có biến thể ghi.** Không `POST`/`PATCH`/`DELETE` nào dưới `/chat/oversight/`.
5. **Không có `/chat/oversight/search`** — ràng buộc thiết kế (SPEC-15 §3.3), không phải hạng mục còn thiếu. Ai thêm vào sau này phải mở lại CHAT-DEC-004 với owner.
6. **Không emit WS** cho phiên đọc-vượt: Super Admin không join room `co:{companyId}:chatroom:{roomId}`, không nhận `chat:message` realtime. Đọc-vượt là hành vi **tra cứu có chủ đích tại một thời điểm**, không phải giám sát liên tục — và mỗi lần tra để lại đúng một dòng audit.
7. **Oversight KHÔNG cấp quyền tải tệp.** `ChatMessageFileResolver` (SPEC-15 §13.5) **cấm** đọc cặp `chat-oversight` — resolver chỉ biết `('view','chat-room')` + `assertMember`. Và DTO của `CHAT-API-018c` trả **metadata tệp** (tên · kích thước · loại) **không kèm URL ký hạn ngắn**. Hai lỗ bị bịt ở đây: (a) thêm `chat-oversight` vào resolver sẽ đẻ ra đường tải đi qua route FOUNDATION Files, **không có dòng audit nào của CHAT**; (b) tái dùng nguyên DTO tin nhắn của `CHAT-API-009` (vốn kèm URL ký) làm chính payload oversight phát ra một khoá đọc tệp **không cần membership**. Muốn SA tải được tệp thì phải là endpoint riêng `/chat/oversight/rooms/{room_id}/files/{file_id}` có audit cùng tx — **không có ở v1**.
8. **`CHAT-API-018c` KHÔNG tái dùng truy vấn có JOIN `chat_room_members`.** SA không có hàng membership, nên vị từ dùng chung `(m.visible_from_seq IS NULL OR msg.seq >= m.visible_from_seq)` của SPEC-15 §13.4 không áp dụng — tái dùng sẽ trả **rỗng**, hỏng lặng lẽ theo chiều ngược lại. Oversight đọc toàn bộ dải `seq` của phòng, phân trang bằng con trỏ riêng.

**Hình dạng dòng audit — chốt ở đây để CHAT-SCREEN-008 lọc đúng và assert "đúng 1 hàng" của QA không lệch:**

| Trường | Giá trị |
| --- | --- |
| `action` | `chat.oversight.read` (cột `action` là `text` **không có CHECK** — `apps/api/src/db/schema/audit.ts:33` — nên **không cần migration**) |
| `object_type` | `chat_room` (đã có trong catalog từ mig `0050` **và** trong mảng TS `audit.ts` — chỉ verify) |
| `object_id` | `room_id`. Với `018a` (tra cứu danh sách) → `NULL`, và tiêu chí tìm ghi vào `metadata` |
| `result_status` | **GHI**: `Success` \| `Denied` (đường đọc-vượt chỉ sinh hai giá trị này). **ĐỌC** (`CHAT-API-019`): DTO map đủ 4 giá trị của cột — `Success` \| `Failure` \| `Denied` \| `Error` — cộng `Unknown` cho NULL/giá trị lạ. Hai vế KHÁC NHAU là chủ ý: gộp `Failure`/`Error` vào `Denied` lúc đọc = audit nói SAI loại sự kiện (S7-CHAT-CLEAN-2) |
| `module_code` | `CHAT` |

> **`CHAT-API-019` phải bó truy vấn** `action = 'chat.oversight.read' AND module_code = 'CHAT'`. Không bó là biến một cặp quyền CHAT thành **cổng đọc audit toàn hệ thống**. Ca test bắt buộc: gieo dòng audit của module khác → `019` **không** trả về.
>
> **Bộ lọc của `CHAT-API-019` (`S7-CHAT-BE-9`) — bốn ràng buộc, đều là điều kiện PASS của FULL gate:**
>
> 1. **Bộ lọc chỉ THU HẸP.** `actorUserId` / `from` / `to` đứng SAU ba vế bó cứng (`company_id`, `action`, `module_code`). Ca test bắt buộc: gieo dòng audit **module khác nhưng CÙNG `actor_user_id`** rồi lọc theo actor đó → `019` **không** trả về. Nới một vế bó cứng "cho bộ lọc linh hoạt hơn" là mở lại đúng cổng ở đoạn trên.
> 2. **`from`/`to` là NGÀY `YYYY-MM-DD`, quy đổi ở SERVER theo cột **`companies.timezone`**.** Đọc đúng nguồn mà sản phẩm GHI là một phần của ràng buộc: khoá KV `company.timezone` (DB-10 §11.2) hiện **không có writer nào**, còn ô múi giờ admin thật sự bấm (`PATCH /settings/company`) ghi vào cột — đọc nhầm nguồn thì CHAT-SCREEN-008 cắt cửa sổ theo mặc định trong khi DASHBOARD đã theo TZ mới, và người điều tra mất nửa ngày bằng chứng mà không có tín hiệu nào. Ca test phải ghim **nguồn**, không chỉ ghim cơ chế. Hợp đồng **từ chối** mốc thời gian đầy đủ (`…T17:00:00Z`) — nhận vào là để client tự quy đổi múi giờ, và khi đó hai người ngồi hai múi giờ nhận hai kết quả khác nhau cho cùng một câu hỏi trên một sổ kiểm soát. Biên trên là **nửa mở** tại `00:00` ngày kế: `created_at` là `timestamptz` (micro-giây) nên mốc đóng `23:59:59.999` làm mất những dòng cuối ngày — HTTP 200, không lỗi.
> 3. **Con trỏ keyset phải mang dấu vân của bộ lọc.** Con trỏ sinh ở bộ lọc A dùng lại với bộ lọc B → **400 `CHAT-ERR-016`**, KHÔNG im lặng trả một trang cắt theo tập kết quả khác. Dấu vân tính trên **instant đã quy đổi**, nên đổi `company.timezone` giữa hai lần lật trang cũng làm con trỏ hết hiệu lực.
> 4. **Vẫn KHÔNG ghi audit `Success`** (cột Audit của `019` ở bảng trên vẫn là `—`). Thêm bộ lọc không phải lý do để đổi điều đó: đọc nhật ký không tiết lộ một byte nội dung chat nào, và ghi `Success` ở đây làm chính CHAT-SCREEN-008 tự sinh nhiễu mỗi lần mở.
>
> **`CHAT-API-018a` hẹp hơn "liệt kê mọi phòng":** yêu cầu từ khoá tìm ≥ 2 ký tự, có trần trang, và audit ghi lại tiêu chí tìm. Không có ràng buộc này thì một lần gọi xuất được đồ thị "ai nhắn riêng với ai" của cả công ty — rộng hơn hẳn ngoại lệ mà owner chốt ("mở **đích danh** một phòng").

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
| `chat:room` | server → client | `{ roomId, action, room? }` | như trên + `co:{companyId}:chatuser:{userId}` của người bị ảnh hưởng |
| `chat:reaction` *(S8)* | server → client | `{ messageId, roomId, emoji, count, actorUserId }` | `co:{companyId}:chatroom:{roomId}` |
| `chat:typing` *(S8)* | server → client | `{ roomId, userId }` — **không** nội dung đang gõ | như trên |
| `chat:presence` *(S8)* | server → client | `{ userId, status }` | `co:{companyId}:chatuser:{userId}` của những người có chung phòng `direct` |
| `chat:call` *(S7-CALL)* | server → client | `{ callId, roomId, kind, status, initiatorUserId, startedAt, action }` — `action ∈ ringing\|accepted\|rejected\|cancelled\|ended\|missed` | `co:{companyId}:chatuser:{userId}` của **từng người tham gia cuộc gọi** |

Ràng buộc:

- **Không có `@SubscribeMessage` nào** — client không ghi gì qua WS (CHAT-DEC-005). Gửi tin đi REST (CHAT-API-010). *(S7-CALL-RT-1: ratchet nay có allowlist đúng **một** phần tử — `realtime/call-signalling.gateway.ts` — và một khẳng định **riêng** giữ `/ws` ở mức 0. Xem `chat-realtime-structure.spec.ts`.)*
- *(S7-CALL)* **`chat:call` đi `/ws`, KHÔNG đi `/ws-call`** — quan hệ nhân quả, không phải lựa chọn: người được gọi chưa biết có cuộc gọi thì chưa nối `/ws-call`. Đích là `chatuser` của **người tham gia** (bảng `chat_call_participants`), không phải cả phòng: thành viên vào phòng sau khi cuộc gọi bắt đầu không được mời và không cần biết nó tồn tại. Payload **không** mang `participants[]` (mang `outcome`/`joinedAt` của người khác = trạng thái per-user phát cho cả nhóm). Phát **SAU commit** ở 6 đường của `ChatCallsService` + job `CHAT_CALL_RINGING_TIMEOUT`; ratchet `chat-realtime-after-commit.spec.ts` đếm đúng số đường.
- *(S7-CALL)* ⚠️ Hệ quả của việc dùng `chatuser`: ai có `('call','chat-room')` mà thiếu `('view','chat-room')` **không bao giờ đổ chuông** (socket của họ không vào room đó). Hai cặp luôn seed cùng nhau cho 4 role canonical — đây là một ràng buộc, không phải trùng hợp.
- *(S8)* **Ba sự kiện mới KHÔNG mở kênh client→server.** `chat:typing` do **REST** `CHAT-API-023` kích hoạt; `chat:presence` do **vòng đời kết nối** (`handleConnection`/`handleDisconnect`) kích hoạt. Ratchet `chat-realtime-structure.spec.ts` (0 `@SubscribeMessage` toàn `apps/api/src`) **phải vẫn xanh** sau wave S8 — xem CHAT-DEC-017.
- *(S8)* ⚠️ **Đích của `chat:room`/`chat:presence` là `chatuser`, KHÔNG phải `user`** — sửa 06/08/2026 (S8-CHAT-UX-RT-1) cho doc khớp code đã qua FULL gate S7. Room `co:{co}:user:{uid}` chứa **mọi** socket đã xác thực (đích của `notification:new`), kể cả của người đã bị **thu hồi** cặp `view:chat-room`; bắn sự kiện CHAT vào đó là đi vòng qua cổng quyền WS — cổng chỉ chạy một lần lúc `handleConnection`. Room `co:{co}:chatuser:{uid}` chỉ nhận socket **đã qua** cổng đó (`apps/api/src/realtime/rooms.ts`).
- *(S8)* **Khoá presence trên Valkey BẮT BUỘC mang tiền tố môi trường.** Valkey dùng chung cho cả 4 môi trường và **không** có tiền tố kênh sẵn; thiếu prefix thì người đang mở dev-online hiện "đang online" với người dùng PROD. Khoá phải có **TTL** — ngắt kết nối bẩn (kill process) không được để lại trạng thái online vĩnh viễn, vì `handleDisconnect` không đảm bảo chạy.
- Socket **join tất cả phòng của user ngay tại kết nối**, danh sách đọc từ DB phía server; **không** nhận danh sách phòng từ client.
- Membership đổi → server buộc socket `join`/`leave` ngay, không đợi kết nối lại.
- Mọi payload `.parse()` qua schema contracts trước khi emit (`RealtimeEmitterService`) — cấm `io.emit` row DB thẳng.
- `REALTIME_ENABLED=false` → gateway từ chối mọi kết nối ở handshake; FE chuyển sang bù bằng `afterSeq` mỗi 10 giây. **Nghiệp vụ vẫn phải đúng hoàn toàn** ở chế độ này.
- *(S17)* Payload WS `chat:room` **HẸP HƠN** DTO REST thêm một nấc: `room.peer` đi qua bản đã **strip `avatarUrl`**; `.omit()` ở `wsChatRoomEventSchema` không với tới khoá lồng nên phải `.extend()` (API-13 §5.1d). FE nhận sự kiện **giữ nguyên** `peer.avatarUrl` đang có, **không** ghi đè bằng `null`. Wave S17 **không thêm sự kiện WS nào** — ratchet 0 `@SubscribeMessage` và luật một-tệp-socket phải **vẫn xanh**.

### 7a. Namespace `/ws-call` — bắt tay WebRTC *(S7-CALL, CHAT-DEC-020)*

> ⚠️ **Namespace RIÊNG (hàng rào R1).** `/ws` ở §7 **giữ nguyên 0 `@SubscribeMessage`** — ratchet `chat-realtime-structure.spec.ts` phải còn một khẳng định **riêng** giữ mức 0 cho `/ws` kể cả sau khi wave CALL nới phạm vi quét. `/ws-call` có handler inbound **không phải giấy phép** thêm handler vào `/ws`.

Đây là **kênh DUY NHẤT** trong toàn hệ thống mà client được ghi lên WS, và chỉ ghi **tín hiệu vận chuyển tạm thời** — không phải dữ liệu nghiệp vụ.

**Allowlist ĐÓNG — đúng 8 sự kiện inbound (hàng rào R2):**

| Sự kiện | Payload | Kiểm trước khi xử lý |
| --- | --- | --- |
| `call:join` | `{ callId }` | là người tham gia cuộc gọi **đang sống** |
| `call:leave` | `{ callId }` | như trên |
| `call:sdp-offer` | `{ callId, toUserId, sdp }` | người gửi ∈ cuộc gọi · `toUserId` ∈ cuộc gọi |
| `call:sdp-answer` | `{ callId, toUserId, sdp }` | như trên |
| `call:ice-candidate` | `{ callId, toUserId, candidate }` | như trên |
| `call:media-state` | `{ callId, micOn, camOn }` | là người tham gia |
| `call:ping` | `{ callId }` | là người tham gia (phát hiện rớt) |
| `call:screen-state` | `{ callId, sharing }` | là người tham gia |

Ràng buộc:

- **Sự kiện ngoài danh sách → NGẮT kết nối + ghi `user_security_events`** (CHAT-ERR-030). Không trả lỗi nghiệp vụ: đây là tín hiệu dò cửa, không phải sai đầu vào của người dùng hợp lệ.
- **`sdp`/`candidate` là CHUỖI MỜ** (hàng rào R3): có **trần độ dài**, server **không parse**, **không đọc**, **không lưu**, **không** đưa vào bất kỳ DTO nào. Ngày nào ta lưu SDP thì ngoại lệ `CHAT-DEC-020` **hết hiệu lực**.
- **Mỗi sự kiện kiểm LẠI tư cách tham gia cuộc gọi** — **không** tin vào việc socket đang ở trong room. Cổng quyền WS chỉ chạy một lần lúc `handleConnection`; tư cách có thể mất giữa chừng (memory `ws-permission-gate-needs-its-own-room`).
- **KHÔNG có trong danh sách, cố ý đi REST** (hàng rào R4): `call:invite` · `call:accept` · `call:reject` · `call:cancel` · `call:hangup` — và mọi thứ thuộc tin nhắn/thành viên/ghim/đã-đọc. Đây là **điểm khác quan trọng nhất so với LMS**, nơi cả vòng đời chạy trong handler socket.
- Cưỡng chế danh tính ở **`allowRequest`**, không dựa vào `cors` — `engine.io` `cors` **không từ chối ai cả** (memory `engineio-cors-never-rejects`).
- Mọi payload `.parse()` qua Zod ở biên (`packages/contracts`) trước khi xử lý.

**Chiều RA của `/ws-call`** *(S7-CALL-RT-1 — hợp đồng phát, KHÔNG phải allowlist inbound; hai danh sách cố ý tách nhau để thêm một sự kiện phát không tự nới cửa vào)*:

| Sự kiện | Payload | Đích |
| --- | --- | --- |
| `call:sdp-offer` · `call:sdp-answer` | `{ callId, fromUserId, sdp }` | `co:{companyId}:calluser:{toUserId}` |
| `call:ice-candidate` | `{ callId, fromUserId, candidate }` | như trên |
| `call:media-state` | `{ callId, userId, micOn, camOn }` | `co:{companyId}:call:{callId}` (trừ người gửi) |
| `call:screen-state` | `{ callId, userId, sharing }` | như trên |
| `call:peer-joined` · `call:peer-left` | `{ callId, userId }` | như trên |
| `call:pong` | `{ callId }` | trả qua **ack** của chính khung `call:ping` |

- **`fromUserId`/`userId` do SERVER gán** từ phiên đã xác thực — không bao giờ đọc từ payload client (Zod strip khoá giả mạo).
- **7/8 handler trả `undefined`.** Giá trị trả về của handler đi vào `ack`, mà **client tự bật được** bằng cách gắn callback ⇒ đó là một đường phát KHÔNG qua masking. Chỉ `call:ping` trả dữ liệu, và dữ liệu đó đã `.parse()`.
- **Ba lớp từ chối, ba xử lý khác nhau:** (A) khung sai giao thức — ngoài allowlist · sai Zod · vượt trần ⇒ ghi + ngắt; (B) đẩy tín hiệu **relay** vào cuộc gọi mình chưa từng được mời ⇒ ghi + ngắt; (C) **đua vòng đời** — đã từng ở trong cuộc gọi nhưng nó vừa kết thúc, hoặc 5 sự kiện không-relay của người chưa được mời (trần 20 người) ⇒ **bỏ im lặng, không ghi, không ngắt**. Gộp C vào B làm mỗi cuộc gọi kết thúc bình thường đẻ hàng append-only và ngắt kết nối người dùng hợp lệ.
- **Payload `user_security_events` là bộ ĐÓNG** `{ ns, event, reason, code }`, `event` lọc qua allowlist. Tuyệt đối **không** echo khung: `AuditMaskerService` mask theo tên khoá và `sdp`/`candidate` không nằm trong đó ⇒ lưu SDP vào bảng append-only sẽ **huỷ hiệu lực `CHAT-DEC-020`**.
- **Trần:** khung/socket (chống khuếch đại DoS lên DB, kiểm TRƯỚC mọi truy vấn) · ghi sự kiện an ninh ≤1/kết nối và có hạn mức/người · số handshake/người.
- **`/ws-call` nằm TRONG đường thu hồi phiên:** `severUserSessions` ngắt **cả hai** namespace — khoá tài khoản không xoá `chat_room_members`/`chat_call_participants`, nên bỏ vế này là để socket của người đã bị khoá tiếp tục relay vô thời hạn.
- **`REALTIME_ENABLED=false` ⇒ `/ws-call` từ chối mọi kết nối**, và **không có fallback REST** cho SDP/ICE (bản chất là kênh độ trễ thấp) ⇒ tắt cờ = không gọi được. FE phải hiện lỗi rõ ràng, không treo khung "đang kết nối".

---

## 8. Mã lỗi

**30** mã `CHAT-ERR-001..030` (021-025 thêm ở wave S8-CHAT-UX; **026-030 thêm ở wave S7-CALL**) định nghĩa tại [SPEC-15 §12](<../SPEC/SPEC-15 CHAT.md>). Ánh xạ HTTP:

| HTTP | Dùng cho |
| --- | --- |
| `200` | Idempotent trả bản ghi đã có (CHAT-ERR-014, mở DM lần 2) |
| `400` / `422` | Validate đầu vào: CHAT-ERR-002/003/004/009/016 · *(S8)* đặt avatar cho phòng `direct` (CHAT-ERR-022) · react vào tin đã thu hồi (CHAT-ERR-024) · emoji ngoài bộ đóng (CHAT-ERR-025) · *(S7-CALL)* **CHAT-ERR-029** — thao tác vòng đời lên cuộc gọi đã kết thúc (FSM một chiều, không hồi sinh) |
| `403` | Đã là thành viên nhưng thiếu quyền/vai trò: CHAT-ERR-006/011/012/013 · tệp CHAT-ERR-015 · *(S8)* không đủ tư cách đặt avatar theo loại phòng (CHAT-ERR-023, SPEC-15 §11b) · *(S7-CALL)* **CHAT-ERR-027** — là thành viên nhưng thiếu cặp `('call','chat-room')` · **thiếu cặp `('view','chat-oversight')` trên `/chat/oversight/*`: CHAT-ERR-019** (403 chứ không 404 — người gọi biết mình đang dùng chức năng quản trị, không có gì để dò) |
| `404` | **Không phải thành viên** hoặc phòng/tin không tồn tại: CHAT-ERR-001 · **và CHAT-ERR-017 khi `roomId` chỉ định không thuộc phạm vi người tìm** · *(S7-CALL)* **CHAT-ERR-026** — gọi/thao tác cuộc gọi ở phòng không thuộc, **kể cả người có `('view','chat-oversight')`** |
| `409` | Xung đột trạng thái: gửi vào phòng đã lưu trữ (CHAT-ERR-005), ghim quá hạn mức tin (CHAT-ERR-008) **và ghim quá 10 hội thoại (CHAT-ERR-021)** · *(S7-CALL)* **CHAT-ERR-028** — phòng đã có cuộc gọi đang sống |
| `429` | *(S7-CALL)* **KHÔNG có mã `CHAT-ERR`** — `POST /chat/rooms/:id/calls` vượt trần lời mời/phút/người (`CHAT_CALL_INVITE_MAX_PER_MIN`, mặc định 10). Trả mã nền **`SYSTEM-ERR-RATE-LIMIT`**: vượt tần suất là hàng rào hạ tầng chống bơm `chat_call_participants` (append-only, không job dọn), **không** phải rule nghiệp vụ ⇒ cố ý KHÔNG chiếm một ô trong 30 mã §12. Đếm cả lần thử kết thúc bằng 404/409/422 |
| `500` | **CHAT-ERR-020** — ghi `audit_logs` của đường đọc-vượt thất bại ⇒ rollback. Trả thân lỗi chuẩn API-01; **tuyệt đối không** trả `200` với thân rỗng (đó là "đọc-vượt không dấu vết" ngụy trang thành kết quả trống) |
| `501`/`405` | Sửa tin nhắn (CHAT-ERR-007) — không hỗ trợ ở v1 |

> ⚠️ **CHAT-ERR-017 trả `404`, không phải `400`/`422`.** Nếu `roomId` không-thuộc trả `422` còn `roomId` không-tồn-tại trả `404` thì chính ô tìm kiếm thành oracle dò sự tồn tại của phòng — đúng thứ CHAT-ERR-001 dựng `404` để chặn. Hai trường hợp phải trả **cùng một** phản hồi. Truy vấn `q` < 2 ký tự vẫn là `400`/`422` (lỗi validate thuần, không tiết lộ gì).

CHAT-ERR-010 (mention người ngoài phòng) và CHAT-ERR-018 (`last_read_seq` lùi) **không** trả lỗi — bỏ qua im lặng theo thiết kế.

> ⚠️ **CHAT-ERR-030 KHÔNG có mã HTTP** — nó sống trên `/ws-call` (§7a), không phải REST. Sự kiện inbound ngoài allowlist 8, payload sai Zod, hoặc `sdp`/`candidate` vượt trần độ dài ⇒ **ngắt kết nối** + ghi `user_security_events`. Cố ý **không** trả thân lỗi mô tả: phản hồi càng cụ thể thì càng tiện cho việc dò danh sách sự kiện được chấp nhận.

---

## 9. Definition of Done cho API-13

- [ ] Danh sách endpoint §5.1 khớp SPEC-15 §15, không có endpoint nào bỏ qua cột Membership
- [ ] DTO chi tiết bổ sung ở từng WO backend, đồng bộ `packages/contracts/src/chat.ts` (bỏ `channel`, thêm trường v1)
- [ ] Cột "Trạng thái hiện thực" §5.2 cập nhật khi mỗi WO backend đóng
- [ ] Lệch giữa tài liệu và code ⇒ **sửa code**, không sửa ngầm tài liệu
