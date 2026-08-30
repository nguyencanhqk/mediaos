# S11-ROOM-BE-1 — Module NestJS `rooms/` (SPEC-14 · DB-16 · API-15) — micro-plan (Rev 2 sau plan-review)

> Zone 🔴 (data-scope Own/Company ép ở service trên cặp GHI · audit · FSM huỷ · 403-vs-404 theo tenant). FULL gate
> (security + database + silent-failure), NGƯỜI chốt merge, KHÔNG auto-merge. Nhánh `wo/s11-room-be-1` từ master
> `54887ce6` (ASSET-BE-1 đã merge). Lane `mediaos_roombe1` (chain 0000→0555, dựng 30/08/2026).
>
> Khuôn = `S11-ASSET-BE-1` (docs/plans/S11-ASSET-BE-1.md) NHƯNG ba điểm khác: (1) ngoài scope GHI ⇒ **403** (lịch công khai
> trong company), cross-tenant ⇒ 404; (2) đường ĐỌC **không** có Own/Department — `view@Company` cho mọi role, không masking
> theo scope; (3) chốt cuối là **EXCLUDE GIST** (23P01), không phải partial unique.

## 0. Hiện trạng ĐO THẬT (30/08/2026)

| Thứ | Giá trị đo | Nguồn |
| --- | --- | --- |
| Head migration | idx 222 · `0555_s11roomdb1_noti_room.sql` — **WO này KHÔNG migration** (rollback = revert PR) | `migrations/meta/_journal.json` |
| 3 bảng | `meeting_rooms` (tái dụng, soft-delete, GRANT `INSERT/SELECT/UPDATE` cấp BẢNG) · `room_bookings` (SỔ: `SELECT,INSERT` + UPDATE CẤP CỘT đúng-bằng `status · cancelled_at · cancelled_by · cancel_reason · updated_at · updated_by`; KHÔNG DELETE, KHÔNG `deleted_at`) · `room_booking_attendees` (`SELECT,INSERT` — KHÔNG UPDATE/DELETE) | `0552:150-274` |
| CHECK/unique/EXCLUDE tên chính xác | `chk_meeting_rooms_capacity (>0)` · `uq_meeting_rooms_company_name_active (company_id, lower(name)) WHERE deleted_at IS NULL` (23505) · `chk_room_bookings_status ('Confirmed','Cancelled')` · `chk_room_bookings_time_order (ends_at > starts_at)` · `chk_room_bookings_cancel_pair` (Cancelled ⇔ cancelled_at NOT NULL — huỷ = **MỘT** câu UPDATE đủ cột, tách câu ⇒ 23514) · **`room_bookings_no_overlap_excl`** gist `(company_id =, room_id =, tstzrange(starts_at,ends_at,'[)') &&) WHERE status='Confirmed'` ⇒ **23P01** · `uq_room_booking_attendees_booking_user (company_id, booking_id, user_id)` | `0552` · `schema/rooms.ts` |
| Index | `idx_room_bookings_company_start (company_id, starts_at)` · `idx_room_bookings_room_start (company_id, room_id, starts_at) WHERE status='Confirmed'` · `idx_room_bookings_organizer (company_id, organizer_user_id, starts_at DESC)` · `idx_room_booking_attendees_user (company_id, user_id, booking_id)` · `idx_meeting_rooms_company_active (company_id, is_active, sort_order) WHERE deleted_at IS NULL` | `0552` |
| FK `*_by` | `booked_by_user_id` composite **NO ACTION**, KHÔNG trong allowlist UPDATE (dấu vết đặt hộ) · `organizer_user_id` NO ACTION · `cancelled_by` composite · `meeting_rooms.created_by` còn FK MỘT cột di sản `meeting_rooms_created_by_fkey` (0052 — oracle tên constraint, nợ ngoài WO) | `0552` · backlog notes |
| 5 cặp + 22 grant | `('access','room')@Own` mọi role (**cổng nav FE, KHÔNG gác route BE nào**) · `('view','room')@Company` MỌI role · `('book','room')` Own (employee/manager/hr) / Company (company-admin/office-admin) · `('cancel','room-booking')` Own / Company · `('manage','room')@Company` chỉ company-admin/office-admin. Role `office-admin` id `…0013`, `is_system=true`, `requires_two_factor=false`, KHÔNG canonical. `is_sensitive=false` cả 5 | `0554:54-92` |
| `users` | `status` (`'active'` mặc định) và `deleted_at` là HAI cột riêng — kiểm organizer/attendee PHẢI có cả `deleted_at IS NULL` (review B2). `employee_profiles.user_id` nullable, unique PARTIAL `(company_id,user_id) WHERE deleted_at IS NULL`; user KHÔNG có hồ sơ vẫn đặt được (SPEC-14 §22e) | `schema/users.ts:26,33` · `schema/employees.ts:98-100` |
| Audit `object_type` | `meeting_room` + `room_booking` ĐÃ có trong `AUDIT_OBJECT_TYPES` — KHÔNG sửa `schema/audit.ts` | `schema/audit.ts:147,391` |
| NOTI catalog (global) | `ROOM_BOOKING_CONFIRMED` (Normal, `is_system_event=false`) · `ROOM_BOOKING_CANCELLED` (High, false) · `ROOM_BOOKING_REMINDER` (High, **true**) — cả 3 `dedupe_strategy='DedupeKey'`; `notification_type='Room'`, `module_code='ROOM'`. Template vi-VN **biến bắt buộc**: CONFIRMED `{organizer_name, room_name, title, time_range, booking_id}` · CANCELLED `{actor_name, room_name, title, time_range, booking_id}` · REMINDER `{title, room_name, starts_at_local, booking_id}`; `target_url` `/me/room-bookings?focus={booking_id}` | `0555:164-202` · `notification-event-catalog.const.ts:152-154` |
| Engine loại actor | `NotificationRecipientResolverService` loại `payload.actorUserId` khi `is_system_event=false`; 0 recipient ⇒ `recordSkip("no_recipient")`, KHÔNG ném | `notification-engine.service.ts:83-86` |
| `registerSource()` | `dedupeKeyOf` OPTIONAL, fallback `ctx.eventId` ⇒ **quên = dedupe câm lặng**. `payloadOf` whitelist khoá. Fail-loud lúc boot nếu `eventCode` chưa enabled | `outbox-notification-bridge.service.ts:15-38,129` |
| `intake()` | `{eventCode, sourceModule, sourceEntityType, sourceEntityId, dedupeKey (thô — engine ghép `eventCode:`), recipient:{mode:'UserIds', userIds, employeeIds:[]}, payload}` | `asset-maintenance-due.job-handler.ts:120-135` |
| `@SystemJobHandler()` | class decorator + khai `providers` của module ⇒ tự đăng ký. `JobRunContext = {companyId}` — **scheduler lặp company** (= "throttle theo companyId" của SPEC-14 §13.5), handler TỰ `withTenant`. Nhịp 60s. Dep của handler ROOM đều là provider thật ⇒ KHÔNG cần `@Optional()` (đính chính SPEC-14 §13.5) | `scheduler/job-handler.ts:23-36` |
| `@Idempotent()` | method-level; interceptor toàn cục; TTL 900s; header KHÔNG bắt buộc; mã lỗi `IDEMPOTENCY_ERROR_CODES.{INVALID_KEY, IN_PROGRESS, KEY_REUSED}`; nhả khoá khi handler ném | `idempotency.interceptor.ts:30-105` |
| `AllExceptionsFilter` | `error.code` từ payload OBJECT; `details` CHỈ đi ra khi là mảng `ErrorDetail {field,message,rule}` (phần tử thiếu chuỗi bị loại) | `all-exceptions.filter.ts:107-124` |
| Envelope | `paginated()` hoist `pagination`; **KHÔNG có `meta` tuỳ biến** ⇒ `meta.window` của API-15 §7.2/§7.3 (HAI khối JSON) **bỏ**, đính chính doc | `response-envelope.interceptor.ts` |
| Contracts | `room.ts` ĐÃ có 3 enum + `roomEquipmentSchema`; WO THÊM DTO cùng file | `contracts/src/room.ts` |
| Route census | **494 / 455 gated / 12 public / 27 ungated / 39 needVerdict** ⇒ kỳ vọng **507**, gated 468, ungated/needVerdict KHÔNG đổi | `docs/_review/S6-SEC-ROUTEMAP-1-route-census.json` |
| Ratchet | param-uuid `UNPIPED_CEILING = 1` KHÔNG tăng (**cả 6** `:id` pipe) · body-validation: `@UsePipes(ZodValidationPipe)` CẤP METHOD + DTO `createZodDto` · identity-projection: `identity-gated` trần 14 **cũng bão hoà (đo 30/08: 14/14)** — plan-review đọc nhầm "còn chỗ"; ROOM vẫn dùng **`identity-gated`** (cặp GATE `book`/`cancel` ≠ cặp BOUND `view` ở 010/012 — khuôn N-1c) và **nâng trần 14→15 có chủ đích** (ghi lý do tại dòng, qua FULL gate); KHÔNG pin `ROW_SCOPE_MINT_PINS` (scanner chỉ đếm literal `"scoped-predicate"`) | `identity-projection-verdicts.ts:613-628` · `identity-projection-census.ts:290-330` |
| `API_MODULE_TAGS` | Chưa có `ROOM`; segment `me` thuộc ME | `openapi-modules.ts:98-104` |
| TZ | `companies.timezone` NOT NULL default `Asia/Ho_Chi_Minh`; `tz.util.ts`: `wallTimeToInstant`, `addDaysToLocalDate`, `TZDate` | `tz.util.ts:86,101` |
| Test helper | `seedCompany · seedUser(direct, companyId, email, passwordHash)` (KHÔNG nhận `status` ⇒ inactive/xoá mềm bằng `direct` UPDATE trong spec) · `seedRole · seedPermissionCatalog · seedRolePermission · seedUserRole`; `cleanupTenants` ĐÃ dọn 2 bảng ROOM TRƯỚC `DELETE FROM users`; `appPool()/withClient` cho ca 42501/23514 | `seed.ts` · `integration-db.ts:36,59` |
| `paths` WO | Thiếu `apps/api/src/notifications/**`, `apps/api/test/integration/**`, `docs/**` ⇒ sửa backlog commit đầu | `harness/backlog.mjs` |

