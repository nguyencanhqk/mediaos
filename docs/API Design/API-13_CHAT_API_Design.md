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
| CHAT-API-017 | GET | `/chat/rooms/{room_id}/files` | Tệp đã gửi trong phòng, URL ký hạn ngắn | `('view','chat-room')` | ✅ | — |

> **Notation permission:** Chuỗi `('action','resource')` là **cặp engine thực thi** (permission-matrix-spec §9c + seed DB-12 §9 bước D) — không phải chuỗi dotted `MODULE.RESOURCE.ACTION` hiển thị FE.

#### 5.1b Endpoint bổ sung — wave S8-CHAT-UX (SPEC-15 §5.1b · CHAT-DEC-014…019)

> **KHÔNG cặp quyền mới.** Cả 8 endpoint dưới đây dùng lại đúng 3 cặp đã seed ở v1 — xem SPEC-15 §11a. Hệ quả: 0 migration seed quyền, 0 đổi `SENSITIVE_CAPABILITY_ALLOWLIST`.

| Mã | Method | Path | Chức năng | Permission | Membership | Audit |
| --- | --- | --- | --- | --- | --- | --- |
| CHAT-API-018a | PUT | `/chat/rooms/{room_id}/pin` | Ghim hội thoại (per-user). Vượt **10** → 409 CHAT-ERR-021 | `('view','chat-room')` | ✅ | — |
| CHAT-API-018b | DELETE | `/chat/rooms/{room_id}/pin` | Bỏ ghim | `('view','chat-room')` | ✅ | — |
| CHAT-API-019 | PUT | `/chat/rooms/{room_id}/mute` | `{ mutedUntil \| null }` — tắt/bật thông báo phòng. **Đóng lỗ v1**: cột có từ `0538` mà chưa từng có đường ghi | `('view','chat-room')` | ✅ | — |
| CHAT-API-020 | POST | `/chat/rooms/{room_id}/unread` | Đánh dấu chưa đọc thủ công (`marked_unread_at`). **KHÔNG** lùi `last_read_seq` | `('view','chat-room')` | ✅ | — |
| CHAT-API-021a | POST | `/chat/rooms/{room_id}/avatar` | Đặt ảnh đại diện phòng từ `fileId` đã upload+confirm. `direct` → 422 CHAT-ERR-022; không đủ tư cách → 403 CHAT-ERR-023 | `('update','chat-room')` | ✅ + tư cách theo **SPEC-15 §11b** | ✅ |
| CHAT-API-021b | DELETE | `/chat/rooms/{room_id}/avatar` | Gỡ ảnh đại diện | `('update','chat-room')` | ✅ + §11b | ✅ |
| CHAT-API-021c | POST | `/chat/rooms/{room_id}/avatar/upload-url` | Presign upload — **wrapper riêng của CHAT**, sao khuôn `ChatFilesService` (S7-CHAT-BE-8) | `('update','chat-room')` | ✅ + §11b | — |
| CHAT-API-022a | PUT | `/chat/messages/{message_id}/reactions/{emoji}` | Thả cảm xúc. Idempotent (thả 2 lần = 1 hàng). Tin đã thu hồi → 422 CHAT-ERR-024; emoji ngoài bộ đóng → 422 CHAT-ERR-025 | `('send','chat-message')` | ✅ (phòng chứa tin) | — |
| CHAT-API-022b | DELETE | `/chat/messages/{message_id}/reactions/{emoji}` | Bỏ thả. Chưa thả → **204**, không 404 | `('send','chat-message')` | ✅ | — |
| CHAT-API-023 | POST | `/chat/rooms/{room_id}/typing` | Báo "đang gõ" → fan-out WS. **204**, 0 ghi DB, 0 audit | `('send','chat-message')` | ✅ | — |

⚠️ **Vì sao ghim/tắt/đánh-dấu gate bằng `('view','chat-room')` chứ không phải một cặp mạnh hơn:** ba thứ đó là **tuỳ chọn cá nhân trên hàng membership của chính mình**. Gate mạnh hơn tạo ra role "đọc được phòng mà không tắt nổi thông báo của chính mình" — đúng họ lỗi `read-path-gate-pair-must-match-download-pair`.

⚠️ **CHAT-API-021c KHÔNG được thay bằng `POST /foundation/files/upload`.** Cặp `('upload','foundation-file')` chỉ có ở `SA` · `company-admin` · `QUẢN LÝ CẤP CAO` (mig `0435:376`) ⇒ trưởng nhóm thường sẽ không đặt được avatar. Đây đúng là lỗ đã phải vá ở `S7-CHAT-BE-8` cho đính kèm; đừng lặp lại.

⚠️ **CHAT-API-007a phải trả thêm `avatarUrl` cho từng thành viên** (CHAT-DEC-019) — đó là **nguồn duy nhất** để FE vẽ avatar người gửi trong khung chat. Ký **1 lần/phòng** ở đây, **không** ký theo từng tin. Người đã rời phòng vẫn phải có trong danh sách (kèm `leftAt`), nếu không tin cũ của họ mất cả avatar lẫn tên.

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

Ràng buộc:

