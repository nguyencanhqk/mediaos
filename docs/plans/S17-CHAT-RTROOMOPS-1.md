# S17-CHAT-RTROOMOPS-1 — room-op CHAT: tên room chuẩn tắc (chữ thường) ở builder + `leave` CỤC BỘ trước lệnh toàn cụm

> Zone 🔴 **red** · **Gate: FULL** (`security-reviewer` + `silent-failure-hunter` + `typescript-reviewer` + `santa-method` ×2 —
> room là **cổng ĐỌC ở tầng realtime** của CHAT/CALL) · Opus.
> Worktree `MediaOS-rtro` · nhánh `fix/s17-chat-rtroomops-1` (base `6ac4ca48`) · lane DB do wrapper chuỗi B đặt.
> Nguồn: `harness/backlog.mjs` mục `S17-CHAT-RTROOMOPS-1` (4 `done_when`) · plan `S16-SOCIAL-BE-2C.md` §12 F2/F3 ·
> API-13 §7/§7a. Trạng thái: **plan v1 (23/10/2026)** — đo tĩnh trên `6ac4ca48`.

## 1. Bối cảnh + quyết định owner

- WO seed 02/10/2026 từ FULL gate lượt 1 của S16-SOCIAL-BE-2C. BE-2C vá HAI lớp lỗi cho room nhóm SOCIAL ở cửa
  `syncFeedGroupMembership` (F3 chữ thường · F2 `leave` cục bộ) và **cố ý** để nguyên CHAT. CHAT mang cả hai lớp:
  - **Lớp 1 — chữ hoa/thường.** `ParseUUIDPipe` nhận uuid chữ HOA và trả nguyên văn; Postgres so uuid không phân biệt
    hoa thường nên ghi DB thành công, nhưng tên room là CHUỖI ⇒ room-op dựng từ id route không khớp room mà gateway
    dựng từ DB/JWT ⇒ người bị gỡ **ở lại** room phòng chat / room cuộc gọi (fail-OPEN).
  - **Lớp 2 — lệnh `leave` có thể mất.** Dưới adapter Valkey, `socketsLeave` không cờ `local` chỉ publish; node giữ socket
    chỉ áp khi nhận lại qua kết nối SUBSCRIBE (at-most-once) ⇒ lệnh có thể mất vĩnh viễn trong khi broadcast vẫn phát.
- **Quyết định owner (23/10/2026 ~09:25, AskUserQuestion phiên chính):** «Cả A+B+C+D+E» — 4 chuỗi song song tới khi **MỞ
  PR** (không merge, không deploy). WO này = chuỗi B. Trần chi phí 400 USD (khung 16/10). Không quyết định owner mới nào
  cần cho plan này (§3 nằm trong khung `done_when`).

## 2. Số đo (tĩnh, `6ac4ca48`)

