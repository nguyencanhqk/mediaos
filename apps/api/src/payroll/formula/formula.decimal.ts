import Decimal from "decimal.js";

/**
 * S15-PAYROLL-BE-2 — số học TIỀN của máy công thức (DECISIONS-14 §2 · SPEC-11 §13.6 F).
 *
 * 🔴 **CẤU HÌNH ĐÚNG MỘT CHỖ** (DECISIONS-14 §2.3.1). Dùng `Decimal.clone(...)` chứ KHÔNG `Decimal.set(...)`:
 * `set` sửa hằng TOÀN CỤC của thư viện, nên một module khác (hoặc một bản cập nhật dep bắc cầu) đổi cấu
 * hình là phiếu lương đổi quy tắc làm tròn mà không dòng nào ở đây thay đổi.
 *
 * `precision: 50` chữ số có nghĩa: `numeric(18,2)` cần 18 chữ số + scale trung gian 10 = 28; biên 22 chữ số
 * cho tích của hai giá trị cỡ lương (≈ 1e8 × 1e8) trước khi cắt về scale 10.
 *
 * Luật đi kèm (census `payroll-formula-architecture-census.unit-spec.ts` ép): trong `src/payroll/formula/**`
 * CẤM `Number(` · `parseFloat(` · `parseInt(` · `Math.*` trên giá trị — `numeric` từ driver `pg` về JS là
 * CHUỖI và phải vào thẳng `new D(str)`.
 */
export const D = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

/** Scale của mọi phép trung gian (§13.6 F). */
export const SCALE_INTERMEDIATE = 10;
/** Scale của giá trị MỖI thành phần — làm tròn MỘT lần, ngay khi ghi vào map giá trị. */
export const SCALE_MONEY = 2;

/** Trần `numeric(18,2)`: 16 chữ số phần nguyên + 2 phần thập phân. Vượt ⇒ 422 ERR-020 `numeric-overflow`. */
export const NUMERIC_18_2_MAX = new D("9999999999999999.99");

export const ZERO = new D(0);
export const ONE = new D(1);

/** Cắt về scale trung gian — gọi sau MỖI phép `+ − × ÷`. */
export const intermediate = (x: Dec): Dec => x.toDecimalPlaces(SCALE_INTERMEDIATE, D.ROUND_HALF_UP);

/** Làm tròn giá trị thành phần về scale tiền (`ROUND_HALF_UP`). */
export const toMoney = (x: Dec): Dec => x.toDecimalPlaces(SCALE_MONEY, D.ROUND_HALF_UP);

/** True khi giá trị vượt miền `numeric(18,2)` (theo trị tuyệt đối). */
export const exceedsNumeric18_2 = (x: Dec): boolean => x.abs().greaterThan(NUMERIC_18_2_MAX);