---

## 1. Scope fence — KHÔNG làm ở WO này

- Không `PATCH /room-bookings/{id}`, không duyệt đặt phòng, không recurring/ICS, không check-in, không WS.
- Không sửa interceptor envelope (⇒ bỏ `meta.window`), không sửa `scheduler/**`, không migration, không sửa `schema/rooms.ts`.
- Không bật `modules.ROOM` (FE-1). Không thêm mã dotted `ROOM.*` vào web-core (nợ FE-1). Không DROP `meeting_rooms_created_by_fkey`.

### 1.1 Điểm chốt orchestrator (30/08, Rev 2)

1. **`meta.window` bỏ** — đính chính API-15 §7.2 + §7.3 (cả hai khối JSON) cùng PR.
2. **`details` = mảng `ErrorDetail`**: `kind` ⇒ `{field:"kind", message:<kind>, rule:"room"}`; ROOM-ERR-001 ⇒ `{field:"conflicts", message:<JSON của roomBookingConflictSchema[] ≤ 20 phần tử>}` + `{field:"nextFreeFrom", message:<ISO|"null">}`; 007 ⇒ `capacity`/`headcount`; 008 ⇒ `upcomingCount`. Contracts khai `roomConflictsDetailSchema` + helper `parseRoomConflictsDetail(details)` để FE không parse mù (review H2). Ví dụ nguyên văn vào API-15 §7.4 + SPEC-14 §12.
3. **Sentinel 404 trên dây = `ROOM-ERR-NOT-FOUND`**; KHÔNG `ROOM-ERR-FORBIDDEN`; ngoài scope ghi ⇒ 403 `AUTH-ERR-SCOPE-DENIED` (mã đặt trong payload object).
4. **Race đặt phòng**: `SELECT meeting_rooms … FOR UPDATE` tuần tự hoá ⇒ request thứ hai thấy conflict ở kiểm-trước. **Luật cứng cho đường 23P01 (review B4): CẤM try/catch quanh `insertTx` BÊN TRONG `withTenant`** — `isOverlapExclusion(err)` chỉ chạy ở `catch` của lời gọi `db.withTenant(...)` bên ngoài; rồi mở `withTenant` THỨ HAI chỉ SELECT (`findOverlapsTx` + `findDayBookingsTx` + tên người) và ném 409. Không bao giờ 500/25P02.
5. **Một điểm chiếu danh tính DUY NHẤT** `RoomPeopleRepository.namesByUserIdsTx(tx, actor, userIds)` — **căn cứ = scope của cặp ĐỌC `('view','room')`** (review B1), KHÔNG phải cặp ghi: `resolveOrNull('view','room')` cho MỌI route (kể cả 010/012), Company/System ⇒ `true`; hẹp hơn/`null` ⇒ `users.id = actor` (fail-closed; không role seed nào rơi vào). Basis **`identity-gated`** (`fromScope(cond,"identity-gated",…, users.id)`), 1 verdict, không nâng trần, không pin. `book`/`cancel`/`manage` chỉ quyết định GHI.
6. `canCancel` = có grant `cancel` (`resolveOrNull`) ∧ (scope Company ∨ `organizer = me`) ∧ `Confirmed` ∧ `endsAt > now`. Resolve **một lần/request**.
7. **Kiểm user (organizer/attendee)** = `WHERE company_id = $c AND deleted_at IS NULL AND id = ANY($ids)` (review B2); `status ≠ 'active'` ⇒ `-inactive`. `namesByUserIdsTx` cùng vị từ `deleted_at IS NULL`. `employeeCode` = **subquery tương quan** trên `employee_profiles` (KHÔNG LEFT JOIN có vị từ ở WHERE — review B5) ⇒ user không có hồ sơ vẫn có `displayName`.
8. **Huỷ**: pre-read CHỈ để quyết 403 scope; sau `cancelTx` 0 hàng ⇒ `findStatusTx` LẠI trong cùng tx rồi chọn kind (`Cancelled` ⇒ `already-cancelled` · `ends_at ≤ now` ⇒ `already-ended` · không có ⇒ 404) (review H1).
9. `usage-summary` theo API-15 (lượt có `starts_at ∈ [from,to)`, không chỉ "đã qua") ⇒ đính chính SPEC-14 §10 FUNC-009 (review H7).
10. Job 0 recipient ⇒ warn + đếm, run **ok**; `failed` chỉ khi `intake()` ném (review H4).

