/**
 * S15-PAYROLL-QA-1 — CENSUS "ràng buộc DB PAYROLL ⇒ SQLSTATE ⇒ mã" (SPEC-11 §21.1 mục 30(b) · dòng
 * "QA census bắt buộc" ngay dưới bảng ràng buộc, `docs/spec/SPEC-11 PAYROLL.md:737-765`).
 *
 * Khuôn: `payroll-error-code-census.unit-spec.ts` (S13-PAYROLL-BE-1) — bỏ comment TRƯỚC khi quét
 * (docblock nhắc TÊN không phải bằng chứng, `vitest-exclude-selfcheck-reads-comments`).
 *
 * LUẬT ĐANG ĐO (đúng nguyên văn dòng 765 của SPEC):
 *  (1) mỗi TÊN ràng buộc (cột 1, không phải trigger) VÀ mỗi TÊN trigger phải xuất hiện trong
 *      `mapPayrollPgError` (`payroll.errors.ts` + `payroll-pg-write.util.ts`) — hàng có cột HTTP = "—"
 *      là CỐ Ý không map (500 có chủ đích), pin RIÊNG một danh sách, không bỏ qua âm thầm;
 *  (2) mỗi TÊN ràng buộc VÀ mỗi cặp `trigger:tag` phải có bằng chứng trong bề mặt test
 *      (`test/integration/*.int-spec.ts` khớp /payroll/i) — ràng buộc có mà không map ⇒ 500 vùng đỏ;
 *      map mà không ca ⇒ `coverage-high-but-error-code-untested`.
 *
 * ⚠️ BẪY PARSER — `expectTag(err, T1, "tag")`: `s15-payroll-db2-invariants.int-spec.ts` bắn ĐỦ 15 cặp
 * trigger:tag ở tầng SQLSTATE thật, nhưng đa số qua helper `expectTag(err, trigger, tag)` với `trigger`
 * là BIẾN (`const T1 = "payroll_payment_batch_freeze"`), KHÔNG phải chuỗi nối chết `"trigger:tag"` như
 * `s15-payroll-be4-batches.int-spec.ts:627` (`expect.stringMatching(/^payroll_payment_batch_freeze:frozen:/)`).
 * Quét CHỈ chuỗi nối chết sẽ báo 12/15 cặp "THIẾU" dù đã có ca DB thật — SAI, không phải xanh-giả mà là
 * ĐỎ-GIẢ (báo thiếu bằng chứng khi bằng chứng có thật). Scanner dưới đây nhận CẢ HAI dạng: chuỗi nối chết
 * VÀ alias `const NAME = "trigger"` + lệnh gọi `expectTag(..., NAME, "tag")`.
 *
 * LỚP BẰNG CHỨNG: quét TĨNH trên chuỗi — không chứng minh ca test ĐÚNG (không gọi `mapPayrollPgError`
 * thật ở đây), chỉ chặn tên/cặp thứ N mọc lên mà không ai đo (`route-census-runtime-gate`). Việc gọi
 * `mapPayrollPgError` với lỗi PG THẬT + so khớp mã/HTTP đúng bảng nằm ở
 * `test/integration/s15-payroll-qa1-constraints.int-spec.ts` (int-spec cùng cặp).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");
const SPEC_PATH = path.join(REPO_ROOT, "docs", "spec", "SPEC-11 PAYROLL.md");
const PAYROLL_SRC = path.join(__dirname, "..", "..", "src", "payroll");
const INTEGRATION = path.join(__dirname, "..", "integration");

/** Bỏ comment TRƯỚC khi quét — docblock nhắc mã KHÔNG phải bằng chứng (`vitest-exclude-selfcheck-reads-comments`). */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const readSrc = (rel: string): string =>
  stripComments(fs.readFileSync(path.join(PAYROLL_SRC, rel), "utf8"));