| #   | Đo                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Nhãn |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| S1  | `realtime/rooms.ts` (115 dòng) có 8 builder (`userRoomName:8` · `chatRoomName:13` · `chatUserRoomName:35` · `callUserRoomName:51` · `callRoomName:62` · `feedRoomName:81` · `feedUserRoomName:99` · `feedGroupRoomName:113`) — nối chuỗi thẳng, **không chuẩn hoá**. Không có template `co:${…}` nào khác dựng tên ROOM ngoài file này (các chuỗi `co:` còn lại là khoá Valkey/doc).                                                                                                                                                                         | ĐO   |
| S2  | **Join** dùng id từ JWT/DB: `realtime.gateway.ts:175,210,228,239` (`user.id`/`companyId` + danh sách phòng đọc DB) · `:344-356` (feed) · `call-signalling.gateway.ts:280` (`calluser` từ JWT). **Ngoại lệ:** `call-signalling.gateway.ts:393` join `callRoomName(…, payload.callId)` — id do CLIENT gửi (`chat-call.ts:115` `z.string().uuid()`), trong khi `:392` ghi `access.callId` từ DB.                                                                                                                                                                | ĐO   |
| S3  | **Room-op/emit** dùng id route: `chat-rooms.controller.ts:280-288` `removeMember` (`id`,`userId` qua `ParseUUIDPipe`) → `chat-members.service.ts:245` (evict trong tx) · `:271` (evict sau commit) · `:291` (`syncRoomMembership` leave). `chat-messages.controller.ts:99-104` → `chat-messages.service.ts:234` `emitChatMessage(…, roomId route)`. `chat-typing.service.ts:72`. Relay `call-signalling.gateway.ts:455,744` (`payload.toUserId`).                                                                                                            | ĐO   |
| S4  | Room-op dùng id DB/JWT (không lỗi lớp 1): `chat-rooms.service.ts:475,489` (`actor.id`) · `chat-derived-rooms-sync.service.ts:315` (hàng DB) · `callId` của evict lấy từ `closeCallParticipationOnRoomExit` (DB).                                                                                                                                                                                                                                                                                                                                             | ĐO   |
| S5  | `realtime-emitter.service.ts` (719 dòng): `syncRoomMembership:323-339` không chuẩn hoá, không vế cục bộ · `syncFeedGroupMembership:371-386` chuẩn hoá `:377` + `leaveLocally:385` · `leaveLocally:394-408` cứng `this.server` (/ws), nhãn log «room nhóm» `:403` · `syncSocketRoom:424-445` · `evictFromCallRoom:542-566` dùng `this.callServer` (`Namespace`, `:64`), không vế cục bộ.                                                                                                                                                                      | ĐO   |
| S6  | `chat-realtime-after-commit.spec.ts` mock emitter ở MỨC SERVICE (`:49`, `:130`): ghim evict 1 lần khi commit hỏng (`:183-188`), 2 lần khi commit OK (`:217-222`), `syncRoomMembership(…,'leave')` (`:195`). Đổi NỘI BỘ emitter không chạm các số này.                                                                                                                                                                                                                                                                                                        | ĐO   |
| S7  | `realtime-emitter.chat.spec.ts:15-32` `makeServer` KHÔNG có `local` ⇒ thêm vế cục bộ mà không sửa mock thì `leaveLocally` nuốt `TypeError` + log `error` (ca `:182` vẫn xanh — xanh ồn). `realtime-emitter.call.spec.ts` (124 dòng) chưa có ca nào cho `evictFromCallRoom`.                                                                                                                                                                                                                                                                                  | ĐO   |
| S8  | Khuôn đã có: `realtime-emitter.feed.io.spec.ts:51-58` (adapter in-memory NUỐT room-op không-`local`) + `:119-154` (⚓/🔒) · `realtime-emitter.feed.spec.ts:58,107,162` (mock `local`, ghim thứ tự local→cluster, local ném ⇒ cluster vẫn chạy) · int-spec `social-be2c-group-rooms.int-spec.ts:139-146` (boot `applyMainPipeline` + `setupWebSocketAdapter` + `listen(0)`) · `:464-492` (E11m). Fixture `test/helpers/social-group-rooms-fixture.ts`: `gatewayNamespace:156` · `isMember:161` · `becomes:186` · `connectReady:222` (readiness = `chatuser`). | ĐO   |
| S9  | `chat-s7-call-rt1-signalling.int-spec.ts` = 1675 dòng (> 800), boot KHÔNG qua `applyMainPipeline` (`:336-342`); luồng C5 (`newRoom` → `invite` → `connectCall` + `call:join` → `DELETE …/members/…`) đo được người bị gỡ ở room cuộc gọi; cặp quyền `CALL_FULL:65-70`.                                                                                                                                                                                                                                                                                       | ĐO   |
| S10 | API-13 §7 (`:431`) + §7a (`:460`) chưa ghi tên room chuẩn tắc, vế cục bộ, phần dư đa-instance, `unhandledRejection`.                                                                                                                                                                                                                                                                                                                                                                                                                                         | ĐO   |
| S11 | Zod `uuid()` (gói contracts) CHẤP NHẬN uuid chữ HOA: `z.string().uuid().safeParse(<uuid HOA>).success === true` (đo 23/10 bằng một dòng node) ⇒ `call:join` với `callId` chữ HOA dựng room lệch dạng chuẩn.                                                                                                                                                                                                                                                                                                                                                  | ĐO   |

## 3. Quyết định

