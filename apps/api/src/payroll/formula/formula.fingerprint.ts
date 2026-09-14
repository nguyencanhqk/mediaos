import { createHash } from "node:crypto";
import { D } from "./formula.decimal";

/**
 * S15-PAYROLL-BE-2 — dấu vân tay của TẬP CÔNG THỨC hiệu lực (SPEC-11 §13.6 G), tách HAI tầng:
 *
 *  1. `formulaSetFingerprint(template)` — chỉ phụ thuộc MẪU. Đây là thứ `GET /payroll/templates/:id` (051)
 *     trả về. Không băm kèm bản tỉ lệ: tỉ lệ đi theo KỲ (bản hiệu lực tại ngày cuối kỳ), nên một fingerprint
 *     cấp mẫu có băm tỉ lệ thì không so được với dòng lương của kỳ nào.
 *  2. `lineFingerprint(setFp, statutoryRateId)` — thứ BE-3 ghi vào `payroll_period_lines.template_fingerprint`.
 *     Băng «mẫu đã đổi kể từ lần tính gần nhất» so `line.template_fingerprint` với
 *     `lineFingerprint(formulaSetFingerprint(mẫu hiện tại), line.statutory_rate_id_đã_dùng)`.
 *
 * Chuẩn tắc: sắp theo `(sortOrder, code)`; `fixedAmount` chuẩn hoá về 2 chữ số thập phân để `"730000"` và
 * `"730000.00"` cho cùng một hash.
 */

export interface FingerprintComponent {
  readonly code: string;
  readonly kind: string;
  readonly valueType: string;
  /** Công thức HIỆU LỰC (ghi đè ?? catalog). */
  readonly formula: string | null;
  readonly fixedAmount: string | null;
  readonly pitDeductible: boolean;
  readonly isVisible: boolean;
  readonly sortOrder: number;
}

const sha256 = (input: string): string => createHash("sha256").update(input, "utf8").digest("hex");

export function formulaSetFingerprint(components: readonly FingerprintComponent[]): string {
  const canonical = [...components]
    // Mã DUY NHẤT trong một mẫu (UNIQUE `payroll_template_components_tpl_component_uq`) ⇒ không có hoà mã.
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.code < b.code ? -1 : 1))
    .map((c) => [
      c.code,
      c.kind,
      c.valueType,
      c.formula,
      c.fixedAmount === null ? null : new D(c.fixedAmount).toFixed(2),
      c.pitDeductible,
      c.isVisible,
      c.sortOrder,
    ]);
  return sha256(JSON.stringify(canonical));
}

export function lineFingerprint(formulaSetFp: string, statutoryRateId: string | null): string {
  return sha256(`${formulaSetFp}:${statutoryRateId ?? "none"}`);
}
