# DECISIONS-07 — Cuộc gọi thoại/hình trong CHAT: nới `CHAT-DEC-005` **có hàng rào**

| | |
| --- | --- |
| **Trạng thái** | 🟢 **ĐÃ KÝ 2026-08-08** — có hiệu lực. Wave `S7-CALL-*` được phép bắt đầu (§7). |
| **Ngày** | 2026-08-04 · ký 2026-08-08 |
| **Bối cảnh** | Owner chốt phương án **C** (làm cuộc gọi ở MediaOS) sau đánh giá `docs/plans/S7-CHAT-LMS-CONSOLIDATION.md` |
| **Vùng** | 🔴 ĐỎ — sửa một bất biến kiến trúc đang có hiệu lực |
| **Thay thế** | `CHAT-DEC-005` (SPEC-15 §3.5 · §22) — **nới**, không huỷ |
| **Kéo theo** | SPEC-15 §5.2 (dòng "Cuộc gọi thoại/hình — Ngoài phạm vi sản phẩm") phải sửa |

---

## 1. Vấn đề

`CHAT-DEC-005` (chốt 02/08/2026) nói: **client ghi qua REST, WS chỉ một chiều server→client**. Nó được
ép bằng code, không chỉ bằng lời: `realtime.gateway.ts:38` ghi _"KHÔNG có `@SubscribeMessage` nào và
không được thêm"_.

WebRTC **không chạy được** dưới ràng buộc đó. Bắt tay một cuộc gọi cần trao đổi hai chiều, độ trễ thấp,
nhiều vòng: `offer` → `answer` → hàng chục `ICE candidate` mỗi bên, phát sinh **bất đồng bộ** khi trickle
ICE chạy. Đẩy chỗ đó qua REST nghĩa là client phải hỏi vòng (poll) — thêm độ trễ đúng vào giai đoạn nhạy
cảm nhất, và vẫn phải có đường server→client cho bên nhận.

Vì vậy: hoặc **không làm cuộc gọi**, hoặc **nới `CHAT-DEC-005`**. Không có đường thứ ba.

---

## 2. Vì sao bất biến này tồn tại (đọc trước khi nới)

`CHAT-DEC-005` không phải sở thích kiến trúc. Nó đóng ba lỗ cùng lúc:

1. **Một đường ghi duy nhất.** Mọi thao tác ghi đi qua controller REST ⇒ đi qua `PermissionGuard`,
   `assertMember`, DTO Zod, audit, và `withTenant`. Thêm đường ghi thứ hai là thêm một mặt tấn công
   phải bảo vệ song song — và lịch sử repo này cho thấy đường thứ hai luôn là đường bị quên
   (memory `route-census-runtime-gate` · `ws-permission-gate-needs-its-own-room`).
2. **Masking.** Payload WS phải qua **cùng** DTO/masking như REST (CLAUDE.md §5). Handler inbound tự
   viết dễ trả thẳng row.
3. **Audit.** Ghi qua WS không có chỗ tự nhiên để ghi `audit_logs`.

⇒ Nới thì phải nới **hẹp nhất có thể**, và phải ghi ra bằng chữ cái gì KHÔNG được đi qua cửa mới.

---

## 3. Quyết định đề xuất

**Nới `CHAT-DEC-005` thành:**

> Client **không bao giờ ghi DỮ LIỆU NGHIỆP VỤ** qua WebSocket. Tin nhắn · thành viên · ghim · thu hồi ·
> con trỏ đã đọc — tất cả đi REST, không có ngoại lệ.
>
> **Ngoại lệ DUY NHẤT:** *tín hiệu bắt tay cuộc gọi* (SDP/ICE) được phép đi client→server, trên một
> **namespace RIÊNG** `/ws-call`, vì nó là **trạng thái vận chuyển tạm thời**, không phải dữ liệu
> nghiệp vụ: không lưu vào DB, không lên DTO nào, không sống quá cuộc gọi.

### 3.1 Bốn hàng rào bắt buộc