const readAllInt = (match: (name: string) => boolean): { text: string; files: string[] } => {
  const files = fs.readdirSync(INTEGRATION, { withFileTypes: true }).filter((e) => e.isFile());
  const picked = files.map((f) => f.name).filter(match);
  const text = picked
    .map((n) => stripComments(fs.readFileSync(path.join(INTEGRATION, n), "utf8")))
    .join("\n");
  return { text, files: picked };
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 1. Parser bảng SPEC-11 (dòng 739-763) — "Ràng buộc (TÊN thật) | SQLSTATE | ⇒ HTTP | Mã + kind"
// ════════════════════════════════════════════════════════════════════════════════════════════════

interface ConstraintRow {
  /** Tên ràng buộc thật (UNIQUE/CHECK/EXCLUDE) — hàng KHÔNG phải trigger. */
  name: string;
  http: string;
}
interface TriggerTagRow {
  trigger: string;
  tag: string;
  http: string;
}

interface ParsedTable {
  constraints: ConstraintRow[];
  triggerNames: Set<string>;
  tags: TriggerTagRow[];
  /** Số dòng bảng đã ăn khớp `|...|` (kể cả dòng phân cách) — self-check chống parser vỡ. */
  rawRowCount: number;
}

/** `_(mig \`0572\`)_` v.v. gắn backtick quanh SỐ migration — không phải tên ràng buộc, loại theo /^\d+$/. */
const isMigrationNumber = (s: string): boolean => /^\d+$/.test(s);

function parseConstraintTable(specMarkdown: string): ParsedTable {
  const lines = specMarkdown.split(/\r?\n/);
  const headerIdx = lines.findIndex((l) => l.includes("Ràng buộc (TÊN thật)"));
  if (headerIdx === -1) {
    throw new Error(
      "parseConstraintTable: không tìm thấy header 'Ràng buộc (TÊN thật)' trong SPEC-11 — bảng đã đổi vị trí/chữ, sửa anchor",
    );
  }

  const rows: string[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.startsWith("**QA census bắt buộc**")) break; // mốc kết thúc (dòng 765)
    const stripped = raw.replace(/^>\s*/, ""); // dòng 763 bị blockquote `> |` bọc
    if (!stripped.trim().startsWith("|")) continue; // bỏ dòng văn xuôi xen giữa (dòng 762 mô tả TAG)
    if (stripped.includes("---")) continue; // dòng phân cách markdown
    rows.push(stripped);
  }

  const constraints: ConstraintRow[] = [];
  const triggerNames = new Set<string>();
  const tags: TriggerTagRow[] = [];

  for (const row of rows) {
    const cells = row
      .split("|")
      .map((s) => s.trim())
      .filter((s, idx, arr) => !(idx === 0 && s === "") && !(idx === arr.length - 1 && s === ""));
    if (cells.length < 3) continue; // dòng bảng không đủ 4 cột — bỏ, không phải hàng dữ liệu
    const [col1, , http] = cells;
    const backticks = [...col1.matchAll(/`([a-zA-Z0-9_-]+)`/g)]
      .map((m) => m[1])
      .filter((t) => !isMigrationNumber(t));
    if (backticks.length === 0) continue;

    if (col1.includes("trigger")) {
      const [trigger, ...tagList] = backticks;
      triggerNames.add(trigger);
      for (const tag of tagList) tags.push({ trigger, tag, http });
    } else {
      for (const name of backticks) constraints.push({ name, http });
    }
  }

  return { constraints, triggerNames, tags, rawRowCount: rows.length };
}

const specMarkdown = fs.readFileSync(SPEC_PATH, "utf8");
const parsed = parseConstraintTable(specMarkdown);

// ── Neo chống parser-vỡ-thành-xanh-rỗng — đếm TAY từ bảng (SPEC-11 dòng 741-763), hard-code ────────
// 17 tên ràng buộc thật (một số dòng gộp 2 tên bằng " · ", vd dòng 747/760) + 3 trigger + 15 cặp
// trigger:tag (5 payroll_advance_freeze_guard · 4 payroll_payment_batch_freeze · 6 payroll_payment_line_guard),
// trong đó 4 cặp CỐ Ý không map (cột HTTP = "—", dòng 758-759).
const EXPECTED_CONSTRAINT_NAME_COUNT = 17;
const EXPECTED_TRIGGER_NAME_COUNT = 3;
const EXPECTED_TAG_PAIR_COUNT = 15;
const EXPECTED_UNMAPPED_TAG_COUNT = 4;
const EXPECTED_MAPPED_TAG_COUNT = EXPECTED_TAG_PAIR_COUNT - EXPECTED_UNMAPPED_TAG_COUNT;

const UNMAPPED_BY_DESIGN = new Set([
  "payroll_payment_line_guard:cross-user",
  "payroll_payment_line_guard:cross-period",
  "payroll_payment_line_guard:not-found",
  "payroll_payment_batch_freeze:has-active-lines",
]);

