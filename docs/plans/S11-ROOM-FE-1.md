# S11-ROOM-FE-1 — FE ROOM (5 màn) · plan

> WO `S11-ROOM-FE-1` · zone **green** · depends_on `S11-ROOM-BE-1` (đã merge #438, master `99b885fa`).
> Nguồn: `SPEC-14 ROOM.md` §9 (màn) · §11 (quyền) · §12 (mã lỗi) · §14 (trạng thái UI) · §15 (API) ·
> `docs/plans/S11-OFFICE-WAVE.md` §6. Contracts đã có sẵn: `packages/contracts/src/room.ts` (345 dòng).
> Tiền lệ trực tiếp: `docs/plans/S11-ASSET-FE-1.md` (cùng wave, merge #439).

---

## 1. Số đo hiện trạng (đo 30/08/2026, KHÔNG suy đoán)

| Thứ | Trạng thái đo được |
| --- | --- |
| BE routes | 3 controller: `rooms` (8 route) · `room-bookings` (4) · `me/room-bookings` (1) = **13 route** |
| Phân trang | **CHỈ** `GET /rooms` trả `PaginatedResult`; 12 route còn lại trả mảng/object trần |
| Contracts | `packages/contracts/src/room.ts` ĐỦ request/response + `parseRoomConflictsDetail()` — FE dùng thẳng, KHÔNG khai lại |
| `PERMISSION_CODE_TO_PAIR` | **0** mã `ROOM.*` ⇒ mọi màn ROOM ẩn dù 0554 đã grant 22 hàng (fail-closed) |
| `ModuleCode` | ĐÃ có `"ROOM"` (registry.ts:32) — không cần thêm |
| `APP_REGISTRY` / `ROUTE_REGISTRY` / `SIDEBAR_REGISTRY` | **0** entry ROOM |
| `packages/web-core/src/lib/room-api.ts` | **chưa có** (`chat-api.ts` có `rooms.*` nhưng là phòng CHAT — khác miền) |
| `modules.ROOM.is_active` | **false** (0554 bước 1 cố ý giữ) |
| pin smoke | `EXTENSION_INACTIVE_MODULES = ["PAYROLL","RECRUIT","ROOM","CHAT","SOCIAL"]` — `migration-smoke.int-spec.ts:97` |
| guard 0554 (e) | assert `is_active = false` **VÔ ĐIỀU KIỆN** (dòng 371-376) + `RAISE NOTICE` dòng 38 |
| migration head | `0556_s11assetfe1_enable_asset_module` (journal idx 223) ⇒ WO này dùng **0557**, idx **224** |
| i18n | `apps/app/src/i18n/locales/vi/` 13 namespace, **chưa** có `rooms` |
| routes FE | `apps/app/src/routes/` **chưa** có `rooms/` |

**Cặp quyền THẬT đọc từ controller** (chống pair-drift — KHÔNG chép bảng spec):
`view:room` (9 route) · `book:room` (1) · `cancel:room-booking` (1) · `manage:room` (3) = **4 cặp enforce**.
Cặp thứ 5 `access:room` **không** route nào enforce — nó là cổng nav (seed 0554, grant Own cho cả 4 role
canonical + office-admin), đúng họ `access:asset` / `access:goal` / `access:chat`.

---

## 2. Quyết định thi công

### 2.1 Gate lối vào = ĐỦ CẢ HAI cặp `access:room` + `view:room`

Thẻ App Switcher, mục sidebar và RouteMeta của `/rooms` đều khai `requiredPermissions` (ĐỦ CẢ HAI), cùng
kỹ thuật ASSET-FE-1 §2.1 và vì cùng một lý do: `/rooms` tải `GET /room-bookings` + `GET /rooms` = `view:room`.
Gate bằng mình `access:room` dựng lại lỗ `read-path-gate-pair-must-match-download-pair`. Cặp literal, **KHÔNG**
qua `PERMISSION_CODE_TO_PAIR`.

### 2.2 5 mã dotted vào `PERMISSION_CODE_TO_PAIR` (SPEC-14 §11 cột "Mã hiển thị")

| Mã dotted | Cặp engine |
| --- | --- |
| `ROOM.ACCESS` | `access:room` |
| `ROOM.ROOM.VIEW` | `view:room` |
| `ROOM.BOOKING.CREATE` | `book:room` |
| `ROOM.BOOKING.CANCEL` | `cancel:room-booking` |
| `ROOM.ROOM.MANAGE` | `manage:room` |

### 2.3 Nút «Huỷ» đi theo `canCancel` của SERVER, KHÔNG tự suy trên FE

`roomBookingResponseSchema.canCancel` do server tính theo quyền + scope + thời gian (SPEC-14 §10 ROOM-FUNC-006).
FE **không** dựng lại công thức `organizer === me || scope === Company` — dựng lại là hai nguồn sự thật lệch
nhau, đúng họ `ui-promises-backend-never-reads` theo chiều ngược. `useCan("cancel:room-booking")` chỉ dùng để
ẩn nút ở tầng nav/list nơi chưa có DTO; ở drawer chi tiết (005) dùng `canCancel && !isCompleted`.

Tương tự `isCompleted` — **server dẫn xuất** (§10 ROOM-FUNC-010: "FE không tự suy từ đồng hồ máy").

### 2.4 Idempotency-Key cho đặt phòng

FE sinh **một lần khi mở form** (SPEC-14 §12 — server KHÔNG suy từ payload; memory
`idempotency-key-must-be-content-derived` ghi vế ngược: khoá suy-từ-payload sẽ **phát lại** lượt vừa huỷ khi
người dùng "huỷ rồi đặt lại y hệt trong 15′"). Sinh mới khi: mở form · sau gửi **thành công** · sau `KEY_REUSED`.
Đi qua hạ tầng `api-idempotency.ts` đã có sẵn ở web-core (ASSET dùng cùng đường).

### 2.5 Lỗi rẽ theo `error.code`, KHÔNG theo HTTP status

`details` trên dây là **mảng `ErrorDetail{field,message,rule}`** (memory `error-details-must-be-errordetail-array`).
`room-errors.ts` bóc `field === "kind"`; ROOM-ERR-001 đi qua `parseRoomConflictsDetail()` của contracts (KHÔNG
tự `JSON.parse`). `malformed: true` ⇒ hiện thông báo "trùng lịch" chung + log, **không** coi là "không trùng"
(silent-failure).

Ba nhánh của form đặt (SPEC-14 §9 màn 002): `ROOM-ERR-001` ⇒ khung bận + «Còn trống từ …» ·
`IN_PROGRESS` ⇒ "đang gửi, chờ" (không sinh khoá mới) · `KEY_REUSED` ⇒ sinh khoá mới rồi gửi lại. Form
**không mất dữ liệu** ở cả ba.

### 2.6 Múi giờ: `DEFAULT_TIMEZONE` của web-core, ghi nợ tường minh

`done_when` đòi "render đúng múi công ty (`companies.timezone`)". **Đo được**: `companies.timezone` KHÔNG có
đường ra FE hôm nay — `/auth/me` không trả, `/me/preferences.timezone` là **override cá nhân** và `null` =
kế thừa (không lộ giá trị công ty). Mọi màn FE hiện tại (attendance, leave, chat) đều format qua
`formatDate*()` với mặc định `DEFAULT_TIMEZONE = "Asia/Ho_Chi_Minh"` — đúng bằng fallback của `tz.util` ở API.

Quyết định: `room-time.ts` (FE) nhận `timeZone` **tham số** và mọi màn truyền
`useCompanyTimeZone()` → hôm nay trả `DEFAULT_TIMEZONE`. Khi `/auth/me` expand `company.timezone`, sửa **một
hàm** là xong — không phải rải `Asia/Ho_Chi_Minh` khắp 5 màn. Ghi vào §7 nợ bàn giao.

Lưới lịch tính bằng `TZDate` (`@date-fns/tz`, đã là dep của `apps/app`) trên nền UTC-at-rest — cùng thư viện
BE dùng ở `apps/api/src/rooms/room-time.ts`.

### 2.7 Kiểm trùng client-side = **cảnh báo**, EXCLUDE của DB là chốt cuối

Màn 002 kiểm trùng từ dữ liệu lịch đã tải (§9) để người dùng biết ngay, nhưng **không chặn cứng** nút Gửi
khi dữ liệu lịch có thể cũ — chặn cứng bằng cache client là tự dựng oracle sai. Nguồn chân lý vẫn là 409
ROOM-ERR-001 từ server (`memory tests-can-pin-a-hole-open` họ hàng: đừng đóng đinh một suy luận client thành
luật). Khung bận hiện đỏ + cảnh báo; gửi vẫn được, server nói lời cuối.

### 2.8 Form đặt chỉ liệt phòng `isActive` và **không** `requiresApproval`

SPEC-14 §9 màn 002 + §12 ROOM-ERR-004 `approval-not-supported` (ROOM-DEC-002 — v1 chưa có luồng duyệt).
Nguồn danh sách = `GET /rooms/availability` (đã lọc sẵn 2 điều kiện ở server) khi đã có khung giờ; khi chưa
chọn giờ thì `GET /rooms` (mặc định `includeInactive` off) + lọc `requiresApproval === false` ở client.

---

## 3. Bản đồ file

### 3.1 Sửa (hot-file — append, KHÔNG rewrite)

| File | Thay đổi |
| --- | --- |
| `packages/web-core/src/lib/registry.ts` | +5 mã `PERMISSION_CODE_TO_PAIR` · +1 `APP_REGISTRY` (`appKey:"rooms"`, order 110) · +3 `ROUTE_REGISTRY` (`room.calendar`, `room.manage`, `me.roomBookings`) |
| `packages/web-core/src/lib/query-keys.ts` | +`rooms` root key + factory list/detail/availability/usage/bookings + `me.roomBookings` |
| `packages/web-core/src/index.ts` | export `roomApi` + kiểu |
| `apps/app/src/layouts/workspace/sidebar-registry.ts` | +`ROOM_SIDEBAR` (2 mục) · +`SIDEBAR_REGISTRY.ROOM` · +1 mục `/me/room-bookings` vào `ME_SIDEBAR` |
| `apps/app/src/router.tsx` | +4 lazy import · +3 route (`/rooms`, `/rooms/manage`, `/me/room-bookings`) |
| `apps/app/src/layouts/workspace/DynamicIcon.tsx` | +icon `calendar-clock` / `door-open` nếu thiếu |
| `apps/app/src/i18n/index.ts` | +namespace `rooms` |
| `apps/app/src/i18n/locales/vi/*` | +`routeTitle.*` · +`app.rooms`/`appDesc.rooms` |
| `apps/api/migrations/0554_s11roomdb1_seed_role_perms_audit.sql` | **nới guard (e)** bỏ `AND is_active = false` + sửa `RAISE NOTICE` dòng 38 (memory `module-enable-guard-blocks-next-wo`) |
| `apps/api/test/integration/migration-smoke.int-spec.ts` | **gỡ** `"ROOM"` khỏi `EXTENSION_INACTIVE_MODULES` (CÙNG commit) |

### 3.2 Tạo mới

```
apps/api/migrations/0557_s11roomfe1_enable_room_module.sql   -- UPDATE modules SET is_active=true WHERE module_code='ROOM'
packages/web-core/src/lib/room-api.ts                        -- 13 hàm phủ 13 route
apps/app/src/i18n/locales/vi/rooms.ts
apps/app/src/routes/rooms/
  constants.ts               -- nhãn trạng thái (SPEC-01 §17.10), lưới giờ, option lọc
  room-time.ts(+spec)        -- TZDate: lưới tuần/ngày, đặt chồng khung, wall↔instant
  room-errors.ts(+spec)      -- error.code + details[] → kind; parseRoomConflictsDetail
  room-actions.ts(+spec)     -- suy nút (canCancel ∩ quyền), gate màn 004
  RoomCalendarPage.tsx(+spec)      -- ROOM-SCREEN-001
  RoomManagePage.tsx(+spec)        -- ROOM-SCREEN-004 (+ tab lịch sử usage-summary)
  components/
    RoomWeekGrid.tsx         -- cột = phòng, hàng = giờ; kéo chọn khung trống
    RoomBookingDialog.tsx    -- ROOM-SCREEN-002 (Idempotency-Key, 3 nhánh lỗi)
    RoomBookingDrawer.tsx    -- ROOM-SCREEN-005 (nơi DUY NHẤT có nút Huỷ)
    RoomCancelDialog.tsx
    RoomFormDialog.tsx       -- tạo/sửa phòng (004)
    RoomStatusBadge.tsx
apps/app/src/routes/me/MeRoomBookingsPage.tsx(+spec)  -- ROOM-SCREEN-003
```

---

## 4. Thứ tự thi công

1. **Nền quyền + wiring** (registry, query-keys, room-api, sidebar, router, i18n).
2. **Thuần hàm trước** (`room-time.ts`, `room-errors.ts`, `room-actions.ts`, `constants.ts`) + spec RED → GREEN.
3. **ROOM-SCREEN-001** (lịch tuần/ngày) + `RoomWeekGrid`.
4. **ROOM-SCREEN-002** (dialog đặt) + 3 nhánh lỗi + Idempotency-Key.
5. **ROOM-SCREEN-005** (drawer chi tiết) + huỷ.
6. **ROOM-SCREEN-003** (`/me/room-bookings`, 3 tab).
7. **ROOM-SCREEN-004** (quản trị phòng + tab lịch sử).
8. **Migration 0557 + nới guard 0554 + gỡ pin smoke** — CÙNG commit.
9. Verify: `pnpm typecheck|test|build` + lane DB thật cho `migration-smoke` và `s11-room-db1-invariants`.

---

## 5. Rủi ro đã biết

| Rủi ro | Chặn bằng |
| --- | --- |
| Guard 0554 (e) assert `is_active=false` ⇒ ca H1 `s11-room-db1-invariants` replay cả file → **P0001** | §3.1 nới guard CÙNG commit (memory `module-enable-guard-blocks-next-wo` — ASSET đã dính, đã vá 0550) |
| Chạy test chunked cục bộ BỎ QUA `s11-room-db1-invariants` ⇒ máy xanh, CI đỏ | Chạy TAY đúng spec đó trên LANE_DB (memory `src-green-is-not-integration-green`) |
| `error.details` là **mảng**, đọc `details.kind` trả `undefined` ⇒ nuốt lỗi | `room-errors.ts` parse mảng + spec neo |
| `parseRoomConflictsDetail` trả `malformed` bị coi như "không trùng" | Nhánh riêng: hiện lỗi trùng chung + không tự đóng dialog |
| FE tự suy `canCancel`/`isCompleted` từ đồng hồ máy | §2.3 — đọc thẳng DTO; spec neo cho `room-actions.ts` |
| Static `/rooms/manage` bị TanStack nuốt bởi route param | ROOM **không** có route `$roomId` ở v1; vẫn khai static trước theo thói quen |
| Migration 0557 không vào `_journal.json` ⇒ bị bỏ qua im lặng | Thêm journal idx 224 cùng file (memory `migration-not-in-journal-is-silently-skipped`) |
| `apifetch-drops-pagination-bare-array` | `GET /rooms` dùng `apiFetchPaginated`; 12 route còn lại `apiFetch` |
| Múi giờ công ty ≠ Asia/Ho_Chi_Minh | §2.6 — một hàm `useCompanyTimeZone()`; ghi nợ, không rải hằng |
| Go-live: role `office-admin` (mig 0554) chưa gán cho admin PROD ⇒ màn 004 vô hình | Ghi §7; **không** vá bằng blanket grant (`blanket-grant-migration-role-drift`) |

---

## 6. Definition of Done

- [ ] 5 màn ROOM-SCREEN-001..005; loading/error/empty/403 đủ (§14)
- [ ] 5 mã dotted trong `PERMISSION_CODE_TO_PAIR`; gate qua `PermissionGate`/`useCan`, **không** hard-code role
- [ ] Lịch render theo múi công ty trên nền UTC-at-rest (TZDate)
- [ ] Form đặt: cảnh báo trùng client + 3 nhánh lỗi server theo `error.code`; Idempotency-Key sinh đúng 3 mốc
- [ ] Nút Huỷ theo `canCancel` server ∩ quyền — không hiện nút rồi ăn 409/403
- [ ] Migration 0557 + nới guard 0554 + gỡ pin smoke CÙNG commit
- [ ] `pnpm typecheck` · `pnpm test` · `pnpm build` xanh; `migration-smoke` + `s11-room-db1-invariants` xanh trên LANE_DB

---

## 7. Kết quả thi công (30/08/2026)

### 7.1 Đã giao

| Hạng mục | Chi tiết |
| --- | --- |
| 5 màn | `RoomCalendarPage` (001, lưới ngày/tuần cột=phòng) · `RoomBookingDialog` (002) · `MeRoomBookingsPage` (003, 3 tab) · `RoomManagePage` (004, 2 tab + `RoomFormDialog`) · `RoomBookingDrawer` (005, nơi DUY NHẤT có nút Huỷ) |
| API client | `packages/web-core/src/lib/room-api.ts` — 13 hàm phủ đủ 13 route BE |
| Quyền | 5 mã dotted vào `PERMISSION_CODE_TO_PAIR`; `ROOM_ENGINE_PAIRS` cho `useCan` trong page |
| Wiring | `APP_REGISTRY` 'rooms' · 3 `ROUTE_REGISTRY` · 3 route trong `router.tsx` · `ROOM_SIDEBAR` + mục ME · icon `door-open` · namespace i18n `rooms` |
| Migration | `0557_s11roomfe1_enable_room_module.sql` + journal idx 224; gỡ `"ROOM"` khỏi `EXTENSION_INACTIVE_MODULES`; **nới guard verify (e) của 0554** — cả ba CÙNG commit |
| Test | 77 ca mới (23 thời gian · 18 lỗi · 17 suy-nút · 19 wiring) |

### 7.2 Verify

- `pnpm typecheck` (10/10 task) · `pnpm lint` **0 error** (46 warning có sẵn: contracts 2 + `apps/api` 44) · `pnpm --filter @mediaos/app build` xanh
- `apps/app` **2185/2185** xanh (239 file) · `web-core` **722/722** xanh — không hồi quy
- Lane DB MỚI TINH `mediaos_roomfe1` (chain 0000→0557 áp sạch): `migration-smoke` 61/61 · `s11-room-db1-invariants` 20/20 · `s11-asset-db1-invariants` 22/22. `SELECT module_code, is_active` ⇒ `ASSET|true`, `ROOM|true`, `CHAT|false`
- `bash harness/check.sh --lane-db=roomfe1` ⇒ **XANH** toàn bộ: `apps/api` 588/588 file, 6/6 step (secret-literals · lint · typecheck · migration-no-drop · tooling-tests · test)

### 7.3 Ba chỗ lệch so với kế hoạch/spec — sửa theo ĐO ĐƯỢC

1. **Guard 0554 (e) + `RAISE NOTICE` khối (1)**: plan chỉ dự kiến nới khối (e). Khối (1) cũng bị ca H1 chạy lại và câu NOTICE của nó khẳng định `GIU is_active=false` — một câu nói sai trong log, và là bậc thang dẫn tới việc ai đó "sửa" nó thành EXCEPTION. Sửa cả hai, mirror đúng bản vá 0550 của ASSET.
2. **`asset-wiring.spec.ts` neo trạng thái của ROOM**: ca "pin smoke ... VẪN liệt ROOM" là một quả mìn WO trước đặt cho WO này. Đã gỡ vế ROOM khỏi spec của ASSET và chuyển sang `room-wiring.spec.ts` — neo trạng thái module KHÁC trong spec của module này là tự làm khó WO kế tiếp.
3. **Cửa sổ tab của màn 003**: bản đầu của `ME_TAB_DAYS` cho tab «Đã huỷ» 31+31 = 62 ngày ⇒ 422 `range-too-wide` ngay lần mở đầu tiên; tab «Đã qua» thì hụt mất chính ngày hôm nay. Chốt lại theo hợp đồng nửa mở `[today − back, today + forward)` với `back + forward ≤ 31`: upcoming 0/31 · past 30/1 · cancelled 15/16.

### 7.4 Hai quyết định đáng ghi

- **Nút Huỷ đi theo `canCancel` của SERVER**, không theo `organizer === me` dựng lại ở FE (khác hẳn ASSET, nơi FE phải tự suy FSM vì server không gửi cờ). Scope là per-(permission, role) nên công thức FE sẽ giấu nhầm nút của một role tuỳ biến ở scope Company. `room-actions.spec.ts` có ca đối chứng ghim điều này.
- **Kiểm trùng client là CẢNH BÁO, không khoá nút Gửi.** Dữ liệu lịch trong cache có thể đã cũ; chặn cứng là dựng một oracle sai (không đặt được khung thật ra đang trống). Chốt cuối vẫn là EXCLUDE ở DB → 409 ROOM-ERR-001, và UI hiện đúng khung bận + «Còn trống từ …» server trả về.

### 7.5 Nợ / bàn giao

- **Múi giờ công ty**: `companies.timezone` không có đường ra FE (`/auth/me` không trả; `/me/preferences.timezone` là override CÁ NHÂN, `null` = kế thừa). `companyTimeZone()` trả `DEFAULT_TIMEZONE` — đúng bằng fallback `tz.util` của API. Mọi hàm `room-time` nhận tz làm THAM SỐ nên khi `/auth/me` expand `company.timezone` chỉ phải sửa một hàm. FE resolver đã ghim **parity** với `apps/api/src/common/tz.util.spec.ts` ở đúng hai mốc DST canonical.
- **Go-live PROD**: role `office-admin` (mig 0554) chưa gán cho admin thật ⇒ màn 004 và đặt-hộ vô hình tới khi gán qua màn quản trị role. **KHÔNG** vá bằng blanket grant.
- **`MODULE_APP_METADATA` thiếu cả ASSET lẫn ROOM** (ngoài `paths` của WO) — module active mà vắng metadata thì `getMyApps` bỏ qua kèm log warn; lưới «Ứng dụng của tôi» dựng từ `APP_REGISTRY` tĩnh nên người dùng vẫn thấy thẻ. WO nào chạm module-catalog dọn một thể.
- **Chọn người tham dự** đi qua `EmployeeMultiPickerDialog` (danh bạ HR, cần `read:employee`). Nhân viên chưa liên kết tài khoản bị khoá hàng (BE nhận `userId`, không nhận `employeeId`). Người không có `read:employee` vẫn đặt được phòng nhưng danh sách chọn rỗng ⇒ đặt một mình. Chưa có endpoint danh bạ nhẹ — để QA/UX quyết.
- **e2e đặt→trùng→đổi giờ→huỷ qua UI** CHƯA chạy (cần môi trường có seed phòng thật) — phủ tạm bằng 77 ca unit/wiring + 103 int-spec trên lane DB.