- **D-1 (H1) — chuẩn hoá ở BUILDER `rooms.ts`, mọi tên room.** Một hàm nội bộ duy nhất (`canonicalId`, chữ thường) bọc
  mọi tham số id của 8 builder; KHÔNG `.toLowerCase()` ở caller nào. Lý do (S2–S4): (a) cửa room-op chỉ phủ
  `syncRoomMembership`/`evictFromCallRoom`, bỏ sót `call:join` id-client (S2 `:393`), `emitChatMessage`/typing id-route
  (S3) và đích `chatUserRoomName` của `chat:room` cho người bị gỡ; (b) builder là chỗ DUY NHẤT mà join, leave và emit
  cùng đi qua (S1) ⇒ quy tắc DƯƠNG «mọi tên room là chuẩn tắc» đóng cả lớp; (c) với đầu vào đã chuẩn (JWT/DB) chuỗi ra
  y hệt ⇒ không đổi hành vi đường đúng. Mọi tham số builder là uuid (không có id phân biệt hoa thường) — ghi vào docblock
  - ca `rooms.spec.ts`. `syncFeedGroupMembership:377` GIỮ (thừa, vô hại; đổi SOCIAL ngoài mục tiêu — N5).
- **D-2 (H2) — `leave` CỤC BỘ đồng bộ TRƯỚC lệnh toàn cụm.** Tổng quát `leaveLocally` nhận namespace đích
  (`Server | Namespace`) + nhãn log trung tính («room đích»). `syncRoomMembership('leave')` gọi
  `leaveLocally(server, userRoomName, chatRoomName)` rồi `syncSocketRoom`; `evictFromCallRoom` gọi
  `leaveLocally(callServer, callUserRoomName, callRoomName)` rồi lệnh toàn cụm hiện có. try/catch RIÊNG mỗi vế; `join`
  KHÔNG có vế cục bộ. Giữ bất đối xứng bộ chọn (join `chatUserRoomName` · leave `userRoomName`) và nhánh
  `callServer === null ⇒ error` của evict.
- **D-3 — KHÔNG sửa `apps/api/src/chat/**`.** Chữ ký + số lời gọi của caller giữ nguyên ⇒ `chat-realtime-after-commit.spec.ts`
  (S6) không đổi kỳ vọng; nó là lưới hồi quy, không phải nơi viết ca mới.
- **D-4 (H3) — kiểm thử.** Int-spec MỚI `test/integration/chat-rtroomops-1.int-spec.ts` (boot `applyMainPipeline` +
  `setupWebSocketAdapter` + `listen(0)`, tái dùng fixture S8) thay vì nới `chat-s7-call-rt1` (S9: > 800 dòng, không qua
  pipeline). Unit: mở rộng `realtime-emitter.chat.spec.ts` (thêm `local` vào mock, khuôn feed.spec) +
  `realtime-emitter.call.spec.ts` (describe evict); MỚI `realtime/rooms.spec.ts` + `realtime/realtime-emitter.roomops.io.spec.ts`
  (adapter nuốt, cả `/ws` lẫn `/ws-call`; chép khối vá adapter ~12 dòng — gom helper khi có ca thứ ba, N4).
- **D-5 — payload mang id nguyên văn NGOÀI phạm vi.** `chat:room.roomId`, `call:peer-left.userId`, `oldValues.userId` của
  audit, khoá Valkey typing (`chat-typing.service.ts:83`) vẫn mang dạng route: chiều fail-closed/nhất quán, không mở
  đường đọc ⇒ N1 (chuẩn hoá uuid ở biên REST bằng pipe dùng chung).
- **D-6 (H4) — phần dư ghi tài liệu, không vá:** node KHÁC vẫn chỉ nhận leave qua pub/sub; reject của publish thành
  `unhandledRejection` (có sẵn ở mọi emit) ⇒ API-13 §7 + §7a.
- **D-7 (H5) — không migration, không đổi contracts/FE.** Gate FULL như đầu plan.

## 4. Thiết kế (kích thước)