| # | Hàng rào | Vì sao |
| --- | --- | --- |
| **R1** | **Namespace riêng `/ws-call`**, gateway riêng. `/ws` (CHAT + NOTI) **giữ nguyên 0 `@SubscribeMessage`** — có test đóng đinh điều đó. | Lẫn hai loại kênh vào một gateway là mất khả năng nói "cửa này chỉ nhận X" |
| **R2** | **Allowlist ĐÓNG** đúng 8 sự kiện inbound (§4). Sự kiện ngoài danh sách → ngắt kết nối + ghi `user_security_events`. Có test census như `route-guard-coverage` cho REST. | Không có allowlist thì "thêm một handler nhỏ" là đường bất biến chết dần |
| **R3** | **SDP/ICE chỉ RELAY, không đọc, không lưu.** Server không parse nội dung, không ghi DB, không đưa vào bất kỳ DTO nào. Chỉ kiểm: người gửi ∈ cuộc gọi, cuộc gọi đang sống. | Giữ đúng mệnh đề "không phải dữ liệu nghiệp vụ" — nếu có ngày ta lưu SDP, ngoại lệ này hết hiệu lực |
| **R4** | **Vòng đời cuộc gọi vẫn đi REST**: mời · nhận · từ chối · kết thúc ghi `chat_calls` + `audit_logs` qua controller có `PermissionGuard`. WS chỉ **thông báo** và **relay tín hiệu**. | Giữ nguyên đường ghi nghiệp vụ + audit. Đây là điểm khác quan trọng nhất so với LMS (LMS ghi cả vòng đời qua WS) |

> ⚠️ **R4 là chỗ CỐ Ý không sao chép LMS.** LMS xử lý `call:invite`/`accept`/`reject`/`hangup` ngay
> trong handler socket (`server.mjs:895..1099`) và ghi thẳng SQLite. Bê nguyên sang MediaOS là đưa
> đường ghi nghiệp vụ + đường audit vào cửa WS — đúng thứ §2 nói là không được.

### 3.2 Quyền và ranh giới

- Cặp quyền mới: `('call','chat-room')` — `is_sensitive=false`, grant cho các role canonical như 9 cặp
  CHAT hiện có.
- **Ranh giới vẫn là membership**, không phải data_scope (SPEC-15 §3.2): gọi được trong phòng nào ⇔
  `assertMember` phòng đó. Handshake `/ws-call` kiểm phiên; mỗi sự kiện kiểm lại tư cách tham gia
  cuộc gọi — **không** tin vào việc socket đang ở trong room.
- `('view','chat-oversight')` **KHÔNG** mở cửa nghe lén cuộc gọi. Đọc-vượt là quyền đọc **lịch sử tin
  nhắn**; nó không cấp quyền tham gia hay nghe một cuộc gọi đang diễn ra. Ghi rõ ở đây để không ai suy
  diễn từ CHAT-DEC-004.

---

## 4. Allowlist inbound (R2) — đúng 8 sự kiện

| Sự kiện | Payload | Kiểm trước khi xử lý |
| --- | --- | --- |
| `call:join` | `{ callId }` | là người tham gia cuộc gọi đang sống |
| `call:leave` | `{ callId }` | như trên |
| `call:sdp-offer` | `{ callId, toUserId, sdp }` | người gửi ∈ cuộc gọi · `toUserId` ∈ cuộc gọi |
| `call:sdp-answer` | `{ callId, toUserId, sdp }` | như trên |
| `call:ice-candidate` | `{ callId, toUserId, candidate }` | như trên |
| `call:media-state` | `{ callId, micOn, camOn }` | là người tham gia |
| `call:ping` | `{ callId }` | là người tham gia (phát hiện rớt) |
| `call:screen-state` | `{ callId, sharing }` | là người tham gia |

Mỗi payload qua **Zod ở biên** (`packages/contracts`). `sdp`/`candidate` là **chuỗi mờ** — có trần độ
dài, **không** parse.

**KHÔNG có trong danh sách** (cố ý, đi REST): `call:invite` · `call:accept` · `call:reject` ·
`call:cancel` · `call:hangup` · mọi thứ thuộc tin nhắn/thành viên/ghim/đã-đọc.

---

## 5. Hạ tầng — tin tốt

