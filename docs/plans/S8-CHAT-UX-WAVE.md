# Kế hoạch thi công wave S8-CHAT-UX — nâng cấp giao diện Chat

> **Loại:** kế hoạch cấp WAVE (không phải plan của một WO). Plan chi tiết từng WO nằm ở `docs/plans/S8-CHAT-UX-<WO>.md`, viết ngay trước khi thi công WO đó.
> **Nguồn sự thật nghiệp vụ:** [SPEC-15 CHAT](<../SPEC/SPEC-15 CHAT.md>) · [DB-12](<../DB/DB-12 CHAT Database Design.md>) · [API-13](<../API Design/API-13_CHAT_API_Design.md>) · [ma trận phân quyền](../permission-matrix-spec.md)
> **Ngày lập:** 05/08/2026 · **Trạng thái:** **owner CHỐT §3 ngày 05/08/2026** (theo đề xuất, cả 6 quyết định) · `FE-1` **XONG**, đang hoà docs ở `DOC-1`.
>
> ⚠️ **Đánh số quyết định bắt đầu từ `CHAT-DEC-014`**, KHÔNG phải 013: `CHAT-DEC-013` đã bị chiếm trong SPEC-15 §22 (điều kiện gửi `CHAT_DIRECT_MESSAGE`, chốt 02/08/2026). Bản nháp đầu của file này đánh 013…018 và đã được đổi lại 014…019.
> **Yêu cầu gốc (owner, 05/08/2026):** "nâng cấp giao diện chat: chia nhóm hội thoại · ghim hội thoại · cài avatar cho nhóm · avatar người gửi trong khung chat · tắt thông báo + đánh dấu chưa đọc từng phòng · đang gõ/đang online · thả cảm xúc".

---

## 1. Điểm xuất phát (ĐO THẬT ngày 05/08/2026, không theo trí nhớ)

| Sự việc | Bằng chứng |
| --- | --- |
| Wave S7-CHAT đã đóng, hàng đợi READY rỗng | `69fa2fe3` (docs/STATUS regen) · CLEAN-1 `23bf11b5` · QA-1 `ce72e5d3` đều trên master |
| Migration head | `0542_s7chatclean1_drop_dead_columns` (210 file trong `apps/api/migrations`) ⇒ wave này bắt đầu từ **`0543`** |
| `chat_rooms` **không có** cột avatar | `apps/api/src/db/schema/communication.ts:153-207` — 0 cột ảnh/avatar |
| `chat_room_members` **không có** cột ghim | cùng file `:279-312` — có `muted_until`, `last_read_seq`, `left_at`; **không** có `pinned_at` |
| "Ghim" hiện có là ghim **TIN**, không phải ghim **HỘI THOẠI** | SPEC-15 §10 CHAT-FUNC-010 + `chat_messages.pinned_at` (mig `0050`) — hai thứ khác nhau hoàn toàn |
| Danh sách phòng đang **phẳng, 0 avatar** | `apps/app/src/components/chat/RoomListPanel.tsx:151-204` — `<ul>` một mức, mỗi dòng chỉ text + badge |
| DTO tin nhắn có `senderName`, **không có avatar người gửi** | `packages/contracts/src/chat.ts` — `chatMessageSchema` dừng ở `senderName` |
| DTO thành viên có `userName`, **không có avatar** | cùng file — `chatRoomMemberSchema` |
| `muted_until` **có cột, có GRANT, chưa có UI** | mig `0538:258` cấp `UPDATE (…, muted_until, …)`; grep `apps/app` không có lối vào |
| Phòng `department`/`project` **không có ai là admin** | `chat-derived-rooms-sync.service.ts` — 0 lần gán `role='admin'`; câu upsert chỉ `ON CONFLICT (room_id,user_id) DO UPDATE SET left_at = NULL` (`:286`) |
| Job đối soát **KHÔNG ghi đè** cột phòng ngoài vòng đời | `0540:72-73` — job chỉ gọi `restoreRoom`/`archiveRoom`; upsert thành viên chỉ chạm `left_at` (`:286`) ⇒ `pinned_at`/`avatar_file_id` **an toàn trước job** |

### 1.1 Hai ràng buộc kiến trúc chi phối cả wave

**(a) `CHAT-DEC-005` — WS MỘT CHIỀU.** `apps/api/src/realtime/chat-realtime-structure.spec.ts:26` ép **0 `@SubscribeMessage` trong toàn bộ `apps/api/src`**, quét đệ quy, đã bỏ comment trước khi so khớp. Tính năng "đang gõ" theo bản năng là client→server ⇒ **đụng thẳng ratchet này**. Xem quyết định `CHAT-DEC-017`.

