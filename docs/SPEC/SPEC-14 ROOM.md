# SPEC-14: ROOM — QUẢN LÝ PHÒNG HỌP (DANH MỤC PHÒNG · ĐẶT LỊCH · CHỐNG TRÙNG · HUỶ · NHẮC LỊCH · LỊCH SỬ SỬ DỤNG)

> **📚 Bộ tài liệu SPEC — Hệ thống Quản lý Doanh nghiệp**
> [SPEC-01 Tổng quan](<SPEC-01 Tổng quan.md>) · [SPEC-02 AUTH](<SPEC-02 AUTH.md>) · [SPEC-03 HR](<SPEC-03 HR.md>) · [SPEC-04 ATT](<SPEC-04 ATT.md>) · [SPEC-05 LEAVE](<SPEC-05 LEAVE.md>) · [SPEC-06 TASK](<SPEC-06 TASK.md>) · [SPEC-07 DASH](<SPEC-07 DASH.md>) · [SPEC-08 NOTI](<SPEC-08 NOTI.md>) · [SPEC-09 ME](<SPEC-09 ME.md>) · [SPEC-10 GOAL](<SPEC-10 GOAL.md>) · [SPEC-13 ASSET](<SPEC-13 ASSET.md>) · **SPEC-14 ROOM** · [SPEC-15 CHAT](<SPEC-15 CHAT.md>)
>
> **Liên quan:** [Chỉ mục tài liệu](<../README.md>) · [DB-16 ROOM Database Design](<../DB/DB-16 ROOM Database Design.md>) · [Thiết kế API: API-15 ROOM](<../API Design/API-15_ROOM_API_Design.md>) · [Ma trận phân quyền §9e](<../permission-matrix-spec.md>) · [NOTI nền: SPEC-08](<SPEC-08 NOTI.md>) · [DASH: SPEC-07](<SPEC-07 DASH.md>) · [Kế hoạch wave: S11-OFFICE](<../plans/S11-OFFICE-WAVE.md>) · [Module anh em: SPEC-13 ASSET](<SPEC-13 ASSET.md>)
>
> **Đánh số:** ROOM giữ đúng số **SPEC-14** đã khoá tại [SPEC-01 §7.2/§8](<SPEC-01 Tổng quan.md>). Tài liệu DB/API lấy **DB-16 / API-15** (OFFICE-DEC-001 — DB-13/14 đã bị IMPLEMENTATION-10 đặt trước cho PAYROLL/RECRUIT, giữ nguyên chỗ đặt đó, không dồn số).

---

## 1. Thông tin tài liệu

| Trường | Nội dung |
| --- | --- |
| Mã tài liệu | SPEC-14 |
| Tên tài liệu | ROOM - Quản lý phòng họp |
| Module code | ROOM |
| Tài liệu cha | SPEC-01: Tổng quan hệ thống (§12.11) |
| Module phụ thuộc trực tiếp | AUTH (RBAC — người đặt/người tham dự là `users`), FOUNDATION (audit · system jobs) |
| Module liên quan | NOTI (xác nhận · huỷ · nhắc lịch), DASH (widget «lịch họp hôm nay»), ME («đặt phòng của tôi»), HR (danh bạ chọn người tham dự) |
| Phiên bản | v1.0 |
| Trạng thái | **Approved** — owner duyệt nguyên gói hồ sơ wave S11-OFFICE ngày **28/08/2026**, ký OFFICE-DEC-001 + ROOM-DEC-001..004 (§22); nhánh mở của ROOM-DEC-001 (`meetings`/`meeting_attendees`) chốt trong tài liệu này ngày **29/08/2026** sau khi ĐO |
| Giai đoạn | **Phase 3 «Quản trị văn phòng» · wave S11-OFFICE** — hậu go-live |
| Ngày tạo | 29/08/2026 |
| Ngày cập nhật | 29/08/2026 |

---

## 2. Mục đích tài liệu

Tài liệu này mô tả module **ROOM — Quản lý phòng họp**: nơi công ty khai báo các phòng họp (sức chứa · thiết bị · vị trí), nhân viên **đặt phòng theo khung giờ**, hệ thống **chặn trùng lịch ở tầng DB**, cho phép huỷ lịch, nhắc trước giờ họp, và giữ **lịch sử sử dụng** từng phòng.

ROOM trả lời các câu hỏi:

```text
Công ty có những phòng họp nào, chứa được bao nhiêu người, có thiết bị gì?
Chiều nay 14:00–15:30 còn phòng nào trống cho 8 người?
Phòng Mercury tuần này ai đặt, khung nào?
Tôi đã đặt những lịch nào sắp tới; lịch nào đã bị huỷ?
Cuộc họp của tôi sắp bắt đầu — có được nhắc không?
Tháng trước phòng nào được dùng nhiều nhất, bao nhiêu giờ?
```

ROOM **không sở hữu** dữ liệu của module khác: người đặt/người tham dự là `users` (AUTH), tên hiển thị JOIN từ AUTH/HR lúc đọc, thông báo thuộc NOTI. ROOM chỉ sở hữu **phòng họp · lượt đặt phòng · danh sách người tham dự của lượt đặt**.

---

## 3. Định nghĩa và nguyên tắc kiến trúc

### 3.1 Lượt đặt phòng là một khoảng thời gian nửa-mở trên một phòng

Mỗi hàng `room_bookings` là **một** lượt giữ chỗ `[starts_at, ends_at)` trên **đúng một** phòng. Hai lượt `Confirmed` trên cùng phòng **không được giao nhau** — ép ở tầng DB bằng `EXCLUDE USING gist (company_id WITH =, room_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE status = 'Confirmed'` (DB-16 §6.2). Đầu-đóng-cuối-mở ⇒ `10:00–11:00` và `11:00–12:00` **không** trùng. Service kiểm trước để trả 409 có nội dung (khung bận + gợi ý giờ trống); **EXCLUDE là chốt cuối** cho hai request song song lọt qua kiểm-rồi-ghi.

### 3.2 Chỉ hai trạng thái lưu cứng, `Completed` là dẫn xuất — ROOM-DEC-003 / SPEC-01 §17.10

```text
lượt đặt phòng: Confirmed · Cancelled
dẫn xuất       : Completed = Confirmed AND ends_at ≤ now()
```

`Completed` **không** lưu cột, **không** có job chuyển trạng thái — cùng nguyên tắc `Overdue` của TASK (SPEC-01 §17.7). Server trả `isCompleted` trong DTO; FE **không tự suy**. Bộ giá trị hợp thức tại **SPEC-01 §17.10**.

### 3.3 Đặt là giữ chỗ ngay — v1 KHÔNG có luồng duyệt (ROOM-DEC-002)

Không có FSM phê duyệt (tránh dựng thêm một crown-jewel ở v1). Cột `meeting_rooms.requires_approval` **có tồn tại** để mở Phase sau, và **được ĐỌC**: phòng đặt `requires_approval = true` ở v1 **từ chối đặt** với **409 ROOM-ERR-004** (`kind = approval-not-supported`) — không phải cột trang trí (bài học `ui-promises-backend-never-reads`).

### 3.4 Tái dụng nền di sản có chủ đích — ROOM-DEC-001 (chốt 29/08/2026 sau khi ĐO)

Đo trên DB `mediaos` (PROD + dev-online dùng chung) ngày 29/08/2026: **0 hàng** ở cả 5 bảng `meeting_rooms · meetings · meeting_attendees · meeting_notes · meeting_tasks` (mig `0052`/`0053`, RLS+FORCE, composite tenant FK `0535`, `meetings` có sẵn EXCLUDE GIST, `btree_gist` 1.7 đã cài); **0 service/controller** tham chiếu; 6 cặp quyền `meeting*`/`meeting_room*` di sản mỗi cặp **2 grant** nhưng **0 guard** dùng. Kết luận:

| Bảng di sản | Số phận | Vì sao |
| --- | --- | --- |
| `meeting_rooms` | **TÁI DỤNG + ALTER** (cột thiết bị · `requires_approval` · `is_active` · `updated_*` · `deleted_by`; **DROP `is_virtual`**) | khớp ~1:1 phòng họp SPEC-14; giữ tên bảng, giữ `UNIQUE (company_id, id)` đã có |
| `meetings` · `meeting_attendees` | **THAY** bằng `room_bookings` · `room_booking_attendees` (expand-contract), rồi **DROP** | `meetings` là thực thể «cuộc họp» của hub G10 (agenda · notes · action-item), `meeting_room_id` **nullable** + `SET NULL`, `status` chữ thường 3 giá trị, `organizer_id` `CASCADE` (xoá user là mất lịch sử), `agenda`/`metadata` ghi-rồi-bỏ. ALTER để thành «lượt đặt phòng» = đụng gần như mọi cột = rename trá hình; bảng mới sạch hơn và **cùng WO DB** dọn bảng cũ ⇒ không tồn tại «hai phòng họp» (lớp lỗi KI-079) |
| `meeting_notes` · `meeting_tasks` | **DROP** | ngoài phạm vi SPEC-14 (biên bản/action-item không thuộc v1) |
| 6 cặp quyền `('view'\|'create'\|'update'\|'cancel','meeting')` · `('view'\|'manage','meeting_room')` | **xoá grant + xoá mềm cặp** cùng WO DB | 0 controller ép ⇒ không có cửa sổ 403 (điều kiện "contract" của `migration-expand-contract-required` thoả); cặp mới §11 tên khác |

Chi tiết thứ tự migration ở DB-16 §9. Bảng dùng lại đúng một tên: **`meeting_rooms`** (không đổi tên thành `rooms` — tránh đụng `chat_rooms`/`room_code` của CHAT và giữ nguyên FK census `0535`).

### 3.5 Múi giờ — ROOM-DEC-003