---

## 2. Bảng endpoint (13 mã = 13 route) — **MỌI `:id` = `@Param("id", ParseUUIDPipe)`** (6 route: 005/006/007/008/011/012)

| Mã | Route | Controller | Cặp gate | DTO/Pipe | Audit | NOTI |
| --- | --- | --- | --- | --- | --- | --- |
| 001 | `GET /rooms` | `RoomsController` | `view:room` | `ListRoomsQueryDto` → `paginated()` | — | — |
| 002 | `POST /rooms` (201) | ↑ | `manage:room` | `CreateRoomDto` | `meeting_room/create` | — |
| 003 | `GET /rooms/availability` | ↑ (**TRƯỚC `:id`**) | `view:room` | `RoomAvailabilityQueryDto` — chỉ `end-before-start`/`too-long` | — | — |
| 004 | `GET /rooms/usage-summary` | ↑ (**TRƯỚC `:id`**) | `view:room` | `RoomUsageSummaryQueryDto` (≤ 366 ngày) | — | — |
| 005 | `GET /rooms/:id` | ↑ | `view:room` | UUID | — | — |
| 006 | `PATCH /rooms/:id` | ↑ | `manage:room` | UUID + `UpdateRoomDto` `.strict()` | `meeting_room/update` \| `/deactivate` | — |
| 007 | `DELETE /rooms/:id` (204) | ↑ | `manage:room` | UUID | `meeting_room/delete` | — |
| 008 | `GET /rooms/:id/bookings` | ↑ | `view:room` | UUID + `RoomBookingsWindowQueryDto` | — | — |
| 009 | `GET /room-bookings` | `RoomBookingsController` | `view:room` | `ListRoomBookingsQueryDto` | — | — |
| 010 | `POST /room-bookings` (201) | ↑ | `book:room` | `@Idempotent()` + `CreateRoomBookingDto` | `room_booking/book` (after: organizerUserId + bookedByUserId + roomId + khung giờ + status) | `room.booking.confirmed` |
| 011 | `GET /room-bookings/:id` | ↑ | `view:room` | UUID | — | — |
| 012 | `POST /room-bookings/:id/cancel` | ↑ | `cancel:room-booking` | UUID + `CancelRoomBookingDto` | `room_booking/cancel` | `room.booking.cancelled` |
| 013 | `GET /me/room-bookings` | `MeRoomBookingsController` | `view:room` | `MyRoomBookingsQueryDto` (`date` XOR `from/to`; KHÔNG `userId`) | — | — |