- **Không có `@SubscribeMessage` nào** — client không ghi gì qua WS (CHAT-DEC-005). Gửi tin đi REST (CHAT-API-010).
- *(S8)* **Ba sự kiện mới KHÔNG mở kênh client→server.** `chat:typing` do **REST** `CHAT-API-023` kích hoạt; `chat:presence` do **vòng đời kết nối** (`handleConnection`/`handleDisconnect`) kích hoạt. Ratchet `chat-realtime-structure.spec.ts` (0 `@SubscribeMessage` toàn `apps/api/src`) **phải vẫn xanh** sau wave S8 — xem CHAT-DEC-017.
- *(S8)* ⚠️ **Đích của `chat:room`/`chat:presence` là `chatuser`, KHÔNG phải `user`** — sửa 06/08/2026 (S8-CHAT-UX-RT-1) cho doc khớp code đã qua FULL gate S7. Room `co:{co}:user:{uid}` chứa **mọi** socket đã xác thực (đích của `notification:new`), kể cả của người đã bị **thu hồi** cặp `view:chat-room`; bắn sự kiện CHAT vào đó là đi vòng qua cổng quyền WS — cổng chỉ chạy một lần lúc `handleConnection`. Room `co:{co}:chatuser:{uid}` chỉ nhận socket **đã qua** cổng đó (`apps/api/src/realtime/rooms.ts`).
- *(S8)* **Khoá presence trên Valkey BẮT BUỘC mang tiền tố môi trường.** Valkey dùng chung cho cả 4 môi trường và **không** có tiền tố kênh sẵn; thiếu prefix thì người đang mở dev-online hiện "đang online" với người dùng PROD. Khoá phải có **TTL** — ngắt kết nối bẩn (kill process) không được để lại trạng thái online vĩnh viễn, vì `handleDisconnect` không đảm bảo chạy.
- Socket **join tất cả phòng của user ngay tại kết nối**, danh sách đọc từ DB phía server; **không** nhận danh sách phòng từ client.
- Membership đổi → server buộc socket `join`/`leave` ngay, không đợi kết nối lại.
- Mọi payload `.parse()` qua schema contracts trước khi emit (`RealtimeEmitterService`) — cấm `io.emit` row DB thẳng.
- `REALTIME_ENABLED=false` → gateway từ chối mọi kết nối ở handshake; FE chuyển sang bù bằng `afterSeq` mỗi 10 giây. **Nghiệp vụ vẫn phải đúng hoàn toàn** ở chế độ này.

---

## 8. Mã lỗi

**25** mã `CHAT-ERR-001..025` (021-025 thêm ở wave S8-CHAT-UX) định nghĩa tại [SPEC-15 §12](<../SPEC/SPEC-15 CHAT.md>). Ánh xạ HTTP:

| HTTP | Dùng cho |
| --- | --- |
| `200` | Idempotent trả bản ghi đã có (CHAT-ERR-014, mở DM lần 2) |
| `400` / `422` | Validate đầu vào: CHAT-ERR-002/003/004/009/016 · *(S8)* đặt avatar cho phòng `direct` (CHAT-ERR-022) · react vào tin đã thu hồi (CHAT-ERR-024) · emoji ngoài bộ đóng (CHAT-ERR-025) |
| `403` | Đã là thành viên nhưng thiếu quyền/vai trò: CHAT-ERR-006/011/012/013 · tệp CHAT-ERR-015 · *(S8)* không đủ tư cách đặt avatar theo loại phòng (CHAT-ERR-023, SPEC-15 §11b) · **thiếu cặp `('view','chat-oversight')` trên `/chat/oversight/*`: CHAT-ERR-019** (403 chứ không 404 — người gọi biết mình đang dùng chức năng quản trị, không có gì để dò) |
| `404` | **Không phải thành viên** hoặc phòng/tin không tồn tại: CHAT-ERR-001 · **và CHAT-ERR-017 khi `roomId` chỉ định không thuộc phạm vi người tìm** |
| `409` | Xung đột trạng thái: gửi vào phòng đã lưu trữ (CHAT-ERR-005), ghim quá hạn mức tin (CHAT-ERR-008) **và ghim quá 10 hội thoại (CHAT-ERR-021)** |
| `500` | **CHAT-ERR-020** — ghi `audit_logs` của đường đọc-vượt thất bại ⇒ rollback. Trả thân lỗi chuẩn API-01; **tuyệt đối không** trả `200` với thân rỗng (đó là "đọc-vượt không dấu vết" ngụy trang thành kết quả trống) |
| `501`/`405` | Sửa tin nhắn (CHAT-ERR-007) — không hỗ trợ ở v1 |

> ⚠️ **CHAT-ERR-017 trả `404`, không phải `400`/`422`.** Nếu `roomId` không-thuộc trả `422` còn `roomId` không-tồn-tại trả `404` thì chính ô tìm kiếm thành oracle dò sự tồn tại của phòng — đúng thứ CHAT-ERR-001 dựng `404` để chặn. Hai trường hợp phải trả **cùng một** phản hồi. Truy vấn `q` < 2 ký tự vẫn là `400`/`422` (lỗi validate thuần, không tiết lộ gì).

CHAT-ERR-010 (mention người ngoài phòng) và CHAT-ERR-018 (`last_read_seq` lùi) **không** trả lỗi — bỏ qua im lặng theo thiết kế.

---

## 9. Definition of Done cho API-13

- [ ] Danh sách endpoint §5.1 khớp SPEC-15 §15, không có endpoint nào bỏ qua cột Membership
- [ ] DTO chi tiết bổ sung ở từng WO backend, đồng bộ `packages/contracts/src/chat.ts` (bỏ `channel`, thêm trường v1)
- [ ] Cột "Trạng thái hiện thực" §5.2 cập nhật khi mỗi WO backend đóng
- [ ] Lệch giữa tài liệu và code ⇒ **sửa code**, không sửa ngầm tài liệu
