# ADR-0022 — De-media-fy: reframe thành Hệ thống Quản lý Doanh nghiệp chung

- **Trạng thái:** ✅ Accepted (2026-06-20)
- **Bất khả nghịch:** Trung bình (đảo lại = un-park subsystem cũ; dữ liệu/đường-mã còn trong git)
- **Thay thế (đã XÓA khỏi repo 2026-06-20 — còn trong git):** ADR-0004 (envelope-KMS cho `platform_accounts`) · 0005 (payroll/finance snapshot) · 0017 (platform-admin tenancy) · 0019 (control-plane cross-tenant) · 0020 (AC-9 db-ops) · 0021 (all-tenant readonly role)
- **Ảnh hưởng (không đảo):** [0001](0001-rls-multi-tenant.md) (chạy N=1) · [0007](0007-mobile-react-native.md) · [0018](0018-mobile-stack.md) (hoãn Phase 5)

## Bối cảnh

Bộ spec mới `docs/spec/` (SPEC-01…08, 2026-06-20) định nghĩa lại sản phẩm là **hệ thống quản lý doanh nghiệp nội bộ chung** (HR/chấm công/nghỉ phép/công việc/dashboard/thông báo), KHÔNG còn là OS cho công ty media. Toàn bộ tài liệu charter cũ (media/kênh/content production, tài chính-theo-kênh, SaaS multi-tenant, control-plane operator) đã lệch khỏi định hướng. Code backend G1–G16 đã build nhiều subsystem cho hướng cũ.

## Quyết định

1. **Sản phẩm = hệ QLDN chung.** MVP = AUTH · HR · ATT · LEAVE · TASK · DASH · NOTI (theo `docs/spec/`). Roadmap sau: PAYROLL · RECRUIT (Phase 2) · ASSET · ROOM (Phase 3) · CHAT · SOCIAL (Phase 4) · MOBILE · AI · INTEGRATION (Phase 5).
2. **Park (out-of-scope, KHÔNG xóa code) các subsystem hướng cũ:** `media`/`platform` (channels/content/platform_accounts) · `workflow`/`approval`/`evaluation`/`defect` (engine DAG/FSM duyệt nội dung) · `payroll`/`finance`/`kpi` · `saas`/control-plane `apps/admin` · `apps/mobile`.
3. **Giữ nguyên nền hạ tầng đa-công-ty nhưng chạy N=1:** `company_id` + RLS + `withTenant`, audit+outbox, permission engine 4 tầng — tất cả vẫn là bất biến, chỉ vận hành đơn-công-ty.
4. **Khi code cũ mâu thuẫn với `docs/spec/` → spec thắng.**

## Lý do

- Kiểm soát phạm vi: media production + finance + SaaS là phần phức tạp/nhạy cảm nhất; cắt bỏ giúp ra MVP nhanh, đúng nhu cầu nội bộ thực.
- Không phá nền tốt: RLS/audit/permission/outbox là kiến trúc giá trị, tái dùng nguyên cho module mới.
- Park thay vì xóa: bảo toàn công sức đã bỏ ra; payroll/mobile quay lại ở Phase sau theo spec.

## Hệ quả

- **ADR bị thay thế (đã xóa):** quyết định cho subsystem parked (envelope-KMS-cho-channel, payroll/finance-snapshot, SaaS/control-plane) **không còn hiệu lực ở MVP**. Nguyên tắc *append-only cho snapshot* (ADR-0005 cũ) được **giữ lại trong Bất biến #2** và sẽ tái áp dụng khi build PAYROLL Phase 2.
- **Tài liệu:** charter/ERD/permission/system-design viết lại theo spec; plans/prompts/reviews/integrations hướng cũ đã xóa (còn trong git).
- **Harness:** crown-jewel routing bỏ finance/kpi; backlog meta + STATUS phản ánh de-media-fy.
- **Mobile (0007/0018):** không đảo quyết định stack, chỉ **hoãn** tới Phase 5.

## Phương án đã loại

- **Giữ MediaOS, chỉ thu nhỏ MVP** — loại: spec mới không có bất kỳ module media/content nào; sản phẩm thực sự đổi định danh, không chỉ thu nhỏ.
- **Xóa hẳn code subsystem cũ ngay** — loại: rủi ro phá nền dùng chung (RLS/audit/permission đan xen); park an toàn hơn, gỡ dần có kiểm chứng (xem `TRIM-1` trong backlog).
