import { z } from "zod";

/**
 * S19-OPS-ZOD4-1 — NGUỒN DUY NHẤT của schema id (UUID) toàn monorepo. Ratchet AST cấm `.uuid(` ở mọi `src/`
 * ngoài tệp này (`apps/api/test/foundation/zod-id-record-ratchet.unit-spec.ts`).
 *
 * Vì sao gom về một chỗ: id canonical đang SỐNG trong DB không chuẩn RFC (nibble version/variant = 0) — role
 * `…0010/0011` (`0444_…canonical_roles_perms.sql`), gói `…00a1-a3` (`0231_…saas_scaffold.sql`), company/PM
 * `…0001`… zod 3 `.uuid()` nhận chúng (regex GUID lỏng); zod 4 `z.uuid()` CHẶT RFC sẽ từ chối ⇒ 400 ở input và
 * FE parse response vỡ. Khi nâng zod 4 (pha C3) chỉ đổi thân tệp này sang `z.guid()` (regex GUID của zod 4 =
 * regex `.uuid()` của zod 3) — KHÔNG đổi sang `z.uuid()`, KHÔNG «vá nhanh» bằng `z.string()` trơn.
 *
 * Ca ghim: `common/id.spec.ts` · `apps/api/src/db/db.service.spec.ts` · `apps/api/src/auth/auth-canonical-id.spec.ts`.
 */
export const idSchema = z.string().uuid();

/** Biến thể mang thông điệp (khoá i18n FE). C3: `z.guid(message)`. */
export function idSchemaWith(message: string) {
  return z.string().uuid(message);
}