UTC-at-rest (`timestamptz`); API nhận/trả ISO 8601 có offset; FE hiển thị theo `companies.timezone` (mặc định `Asia/Ho_Chi_Minh`). "Hôm nay" của widget DASH và của bộ lọc `date` tính theo múi giờ công ty, **không** theo múi giờ trình duyệt. v1 **không** recurring booking.

### 3.6 Không sao chép dữ liệu nguồn

Tên người đặt/tham dự luôn **JOIN** từ `users` (+ `employee_profiles` nếu có) lúc đọc; ROOM không lưu tên. Duy nhất snapshot có chủ đích: **không có** (khác ASSET kiểm kê) — lịch sử sử dụng phòng chính là các hàng `room_bookings` (sổ không xoá, §18).

---

## 4. Mục tiêu module

### 4.1 Mục tiêu nghiệp vụ

- Một lịch phòng chung: **ai đặt phòng nào, khung nào** — không còn tranh phòng, không đặt chồng.
- Đặt phòng tự phục vụ trong vài giây, bị chặn ngay khi trùng, có gợi ý giờ trống.
- Nhắc trước 15 phút để phòng không bị bỏ trống vì quên.
- Lịch sử sử dụng để hành chính biết phòng nào thừa/thiếu.

### 4.2 Mục tiêu kỹ thuật

- Tái dùng tối đa hạ tầng đã có: RBAC per-pair + data_scope, `withTenant` + RLS, audit, outbox NOTI, `@SystemJobHandler`, `@Idempotent()`, `btree_gist` + EXCLUDE đã có sẵn từ `0052`.
- Chống trùng lịch **hai lớp**: service kiểm trước (409 có nội dung) + EXCLUDE GIST chốt cuối (map `23P01` → 409, không 500).
- Mọi `:id` là UUID ở biên ngay từ đầu (ratchet param-uuid đang siết về 1 — không thêm nợ).

---

## 5. Phạm vi module

### 5.1 Trong v1 (wave S11-OFFICE — SPEC-01 §12.11)

| # | Hạng mục | Story (wave §4) |
| --- | --- | --- |
| 1 | **Quản trị phòng họp** (Office Admin): tên · vị trí · sức chứa · thiết bị · kích hoạt/vô hiệu · xoá mềm | RM-01 |
| 2 | **Đặt phòng** theo khung giờ, chọn người tham dự; **trùng lịch bị chặn** (409 kèm khung bận + gợi ý giờ trống) | RM-02 |
| 3 | **Huỷ lịch** của mình; Office Admin huỷ mọi lịch — audit + NOTI người tham dự | RM-03 |
| 4 | **Lịch phòng** dạng ngày/tuần, cột = phòng; tìm phòng trống theo khung giờ + sức chứa | RM-04 |
| 5 | **«Đặt phòng của tôi»** (`/me/room-bookings`) | RM-05 |
| 6 | **Nhắc lịch trước 15 phút** qua NOTI (system job) | RM-06 |
| 7 | **Lịch sử sử dụng phòng** + thống kê giờ dùng/số lượt theo phòng | RM-07 |
| 8 | Widget DASH «lịch họp hôm nay» | RM-08 |

### 5.2 Ngoài v1 (chừa thiết kế, KHÔNG làm đợt này)

- **Luồng duyệt đặt phòng** (ROOM-DEC-002) — cột `requires_approval` chừa sẵn; v1 phòng bật cờ này **không đặt được**.
- **Recurring booking** · đồng bộ Google/Outlook Calendar (PARK-ROOM-002) (ROOM-DEC-003).
- **Sửa lượt đặt** (đổi giờ/phòng/người tham dự) — v1 = **huỷ rồi đặt lại**; không có `PATCH /room-bookings/:id` (giữ FSM 2 trạng thái + EXCLUDE đơn giản; thêm sau phải cấp `ROOM-API-014+`).
- Check-in phòng / tự huỷ khi không ai đến · màn hình hiển thị ngoài cửa phòng · dịch vụ kèm (trà nước, kỹ thuật) · phòng ảo/link họp online (cột `is_virtual` di sản **bị gỡ**).
- **Lượt riêng tư / ẩn tiêu đề** với người ngoài danh sách tham dự (PARK-ROOM-003) — v1 mọi tiêu đề công khai trong company (§18 ghi nhận rủi ro).
- Biên bản cuộc họp, action-item gắn cuộc họp (đúng phần bị DROP của hub G10 — nếu quay lại là module khác, không phải ROOM).

### 5.3 Di sản được xử lý dứt điểm

Wave này **tái dụng 1 bảng, tạo 2 bảng, DROP 4 bảng** (§3.4). Sau `S11-ROOM-DB-1`, trong DB **không** còn `meetings`/`meeting_attendees`/`meeting_notes`/`meeting_tasks`, `apps/api/src/db/schema/meeting.ts` được thay bằng `rooms.ts`, `rls-registry` và `cleanupTenants` đổi theo.

---

## 6. Nhóm người dùng

| Nhóm | Vai trò trong ROOM |
| --- | --- |
| **Office Admin** (SPEC-01 §10.9 — role hệ thống **mới** `office-admin`) | Quản trị phòng (CRUD · kích hoạt/vô hiệu) · đặt hộ (chỉ định `organizerUserId`) · huỷ **mọi** lịch · xem thống kê sử dụng, phạm vi **Company** |
| Company Admin | Như Office Admin |
| Nhân viên · Trưởng đơn vị · HR (employee / manager / hr) | Xem **toàn bộ** lịch phòng công ty (lịch là dữ liệu dùng chung), đặt phòng cho **chính mình**, huỷ lịch **mình tổ chức**, «đặt phòng của tôi» |
| Super Admin | Nhận mọi cặp qua `SuperAdminBootstrapService` — **không** phải chủ thể để test (tautology) |

---

## 7. Mối liên kết với các module khác

| Module | ROOM đọc / gọi | Module kia đọc ROOM |
| --- | --- | --- |
| AUTH (SPEC-02) | RBAC per-pair + data_scope; `users` (organizer · attendees · `*_by`) — chỉ user `active` cùng company | — |
| HR (SPEC-03) | Danh bạ nhân viên để chọn người tham dự (FE gọi HR, ROOM chỉ nhận `userId`) | — |
| FOUNDATION | `audit_logs`, `system_jobs` (job nhắc lịch), `@Idempotent()` | — |
| NOTI (SPEC-08) | Outbox bridge: `ROOM_BOOKING_CONFIRMED` · `ROOM_BOOKING_CANCELLED` · `ROOM_BOOKING_REMINDER` (§17) | — |
| DASH (SPEC-07) | — | Widget «lịch họp hôm nay» đọc `GET /me/room-bookings?date=today` theo quyền (§15) |
| ME (SPEC-09) | — | Mục «Đặt phòng của tôi» trong `/me` gọi `GET /me/room-bookings` |
| CHAT (SPEC-15) | — | Không liên kết ở v1 (`chat_rooms` là khái niệm khác — không đụng tên) |

---

## 8. Cấu trúc thông tin

Chi tiết cột/kiểu/constraint: [DB-16](<../DB/DB-16 ROOM Database Design.md>). Ba bảng, tất cả có `company_id` + RLS FORCE + composite tenant FK:

**Phòng họp (`meeting_rooms` — tái dụng)**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Định danh | `name`, `location`, `description` | `name` unique theo company (không phân biệt hoa/thường) trên hàng còn sống |
| Năng lực | `capacity`, `equipment[]` | `capacity` > 0 bắt buộc; `equipment` = mảng chuỗi tự do (`TV` · `Bảng trắng` · `Zoom Rooms`…), tối đa 20 mục |
| Chính sách | `requires_approval`, `is_active`, `sort_order` | `requires_approval=true` ⇒ v1 từ chối đặt (ROOM-ERR-004); `is_active=false` ⇒ ẩn khỏi form đặt, vẫn xem lịch sử |
| Vòng đời | `created_*`, `updated_*`, `deleted_at/by` | soft delete; **không** xoá/vô hiệu khi còn lịch `Confirmed` chưa kết thúc (ROOM-ERR-008) |

**Lượt đặt phòng (`room_bookings` — mới)** — sổ lịch sử, **không xoá**

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `room_id` | composite FK, **NOT NULL** (khác `meetings.meeting_room_id` nullable) |
| Nội dung | `title`, `description` | |
| Thời gian | `starts_at`, `ends_at` | `[starts_at, ends_at)`, EXCLUDE GIST chống giao nhau khi `Confirmed` |
| Người | `organizer_user_id`, `booked_by_user_id` | organizer = người chủ trì (mặc định = người gọi); `booked_by` = người thao tác (khác organizer khi Office Admin đặt hộ) |
| Trạng thái | `status` (`Confirmed` / `Cancelled`) | `Completed` dẫn xuất (§3.2) |
| Huỷ | `cancelled_at`, `cancelled_by`, `cancel_reason` | chỉ các cột này (+`updated_*`) được UPDATE (column-level GRANT) |

**Người tham dự (`room_booking_attendees` — mới)** — cố định lúc đặt, **không xoá/sửa** ở v1

| Nhóm | Trường | Ghi chú |
| --- | --- | --- |
| Neo | `booking_id`, `user_id` | unique `(booking_id, user_id)`; organizer **không** nằm trong bảng này (ngầm định là người tham dự) |

---

## 9. Danh sách màn hình