LMS đã chạy **Cloudflare TURN** (`apps/lms/app/api/messages/calls/ice-config/route.ts`): credential sinh
phía server từ `CLOUDFLARE_TURN_KEY_ID` + `CLOUDFLARE_TURN_API_TOKEN`, STUN dự phòng của Google.

⇒ **Không phải dựng và vận hành TURN server.** MediaOS làm route tương đương
`GET /chat/calls/ice-config` (gate `call:chat-room`), dùng lại chính tài khoản Cloudflare đó. Đây là
phần "kế thừa để làm nhanh" **có giá trị thật** — khác với port UI của tính năng 0 người dùng.

---

## 6. Kế thừa từ LMS — lấy gì, bỏ gì

| Tài sản LMS | Xử lý |
| --- | --- |
| `useDirectMessageCall.ts` (885 dòng) — máy trạng thái WebRTC, trickle ICE, nhiều bên | **Port có sửa**: bỏ phần tự ghi vòng đời qua WS (R4), đổi tên sự kiện, thêm Zod |
| `CallExperience.tsx` · `CallButtons.tsx` · `CallProvider.tsx` · `callRingtone.ts` | **Port gần nguyên** — UI thuần, không đụng bất biến |
| `ice-config/route.ts` | **Port sang NestJS**, thêm gate quyền |
| `direct_message_calls` · `_call_participants` (SQLite) | **Thiết kế lại** cho Postgres: `company_id` + RLS + FORCE + append-only cho lịch sử cuộc gọi |
| Handler `call:invite/accept/reject/cancel/hangup` trong `server.mjs` | **KHÔNG port** — chuyển thành REST (R4) |

---

## 7. Owner ký

- [x] Tôi chấp nhận **nới `CHAT-DEC-005`** đúng phạm vi §3, với 4 hàng rào R1–R4.
- [x] Tôi chấp nhận sửa **SPEC-15 §5.2**: "Cuộc gọi thoại/hình — ngoài phạm vi sản phẩm" → **trong phạm
      vi**, có mục riêng.
- [x] Tôi xác nhận dùng **tài khoản Cloudflare TURN** hiện có của LMS cho MediaOS (hoặc cấp khoá riêng).

Ký: **Owner (Cian)** Ngày: **2026-08-08**

> ✅ Đã ký ⇒ `S7-CALL-*` được phép bắt đầu. `S7-CHAT-FE-3`/`FE-4`/`FE-5` và
> `S7-CHAT-LMS-1` (phần gỡ chat LMS, giữ nguyên đường gọi cũ tới khi CALL sẵn sàng) **không** chờ mục này.

### 7.1 Mã đã cấp khi ký — đo trên master 2026-08-08

Dải trong bản seed WO **đã lỗi thời lần hai**: wave S8-CHAT-UX chiếm tiếp `CHAT-API-024a/024b/025`
(`API-13` dòng 164-166) sau khi bản ghi chú 05/08 được viết. Dải thật đo lại lúc ký:

| Loại | Cấp cho CALL | Ghi chú |
| --- | --- | --- |
| Quyết định | `CHAT-DEC-020` | trống — max đang là 019 |
| Màn hình | `CHAT-SCREEN-009` | trống — max đang là 008 |
| API | **`CHAT-API-026..029`** | ⚠️ **KHÔNG phải 024..027** như WO ghi — 024a/024b/025 đã bị S8 chiếm |
| Mã lỗi | `CHAT-ERR-026..030` | trống — §12 đang chốt đúng 25 mã |

⚠️ Thêm mã lỗi ⇒ **bắt buộc** sửa `apps/api/src/chat/chat-error-code-census.spec.ts`:
nâng `SPEC_ERROR_CODE_COUNT` 25 → 30 **và** ghi 5 mã mới vào `PENDING_CODES` kèm tên WO nợ chúng.
Sổ nợ hiện **RỖNG**; thêm mã vào §12 mà quên hai việc đó ⇒ census **ĐỎ** (đã xảy ra thật với
`S8-CHAT-UX-BE-2`, xem `docs/plans/S8-CHAT-UX-BE-2.md:54`).