**(b) Quyền ghi `chat_rooms` / `chat_room_members` là COLUMN-LEVEL.** `0540:61-89` đã REVOKE vế cấp bảng rồi GRANT lại đúng 11 cột của `chat_rooms` và 3 cột của `chat_room_members`. Hệ quả bắt buộc cho wave này:

- Thêm cột mới mà quên `GRANT UPDATE (<cột>)` ⇒ **42501 lúc chạy**, không phải lúc build, không lint nào bắt.
- **CẤM** viết `REVOKE UPDATE ON <bảng>` rồi GRANT lại — REVOKE cấp bảng **cuốn sạch mọi column-GRANT** của bảng đó (`0540:34-48`, memory `revoke-table-grant-wipes-column-grants`). Wave này chỉ **GRANT thêm cột**, không REVOKE gì.
- Lưới bắt: mục H của `s7-chat-db1-invariants.int-spec.ts` chạy đường ghi THẬT của từng writer. Thêm writer thứ 5/6 thì **phải** thêm ca vào mục H, nếu không cột mới không có ai chứng minh là ghi được.

---

## 2. Phạm vi wave

### 2.1 Trong wave (owner chọn 05/08/2026)

| # | Nội dung | Tầng chạm | Ghi chú |
| --- | --- | --- | --- |
| 1 | **Chia nhóm hội thoại** theo loại phòng (Ghim · Riêng · Nhóm · Phòng ban · Dự án), thu/mở từng mục | **FE thuần** | Không bảng mới, không API mới — `roomType` đã có trong DTO |
| 2 | **Ghim hội thoại** (per-user) | DB + BE + FE | `chat_room_members.pinned_at` |
| 3 | **Avatar phòng** cho `group` · `department` · `project` | DB + BE + FE | `chat_rooms.avatar_file_id` |
| 4 | **Avatar người gửi** trong khung chat + gộp tin liên tiếp cùng người | BE (1 route roster) + FE | KHÔNG ký URL theo từng tin — xem `CHAT-DEC-019` |
| 5 | **Menu ngữ cảnh mỗi phòng**: ghim · tắt thông báo · đánh dấu chưa đọc · lưu trữ | BE + FE | `muted_until` đã có cột, chỉ thiếu đường ghi + UI |
| 6 | **Đang gõ · đang online** | RT + FE | ⚠️ Đảo `SPEC-15 §5.2` — xem `CHAT-DEC-017` |
| 7 | **Thả cảm xúc (reaction)** | DB + BE + RT + FE | ⚠️ Đảo `SPEC-15 §5.2` — xem `CHAT-DEC-018` |

### 2.2 Cố ý NGOÀI wave

| Thứ | Vì sao |
| --- | --- |
| **Thư mục hội thoại tự đặt** (Telegram-style) | Owner chọn "nhóm sẵn theo loại phòng". Giữ nguyên là mục §2.2 của wave sau — cần 2 bảng + CRUD + kéo-thả |
| Sửa tin đã gửi | Vẫn phá append-only (SPEC-15 §3.4) — không đụng |
| Kiểm duyệt / báo cáo tin | Cần owner chốt chính sách trước (SPEC-15 §5.2) |
| Avatar cho phòng `direct` | Dẫn xuất từ avatar người đối thoại — **không** cột riêng, xem `CHAT-DEC-016` |

---

## 3. Quyết định owner — **ĐÃ CHỐT 05/08/2026** (theo đề xuất, cả 6)

> **HAI** trong sáu quyết định dưới đây (`CHAT-DEC-017` typing/presence · `CHAT-DEC-018` reaction) **đảo văn bản SPEC-15 đang hiệu lực**. Đảo trong im lặng = mọi WO sau thi công theo một spec đã sai. `DOC-1` là chỗ hoà chúng vào docs — đã làm 05/08/2026.

