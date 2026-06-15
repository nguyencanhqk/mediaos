# ADR-0008 — Timezone UTC-at-rest, render `Asia/Ho_Chi_Minh`

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0005](0005-immutable-payroll-finance-snapshot.md)

## Bối cảnh

Chấm công, ca làm, kỳ lương nhạy cảm với timezone/DST. Lưu local time → sai khi tính toán.

## Quyết định

**Lưu UTC** (timestamptz at-rest). Render theo `Asia/Ho_Chi_Minh` ở tầng hiển thị. Dùng `date-fns` v4 + `@date-fns/tz`.

## Lý do

UTC-at-rest = một nguồn sự thật, tính toán/so sánh nhất quán. VN không có DST nhưng quy tắc UTC-at-rest vẫn an toàn nhất và SaaS-ready cho tenant timezone khác.

## Hệ quả

Payroll/attendance phải convert đúng ở ranh giới. Cần test DST-safe. i18n (react-i18next, vi) áp ngay khi có dữ liệu thời gian.

## Phương án đã loại

- Lưu local time / `timestamp without time zone` — sai khi đổi tz, không SaaS-ready.

## Ghi chú phê chuẩn GX-7 (2026-06-15) — KHÔNG phải ADR mới

Phê chuẩn (ratify) việc áp ADR-0008 vào tầng code:

- **Deps đã giải băng + chốt:** `date-fns@^4` + `@date-fns/tz` (apps/api). FE: `react-i18next` + `i18next` (vi) cho nhãn payroll/attendance.
- **Ruột render dùng `@date-fns/tz` `TZDate`:** `common/tz.util.ts` đọc year/month/day/hour/min/sec qua `TZDate` thay cho `Intl.DateTimeFormat`. Đã kiểm parity byte-identical với Intl trên lưới VN (no-DST) + `America/New_York` (DST) — xem `tz.util.spec.ts`. **Chữ ký public KHÔNG đổi** (attendance/payroll/dashboard G11/G12/G14 phụ thuộc shape).
- **Giải DST gap/overlap (canonical) = two-pass monotonic resolver,** GIỮ trong `wallTimeToInstant`, **KHÔNG** dùng raw constructor `new TZDate(y,mo,d,h,…)`. Lý do: constructor TZDate giải GAP-day (giờ không tồn tại) bằng pre-transition offset → lệch **1 giờ** so với two-pass đã ship. Lệch 1 giờ ở biên = **sai lương**. Quy tắc chốt:
  - GAP (vd NY 2024-03-10 02:30, không tồn tại) → rơi về offset **sau-chuyển** (EDT) → 1 instant ổn định.
  - OVERLAP (vd NY 2024-11-03 01:30, lặp 2 lần) → chọn **lần đầu** (pre-transition, EDT) → ổn định, deterministic, không ném.
  - VN không DST nên cả hai trùng; quy tắc trên cho SaaS multi-tz về sau.
- **Validate ở biên:** `assertValidTimezone` (RangeError) gọi khi tạo/sửa `work_schedule` VÀ khi đổi `company.timezone` (settings) — Zod chỉ chặn rỗng, không chặn tz rác (`Mars/Phobos`).
- **Render company tz:** ngày/tháng nghiệp vụ (work_date, period_month) suy theo tz của company/work_schedule trong scope `withTenant`, KHÔNG dùng hằng số toàn cục (chống rò tz tenant khác).
- **i18n:** missing-key cho nhãn payroll KHÔNG fallback im lặng sang English (cấu hình `missingKeyHandler` tường minh) — tránh rò ngôn ngữ sai/ẩn lỗi thiếu key.
- **Migration:** KHÔNG cần cột mới ở lượt này (`companies.timezone` + `work_schedules.timezone` đã có, default `Asia/Ho_Chi_Minh`). Nếu sau này thêm `payroll_periods.timezone` snapshot (SaaS multi-tz) → band `0180-0189`, `when` đơn điệu tăng.