Mọi route `@UseGuards(PermissionGuard)` + `@RequirePermission`; có body/query ⇒ `@UsePipes(ZodValidationPipe)` cấp METHOD; DTO `createZodDto`.

---

## 3. Contracts — `packages/contracts/src/room.ts` (đã viết 30/08, mở rộng cùng file)

Hằng `ROOM_BOOKING_{MIN_MINUTES=15, MAX_HOURS=8, PAST_TOLERANCE_MINUTES=5, MAX_AHEAD_DAYS=90}` · `ROOM_WINDOW_MAX_DAYS=31` · `ROOM_USAGE_WINDOW_MAX_DAYS=366` · `ROOM_MAX_ATTENDEES=50` · `ROOM_PAGE_MAX/DEFAULT` · trần chuỗi · **`ROOM_CONFLICTS_MAX=20`**. Schema: `listRoomsQuerySchema` · `createRoomSchema` · `updateRoomSchema` (`.strict()`) · `roomAvailabilityQuerySchema` (equipment list ≤ 20) · `roomUsageSummaryQuerySchema` · `roomBookingsWindowQuerySchema` · `listRoomBookingsQuerySchema` (roomId list ≤ 50) · `createRoomBookingSchema` · `cancelRoomBookingSchema` · `myRoomBookingsQuerySchema` (superRefine XOR) · response `roomResponseSchema` · `roomAvailabilityItemSchema` · `roomUsageSummaryItemSchema` · `roomPersonSchema` · `roomBookingResponseSchema` · `myRoomBookingResponseSchema` · `roomBookingConflictSchema` · **`roomConflictsDetailSchema` + `parseRoomConflictsDetail(details: ErrorDetail[])`**. `q` escape `%`/`_` ở repository trước ILIKE.

---

## 4. Cấu trúc file — `apps/api/src/rooms/` (14 file + 3 ở `notifications/`)