| Tệp                                                               | Đổi                                                                                                              | Dòng        |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| `apps/api/src/realtime/rooms.ts`                                  | `canonicalId` nội bộ + bọc tham số 8 builder + docblock luật D-1                                                 | 115 → ~135  |
| `apps/api/src/realtime/realtime-emitter.service.ts`               | `leaveLocally(target, …)` tổng quát · vế cục bộ ở `syncRoomMembership('leave')` + `evictFromCallRoom` · docblock | 719 → ≤ 750 |
| `apps/api/src/realtime/rooms.spec.ts` (MỚI)                       | bảng 8 builder                                                                                                   | ~70         |
| `apps/api/src/realtime/realtime-emitter.chat.spec.ts`             | mock `local` + ca C-1…C-4                                                                                        | 375 → ~440  |
| `apps/api/src/realtime/realtime-emitter.call.spec.ts`             | describe evict E-1…E-5                                                                                           | 124 → ~210  |
| `apps/api/src/realtime/realtime-emitter.roomops.io.spec.ts` (MỚI) | ⚓ + 🔒 cho `/ws` và `/ws-call`                                                                                  | ~190        |
| `apps/api/test/integration/chat-rtroomops-1.int-spec.ts` (MỚI)    | R-1…R-4 + ALLOW                                                                                                  | ~260        |
| `docs/API Design/API-13_CHAT_API_Design.md`                       | §7 + §7a: ràng buộc D-1/D-2 + phần dư D-6                                                                        | +~10        |

Không tệp nào vượt 800. Emitter vượt 750 ⇒ rút docblock (trỏ về plan) thay vì làm dài thêm.

## 6. Ca test — RED trên mã cũ / ALLOW đứng cạnh

Int-spec gác `hasDb && LANE_DB`; đo PHÍA SERVER bằng `nsp.local.in(room).fetchSockets()` (khuôn E11m, `becomes` ⇒ đỏ bằng
`expect`, không bằng hết giờ). Actor vai THƯỜNG với cặp `CALL_FULL` (S9), không super-admin. Mọi uuid hằng có chữ a–f.