| Mã | Màn hình | Ghi chú |
| --- | --- | --- |
| ROOM-SCREEN-001 | Lịch phòng (`/rooms`) | Ngày/tuần; **cột = phòng** (kèm sức chứa), hàng = giờ; kéo chọn khung trống mở màn 002; khung bận hiện tiêu đề + người tổ chức; bộ lọc phòng/sức chứa tối thiểu; nút «+ Đặt phòng» theo quyền |
| ROOM-SCREEN-002 | Form đặt phòng (dialog từ 001) | Chọn phòng (chỉ `is_active` + không `requires_approval`), chủ đề (dòng nhắc «tiêu đề hiển thị cho toàn công ty» — §18), khung giờ, người tham dự từ danh bạ HR (tối đa 50), Office Admin có thêm «Đặt hộ cho»; **kiểm trùng trước ở client** (từ dữ liệu lịch đã tải) + xử lý lỗi server **theo `error.code`, không theo HTTP status**: `ROOM-ERR-001` ⇒ khung bận + «Còn trống từ …»; `IN_PROGRESS` ⇒ "đang gửi, chờ"; `KEY_REUSED` ⇒ sinh khoá mới rồi gửi lại; không mất form. FE **sinh `Idempotency-Key` mới** khi mở form, sau mỗi lần gửi thành công và sau `KEY_REUSED` |
| ROOM-SCREEN-003 | «Đặt phòng của tôi» (`/me/room-bookings`) | Gắn khu vực ME; tab **Sắp tới** ‖ **Đã qua** ‖ **Đã huỷ**; vai trò (tổ chức / tham dự); nút Huỷ chỉ với lịch mình tổ chức chưa kết thúc |
| ROOM-SCREEN-004 | Quản trị phòng họp (`/rooms/manage`) | `('manage','room')`; bảng tên · sức chứa · thiết bị · vị trí · trạng thái; form tạo/sửa; vô hiệu/xoá bị chặn khi còn lịch (ROOM-ERR-008); tab **Lịch sử sử dụng** (usage-summary theo khoảng ngày + danh sách lượt đã qua) |
| ROOM-SCREEN-005 | Chi tiết lượt đặt (drawer từ 001/003/004) | Phòng · giờ · người tổ chức · người tham dự · trạng thái (kể cả `Completed` dẫn xuất) · nút **Huỷ** theo quyền + điều kiện (không hiện nút mà server sẽ trả 409/403) |

Mọi màn: `<PermissionGate>` + `useCan()`, trạng thái loading/error/empty (§14), i18n vi namespace `room`, nhãn trạng thái dùng constants chuẩn SPEC-01 §17.10. FE thêm **5 mã dotted `ROOM.*`** (§11) vào `PERMISSION_CODE_TO_PAIR` (`packages/web-core/src/lib/registry.ts`) — bảng fail-closed, thiếu là toàn bộ màn ROOM ẩn dù DB đã grant.

---

## 10. Chi tiết chức năng

| Mã | Chức năng | Mô tả ngắn |
| --- | --- | --- |
| ROOM-FUNC-001 | Quản trị phòng họp | CRUD phòng; `name` unique (ROOM-ERR-009); vô hiệu (`is_active=false`) / xoá mềm chỉ khi **không** còn lịch `Confirmed` có `ends_at > now()` (ROOM-ERR-008) — kiểm **sau khi `SELECT … FROM meeting_rooms WHERE company_id = $c AND id = $1 FOR UPDATE`** trong cùng transaction (khoá cùng hàng với FUNC-003 để "vô hiệu" ‖ "đặt" không đua nhau — §13.2); audit |
| ROOM-FUNC-002 | Tìm phòng trống | `GET /rooms/availability?from&to&capacityMin` — phòng `is_active`, không `requires_approval`, sức chứa đủ, **không** có lượt `Confirmed` giao `[from, to)` |
| ROOM-FUNC-003 | Đặt phòng | kiểm giờ (ROOM-ERR-002) → phòng nhận đặt (ROOM-ERR-004) → organizer/attendees hợp lệ (ROOM-ERR-006/010) → sức chứa (ROOM-ERR-007) → **kiểm trùng** (ROOM-ERR-001) → INSERT lượt `Confirmed` + attendees (EXCLUDE là chốt cuối, `23P01` → ROOM-ERR-001) → audit → outbox `ROOM_BOOKING_CONFIRMED`. Một transaction |
| ROOM-FUNC-004 | Huỷ lượt đặt | `Confirmed → Cancelled`, `cancel_reason` tuỳ chọn; chỉ khi `ends_at > now()` (ROOM-ERR-005); Own = organizer, Company = bất kỳ; audit → outbox `ROOM_BOOKING_CANCELLED` |
| ROOM-FUNC-005 | Lịch phòng | theo phòng (`/rooms/:id/bookings`) hoặc tất cả phòng (`/room-bookings`) trong `[from, to)` ≤ 31 ngày; mặc định chỉ `Confirmed`; trả `isCompleted` |
| ROOM-FUNC-006 | Chi tiết lượt đặt | phòng + organizer + attendees (JOIN tên) + `isCompleted` + `canCancel` (server tính theo quyền/scope/thời gian) |
| ROOM-FUNC-007 | Đặt phòng của tôi | user từ token; `role = organizer \| attendee \| all`; `date` hoặc `from/to`; `includeCancelled` |
| ROOM-FUNC-008 | Nhắc lịch trước 15 phút | `@SystemJobHandler` `ROOM_BOOKING_REMINDER`: mỗi nhịp quét lượt `Confirmed` có `starts_at ∈ (now, now + 15′]`, phát cho organizer ∪ attendees, `dedupe_key` thật = `ROOM_BOOKING_REMINDER:{bookingId}:{startsAt ISO}` (§17) |
| ROOM-FUNC-009 | Lịch sử sử dụng & thống kê | `GET /rooms/usage-summary?from&to`: theo phòng — số lượt `Confirmed` **có `starts_at ∈ [from, to)`** (không chỉ "đã qua" — cửa sổ do người xem chọn, đính chính 30/08/2026 theo API-15 ROOM-API-004), tổng giờ (chỉ `Confirmed`), số lượt huỷ; gồm cả phòng vô hiệu/xoá mềm nếu có lượt trong cửa sổ; nguồn cho tab lịch sử màn 004 |
| ROOM-FUNC-010 | Trạng thái dẫn xuất | `isCompleted = status = 'Confirmed' AND ends_at ≤ now()` tính ở **server** trong mọi DTO; FE không tự suy từ đồng hồ máy |

---

## 11. Permission đề xuất — **ĐÃ CHỐT cùng gói duyệt 28/08/2026**

Theo chuẩn per-pair `(action, resource)` + data_scope per-(permission, role). Module `ROOM` đứng riêng. Bảng dưới là **cặp engine thực thi**; mã dotted `ROOM.RESOURCE.ACTION` (SPEC-01 §9.5) chỉ là tên hiển thị.

| Cặp quyền | Mã hiển thị | Ý nghĩa | Nhân viên · Trưởng đơn vị · HR | Office Admin · BOD/Admin |
| --- | --- | --- | --- | --- |
| `('access','room')` | `ROOM.ACCESS` | cổng nav menu Phòng họp | có (Own) | có (Own) |
| `('view','room')` | `ROOM.ROOM.VIEW` | xem phòng · **lịch mọi phòng** (tất cả lượt trong company) · phòng trống · chi tiết lượt · thống kê · **`/me/room-bookings`** | **Company** | Company |
| `('book','room')` | `ROOM.BOOKING.CREATE` | tạo lượt đặt | **Own** (organizer = chính mình) | **Company** (được đặt hộ — `organizerUserId`) |
| `('cancel','room-booking')` | `ROOM.BOOKING.CANCEL` | huỷ lượt đặt | **Own** (lượt mình tổ chức) | **Company** (mọi lượt) |
| `('manage','room')` | `ROOM.ROOM.MANAGE` | CRUD phòng · kích hoạt/vô hiệu · xoá mềm | — | Company |

Ghi chú bắt buộc:

- **Đúng 5 cặp, `is_sensitive = false` cho cả 5** — chốt cùng seed. Lịch phòng là **dữ liệu dùng chung** của công ty: tiêu đề · giờ · người tổ chức · người tham dự **không** thuộc danh sách nhạy cảm SPEC-01 §11.3 — ai cũng xem được toàn bộ lịch để biết phòng bận (đúng bản chất "kiểm tra trùng lịch" ở §12.11). Vì vậy `('view','room')` là **Company cho mọi role** — đây là **tinh chỉnh** so với hồ sơ HTML (dự kiến tách `ROOM.BOOKING.VIEW` own/all): tách cặp đọc thành hai sẽ đẻ ra role "thấy lịch phòng mà không mở được chi tiết lượt" — họ lỗi `read-path-gate-pair-must-match-download-pair`.
- **`('cancel','room-booking')` scope Company thay cho `ROOM.BOOKING.MANAGE`** của hồ sơ HTML — cùng một hành động, khác phạm vi; không cần cặp riêng.
- **Data scope ở cặp GHI** là ràng buộc thật: `book@Own` ⇒ `organizerUserId` (nếu gửi) phải bằng user gọi, khác ⇒ **403 ROOM-ERR-010**; `cancel@Own` ⇒ chỉ lượt có `organizer_user_id = caller`, lượt của người khác ⇒ **403** `AUTH-ERR-SCOPE-DENIED` (lịch là dữ liệu công khai trong company nên **không** cần 404 che sự tồn tại như ASSET; **cross-tenant** vẫn 404 ROOM-ERR-003).
- **Role `office-admin` là role hệ thống MỚI** (`roles.company_id IS NULL`, `is_system = true`, `requires_two_factor = false` khai tường minh; tiền lệ `hr-manager` mig `0019`, `asset-manager` DB-15), giữ **cả 5 cặp** (`access`@Own, còn lại @Company). Nó **không** phải role canonical — 4 role canonical vẫn là `employee` · `manager` · `hr` · `company-admin`; WO DB **không** thêm nó vào các enumerate canonical, pin `auth-seed-canonical-roles` chỉ kiểm 4 role kia.
- Data scope ép ở **service layer**, **không** phải RLS (RLS chỉ cô lập tenant).
- **Ma trận grant = 22 hàng**: `employee` 4 · `manager` 4 · `hr` 4 (`access`@Own, `view`@Company, `book`@Own, `cancel`@Own) · `company-admin` 5 · `office-admin` 5 (`access`@Own, 4 cặp còn lại @Company). Xem permission-matrix §9e.