| File | Vai trò |
| --- | --- |
| `rooms.module.ts` | `imports: [PermissionModule]`; 3 controller; providers. KHÔNG import `NotificationsModule` |
| `rooms.types.ts` | `RoomRequestUser` · `RoomActor { actorUserId, companyId, viewScope: DataScope\|null, peopleVisibleCond, writeScope: DataScope\|null, isCompanyWrite, cancelScope: DataScope\|null }` · `PageInput` · `RoomPersonRef`/`RoomPeopleMap` |
| `rooms.errors.ts` (+spec) ✅ | `ROOM_ERR_CODE` 001–010 + `NOT_FOUND`; `roomDetails`; throwers (`windowError` · `attendeeError` · `bookOnBehalfDenied` · `cancelScopeDenied` · `overlapError` · `notFoundRoom/Booking`); `pgErrorOf` 5 tầng; **`isOverlapExclusion`** (23P01 + đúng constraint); `mapRoomPgError` (23505 theo TÊN: `uq_meeting_rooms_company_name_active` ⇒ 009 · `uq_room_booking_attendees_booking_user` ⇒ 006 duplicate; khác ⇒ null) |
| `room-time.ts` (+spec) ✅ | `bookingWindowViolation` (thứ tự 5 kind) · `lookupWindowViolation` (`range-too-wide`) · `availabilityWindowViolation` · `computeNextFreeFrom` · `formatTimeRange` · `formatLocalDateTime` · `companyDayBounds` (`wallTimeToInstant` + `addDaysToLocalDate`) · `isBookingCompleted` |
| `rooms.dto.ts` ✅ | `createZodDto` ×10 |
| `room-access.service.ts` | `resolveViewActor` (view assert + cancel OrNull) · `resolveBookActor` (book assert + view OrNull) · `resolveCancelActor` (cancel assert + view OrNull) · `resolveManageActor` (manage assert + view OrNull). `peopleVisibleCond(viewScope)`: Company/System ⇒ true; khác/null ⇒ `users.id = actor`. Gọi MỘT lần/request, NGOÀI `withTenant` |
| `room-people.repository.ts` | **`namesByUserIdsTx`** (điểm chiếu duy nhất — `identityColumns(fromScope(cond,"identity-gated",…,users.id), {displayName: users.fullName})`, `WHERE company_id AND deleted_at IS NULL AND id IN`, `employeeCode` subquery tương quan) · `userStatusesTx` (`company_id AND deleted_at IS NULL AND id IN`) · `companyTimezoneTx` |
| `rooms.repository.ts` ✅ | `listTx` · `findAliveByIdTx` · `findAnyByIdTx` (lịch sử) · `lockAliveByIdTx` (`FOR UPDATE`) · `insertTx` · `updateTx` · `softDeleteTx` · `countUpcomingTx` · `availabilityTx` (NOT EXISTS overlap, `@>` equipment) · `usageSummaryTx` (LEFT JOIN + HAVING; `::float8`) |
| `room-bookings.repository.ts` ✅ | `insertTx` · `insertAttendeesTx` · `findOverlapsTx` · `findDayBookingsTx` (**OVERLAP** `[s, s+1d)` — review H5) · `findDetailTx` (JOIN không lọc deleted) · `findStatusTx` · `attendeesByBookingIdsTx` (`= ANY`) · `listWindowTx` · `listMineTx` (EXISTS, `myRole`) · **`cancelTx`** (MỘT UPDATE 6 cột) · `findRemindersTx` (`(now, now+15′]`, LIMIT 500) |
| `rooms.service.ts` | 001–008 (§5.3/§5.4) |
| `room-bookings.service.ts` | 009–013 + `create`/`cancel` (§5.1/§5.2) |
| `rooms.mapper.ts` (+spec) | `toRoomDto` · `toBookingDto(row, attendeeIds, people, {now, cancelScope, actorUserId})` (`isCompleted`, `canCancel`) · `toConflictDto` · `toMyBookingDto` · `Number()` cho `hoursBooked` |
| 3 controller | mỏng (§2) |
| `room-noti.payload.ts` | `ROOM_EVENT_CONFIRMED='room.booking.confirmed'` · `ROOM_EVENT_CANCELLED='room.booking.cancelled'`; payload `{ bookingId, actorUserId, organizer_name\|actor_name, room_name, title, time_range, booking_id }` |
| `notifications/room-audience.reader.ts` | `participantsOfBooking(tx, companyId, bookingId)` = organizer ∪ attendees (raw SQL, `company_id` mọi câu) |
| `notifications/room-noti-bridge.registrar.ts` | 2 mapping; `sourceEntityType='room_booking'`; `sourceEntityIdOf`/`dedupeKeyOf` = `requireField('bookingId')` (NÉM); `payloadOf` whitelist + `requireField` biến template; recipients = participants (engine loại `actorUserId`) |
| `notifications/room-booking-reminder.job-handler.ts` | `@SystemJobHandler()` `jobCode='ROOM_BOOKING_REMINDER'`; `withTenant(companyId)` → `findRemindersTx` + participants (MỘT câu) + tz; materialize rồi `intake()` NGOÀI tx; `dedupeKey = ${bookingId}:${startsAt ISO}`; payload `{title, room_name, starts_at_local, booking_id}`; 0 recipient ⇒ warn, ok; intake ném ⇒ log + failed. Dep = provider thật ⇒ không `@Optional()` |

`app.module.ts`: `RoomsModule` sau `AssetsModule`. `notifications.module.ts`: +3 provider. `openapi-modules.ts`: `{code:'ROOM', tagPrefix:'Room', segments:['rooms','room-bookings']}`.

---

## 5. Lõi nghiệp vụ

### 5.1 `create` (010) — thứ tự kiểm SPEC-14 §13.2

