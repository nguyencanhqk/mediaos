import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S15-PAYROLL-BE-2 — CENSUS KIẾN TRÚC máy công thức lương (SPEC-11 §13.6 A · DECISIONS-14 §2.3).
 *
 * Hai điều cấm «sống trong văn xuôi là sẽ trôi» được biến thành cổng:
 *  1. **Không thực thi mã động** — `eval` · `Function(` · `new RegExp(` từ input. Một `Function(...)` trong vùng
 *     crown là RCE (SPEC-11 §18.1 D).
 *  2. **Không số thực trên tiền** — `Number(` · `parseFloat(` · `parseInt(` · `Math.` · `JSON.parse`. `numeric`
 *     từ driver `pg` về JS là CHUỖI và phải vào thẳng `new D(str)` (DECISIONS-14 §2.3.2).
 *
 * Quét ĐỆ QUY `src/payroll/formula/**` (bỏ `*.spec.ts` — test cố ý chứa chuỗi `eval(1)`). Bỏ comment TRƯỚC khi
 * quét (docblock nhắc tên cấm KHÔNG phải vi phạm — `vitest-exclude-selfcheck-reads-comments`).
 */

const FORMULA_DIR = path.join(__dirname, "..", "..", "src", "payroll", "formula");

const BANNED: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "eval(", re: /\beval\s*\(/ },
  { name: "Function(", re: /\bFunction\s*\(/ },
  { name: "new Function", re: /\bnew\s+Function\b/ },
  { name: "new RegExp", re: /\bnew\s+RegExp\b/ },
  { name: "Number(", re: /\bNumber\s*\(/ },
  { name: "parseFloat(", re: /\bparseFloat\s*\(/ },
  { name: "parseInt(", re: /\bparseInt\s*\(/ },
  { name: "Math.", re: /\bMath\./ },
  { name: "JSON.parse", re: /\bJSON\.parse\b/ },
];

const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts") ? [full] : [];
  });
}

describe("S15-PAYROLL-BE-2 census — kiến trúc máy công thức", () => {
  const files = walk(FORMULA_DIR);

  it("neo chống xanh-RỖNG: quét đủ file lõi của engine", () => {
    const names = files.map((f) => path.basename(f)).sort();
    for (const core of [
      "formula.decimal.ts",
      "formula.evaluator.ts",
      "formula.graph.ts",
      "formula.parser.ts",
      "formula.tokenizer.ts",
    ]) {
      expect(names, `thiếu ${core} ⇒ census không quét gì`).toContain(core);
    }
  });

  it("tự-kiểm: mỗi mẫu cấm THỰC SỰ bắt được một dòng vi phạm (regex không hỏng im lặng)", () => {
    const samples: Record<string, string> = {
      "eval(": "eval (x)",
      "Function(": "Function('return 1')",
      "new Function": "new Function",
      "new RegExp": "new RegExp(input)",
      "Number(": "Number(row.amount)",
      "parseFloat(": "parseFloat(s)",
      "parseInt(": "parseInt(s, 10)",
      "Math.": "Math.round(x)",
      "JSON.parse": "JSON.parse(body)",
    };
    for (const { name, re } of BANNED) expect(re.test(samples[name]), name).toBe(true);
    // Và KHÔNG bắt nhầm phương thức hợp lệ của decimal.js:
    expect(/\bNumber\s*\(/.test("x.toNumber()")).toBe(false);
  });

  it("0 vi phạm trong src/payroll/formula/**", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(fs.readFileSync(file, "utf8"));
      for (const { name, re } of BANNED) {
        code.split("\n").forEach((line, i) => {
          if (re.test(line)) offenders.push(`${path.basename(file)}:${i + 1} dùng ${name}`);
        });
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
