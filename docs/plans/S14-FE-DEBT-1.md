# S14-FE-DEBT-1 — Gộp nợ FE: `PaginationFooter` + parser lỗi dùng chung

> 🟢 LIGHT gate · zone green · nhánh `feat/s14-fe-debt-1`
> Phạm vi do owner chốt 2026-09-04 — **KHÔNG** làm cả ~140 điểm trùng lặp trong một PR.

---

## 1. Census — đo lại có kiểm soát (2026-09-04)

Census gốc nằm ở phiên trước; bản này **tái lập bằng script** để con số kiểm chứng được,
không phải chép lại lời khai.

### 1.1 Phân trang — **27 điểm render / 10 hình dạng**

Neo vào nút "trang trước" (`Math.max(1, p - 1)`) rồi cân bằng ngoặc để cắt trọn khối, chuẩn
hoá whitespace + tên biến, băm để nhóm:

| Băm | Đặc điểm | n | Trong phạm vi? |
| --- | --- | --- | --- |
| `612ed6e5` | hình **α** — `justify-between`, dải `1–20 / 57`, i18n `pagination.prev/next` | **9** | ✅ |
| `a13f5386` | **glyph** `‹`/`›` + `isFetching` | **5** | ✅ |
| `e298408a` | **glyph** `‹`/`›`, không `isFetching` | **3** | ✅ |
| `cfddccc7` | **glyph**, biến vòng `v` thay `p` (MePayslipsPage) | **1** | ✅ |
| — | **glyph** ở `PayrollPeriodDetailPage` (biến `linePage`/`lineLastPage`) | **1** | ✅ |
| `0cf51b88` | i18n, không biết tổng trang (`page > 1 \|\| hasNext`) — tasks ×2 | 2 | ⏭️ đuôi dài |
| `f918c1d5` | i18n, `tc()` thay `t()` — EmployeeListPage | 1 | ⏭️ đuôi dài |
| NOGUARD ×5 | EmployeeMultiPickerDialog · ContractsPage · FilesPage · RemoteWorkRequestsPage · AttendanceReportsPage · LeaveReportsPage · … | 5+ | ⏭️ đuôi dài |

**Trong phạm vi = 19 file** (10 glyph + 9 α). **KHÔNG tồn tại** component tên
`PaginationFooter`/`Pagination`/`Pager` nào trong repo trước WO này.

> ⚠️ `DataTable` **đã có** footer phân trang riêng — nhưng là **CLIENT-side**
> (`table.previousPage()`). 27 điểm trên là **SERVER-side** (đổi `page` → refetch). Hai thứ khác
> nhau; đừng "gộp" chúng làm một.

### 1.2 Parser lỗi — 4 module chép cùng khuôn

`readDetailFields` **byte-identical cả 4** (`asset` · `payroll` · `recruit` · `room`).
`parse*Error` identical cả 4 modulo tên kiểu trả về; riêng `parseRoomError` thêm `rawDetails`.

---

## 2. Đã làm

### 2.1 `PaginationFooter` — `packages/ui/src/components/ui/pagination-footer.tsx`

Áp lên **19 file**. Guard bên ngoài (`lastPage > 1`, `!isLoading && totalPages > 1`)
**giữ nguyên tại chỗ gọi** ⇒ 0 thay đổi hành vi ẩn/hiện.

- **Sửa lỗi a11y thật:** 10 bản glyph render trần ký tự `‹`/`›`, **không** `aria-label`,
  **không** i18n ⇒ trình đọc màn hình đọc ra đúng "‹". Bản chung dùng
  `ChevronLeft`/`ChevronRight` + `aria-label` từ `common:pagination.prev/next` — cùng khuôn với
  `PageButton` mà `DataTable` đã dùng.
  **Tên khả truy cập KHÔNG đổi** ("Trang trước"/"Trang sau") nên spec cũ không đỏ.
- **Ba khuôn guard cũ đều tương đương `hasPrev || hasNext`** — component tự ẩn theo điều kiện đó,
  nên vẫn đúng khi phía gọi sau này bỏ guard riêng.
- `hasPrev`/`hasNext` tường minh **thắng** suy diễn từ `page`/`totalPages` (khuôn `meta.hasNext`).
- Không có `totalPages` ⇒ **không bịa** chỉ báo `2 / undefined`.

10 ca test, gồm ca đo đúng lỗi a11y và ca ẩn-hoàn-toàn.

### 2.2 `parseKindError` + `readDetailFields` — `packages/web-core/src/lib/error-mapper.ts`

Đặt cạnh `isValidationDetails`/`extractValidationDetails` vì cùng mối quan tâm.

- `asset`/`payroll`/`recruit`: interface → **alias** của `KindErrorInfo`, hàm → **re-export**
  `parseKindError`. **0 call-site phải đổi** — tên public giữ nguyên.
- `room`: `RoomErrorInfo extends KindErrorInfo`, `parseRoomError` bọc bản chung rồi thêm
  `rawDetails` (ROOM cần `details` thô cho `parseRoomConflictsDetail` của contracts).

9 ca test ghim hai bất biến đắt tiền: `details` là **MẢNG** `ErrorDetail`, không phải object
`{kind:…}` (memory `error-details-must-be-errordetail-array`); và hình sai **không được ném** —
trả bảng rỗng, vì hàm nằm trên đường xử lý lỗi.

---

## 3. Nghiệm thu

| Cổng | Kết quả |
| --- | --- |
| `pnpm --filter @mediaos/app typecheck` | ✅ sạch |
| `pnpm --filter @mediaos/app test` | ✅ **259/259 file · 2477/2477 test** |
| `pnpm --filter @mediaos/web-core test` | ✅ **45/45 file · 739/739 test** |
| `pnpm --filter @mediaos/ui test` | ✅ **17/17 file · 108/108 test** |
| `pnpm lint` | ✅ 7/7 task, **0 error** (47 warning đều có sẵn ở `apps/api/test/**`) |

Số bản lặp trong phạm vi: **19 → 1** (phân trang) · **4 → 1** (`readDetailFields`/`parse*Error`).
Diff: **+317 / −675**.

---

## 4. Nợ mang sang — WO nối tiếp, KHÔNG làm ở đây

1. **Đuôi dài phân trang (8 điểm / 3 hình dạng):** `0cf51b88` (tasks ×2 — không biết tổng trang),
   `f918c1d5` (EmployeeListPage — dùng `tc()`), và nhóm NOGUARD
   (`EmployeeMultiPickerDialog` · `ContractsPage` · `FilesPage` · `RemoteWorkRequestsPage` ·
   `AttendanceReportsPage` · `LeaveReportsPage`). Component chung **đã đủ props** để phủ cả ba
   (`hasNext` không cần `totalPages`); chỉ là owner chốt không nhồi vào PR này.
2. **Picker org-unit — 22 nơi, 0 component chung, 4 nguồn dữ liệu.** Nằm trong tiêu đề WO nhưng
   **ngoài phạm vi owner chốt 04/09** ⇒ WO riêng. Đụng vào nó phải đọc trước
   `S18-FE-DEPTQUERYKEY-1` (bên dưới) vì hai việc chồng lên cùng vùng dữ liệu.
3. **`S18-FE-DEPTQUERYKEY-1`** (đã seed) — `hrApi.listDepartments` và
   `hrMasterDataApi.listDepartments` dùng **chung** `hrKeys.departments.list()` nhưng khác
   endpoint, khác cổng quyền, khác shape ⇒ màn mount trước đầu độc cache màn kia. **Lỗi thật**,
   không phải nợ trùng lặp.