```
actor = access.resolveBookActor(user)                         // 403 nếu thiếu book; viewScope OrNull cho tên
kind = bookingWindowViolation(s, e, now) ⇒ 422 002              // thuần, TRƯỚC tx
organizerId = dto.organizerUserId ?? user.id
organizerId ≠ user.id ∧ !isCompanyWrite ⇒ 403 010 book-on-behalf-denied
attendees = dto.attendeeUserIds ?? []; trùng nhau / chứa organizer ⇒ 422 006 attendee-duplicate; > 50 ⇒ too-many
try {
  dto = await db.withTenant(c, async tx => {
    room = rooms.lockAliveByIdTx(tx, c, roomId)                // FOR UPDATE; undefined ⇒ 404
    !room.isActive ⇒ 409 004 room-inactive; room.requiresApproval ⇒ 409 004 approval-not-supported
    statuses = people.userStatusesTx(tx, c, [organizerId, ...attendees])   // company_id + deleted_at IS NULL
    organizer thiếu ⇒ 422 010 organizer-not-found; ≠ active ⇒ organizer-inactive
    attendee thiếu ⇒ 422 006 attendee-not-found; ≠ active ⇒ attendee-inactive
    1 + attendees.length > room.capacity ⇒ 422 007 {capacity, headcount}
    overlaps = bookings.findOverlapsTx(tx, c, roomId, s, e)
    overlaps.length ⇒ throw overlapError(room.name, conflicts(tx, overlaps, s, e), nextFree)   // tx còn sống — SELECT được
    row = bookings.insertTx(...)   // KHÔNG try/catch ở đây (luật §1.1.4)
    bookings.insertAttendeesTx(...)
    audit.record(tx, {action:'book', objectType:'room_booking', objectId, actorUserId, after:{organizerUserId, bookedByUserId, roomId, startsAt, endsAt, status}})
    tz = people.companyTimezoneTx(tx, c); names = people.namesByUserIdsTx(tx, actor, [...])
    outbox.enqueue(tx, {eventType:'room.booking.confirmed', payload:{bookingId, actorUserId, organizer_name, room_name, title, time_range: formatTimeRange(s,e,tz), booking_id}})
    return toBookingDto(...)
  })
} catch (err) {
  if (!isOverlapExclusion(err)) throw mapRoomPgError(err) ?? err
  // đường EXCLUDE (23P01) — tx đã abort ⇒ withTenant THỨ HAI chỉ SELECT
  throw await db.withTenant(c, tx => buildOverlapError(tx, actor, roomId, s, e))
}
```

### 5.2 `cancel` (012)

```
actor = access.resolveCancelActor(user)                        // 403 nếu thiếu cặp
withTenant(c, tx):
  cur = bookings.findStatusTx(tx, c, id); !cur ⇒ 404
  !isCompanyWrite ∧ cur.organizerUserId ≠ user.id ⇒ 403 AUTH-ERR-SCOPE-DENIED     // quyền TRƯỚC trạng thái
  updated = bookings.cancelTx(tx, c, id, user.id, reason)      // MỘT câu UPDATE atomic
  if (!updated) { again = findStatusTx(...); !again ⇒ 404; again.status='Cancelled' ⇒ 409 005 already-cancelled; else ⇒ 409 005 already-ended }
  audit.record(tx, {action:'cancel', objectType:'room_booking', before:{status:'Confirmed', startsAt, endsAt}, after:{status:'Cancelled', cancelledAt, cancelReason}})
  tz; names; outbox.enqueue(room.booking.cancelled, {bookingId, actorUserId, actor_name, room_name, title, time_range, booking_id})
  return toBookingDto(...)
```

### 5.3 Đọc — 009/008: `lookupWindowViolation(from,to,31)` ⇒ 422 `range-too-wide`; 003: `availabilityWindowViolation`; 004: `lookupWindowViolation(…,366)`; 013: `date` ⇒ `companyDayBounds(date, tz)`, `from/to` ⇒ ≤ 31 ngày; 005 xoá mềm ⇒ 404; 008 phòng KHÔNG tồn tại trong company ⇒ 404 (đã xoá mềm vẫn trả).

### 5.4 Dẫn xuất — `isCompleted`, `canCancel` tính ở mapper với `now` truyền vào.

---

## 6. Audit + NOTI

| Hành động | `object_type/action` | outbox → eventCode | recipients | dedupe_key thật |
| --- | --- | --- | --- | --- |
| tạo/sửa/vô hiệu/xoá phòng | `meeting_room/create·update·deactivate·delete` | — | — | — |
| đặt | `room_booking/book` | `room.booking.confirmed` → `ROOM_BOOKING_CONFIRMED` | organizer ∪ attendees − actor (0 người hợp lệ khi tự đặt không attendee ⇒ engine skip, KHÔNG dead-letter) | `ROOM_BOOKING_CONFIRMED:{bookingId}` |
| huỷ | `room_booking/cancel` | `room.booking.cancelled` → `ROOM_BOOKING_CANCELLED` | organizer ∪ attendees − actor | `ROOM_BOOKING_CANCELLED:{bookingId}` |
| nhắc | — | job `intake` | organizer ∪ attendees (system event) | `ROOM_BOOKING_REMINDER:{bookingId}:{startsAt ISO}` |

Đính chính SPEC-14 §17 (`room:confirmed:{id}` → có prefix eventCode).

---

## 7. Test RED-trước

### 7.1 Int-spec (LANE_DB, gate `hasDb && LANE_DB`, `await app.listen(0)` sau `init()`; mỗi DENY có ALLOW; chủ thể = role dựng trong test)

