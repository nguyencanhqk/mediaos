import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S15-PAYROLL-BE-2 — khoá tuần tự hoá MỌI đường ghi catalog/mẫu bảng lương của MỘT công ty.
 *
 * Người lấy khoá: route 045 · 047 · 050 · 052 · 053 **và** `PayrollMasterDataSeeder` (chạy mỗi lần boot).
 * Hai lý do, mỗi lý do bịt một lỗ đo được ở plan-review BE-2:
 *  1. **Vòng phụ thuộc sinh ra do ghi SONG SONG** (SPEC-11 §13.6 E): hai lượt sửa hai thành phần, mỗi bản riêng
 *     lẻ không vòng nhưng hợp lại thì có. Tuần tự hoá ⇒ kiểm vòng lúc LƯU đọc được trạng thái đã commit của lượt
 *     trước. (BE-3 vẫn kiểm vòng lúc TÍNH — ghi thẳng DB không đi qua khoá này.)
 *  2. **Seeder lúc boot đua với 053** (DELETE hết rồi INSERT danh sách thành phần): không khoá ⇒ seeder INSERT
 *     link giữa chừng ⇒ 23505 `payroll_template_components_tpl_component_uq` không có nhánh map ⇒ 500.
 *
 * `pg_advisory_xact_lock` nhả khi transaction kết thúc (commit/rollback) — không có đường quên nhả.
 * Thứ tự khoá nhất quán ở mọi người gọi: advisory lock TRƯỚC, `FOR UPDATE` hàng SAU.
 *
 * ⚠️ Chỉ có tác dụng dưới READ COMMITTED (mặc định của `withTenant`): mỗi CÂU sau khi lấy khoá chụp snapshot MỚI
 * nên thấy dữ liệu lượt trước vừa commit. Chuyển tx sang REPEATABLE READ/SERIALIZABLE thì snapshot chụp ở
 * `set_config` — TRƯỚC khi lấy khoá — và khoá thành rỗng (database-review BE-2). Census tĩnh ghim chỗ gọi:
 * `test/foundation/payroll-catalog-lock-census.unit-spec.ts`.
 */
export async function payrollCatalogLockTx(tx: TenantTx, companyId: string): Promise<void> {
  const key = `payroll-catalog:${companyId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}
