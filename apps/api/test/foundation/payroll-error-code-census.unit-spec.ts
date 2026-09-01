/**
 * S13-PAYROLL-BE-1 — CENSUS "mã lỗi / `kind` PAYROLL được NÉM mà KHÔNG có ca test nào"
 * (SPEC-11 §12, khuôn `recruit-error-code-census`). Bài học `coverage-high-but-error-code-untested`:
 * coverage 97.5% vẫn có thể lọt một mã lỗi 0 ca.
 *
 * LUẬT ĐANG ĐO:
 *  (1) key của `PAYROLL_ERR_CODE` được NÉM ở `src/payroll/**` ⇒ mã tương ứng PHẢI xuất hiện trong ít
 *      nhất một assert của bề mặt test PAYROLL (`test/integration/*payroll*` ∪ `src/payroll/*.spec.ts`);
 *  (2) mỗi `kind` ném được (literal `payrollDetails("…")` hoặc `message: "<kind>"` trong mảng
 *      `ErrorDetail`) cũng phải có ca;
 *  (3) **`PAYROLL_PENDING_BE2_ERRORS` là CỔNG hai chiều**: mã trong danh sách đó phải CHƯA được ném ở
 *      `src/payroll/**`, và mã đã ném thì KHÔNG được nằm trong danh sách ⇒ BE-2 ném một mã mà quên gỡ
 *      khỏi danh sách là ĐỎ (chống bẫy "khai sẵn rồi để trần").
 *
 * LỚP BẰNG CHỨNG: quét TĨNH trên chuỗi — không chứng minh ca test ĐÚNG, chỉ chặn mã thứ N mọc lên mà
 * không ai đo (khuôn `route-census-runtime-gate`).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAYROLL_ERR_CODE, PAYROLL_PENDING_BE2_ERRORS } from "../../src/payroll/payroll.errors";

const PAYROLL_SRC = path.join(__dirname, "..", "..", "src", "payroll");
const INTEGRATION = path.join(__dirname, "..", "integration");

/** Bỏ comment TRƯỚC khi quét — docblock nhắc mã KHÔNG phải bằng chứng (`vitest-exclude-selfcheck-reads-comments`). */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readAll = (dir: string, match: (name: string) => boolean): string =>
  fs
    .readdirSync(dir)
    .filter(match)
    .map((n) => stripComments(fs.readFileSync(path.join(dir, n), "utf8")))
    .join("\n");