| Ca      | Tầng    | Kịch bản                                                                                                                                                                                                                                                   | Mã cũ                           | Sau vá |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------ |
| R-1     | int     | Admin `DELETE /chat/rooms/{ID-HOA}/members/{UID-HOA}` ⇒ socket `/ws` người bị gỡ rời `chatRoomName`                                                                                                                                                        | 🔴 ĐỎ                           | xanh   |
| R-2     | int     | Như R-1 giữa cuộc gọi (luồng C5) ⇒ socket `/ws-call` người bị gỡ rời `callRoomName`                                                                                                                                                                        | 🔴 ĐỎ                           | xanh   |
| R-3     | int     | Sau R-1, `POST /chat/rooms/{ID-HOA}/messages` ⇒ thành viên còn lại NHẬN `chat:message`; người bị gỡ 0 khung                                                                                                                                                | 🔴 ĐỎ (emit vào room lệch dạng) | xanh   |
| R-4     | int     | `call:join` với `callId` chữ HOA ⇒ socket ở `callRoomName` chuẩn tắc (S11)                                                                                                                                                                                 | 🔴 ĐỎ                           | xanh   |
| A-1     | int     | ALLOW: thành viên còn lại VẪN ở `chatRoomName` + `callRoomName` sau R-1/R-2                                                                                                                                                                                | xanh                            | xanh   |
| A-2     | int     | ALLOW: cùng luồng với id chữ thường ⇒ người bị gỡ rời phòng (đường đúng không đổi)                                                                                                                                                                         | xanh                            | xanh   |
| B-1     | unit    | `rooms.spec`: mỗi builder(id HOA) === builder(id thường); tiền tố `co:{c}:` giữ; hai công ty khác tên room                                                                                                                                                 | 🔴 ĐỎ                           | xanh   |
| C-1 ★   | unit    | `syncRoomMembership('leave')` ⇒ thứ tự `[local:leave user>chatroom, cluster:leave user>chatroom]`                                                                                                                                                          | 🔴 ĐỎ                           | xanh   |
| C-2 ★   | unit    | `'join'` ⇒ 0 lệnh cục bộ, đúng 1 `in(chatuser).socketsJoin(chatroom)`                                                                                                                                                                                      | xanh                            | xanh   |
| C-3 ★   | unit    | vế cục bộ NÉM ⇒ lệnh toàn cụm VẪN chạy + đúng 1 `logger.error`                                                                                                                                                                                             | 🔴 ĐỎ                           | xanh   |
| C-4     | unit    | id HOA ⇒ bộ chọn + đích ra chữ thường                                                                                                                                                                                                                      | 🔴 ĐỎ                           | xanh   |
| E-1 ★   | unit    | `evictFromCallRoom` ⇒ thứ tự local→cluster trên `callServer`                                                                                                                                                                                               | 🔴 ĐỎ                           | xanh   |
| E-2 ★   | unit    | vế cục bộ đi `callServer`, 0 lệnh trên server `/ws`                                                                                                                                                                                                        | 🔴 ĐỎ                           | xanh   |
| E-3     | unit    | `callServer` null ⇒ `error`, 0 lệnh, không ném                                                                                                                                                                                                             | xanh                            | xanh   |
| E-4     | unit    | `userId` HOA ⇒ bộ chọn `calluser` chữ thường                                                                                                                                                                                                               | 🔴 ĐỎ                           | xanh   |
| E-5 ★   | unit    | vế cục bộ NÉM ⇒ lệnh toàn cụm VẪN chạy + `error`                                                                                                                                                                                                           | 🔴 ĐỎ                           | xanh   |
| I-⚓1/2 | io      | adapter nuốt THẬT SỰ nuốt lệnh không-`local` trên `/ws` và `/ws-call` (chống xanh-rỗng)                                                                                                                                                                    | xanh                            | xanh   |
| I-1     | io      | `syncRoomMembership('leave')` dưới adapter nuốt ⇒ socket rời `chatRoomName`; lệnh toàn cụm vẫn phát (`dropped +1`)                                                                                                                                         | 🔴 ĐỎ                           | xanh   |
| I-2     | io      | `evictFromCallRoom` dưới adapter nuốt ⇒ socket rời `callRoomName`                                                                                                                                                                                          | 🔴 ĐỎ                           | xanh   |
| I-3     | io      | id HOA + adapter nuốt (cả hai room-op)                                                                                                                                                                                                                     | 🔴 ĐỎ                           | xanh   |
| I-A     | io      | ALLOW: socket của user KHÁC trong cùng room KHÔNG bị kéo ra                                                                                                                                                                                                | xanh                            | xanh   |
| H-1     | hồi quy | `chat-realtime-after-commit.spec.ts` · `realtime-emitter.feed*.spec.ts` · `realtime.gateway*.spec.ts` · `chat-realtime-structure.spec.ts` · `test/foundation/pipeline-parity.unit-spec.ts` · int `social-be2c-group-rooms` + `chat-s7-call-rt1-signalling` | xanh                            | xanh   |

R-3/R-4 dựa trên S3/S11 (đã đo); nếu RED ở T1 không đỏ đúng hành vi ⇒ ghi lệch ở sổ vết, không ép ca.

**Mutant** (sao lưu → cấy → chạy tệp liên quan → `cp` hoàn tác → `cmp`): ★1 bỏ chuẩn hoá ở `chatRoomName` (B-1, R-1, I-3) ·
★2 ở `userRoomName` (C-4, R-1) · ★3 ở `callUserRoomName` (E-4, R-2) · ★4 ở `callRoomName` (B-1, R-4) · ★5 bỏ vế cục bộ
`syncRoomMembership` (C-1, I-1) · ★6 bỏ vế cục bộ evict (E-1, I-2) · ★7 vế cục bộ evict dùng server `/ws` (E-2, I-2) ·
★8 gộp try hai vế (C-3, E-5) · ★9 vế cục bộ chạy cả nhánh `join` (C-2) · ★10 đảo thứ tự cluster→local (C-1, E-1). Đã ghim
sẵn (không cấy lại): bộ chọn leave đổi sang `chatUserRoomName` (`chat.spec:182`) · evict ra khỏi tx (`after-commit:183`).

## 7. Lát thi công

Mọi lệnh nặng qua `run-heavy.sh B <log> …`, lọc theo tệp, < 9 phút/lượt; `pnpm --filter @mediaos/api exec vitest run <path>`.

