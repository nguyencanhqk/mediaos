# S11-ROOM-QA-1 — nghiệm thu QA module ROOM (bằng chứng đo)

> Work Order: `harness/backlog.mjs` → `S11-ROOM-QA-1`. Nguồn luật: [`SPEC-14 ROOM`](../../SPEC/SPEC-14%20ROOM.md)
> §20 (tiêu chí nghiệm thu) + §21 (test scenario cấp cao) + [`S11-OFFICE-WAVE`](../../plans/S11-OFFICE-WAVE.md) §7 (bẫy 7, 9).
> Lane `mediaos_roomqa` (dựng MỚI, chain `0000 → 0557`) · master `b092cf60` + thay đổi của WO này.
> Ngày đo: **2026-08-30**.

Bảng dưới **không nhân bản** nội dung test — nó ánh xạ *luật §21* → *ca đang canh luật đó*. Cột **Ca**
in đậm = ca **MỚI** của WO này; ô không in đậm = đã có từ `S11-ROOM-BE-1`/`DB-1` (không viết lại).

---

## 1. Truy vết SPEC-14 §21 → ca test

| Nhóm §21 | Ca đang canh | Kết luận |
| --- | --- | --- |
| Deny-path (RED trước) — thiếu từng cặp trong 5 cặp | **`s11-room-qa1-permission-matrix` A (13) + B (14)** · `room-be1-scope` A | **LỖ ĐÃ LẤP** — xem §2 |
| Deny-path — `book@Own` gửi organizer khác → 403 · `cancel@Own` lượt người khác → 403 | `room-be1-scope` B, C | đủ |
| Deny-path — cross-tenant mọi endpoint → 404 | `room-be1-scope` D (7 route `:id`) + **`…qa1-error-residue` A (2)** | **được siết** — xem §3 |
| Deny-path — `/me/room-bookings?userId=` bị bỏ qua | `room-be1-scope` E | đủ |
| Trùng lịch — giao đầu / cuối / bao trùm / bị bao trùm | **`…qa1-error-residue` E (4 hình + 2 hình kề)** | **LỖ ĐÃ LẤP** (BE-1 có đúng 1 hình) |
| Trùng lịch — kề nhau `[)` OK · `Cancelled` không chặn · khác phòng OK | `room-be1-booking` · `s11-room-db1-invariants` C2 | đủ |
| **Race 2 request song song → 1 thắng** | `room-be1-booking` RACE (3 ca: HTTP · service · 23P01 thật) · `s11-room-db1-invariants` C3 (2 connection, COMMIT thật) | đủ — xem §6 |
| Validate — **10 mã §12, mỗi `kind` ≥ 1 ca** | **`room-error-code-census.unit-spec` (32 ca, cổng tĩnh)** + **4 ca runtime mới** | **LỖ ĐÃ LẤP** — xem §4 |
| FSM `Confirmed → Cancelled` một lần | `room-be1-booking` ROOM-ERR-005 (4 ca) | đủ |
| Sức chứa & tham dự | `room-be1-booking` + **`…qa1-error-residue` B, F** | **được siết** |
| Phòng (tên trùng · vô hiệu khi còn lịch · xoá mềm) | `room-be1-booking` + **`…qa1-error-residue` A, F** | đủ |
| Idempotent — replay · `KEY_REUSED` | `room-be1-booking` Idempotency-Key (2 ca) | đủ |
| Idempotent — `IN_PROGRESS` · `INVALID_KEY` · **không phát lại chéo user/company** | **`s11-room-qa1-idempotency-scope` (5 ca)** | **LỖ ĐÃ LẤP** — xem §5 |
| NOTI — 3 event DedupeKey · actor bị loại · **job nhắc idempotent** | `room-be1-noti` (5 ca, có ca "chạy lại không thêm") · `s11-room-db1-invariants` G | đủ — xem §6 |
| Sổ không xoá (`DELETE`/`UPDATE` ngoài allowlist bị từ chối ở DB) | `s11-room-db1-invariants` A1–A3 · `room-be1-booking` BẤT BIẾN #2 | đủ |
| Tenant — `rls-tenant-isolation-tester` 3 bảng ROOM | `rls-registry.ts` có đủ `meeting_rooms` · `room_bookings` · `room_booking_attendees` | đủ |
| Di sản — 4 bảng `meeting_*` không tồn tại, 6 cặp soft-deleted | `s11-room-db1-invariants` F2 | đủ |
| Audit — mỗi mutation +1 hàng đúng `object_type`; đặt hộ ghi cả organizer lẫn bookedBy | `room-be1-booking` audit (2 ca) · `room-be1-scope` B | đủ |
| Múi giờ — `?date=` theo `companies.timezone` | `room-be1-booking` `/me/room-bookings` (3 ca) | đủ |

