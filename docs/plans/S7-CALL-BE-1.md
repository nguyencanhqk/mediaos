# S7-CALL-BE-1 — Vòng đời cuộc gọi qua REST (`CHAT-API-026..029`)

> 🔴 **VÙNG ĐỎ / crown-jewel.** Cặp quyền mới + đường ghi mới trên bảng append-only + secret ngoài (TURN).
> Nguồn chuẩn: [`DECISIONS-07`](../DECISIONS/DECISIONS-07_Chat_Call_Signalling.md) (ĐÃ KÝ 08/08/2026 · hàng rào **R4**) ·
> [SPEC-15 §5.1c · §12 · §15a](<../SPEC/SPEC-15 CHAT.md>) · [API-13 §5.1c](<../API Design/API-13_CHAT_API_Design.md>) ·
> migration `0546` (`S7-CALL-DB-1`, đã land) · `packages/contracts/src/chat-call.ts` (đã land).

---

## 0. Ranh giới của WO này

| Trong phạm vi | NGOÀI phạm vi (WO khác) |
| --- | --- |
| 6 route REST vòng đời + `GET /chat/calls/ice-config` | Gateway `/ws-call`, allowlist 8 sự kiện, relay SDP/ICE → **`S7-CALL-RT-1`** |
| Job quét `ringing` quá hạn → `missed` | Thông báo tới người được gọi (chuông đến) → **`S7-CALL-RT-1`** |
| Audit mọi thao tác vòng đời | UI gọi/nhận/khung đang gọi → **`S7-CALL-FE-1`** |
| Deny-path + cô lập 2-tenant cho 7 route trên | Bộ test đầy đủ wave → **`S7-CALL-QA-1`** |

⚠️ **Hệ quả phải nói ra:** sau WO này người được gọi **chưa nhận được tín hiệu nào** — chuông đến là việc của
`RT-1`. BE-1 xanh **không** có nghĩa "gọi được"; nó có nghĩa "vòng đời ghi đúng, audit đủ, không ai gọi được vào
phòng mình không thuộc". Đo nghiệm thu bằng int-spec, KHÔNG bằng thử tay trên UI.

---

## 1. Những gì `S7-CALL-DB-1` đã làm — KHÔNG làm lại

Đọc `0546` trước khi viết dòng nào. BE-1 **dựa vào** các bảo đảm sau, và mỗi bảo đảm đổi cách viết code:

| DB đã ép | Hệ quả cho BE-1 |
| --- | --- |
| `chat_calls_one_live_per_room_uq` (partial unique `status IN ('ringing','active')`) | **CẤM kiểm-rồi-ghi**. Đường 409 là `INSERT` → bắt `23505` trên đúng index này. Kiểm trước rồi insert vẫn lọt hai lời mời đồng thời. |
| Trigger `chat_calls_forbid_revive_trg` (23514) | 422 vẫn phải kiểm **ở service** (thông điệp cho người dùng); trigger là lưới cuối. Map `23514` → 422 để hàng đua không thành 500. |
| `GRANT UPDATE (status, accepted_at, ended_at)` — KHÔNG có cấp bảng, KHÔNG có DELETE | Chỉ được ghi đúng 3 cột đó trên `chat_calls`, đúng 3 cột `(joined_at, left_at, outcome)` trên participants. Đụng cột khác = `42501` lúc chạy, không phải lỗi typecheck. |
| `company_id DEFAULT current_setting(...)` | `insert().values({roomId,...})` KHÔNG truyền `companyId` — để DB điền qua GUC của `withTenant`. |
| Cặp `('call','chat-room')` đã seed + grant 4 role canonical | **KHÔNG migration quyền ở WO này.** Nhưng pin canonical đã cập nhật cùng `0546` ⇒ chỉ cần không đụng vào. |
| `audit_logs.object_type` đã có `'chat_call'` (SQL) **và** union TS `AuditObjectType` (`db/schema/audit.ts:141`) | Audit dùng `objectType: "chat_call"` được ngay, không migration. |

---

## 2. Quyết định thiết kế (những chỗ spec không nói, tôi chốt ở đây)

### D1 — `assertCallAccess` sống trong `ChatAccessService`, KHÔNG trong `chat-calls.service.ts`