- **T0 — đo nền:** xác nhận wrapper có `LANE_DB` (int-spec phải chạy, skip = 0) · đếm baseline
  các spec H-1.
- **T1 — RED (mã chưa sửa):** viết B-1, C-1…C-4, E-1…E-5, I-⚓/I-1…I-3/I-A, int R-1…R-4/A-1/A-2. Chạy ⇒ mọi ca «🔴» đỏ
  ĐÚNG hành vi (`expect`), ⚓/ALLOW xanh. Commit `test(realtime): S17-CHAT-RTROOMOPS-1 — ca RED …`.
- **T2 — GREEN:** D-1 (`rooms.ts`) rồi D-2 (emitter). Chạy `src/realtime` + `src/chat/chat-realtime-after-commit.spec.ts` +
  int-spec mới. Commit `fix(realtime): S17-CHAT-RTROOMOPS-1 — …`.
- **T3 — hồi quy H-1** (int `chat-s7-call-rt1` chạy riêng một lượt) + `pipeline-parity.unit-spec.ts`.
- **T4 — mutant ★1–★10**, script ngoài repo; ghi số bị giết.
- **T5 — docs** API-13 §7/§7a (D-1, D-2, phần dư D-6). Commit `docs(chat): …`.
- **T6 — typecheck + eslint** gói api (wrapper); prettier từng tệp sửa.
- **T7 — FULL gate** (security · silent-failure · typescript · santa ×2) → vá → sổ vết. `bash harness/check.sh --all`
  (có `LANE_DB`) trước khi luồng chính mở PR.

## 8. [OWNER]

- **O1 merge** — PR do luồng chính mở; tự tạo ⇒ `--admin`. Chuỗi B KHÔNG push/mở PR/merge.
- **O2 deploy** — chỉ API (`m prod-update api`), không migration, không FE. Repo PUBLIC: merge = công bố bản vá ⇒ deploy
  ngay sau merge (rút ngắn cửa sổ).
- **O3 đo sau deploy** — `/api/v1/health` lên SHA merge; một lượt gỡ thành viên thử trên phòng thử (không dữ liệu thật):
  người bị gỡ không còn nhận tin mới của phòng. Không ghi dữ liệu PROD vào repo.

## 9. Nợ + rủi ro

- **N1** chuẩn hoá uuid ở biên REST (pipe dùng chung) cho payload/audit/khoá Valkey (D-5) — đề xuất seed WO amber.
- **N2** đa-instance: node khác vẫn chỉ nhận leave qua pub/sub (D-6) — đóng hẳn cần xác nhận phía adapter; ghi API-13 §7.
- **N3** `unhandledRejection` khi publish rớt — có sẵn ở mọi emit (D-6).
- **N4** khối vá adapter-nuốt lặp ở 2 io spec — gom helper khi có ca thứ ba.
- **N5** `toLowerCase` ở `syncFeedGroupMembership:377` thừa sau D-1 — dọn trong một WO SOCIAL.
- **N6** cửa sổ rejoin `call:join` đọc trước commit (docblock evict) — có sẵn, ngoài phạm vi.
- Rủi ro: (a) đổi builder chạm cả room SOCIAL/NOTI — đầu vào đã chuẩn cho chuỗi y hệt (B-1 + hồi quy H-1 đo); (b) mock
  thiếu `local` ở spec khác ⇒ xanh ồn — grep `makeServer`/`in: vi.fn` trong `src/**` ở T2; (c) emitter sát 750 dòng.
- Đường lùi: revert commit `fix(realtime)` ⇒ `m prod-update api`; không dữ liệu, không hình dạng DTO đổi.

### 9.3 Sổ vết

| Bước    | Ngày       | Kết quả                                                                                                                                                                                                                                                |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Plan v1 | 23/10/2026 | Trên `6ac4ca48`. Chốt D-1 (chuẩn hoá ở builder `rooms.ts`) · D-2 (`leaveLocally` tổng quát, cục bộ trước toàn cụm) · D-3 (không sửa `chat/**`) · D-4 (int-spec mới qua `applyMainPipeline`) · D-5/D-6 (ngoài phạm vi ⇒ N1–N3) · D-7 (không migration). |