---

## 12. Quy tắc nghiệp vụ và mã lỗi

| Mã lỗi | HTTP | Quy tắc |
| --- | --- | --- |
| ROOM-ERR-001 | 409 | **Trùng lịch**: đã có lượt `Confirmed` trên phòng giao `[startsAt, endsAt)`. `details.conflicts[] = { bookingId, title, startsAt, endsAt, organizerName }` (chỉ các lượt giao nhau) + `details.nextFreeFrom` (mốc sớm nhất sau `startsAt` mà phòng trống đủ thời lượng yêu cầu, hoặc `null`). Trả từ **cả** kiểm-trước ở service **lẫn** vi phạm EXCLUDE (`23P01` bóc từ `cause`, truy vấn lại conflicts) — cùng một phản hồi |
| ROOM-ERR-002 | 422 | **Khung giờ không hợp lệ** — `details.kind`: `end-before-start` (`endsAt ≤ startsAt`) · `in-past` (`startsAt < now() − 5 phút`) · `too-short` (< 15 phút) · `too-long` (> 8 giờ — hằng `ROOM_BOOKING_MAX_HOURS`) · `too-far` (`startsAt > now() + 90 ngày`) · `range-too-wide` (truy vấn lịch `[from, to)` > 31 ngày hoặc `to ≤ from`) |
| ROOM-ERR-003 | 404 | Sentinel `ROOM-ERR-NOT-FOUND`: phòng / lượt đặt **không thuộc company** hoặc không tồn tại (kể cả phòng đã xoá mềm ở mọi route trừ lịch sử) — **cùng một phản hồi** (chống dò chéo tenant) |
| ROOM-ERR-004 | 409 | **Phòng không nhận đặt** — `details.kind`: `room-inactive` (`is_active=false`) · `approval-not-supported` (`requires_approval=true`, ROOM-DEC-002 — v1 chưa có luồng duyệt) |
| ROOM-ERR-005 | 409 | **Huỷ không hợp lệ** — `details.kind`: `already-cancelled` · `already-ended` (`ends_at ≤ now()` — lượt đã `Completed` là lịch sử, không huỷ được) |
| ROOM-ERR-006 | 422 | **Người tham dự không hợp lệ** — `details.kind`: `attendee-not-found` (user không tồn tại **hoặc** không thuộc company — cùng một mã, không thành oracle) · `attendee-inactive` (`users.status ≠ 'active'`) · `attendee-duplicate` (trùng trong danh sách, hoặc trùng organizer) · ~~`too-many-attendees` (> 50)~~ **⇒ xem đính chính bên dưới: trên dây là 400, không phải 422** |
| ROOM-ERR-007 | 422 | **Vượt sức chứa**: `1 + attendees.length > capacity` — `details = { capacity, headcount }` |
| ROOM-ERR-008 | 409 | **Phòng còn lịch**: vô hiệu (`is_active=false`) hoặc xoá mềm phòng khi còn lượt `Confirmed` có `ends_at > now()` — `details = { upcomingCount }`; Office Admin phải huỷ (có NOTI người tham dự) trước |
| ROOM-ERR-009 | 409 | Tên phòng trùng (không phân biệt hoa/thường) với phòng **còn sống** trong company — `details.kind = name-taken` (phòng đã xoá mềm **được** dùng lại tên) |
| ROOM-ERR-010 | 403 / 422 | Đặt hộ: gửi `organizerUserId ≠` user gọi khi scope `book` là **Own** → **403** (`details.kind = book-on-behalf-denied`); scope Company nhưng organizer không tồn tại / không thuộc company / không `active` → **422** (`details.kind = organizer-not-found` / `organizer-inactive`) |

> **Hình dạng `details` trên dây (đính chính `S11-ROOM-BE-1`, 30/08/2026):** envelope lỗi chung chỉ cho `details` đi ra khi là **mảng `ErrorDetail { field, message, rule }`** (API-01 · `AllExceptionsFilter`). `details.kind` ở bảng trên = phần tử `{ field: "kind", message: "<kind>", rule: "room" }`; `capacity`/`headcount`/`upcomingCount`/`userId` là phần tử cùng hình; ROOM-ERR-001 gửi `conflicts` (chuỗi JSON, ≤ 20 lượt) + `nextFreeFrom` (ISO hoặc `"null"`) — FE bóc bằng `parseRoomConflictsDetail()` (`@mediaos/contracts`). Xem API-15 §7.4. `attendee-not-found`/`organizer-not-found` bao gồm cả user **đã xoá mềm** (`users.deleted_at IS NOT NULL`) — cùng một mã, không thành oracle.

> **Đính chính `too-many-attendees` (S11-ROOM-QA-1, 30/08/2026) — đo được, không suy luận.** Trần 50 người
> tham dự bị gác ở **hai tầng đúng bằng nhau**: `attendeeUserIds: z.array(...).max(ROOM_MAX_ATTENDEES)` ở
> `packages/contracts/src/room.ts` (BIÊN) và `attendees.length > ROOM_MAX_ATTENDEES` ở
> `room-bookings.service.ts` (tầng hai). Vì hai ngưỡng bằng nhau và controller là caller **duy nhất** của
> `RoomBookingsService.create`, nhánh service **không thể chạm tới qua HTTP**: `ZodValidationPipe` trả
> **`400 VALIDATION-ERR-001`** (`details[].field = "attendeeUserIds"`, `rule = "too_big"`) trước. Vậy
> `too-many-attendees` **không** phải một `kind` của ROOM-ERR-006 trên dây — FE phải rẽ nhánh theo
> `VALIDATION-ERR-001`, không chờ 422. Giữ nguyên **cả hai** tầng: trần ở biên chặn mảng khổng lồ trước khi
> bất kỳ việc gì chạy; nhánh service là tầng hai cho caller không qua pipe. Ca canh:
> `s11-room-qa1-error-residue.int-spec.ts` mục B; census `room-error-code-census.unit-spec.ts` xếp kind này
> vào `BOUNDARY_ONLY` và sẽ ĐỎ nếu một ngày nhánh service ra được dây.

Quy tắc bổ sung (không cần mã riêng):

- `/me/room-bookings` **không nhận tham số người dùng** — user resolve từ token (chống IDOR, chuẩn SPEC-09 §14.4).
- **Không có `PATCH` lượt đặt** ở v1 (§5.2) — muốn đổi giờ/phòng: huỷ rồi đặt lại. Người tham dự cố định lúc đặt.
- Organizer **ngầm định là người tham dự** (không chèn vào `room_booking_attendees`); `headcount = 1 + attendees`.
- `POST /room-bookings` gắn `@Idempotent()` dùng chung (BACKEND-12 §14.1): header `Idempotency-Key` **do FE sinh một lần khi mở form** (cùng quyết định với ASSET-API-010 — khoá suy từ payload sẽ **phát lại** lượt vừa huỷ khi người dùng "huỷ rồi đặt lại y hệt trong 15′"); TTL 15 phút, header không bắt buộc ở interceptor, replay = phát lại envelope + header `Idempotency-Replayed: true`. Chống trùng **nghiệp vụ** là việc của EXCLUDE, không phải của idempotency.
- Huỷ lượt **đang diễn ra** (`starts_at ≤ now() < ends_at`) **được phép** (trả phòng sớm); huỷ lượt đã kết thúc thì không (ROOM-ERR-005).
- Phòng `is_active=false`/đã xoá mềm **vẫn hiện** trong lịch sử và chi tiết lượt cũ (JOIN không lọc `deleted_at`) — chỉ ẩn khỏi form đặt và `availability`.
- Mọi mutation (tạo/sửa/vô hiệu/xoá phòng · đặt · huỷ) ghi `audit_logs` (`object_type = meeting_room` / `room_booking`); payload audit chỉ id + hành động + trạng thái trước/sau + khung giờ.

---

## 13. Lõi nghiệp vụ

### 13.1 FSM lượt đặt phòng

| Từ ↓ / Tới → | `Confirmed` | `Cancelled` |
| --- | --- | --- |
| **(tạo mới)** | đặt phòng (FUNC-003) | ✗ |
| **`Confirmed`** | — | huỷ (FUNC-004) — chỉ khi `ends_at > now()` |
| **`Cancelled`** | ✗ | — |

- Mọi ô ✗ ⇒ **ROOM-ERR-005** (409) — không có "khôi phục lượt đã huỷ" (đặt lại là lượt mới, EXCLUDE kiểm lại).
- `Completed` **không** phải trạng thái lưu: `isCompleted` = `status = 'Confirmed' AND ends_at ≤ now()`; lượt `Completed` **không** huỷ được (ROOM-ERR-005 `already-ended`).
- DB chỉ CHECK tập giá trị + CHECK cặp huỷ (`Cancelled ⇔ cancelled_at IS NOT NULL`); chuyển tiếp ép ở service trong cùng transaction (`SELECT … FOR UPDATE` hàng lượt đặt).

### 13.2 Đặt phòng — thứ tự kiểm và chốt cuối