describe("S15-PAYROLL-QA-1 census — parser bảng ràng buộc SPEC-11 §21 (chống xanh-rỗng)", () => {
  it(`đếm ĐÚNG ${EXPECTED_CONSTRAINT_NAME_COUNT} tên ràng buộc thật (đếm tay dòng 741-763)`, () => {
    expect(parsed.constraints.length).toBe(EXPECTED_CONSTRAINT_NAME_COUNT);
  });
  it(`đếm ĐÚNG ${EXPECTED_TRIGGER_NAME_COUNT} tên trigger`, () => {
    expect(parsed.triggerNames.size).toBe(EXPECTED_TRIGGER_NAME_COUNT);
  });
  it(`đếm ĐÚNG ${EXPECTED_TAG_PAIR_COUNT} cặp trigger:tag`, () => {
    expect(parsed.tags.length).toBe(EXPECTED_TAG_PAIR_COUNT);
  });
  it(`đếm ĐÚNG ${EXPECTED_UNMAPPED_TAG_COUNT} cặp CỐ Ý không map (cột HTTP "—") và ĐÚNG ${EXPECTED_MAPPED_TAG_COUNT} cặp CÓ map`, () => {
    const unmapped = parsed.tags.filter((t) => t.http.includes("—"));
    const mappedTags = parsed.tags.filter((t) => !t.http.includes("—"));
    expect(unmapped.map((t) => `${t.trigger}:${t.tag}`).sort()).toEqual(
      [...UNMAPPED_BY_DESIGN].sort(),
    );
    expect(mappedTags.length).toBe(EXPECTED_MAPPED_TAG_COUNT);
  });
  it("scanner đọc được > 15 dòng bảng thô (chặn regex vỡ ⇒ 0 dòng)", () => {
    expect(parsed.rawRowCount).toBeGreaterThan(15);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2. Nguồn map (`payroll.errors.ts` + `payroll-pg-write.util.ts`) — luật (1)
// ════════════════════════════════════════════════════════════════════════════════════════════════

const mapperSrc = `${readSrc("payroll.errors.ts")}\n${readSrc("payroll-pg-write.util.ts")}`;

describe("S15-PAYROLL-QA-1 census — mỗi TÊN ràng buộc/trigger xuất hiện trong mapPayrollPgError", () => {
  it.each(parsed.constraints.map((c) => c.name))(
    "ràng buộc `%s` xuất hiện trong nguồn map",
    (name) => {
      expect(
        mapperSrc.includes(name),
        `\`${name}\` không thấy trong payroll.errors.ts/payroll-pg-write.util.ts (comment đã bỏ) — ` +
          `thiếu nhánh map ⇒ vi phạm rơi 500 ở vùng đỏ (SPEC-11 dòng 765)`,
      ).toBe(true);
    },
  );

  it.each([...parsed.triggerNames])("trigger `%s` xuất hiện trong nguồn map", (trigger) => {
    expect(
      mapperSrc.includes(trigger),
      `trigger \`${trigger}\` không thấy trong nguồn map — mọi tag của nó (kể cả tag CỐ Ý unmapped) cần trigger name để rơi đúng nhánh \`if\``,
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 3. Bề mặt test PAYROLL (`test/integration/*.int-spec.ts` khớp /payroll/i) — luật (2)
// ════════════════════════════════════════════════════════════════════════════════════════════════

const { text: rawIntSurface, files: intFiles } = readAllInt(
  (n) => /payroll/i.test(n) && n.endsWith(".int-spec.ts"),
);

/**
 * Alias `const NAME = "trigger_literal"` — khuôn `s15-payroll-db2-invariants.int-spec.ts`
 * (`const T1 = "payroll_payment_batch_freeze"`, …) rồi gọi `expectTag(err, T1, "tag")`. Không giải
 * alias thì scanner CHỈ thấy 3/15 cặp (những cặp file be4-batches nối chuỗi chết) — báo ĐỎ-GIẢ.
 */
function resolveTriggerAliases(src: string, triggerNames: Set<string>): Map<string, string> {
  const aliasToTrigger = new Map<string, string>();
  for (const t of triggerNames) aliasToTrigger.set(`"${t}"`, t); // literal tự-alias
  const bindRe = /\bconst\s+(\w+)\s*=\s*"([a-zA-Z_]+)"/g;
  for (const m of src.matchAll(bindRe)) {
    const [, alias, value] = m;
    if (triggerNames.has(value)) aliasToTrigger.set(alias, value);
  }
  return aliasToTrigger;
}

function firedTagPairs(src: string, triggerNames: Set<string>): Set<string> {
  const fired = new Set<string>();
  const aliases = resolveTriggerAliases(src, triggerNames);
  for (const [aliasToken, trigger] of aliases) {
    // aliasToken có thể là identifier trần (T1) hoặc literal có dấu ngoặc kép ("trigger_name") — cả
    // hai đều hợp lệ làm tham số thứ hai của `expectTag(err, <aliasToken>, "tag")`.
    const escaped = aliasToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}\\s*,\\s*["']([a-z-]+)["']\\s*,?\\s*\\)`, "g");
    for (const m of src.matchAll(re)) fired.add(`${trigger}:${m[1]}`);
  }
  return fired;
}

const aliasFiredTags = firedTagPairs(rawIntSurface, parsed.triggerNames);

describe("S15-PAYROLL-QA-1 census — bề mặt test có ca kích hoạt THẬT (SQLSTATE) cho mọi tên/cặp", () => {
  it("scanner thấy > 20 file int-spec PAYROLL (chặn quét rỗng)", () => {
    expect(intFiles.length).toBeGreaterThan(20);
  });

  it.each(parsed.constraints.map((c) => c.name))(
    "ràng buộc `%s` có bằng chứng trong test surface",
    (name) => {
      expect(
        rawIntSurface.includes(name),
        `\`${name}\` không thấy trong bất kỳ *payroll*.int-spec.ts nào — chưa có ca kích hoạt ràng buộc THẬT ở DB`,
      ).toBe(true);
    },
  );

  it.each(parsed.tags.map((t) => [`${t.trigger}:${t.tag}`, t.trigger, t.tag] as const))(
    "cặp `%s` có bằng chứng trong test surface (chuỗi nối chết HOẶC alias expectTag)",
    (label, trigger, tag) => {
      const literalHit = rawIntSurface.includes(`${trigger}:${tag}`);
      const aliasHit = aliasFiredTags.has(`${trigger}:${tag}`);
      expect(
        literalHit || aliasHit,
        `${label} không thấy — cả chuỗi nối chết lẫn expectTag(alias, "tag") đều vắng`,
      ).toBe(true);
    },
  );

  it(`danh sách CỐ Ý-KHÔNG-MAP (${EXPECTED_UNMAPPED_TAG_COUNT} cặp) vẫn có ca kích hoạt — 500 có chủ đích PHẢI được đo, không bỏ qua`, () => {
    for (const label of UNMAPPED_BY_DESIGN) {
      const [trigger, tag] = label.split(":");
      const hit = rawIntSurface.includes(label) || aliasFiredTags.has(`${trigger}:${tag}`);
      expect(hit, `${label} (CỐ Ý unmapped) vẫn cần ≥1 ca DB thật — thiếu bằng chứng`).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 4. Chống test-giả (tự-chứng-minh) — đổi TÊN một ràng buộc trong bản COPY-in-memory phải làm ca ĐỎ
// ════════════════════════════════════════════════════════════════════════════════════════════════

describe("S15-PAYROLL-QA-1 census — chứng minh parser + scanner có RĂNG (mutation thủ công)", () => {
  it("đổi một TÊN ràng buộc trong bảng (bản COPY, KHÔNG sửa file thật) ⇒ scanner không còn thấy nó trong nguồn map", () => {
    // `replaceAll` — CHUỖI NÀY XUẤT HIỆN HAI LẦN trong SPEC (văn xuôi §8.2 dòng 418 + hàng bảng dòng
    // 744); `.replace()` chỉ đổi lần xuất hiện ĐẦU (văn xuôi), để nguyên hàng bảng ⇒ ca tự-chứng-minh
    // XANH GIẢ (đã dính một lần khi viết cổng này — đúng thứ ca này sinh ra để chặn).
    const mutated = specMarkdown.replaceAll(
      "`salary_components_company_code_uq`",
      "`salary_components_company_code_uq_MUTATED_BY_TEST`",
    );
    const reparsed = parseConstraintTable(mutated);
    const mutatedNames = reparsed.constraints.map((c) => c.name);
    expect(mutatedNames).toContain("salary_components_company_code_uq_MUTATED_BY_TEST");
    expect(mutatedNames).not.toContain("salary_components_company_code_uq");
    // Bằng chứng RĂNG: tên bị mutate không thể có mặt trong nguồn map thật ⇒ census sẽ bắt được nếu
    // ai đó đổi tên ràng buộc trong SPEC mà quên đổi trong `mapPayrollPgError`.
    expect(mapperSrc.includes("salary_components_company_code_uq_MUTATED_BY_TEST")).toBe(false);
  });

  it("một tag KHÔNG tồn tại (bịa) không được scanner báo là ĐÃ bắn", () => {
    const fake = "payroll_advance_freeze_guard:this-tag-does-not-exist-qa";
    const [trigger, tag] = fake.split(":");
    expect(rawIntSurface.includes(fake) || aliasFiredTags.has(`${trigger}:${tag}`)).toBe(false);
  });
});
