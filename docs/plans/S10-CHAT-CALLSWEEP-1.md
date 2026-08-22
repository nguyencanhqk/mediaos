# S10-CHAT-CALLSWEEP-1 — quét cuộc gọi `active` mồ côi (KI-063)

> 🔴 Vùng đỏ: FSM vòng đời cuộc gọi. Chữ ký R4 của chủ dự án ĐÃ CÓ 2026-08-20 ⇒ chọn phương án **job quét**.
> Plan viết sau khi ĐO CÂY THẬT (không đọc từ comment WO — [[wo-plans-built-on-code-comments]]).

## §1 — Khuyết tật, đo lại trên cây 2026-08-21

| Điểm đo | Giá trị thật |
| --- | --- |
| `chat_calls_one_live_per_room_uq` | partial unique `.where(status IN ('ringing','active'))` — `communication.ts:519-521` |
| Đường quét DUY NHẤT hôm nay | `ChatCallsRepository.expireStaleRinging` — `WHERE status='ringing'` (`chat-calls.repository.ts:454`) |
| Job hiện có | `CHAT_CALL_RINGING_TIMEOUT` — ngưỡng `CHAT_CALL_RING_TIMEOUT_MS = 45_000`, hằng CỨNG ở `chat-calls.service.ts:37` |
| Trạng thái hợp lệ | `ringing · active · ended · rejected · cancelled · missed` (`chat_calls_status_chk`) |
| Ép FSM một chiều | TRIGGER `chat_calls_forbid_revive_trg` (mig `0546` khối A3) — ném `23514` |
| Ép mốc kết thúc | `chat_calls_ended_at_chk` — 4 trạng thái cuối ĐÒI `ended_at NOT NULL` |
| Ai đăng ký job | `WorkerSchedulerService` gom `@SystemJobHandler()` qua `DiscoveryService` ⇒ **KHÔNG cần seed/migration** cho jobCode mới |

**Kết luận đo:** một hàng `status='active'` không có đường nào rời khỏi tập `('ringing','active')` ngoài
hành động của người còn sống trong phòng. Gỡ cả hai người khỏi phòng ⇒ `ChatCallRoomExitService` đóng
**phần tham gia** (cố ý KHÔNG chạm `chat_calls` — hàng rào R4 của `DECISIONS-07`) ⇒ hàng `active` mồ côi
chiếm chỗ partial unique ⇒ mọi `invite` sau đó **409 CHAT-ERR-028 vĩnh viễn**, không đường sửa qua API.

## §2 — Ngữ nghĩa phải phát biểu TRƯỚC khi dựng vị từ

Bài học KI-072: *"ai vá phải phát biểu ngữ nghĩa ra rồi mới dựng vị từ"*. Ở đây có **HAI** câu hỏi khác
nhau, và chúng cần **hai nhánh riêng** — gộp thành một ngưỡng là nói dối về nguyên nhân:

- **(O) MỒ CÔI** — *"không còn ai ở trong cuộc gọi này nữa"*. Tập "còn ở trong" = hàng participant có
  `outcome IS NULL` **HOẶC** `outcome = 'accepted'` — đúng tập KHÔNG-hấp-thụ mà `WHERE` của
  `setParticipantOutcome` cho ghi tiếp. Bốn kết cục còn lại (`left/missed/rejected/cancelled`) là HẤP THỤ
  ⇒ một cuộc gọi mà **mọi** hàng participant đã hấp thụ thì **không có đường quay lại**, nó đã kết thúc
  thật. Đây là nhánh đóng ĐÚNG kịch bản KI-063.
- **(D) QUÁ THỌ** — *"cuộc gọi này sống lâu hơn mọi cuộc gọi hợp lý"*. Lưới an toàn cho hình dạng KHÔNG
  đoán trước: nhánh `!ok` của `closeCallParticipationOnRoomExit` (hàng participant KHÔNG đóng được) để lại
  một hàng "còn ở trong" mãi mãi ⇒ (O) không bao giờ khớp. Không có (D) thì lỗ chỉ đổi hình dạng.

⚠️ **Trạng thái đích = `ended`, KHÔNG phải `missed`.** `active` kéo theo `accepted_at IS NOT NULL`
(`chat_calls_accepted_at_chk`) — cuộc gọi ĐÃ ĐƯỢC NHẬN. Ghi `missed` là nói dối lịch sử: nó bảo "không ai
bắt máy" cho một cuộc gọi có người đã nói chuyện. Đó đúng lớp lỗi mà docblock `CALL_MISSED` đã tách khỏi
`CALL_ENDED` để tránh.

## §3 — Ngưỡng: BIẾN ENV có `.default()` LẪN `.min()`/`.max()`

Khuôn đã có tiền lệ trong `env.schema.ts:121-133` (`STEP_UP_TTL_SEC`/`STEP_UP_MAX_ATTEMPTS`) và lý do
được viết sẵn ở đó — chép đúng cả hai vế:

| Biến | default | min | max | Nhánh |
| --- | --- | --- | --- | --- |
| `CHAT_CALL_ORPHAN_GRACE_MS` | `120_000` (2 phút) | `30_000` (30 giây) | `3_600_000` | (O) |
| `CHAT_CALL_ACTIVE_MAX_MS` | `43_200_000` (12 giờ) | `600_000` (10 phút) | `86_400_000` (24 giờ) | (D) |

- `.default()` vì biến MỚI không mặc định **từng giết fixture int-spec** ([[env-schema-floor-breaks-test-fixtures]]) —
  lỗi nổi ở file KHÁC hẳn chỗ gán.
- `.max()` vì mặc định an toàn KHÔNG chặn được cấu hình sai: `.positive()` một mình cho phép đặt
  `CHAT_CALL_ACTIVE_MAX_MS=999999999999` — tức **tắt lặng lẽ** chính lưới an toàn này mà không ai đỏ.
- `.min()` (bổ sung sau FULL gate 21/08) vì đó là **vế nguy hiểm hơn**: `.positive()` cũng nhận `=1`, và
  `CHAT_CALL_ACTIVE_MAX_MS=1` cho một nhịp sau gặt **MỌI cuộc gọi đang nói chuyện**, ghi kết cục HẤP THỤ
  vào `chat_call_participants` — bảng KHÔNG có `DELETE` grant (BẤT BIẾN #2) ⇒ **không hoàn tác được**.
  Sàn cố ý nằm DƯỚI mọi fixture đang dùng (int-spec sweep `60_000`/`3_600_000`; `env.schema.spec` `45_000`).

⚠️ **Đính chính ngữ nghĩa `ORPHAN_GRACE_MS` (FULL gate 21/08).** Vị từ neo vào `chat_calls.started_at`, tức
**TUỔI CUỘC GỌI** — KHÔNG phải "ân hạn tính từ lúc người cuối cùng ngã ngũ" như bản comment đầu tiên viết.
Với một cuộc gọi đã nói chuyện lâu hơn ngưỡng, ân hạn thực tế bằng **0**. Vô hại theo thiết kế hiện tại
(bốn kết cục hấp thụ là CHUNG CUỘC, không có đường quay lại) nhưng là đúng lớp lỗi KI-054 nếu để nguyên
chữ. Muốn đúng nghĩa "chờ người quay lại" thì phải neo vào `MAX(coalesce(left_at, invited_at))` của bảng
participants — **đổi vị từ**, không phải đổi số. Chọn đính chính chữ; ghi lại đây để lần sau không phải
đo lại.

## §4 — Điểm chèn (KHÔNG viết lại file nào, chỉ append)

1. `apps/api/src/config/env.schema.ts` — 2 biến trên.
2. `apps/api/src/chat/chat-calls.repository.ts` — hàm MỚI `expireStaleActive(...)`. Vị từ (O) dựng bằng
   `NOT EXISTS` trên `chat_call_participants`; (D) bằng `started_at < maxCutoff`. `RETURNING` **cùng tập
   cột** với `expireStaleRinging` (id·roomId·kind·initiatorUserId·startedAt).
3. `apps/api/src/chat/chat-calls.service.ts` — `expireStaleActiveTx()` (audit MỖI cuộc gọi + đóng
   participant còn treo + trả `ChatCallExpiry[]`) và `emitAutoEnded()` (phát SAU commit, `action:"ended"`).
4. `apps/api/src/chat/chat-call-stale-active-sweep.job-handler.ts` — handler MỚI, `jobCode` MỚI.
5. `apps/api/src/chat/chat.errors.ts` — `CHAT_AUDIT.CALL_AUTO_ENDED = "chat.call.auto_ended"`.
6. `apps/api/src/chat/chat.module.ts` — đăng ký provider (khối additive).

### Vì sao jobCode MỚI, không mở rộng `CHAT_CALL_RINGING_TIMEOUT`

`jobCode` là **khoá vận hành** (`system_job_locks` PK + `system_job_runs.job_code`), không phải nhãn mô tả.
Đổi tên nó ⇒ bỏ lại một hàng lock mồ côi + **cắt đôi lịch sử run** giữa hai cái tên. Giữ nguyên tên cũ mà
nhét thêm việc quét `active` vào ⇒ tên nói một đằng, code làm một nẻo — đúng lớp lỗi KI-054
(*"Company-scope" viết trong docstring như một sự thật*). Handler riêng cũng cho **đo riêng**: "wave này
gặt bao nhiêu cuộc gọi ma" là con số phải trả lời được khi đóng KI, không trộn với 45s-ring-timeout.
Giá phải trả: 1 hàng lock + 1 vòng per-tenant mỗi nhịp — rẻ.

## §5 — Hồi sinh & partial unique (done_when #4)

Sau khi hàng chuyển `ended`, nó **rời** tập `status IN ('ringing','active')` ⇒ partial unique nhả chỗ ⇒
phòng mời được lại. Chiều ngược lại (hàng `ended` bị kéo về `active` để chiếm lại chỗ) **đã bị TRIGGER
`chat_calls_forbid_revive_trg` chặn ở DB** — CHECK không làm được việc này vì CHECK không thấy `OLD`
([[check-cannot-enforce-fsm-transitions]]). Plan này **KHÔNG thêm ràng buộc DB nào**; nó phải **CHỨNG MINH
bằng ca test** rằng lớp có sẵn còn hiệu lực sau bản vá — chứ không giả định.

⚠️ Vì thế WO này **không sinh migration**. `paths` của WO không có `drizzle/**` ⇒ nếu thi công phát hiện
cần migration thì phải **DỪNG và mở rộng paths trước** ([[wo-paths-drive-gate-and-scheduler]]).

## §6 — Test: RED TRƯỚC

| Ca | Nội dung | Nhánh |
| --- | --- | --- |
| **R1** 🔴 | Dựng đúng kịch bản KI: cuộc gọi `active`, gỡ CẢ HAI người khỏi phòng ⇒ `invite` mới **409**. Chạy sweep ⇒ hàng thành `ended` ⇒ `invite` mới **201** | (O) |
| **R2** 🔴 | Cuộc gọi `active` còn 1 người `outcome='accepted'` ⇒ sweep **KHÔNG** đụng (chưa mồ côi) | (O) âm |
| **R3** 🔴 | Cuộc gọi `active` quá `CHAT_CALL_ACTIVE_MAX_MS` dù còn người treo ⇒ bị gặt | (D) |
| **R4** 🔴 | `active` mồ côi nhưng CHƯA quá `ORPHAN_GRACE_MS` ⇒ **KHÔNG** gặt | (O) biên |
| **P1** | Participant còn treo lúc gặt: đã `joined` ⇒ `left` + `left_at`; chưa `joined` ⇒ `missed`, KHÔNG `left_at` | kết cục |
| **P2** | Hàng đã hấp thụ (`rejected`) KHÔNG bị ghi đè | kết cục |
| **V1** | Hàng `ended` do sweep KHÔNG kéo về `active` được — trigger ném `23514` | hồi sinh |
| **A1** ✅ | Cuộc gọi `ringing` KHÔNG bị handler này chạm (đúng phân công với job cũ) | không chặn oan |
| **I1** | Chạy sweep 2 lần liên tiếp ⇒ lần 2 trả 0 hàng (idempotent theo cấu trúc) | hợp đồng job |
| **J1** | AppModule THẬT: `jobCode` mới có mặt ĐÚNG 1 lần trong tập `@SystemJobHandler` | wiring |
| **E1** | `env.schema`: quá `.max()` ⇒ NÉM; vắng ⇒ default | ngưỡng |

**Bằng chứng RED bắt buộc:** vô hiệu vị từ (O)+(D) (trả `false`) ⇒ R1·R3·R4 phải ĐỎ. Ca nào KHÔNG đỏ khi
vô hiệu thì **không được tính** là bằng chứng của nhánh đó ([[deny-cases-vacuous-without-allow-case]] ·
đúng vế đã đính chính ở KI-070: X1 xanh không chứng minh vế HÀNG).

**Chạy trên `LANE_DB` thật** — int-spec `describe.skipIf(!hasDb)` SKIP không phải PASS
([[integration-test-lane-db-gate]] · [[src-green-is-not-integration-green]]).

## §7 — Ranh giới CÓ TÊN (đọc trước khi "sửa cho hợp lý")

1. **KHÔNG nới `ChatCallRoomExitService` để nó tự đóng `chat_calls`.** Hàng rào R4 `DECISIONS-07` đặt mọi
   phép ghi vòng đời trong `ChatCallsService`. Job là đường được chọn, và chủ dự án đã ký R4 đúng cho
   phương án đó.
2. **KHÔNG cho `active` đi sang `missed`.** Xem §2 — nó xoá mất sự thật "đã có người bắt máy".
3. **KHÔNG gộp vào audit `CALL_ENDED` trần.** Câu hỏi điều tra khác: "ai gác máy" vs "hệ thống gặt lúc
   nào, vì nhánh nào". `newValues.reason` phải phân biệt `orphan` / `max_duration`.
4. **KHÔNG bỏ `emit` sau commit.** Thiếu nó, máy người dùng giữ khung gọi của một cuộc gọi đã chết — đúng
   lỗi mà `emitExpired` được thêm để vá ở S7-CALL-RT-1.
5. **KHÔNG dùng `@Optional()` cho DI của handler.** Cả hai dependency là provider THẬT trong `ChatModule`;
   `@Optional()` biến lỗi wiring thành `undefined` im lặng — ngược đúng thứ
   [[systemjobhandler-optional-dbw-di]] bảo vệ (memory đó nói về tham số KHÔNG phải provider).