| File | Ca |
| --- | --- |
| `room-be1-scope.int-spec.ts` | (a) thiếu từng cặp trong **4 cặp gác BE** (`view` · `manage` · `book` · `cancel`; `access` là cổng nav FE — không có route để deny) → 403 `AUTH-ERR-FORBIDDEN` trên route đại diện, ALLOW khi có; (b) `book@Own` + `organizerUserId ≠ me` → 403 `ROOM-ERR-010` `book-on-behalf-denied`; = me → 201; `book@Company` đặt hộ → 201, `bookedBy.userId ≠ organizer.userId`, audit `after` có cả hai; (c) `cancel@Own` lượt người khác → 403 `AUTH-ERR-SCOPE-DENIED`; lượt mình → 200; `cancel@Company` lượt người khác → 200; (d) cross-tenant: B gọi 005/006/007/008/011/012 với id của A → 404 `ROOM-ERR-NOT-FOUND`; 010 `roomId` của A → 404; `attendeeUserIds` chứa user của A → 422 006 `attendee-not-found`; (e) `/me/room-bookings?userId=<khác>` bị strip; (f) `canCancel` theo scope; (g) **`:id` không phải UUID → 400** trên 005 và 012; (h) tên người: user KHÔNG có `employee_profiles` vẫn có `displayName`, `employeeCode=null`; attendee đã xoá mềm → 422 `attendee-not-found`; (i) DTO không có `email` |
| `room-be1-booking.int-spec.ts` | 002 5 kind theo thứ tự (kind 6 `range-too-wide` phủ ở hàng cửa sổ) · 004 hai kind · 006 bốn kind (inactive = `direct` UPDATE `users.status`) · 007 · 001 kèm `conflicts[]` + `nextFreeFrom` (có gap/null; **`organizerName` có tên cho employee `book@Own`** — review B1) · biên nửa mở · **race 2 POST** → [201, 409] + `count(Confirmed)=1` · **23P01 thật**: `db.withTenant` gọi `RoomBookingsRepository.insertTx` với lượt giao ⇒ reject với `isOverlapExclusion(err) === true`, KHÔNG 25P02 · 005 `already-cancelled`/`already-ended`, huỷ lượt đang diễn ra OK, **race 2 huỷ** → [200, 409 `already-cancelled`] · 008 · 009 case-insensitive + dùng lại tên · 003 lọc · 004 số đếm (`hoursBooked` là number) · > 31 ngày → 422 · 013 `date` theo TZ (lượt `00:30+07:00` ngày D ⇒ `date=D` có, `date=D−1` không) · `role`/`includeCancelled` · thiếu/thừa `date`+`from/to` → 400 · audit_logs · idempotency (cùng key ⇒ cùng id + `Idempotency-Replayed`; cùng key khác payload ⇒ 409 `KEY_REUSED`; huỷ rồi đặt lại key MỚI ⇒ lượt mới) · **bất biến #2 qua `appPool`**: `UPDATE room_bookings SET title` ⇒ 42501 · `DELETE` ⇒ 42501 · `UPDATE … SET status='Cancelled'` (thiếu cancelled_at) ⇒ 23514 `chk_room_bookings_cancel_pair` |
| `room-be1-noti.int-spec.ts` | đặt (tự tổ chức, 2 attendee) → `ROOM_BOOKING_CONFIRMED` đúng 2 hàng, dedupe_key `ROOM_BOOKING_CONFIRMED:<id>`; tự đặt 0 attendee ⇒ outbox done + 0 noti (không dead-letter); đặt hộ → organizer nhận; drain 2 lần → không nhân đôi · huỷ → `CANCELLED` trừ actor · job: lượt sau 10′ → 1/recipient (kể cả organizer); chạy lần 2 → 0 mới; sau 20′ → 0; đã huỷ → 0; `starts_at_local` theo TZ; `title/body` không chứa `{` |

### 7.2 Unit — `rooms.errors.spec` ✅ (12) · `room-time.spec` ✅ (17) · `rooms.mapper.spec`.

### 7.3 Census/ratchet — route-census 507 · `identity-projection-verdicts.ts` +1 dòng `identity-gated` (`rooms/room-people.repository.ts#namesByUserIdsTx:users.fullName`) · `openapi-modules.ts` · param-uuid = 1 · body-validation.

---

## 8. Thứ tự thi công + verify

1. `LANE_DB=mediaos_roombe1`; backlog `paths` += `notifications/**`, `test/integration/**`, `docs/**`.
2. RED: 3 int-spec + `rooms.mapper.spec`.
3. contracts (+`roomConflictsDetailSchema`) → types → people → access → mapper → services → controllers → module → `app.module.ts` → `openapi-modules.ts` → payload → `notifications/room-*` + `notifications.module.ts` → verdict.
4. `bash run-lane.sh roombe1 test/integration/room-be1-*.int-spec.ts src/rooms` tới xanh.
5. `ROUTE_CENSUS_WRITE=1 … route-guard-coverage` ⇒ 507; `param-uuid` · `body-validation` · `identity-projection` · `openapi-contract` · `route-http-coverage` · `noti-seed-catalog-permissions`.
6. `check.sh --quick` → `check.sh --all --lane-db=roombe1`.
7. FULL gate 3 reviewer (Opus, song song). Vá CRITICAL/HIGH.
8. Docs: API-15 §5.2 ✅ 13 mã; §7.2/§7.3 (2 khối) bỏ `meta.window`; §7.4 ví dụ `details` mảng; SPEC-14 §10 FUNC-009 (cửa sổ `starts_at`); §12 `details` hình mảng; §13.5 (không `@Optional()`, throttle = scheduler lặp company); §17 dedupe_key thật. Rollback: revert PR (không migration).

