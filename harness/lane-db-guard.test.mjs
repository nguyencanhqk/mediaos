// harness/lane-db-guard.test.mjs — golden-fixture unit test cho harness/lane-db-guard.mjs.
//
// Fixture dùng ĐÚNG chuỗi thật (mã màu ANSI + tiền tố turbo) đo được trên máy dev khi chạy
// `TURBO_FORCE=1 pnpm test` cho worktree S5-QA-GATE-LANEDB-1 (2026-07-11):
//   - KHÔNG LANE_DB: @mediaos/api Test Files = 126 skipped / 347, Tests = 2024 skipped / 5592.
//   - CÓ LANE_DB (mediaos_qagate, chain-migrate sạch): Test Files = 1 skipped / 347,
//     Tests = 37 skipped / 5592 (phần dư là placeholder RED cố ý, không liên quan LANE_DB).
//   - Chạy `pnpm test` từng bị 1 lần "Channel closed" (tinypool IPC crash) giữa chừng — @mediaos/api
//     KHÔNG kịp in dòng "Test Files"/"Tests" nào cả → đây là ca thật của "không có summary".
//
// Chạy: `node --test harness/lane-db-guard.test.mjs`
import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_THRESHOLD, decideGate, parseVitestSkips, shouldWarn } from "./lane-db-guard.mjs";

const ESC = "\x1b";

// ── Fixture 1: KHÔNG LANE_DB — @mediaos/api 126/347 file skip, 2024/5592 test skip (thật) ──
const FIXTURE_NO_LANE_DB = [
  `@mediaos/contracts:test: ${ESC}[2m Test Files ${ESC}[22m${ESC}[1m${ESC}[32m27 passed${ESC}[39m${ESC}[22m${ESC}[90m (27)${ESC}[39m`,
  `@mediaos/contracts:test: ${ESC}[2m      Tests ${ESC}[22m${ESC}[1m${ESC}[32m478 passed${ESC}[39m${ESC}[22m${ESC}[90m (478)${ESC}[39m`,
  `@mediaos/web-core:test: ${ESC}[2m Test Files ${ESC}[22m${ESC}[1m${ESC}[32m31 passed${ESC}[39m${ESC}[22m${ESC}[90m (31)${ESC}[39m`,
  `@mediaos/web-core:test: ${ESC}[2m      Tests ${ESC}[22m${ESC}[1m${ESC}[32m612 passed${ESC}[39m${ESC}[22m${ESC}[90m (612)${ESC}[39m`,
  `@mediaos/api:test:  ${ESC}[2m${ESC}[90m↓${ESC}[39m${ESC}[22m test/integration/role-members.int-spec.ts ${ESC}[2m(${ESC}[22m${ESC}[2m6 tests${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[33m6 skipped${ESC}[39m${ESC}[2m)${ESC}[22m`,
  `@mediaos/api:test:  ${ESC}[32m✓${ESC}[39m test/integration/bonus-penalty-transition.int-spec.ts ${ESC}[2m(${ESC}[22m${ESC}[2m8 tests${ESC}[22m${ESC}[2m)${ESC}[22m${ESC}[33m 1493${ESC}[2mms${ESC}[22m${ESC}[39m`,
  `@mediaos/api:test: ${ESC}[2m Test Files ${ESC}[22m${ESC}[1m${ESC}[31m7 failed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[1m${ESC}[32m214 passed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[33m126 skipped${ESC}[39m${ESC}[90m (347)${ESC}[39m`,
  `@mediaos/api:test: ${ESC}[2m      Tests ${ESC}[22m${ESC}[1m${ESC}[31m24 failed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[1m${ESC}[32m3544 passed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[33m2024 skipped${ESC}[39m${ESC}[90m (5592)${ESC}[39m`,
  `@mediaos/api:test: ${ESC}[2m   Duration ${ESC}[22m 45.57s`,
].join("\n");

// ── Fixture 2: CÓ LANE_DB — chạy trực tiếp `vitest run` (KHÔNG có tiền tố turbo) ────────────
const FIXTURE_WITH_LANE_DB = [
  `${ESC}[2m Test Files ${ESC}[22m${ESC}[1m${ESC}[31m11 failed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[1m${ESC}[32m335 passed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[33m1 skipped${ESC}[39m${ESC}[90m (347)${ESC}[39m`,
  `${ESC}[2m      Tests ${ESC}[22m${ESC}[1m${ESC}[31m31 failed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[1m${ESC}[32m5524 passed${ESC}[39m${ESC}[22m${ESC}[2m | ${ESC}[22m${ESC}[33m37 skipped${ESC}[39m${ESC}[90m (5592)${ESC}[39m`,
].join("\n");

// ── Fixture 3: 0 skipped — không có token "skipped" ở dòng summary (contracts sạch) ────────
const FIXTURE_ZERO_SKIP = [
  `@mediaos/contracts:test: ${ESC}[2m Test Files ${ESC}[22m${ESC}[1m${ESC}[32m27 passed${ESC}[39m${ESC}[90m (27)${ESC}[39m`,
  `@mediaos/contracts:test: ${ESC}[2m      Tests ${ESC}[22m${ESC}[1m${ESC}[32m478 passed${ESC}[39m${ESC}[90m (478)${ESC}[39m`,
].join("\n");