describe("S13-PAYROLL-BE-1 census — mã lỗi & kind PAYROLL được ném đều có ca test", () => {
  const implSrc = readAll(
    PAYROLL_SRC,
    (n) => n.endsWith(".ts") && !n.endsWith(".spec.ts") && n !== "payroll.errors.ts",
  );
  // `payroll.errors.ts` vừa ĐỊNH NGHĨA vừa NÉM thật (`mapPayrollPgError`, `payrollNotFound`) — tính
  // vào nguồn ném NHƯNG bỏ các khối khai báo hằng, kẻo file tự chứng minh chính nó.
  const errorsFile = stripComments(
    fs.readFileSync(path.join(PAYROLL_SRC, "payroll.errors.ts"), "utf8"),
  )
    .replace(/export const PAYROLL_ERR_CODE = \{[\s\S]*?\} as const;/, "")
    .replace(/export const PAYROLL_ERR = \{[\s\S]*?\n\} as const;/, "")
    .replace(/export const PAYROLL_PENDING_BE2_ERRORS[\s\S]*?\];/, "");

  const thrownSrc = `${implSrc}\n${errorsFile}`;
  const testSurface = [
    readAll(PAYROLL_SRC, (n) => n.endsWith(".spec.ts")),
    readAll(
      INTEGRATION,
      (n) => /payroll/i.test(n) && (n.endsWith(".int-spec.ts") || n.endsWith(".unit-spec.ts")),
    ),
  ].join("\n");

  /**
   * "Được ném" = key xuất hiện ở nguồn ném theo MỘT trong HAI dạng (đã bỏ khối khai báo hằng):
   *  · qua helper — `payrollConflict("KEY", …)` ⇒ chuỗi `"KEY"`;
   *  · tham chiếu trực tiếp — `PAYROLL_ERR_CODE.KEY` (khuôn ROOM), dùng khi ném `ConflictException`
   *    thẳng (ví dụ `assertReopenAllowed` trong `payroll-fsm.ts`).
   * Chỉ nhận dạng MỘT dạng là bỏ sót mã thật — đúng cái census này sinh ra để chặn.
   */
  const isThrown = (constName: string): boolean =>
    // So CHUỖI, không regex: trong template literal `\b` là ký tự BACKSPACE và `\.` mất dấu escape,
    // nên `new RegExp(`…\.${k}\b`)` âm thầm không khớp gì (đã dính một lần khi viết cổng này).
    thrownSrc.includes(`"${constName}"`) || thrownSrc.includes(`PAYROLL_ERR_CODE.${constName}`);

  const codeEntries = Object.entries(PAYROLL_ERR_CODE) as Array<[string, string]>;
  const pending = new Set<string>(PAYROLL_PENDING_BE2_ERRORS);

  it.each(codeEntries)(
    "mã %s (%s): ném ở src ⇒ có ca test; hoãn ⇒ nằm trong PENDING_BE2",
    (name, code) => {
      const thrown = isThrown(name);
      if (pending.has(name)) {
        // Cổng chiều 1: mã hoãn KHÔNG được ném ở BE-1. BE-2 ném nó ⇒ phải gỡ khỏi danh sách.
        expect(
          thrown,
          `${name} đã được ném ở src/payroll nhưng vẫn nằm trong PAYROLL_PENDING_BE2_ERRORS — gỡ khỏi danh sách và thêm ca test`,
        ).toBe(false);
        return;
      }
      // Cổng chiều 2: mã KHÔNG hoãn thì phải vừa được ném, vừa có ca test neo mã.
      expect(thrown, `${name} không được ném ở src/payroll — gỡ hằng hoặc khai PENDING_BE2`).toBe(
        true,
      );
      expect(
        testSurface.includes(code),
        `mã ${code} (${name}) được ném nhưng KHÔNG spec nào của PAYROLL assert nó`,
      ).toBe(true);
    },
  );

  it("PENDING_BE2 đúng 9 mã và là tập con của bảng mã", () => {
    // BE-1 ném 8 mã: 001 · 004 (assertReopenAllowed) · 008 · 010 · 011 · 012 · 013 · 014 ⇒ 17 − 8 = 9.
    expect(pending.size).toBe(9);
    const all = new Set(Object.keys(PAYROLL_ERR_CODE));
    expect(
      [...pending].filter((k) => !all.has(k)),
      "PENDING_BE2 giữ mã không tồn tại",
    ).toEqual([]);
  });

  /** Tập `kind` ném được — `\s*` nuốt chỗ Prettier ngắt dòng sau dấu `(`. */
  const kinds = (): string[] => {
    const out = new Set<string>();
    for (const m of thrownSrc.matchAll(/payrollDetails\(\s*"([a-z0-9-]+)"/g)) out.add(m[1]);
    // Dạng thứ hai: mảng ErrorDetail viết thẳng `{ field: "kind", message: "<kind>" … }`.
    for (const m of thrownSrc.matchAll(/field:\s*"kind"\s*,\s*message:\s*"([a-z0-9-]+)"/g)) {
      out.add(m[1]);
    }
    return [...out].sort();
  };

  it("mọi `kind` ném được đều có ít nhất một ca test neo nó", () => {
    const list = kinds();
    // Chốt chặn xanh-RỖNG: regex hỏng ⇒ 0 kind ⇒ ca này vô nghĩa.
    expect(list.length, "scanner kind trả 0 — regex hỏng").toBeGreaterThanOrEqual(6);
    expect(
      list.filter((k) => !testSurface.includes(`"${k}"`) && !testSurface.includes(`'${k}'`)),
      "kind được ném nhưng KHÔNG spec nào assert",
    ).toEqual([]);
  });
});
