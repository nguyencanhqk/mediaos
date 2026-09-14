import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * S15-PAYROLL-BE-2 — census TĨNH advisory lock catalog (database-review BE-2 LOW-3).
 *
 * `payrollCatalogLockTx` là chốt DUY NHẤT chặn (a) vòng phụ thuộc sinh ra do hai lượt ghi SONG SONG và (b) seeder lúc
 * boot đua với 053. Gỡ lời gọi khoá khỏi một method thì MỌI ca int vẫn xanh (không ca nào ghi đồng thời) ⇒ census
 * này ghim hai vế:
 *  1. mỗi method GHI catalog/mẫu gọi khoá TRƯỚC lần chạm DB đầu tiên trong thân method;
 *  2. KHÔNG method nào khác của hai service gọi repo GHI mà vắng mặt trong bảng — method ghi mới mọc lên quên khoá
 *     thì đỏ ở đây, không âm thầm lọt.
 * 056/058 (tỉ lệ luật định) cố ý KHÔNG khoá: không chạm catalog hay `payroll_template_components`.
 */

const PAYROLL = join(__dirname, "..", "..", "src", "payroll");
/** Tiền tố — service gọi `(tx, …)`, seeder gọi `(ctx.tx, …)`. */
const LOCK_CALL = "payrollCatalogLockTx(";
/** Mọi lần chạm DB có thể có trong thân method — khoá phải đứng TRƯỚC tất cả. */
const DB_TOUCH = [
  ".findTx(",
  ".findManyTx(",
  ".listActiveTx(",
  ".orgUnitLiveTx(",
  ".templatesContainingTx(",
  ".componentsTx(",
  ".createTx(",
  ".updateTx(",
  ".softDeleteTx(",
  ".replaceComponentsTx(",
  ".insert(",
  ".select(",
];
const WRITE_CALLS = [".createTx(", ".updateTx(", ".softDeleteTx(", ".replaceComponentsTx("];

const SERVICES: ReadonlyArray<{ file: string; locked: readonly string[] }> = [
  { file: "salary-components.service.ts", locked: ["create", "update"] },
  { file: "payroll-templates.service.ts", locked: ["create", "update", "putComponents"] },
];
const SEEDER = { file: "payroll-master-data.seeder.ts", locked: ["seed"] } as const;

const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "return", "constructor"]);

/** Thân từng thành viên class: từ khai báo (thụt lề 2) tới khai báo kế tiếp cùng thụt lề, hoặc hết file. */
function memberBodies(src: string): Map<string, string> {
  const decl = /^ {2}(?:public |private |protected )?(?:static )?(?:async )?([A-Za-z_]\w*)\s*\(/gm;
  const starts: Array<{ name: string; at: number }> = [];
  for (const m of src.matchAll(decl)) {
    if (!KEYWORDS.has(m[1])) starts.push({ name: m[1], at: m.index as number });
  }
  return new Map(
    starts.map((s, i) => [
      s.name,
      src.slice(s.at, i + 1 < starts.length ? starts[i + 1].at : src.length),
    ]),
  );
}

function violation(body: string): string | null {
  const lock = body.indexOf(LOCK_CALL);
  if (lock < 0) return "thiếu payrollCatalogLockTx";
  const touches = DB_TOUCH.map((t) => body.indexOf(t)).filter((i) => i >= 0);
  const first = touches.length > 0 ? Math.min(...touches) : Number.POSITIVE_INFINITY;
  return first < lock ? `khoá đứng SAU lần chạm DB đầu tiên (@${first} < @${lock})` : null;
}

const bodiesOf = (file: string) => memberBodies(readFileSync(join(PAYROLL, file), "utf8"));

describe("S15-PAYROLL-BE-2 · census advisory lock catalog (database-review LOW-3)", () => {
  for (const { file, locked } of [...SERVICES, SEEDER]) {
    it.each(locked)(`${file} · %s gọi khoá TRƯỚC lần chạm DB đầu tiên`, (name) => {
      const body = bodiesOf(file).get(name);
      expect(body, `không tìm thấy method ${name} trong ${file}`).toBeDefined();
      expect(violation(body as string), `${file}#${name}`).toBeNull();
    });
  }

  it("KHÔNG method nào khác của hai service gọi repo GHI mà vắng khỏi bảng khoá", () => {
    for (const { file, locked } of SERVICES) {
      const writers = [...bodiesOf(file)]
        .filter(([, body]) => WRITE_CALLS.some((w) => body.includes(w)))
        .map(([name]) => name)
        .sort();
      expect(writers, `${file}: method ghi mới phải vào bảng khoá (và gọi khoá)`).toEqual(
        [...locked].sort(),
      );
    }
  });

  it("tự kiểm: thiếu khoá · khoá SAU findTx ⇒ bắt được; khoá trước ⇒ sạch; tách thân đúng thành viên", () => {
    expect(violation("async x() { await this.repo.findTx(tx, c, id); }")).toMatch(/thiếu/);
    expect(violation(`async x() { await this.repo.findTx(tx); await ${LOCK_CALL}c); }`)).toMatch(
      /SAU/,
    );
    expect(violation(`async x() { await ${LOCK_CALL}c); await this.repo.findTx(tx); }`)).toBeNull();
    const m = memberBodies("class A {\n  async a() {\n  if (x) {}\n  }\n\n  private b() {}\n}\n");
    expect([...m.keys()]).toEqual(["a", "b"]);
  });
});
