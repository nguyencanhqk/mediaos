# ADR-0010 — Permission engine 4 tầng, quyền nhạy cảm KHÔNG kế thừa

- **Trạng thái:** ✅ Accepted
- **Bất khả nghịch:** ⚠️ Cao
- **Liên quan:** [0001](0001-rls-multi-tenant.md), [0006](0006-frontend-vite-react-spa.md), [0009](0009-audit-outbox-event-bus.md)

## Bối cảnh

~200 nhân sự, nhiều role/scope/object. Quyền nhạy cảm (xem lương, reveal secret) không được "vô tình kế thừa" qua role cha.

## Quyết định

`PermissionService.can(user, action, objType, objId, ctx)` — **4 tầng: RBAC × Scope × Object × Sensitive**. **Quyền nhạy cảm KHÔNG kế thừa** — phải cấp tường minh. Guards `auth → company → permission`. Cache ở Valkey + invalidate đúng. **Test deny-path TRƯỚC (RED).** Server là sự thật, FE chỉ UX.

## Lý do

Mô hình 4 tầng phủ RBAC thường lẫn object-level + sensitive. Không-kế-thừa chặn leo thang quyền ngầm. Deny-path-first đảm bảo chặn đúng trước khi mở.

## Hệ quả

Cần `permission-matrix-spec` (nguồn sự thật) + `ecc:type-design-analyzer`. PHẢI xong trước mọi module nhạy cảm. Đổi quyền có audit.

## Phương án đã loại

- RBAC phẳng (không object/sensitive).
- Kế thừa toàn bộ qua role cha (leo thang quyền).
- Check permission ở FE (bypass được).