| Mã | Quyết định | Đề xuất | Đảo spec? |
| --- | --- | --- | --- |
| **CHAT-DEC-014** | Chia nhóm = **mục cố định theo `room_type`**, không phải thư mục tự đặt | Sidebar 5 mục: `Ghim` · `Tin nhắn riêng` · `Nhóm` · `Phòng ban` · `Dự án`. Mục rỗng **ẩn hẳn**. Trạng thái thu/mở nhớ ở `localStorage` per-user, **không** lên server | Không — bổ sung §9 CHAT-SCREEN-001 |
| **CHAT-DEC-015** | Ghim hội thoại là **per-user**, đặt ở `chat_room_members.pinned_at` | KHÔNG đặt ở `chat_rooms`: ghim ở bảng phòng nghĩa là một người ghim thì **cả phòng bị ghim**. Trần **10 phòng ghim/người**, ép ở service (422 `CHAT-ERR-0xx`), sắp xếp `pinned_at DESC` | Không — bổ sung §8 · §10 |
| **CHAT-DEC-016** | **Ai được đặt avatar phòng** | `group` → `chat_room_members.role='admin'`. `department` → người có `('update','org-unit')`. `project` → `projectRole` quản lý dự án (nguồn quyền service-layer, DECISIONS-04). `direct` → **không ai**, avatar dẫn xuất từ người đối thoại. ⚠️ **Lý do phải chốt:** phòng `department`/`project` **hiện 0 admin** (đo ở §1) ⇒ luật "admin phòng đặt" khiến avatar **vĩnh viễn không đặt được** ở đúng 2 loại owner vừa yêu cầu | Không — bổ sung §11 ghi chú |
| **CHAT-DEC-017** | **"Đang gõ" đi qua REST, KHÔNG mở `@SubscribeMessage`** | `POST /chat/rooms/:id/typing` (204, không ghi DB, không audit) → `RealtimeEmitter` phát `chat:typing` vào room. FE tiết lưu 3s, chỉ báo tự tắt sau 5s. **Presence (đang online)** làm **thuần server**: `handleConnection`/`handleDisconnect` ghi/xoá khoá Valkey — không cần event từ client, **không** đụng ratchet. ⚠️ Khoá Valkey **PHẢI có tiền tố môi trường** — Valkey dùng chung 4 môi trường, không có prefix kênh (memory `valkey-shared-across-all-envs-no-channel-prefix`); thiếu prefix thì người ở dev-online hiện "đang online" trên PROD | ⚠️ **CÓ** — §5.2 đang liệt "typing · presence" là NGOÀI v1 |
| **CHAT-DEC-018** | **Reaction** — bảng riêng `chat_message_reactions` | `(company_id, message_id, user_id, emoji)` unique; RLS + FORCE; bộ emoji **đóng** (6 mã cố định, ép bằng CHECK) — không nhận chuỗi tự do. Bỏ thả = `DELETE` thật: reaction **không** thuộc nhóm dữ liệu quan trọng của BẤT BIẾN #2, ghi rõ trong plan DB-1 để review không hiểu nhầm | ⚠️ **CÓ** — §5.2 đang liệt reaction là NGOÀI v1 |
| **CHAT-DEC-019** | **Avatar người gửi lấy từ ROSTER, không ký theo từng tin** | Ký URL cho mỗi tin ⇒ 50 tin = 50 lần ký + 50 URL hết hạn lệch nhau. Chốt: `GET /chat/rooms/:id/members` trả `avatarUrl` đã ký (đúng 1 lần/phòng), FE cache theo `userId` và tra khi render bong bóng. Người đã rời phòng vẫn phải có mặt trong roster (kèm `leftAt`), nếu không tin cũ mất avatar | Không — bổ sung §8 |

---

## 4. Phân rã Work Order

```text
DOC-1 ─┬─> DB-1 ─┬─> BE-1 (ghim·mute·chưa đọc) ─┐
       │         ├─> BE-2 (avatar phòng)        ├─> FE-2 ─> FE-3 ─> QA-1
       │         └─> BE-3 (reaction)            │           ▲
       └─────────────> RT-1 (typing·presence) ──┴───────────┘

FE-1 (chia mục theo loại phòng) ── KHÔNG phụ thuộc gì, chạy song song ngay
```