// ── Fixture 4: crash giữa chừng — @mediaos/api KHÔNG kịp in "Test Files"/"Tests" (thật, IPC) ──
const FIXTURE_CRASH_NO_SUMMARY = [
  `@mediaos/api:test:  ${ESC}[32m✓${ESC}[39m test/integration/bonus-penalty-transition.int-spec.ts ${ESC}[2m(${ESC}[22m${ESC}[2m8 tests${ESC}[22m${ESC}[2m)${ESC}[22m${ESC}[33m 1493${ESC}[2mms${ESC}[22m${ESC}[39m`,
  `@mediaos/api:test:  ${ESC}[32m✓${ESC}[39m test/integration/task-attachments.int-spec.ts ${ESC}[2m(${ESC}[22m${ESC}[2m10 tests${ESC}[22m${ESC}[2m)${ESC}[22m${ESC}[33m 1524${ESC}[2mms${ESC}[22m${ESC}[39m`,
  `@mediaos/api:test: `,
  `@mediaos/api:test: ${ESC}[31m⎯⎯⎯⎯${ESC}[39m${ESC}[1m${ESC}[41m Unhandled Rejection ${ESC}[49m${ESC}[22m${ESC}[31m⎯⎯⎯⎯⎯${ESC}[39m`,
  `@mediaos/api:test: ${ESC}[31m${ESC}[1mError${ESC}[22m: Channel closed${ESC}[39m`,
  `@mediaos/api:test: [ELIFECYCLE] Test failed. See above for more details.`,
].join("\n");

test("parseVitestSkips: KHÔNG LANE_DB — bắt đúng 126 file / 2024 test skip (bỏ prefix turbo + màu ANSI)", () => {
  const { files, tests } = parseVitestSkips(FIXTURE_NO_LANE_DB);
  assert.equal(files, 126);
  assert.equal(tests, 2024);
});

test("parseVitestSkips: CÓ LANE_DB — 1 file / 37 test skip, không có tiền tố turbo vẫn bắt được", () => {
  const { files, tests } = parseVitestSkips(FIXTURE_WITH_LANE_DB);
  assert.equal(files, 1);
  assert.equal(tests, 37);
});

test("parseVitestSkips: dòng summary sạch (không có token 'skipped') → trả 0, không phải null", () => {
  const { files, tests } = parseVitestSkips(FIXTURE_ZERO_SKIP);
  assert.equal(files, 0);
  assert.equal(tests, 0);
});

test("parseVitestSkips: crash giữa chừng, KHÔNG có dòng summary nào → trả null (không suy diễn 0)", () => {
  const { files, tests } = parseVitestSkips(FIXTURE_CRASH_NO_SUMMARY);
  assert.equal(files, null);
  assert.equal(tests, null);
});

test("parseVitestSkips: input rỗng/không phải string → null", () => {
  assert.deepEqual(parseVitestSkips(""), { files: null, tests: null });
  assert.deepEqual(parseVitestSkips(undefined), { files: null, tests: null });
});

test("shouldWarn: so ngưỡng thuần, số nguyên hợp lệ", () => {
  assert.equal(shouldWarn(126, 20), true);
  assert.equal(shouldWarn(1, 20), false);
  assert.equal(shouldWarn(20, 20), false); // đúng ngưỡng KHÔNG warn (chỉ > mới warn)
  assert.equal(shouldWarn(21, 20), true);
});

test("decideGate: laneDbSet=true → luôn 'ok' kể cả N cao (LANE_DB là bằng chứng đã chạy)", () => {
  const gate = decideGate({ skippedFiles: 126, laneDbSet: true, threshold: 20, strict: false });
  assert.equal(gate.level, "ok");
});

test("decideGate: laneDbSet=true + strict=true vẫn 'ok' (không bị strict lật ngược)", () => {
  const gate = decideGate({ skippedFiles: 999, laneDbSet: true, threshold: 20, strict: true });
  assert.equal(gate.level, "ok");
});

test("decideGate: laneDbSet=false, N=126 > threshold=20, strict mặc định false → 'warn'", () => {
  const gate = decideGate({ skippedFiles: 126, laneDbSet: false, threshold: 20, strict: false });
  assert.equal(gate.level, "warn");
  assert.match(gate.message, /126 int-spec SKIPPED/);
  assert.match(gate.message, /thiếu LANE_DB/);
});

test("decideGate: laneDbSet=false, N=126 > threshold=20, strict=true (--all / REQUIRE_LANE_DB=1) → 'red'", () => {
  const gate = decideGate({ skippedFiles: 126, laneDbSet: false, threshold: 20, strict: true });
  assert.equal(gate.level, "red");
});

test("decideGate: laneDbSet=false, N=1 <= threshold=20 → 'ok'", () => {
  const gate = decideGate({ skippedFiles: 1, laneDbSet: false, threshold: 20, strict: false });
  assert.equal(gate.level, "ok");
});

test("decideGate: skippedFiles=null (không có summary), strict=false → 'warn' (không suy diễn XANH)", () => {
  const gate = decideGate({ skippedFiles: null, laneDbSet: false, threshold: 20, strict: false });
  assert.equal(gate.level, "warn");
  assert.match(gate.message, /KHÔNG xác định được/);
});

test("decideGate: skippedFiles=null, strict=true → 'red' (không được coi là bằng chứng khi bắt buộc)", () => {
  const gate = decideGate({ skippedFiles: null, laneDbSet: false, threshold: 20, strict: true });
  assert.equal(gate.level, "red");
});

test("decideGate: threshold mặc định = DEFAULT_THRESHOLD khi không truyền", () => {
  const gate = decideGate({ skippedFiles: DEFAULT_THRESHOLD + 1, laneDbSet: false });
  assert.equal(gate.level, "warn");
});
