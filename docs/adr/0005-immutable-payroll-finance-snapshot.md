# ADR-0005 — Payroll/Finance = snapshot bất biến (append-only)

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0009](0009-audit-outbox-event-bus.md), [0010](0010-permission-engine-4-tier.md)

## Bối cảnh

Lương, KPI, doanh thu, chi phí, lợi nhuận cần bằng chứng kiểm toán; sửa sau khi chốt = gian lận/sai lệch.

## Quyết định

Các bảng `payslips`, `kpi_results`, `profit_snapshots`, `revenue_records`, `cost_records`… là **append-only**: app role **không có quyền UPDATE/DELETE**. Sửa = tạo bản ghi mới (correction) tham chiếu bản cũ. **Khóa kỳ KPI TRƯỚC khi chạy lương.**

## Lý do

Bất biến = audit trail tin cậy, chống sửa lén. Khóa kỳ tránh KPI đổi sau khi lương đã tính trên nó.

## Hệ quả

`guard-immutability` hook + `payroll-snapshot-immutability-guard` ép. Cần `immutable-snapshot-architect` thiết kế. Review FULL gate + `ecc:santa-method` cho payroll. Soft-delete (`deleted_at`) cho dữ liệu thường, append-only cho audit/snapshot.

## Phương án đã loại

- UPDATE tại chỗ + history table riêng (dễ quên ghi history, race).
- Hard-delete + log (mất bằng chứng).
