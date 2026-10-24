import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EXPIRY, checkIgnores, parseIgnoreGhsas } from "./check-audit-ignore-expiry.mjs";

const G1 = "GHSA-mrhx-c7xc-m3w5";
const G2 = "GHSA-aaaa-bbbb-cccc";

test("đọc đúng danh sách của pnpm-workspace.yaml thật và mọi GHSA trong đó có hạn", () => {
  const ignored = parseIgnoreGhsas(
    readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"),
  );
  assert.ok(Array.isArray(ignored));
  for (const ghsa of ignored) assert.ok(EXPIRY[ghsa], `${ghsa} thiếu hạn`);
});

test("dạng khối có chú thích và dòng trống giữa các mục", () => {
  const yaml = [
    "x: 1",
    "auditConfig:",
    "  # lý do",
    "  ignoreGhsas:",
    `    - ${G1}`,
    "",
    `    - "${G2}" # chú thích`,
    "allowBuilds:",
    "  y: true",
  ].join("\n");
  assert.deepEqual(parseIgnoreGhsas(yaml), [G1, G2]);
});

test("không có auditConfig ⇒ danh sách rỗng", () => {
  assert.deepEqual(parseIgnoreGhsas("overrides:\n  a: 1\n"), []);
});

test("có nhắc ignoreGhsas mà không đọc được (dạng một dòng) ⇒ null và checkIgnores ĐỎ", () => {
  const ignored = parseIgnoreGhsas(`auditConfig:\n  ignoreGhsas: [${G1}]\n`);
  assert.equal(ignored, null);
  assert.equal(checkIgnores(ignored, {}, "2026-10-24").length, 1);
});

test("GHSA có hạn, chưa quá hạn ⇒ đạt (kể cả đúng ngày hết hạn)", () => {
  const expiry = { [G1]: { until: "2026-11-23", wo: "WO-X" } };
  assert.deepEqual(checkIgnores([G1], expiry, "2026-10-24"), []);
  assert.deepEqual(checkIgnores([G1], expiry, "2026-11-23"), []);
});

test("quá hạn một ngày ⇒ ĐỎ", () => {
  const expiry = { [G1]: { until: "2026-11-23", wo: "WO-X" } };
  const p = checkIgnores([G1], expiry, "2026-11-24");
  assert.equal(p.length, 1);
  assert.match(p[0], /QUÁ HẠN 2026-11-23/);
});

test("GHSA bị bỏ qua mà không có hạn ⇒ ĐỎ", () => {
  const p = checkIgnores([G2], {}, "2026-10-24");
  assert.equal(p.length, 1);
  assert.match(p[0], /KHÔNG có hạn/);
});

test("EXPIRY còn mục không còn bị bỏ qua ⇒ ĐỎ (sổ lệch)", () => {
  const p = checkIgnores([], { [G1]: { until: "2026-11-23", wo: "WO-X" } }, "2026-10-24");
  assert.equal(p.length, 1);
  assert.match(p[0], /không còn bị bỏ qua/);
});