| WO | Tầng | Zone / Gate | Phụ thuộc | Nội dung |
| --- | --- | --- | --- | --- |
| `S8-CHAT-UX-DOC-1` | DOCS | yellow / LIGHT | — | Owner chốt §3; hoà DEC-014…018 vào SPEC-15 (§5.1 · §5.2 · §8 · §9 · §10 · §11 · §22), DB-12, API-13 |
| `S8-CHAT-UX-FE-1` | FE | yellow / LIGHT | **—** | Chia mục sidebar theo `room_type` + thu/mở + nhớ trạng thái. Thuần trình bày dữ liệu đã có |
| `S8-CHAT-UX-DB-1` | DB | **red / FULL** | DOC-1 | Mig `0543`: `chat_room_members.pinned_at` · `chat_rooms.avatar_file_id` (**composite tenant FK**, KI-046) · bảng `chat_message_reactions` (RLS+FORCE) · **GRANT thêm cột** (cấm REVOKE bảng) |
| `S8-CHAT-UX-BE-1` | BE | yellow / LIGHT | DB-1 | `PUT/DELETE /chat/rooms/:id/pin` · `PUT /chat/rooms/:id/mute` · `POST /chat/rooms/:id/unread`; trần 10 ghim; `pinnedAt`/`mutedUntil` vào `chatRoomSchema` |
| `S8-CHAT-UX-BE-2` | BE | **red / FULL** | DB-1 | Avatar phòng: presign wrapper gate `('update','chat-room')` (sao khuôn `ChatFilesService`) + `ChatRoomAvatarFileResolver` + set/clear + luật chủ thể theo DEC-016 |
| `S8-CHAT-UX-BE-3` | BE | yellow / LIGHT | DB-1 | Reaction: `PUT/DELETE /chat/messages/:id/reactions/:emoji` + tổng hợp vào DTO tin + phát `chat:reaction` |
| `S8-CHAT-UX-RT-1` | RT | **red / FULL** | DOC-1 | Typing REST-ping → emitter; presence server-side + khoá Valkey **có tiền tố môi trường**; ratchet 0-`@SubscribeMessage` **phải vẫn xanh** |
| `S8-CHAT-UX-FE-2` | FE | yellow / LIGHT | BE-1, BE-2, FE-1 | Mục `Ghim` + menu ngữ cảnh mỗi phòng + avatar trong danh sách + màn đặt avatar ở `RoomInfoPanel` |
| `S8-CHAT-UX-FE-3` | FE | yellow / LIGHT | BE-3, RT-1, FE-2 | Avatar người gửi + gộp tin liên tiếp + thanh reaction + chỉ báo đang gõ/chấm online |
| `S8-CHAT-UX-QA-1` | QA | yellow / LIGHT | tất cả | Deny-path (ghim phòng không thuộc · đặt avatar khi không đủ tư cách · react vào tin phòng khác) + cross-tenant + coverage ≥80% |

---

## 5. Bẫy đã biết phải né (trích memory, không phải suy đoán)

| Bẫy | Áp vào WO nào |
| --- | --- |
| `revoke-table-grant-wipes-column-grants` — REVOKE bảng xoá sạch column-GRANT | DB-1 |
| `new-fk-column-needs-composite-tenant-fk` — `avatar_file_id` một cột mở lại KI-046 | DB-1 |
| `migration-not-in-journal-is-silently-skipped` — `db:migrate` in "applied" + exit 0 dù bỏ qua | DB-1 |
| `valkey-shared-across-all-envs-no-channel-prefix` — presence rò giữa 4 môi trường | RT-1 |
| `engineio-cors-never-rejects` · `ws-permission-gate-needs-its-own-room` | RT-1 |
| `sensitive-capability-allowlist-is-backend` — nếu phát sinh cặp quyền mới | BE-2 |
| `apifetch-drops-pagination-bare-array` · `server-masking-needs-optional-fe-schema` — DTO thêm khoá phải `.optional()` | BE-1, BE-2, BE-3 |
| `duplicate-sibling-key-leaks-dom-node` — chia mục sinh nhiều `<ul>` anh em, key phải duy nhất TOÀN danh sách | FE-1, FE-2 |
| `ui-promises-backend-never-reads` — menu ngữ cảnh hứa "tắt thông báo" thì đường phát noti phải THẬT đọc `muted_until` | BE-1 |
| `wo-paths-drive-gate-and-scheduler` — WO nào chạm migration phải khai `apps/api/migrations/**` | DB-1 |
| `web-core-stale-dist-white-page` · `stale-contracts-dist-typecheck-false-red` | mọi WO FE |

---

## 6. Định nghĩa hoàn thành cấp wave

- SPEC-15 · DB-12 · API-13 khớp code (không còn dòng nào nói typing/reaction là "ngoài v1" trong khi code đã có).
- Ratchet `chat-realtime-structure.spec.ts` **vẫn xanh** — wave này không được mở lại bề mặt client→server.
- `s7-chat-db1-invariants.int-spec.ts` mục H phủ **mọi** writer mới của `chat_rooms`/`chat_room_members`.
- `bash harness/check.sh --all` xanh (có `LANE_DB`, deny-path chạy thật).
- PROD: nhớ rằng **`0542` chưa áp trên PROD** và module CHAT vẫn `is_active=false` (memory `chat-module-s7-wave-docs-first`) — wave này **tăng thêm** nợ migration PROD, phải nêu trong RELEASE trước khi bật module.
