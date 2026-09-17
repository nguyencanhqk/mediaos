/**
 * S13-PAYROLL-FE-1 — **census `kind` lỗi PAYROLL**: bảng `PAYROLL_ERROR_KINDS` (FE) phải khớp ĐÚNG BẰNG
 * tập `kind` mà BE thật sự phát ra.
 *
 * ⚠️ **BA hình dạng, không phải một.** Đây là lý do spec tồn tại chứ không phải một bảng chép tay:
 *   1. `payrollDetails("<kind>")`;
 *   2. inline `{ field: "kind", message: "<kind>", rule: "payroll" }` (3 chỗ ở `bonus-penalties.service.ts`);
 *   3. qua helper cục bộ `conflict(message, kind)` của `payroll-fsm.ts` — gọi `payrollDetails(kind)` với
 *      **BIẾN**, nên grep literal KHÔNG thấy. `invalid-transition` chỉ sống ở hình dạng này.
 *
 * Grep một hình là sót — đúng lớp lỗi `identity-projection-census-misses-alias`. Ca đầu neo SỐ LƯỢNG
 * đọc được từ mỗi hình dạng: nếu BE đổi cách viết và một regex khớp 0 dòng, spec ĐỎ thay vì xanh-rỗng.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PAYROLL_ERROR_KINDS,
  PAYROLL_FORMULA_ERROR_KINDS,
  formulaIssueText,
  payrollErrorI18nKey,
  payrollErrorText,
  parsePayrollError,
} from "./payroll-errors";
import viPayroll from "@/i18n/locales/vi/payroll";

const repoRoot = path.resolve(__dirname, "../../../../..");
const payrollDir = path.join(repoRoot, "apps/api/src/payroll");

function beSources(): string {
  return fs
    .readdirSync(payrollDir)
    .filter((f) => f.endsWith(".ts") && !f.includes(".spec."))
    .map((f) => fs.readFileSync(path.join(payrollDir, f), "utf8"))
    .join("\n");
}

const src = beSources();

/** Hình 1 — `payrollDetails("<kind>")`. */
const shape1 = [...src.matchAll(/payrollDetails\(\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
/** Hình 2 — inline ErrorDetail. */
const shape2 = [...src.matchAll(/field:\s*"kind"\s*,\s*message:\s*"([a-z0-9-]+)"/g)].map(
  (m) => m[1],
);
/**
 * Hình 3 — helper cục bộ `conflict(<message>, "<kind>")` của payroll-fsm.ts.
 *
 * ⚠️ Đối số thứ nhất CHÍNH NÓ chứa dấu phẩy (`PAYROLL_ERR.PERIOD_TRANSITION(from, to)`), nên
 * `conflict\([^,]+,` khớp **0 dòng** — bản đầu của spec này viết đúng như vậy và neo số lượng bên dưới
 * bắt được. Phải cho phép MỘT cấp ngoặc lồng. `\bconflict` phân biệt hoa/thường nên không dính
 * `payrollConflict(...)` (hình 1/2 đã phủ chỗ đó).
 */
const shape3 = [...src.matchAll(/\bconflict\((?:[^()]|\([^()]*\))*,\s*"([a-z0-9-]+)"\s*\)/g)].map(
  (m) => m[1],
);

describe("PAYROLL error-kind census — FE khớp BE (đo theo BA hình dạng)", () => {
  it("mỗi hình dạng đọc được ÍT NHẤT một kind (regex không mù)", () => {
    expect(shape1.length).toBeGreaterThan(0);
    // Neo cứng 3: đúng số chỗ viết inline ở `bonus-penalties.service.ts`. Thêm chỗ thứ tư mà quên bảng
    // FE thì ca này đỏ trước, không đợi người dùng thấy "Đã có lỗi xảy ra".
    expect(shape2.length).toBe(3);
    expect(shape3.length).toBe(2);
  });

  it("hình 3 CÓ bắt `invalid-transition` — kind mà grep literal bỏ sót", () => {
    expect(shape3).toContain("invalid-transition");
    expect(shape1).not.toContain("invalid-transition");
  });

  it("tập kind FE === tập kind BE, đúng bằng", () => {
    const be = [...new Set([...shape1, ...shape2, ...shape3])].sort();
    expect([...PAYROLL_ERROR_KINDS].sort()).toEqual(be);
  });

  it("không kind nào 0 khoá i18n — và khoá phải TỒN TẠI trong bundle vi", () => {
    const errors = viPayroll.errors as Record<string, string>;
    for (const kind of PAYROLL_ERROR_KINDS) {
      const key = payrollErrorI18nKey({
        code: null,
        status: 409,
        kind,
        message: "",
        fields: new Map(),
      });
      expect(key, `${kind} rơi về generic`).not.toBe("errors.generic");
      const leaf = key.replace(/^errors\./, "");
      expect(errors[leaf], `thiếu bản dịch cho ${kind} (${key})`).toBeTruthy();
    }
  });

  it("kind lạ rơi về `errors.generic` (fallback không ném)", () => {
    const key = payrollErrorI18nKey({
      code: null,
      status: 409,
      kind: "kind-khong-ton-tai",
      message: "",
      fields: new Map(),
    });
    expect(key).toBe("errors.generic");
  });

  it("S15-PAYROLL-FE-2 · hình 4: khoá `FORMULA_ERROR_KINDS` (BE) === `PAYROLL_FORMULA_ERROR_KINDS` (FE), đúng bằng", () => {
    // BE phát nhóm này qua `payrollDetails(err.kind, …)` — BIẾN ⇒ ba hình trên mù. Đọc thẳng bảng đóng.
    const formulaSrc = fs.readFileSync(path.join(payrollDir, "formula/formula.errors.ts"), "utf8");
    const block = formulaSrc.match(/export const FORMULA_ERROR_KINDS = \{([\s\S]*?)\} as const;/);
    expect(block, "không tìm thấy khối FORMULA_ERROR_KINDS").toBeTruthy();
    const beKinds = [...(block?.[1] ?? "").matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]);
    // Neo SỐ LƯỢNG để regex mù (0 khớp) không thành xanh-rỗng.
    expect(beKinds.length).toBe(15);
    expect([...PAYROLL_FORMULA_ERROR_KINDS].sort()).toEqual([...beKinds].sort());
  });

  it("mọi kind công thức có chữ vi riêng (không rơi generic)", () => {
    const errors = viPayroll.errors as Record<string, string>;
    for (const kind of PAYROLL_FORMULA_ERROR_KINDS) {
      const key = payrollErrorI18nKey({
        code: null,
        status: 422,
        kind,
        message: "",
        fields: new Map(),
      });
      expect(key, `${kind} rơi về generic`).not.toBe("errors.generic");
      expect(errors[key.replace(/^errors\./, "")], `thiếu bản dịch ${kind}`).toBeTruthy();
    }
  });

  it("chữ lỗi công thức nói được CHỖ SAI: pos (+1) · ref · cycle — cả từ 422 lẫn từ 048", () => {
    const t = (key: string, opts?: Record<string, unknown>) =>
      `${key}|${JSON.stringify(opts ?? {})}`;
    const from422 = payrollErrorText(t, {
      code: "PAYROLL-ERR-018",
      status: 422,
      kind: "formula-unknown-ref",
      message: "",
      fields: new Map([
        ["kind", "formula-unknown-ref"],
        ["pos", "4"],
        ["ref", "LUONG_X"],
      ]),
    });
    expect(from422).toContain("errors.formulaUnknownRef");
    expect(from422).toContain("ký tự thứ 5");
    expect(from422).toContain("LUONG_X");

    const from048 = formulaIssueText(t, { kind: "formula-cycle", cycle: ["A", "B", "A"] });
    expect(from048).toContain("errors.formulaCycle");
    expect(from048).toContain("A → B → A");
    // Không có vị trí ⇒ `at` rỗng, KHÔNG in «ký tự thứ NaN».
    expect(from048).not.toContain("NaN");
  });

  it("`details` sai hình dạng (object thay vì MẢNG) ⇒ kind null, KHÔNG ném", () => {
    // memory `error-details-must-be-errordetail-array`: đọc details như object là nuốt lỗi im lặng.
    const info = parsePayrollError(new Error("boom"));
    expect(info.kind).toBeNull();
    expect(info.fields.size).toBe(0);
  });
});
