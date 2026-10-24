import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXPIRY,
  MAX_WINDOW_DAYS,
  checkIgnores,
  lockVersions,
  parseIgnoreGhsas,
} from "./check-audit-ignore-expiry.mjs";

const G1 = "GHSA-mrhx-c7xc-m3w5";
const G2 = "GHSA-aaaa-bbbb-cccc";
const OK = { until: "2026-11-23", wo: "S19-OPS-ZOD4-1", scope: { pkg: "zod", major: 3 } };
const TODAY = "2026-10-24";
const LOCK = [
  "packages:",
  "",
  "  zod@3.25.76:",
  "    resolution: {integrity: x}",
  "",
  "snapshots:",
  "",
  "  zod@3.25.76: {}",
].join("\n");
const chk = (parsed, expiry, today, lock = LOCK) => checkIgnores(parsed, expiry, today, lock);
const block = (...lines) =>
  ["overrides:", '  "a@<1": "^1"', ...lines, "allowBuilds:", "  y: true"].join("\n");
const canonical = block("auditConfig:", "  ignoreGhsas:", `    - ${G1}`);
const readRepo = (name) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("pnpm-workspace.yaml thật: đúng dạng chuẩn và mọi GHSA trong đó có hạn", () => {
  const parsed = parseIgnoreGhsas(readRepo("pnpm-workspace.yaml"));
  assert.deepEqual(parsed.problems, []);
  for (const ghsa of parsed.ids) assert.ok(EXPIRY[ghsa], `${ghsa} thiếu hạn`);
});

// Ngày THẬT (không ghim): cùng kết luận với bước CI chạy script — gia hạn hợp lệ không làm ca này đỏ oan, còn
// quá hạn thì ca này đỏ cùng lúc với script (đúng ý).
test("cấu hình thật (pnpm-workspace.yaml + pnpm-lock.yaml + EXPIRY) đạt ở ngày hôm nay", () => {
  const parsed = parseIgnoreGhsas(readRepo("pnpm-workspace.yaml"));
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(checkIgnores(parsed, EXPIRY, today, readRepo("pnpm-lock.yaml")), []);
});

test("CRLF và chú thích cuối dòng ở header ⇒ đọc đúng", () => {
  const yaml = block("auditConfig: # ghi chú", "  ignoreGhsas:", `    - ${G1}`).replace(
    /\n/g,
    "\r\n",
  );
  assert.deepEqual(parseIgnoreGhsas(yaml), { ids: [G1], problems: [] });
});

for (const [name, yaml] of [
  [
    "khoá cột 0 có escape trong nháy",
    `${block()}\n"\\x61uditConfig": {"\\x69gnoreGhsas": ["\\x47HSA-aaaa-bbbb-cccc"]}`,
  ],
  [
    "cả tệp viết thành một dòng flow mapping",
    `{"packages": ["a #"], "auditConfig": {"ignoreGhsas": ["${G2}"]}}`,
  ],
  ["dấu tài liệu YAML thứ hai", `${block()}\n---\nauditConfig:\n  ignoreGhsas:\n    - ${G2}`],
]) {
  test(`dòng cột 0 không phải khoá trần — ${name} ⇒ ĐỎ`, () => {
    const parsed = parseIgnoreGhsas(yaml);
    assert.ok(parsed.problems.length >= 1, JSON.stringify(parsed));
    assert.ok(chk(parsed, {}, TODAY).length >= 1);
  });
}

test("lockfile có khoá zod dạng tarball/git ⇒ ĐỎ (không lặng lẽ bỏ sót)", () => {
  const lock = `${LOCK}\n  zod@https://codeload.github.com/colinhacks/zod/tar.gz/abc123: {}`;
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: OK }, TODAY, lock);
  assert.equal(p.length, 1);
  assert.match(p[0], /NGOÀI phạm vi/);
});

test("today sai dạng ⇒ ĐỎ (so sánh dương, NaN không lọt)", () => {
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: OK }, "garbage");
  assert.equal(p.length, 1);
  assert.match(p[0], /không so được/);
});

test("dạng chuẩn có chú thích, dòng trống, chú thích cuối dòng ⇒ đọc đủ, không vấn đề", () => {
  const yaml = block(
    "# lý do",
    "auditConfig:",
    "  # giữa khối",
    "  ignoreGhsas:",
    `    - ${G1}`,
    "",
    `    - ${G2} # ghi chú`,
  );
  assert.deepEqual(parseIgnoreGhsas(yaml), { ids: [G1, G2], problems: [] });
});

test("không có auditConfig, chỉ nhắc GHSA trong chú thích ⇒ rỗng, đạt", () => {
  const parsed = parseIgnoreGhsas(block(`# đã gỡ ignore ${G1}`));
  assert.deepEqual(parsed, { ids: [], problems: [] });
  assert.deepEqual(chk(parsed, {}, TODAY), []);
});