**Ngoài phạm vi WO này (báo, không làm):**

- **§20 mục 9 e2e qua UI** (đặt → trùng → đổi giờ → huỷ): `paths` của WO phủ `apps/app/src/routes/rooms/**`
  nhưng e2e cần môi trường có seed phòng thật + trình duyệt; wave chưa dựng. Phủ tạm bằng 39 ca thuần
  (`room-time`/`room-errors`/`room-actions`) + 19 ca wiring của `S11-ROOM-FE-1`. Đề xuất gộp vào WO e2e
  chung của wave, không âm thầm coi là xong.
- **Widget DASH «lịch họp hôm nay»** — thuộc `S11-OFFICE-DASH-1`, nằm ngoài `paths`.

---

## 2. Lỗ #1 — deny-path chứng minh SAI thứ (13 route, 8 chưa từng có ô riêng)

`room-be1-scope` mục A dựng những chủ thể thiếu **nhiều** cặp cùng lúc (`vo` thiếu cả `book` lẫn `manage`;
`np` thiếu tất cả) rồi bắn vào **một** route đại diện mỗi cặp. Ca đó chứng minh *"thiếu quyền thì bị chặn"*,
**không** chứng minh *"route được gác bằng ĐÚNG cặp"*: nếu `GET /rooms/:id/bookings` lỡ khai
`('manage','room')`, `vo` vẫn 403 vì nó thiếu **cả hai** ⇒ lưới xanh trong khi cặp đã lệch. Và 8/13 route
chưa từng có ô deny của riêng nó.

Phép đo mới = **A/B cùng một request, chỉ đổi chủ thể**: `full` giữ đủ 5 cặp; `no-<P>` giữ 4 cặp, thiếu đúng
cặp `P`. Ma trận phủ **đủ 13 route** của 3 controller:

| Cặp | Route được gác | Deny (A) | Allow (B) |
| --- | --- | --- | --- |
| `('view','room')` | `GET /rooms` · `/rooms/availability` · `/rooms/usage-summary` · `/rooms/:id` · `/rooms/:id/bookings` · `/room-bookings` · `/room-bookings/:id` · `/me/room-bookings` | 8 ca 403 | 8 ca **200** |
| `('manage','room')` | `POST /rooms` · `PATCH /rooms/:id` · `DELETE /rooms/:id` | 3 | 3 |
| `('book','room')` | `POST /room-bookings` | 1 | 1 |
| `('cancel','room-booking')` | `POST /room-bookings/:id/cancel` | 1 | 1 |
| `('access','room')` | *(cổng NAV, không route)* | — | mục D: thiếu `access` + có `view` ⇒ `GET /rooms` **200** |

Kèm theo:

- **Chống "chủ thể hỏng toàn cục"**: mỗi chủ thể `no-<P>` phải dùng được route của cặp KHÁC (ca B cuối) —
  nếu không, 403 ở mục A có thể chỉ vì user seed sai.
- **Không tác dụng phụ**: route ghi bắn vào UUID không tồn tại / body rỗng ⇒ qua guard rồi dừng ở
  pipe/service (400/404). Guard chạy trước pipe nên vế 403 không phụ thuộc body — hai vế A/B dùng **chung** body.
- Mỗi route đọc dùng cửa sổ hợp lệ theo **luật giờ riêng của nhóm** (SPEC-14 §13.4: `availability` ≤ 8h ·
  lịch ≤ 31 ngày · usage-summary ≤ 366 ngày) để vế ALLOW là **đúng 200**, không phải "khác 403".

### 2b. ROOM gác cặp ở **HAI TẦNG** — và ở đây đối chiếu tập là KHÔNG đủ