1. **Giờ** (ROOM-ERR-002): `endsAt > startsAt` · `startsAt ≥ now() − 5′` · 15′ ≤ thời lượng ≤ 8h · `startsAt ≤ now() + 90 ngày`.
2. **Phòng** (ROOM-ERR-003/004): `SELECT … FROM meeting_rooms WHERE company_id = $c AND id = $r FOR UPDATE` **trong transaction đặt phòng** — tồn tại, `deleted_at IS NULL`, `is_active`, không `requires_approval`. `FOR UPDATE` là bắt buộc: FUNC-001 (vô hiệu/xoá phòng) cũng khoá đúng hàng này ⇒ hai giao dịch "vô hiệu phòng" ‖ "đặt phòng" tuần tự hoá, không thể vừa `is_active=false` vừa nhận thêm lượt `Confirmed` tương lai (EXCLUDE **không** cứu ca này).
3. **Organizer** (ROOM-ERR-010): mặc định = caller; `organizerUserId` chỉ được honour khi scope `book` = Company.
4. **Người tham dự** (ROOM-ERR-006): distinct, ≠ organizer, ≤ 50, mỗi người là `users` active cùng company (một truy vấn `WHERE id = ANY($1)` — đếm khớp, không N+1).
5. **Sức chứa** (ROOM-ERR-007).
6. **Kiểm trùng** (ROOM-ERR-001): `SELECT … FROM room_bookings WHERE company_id = $c AND room_id = $r AND status = 'Confirmed' AND tstzrange(starts_at, ends_at, '[)') && tstzrange($s, $e, '[)')` — có hàng ⇒ 409 kèm `conflicts` + `nextFreeFrom`.
7. **INSERT** lượt + attendees + audit + outbox **trong một transaction**; vi phạm `room_bookings_no_overlap_excl` (`23P01`, drizzle bọc trong `cause`) ⇒ truy vấn lại conflicts ⇒ **409 ROOM-ERR-001**, không 500.

`nextFreeFrom` = mốc sớm nhất `≥ startsAt` sao cho `[mốc, mốc + thời lượng)` không giao lượt `Confirmed` nào trong ngày (tính trên các lượt đã tải của phòng trong `[startsAt, startsAt + 1 ngày)`); không có ⇒ `null`. Gợi ý **không** kiểm sức chứa/giờ làm việc — chỉ là gợi ý.

### 13.3 Huỷ

