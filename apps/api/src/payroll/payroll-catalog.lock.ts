import { sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";

/**
 * S15-PAYROLL-BE-2 — khoá tuần tự hoá MỌI đường ghi catalog/mẫu bảng lương của MỘT công ty.
 *
 * Người lấy khoá ĐỘC QUYỀN: route 045 · 047 · 050 · 052 · 053 · 058 (S15-PAYROLL-BE-3) **và** `PayrollMasterDataSeeder`
 * (chạy mỗi lần boot). Lý do, mỗi lý do bịt một lỗ đo được ở plan-review:
 *  1. **Vòng phụ thuộc sinh ra do ghi SONG SONG** (SPEC-11 §13.6 E): hai lượt sửa hai thành phần, mỗi bản riêng
 *     lẻ không vòng nhưng hợp lại thì có. Tuần tự hoá ⇒ kiểm vòng lúc LƯU đọc được trạng thái đã commit của lượt
 *     trước. (BE-3 vẫn kiểm vòng lúc TÍNH — ghi thẳng DB không đi qua khoá này.)
 *  2. **Seeder lúc boot đua với 053** (DELETE hết rồi INSERT danh sách thành phần): không khoá ⇒ seeder INSERT
 *     link giữa chừng ⇒ 23505 `payroll_template_components_tpl_component_uq` không có nhánh map ⇒ 500.
 *  3. **058 đua với `calculate`** (plan BE-3 §3.7): 058 kiểm `rate-in-use` thấy kỳ còn `CollectingData` → calculate
 *     đọc bản tỉ lệ `FOR SHARE` → 058 UPDATE chờ → calculate commit `Calculated` → 058 ghi đè số của bản vừa được dùng.
 *
 * Người lấy khoá DÙNG CHUNG (`payrollCatalogSharedLockTx`): `calculate` (007) · gắn mẫu ở 002/004 — đọc catalog/mẫu/
 * bản tỉ lệ và cần nó đứng yên tới hết transaction; nhiều lượt đọc chạy song song được với nhau.
 *
 * `pg_advisory_xact_lock[_shared]` nhả khi transaction kết thúc (commit/rollback) — không có đường quên nhả.
 *
 * 🔒 THỨ TỰ KHOÁ (plan BE-3 §0b M1, census ghim): advisory TRƯỚC, khoá hàng (`FOR UPDATE`/`FOR SHARE`) SAU — ở MỌI
 * người gọi, kể cả người lấy shared: `calculate`/002/004 lấy shared NGAY ĐẦU transaction, TRƯỚC `lockForUpdateTx` kỳ.
 * Đảo lại (khoá kỳ rồi mới xin advisory) là chu trình với writer độc quyền nào đọc/khoá `payroll_periods` sau advisory
 * (vd 052 kiểm `template-in-use` ở BE-4) ⇒ 40P01.
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

/** Khoá DÙNG CHUNG cùng khoá của `payrollCatalogLockTx` — xem docblock trên (người gọi + thứ tự). */
export async function payrollCatalogSharedLockTx(tx: TenantTx, companyId: string): Promise<void> {
  const key = `payroll-catalog:${companyId}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`);
}