Đo bằng **đột biến có kiểm soát** (RED-trước-GREEN, không tin lưới xanh). ROOM cùng họ với ASSET
(`asset-guards-pairs-in-two-layers`) nhưng tầng service **không** nhận cặp theo tham số: nó gói trong 4
resolver có tên (`resolveViewActor` · `resolveBookActor` · `resolveCancelActor` · `resolveManageActor`), mỗi
resolver `resolveAndAssert` đúng một cặp.

| Đột biến | Kết quả | Đọc ra điều gì |
| --- | --- | --- |
| Đổi **decorator** `GET /rooms/:id/bookings` → `@RequirePermission("manage","room")`, giữ nguyên service | **28/30 ca VẪN XANH** (toàn bộ A, B, D); chỉ 2 ca census ĐỎ | Đường HTTP vẫn 403 vì **tầng hai** chặn: `RoomsService.bookingsOfRoom` gọi `resolveViewActor` ⇒ assert `('view','room')`. A/B **mù** với lệch một-tầng. |
| Đổi **service** `bookingsOfRoom` → `resolveManageActor`, **giữ nguyên decorator** | **29/30 XANH**; chỉ ca census "ba chặng" ĐỎ | Kể cả census kiểu ASSET (so **tập** cặp giữa hai tầng) cũng XANH ở đây: 4 resolver phủ đúng 4 cặp nên tập luôn khớp. Chỉ phép so **từng route** mới thấy. |

⇒ Vì vậy mục C không so tập mà đi **ba chặng**: route (decorator + `this.<prop>.<method>`) → phương thức
service → `resolve*Actor` → cặp mà resolver đó assert; rồi so **từng route một**, kèm ca tự-kiểm
`checked === 13` để vòng lặp rỗng không đội lốt "xanh". Vì sao lệch một-tầng là lỗ THẬT chứ không phải
chuyện thẩm mỹ: tầng service là cổng **duy nhất** khi service được gọi ngoài HTTP (job/bridge — đúng lý do
`RoomBookingReminderJobHandler` tồn tại), còn decorator là cổng duy nhất khi ai đó thêm route mới trỏ vào
phương thức có sẵn.

---

## 3. Lỗ #2 — ROOM-ERR-003 chưa ai chứng minh nó là **một** phản hồi

SPEC-14 §12 hứa: *"phòng / lượt đặt **không thuộc company** hoặc không tồn tại (kể cả phòng đã xoá mềm) —
**cùng một phản hồi** (chống dò chéo tenant)"*. `room-be1-scope` mục D đo *"chéo tenant ⇒ 404"* — đúng nhưng
chưa đủ: nó không so 404 chéo-tenant với 404 id-bịa. Chỉ cần một nguồn kèm thêm `details` hoặc đổi câu chữ là
404 trở thành **oracle**: kẻ dò phân biệt được "id này có thật ở công ty khác" với "id bịa".

Ca mới so **nguyên hình dạng lỗi** (`status` + `code` + `message` + `details`) giữa ba nguồn:

| Route | Nguồn 404 | Kết quả |
| --- | --- | --- |
| `GET /rooms/:id` | id bịa · id của công ty KHÁC · phòng đã **xoá mềm** | 3 phản hồi **bằng nhau tuyệt đối** |
| `GET /room-bookings/:id` | id bịa · lượt của công ty KHÁC | 2 phản hồi **bằng nhau tuyệt đối** |

Kèm ca ALLOW đối chứng ở cả hai: chính chủ đọc id đó ⇒ **200** — chứng minh id dùng trong ca chéo-tenant là
id **THẬT**, không phải "một chuỗi bất kỳ" (nếu thiếu, ca chéo-tenant chỉ đang đo lại ca id-bịa).

---

## 4. Lỗ #3 — census theo **MÃ** là chưa đủ cho ROOM; phải census theo **`kind`**

ROOM gộp nhiều luật vào chung một mã: ROOM-ERR-002 có **6** `kind`, ROOM-ERR-006 có **4**, ROOM-ERR-004/005/010
mỗi mã **2**. Vì thế "mã ROOM-ERR-002 đã có ca" hoàn toàn có thể đúng trong khi 3/6 nhánh của nó chưa ai chạm —
đúng mức tiếp theo của bài học `coverage-high-but-error-code-untested` (coverage `src/rooms/**` đã **99.1 %**
statements mà vẫn sót 7 `kind`).

