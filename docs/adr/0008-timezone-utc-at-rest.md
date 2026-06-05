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