---

## 9. Rủi ro & cách chặn

| Bẫy | Chặn |
| --- | --- |
| 23P01 trong `cause` | `pgErrorOf` 5 tầng; unit-spec |
| Truy vấn lại trong tx đã abort (25P02) | CẤM try/catch quanh `insertTx` trong tx; bắt NGOÀI + `withTenant` thứ hai; int-case assert không 500 |
| Huỷ tách 2 câu ⇒ 23514 | `cancelTx` MỘT câu 6 cột; int-case 23514 khi cố tình tách |
| Kind 005 từ ảnh chụp cũ | đọc lại sau UPDATE 0 hàng; race 2 huỷ |
| Tên người null cho employee (B1) | căn cứ = `view` scope, không phải cặp ghi; int-case `organizerName` cho employee |
| User xoá mềm lọt vào lượt (B2) | `deleted_at IS NULL` ở `userStatusesTx`; int-case |
| LEFT JOIN thành INNER (B5) | subquery tương quan cho `employeeCode`; int-case user không hồ sơ |
| `dedupeKeyOf` quên | drain/job 2 lần ⇒ 0 mới |
| `supertest` race | `app.listen(0)` |
| `identityColumns` đối chiếu bảng | grant dựng trên `users.id`, bọc `users.fullName` |
| `sql` template cột có tên bảng | subquery tương quan viết định danh chữ |
| TZ `date` | `wallTimeToInstant` |
| Route `availability`/`usage-summary` trước `:id` | khai trước + int-case |
| `/me` nhận `userId` | DTO strip; int-case |
| Job đỏ vĩnh viễn (H4) | 0 recipient ⇒ ok + warn |

---

## 10. Definition of Done (khớp `done_when`)

- [ ] 13 route; `withTenant` + guard + DTO + pipe method; 6 `:id` UUID.
- [ ] `@Idempotent()`; retry không nhân đôi; bấm-đúp 409 `IN_PROGRESS`/`KEY_REUSED`.
- [ ] Trùng lịch 409 001 (kiểm-trước + EXCLUDE), race 1 Confirmed, không 500.
- [ ] Huỷ own/all (403 SCOPE-DENIED); cross-tenant 404; FSM 005 đúng kind kể cả race.
- [ ] Job quét `withTenant` từng company, dedupe; NOTI trừ actor; audit mọi mutation (đặt hộ ghi cả hai).
- [ ] `API_MODULE_TAGS` ROOM; census 507; ratchet không tăng (identity: +1 `identity-gated`, không nâng trần).
- [ ] Deny-path RED-trước xanh trên LANE_DB; bất biến #2 42501/23514; `check.sh --all --lane-db=roombe1` xanh.
- [ ] FULL gate PASS; docs đính chính; backlog `paths`; PR base master → người chốt.

---

## 11. Nhật ký plan-review (vòng 1 → Rev 2, 30/08/2026 — ĐÚNG MỘT vòng)

**BLOCK 5 — đã vá vào plan:** B1 điểm chiếu danh tính buộc vào cặp ghi ⇒ `organizerName`/`displayName` null cho employee → căn cứ = `view` scope, basis `identity-gated`, bỏ nâng trần/pin (§1.1.5, §4, §7.3) · B2 `activeUserStatusTx` thiếu `company_id` + `deleted_at` (§1.1.7) · B3 `ParseUUIDPipe` thiếu ở 006/008/012 (§2) · B4 pseudo-code bắt 23P01 trong tx ⇒ 25P02 (§1.1.4, §5.1) · B5 LEFT JOIN `employee_profiles` thành INNER (§1.1.7).
**Cảnh báo 8 — H1 đọc lại sau UPDATE 0 hàng (§1.1.8) · H2 schema + trần `conflicts` + ví dụ doc (§1.1.2) · H3 lấy tz trong tx (§5.1/§5.2) · H4 job 0 recipient = ok (§1.1.10) · H5 `findDayBookingsTx` overlap (đã đúng trong code) · H6 `access:room` không gác route (§7.1a) · H7 SPEC-14 §10 lệch API-15 (§1.1.9, §8) · H8 test bất biến #2 (§7.1).**
**M/L:** M1 inactive bằng `direct` UPDATE · M2 không `@Optional()` + đính chính §13.5 · M3 throttle = scheduler lặp company · M4 0 recipient CONFIRMED assert · M5 `::float8` · L1 `addDaysToLocalDate` (đã dùng) · L2 equipment ≤ 20 + escape ILIKE (đã có) · L3 kind 6 ghi rõ · L4 rollback · L5 hai khối JSON.