- Quyền: `('cancel','room-booking')` — scope Own ⇒ `organizer_user_id = caller`; Company ⇒ bất kỳ. Ngoài scope ⇒ **403** (lịch là công khai trong company).
- Điều kiện: `status = 'Confirmed'` và `ends_at > now()` (ROOM-ERR-005). Một câu `UPDATE … SET status, cancelled_at, cancelled_by, cancel_reason, updated_* WHERE company_id = $c AND id = $1 AND status = 'Confirmed' AND ends_at > now()` (bất biến #1 — `company_id` ở mọi query dù RLS đã đỡ) — 0 hàng ⇒ đọc lại để chọn `kind` (CHECK cặp huỷ buộc một câu UPDATE, DB-16 §6.2).
- Audit + outbox `ROOM_BOOKING_CANCELLED` (người nhận: organizer ∪ attendees, trừ actor — engine tự loại actor vì `isSystemEvent=false`).

### 13.4 Lịch và phòng trống

- `GET /room-bookings?from&to` / `GET /rooms/:id/bookings?from&to`: `[from, to)` bắt buộc, ≤ 31 ngày (ROOM-ERR-002 `range-too-wide`); lọc lượt có `tstzrange(starts_at, ends_at) && tstzrange(from, to)`; mặc định `status=Confirmed`, `status=all` để xem cả huỷ (lịch sử). Trả **phẳng** (không phân trang) trong cửa sổ ≤ 31 ngày — một tuần × 20 phòng × 10 lượt/ngày ≈ 1.400 hàng là trần thực tế; FE nhóm theo phòng.
- `GET /rooms/availability?from&to&capacityMin&equipment[]`: phòng `is_active`, không `requires_approval`, `capacity ≥ capacityMin`, chứa mọi `equipment[]` yêu cầu, **NOT EXISTS** lượt `Confirmed` giao `[from, to)`. Luật giờ áp cho `availability` **chỉ** là `end-before-start` và `too-long` (> 8h) của ROOM-ERR-002 — **không** áp `in-past`/`too-short`/`too-far` (đây là tra cứu, không phải đặt).

### 13.5 Nhắc lịch — ROOM-DEC-004

- `RoomBookingReminderJobHandler` (`@SystemJobHandler()`; dep `DatabaseService` · `RoomAudienceReader` · `NotificationEngineService` đều là provider thật ⇒ **không cần `@Optional()`** — đính chính 30/08/2026, cùng khuôn `AssetMaintenanceDueJobHandler`), jobCode `ROOM_BOOKING_REMINDER`, chạy theo nhịp `SYSTEM_JOBS_POLL_MS` của `WorkerSchedulerService` (không cần cron riêng); "throttle theo `companyId`" = scheduler đã lặp `run({ companyId })` từng công ty, handler tự `withTenant(companyId)` (worker policy chỉ theo GUC + FORCE — không scan trần, không policy `USING(true)`); `LIMIT 500`/nhịp.
- Mỗi nhịp: `SELECT` lượt `Confirmed` có `starts_at > now() AND starts_at ≤ now() + interval '15 minutes'` (index `idx_room_bookings_company_start` — `idx_room_bookings_room_start` có `room_id` ở cột 2 nên không khớp tiền tố; đính chính 30/08/2026), materialize **rồi** gọi `intake()` (không lồng `withTenant`, chốt của `AttendanceAlertNotiJobHandler`). 0 người nhận (organizer đã xoá) ⇒ WARN + bỏ qua, run vẫn OK; chỉ `failed` khi `intake()` ném.
- Người nhận = organizer ∪ attendees (mode `UserIds`); `dedupeKey` truyền thô `{bookingId}:{startsAt ISO}`, engine ghép thành `ROOM_BOOKING_REMINDER:{bookingId}:{startsAt ISO}` (giá trị lưu thật — §17) — một lượt nhắc đúng một lần (catalog `dedupe_strategy='DedupeKey'`); lượt đặt trong vòng < 15′ trước giờ họp được nhắc ở nhịp kế tiếp.
- Không có cột "đã nhắc" — dedupe ở tầng NOTI là đủ (cột ghi-rồi-bỏ là thứ để gỡ).

### 13.6 Data scope

| Cặp | Own | Company |
| --- | --- | --- |
| `view` | — (không role nào ở Own; role tuỳ biến cấp `view` hẹp hơn Company ⇒ đường đọc **từ chối 403 `AUTH-ERR-SCOPE-DENIED`** — fail-closed, không "coi như" Company; đính chính 30/08/2026, security gate M4) | toàn bộ phòng + lượt trong company |
| `book` | organizer = caller | organizer tuỳ chọn (`organizerUserId`) |
| `cancel` | lượt `organizer_user_id = caller` | mọi lượt |
| `manage` | — | mọi phòng |

`/me/room-bookings` là **bộ lọc** (organizer hoặc attendee = caller) trên cặp `view`, không phải scope riêng.

Tên người (`displayName` + `employeeCode`) trong MỌI DTO/`conflicts[]` được **gác bởi cặp `view`** (điểm chiếu danh tính duy nhất `room-people.repository.ts`, basis `identity-gated`): route ghi (`book`/`cancel`) resolve `view` KHÔNG ném — actor có `book` mà không có `view` (role tuỳ biến) vẫn đặt được nhưng chỉ thấy tên **chính mình**; tên/mã người khác về `null` và `conflicts[].title` thay bằng `"(đã có lịch)"` (đính chính 30/08/2026, security gate H1/M2/M3).

---

## 14. Trạng thái UI bắt buộc

Mọi màn ROOM phải xử lý: **loading** (skeleton lịch/bảng) · **error** (thông điệp + thử lại) · **empty** ("chưa có phòng họp nào" — Office Admin thấy nút thêm; lịch trống = ô trống kéo được; «đặt phòng của tôi» rỗng = "bạn chưa có lịch nào") · **không có quyền** (ẩn bằng `<PermissionGate>`) · **lỗi khi đặt rẽ nhánh theo `error.code`, không theo HTTP status** — `ROOM-ERR-001` (khung bận + «Còn trống từ …», giữ nguyên form) ‖ `IN_PROGRESS` (đang gửi) ‖ `KEY_REUSED` (sinh khoá mới, gửi lại) ‖ `INVALID_KEY` (lỗi FE, sinh lại) — cả ba mã sau đều là 409 của interceptor idempotency dùng chung · **409/403 khi huỷ** (tải lại chi tiết) · **nút Huỷ chỉ hiện khi `canCancel`** từ server · **múi giờ**: mọi giờ hiển thị theo `companies.timezone`, ghi rõ ở tiêu đề lịch.

---

## 15. Yêu cầu API cấp SPEC

Envelope/error/pagination theo API-01. Chi tiết: [API-15](<../API Design/API-15_ROOM_API_Design.md>). Mọi `:id` là **UUID** ở biên (pipe cấp method, **không** `@UsePipes` cấp class — `nestjs-zod-class-level-pipe-does-nothing`).

| Mã | Endpoint | Cặp quyền | Ghi chú |
| --- | --- | --- | --- |
| ROOM-API-001 | `GET /rooms` | `('view','room')` | danh sách phòng; mặc định `is_active` + chưa xoá; `?includeInactive=true` (màn 004); filter `capacityMin` · `q` |
| ROOM-API-002 | `POST /rooms` | `('manage','room')` | `{ name, location?, capacity, equipment?[], description?, requiresApproval?, sortOrder? }`; ROOM-ERR-009; audit |
| ROOM-API-003 | `GET /rooms/availability` | `('view','room')` | `?from&to&capacityMin?&equipment[]?` — phòng trống (FUNC-002). Route khai **trước** `/rooms/:id` |
| ROOM-API-004 | `GET /rooms/usage-summary` | `('view','room')` | `?from&to` (≤ 366 ngày): theo phòng — `bookingsCount` · `hoursBooked` · `cancelledCount` (FUNC-009). Route khai **trước** `/rooms/:id` |
| ROOM-API-005 | `GET /rooms/:id` | `('view','room')` | chi tiết phòng + `upcomingCount`; phòng đã xoá mềm → 404 |
| ROOM-API-006 | `PATCH /rooms/:id` | `('manage','room')` | sửa thuộc tính + `isActive`; `isActive=false` khi còn lịch → ROOM-ERR-008; audit |
| ROOM-API-007 | `DELETE /rooms/:id` | `('manage','room')` | xoá mềm; ROOM-ERR-008; audit |
| ROOM-API-008 | `GET /rooms/:id/bookings` | `('view','room')` | `?from&to&status=Confirmed\|Cancelled\|all` — lịch + lịch sử một phòng (FUNC-005); phòng đã xoá mềm **vẫn** trả lịch sử |
| ROOM-API-009 | `GET /room-bookings` | `('view','room')` | `?from&to&roomId[]?&organizerUserId?&status?` — lịch mọi phòng (màn 001 tuần) |
| ROOM-API-010 | `POST /room-bookings` | `('book','room')` | `{ roomId, title, startsAt, endsAt, description?, attendeeUserIds?[], organizerUserId? }`; `@Idempotent()` (§12); audit + NOTI |
| ROOM-API-011 | `GET /room-bookings/:id` | `('view','room')` | chi tiết + `room` + `organizer` + `attendees[]` + `isCompleted` + `canCancel` |
| ROOM-API-012 | `POST /room-bookings/:id/cancel` | `('cancel','room-booking')` | `{ reason? }`; ROOM-ERR-005; ngoài scope Own → 403; audit + NOTI |
| ROOM-API-013 | `GET /me/room-bookings` | `('view','room')` (bộ lọc theo caller) | `?date=YYYY-MM-DD` **hoặc** `?from&to`; `role=organizer\|attendee\|all` (mặc định all); `includeCancelled?`; **không** nhận `userId` |

> **13 mã ROOM-API = 13 route HTTP.** Không có `PATCH /room-bookings/:id` (§5.2), không có endpoint duyệt (ROOM-DEC-002), không có endpoint recurring/ICS (ROOM-DEC-003). Thêm sau phải cấp mã mới `ROOM-API-014+` và **đo lại dải** bằng grep.

---

## 16. Dữ liệu và lưu trữ

Nguồn chuẩn: [DB-16](<../DB/DB-16 ROOM Database Design.md>). Tóm tắt:

- **1 bảng tái dụng** `meeting_rooms` (ALTER: + `equipment` · `description` · `requires_approval` · `is_active` · `sort_order` · `updated_at/by` · `deleted_by`; `capacity` NOT NULL CHECK > 0; unique tên; **DROP `is_virtual`**) · **2 bảng mới** `room_bookings` · `room_booking_attendees` — RLS + FORCE, policy literal-GUC, composite tenant FK cho **mọi** FK chéo (mẫu `0535`); `room_bookings` là **sổ không xoá** (UPDATE cấp cột huỷ), `room_booking_attendees` chỉ `SELECT, INSERT`.
- **EXCLUDE GIST** `room_bookings_no_overlap_excl` trên `(company_id, room_id, tstzrange(starts_at, ends_at, '[)')) WHERE status = 'Confirmed'` — `btree_gist` đã có từ `0052` (vẫn `CREATE EXTENSION IF NOT EXISTS` cho lane DB mới).
- **DROP 4 bảng di sản** `meeting_tasks` → `meeting_notes` → `meeting_attendees` → `meetings` (thứ tự con→cha) + `DROP FUNCTION meetings_set_updated_at()` — bước **contract** cùng WO DB, có tiền kiểm fail-loud "0 hàng" (đo 29/08/2026 = 0/0/0/0; nếu lúc chạy > 0 ⇒ **dừng**, người quyết, không tự migrate dữ liệu).
- **Seed đi kèm bắt buộc** (thiếu là 500 ngay bản ghi đầu): module `ROOM` (hàng đã tồn tại `is_active=false` — WO DB chỉ verify, **GIỮ false**; bật ở `S11-ROOM-FE-1` bằng UPDATE tường minh + gỡ pin `migration-smoke` — đính chính 29/08/2026 theo tiền lệ ASSET) · role hệ thống `office-admin` · **5 cặp** permission §11 + grant **22 hàng** (verify fail-loud) · **xoá 12 grant + xoá cứng 6 cặp** `meeting*` di sản (`permissions` không có `deleted_at`) (đo 29/08: 6 cặp × 2 grant) · `audit_logs.object_type` **UNION-ADD** `room_booking` (+ verify `meeting_room` đã có trong CHECK — TS `AUDIT_OBJECT_TYPES` có sẵn, CHECK DB đo lại lúc chạy; clone khối UNION-ADD `0550`/`0545` (neo 2 tầng — KHÔNG `0506`)) · catalog + template **3 event NOTI** §17 với **`dedupe_strategy = 'DedupeKey'`** + nới CHECK trên **CẢ HAI bảng** `notification_events` **lẫn** `notifications` (`module_code += 'ROOM'`, `notification_type += 'Room'`).
- **Teardown test:** `apps/api/test/helpers/seed.ts` `cleanupTenants()` thêm `room_booking_attendees` → `room_bookings` **TRƯỚC dòng `DELETE FROM users`** (composite FK `organizer_user_id`/`user_id` → `users` là `NO ACTION`; xoá users trước là nổ FK) — cùng commit với migration; `rls-registry.ts` **gỡ 4 entry** `meetings` · `meeting_attendees` · `meeting_notes` · `meeting_tasks` (hai entry sau vẫn `INSERT INTO meetings` trong `seedRow`), thêm 2 entry bảng mới, giữ `meeting_rooms`; gỡ khối MEETINGS khỏi `apps/api/demo-seed-full.mjs` (INSERT trong transaction trước `COMMIT` — không gỡ là demo-seed ROLLBACK toàn bộ).
- Migration nối tiếp head **THẬT** lúc chạy (`migrations/meta/_journal.json`; head lúc viết = idx 215 / `0548`; ASSET dự kiến chiếm `0549–0551` ⇒ ROOM dự kiến **`0552+`**, lane migration nối tiếp: chạy **sau** `S11-ASSET-DB-1` merge).

---

## 17. Sự kiện và thông báo

| Event code | Mã chuẩn (SPEC-01 §20.2 · SPEC-08 §15.0) | Khi nào | Người nhận | Gộp / dedupe |
| --- | --- | --- | --- | --- |
| `ROOM_BOOKING_CONFIRMED` | NOTI-EVENT-013 | lượt đặt tạo xong (commit) | organizer ∪ attendees, **trừ actor** (tự đặt ⇒ organizer không nhận; Office Admin đặt hộ ⇒ organizer nhận) | `dedupe_key` thật = `ROOM_BOOKING_CONFIRMED:{bookingId}` |
| `ROOM_BOOKING_CANCELLED` | NOTI-EVENT-014 | lượt `Confirmed → Cancelled` | organizer ∪ attendees, trừ actor | `dedupe_key` thật = `ROOM_BOOKING_CANCELLED:{bookingId}` |
| `ROOM_BOOKING_REMINDER` | NOTI-EVENT-015 | job: `starts_at ∈ (now, now + 15′]` | organizer ∪ attendees (**không** loại ai — `isSystemEvent=true`) | `dedupe_key` thật = `ROOM_BOOKING_REMINDER:{bookingId}:{startsAt ISO}` |

> Đính chính 30/08/2026 (`S11-ROOM-BE-1`): bản DOC minh hoạ `room:confirmed:{id}` — giá trị lưu thật có tiền tố `eventCode` vì `NotificationDedupeService` ghép `${eventCode}:${dedupeKey}` (cùng hành vi ASSET); registrar/job truyền khoá thô `{bookingId}` / `{bookingId}:{startsAt ISO}`. outbox `event_type` nội bộ = `room.booking.confirmed` / `room.booking.cancelled` (registrar map → `eventCode`). Tự đặt không có người tham dự ⇒ sau khi loại actor còn 0 người nhận ⇒ engine `skip(no_recipient)`, **không** dead-letter.

- `notification_type = 'Room'`, `module_code = 'ROOM'`, `priority` Normal (013) · High (014 · 015), `isEnabled=true`, `isSystemEvent` = false/false/**true**, **`dedupe_strategy='DedupeKey'`** cho cả 3 (catalog thắng `DEFAULT_DEDUPE` — không thêm entry vào `notification-dedupe.const.ts`).
- Recipient resolve **theo id có sẵn trong lượt** (mode `UserIds`) — không tra ngược quyền/role (engine không có tra ngược cặp quyền — SPEC-13 §17).
- Payload: tiêu đề · tên phòng · khung giờ (ISO + đã format theo `companies.timezone`) · tên người tổ chức · deep-link `/me/room-bookings?focus={bookingId}`; **không** có danh sách người tham dự đầy đủ trong payload (đọc ở chi tiết).
- Phát qua **OutboxNotificationBridge** (enqueue trong transaction, map `eventCode` verbatim). **Bẫy boot:** `registerSource()` fail-loud lúc boot nếu `eventCode` chưa có trong catalog `isEnabled=true` ⇒ seed (DB-16 §9 bước C) phải xong **trước** khi WO backend đăng ký registrar.
- Đo dải mã chuẩn ngày 29/08/2026: `grep NOTI-EVENT-0 docs/` dừng ở **012** (ASSET) ⇒ ROOM lấy **013–015**. Module sau đo lại trước khi cấp.

---

## 18. Audit và bảo mật

- **RLS + FORCE** theo `company_id` trên cả 3 bảng (2 bảng mới tạo policy **trước** mọi INSERT; `meeting_rooms` đã có từ `0052` — verify fail-loud); mọi repository qua `withTenant`.
- **Sổ không xoá**: `room_bookings` — app role **không có DELETE**, UPDATE **cấp cột** (`status`, `cancelled_*`, `cancel_reason`, `updated_*`); `room_booking_attendees` — **không có UPDATE/DELETE**. Lịch sử sử dụng phòng = chính bảng này.
- **Không có trường nhạy cảm** (SPEC-01 §11.3) — không masking theo scope; nhưng `users.email`/số điện thoại **không** vào DTO ROOM (chỉ `userId` · tên hiển thị · mã nhân viên nếu có). Payload WS (nếu có sau) đi cùng DTO — cấm emit thẳng row.
- **Rủi ro đã chấp nhận có chủ đích — tiêu đề lượt đặt là văn bản tự do và công khai toàn công ty** (`view@Company`): "Phỏng vấn ứng viên X", "Họp kỷ luật A" là nội dung nhạy cảm dù *trường* không nhạy cảm. v1 không có lượt riêng tư; giảm thiểu bằng (a) màn 002 hiển thị dòng nhắc dưới ô Chủ đề «tiêu đề hiển thị cho toàn công ty — dùng tiêu đề trung tính cho họp nhạy cảm» (§9, §14), (b) NOTI/deep-link không phát tiêu đề ra ngoài company. Lượt riêng tư / ẩn tiêu đề với người ngoài attendees = **PARK-ROOM-003** (Phase sau, cần cột `is_private` + masking theo attendee — §5.2).
- **404 cho cross-tenant** (ROOM-ERR-003); **403** cho ngoài scope ghi (`book`/`cancel`) vì lịch là công khai trong company; **403** khi thiếu cặp quyền.
- **Audit** mọi mutation (§12); `object_type` = `meeting_room` (phòng) / `room_booking` (lượt); action `create` · `update` · `deactivate` · `delete` · `book` · `cancel`.
- `/me/room-bookings` **không nhận** `userId` — chống IDOR.
- Đặt hộ (`organizerUserId`) là hành động có dấu vết: `booked_by_user_id` ≠ `organizer_user_id` + audit ghi cả hai.

---

## 19. Non-functional requirements

- Lịch tuần 20 phòng: một truy vấn range `[from, to)` < 200ms (index `idx_room_bookings_company_start` + GIST); FE nhóm theo phòng.
- Đặt phòng: kiểm trùng + INSERT + attendees + audit + outbox trong **một** transaction < 300ms; hai request song song cùng khung ⇒ đúng **một** thắng (int-spec race, EXCLUDE là chốt cuối).
- `availability` cho 50 phòng: một truy vấn `NOT EXISTS` (không N+1).
- Job nhắc: mỗi nhịp một truy vấn cửa sổ 15′ per-tenant; idempotent theo dedupe; không có cột trạng thái nhắc.
- i18n: nhãn qua react-i18next namespace `room`; trạng thái hiển thị từ constants chuẩn SPEC-01 §17.10; mọi giờ theo `companies.timezone`.

---

## 20. Tiêu chí nghiệm thu tổng quát

1. Office Admin tạo phòng «Mercury» sức chứa 6, thiết bị `TV`; tạo phòng trùng tên «mercury» → **409 ROOM-ERR-009**; nhân viên thường `POST /rooms` → **403**.
2. Nhân viên A đặt Mercury 09:00–10:30 → `Confirmed`; A **không** nhận `ROOM_BOOKING_CONFIRMED` (actor), người tham dự B **nhận**; B mở `/me/room-bookings` thấy lịch với vai trò `attendee`.
3. C đặt Mercury 09:30–10:30 → **409 ROOM-ERR-001** với `conflicts[0].title = "…"` của A và `nextFreeFrom = 10:30`; C đặt 10:30–11:30 → **thành công** (đầu-đóng-cuối-mở).
4. Hai request đặt **song song** cùng phòng cùng khung → đúng **một** `Confirmed`, request kia **409 ROOM-ERR-001** (không 500 — `23P01` bóc từ `cause`).
5. A đặt với 7 người tham dự vào phòng 6 chỗ → **422 ROOM-ERR-007**; đặt vào phòng `requires_approval=true` → **409 ROOM-ERR-004 approval-not-supported**; đặt 08:00–17:00 → **422 too-long**.
6. B (không phải organizer) huỷ lịch của A → **403**; A huỷ → `Cancelled`, B nhận `ROOM_BOOKING_CANCELLED`; A huỷ lần 2 → **409 already-cancelled**; Office Admin huỷ lịch của bất kỳ ai → thành công + audit ghi `cancelled_by`.
7. Lịch đã kết thúc: `isCompleted=true`, `canCancel=false`, huỷ → **409 already-ended**; nó **vẫn** xuất hiện ở `GET /rooms/:id/bookings?status=all` và usage-summary.
8. Office Admin vô hiệu Mercury khi còn lịch ngày mai → **409 ROOM-ERR-008 `upcomingCount=1`**; huỷ lịch xong → vô hiệu thành công; Mercury biến mất khỏi `availability` và form đặt, **vẫn** xem được lịch sử.
9. Đặt lịch bắt đầu sau 10′ → nhịp job kế phát **đúng một** `ROOM_BOOKING_REMINDER` cho organizer + mỗi attendee; chạy job lần 2 → 0 thông báo mới.
10. Cross-tenant: mọi endpoint deny dữ liệu company khác bằng **404** (int-spec bắt buộc, `LANE_DB`); deny-path từng cặp trong 5 cặp → 403 với **chủ thể = role dựng trong test**, không dùng Super Admin.
11. Sau migration: `meetings`/`meeting_attendees`/`meeting_notes`/`meeting_tasks` **không tồn tại**; 6 cặp `meeting*` `deleted_at IS NOT NULL`, 0 grant; `rls-tenant-isolation-tester` xanh cho 3 bảng ROOM.

---

## 21. Test scenario cấp cao

| Nhóm | Scenario |
| --- | --- |
| Deny-path (RED trước) | thiếu từng cặp trong 5 cặp → 403 trên endpoint tương ứng; `book@Own` gửi `organizerUserId` khác → 403 ROOM-ERR-010; `cancel@Own` lượt người khác → 403; cross-tenant mọi endpoint → 404; `/me/room-bookings?userId=` bị bỏ qua/400. Ca đối chứng ALLOW cho từng scope để ca DENY không xanh rỗng |
| Trùng lịch | giao nhau đầu/cuối/bao trùm/bị bao trùm → 409; kề nhau (`[)`) → OK; lượt `Cancelled` **không** chặn; khác phòng cùng giờ → OK; **race 2 request song song → 1 thắng** (EXCLUDE, map 23P01 → 409) |
| Validate | **10** mã lỗi §12, mỗi `kind` ≥ 1 ca; CHECK DB `status` mirror Zod **hai chiều, đúng bằng**; ROOM-ERR-002 đủ 6 `kind` |
| FSM | `Confirmed → Cancelled` một lần; `Cancelled → *` ✗; `Completed` dẫn xuất đúng ở biên `ends_at = now()`; UPDATE huỷ là **một câu** thoả CHECK cặp |
| Sức chứa & tham dự | headcount = 1 + attendees; trùng/organizer trong attendees → 422; user tenant khác → `attendee-not-found` (cùng mã với không tồn tại) |
| Phòng | tên trùng case-insensitive → 409; tên phòng đã xoá mềm dùng lại → OK; vô hiệu/xoá khi còn lịch → 409; phòng xoá mềm vẫn trả ở lịch sử |
| Idempotent | POST lặp cùng `Idempotency-Key` (15′) → 1 lượt, lần 2 cùng envelope + `Idempotency-Replayed: true`; khác user/company cùng key → không phát lại chéo |
| NOTI | 3 event seed đúng, `dedupe_strategy='DedupeKey'`; CHECK `module_code`/`notification_type` nới **cả hai bảng**; actor bị loại ở 013/014, **không** bị loại ở 015; job nhắc idempotent |
| Sổ không xoá | app role `DELETE` trên `room_bookings` bị từ chối ở **DB**; UPDATE cột ngoài allowlist bị từ chối; `room_booking_attendees` không UPDATE/DELETE |
| Tenant | `rls-tenant-isolation-tester` xanh cho `meeting_rooms` · `room_bookings` · `room_booking_attendees` trên `LANE_DB` |
| Di sản | 4 bảng không tồn tại sau migration; tiền kiểm "0 hàng" fail-loud (ca giả lập có hàng → migration dừng); 6 cặp `meeting*` soft-deleted, 0 grant; `grep -rn "'meeting'" apps/api/src` = 0 guard |
| Audit | mỗi mutation +1 hàng `audit_logs` đúng `object_type`; đặt hộ ghi cả `organizer` lẫn `bookedBy` |
| Múi giờ | `?date=2026-09-02` với `companies.timezone = Asia/Ho_Chi_Minh` lấy đúng `[2026-09-01T17:00Z, 2026-09-02T17:00Z)` |

---

## 22. Quyết định nghiệp vụ — **OWNER ĐÃ KÝ 28/08/2026**

> Owner duyệt nguyên gói hồ sơ [`docs/plans/S11-OFFICE-WAVE-review.html`](<../plans/S11-OFFICE-WAVE-review.html>) («ok tôi duyệt») ⇒ 5 mã dưới đây chốt **đúng cột «Đề xuất»** của [wave plan §3](<../plans/S11-OFFICE-WAVE.md>). Riêng nhánh mở của ROOM-DEC-001 (`meetings`/`meeting_attendees`) chốt trong WO này sau khi ĐO (§3.4). Bảng này là bản chép kết luận; không hỏi lại.

| Mã | Câu hỏi | Kết quả owner chốt | Trạng thái |
| --- | --- | --- | --- |
| OFFICE-DEC-001 | Đánh số tài liệu khi DB-13/14 đã bị PAYROLL/RECRUIT đặt trước | **DB-15 ASSET · DB-16 ROOM** · API-14 ASSET · API-15 ROOM · permission-matrix **§9d/§9e** · IMPLEMENTATION-02 **EPIC-17 (§8.18) / EPIC-18 (§8.19)**; giữ nguyên chỗ đặt của IMP-10 | ✅ chốt |
| ROOM-DEC-001 | Số phận 5 bảng `meeting_*` di sản | **Tái dụng `meeting_rooms`** (ALTER, gỡ `is_virtual`); **`meetings`/`meeting_attendees` THAY bằng `room_bookings`/`room_booking_attendees`** qua expand-contract rồi DROP (đo 29/08/2026: 0 hàng cả 5 bảng, 0 code); `meeting_notes`/`meeting_tasks` DROP; 6 cặp quyền `meeting*` xoá mềm + xoá grant — §3.4, DB-16 §9 | ✅ chốt (nhánh mở chốt 29/08) |
| ROOM-DEC-002 | Có luồng duyệt đặt phòng không | **v1 không duyệt** — đặt là giữ chỗ ngay nếu không trùng; cột `requires_approval` chừa sẵn và **được đọc**: phòng bật cờ từ chối đặt (ROOM-ERR-004) — §3.3 | ✅ chốt |
| ROOM-DEC-003 | Recurring booking / múi giờ | v1 KHÔNG recurring; UTC-at-rest + hiển thị theo `companies.timezone` (Asia/Ho_Chi_Minh) — §3.5; trạng thái `Confirmed · Cancelled` + `Completed` dẫn xuất — hợp thức **SPEC-01 §17.10** | ✅ chốt |
| ROOM-DEC-004 | Nhắc lịch họp | Có — NOTI nhắc trước 15 phút qua outbox + system job quét — §13.5, §17 | ✅ chốt |

> **Tinh chỉnh thi công trong phạm vi đã duyệt (ghi để minh bạch, không phải DEC mới):** (a) §11 gộp cặp đọc thành **một** `('view','room')` scope Company cho mọi role thay vì tách `ROOM.BOOKING.VIEW` own/all như hồ sơ HTML — lịch phòng là dữ liệu dùng chung, tách cặp đọc là họ lỗi `read-path-gate-pair`; (b) `ROOM.BOOKING.MANAGE` của hồ sơ HTML thay bằng **`('cancel','room-booking')` @Company** (cùng hành động, khác phạm vi); (c) `Idempotency-Key` của `POST /room-bookings` **do FE sinh khi mở form** thay vì "suy từ payload" như wave §7 bẫy 7 — khoá suy từ payload sẽ phát lại lượt vừa huỷ khi đặt lại y hệt trong 15′; cùng quyết định với ASSET-API-010; (d) v1 **không sửa** lượt đặt (huỷ + đặt lại) — không có `PATCH`; (e) organizer/attendees neo theo **`users`** (không `employees`) vì chủ thể đặt phòng là tài khoản đăng nhập, mọi user đều đặt được kể cả tài khoản chưa có hồ sơ nhân sự. Tổng **5 cặp**.
>
> Điều kiện mở WO code của track ROOM: 5 quyết định chốt (✅) · §1 = `Approved` (✅) · `plan-reviewer` đối kháng **PASS** trên SPEC-14 + DB-16 (đặc biệt phương án xử lý `meeting_*`) — làm ở cuối `S11-ROOM-DOC-1`, trước khi mở `S11-ROOM-DB-1` (chạy **sau** `S11-ASSET-DB-1`).

---

## 23. Tác động đến bộ tài liệu hiện tại (WO S11-ROOM-DOC-1)

1. **SPEC-01**: §7.2/§8 trỏ ROOM → SPEC-14; §12.11 liên kết; **§17.10** hợp thức trạng thái lượt đặt phòng + ghi chú §17.7 (`Completed` dẫn xuất); §20.2 cấp NOTI-EVENT-013..015; thanh điều hướng các file SPEC thêm SPEC-14.
2. **SPEC-08**: §15.0 bảng ánh xạ thêm 013–015; §15.8 ROOM events.
3. **docs/README.md** §2/§3/§4/§9: thêm SPEC-14 · DB-16 · API-15 và hàng module ROOM.
4. **docs/permission-matrix-spec.md**: **§9e ROOM** — 5 cặp + scope per-(perm, role) + role `office-admin` + ghi chú 6 cặp di sản bị xoá mềm.
5. **DB-01** §3.2 + nhóm bảng §7.11 · **DB-09** §8.17 index ROOM · **DB-10** §10 seed module + §12.10 permission + §15 event.
6. Tạo **DB-16** và **API-15** (stub endpoint khoá theo §15).
7. **docs/erd-current.md**: gỡ `meeting.ts` khỏi nhóm "di sản cần dọn" (A5) → nhóm ROOM (A4: 1 bảng tái dụng + 2 bảng mới, 4 bảng sẽ DROP ở `S11-ROOM-DB-1`).
8. **RELEASE-14 §5**: ROOM có bộ tài liệu, wave `S11-OFFICE`.
9. **IMPLEMENTATION-02** §8.19 **EPIC-18 ROOM** (IMP02-STORY-163..170) + §9 Sprint 11; **ISSUE-BOARD-01** §8.2 hàng ROOM/EPIC-18.
10. **harness**: `lib/stories.mjs` (`EPIC_MODULE[18]`, `sprintOfStory` S11 mở rộng 153–170, override story→WO) · `dashboard/server.mjs` (`MODULE_SPEC` ROOM, đặt **trước** HR/TASK vì tiêu đề chứa "phòng" — regex HR bắt `phòng ban`, không bắt `phòng họp`) · `backlog.mjs` (ROOM-DOC-1 đóng, ROOM-DB-1 nhận số liệu thật + kế hoạch DROP).
11. **Nợ để lại cho WO FE (`S11-ROOM-FE-1`)**: thêm **5 mã dotted `ROOM.*`** (§11) vào `PERMISSION_CODE_TO_PAIR` ở `packages/web-core/src/lib/registry.ts` (fail-closed).
12. **Nợ để lại cho WO DB (`S11-ROOM-DB-1`)**: `apps/api/src/db/schema/meeting.ts` → `rooms.ts` (3 bảng), `schema/index.ts` đổi export; `rls-registry.ts` gỡ **4** entry `meeting*` (giữ `meeting_rooms`) + thêm 2; `apps/api/demo-seed-full.mjs` gỡ khối MEETINGS + 2 dòng đếm; `cleanupTenants()` thêm 2 bảng **trước** `DELETE FROM users`; `AUDIT_OBJECT_TYPES` gỡ `meeting`/`meeting_note`, thêm `room_booking` (CHECK DB **giữ** giá trị cũ — union chỉ tăng, parity một chiều); `NotiModuleCode` + `NotiType` thêm `ROOM`/`Room`; **mọi FK tới `users` kể cả `*_by` là composite** `SET NULL (col)` (DB-16 §4.2 — ratchet `xtenant-fk` đếm cả FK nullable), sàn 423 không hạ; migration `0552`/`0553` mang marker `DESTRUCTIVE-APPROVED` (`DROP COLUMN` + `DROP TABLE` đều bị quét).
13. **Nợ để lại cho WO BE (`S11-ROOM-BE-1`)**: DTO ROOM chiếu `displayName`/`employeeCode` của `users`/`employee_profiles` ⇒ cập nhật `identity-projection-census` (điểm chiếu danh tính mới phải có verdict scope — ratchet của `S10-SEC-LOGINLOG429-1`), không để census đỏ hoặc nới trần ngầm.

---

## 24. Definition of Done cho SPEC-14

- [x] Owner ký OFFICE-DEC-001 + ROOM-DEC-001..004 (28/08/2026) → §1 = **Approved**; nhánh mở ROOM-DEC-001 chốt sau khi ĐO (29/08/2026, §3.4)
- [x] DB-16 + API-15 + permission-matrix §9e đồng bộ, không mâu thuẫn SPEC-14
- [x] SPEC-01 §17.10 hợp thức bộ trạng thái; §20.2/SPEC-08 §15.0 cấp mã NOTI-EVENT sau khi **đo**
- [ ] `plan-reviewer` đối kháng PASS trên SPEC-14 + DB-16 trước khi mở `S11-ROOM-DB-1` — vòng 1 (29/08/2026) **BLOCK 3 mục** (FK `*_by` phải composite · rls-registry 4 entry · `demo-seed-full.mjs`) + 8 cảnh báo → **đã vá cùng ngày**; vòng xác nhận **chưa chạy** (dừng vì chi phí phiên) — owner quyết chạy lại trước khi mở WO DB
- [ ] Mọi WO code của track ROOM lấy SPEC-14 + DB-16 làm nguồn sự thật; lệch → sửa code, không sửa ngầm spec

---

## 25. Kết luận

ROOM là module Phase 3 gọn nhất về nghiệp vụ nhưng là nơi thử hai thứ: **chống trùng lịch bằng ràng buộc DB thật** (EXCLUDE GIST là chốt cuối, service chỉ làm 409 có nội dung) và **dọn nền di sản đúng cách** (tái dụng một bảng khớp, thay hai bảng lệch bằng expand-contract, DROP phần ngoài phạm vi — tất cả trong một WO DB, không để hai «phòng họp» cùng sống). Ba lựa chọn cứng — **hai trạng thái lưu cứng + `Completed` dẫn xuất**, **không duyệt ở v1 nhưng cờ `requires_approval` được đọc**, **lịch là dữ liệu dùng chung (một cặp đọc scope Company)** — giữ v1 nằm ngoài vùng crown-jewel. Phần thật sự mới chỉ là 2 bảng, 5 cặp quyền, 13 mã API, 3 event NOTI, 1 job và 5 màn hình; mọi thứ còn lại tái dùng nền đã có.