Census `room-error-code-census.unit-spec.ts` quét 10 mã + **21 `kind`** ném được (6 `WINDOW` + 4 `ATTENDEE` +
`overlap` + 10 literal `roomDetails("…")`), bỏ comment trước khi quét (`vitest-exclude-selfcheck-reads-comments`),
và **tách vai** nguồn-ném với bề-mặt-test để census không tự chứng minh chính nó. Nó bắt được **7 `kind` không ai neo**:

| `kind` | Tình trạng trước WO | Xử lý |
| --- | --- | --- |
| `organizer-not-found` · `organizer-inactive` | ROOM-ERR-010 mới có vế **403**; hai `kind` của vế **422** chưa có ca (chỉ tới được khi `book`@Company) | **3 ca mới** (id bịa · user công ty khác ⇒ **cùng mã**, không thành oracle · user `suspended`) + 1 ca ALLOW đặt hộ hợp lệ |
| `range-too-wide` (nửa `to ≤ from`) | BE-1 chỉ đo nửa "> 31 ngày" | **3 ca mới** (`to < from` · `to = from` · ALLOW cửa sổ hợp lệ) |
| `overlap` · `over-capacity` · `room-has-upcoming` | Nhánh CÓ chạy ở BE-1, nhưng ca đó assert `conflicts`/`capacity`/`upcomingCount` — **không ai neo nhãn `kind`** | **4 ca mới** neo nhãn (mục E + F). Đổi nhãn `over-capacity` → `overCapacity` sẽ làm FE rơi nhánh mặc định mà toàn bộ lưới BE vẫn xanh (SPEC-14 §14 buộc FE rẽ theo `kind`) |
| `too-many-attendees` | Không có ca — và **không thể có ca 422** | Xem §4b |

### 4b. Phát hiện của WO: `too-many-attendees` là mã **CHẾT trên đường HTTP** — SPEC-14 §12 đã đính chính

Trần 50 người bị gác ở **hai tầng đúng bằng nhau**:

- BIÊN — `attendeeUserIds: z.array(...).max(ROOM_MAX_ATTENDEES)` (`packages/contracts/src/room.ts`);
- tầng hai — `if (attendees.length > ROOM_MAX_ATTENDEES) throw attendeeError("too-many-attendees")`
  (`room-bookings.service.ts:187`).

Vì hai ngưỡng **bằng nhau** và controller là caller **duy nhất** của `RoomBookingsService.create` (đo bằng
grep: không job/bridge nào gọi), nhánh service **không thể chạm tới qua HTTP**. Đo thật: 51 người tham dự ⇒
**`400 VALIDATION-ERR-001`** (`field = "attendeeUserIds"`, `rule = "too_big"`), **không** phải 422 ROOM-ERR-006
như SPEC-14 §12 ghi.

**Xử lý — giữ nguyên cả hai tầng, sửa TÀI LIỆU:** trần ở biên là thứ chặn mảng khổng lồ trước khi bất kỳ việc
gì chạy (gỡ nó để "cho 422 ra" là mở cửa cho payload không giới hạn); nhánh service là tầng hai cho caller
không qua pipe. Đã đính chính [SPEC-14 §12](../../SPEC/SPEC-14%20ROOM.md) trong cùng PR, ca canh sự thật ở
`s11-room-qa1-error-residue` mục B (đo **400**, và assert tường minh `code !== "ROOM-ERR-006"`), và census xếp
kind này vào `BOUNDARY_ONLY` — nếu một ngày nhánh service ra được dây, cổng ĐỎ và buộc bổ sung ca runtime,
không trôi im lặng. Cùng khuôn với `BOUNDARY_ONLY` của `asset-error-code-census`.

Kèm ca **hai ngưỡng phải đúng bằng nhau**: Zod < service ⇒ nhánh service chết (hiện trạng, có chủ ý, đã ghi
chú); Zod > service ⇒ mảng lớn hơn trần lọt qua biên rồi mới 422 — tốn công vô ích ở tầng dưới.

---

## 5. Lỗ #4 — biên `@Idempotent()` của `POST /room-bookings`

BE-1 phủ replay + `KEY_REUSED`. Còn thiếu đúng những vế mà **SPEC-14 §14 buộc FE rẽ nhánh** (ba mã 409 khác
nhau, cùng HTTP status, ba hành vi UI khác nhau) và vế §21 nêu đích danh:

