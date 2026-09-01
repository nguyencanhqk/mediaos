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
import { PAYROLL_ERROR_KINDS, payrollErrorI18nKey, parsePayrollError } from "./payroll-errors";
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

  it("`details` sai hình dạng (object thay vì MẢNG) ⇒ kind null, KHÔNG ném", () => {
    // memory `error-details-must-be-errordetail-array`: đọc details như object là nuốt lỗi im lặng.
    const info = parsePayrollError(new Error("boom"));
    expect(info.kind).toBeNull();
    expect(info.fields.size).toBe(0);
  });
});
