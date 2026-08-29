# API-15: ROOM API DESIGN (Quản lý phòng họp — Phòng · Đặt lịch · Chống trùng · Huỷ · Lịch sử)

**MODULE ROOM - QUẢN LÝ PHÒNG HỌP - API DESIGN**

> **📚 Bộ tài liệu API — Hệ thống Quản lý Doanh nghiệp**
> [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [API-02 AUTH](<API-02 AUTH API Design.md>) · [API-03 HR](<API-03_HR_API_Design.md>) · [API-04 ATT](<API-04_ATT_API_Design.md>) · [API-05 LEAVE](<API-05_LEAVE_API_Design.md>) · [API-06 TASK](<API-06_TASK_API_Design.md>) · [API-07 NOTI](<API-07_NOTI_API_Design.md>) · [API-08 DASH](<API-08_DASH_API_Design.md>) · [API-09 FOUNDATION](<API-09_FOUNDATION_API_Design.md>) · [API-10 Permission Matrix](<API-10 PERMISSION MATRIX.md>) · [API-11 ME](<API-11_ME_API_Design.md>) · [API-12 GOAL](<API-12_GOAL_API_Design.md>) · [API-13 CHAT](<API-13_CHAT_API_Design.md>) · [API-14 ASSET](<API-14_ASSET_API_Design.md>) · **API-15 ROOM**
>
> **Nguồn & liên quan:** [Chuẩn API: API-01 Tổng quan](<API-01 TỔNG QUAN.md>) · [Đặc tả: SPEC-14 ROOM](<../SPEC/SPEC-14 ROOM.md>) · [Thiết kế DB: DB-16](<../DB/DB-16 ROOM Database Design.md>) · [DB-09 §8.17 Index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 Seed ROOM](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>) · [Ma trận phân quyền §9e](<../permission-matrix-spec.md>) · [Chỉ mục tài liệu](<../README.md>)
>
> **Đánh số:** API-14 ASSET · API-15 ROOM (OFFICE-DEC-001, owner ký 28/08/2026) — nối tiếp API-13 CHAT.

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | API-15 |
| Tên tài liệu | ROOM API Design |
| Tên dự án | Hệ thống quản lý doanh nghiệp nội bộ |
| Tên sản phẩm | Enterprise Management System |
| Module | ROOM - Quản lý phòng họp |
| Phiên bản | v0.1 |
| Trạng thái | **Stub — Approved** (owner duyệt gói wave S11-OFFICE 28/08/2026, cùng SPEC-14 §1). Khung endpoint đã chốt; DTO chi tiết bổ sung ở WO backend `S11-ROOM-BE-1` |
| Giai đoạn | Phase 3 · wave S11-OFFICE — hậu go-live |
| Tài liệu nguồn | SPEC-14 ROOM, API-01 Tổng quan, DB-16, DB-09/10, permission-matrix-spec §9e |
| Ngày tạo | 29/08/2026 |
| Ngày cập nhật | 29/08/2026 |

> **Trạng thái Stub:** Tài liệu khoá **tên file + danh sách endpoint + cặp quyền + nguyên tắc bắt buộc** để README/SPEC-14 §15 trỏ nhất quán. DTO/schema request-response đầy đủ, ví dụ payload và OpenAPI bổ sung ở WO backend (`S11-ROOM-BE-1`) — đồng bộ `packages/contracts/src/room.ts`.

---

## 2. Mục đích tài liệu

Mô tả thiết kế API cho module **ROOM** — danh mục phòng họp, đặt lịch theo khung giờ có chống trùng ở DB, huỷ lịch, nhắc lịch, lịch sử sử dụng (SPEC-14 §2). API-15 dùng làm cơ sở cho:

1. Backend triển khai controller/service/DTO dưới prefix `/api/v1/rooms`, `/api/v1/room-bookings`, `/api/v1/me/room-bookings`.
2. Frontend triển khai 5 màn `ROOM-SCREEN-001..005` (`apps/app/src/routes/rooms/` + mục «Đặt phòng của tôi» trong `/me`).
3. QA viết test deny-path/cross-tenant + trùng lịch (kể cả race 2 request song song) + FSM huỷ cho khu vực ROOM.

---

## 3. Căn cứ thiết kế

1. **API-01** — prefix `/api/v1`, envelope response/error thống nhất, pagination chuẩn, header `X-Request-Id` / `Idempotency-Key`, bắt buộc kiểm authentication + permission + data scope + business validation + audit.
2. **SPEC-14 ROOM** — nguồn sự thật nghiệp vụ: nguyên tắc (§3), permission 5 cặp (§11), 10 mã lỗi (§12), FSM + thứ tự kiểm + lịch/phòng trống/nhắc (§13), API (§15), sự kiện (§17), audit/bảo mật (§18), OFFICE-DEC-001 + ROOM-DEC-001..004 (§22).
3. **DB-16** — `meeting_rooms` tái dụng + 2 bảng mới (RLS+FORCE, composite tenant FK), EXCLUDE GIST chống trùng, `room_bookings` là sổ không DELETE, 4 bảng di sản DROP.
4. **DB-09 §8.17** — index ROOM; **DB-10** — seed module `ROOM` + role `office-admin` + 5 cặp + audit UNION-ADD + 3 event NOTI + xoá 6 cặp di sản.
5. **permission-matrix-spec §9e** — ánh xạ 5 cặp quyền sang tuple `(action, resource_type)` mà permission engine thực thi + ma trận data_scope.
6. **API-02 AUTH** — organizer/attendees là `users` (chỉ `active` cùng company); ROOM chỉ JOIN tên, không sở hữu.
7. **API-09 FOUNDATION** — `audit_logs`, `@Idempotent()`, `@SystemJobHandler` (job nhắc), OutboxNotificationBridge phát `ROOM_BOOKING_CONFIRMED` / `ROOM_BOOKING_CANCELLED` / `ROOM_BOOKING_REMINDER`.
8. **API-11 ME** — `/me/room-bookings` theo chuẩn own-filter, user resolve từ token (SPEC-09 §14.4).

---

## 4. Phạm vi API-15

### 4.1 Bao gồm trong v1

| Nhóm API | Mô tả |
| --- | --- |
| Rooms | Danh sách/lọc · tạo · chi tiết · sửa (kể cả kích hoạt/vô hiệu) · xoá mềm · **phòng trống theo khung giờ** · thống kê sử dụng |
| Room bookings | Lịch mọi phòng / một phòng trong cửa sổ ≤ 31 ngày · tạo lượt (chống trùng 2 lớp) · chi tiết · huỷ |
| ME bookings | `GET /me/room-bookings` — lượt tôi tổ chức hoặc tham dự |

### 4.2 Không bao gồm (ngoài phạm vi v1 — SPEC-14 §5.2)

- `PATCH /room-bookings/{id}` (sửa giờ/phòng/người tham dự) — v1 huỷ + đặt lại.
- Endpoint duyệt đặt phòng (ROOM-DEC-002) · recurring · xuất ICS / đồng bộ lịch ngoài (ROOM-DEC-003) · check-in phòng · biên bản/action-item cuộc họp (đã DROP cùng hub G10).

---

## 5. Endpoint tổng hợp ROOM (SPEC-14 §15)

Prefix: `/api/v1`

```http
GET    /api/v1/rooms
POST   /api/v1/rooms
GET    /api/v1/rooms/availability
GET    /api/v1/rooms/usage-summary
GET    /api/v1/rooms/{room_id}
PATCH  /api/v1/rooms/{room_id}
DELETE /api/v1/rooms/{room_id}
GET    /api/v1/rooms/{room_id}/bookings

GET    /api/v1/room-bookings
POST   /api/v1/room-bookings
GET    /api/v1/room-bookings/{booking_id}
POST   /api/v1/room-bookings/{booking_id}/cancel

GET    /api/v1/me/room-bookings
```

> **13 mã ROOM-API = 13 route HTTP.** Route-census đếm **route** — WO BE regen census với 13. `availability` và `usage-summary` khai **trước** `/rooms/{room_id}` (bài học `goals/tree`).

### 5.1 Bảng endpoint (stub — chi tiết DTO ở WO backend)

| Mã | Method | Path | Chức năng | Cặp quyền (SPEC-14 §11) | Audit | NOTI |
| --- | --- | --- | --- | --- | --- | --- |
| ROOM-API-001 | GET | `/rooms` | Danh sách phòng — mặc định `isActive=true` + chưa xoá; `?includeInactive=true` (màn 004); filter `capacityMin` · `q` (tên/vị trí); sort `sortOrder`,`name` | `('view','room')` | — | — |
| ROOM-API-002 | POST | `/rooms` | Tạo phòng `{ name, location?, capacity, equipment?[], description?, requiresApproval?, sortOrder? }`; tên trùng (case-insensitive) → ROOM-ERR-009 | `('manage','room')` | ✅ `meeting_room` | — |
| ROOM-API-003 | GET | `/rooms/availability` | `?from&to&capacityMin?&equipment[]?` — phòng `isActive`, không `requiresApproval`, đủ sức chứa/thiết bị, **NOT EXISTS** lượt `Confirmed` giao `[from, to)`; `[from, to)` chỉ kiểm `end-before-start` + `too-long` (≤ 8h) của ROOM-ERR-002 — **không** áp `in-past`/`too-short`/`too-far` (tra cứu, không phải đặt — SPEC-14 §13.4) | `('view','room')` | — | — |
| ROOM-API-004 | GET | `/rooms/usage-summary` | `?from&to` (≤ 366 ngày): theo phòng `{ roomId, name, bookingsCount, hoursBooked, cancelledCount }` — chỉ lượt có `starts_at` trong cửa sổ; gồm cả phòng đã vô hiệu/xoá mềm nếu có lượt | `('view','room')` | — | — |
| ROOM-API-005 | GET | `/rooms/{id}` | Chi tiết phòng + `upcomingCount` (lượt `Confirmed` có `endsAt > now`); phòng đã xoá mềm → 404 ROOM-ERR-003 | `('view','room')` | — | — |
| ROOM-API-006 | PATCH | `/rooms/{id}` | Sửa thuộc tính + `isActive`; `isActive=false` khi `upcomingCount > 0` → ROOM-ERR-008; tên trùng → ROOM-ERR-009 | `('manage','room')` | ✅ `meeting_room` (`update` / `deactivate`) | — |
| ROOM-API-007 | DELETE | `/rooms/{id}` | Xoá mềm; `upcomingCount > 0` → ROOM-ERR-008 | `('manage','room')` | ✅ `meeting_room` | — |
| ROOM-API-008 | GET | `/rooms/{id}/bookings` | `?from&to&status=Confirmed\|Cancelled\|all` (mặc định `Confirmed`) — lịch + lịch sử một phòng; `[from, to)` ≤ 31 ngày; phòng đã xoá mềm **vẫn** trả (lịch sử); trả phẳng (không phân trang), mỗi lượt có `isCompleted` | `('view','room')` | — | — |
| ROOM-API-009 | GET | `/room-bookings` | `?from&to&roomId[]?&organizerUserId?&status?` — lịch mọi phòng (màn 001 tuần); `[from, to)` ≤ 31 ngày; trả phẳng; FE nhóm theo phòng | `('view','room')` | — | — |
| ROOM-API-010 | POST | `/room-bookings` | Đặt `{ roomId, title, startsAt, endsAt, description?, attendeeUserIds?[], organizerUserId? }` — thứ tự kiểm SPEC-14 §13.2; `organizerUserId` chỉ honour khi scope `book` = Company (ROOM-ERR-010); trùng → **409 ROOM-ERR-001** kèm `conflicts[]` + `nextFreeFrom`; `@Idempotent()` (§6.9); trả 201 + chi tiết như 011 | `('book','room')` | ✅ `room_booking` (`book`; payload ghi cả `organizerUserId` + `bookedByUserId`) | `ROOM_BOOKING_CONFIRMED` |
| ROOM-API-011 | GET | `/room-bookings/{id}` | Chi tiết: `room{ id, name, location, capacity }` · `organizer{ userId, displayName, employeeCode? }` · `bookedBy{…}` · `attendees[]{ userId, displayName, employeeCode? }` · `status` · `isCompleted` · `canCancel` (server tính theo quyền + scope + thời gian) · `cancelledAt/by/reason` | `('view','room')` | — | — |
| ROOM-API-012 | POST | `/room-bookings/{id}/cancel` | `{ reason? }`; `Confirmed → Cancelled` chỉ khi `endsAt > now` (ROOM-ERR-005); scope Own ⇒ chỉ lượt `organizer = caller`, khác → **403** `AUTH-ERR-SCOPE-DENIED`; một câu UPDATE thoả CHECK cặp | `('cancel','room-booking')` | ✅ `room_booking` (`cancel`) | `ROOM_BOOKING_CANCELLED` |
| ROOM-API-013 | GET | `/me/room-bookings` | User từ token; `?date=YYYY-MM-DD` (theo `companies.timezone`) **hoặc** `?from&to` (≤ 31 ngày); `role=organizer\|attendee\|all` (mặc định `all`); `includeCancelled?`; mỗi lượt có `myRole` + `isCompleted` + `canCancel`; **không** nhận `userId` | `('view','room')` (bộ lọc theo caller) | — | — |

> **Notation permission:** chuỗi `('action','resource')` là **cặp engine thực thi** (permission-matrix-spec §9e + DB-10 seed) — không phải chuỗi dotted `ROOM.RESOURCE.ACTION` hiển thị FE.
>
> ⚠️ **Mọi `{id}` là UUID ở biên** — pipe `ParseUUIDPipe`/Zod **cấp method**, không `@UsePipes` cấp class (`nestjs-zod-class-level-pipe-does-nothing`); sai định dạng trả **400**, không để rơi xuống DB thành 500 `22P02`. Ratchet param-uuid **không được tăng**.
>
> ⚠️ **`from`/`to` là ISO 8601 có offset** (`2026-09-02T02:00:00+07:00` hoặc `…Z`); `date` là ngày lịch theo múi giờ công ty — server đổi thành `[00:00, 24:00)` của `companies.timezone` (ROOM-DEC-003), FE không tự tính.

### 5.2 Trạng thái hiện thực (đối chiếu code)

| Mã | Trạng thái | Ghi chú |
| --- | --- | --- |
| ROOM-API-001..013 | ⏳ Chưa | Thi công ở `S11-ROOM-BE-1` sau `S11-ROOM-DB-1`. Cập nhật bảng này khi WO đóng |

> Lệch giữa bảng này và code ⇒ **sửa code**, không sửa ngầm tài liệu (CLAUDE.md — docs/spec + docs/DB là chuẩn). Cột này là ảnh chụp tiến độ.

---

## 6. Nguyên tắc API BẮT BUỘC (SPEC-14 §3, §13, §18)

1. **Chống trùng hai lớp**: service kiểm trước bằng `tstzrange && tstzrange` để trả **409 ROOM-ERR-001 có nội dung** (`conflicts[]` + `nextFreeFrom`); **EXCLUDE GIST là chốt cuối** — vi phạm `room_bookings_no_overlap_excl` (`23P01`, bóc từ `error.cause` — drizzle bọc lỗi) ⇒ truy vấn lại conflicts ⇒ **cùng 409**, không 500.
2. **Thứ tự kiểm cố định** (SPEC-14 §13.2): giờ → phòng → organizer → attendees → sức chứa → trùng lịch → INSERT. Không controller nào tự kiểm.
3. **FSM ép ở service** trong cùng transaction (`SELECT … FOR UPDATE` hàng lượt); huỷ là **một câu UPDATE** có `WHERE status = 'Confirmed' AND ends_at > now()` (CHECK cặp huỷ — DB-16 §6.2); 0 hàng ⇒ đọc lại chọn `kind` ROOM-ERR-005.
4. **`Completed` là dẫn xuất ở server**: mọi DTO lượt có `isCompleted` và `canCancel`; FE không suy từ đồng hồ máy.
5. **Data scope ép ở service**, không phải RLS: `view` Company cho mọi role (lịch là dữ liệu dùng chung); `book@Own` ⇒ organizer = caller (`organizerUserId` khác → 403 ROOM-ERR-010); `cancel@Own` ⇒ organizer = caller (khác → 403 `AUTH-ERR-SCOPE-DENIED`). **Cross-tenant luôn 404** (ROOM-ERR-003).
6. **`/me/room-bookings` resolve user từ token** — không có tham số nào cho phép truyền `userId` (chống IDOR, mirror ME/ASSET-API-023). Là **bộ lọc** `organizer_user_id = me OR EXISTS attendee = me` bằng `EXISTS`, không JOIN attendees.
7. **Không trường nhạy cảm** nhưng DTO **không** mang `email`/số điện thoại của user — chỉ `userId` · `displayName` · `employeeCode?`.
8. **Mọi mutation ghi audit** trong cùng transaction (tạo/sửa/vô hiệu/xoá phòng · đặt · huỷ) với `object_type` `meeting_room` / `room_booking`; đặt hộ ghi cả `organizerUserId` lẫn `bookedByUserId`.
9. **`Idempotency-Key` của `POST /room-bookings` do CLIENT sinh một lần khi mở form** (cùng quyết định với ASSET-API-010 — khoá suy từ payload sẽ **phát lại lượt vừa huỷ** khi người dùng huỷ rồi đặt lại y hệt trong 15′). Cơ chế = `@Idempotent()` dùng chung (BACKEND-12 §14.1): khoá scope `company_id + user_id + method + path + key`, **TTL 15 phút**, header **không bắt buộc ở interceptor** (FE luôn gửi), replay **phát lại envelope nguyên trạng** + header `Idempotency-Replayed: true`. Chống trùng nghiệp vụ là việc của EXCLUDE.
10. **`company_id` ở mọi query** — mọi truy vấn qua `withTenant(companyId, fn)`.
11. **NOTI qua OutboxNotificationBridge** — enqueue trong transaction, `dedupeKey` suy từ nội dung (SPEC-14 §17); recipient = id có sẵn trong lượt (mode `UserIds`), engine tự loại actor ở 013/014.
12. **Cửa sổ lịch ≤ 31 ngày, trả phẳng** (không phân trang) — `[from, to)` rộng hơn → 422 ROOM-ERR-002 `range-too-wide`. `usage-summary` ≤ 366 ngày.
13. **Khai `API_MODULE_TAGS` cho `ROOM`** (`apps/api/src/config/openapi-modules.ts`) và regen route-census có chủ đích (`ROUTE_CENSUS_WRITE=1`) — route mới không khai ⇒ census ĐỎ.

---

## 7. Chuẩn response, lỗi, pagination, idempotency (theo API-01)

### 7.1 Envelope thành công (object) — ví dụ chi tiết lượt đặt

```json
{
  "success": true,
  "message": "Lấy dữ liệu thành công",
  "data": {
    "id": "…",
    "room": { "id": "…", "name": "Mercury", "location": "Tầng 3", "capacity": 6 },
    "title": "Kickoff dự án Q4",
    "startsAt": "2026-09-02T02:30:00Z",
    "endsAt": "2026-09-02T03:30:00Z",
    "organizer": { "userId": "…", "displayName": "Nguyễn Văn A", "employeeCode": "NV-0012" },
    "bookedBy": { "userId": "…", "displayName": "Nguyễn Văn A" },
    "attendees": [ { "userId": "…", "displayName": "Trần B", "employeeCode": "NV-0031" } ],
    "status": "Confirmed",
    "isCompleted": false,
    "canCancel": true,
    "cancelledAt": null,
    "cancelledBy": null,
    "cancelReason": null
  },
  "meta": { "request_id": "req_…", "timestamp": "2026-09-01T09:00:00+07:00" }
}
```

### 7.2 Envelope list — lịch phẳng (`GET /room-bookings`, `/rooms/{id}/bookings`, `/me/room-bookings`) và list phân trang (`GET /rooms`)

Lịch trong cửa sổ ≤ 31 ngày trả **mảng phẳng** trong `data` kèm `meta.window = { from, to }`, **không** có `pagination` (cửa sổ đã là giới hạn). `GET /rooms` phân trang chuẩn API-01:

```json
{
  "success": true,
  "message": "Lấy danh sách thành công",
  "data": [ { "…": "…" } ],
  "pagination": { "page": 1, "per_page": 20, "total": 12, "total_pages": 1, "has_next": false, "has_prev": false },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

### 7.3 Phòng trống (`GET /rooms/availability`) và thống kê (`GET /rooms/usage-summary`)

```json
{ "success": true, "message": "OK",
  "data": [ { "id": "…", "name": "Mercury", "capacity": 6, "equipment": ["TV"], "location": "Tầng 3" } ],
  "meta": { "request_id": "req_…", "timestamp": "…", "window": { "from": "…", "to": "…" } } }
```

```json
{ "success": true, "message": "OK",
  "data": [ { "roomId": "…", "name": "Mercury", "bookingsCount": 42, "hoursBooked": 61.5, "cancelledCount": 3 } ],
  "meta": { "request_id": "req_…", "timestamp": "…", "window": { "from": "…", "to": "…" } } }
```

### 7.4 Envelope lỗi + mã lỗi

Mã lỗi theo API-01 §13 `MODULE-ERR-CODE`. Namespace ROOM gồm **hai nhóm**:

- **Đánh số** `ROOM-ERR-001`..`ROOM-ERR-010` — vi phạm quy tắc nghiệp vụ, định nghĩa đầy đủ ở SPEC-14 §12.
- **Đặt tên** — sentinel chung của module (quy ước sẵn có `GOAL-ERR-NOT-FOUND`, `ASSET-ERR-NOT-FOUND`…), không chiếm số:

| Mã sentinel | HTTP | Ý nghĩa |
| --- | ---: | --- |
| `ROOM-ERR-NOT-FOUND` | 404 | Phòng / lượt đặt **không tồn tại trong company** (kể cả tenant khác) — một phản hồi duy nhất (ROOM-ERR-003) |
| `ROOM-ERR-FORBIDDEN` | 403 | Có cặp `access` nhưng thiếu cặp hành động (do `PermissionGuard`, thường trả `AUTH-ERR-FORBIDDEN`) |

Ánh xạ HTTP của dãy đánh số:

| HTTP | Dùng cho |
| --- | --- |
| `400` | Body/param sai định dạng (`VALIDATION-ERR-001`), `{id}` không phải UUID, `from`/`to` không phải ISO 8601 |
| `403` | ROOM-ERR-010 (`book-on-behalf-denied`) · `AUTH-ERR-SCOPE-DENIED` (huỷ lượt người khác ở scope Own) |
| `404` | ROOM-ERR-003 |
| `409` | ROOM-ERR-001 · 004 · 005 · 008 · 009 · **mã của interceptor idempotency dùng chung**: `IN_PROGRESS` (bấm-đúp khi request đầu chưa xong) · `KEY_REUSED` (cùng key, khác payload — xảy ra khi người dùng sửa giờ rồi gửi lại trên cùng form) · `INVALID_KEY` — FE **rẽ theo `error.code`**, không theo HTTP status (`idempotency.interceptor.ts`) |

> **Mã trên dây cho 404:** giống ASSET, envelope trả **tên sentinel** `ROOM-ERR-NOT-FOUND` (`error.code`); `ROOM-ERR-003` là **mã quy tắc** trong SPEC-14 §12 để QA/FE tra cứu, không xuất hiện trên dây. Test assert `ROOM-ERR-NOT-FOUND`.
| `422` | ROOM-ERR-002 · 006 · 007 · 010 (`organizer-not-found` / `organizer-inactive`) |

Dùng lại nhóm lỗi chung API-01: `AUTH-ERR-UNAUTHENTICATED` 401 · `AUTH-ERR-FORBIDDEN` 403 · `AUTH-ERR-SCOPE-DENIED` 403 · `VALIDATION-ERR-001` 400 · `SYSTEM-ERR-RATE-LIMIT` 429.

```json
{
  "success": false,
  "message": "Phòng Mercury đã có lịch trong khung giờ này",
  "error": {
    "code": "ROOM-ERR-001",
    "type": "BusinessRuleError",
    "details": {
      "conflicts": [ { "bookingId": "…", "title": "Họp sprint", "startsAt": "2026-09-02T02:00:00Z", "endsAt": "2026-09-02T03:30:00Z", "organizerName": "Lê C" } ],
      "nextFreeFrom": "2026-09-02T03:30:00Z"
    }
  },
  "meta": { "request_id": "req_…", "timestamp": "…" }
}
```

### 7.5 Idempotency

`POST /room-bookings` gắn `@Idempotent()` (interceptor dùng chung — BACKEND-12 §14.1); header `Idempotency-Key` **do client sinh khi mở form** (§6.9), FE **luôn** gửi, interceptor **không bắt buộc** (thiếu header ⇒ chạy như thường — back-compat có chủ ý của hạ tầng chung). Khoá scope `company_id + user_id + method + path + idempotency_key`, **TTL 15 phút** (`IDEMPOTENCY_TTL_SEC = 900`); replay **phát lại envelope nguyên trạng** + header `Idempotency-Replayed: true` — **không** có `meta.idempotent_replay`. FE **sinh khoá mới** khi mở form, sau mỗi lần gửi thành công và sau `KEY_REUSED` (cùng khoá + payload khác ⇒ 409 `KEY_REUSED` — không phải trùng lịch). Interceptor **nhả khoá khi handler ném lỗi** ⇒ sau 409 ROOM-ERR-001 người dùng sửa giờ và gửi lại cùng khoá vẫn chạy thật. `POST /room-bookings/{id}/cancel` **không** cần idempotency (huỷ lặp trả 409 `already-cancelled` — đủ rõ, không tạo hàng mới).

---

## 8. Dữ liệu ROOM (SPEC-14 §16, DB-16)

- ROOM **không tạo lại**: `users`, `employee_profiles` (chỉ JOIN tên), `audit_logs`, `notification_*`, `system_jobs`.
- Bảng canonical do ROOM sở hữu: `meeting_rooms` (tái dụng) · `room_bookings` · `room_booking_attendees`. RLS+FORCE mọi bảng; `room_bookings` **không có** DELETE, UPDATE cấp cột huỷ; `room_booking_attendees` chỉ `SELECT, INSERT`. Bốn bảng di sản `meetings`/`meeting_attendees`/`meeting_notes`/`meeting_tasks` **DROP** ở `S11-ROOM-DB-1`. Chi tiết cột: DB-16 §6; index: DB-09 §8.17; seed: DB-10.

---

## 9. Trạng thái tài liệu & việc còn nợ

| Hạng mục | Trạng thái |
| --- | --- |
| Tên file + prefix + danh sách endpoint §5 + cặp quyền | ✅ Khoá ở stub này |
| Nguyên tắc bắt buộc (chống trùng 2 lớp/thứ tự kiểm/FSM/dẫn xuất/scope/audit/tenant/idempotency/cửa sổ lịch) | ✅ Ghi rõ (§6) |
| Cross-link SPEC-14 / DB-16 / DB-09 / DB-10 / permission-matrix §9e / API-01 | ✅ |
| DTO request/response chi tiết từng endpoint + `packages/contracts/src/room.ts` | ⏳ `S11-ROOM-BE-1` |
| Đối chiếu endpoint đã ship vs thiết kế (§5.2) | ⏳ cập nhật khi `S11-ROOM-BE-1` đóng |
| OpenAPI/Swagger nhóm ROOM (`API_MODULE_TAGS`) | ⏳ `S11-ROOM-BE-1` |
| Flip Stub → Approved | ✅ owner duyệt gói wave 28/08/2026 (đồng bộ SPEC-14 §1 + DB-16 §1) |

---

## 10. Liên quan

- **Đặc tả nghiệp vụ (nguồn sự thật):** [SPEC-14 ROOM](<../SPEC/SPEC-14 ROOM.md>) — §11 permission, §12 mã lỗi, §13 FSM/thứ tự kiểm/lịch/nhắc, §15 API, §17 sự kiện, §18 audit/bảo mật, §22 quyết định.
- **Chuẩn API:** [API-01 Tổng quan](<API-01 TỔNG QUAN.md>) — envelope, mã lỗi, pagination, idempotency.
- **Thiết kế DB:** [DB-16 ROOM Database Design](<../DB/DB-16 ROOM Database Design.md>) · [DB-09 §8.17 index](<../DB/DB-09 Database Index Query Pattern Performance Design.md>) · [DB-10 seed ROOM](<../DB/DB-10_Migration_Plan_Initial_Seed_Data_Database_Design.md>).
- **Phân quyền:** [Ma trận phân quyền §9e](<../permission-matrix-spec.md>).
- **Module anh em:** [API-14 ASSET](<API-14_ASSET_API_Design.md>) — cùng wave, cùng khuôn idempotency/audit/NOTI.
- **Chỉ mục:** [README §9](<../README.md>).