| Ca mới | Đo gì | Vì sao quan trọng |
| --- | --- | --- |
| `INVALID_KEY` | khoá dài hơn trần ⇒ 409 + **0 lượt sinh ra**; khoá dài **đúng trần** ⇒ 201 | chặn ở interceptor ⇒ handler chưa từng chạy; ca ALLOW ở đúng biên để ca deny không xanh-rỗng |
| `IN_PROGRESS` | bấm-đúp khi request #1 chưa xong ⇒ 409 `IN_PROGRESS`, **assert tường minh ≠ `ROOM-ERR-001`** | nếu trả `ROOM-ERR-001`, người dùng thấy "phòng đã bận" cho **chính lượt mình đang đặt** |
| khác **người gọi**, cùng khoá | cả hai 201, id khác nhau, không header phát lại | khoá interceptor băm `companyId + userId + method + path + key` |
| khác **công ty**, cùng khoá | như trên + lượt của B nằm ở **phòng của B** | BẤT BIẾN #1 đi qua đường **cache** |
| handler LỖI | retry cùng khoá chạy THẬT lại (không cache lỗi); payload khác ⇒ `KEY_REUSED` | khoá hỏng không được "đóng băng" |

**Ca `IN_PROGRESS` là TẤT ĐỊNH, không đua.** Bắn hai request song song rồi `if (loser) … else …` là ca *có thể
không bao giờ chạy nhánh mình định đo*. Cách ép: giữ **khoá hàng** trên `meeting_rooms` bằng một transaction
của pool owner — handler đặt phòng `SELECT … FOR UPDATE` đúng hàng đó (SPEC-14 §13.2 bước 2) ⇒ request #1 đứng
lại **ngay trong handler, sau khi interceptor đã ghi khoá** ⇒ request #2 chắc chắn gặp trạng thái in-flight.
Nghiệm kết quả bằng **DB** (`count(*) Confirmed`), không bằng phản hồi HTTP. File này dùng `app.listen(0)`
(memory `supertest-closes-shared-server-on-first-response`).

---

## 6. Hai luật §21 đã đủ từ trước — nêu để không đo lại

- **Race double-booking** (§20 mục 4, wave §7 bẫy 7): `room-be1-booking` có **3** ca (2 POST song song qua
  HTTP ⇒ `[201,409]` + `count(Confirmed)=1`; làm mù `findOverlapsTx` để ép đi nhánh EXCLUDE ⇒ 409 chứ không
  500/25P02; `23P01` thật ⇒ `isOverlapExclusion(err) === true`), và `s11-room-db1-invariants` C3 đo ở tầng DB
  bằng **2 connection COMMIT thật**. Không viết lại.
- **Job nhắc lịch dedupe**: `room-be1-noti` ca `ROOM_BOOKING_REMINDER` đã có vế "chạy lại không thêm thông báo"
  + "sau 20′ không nhắc" + "đã huỷ không nhắc". Không viết lại.

---

## 7. Số đo

| Hạng mục | Giá trị |
| --- | --- |
| Ca **mới** của WO | **86** — `permission-matrix` 30 · `error-residue` 19 · `idempotency-scope` 5 · `error-code-census` 32 |
| Cụm ROOM chạy trên lane (`pnpm --filter @mediaos/api test:cov:room`) | **161 ca / 9 file, xanh** |
| Toàn bộ cụm ROOM (thêm `room-error-code-census` + `s11-room-db1-invariants`) | **213 ca / 11 file, xanh** |
| Coverage `src/rooms/**` | **99.1 %** statements · **92.08 %** branches · **100 %** functions (ngưỡng WO: ≥ 80 %) |
| Lệnh tái lập | `bash scripts/lane-db-setup.sh roomqa --reset` → `export LANE_DB=mediaos_roomqa` → `pnpm --filter @mediaos/api test:cov:room` |
| Cổng cả repo | `bash harness/check.sh --lane-db=roomqa` |

Ghi chú đọc số: coverage **không** trả lời câu hỏi của §21. `src/rooms/**` đã 99.1 % statements ngay trước WO
này mà vẫn có 7 `kind` không ai neo và 8/13 route không có ô deny riêng — đó là lý do hai cổng tĩnh (census
`kind` + census route hai-tầng) mới là phần giữ lực ở đây, còn con số coverage chỉ là điều kiện cần.