for (const [name, yaml] of [
  [
    "khoá anh em ignoreCves trong khối",
    block("auditConfig:", "  ignoreGhsas:", `    - ${G1}`, "  ignoreCves:", "    - CVE-2026-0001"),
  ],
  [
    "mục viết trên hai dòng",
    block("auditConfig:", "  ignoreGhsas:", `    - ${G1}`, "    -", `      ${G2}`),
  ],
  ["giá trị có nháy", block("auditConfig:", "  ignoreGhsas:", `    - "${G1}"`)],
  ["flow mapping", block(`auditConfig: { ignoreGhsas: [${G1}] }`)],
  ["khoá có nháy", block("auditConfig:", '  "ignoreGhsas":', `    - ${G1}`)],
  ["danh sách một dòng", block("auditConfig:", `  ignoreGhsas: [${G1}]`)],
  [
    "hai khối auditConfig",
    block(
      "auditConfig:",
      "  ignoreGhsas:",
      `    - ${G1}`,
      "auditConfig:",
      "  ignoreGhsas:",
      `    - ${G2}`,
    ),
  ],
  ["khối rỗng", block("auditConfig:", "  ignoreGhsas:")],
]) {
  test(`lệch dạng chuẩn — ${name} ⇒ ĐỎ kể cả khi EXPIRY rỗng`, () => {
    const parsed = parseIgnoreGhsas(yaml);
    assert.ok(parsed.problems.length >= 1, JSON.stringify(parsed));
    assert.ok(chk(parsed, {}, TODAY).length >= 1);
  });
}

test("hạn hợp lệ, chưa quá hạn ⇒ đạt (kể cả đúng ngày hết hạn)", () => {
  const parsed = parseIgnoreGhsas(canonical);
  assert.deepEqual(chk(parsed, { [G1]: OK }, TODAY), []);
  assert.deepEqual(chk(parsed, { [G1]: OK }, "2026-11-23"), []);
});

test("quá hạn một ngày ⇒ ĐỎ", () => {
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: OK }, "2026-11-24");
  assert.equal(p.length, 1);
  assert.match(p[0], /QUÁ HẠN 2026-11-23/);
});

test(`hạn xa hơn ${MAX_WINDOW_DAYS} ngày ⇒ ĐỎ (gia hạn phải làm lại trong cửa sổ ngắn)`, () => {
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: { ...OK, until: "2099-12-31" } }, TODAY);
  assert.equal(p.length, 1);
  assert.match(p[0], /xa hơn/);
});

for (const until of [undefined, "never", "2026-11-3", "2026-02-31", ""]) {
  test(`until sai dạng (${JSON.stringify(until)}) ⇒ ĐỎ`, () => {
    const p = chk(parseIgnoreGhsas(canonical), { [G1]: { ...OK, until } }, TODAY);
    assert.equal(p.length, 1);
    assert.match(p[0], /until/);
  });
}

test("wo rỗng ⇒ ĐỎ", () => {
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: { ...OK, wo: "" } }, TODAY);
  assert.equal(p.length, 1);
  assert.match(p[0], /wo/);
});

test("GHSA bị bỏ qua mà không có hạn ⇒ ĐỎ", () => {
  const p = chk(parseIgnoreGhsas(canonical), {}, TODAY);
  assert.equal(p.length, 1);
  assert.match(p[0], /KHÔNG có hạn/);
});

test("EXPIRY còn mục không còn bị bỏ qua ⇒ ĐỎ (sổ lệch)", () => {
  const p = chk(parseIgnoreGhsas(block()), { [G1]: OK }, TODAY);
  assert.equal(p.length, 1);
  assert.match(p[0], /không còn bị bỏ qua/);
});

test("lockVersions đọc cả packages lẫn snapshots, có nháy, không lẫn gói trùng tiền tố", () => {
  const lock = [
    "  zod@3.25.76:",
    "  zod@3.25.76: {}",
    "  'zod@4.1.0(x@1)': {}",
    "  zod-to-json-schema@3.24.6:",
  ].join("\n");
  assert.deepEqual(lockVersions(lock, "zod"), ["3.25.76", "4.1.0"]);
});

test("lockfile có zod ngoài major của ngoại lệ ⇒ ĐỎ (ignore không được ỉm dòng có bản vá)", () => {
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: OK }, TODAY, `${LOCK}\n  zod@4.5.0: {}`);
  assert.equal(p.length, 1);
  assert.match(p[0], /zod@4\.5\.0/);
});

test("lockfile không còn zod ⇒ ĐỎ (ngoại lệ thừa, phải gỡ)", () => {
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: OK }, TODAY, "packages:\n");
  assert.equal(p.length, 1);
  assert.match(p[0], /không còn bản zod/);
});

test("mục EXPIRY thiếu scope ⇒ ĐỎ", () => {
  const noScope = { until: OK.until, wo: OK.wo };
  const p = chk(parseIgnoreGhsas(canonical), { [G1]: noScope }, TODAY);
  assert.equal(p.length, 1);
  assert.match(p[0], /scope/);
});