5/6 route vòng đời nhận `callId`, không nhận `roomId`. Viết `findCall()` rồi `assertMember(call.roomId)` là **hai
thông điệp lỗi khác nhau** ⇒ bắn `callId` ngẫu nhiên dò được cuộc gọi nào có thật — đúng lớp oracle mà
`assertMessageAccess` đã dựng 404 hằng để chặn, chỉ đổi trục từ *tin* sang *cuộc gọi*.

⇒ Thêm phương thức **thứ ba** vào `ChatAccessService`: MỘT truy vấn `chat_calls ⋈ chat_rooms ⋈ chat_room_members`,
tái dùng ĐÚNG `activeMembershipJoin()` + `visibleRoom()` đã có. Không có bản sao thứ hai của luật membership
(bất biến #3 của file đó, có ca test grep đóng đinh).

> Vì thế `paths` của WO **phải mở rộng** thêm `chat-access.service.ts` + `chat.errors.ts`. Đây là mở rộng có lý
> do, không phải scope creep: phương án thay thế là nhân bản luật quyền.

### D2 — Người tham gia = **toàn bộ thành viên đang hoạt động** của phòng, seed tại lúc mời

`createChatCallSchema` (đã land, đã đóng băng) chỉ có `{ kind }` — **không có `calleeUserId`**. Vậy người được gọi
phải suy ra từ phòng. Chốt: mời ⇒ tạo hàng participant cho **mọi thành viên active**, initiator có `joined_at=now`.

- Vì sao không "chỉ 2 người": phòng `group`/`department` có >2 thành viên, không có trường nào chỉ định ai là
  người nhận ⇒ chọn hộ là bịa.
- Vì sao **không** chặn người thứ ba nhận máy: §12 chốt đúng 30 mã và **không có mã nào** cho "cuộc gọi đã đủ
  người". Bịa mã ngoài sổ làm `chat-error-code-census` ĐỎ ở vế "không có mã ngoài sổ" (đúng thiết kế). Ràng buộc
  **1-1 là thuộc tính TOPOLOGY MEDIA** do FE/`/ws-call` giữ, không phải bất biến dữ liệu — nhất quán với **R3**
  (server không đọc, không diễn giải nội dung media).
- ⚠️ **Nợ sản phẩm phải báo owner:** bấm gọi trong phòng phòng-ban 40 người ⇒ 40 hàng participant + 40 người đổ
  chuông (khi `RT-1` land). `FE-1` cần quyết định có ẩn nút gọi ở phòng >2 người hay không. Ghi ở đây để quyết
  định đó được đưa ra **có ý thức**, không phải phát hiện sau khi ship.

### D3 — Hết hạn `ringing` xử lý ở **HAI** chỗ, không chỉ ở job

Job chạy theo nhịp `SYSTEM_JOBS_POLL_MS` (mặc định **60s**). Nếu chỉ có job, một cuộc gọi không ai nhấc để lại
`ringing` sống tới ~60s ⇒ partial unique index **khoá phòng**: mọi lời mời tiếp theo 409 dù không còn ai đang gọi.
Đó chính là "phòng kẹt" mà SPEC-15 §15a cảnh báo, chỉ đổi nguyên nhân từ "client tự đóng khung" sang "job chưa tới nhịp".

⇒ **Quét-tại-chỗ-mời**: `POST /rooms/:id/calls` hết hạn các `ringing` quá hạn của **chính phòng đó** trong cùng tx,
TRƯỚC khi `INSERT`. Cùng vị từ, cùng hàm với job (`expireStaleRingingTx`) — một bản sao duy nhất. Job vẫn cần thiết:
nó đóng cuộc gọi ở phòng **không ai mời lại** (nếu không, hàng `ringing` sống mãi và `missed` không bao giờ được ghi).

### D4 — 409 sinh từ `23505`, không từ `SELECT` trước

```sql
-- expireStaleRingingTx(roomId): dọn hàng quá hạn của phòng này
INSERT INTO chat_calls (...);  -- 23505 trên chat_calls_one_live_per_room_uq → 409 CHAT-ERR-028
```
Bắt lỗi phải **neo theo tên constraint**, không theo mã 23505 trần: bảng còn `chat_calls_company_id_id_uq`, nuốt
mọi 23505 thành 409 sẽ giấu một lỗi hoàn toàn khác.

### D5 — Bốn thao tác kết thúc, một hàm ghi duy nhất

| Route | Ai được làm | `status` | `outcome` của actor | Vế chặn riêng |
| --- | --- | --- | --- | --- |
| `accept` | người được mời (≠ initiator) | `active` (+`accepted_at`) | `accepted` (+`joined_at`) | đang `ringing`; `active` rồi → vẫn cho vào (D2) |
| `reject` | người được mời (≠ initiator) | `rejected` (+`ended_at`) | `rejected` | chỉ khi đang `ringing` |
| `cancel` | **chỉ initiator** | `cancelled` (+`ended_at`) | `cancelled` | chỉ khi đang `ringing` |
| `hangup` | bất kỳ participant | `ended` (+`ended_at`) | `left` (+`left_at`) | chỉ khi `ringing`/`active` |

Mọi chuyển trạng thái đi qua **một** hàm `mustTransition(fromStatuses, to)` — bốn bản sao của "ghi `ended_at` +
`outcome`" là bốn chỗ để quên `ended_at` và ăn `chat_calls_ended_at_chk` (23514) lúc chạy. Vế `fromStatuses` nằm
trong `WHERE`, nên "sai pha" và "đã kết thúc" cùng cho 0 hàng ⇒ cùng ra 422.

**Ai được làm** là câu hỏi khác **trạng thái có cho làm không**, nên hai loại lỗi khác nhau:
`cancel` bởi người không phải initiator, và `accept`/`reject` bởi CHÍNH initiator (`CHAT-API-027`: "chỉ người
**được mời**") → **403 `CHAT-ERR-027`**. Cả hai đã qua `assertCallAccess` nên đã biết cuộc gọi tồn tại — giấu
thêm không che được gì. 422 dành riêng cho vế trạng thái. Trộn hai loại vào một mã làm FE không phân biệt được
"thử lại sau" với "không bao giờ được".

### D6 — `ice-config`: gate quyền, timeout, và KHÔNG log

- Gate `('call','chat-room')` — cặp module, KHÔNG `assertMember` (route không mang `roomId`; API-13 ghi `—` ở cột Membership).
- `CLOUDFLARE_TURN_KEY_ID`/`CLOUDFLARE_TURN_API_TOKEN` **thêm vào `env.schema.ts` dạng `.optional()`** (khuôn
  `LMS_SSO_SECRET`): thiếu env ⇒ **không sập boot**, chỉ rơi về STUN Google. Cấu hình thiếu không được biến cả API
  thành không khởi động được.
- `fetch` có **AbortSignal.timeout(3000)**: Cloudflare treo không được phép treo request của người dùng. Hỏng/timeout
  → log **status code + thông điệp trung tính**, rơi về STUN. TUYỆT ĐỐI không log body phản hồi (chứa credential),
  không log token, không đưa secret vào DTO.
- Không cache ở v1: credential TTL 3600s là **của một người**; cache dùng chung là phát cùng một credential cho mọi
  người và kéo dài đời của nó ngoài tầm kiểm soát.

### D7 — Job: `@SystemJobHandler` + hằng `jobCode` DUY NHẤT

`CHAT_CALL_RINGING_TIMEOUT`. Idempotent: chạy lại ngay ⇒ 0 hàng (vị từ `status='ringing' AND started_at < now()-TTL`
tự loại hàng đã đổi). Ghi audit `chat.call.missed` với `actorType:'Job'`, **không** `actorUserId` (không người nào
đứng sau — mirror `CHAT_AUDIT.ROOM_AUTO_*`).

⚠️ **Về `@Optional()` trong `done_when`:** memory `systemjobhandler-optional-dbw-di` áp cho handler nhận tham số
**KHÔNG phải Nest provider** (`workerDb: Database`). Handler này chỉ nhận `DatabaseService` + `AuditService` +
`ChatCallsRepository` — cả ba là provider thật, đúng khuôn `ChatDerivedRoomsReconcileJobHandler` (không `@Optional()`,
đang chạy PROD). Gắn `@Optional()` cho một provider có thật sẽ **biến lỗi wiring thành `undefined` im lặng** — ngược
đúng thứ memory đó bảo vệ. ⇒ **Không gắn**, và thay bằng bằng chứng MẠNH HƠN: một ca int-spec **dựng AppModule
THẬT** và khẳng định `jobCode` có mặt đúng 1 lần trong danh sách handler (mẫu `chat-be5-derived-rooms.int-spec.ts:737`).

### D8 — Ngưỡng đổ chuông = hằng có tên, 45s

`CHAT_CALL_RING_TIMEOUT_MS = 45_000`. Không lấy từ env: đây là hằng số nghiệp vụ (SPEC không cấp env nào), và một
núm vặn không ai chỉnh là một núm vặn sẽ trôi khỏi tài liệu.

### D9 — WS im lặng ở WO này

`ChatCallsService` **không** import `RealtimeEmitterService`. Đường phát là của `RT-1` và nó gắn vào **sau commit**
(mẫu `ChatRoomsService.broadcastRoom`). Cắm sẵn một emitter "để đó" là cắm sẵn một payload chưa qua DTO/masking —
đúng thứ CLAUDE.md §5 cấm.

---

## 3. Bản đồ tệp

| Tệp | Vai trò |
| --- | --- |
| `apps/api/src/chat/chat-calls.controller.ts` | `POST /chat/rooms/:id/calls` (026) · `POST /chat/calls/:id/{accept,reject,cancel,hangup}` (027/028). `@UseGuards(PermissionGuard)` **cấp class** + `@RequirePermission('call','chat-room')` mỗi route |
| `apps/api/src/chat/chat-call-ice.controller.ts` | `GET /chat/calls/ice-config` (029) — **tách controller**: đây là route DUY NHẤT không chạm DB, không `assertMember`, và là route duy nhất gọi ra Internet (mirror lý do `ChatSearchController`/`ChatFilesController` tách) |
| `apps/api/src/chat/chat-calls.service.ts` | Vòng đời: `invite` · `accept` · `reject` · `cancel` · `hangup` + `finishTx` dùng chung + audit trong cùng tx |
| `apps/api/src/chat/chat-calls.repository.ts` | SQL thuần: insert call + participants, update 3 cột, `expireStaleRingingTx`, đọc participants |
| `apps/api/src/chat/chat-call-ice.service.ts` | Cloudflare TURN + STUN dự phòng, timeout, 0 log credential |
| `apps/api/src/chat/chat-call-ringing-timeout.job-handler.ts` | Job quét `ringing` quá hạn |
| `apps/api/src/chat/chat-access.service.ts` | **+`assertCallAccess`** (D1) |
| `apps/api/src/chat/chat.errors.ts` | +5 hằng `CHAT_ERR` (026..029) · +6 hằng `CHAT_AUDIT` |
| `apps/api/src/chat/chat.mapper.ts` | +`toChatCallDto` (khớp `chatCallSchema` đã land) |
| `apps/api/src/chat/chat.module.ts` | Khối additive: 2 controller + 4 provider |
| `apps/api/src/config/env.schema.ts` | +2 biến TURN `.optional()` · `.env.example` |
| `apps/api/src/chat/chat-error-code-census.spec.ts` | Xoá 4 dòng nợ 026..029 khỏi `PENDING_CODES` (030 **giữ nguyên** — của `RT-1`) |
| `apps/api/test/integration/chat-s7-call-be1-lifecycle.int-spec.ts` | Bộ deny-path + vòng đời + cô lập tenant |
| `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` | Regen `ROUTE_CENSUS_WRITE=1` (7 route mới ⇒ census ĐỎ nếu quên) |

---

## 4. Deny-path RED **TRƯỚC** (viết trước khi có code)

Thứ tự này là bắt buộc — ca 1-4 phải ĐỎ trên cây chưa có service, rồi mới GREEN.

1. **404 ≡ không tồn tại.** Người CÓ cặp `('call','chat-room')` nhưng ngoài phòng: `POST /rooms/:id/calls` trả
   **404** và thân **byte-giống-hệt** với `roomId` bịa. Cùng vế trên `callId` bịa vs `callId` có thật ở phòng khác.
2. **403 khác 404.** Thành viên phòng nhưng vai trò không có cặp `('call','chat-room')` → **403** (`CHAT-ERR-027`).
   ⚠️ Dựng bằng role **KHÔNG** phải super-admin (memory `superadmin-not-a-canonical-role`: test bằng SA là tautology).
3. **Cô lập 2 tenant.** Actor tenant A + `callId` của tenant B → 404, và **0 hàng** đổi ở B (đo lại bằng SELECT).
4. **`view:chat-oversight` KHÔNG mở cửa.** Người có cặp đọc-vượt, không thuộc phòng → **404** ở cả 6 route
   (SPEC-15 §5.1c ghi tường minh; đây là suy diễn nguy hiểm nhất của wave).
5. **409 dưới ĐUA THẬT.** Hai `invite` đồng thời cùng phòng → đúng **1** thành công, 1 nhận 409, và `chat_calls`
   có đúng **1** hàng sống. (Chạy hai promise song song, không tuần tự — tuần tự không đo được index.)
6. **422 FSM.** `accept` một cuộc gọi đã `cancelled` → 422. `hangup` cuộc gọi đã `ended` → 422. Và ca đối kháng:
   `UPDATE` thẳng DB đưa `ended` → `ringing` phải **23514** (chứng minh trigger còn sống, không phải chỉ service chặn).
7. **Audit đủ 6 hành động.** Mỗi thao tác thành công ⇒ đúng 1 dòng `audit_logs` với `object_type='chat_call'`,
   `object_id=callId`, `module_code='CHAT'`. Deny-path (404/403) ⇒ **0 dòng** (không audit thứ chưa xảy ra).
8. **Append-only còn nguyên.** App role KHÔNG `DELETE` được `chat_calls`, KHÔNG `UPDATE` cột `room_id`/`started_at`
   (đo bằng `has_column_privilege`, không bằng đọc migration — memory `grant-in-old-migration-is-not-current-state`).
9. **Job idempotent + wired.** Chạy `run()` hai lần liên tiếp: lần 2 trả 0. Và AppModule THẬT liệt kê `jobCode`
   đúng 1 lần (D7).
10. **ice-config không rò.** Không có env TURN → 200 + chỉ STUN. Có env (mock fetch) → không chuỗi nào của
    `CLOUDFLARE_TURN_API_TOKEN` xuất hiện trong log đã bắt.

⚠️ **Ca ALLOW bắt buộc đi kèm mỗi ca DENY** (memory `deny-cases-vacuous-without-allow-case`): thiếu ca cho phép,
một service ném 404 vô điều kiện vẫn làm mọi ca deny XANH.

---

## 5. Bẫy đã biết — kiểm trước khi mở PR

| Bẫy | Biểu hiện | Cách chặn |
| --- | --- | --- |
| `route-census-runtime-gate` | 7 route mới ⇒ census ĐỎ | `ROUTE_CENSUS_WRITE=1` regen + kiểm `route-guard-coverage` xanh |
| `PermissionGuard` opt-in per controller | Quên `@UseGuards` ⇒ route **không gate** mà test vẫn xanh | Guard cấp class ở CẢ HAI controller; census khẳng định `hasPermission` |
| `chat-error-code-census` | Gỡ nhầm `CHAT-ERR-030` (của RT-1) ⇒ census đòi ca test chưa tồn tại | Chỉ gỡ 026..029 |
| `attribution-patch-creates-timing-oracle` | `assertCallAccess` chạy sau khi đã đọc call ⇒ lệch thời gian | Một truy vấn, một hằng thông điệp |
| `clamp-must-be-sql-not-js` | Đọc-rồi-ghi `status` ở JS ⇒ lùi im lặng dưới đua | `UPDATE ... WHERE status IN (...)` + đếm hàng ảnh hưởng; 0 hàng ⇒ 422 |
| `partial-unique-index-makes-join-duplicate` | JOIN participants nhân bản | Bảng participants có unique `(company_id, call_id, user_id)` ⇒ an toàn; vẫn assert số hàng trong test |
| `turbo-cache-false-green` | `pnpm test` trả log cũ | `bash harness/check.sh --lane-db=call1` |
| `integration-test-lane-db-gate` | int-spec SKIP mà tưởng xanh | `--lane-db`, kiểm dòng skip < ngưỡng |

---

## 5b. Kết quả — hai lỗi mà bộ test bắt được (ghi lại vì cả hai đều "xanh khi thử tay")

### B1 — 409 trả **500**: `23505` của drizzle nằm trong `cause`, không ở lớp ngoài

`isLiveCallConflict` kiểm `(err as any).code === '23505'`. `drizzle-orm` bọc lỗi driver trong
`DrizzleQueryError`, nên `err.code` ở lớp ngoài là `undefined` ⇒ vị từ luôn `false` ⇒ hai lời mời đồng
thời nhận **`500 SYSTEM-ERR-001`** thay vì `409 CHAT-ERR-028`.

Đáng ghi vì **chỉ hỏng dưới điều kiện đua**: mọi thao tác tuần tự (kể cả "mời hai lần liên tiếp") vẫn
xanh, vì lần hai đã bị bước dọn/kiểm trạng thái xử lý trước khi tới `INSERT`. Ca test duy nhất bắt được
là ca bắn **song song** — `Promise.all`, không phải hai `await` nối nhau. Vá: `pgErrorOf()` đi theo chuỗi
`cause` có cận trên; áp cho cả `isCallStateViolation` (23514) vì nó cùng lỗ.

### B2 — 4 route vòng đời trả **201 Created**

Mặc định của Nest cho `@Post`. Bốn thao tác đó không tạo tài nguyên nào — chúng đổi trạng thái một hàng
đã có. Vá bằng `@HttpCode(200)`; `invite` (026) giữ 201.

### Bằng chứng cổng THẬT SỰ cắn (đo bằng vi phạm, không bằng niềm tin)

- B1/B2 là **RED tự nhiên**: bộ test đỏ trước, xanh sau khi vá — không phải test viết sau để hợp thức hoá.
- Ca 4b được kiểm bằng **mutation**: gỡ vế `findParticipant` khỏi `lifecycleTx` ⇒ người vào phòng sau khi
  cuộc gọi bắt đầu **gác máy được** cuộc gọi của hai người khác (HTTP 200, `status='ended'`). Ca test đỏ
  đúng chỗ; khôi phục thì xanh lại.
- ⚠️ Bản đầu của ca 4b **tự vô nghĩa** và đã phải viết lại: nó dùng người thiếu cặp `('call','chat-room')`,
  nên `PermissionGuard` chặn TRƯỚC và nhánh `findParticipant` chưa từng chạy — một ca DENY xanh đo nhầm
  hàng rào. Phải gieo người dùng **có đủ quyền** mới đo được vế thứ hai.

## 5c. Vòng vá `S7-CALL-BE-FIX-1` — MEDIUM-3 đóng đủ **HAI vế**

MEDIUM-3 báo: mỗi lời mời ghi `1 + N` hàng **append-only** vào `chat_call_participants` (bảng **không có
job dọn**), và không có gì chặn việc bơm. Vòng vá đầu chỉ đóng được một nửa:

| Vế | Cơ chế | Chặn cái gì |
| --- | --- | --- |
| **Kích thước** (vòng 1) | `CHAT_CALL_MAX_INVITEES = 20` — cắt danh sách người được mời, luôn giữ người khởi tạo | Một lời mời ở phòng phòng-ban 300 người ghi 301 hàng |
| **Tần suất** (vòng 2, mục này) | `CHAT_CALL_INVITE_MAX_PER_MIN` (env, mặc định **10**) qua `ChatCallCooldownService` | 10.000 lời mời nhỏ — vòng lặp mời/huỷ/mời |

Ghi chú cũ hoãn vế tần suất sang lane RT-1 với lý do "dựng bộ đếm thứ hai = lỗi `duplicate-sibling`". Lý
do vẫn đúng, **tiền đề đã đổi**: `ChatCallCooldownService` (S7-CALL-SEC-1) nay sống trong chính module
này ⇒ dùng lại nó với `scope` riêng là **một hiện thực, hai bucket**, không phải bản sao.

**Bốn quyết định của vế tần suất** (chi tiết + lý do ở docblock `assertInviteCooldown`):

1. **Khoá theo NGƯỜI, không theo (người, phòng).** Chia theo phòng thì ai ở nhiều phòng nhân được hạn mức
   lên bấy nhiêu lần.
2. **Cổng đứng TRƯỚC `withTenant`**, tức trước cả `assertMember`. Rate-limit đặt sau membership vẫn phải
   mở transaction cho mỗi lần bị chặn — đúng thứ nó dựng ra để tránh. Không thành oracle dò phòng: 429
   giống hệt nhau dù phòng có thật hay không.
3. **Đếm MỌI lần thử**, kể cả lần kết thúc 404/409/422 — tha nhánh thất bại là để hở con đường rẻ nhất.
4. **KHÔNG ghi `audit_logs` ở nhánh bị chặn, chỉ `warn`.** Ghi audit mỗi lần chặn sẽ đổi
   `chat_call_participants` (có trần) lấy `audit_logs` (append-only, **không** trần) — biến hàng rào
   chống bơm thành một đường bơm khác.

**429 KHÔNG mang mã `CHAT-ERR-xxx`, và đó là chủ ý.** SPEC-15 §12 chốt đúng **30** mã nghiệp vụ (census
`chat-error-code-census.spec.ts` ép con số đó). Vượt tần suất là hàng rào **hạ tầng**, không phải rule
nghiệp vụ ⇒ đi theo mã nền `SYSTEM-ERR-RATE-LIMIT` mà `httpStatusToCode(429)` đã cấp sẵn, đúng thứ
`openapi-enrich` tài liệu hoá ("429 — vượt giới hạn tần suất"). Đẻ `CHAT-ERR-031` ở đây sẽ làm census ĐỎ
và buộc sửa spec owner đã ký cho một thứ không thuộc trục nghiệp vụ. **Ánh xạ HTTP ghi bổ sung ở API-13
§8** (một dòng, additive).

**Bằng chứng RED-trước-GREEN** (đo bằng cách gỡ đúng một dòng `await this.assertInviteCooldown(actor)`):

- `src/chat/chat-calls.invite-cooldown.spec.ts` — **4/4 ĐỎ** khi gỡ, 4/4 xanh khi khôi phục. Spec này
  **colocated trong `src/`** chứ không chỉ ở int-spec: int-spec `skipIf(!hasLaneDb)` sẽ SKIP trên CI
  thường, và một hàng rào chống-lạm-dụng mà bằng chứng duy nhất ngủ là hàng rào không ai biết đã gỡ.
- `chat-s7-call-be1-lifecycle.int-spec.ts` ca **11e** — ĐỎ (`expected 409 to be 429`) khi gỡ; xanh khi
  khôi phục. Ca này đo trên đường thật: 41 lượt liên tiếp ⇒ `201 → 409 … 409 → 429`, và sau tất cả bảng
  append-only chỉ nhận hàng của **đúng một** cuộc gọi.
- Ca 11e còn có **hai ca đối chứng** chống xanh-rỗng: một lượt giữa phải là **409** (chứng minh cổng
  không chặn vô điều kiện), và `uCaller` phải vẫn mời được **201** ngay sau đó (chứng minh bucket tách
  theo người). Tương tự ở unit spec: ca "tách bucket ice-config" assert **bucket invite ĐÃ bị tiêu** trước
  khi kết luận bucket kia còn nguyên.

⚠️ **Int-spec tự nó là kẻ lạm dụng theo định nghĩa của hàng rào này** — `uCaller` bắn ~26 lời mời trong
vài giây, quá xa mặc định 10/phút. File đặt `CHAT_CALL_INVITE_MAX_PER_MIN = 40` ở **module scope, trước
khi `AppModule` compile** (service đọc env một lần lúc dựng provider — sửa sau `app.init()` vô tác dụng).
Thêm ~15 lời mời nữa cho `uCaller` là chạm trần và bộ test đỏ ở chỗ khó đoán (429 thay vì 201/409): khi
đó **nâng hằng đó**, đừng đi sửa ca test.

---

## 6. Nghiệm thu

- `bash harness/check.sh --lane-db=call1` XANH (không phải "XANH KHÔNG ĐỦ BẰNG CHỨNG").
- 10 nhóm ca §4 xanh, có bằng chứng RED trước cho ca 1-4.
- Census route + census mã lỗi + `route-guard-coverage` xanh.
- FULL gate (security + database + silent-failure) PASS.
