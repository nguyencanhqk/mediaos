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
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as guard from "./lane-db-guard.mjs";
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

// ══ S16-SOCIAL-STORAGETESTGATE-1 (plan §4 R1, D-4/D-6) — ca storage bị bỏ qua THEO TỪNG CA phải đếm được ══
//
// Nhãn do `apps/api/test/helpers/storage-test-target.ts` in (định dạng D-4, một dòng JSON sau thẻ):
//   [storage-test-skip] {"file":…,"task":…,"case":…,"reason":…}   — ca storage bị bỏ qua (khoá khử trùng lặp = file+task)
//   [storage-test-run]  {"file":…,"bucket":…}                       — tệp storage đã CHẠY trên bucket cho phép
//   [storage-test-call] {"file":…,"command":…}                      — lời gọi storage bị tripwire chặn (hồ sơ offline)
// Import dạng namespace để 14 ca cũ vẫn chạy khi `parseStorageMarkers` chưa tồn tại (RED theo hành vi).

const GUARD_CLI = fileURLToPath(new URL("./lane-db-guard.mjs", import.meta.url));
const SF = "test/integration/files-e2e-confirm.int-spec.ts";
const SF2 = "test/integration/hr-employee-avatar.int-spec.ts";
const skipLabel = (o) => `[storage-test-skip] ${JSON.stringify(o)}`;
const runLabel = (o) => `[storage-test-run] ${JSON.stringify(o)}`;
const callLabel = (o) => `[storage-test-call] ${JSON.stringify(o)}`;
const SUMMARY = [
  `${ESC}[2m Test Files ${ESC}[22m${ESC}[1m${ESC}[32m2 passed${ESC}[39m${ESC}[90m (2)${ESC}[39m`,
  `${ESC}[2m      Tests ${ESC}[22m${ESC}[1m${ESC}[32m9 passed${ESC}[39m${ESC}[2m | ${ESC}[22m${ESC}[33m2 skipped${ESC}[39m${ESC}[90m (11)${ESC}[39m`,
];

/** Log thật dạng reporter mặc định: khối `stderr | tệp > ca` rồi dòng nhãn đứng riêng; có ANSI + tiền tố turbo. */
const FIXTURE_STORAGE_SKIPS = [
  `stderr | ${SF} > files e2e confirm > E1 PUT rồi confirm`,
  skipLabel({ file: SF, task: "a1b2_0_0", case: "E1 PUT rồi confirm", reason: "S3_BUCKET lệch" }),
  `@mediaos/api:test: ${ESC}[33m${skipLabel({ file: SF, task: "a1b2_0_1", case: "E2 sai cỡ", reason: "S3_BUCKET lệch" })}${ESC}[39m`,
  // chunk-runner chạy lại cùng tệp ⇒ cùng task id ⇒ KHÔNG đếm lần hai
  skipLabel({ file: SF, task: "a1b2_0_0", case: "E1 PUT rồi confirm", reason: "S3_BUCKET lệch" }),
  ...SUMMARY,
].join("\n");

const parseMarkers = (text) => guard.parseStorageMarkers(text);

function runGuardCli(logText, flags) {
  const dir = mkdtempSync(join(tmpdir(), "lane-db-guard-r1-"));
  const logPath = join(dir, "test.log");
  writeFileSync(logPath, logText, "utf8");
  const res = spawnSync(process.execPath, [GUARD_CLI, logPath, ...flags], { encoding: "utf8" });
  const line = (key) =>
    (res.stdout ?? "")
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${key}:`))
      ?.slice(key.length + 1);
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    level: line("LEVEL"),
    storage: line("STORAGE"),
  };
}

test("R1(a) parseStorageMarkers: 2 ca skip khác task + 1 dòng trùng (chạy lại) ⇒ skips=2 (có/không ANSI + tiền tố turbo)", () => {
  assert.equal(parseMarkers(FIXTURE_STORAGE_SKIPS).skips, 2);
});

test("R1(a/M3) hai nhãn CÙNG `case` nhưng KHÁC `task` (it.each / describe khác) ⇒ 2, không gộp nhầm", () => {
  const text = [
    skipLabel({ file: SF, task: "t_each_0", case: "E3 tải %s", reason: "r" }),
    skipLabel({ file: SF, task: "t_each_1", case: "E3 tải %s", reason: "r" }),
  ].join("\n");
  assert.equal(parseMarkers(text).skips, 2);
});

test("R1(a) run khử trùng lặp theo tệp; call đếm từng dòng", () => {
  const text = [
    runLabel({ file: SF, bucket: "mediaos-fdisp-test" }),
    runLabel({ file: SF, bucket: "mediaos-fdisp-test" }),
    runLabel({ file: SF2, bucket: "mediaos-fdisp-test" }),
    callLabel({ file: SF2, command: "PutObjectCommand" }),
  ].join("\n");
  const m = parseMarkers(text);
  assert.equal(m.runs, 2);
  assert.equal(m.calls, 1);
});

test("R1(b) decideGate: strict + LANE_DB + ca storage bị bỏ qua ⇒ red (mã cũ trả ok vô điều kiện)", () => {
  const gate = decideGate({
    skippedFiles: 1,
    laneDbSet: true,
    strict: true,
    storageSkips: 2,
    storageRuns: 3,
    storageCalls: 0,
  });
  assert.equal(gate.level, "red");
});

test("R1(c) decideGate: strict + LANE_DB + 0 tệp storage CHẠY ⇒ red (thành công rỗng)", () => {
  const gate = decideGate({
    skippedFiles: 1,
    laneDbSet: true,
    strict: true,
    storageSkips: 0,
    storageRuns: 0,
    storageCalls: 0,
  });
  assert.equal(gate.level, "red");
});

test("R1(c) đối chứng: strict + LANE_DB + có run, 0 skip, 0 call ⇒ ok", () => {
  const gate = decideGate({
    skippedFiles: 1,
    laneDbSet: true,
    strict: true,
    storageSkips: 0,
    storageRuns: 11,
    storageCalls: 0,
  });
  assert.equal(gate.level, "ok");
});

test("R1(d) decideGate: KHÔNG strict + LANE_DB + ca storage bị bỏ qua ⇒ warn (tối thiểu)", () => {
  const gate = decideGate({
    skippedFiles: 1,
    laneDbSet: true,
    strict: false,
    storageSkips: 1,
    storageRuns: 2,
    storageCalls: 0,
  });
  assert.equal(gate.level, "warn");
});

test("R1(d) CLI không strict + có nhãn skip ⇒ LEVEL:warn, exit 0 (tier thường không vỡ)", () => {
  const r = runGuardCli(FIXTURE_STORAGE_SKIPS, ["--lane-db-set=1", "--strict=0"]);
  assert.equal(r.level, "warn");
  assert.equal(r.status, 0);
});

test("R1(e) dòng warn CẤP TỆP (không có thẻ) không tính là ca bị bỏ qua", () => {
  const text = [
    `stderr | ${SF}`,
    `⚠ ${SF}: cổng storage ĐÓNG (S3_BUCKET="mediaos-storage-off" khác "mediaos-fdisp-test") — các ca storage sẽ BỎ QUA`,
    ...SUMMARY,
  ].join("\n");
  assert.equal(parseMarkers(text).skips, 0);
});

test("R1(f) nhãn hỏng JSON (bị cắt/chen dòng) vẫn ĐẾM, không bị nuốt", () => {
  const text = [
    `[storage-test-skip] {"file":"${SF}","task":`,
    skipLabel({ file: SF, task: "t9", case: "E4", reason: "r" }),
  ].join("\n");
  assert.equal(parseMarkers(text).skips, 2);
});

test("R1(k/M4) không có nhãn nào ⇒ parseStorageMarkers trả số 0/0/0 (không null)", () => {
  assert.deepEqual(parseMarkers(""), { skips: 0, runs: 0, calls: 0 });
  assert.deepEqual(parseMarkers(SUMMARY.join("\n")), { skips: 0, runs: 0, calls: 0 });
});

test("R1(h/M4) CLI: log có summary vitest + 0 nhãn, strict + LANE_DB ⇒ LEVEL:red và in STORAGE:skips=0 runs=0 calls=0", () => {
  const r = runGuardCli(SUMMARY.join("\n"), ["--lane-db-set=1", "--strict=1"]);
  assert.equal(r.level, "red");
  assert.equal(r.storage, "skips=0 runs=0 calls=0");
});

test("R1(h/M4) đối chứng: cùng log, KHÔNG strict ⇒ LEVEL:ok như hành vi cũ", () => {
  const r = runGuardCli(SUMMARY.join("\n"), ["--lane-db-set=1", "--strict=0"]);
  assert.equal(r.level, "ok");
});

test("R1(i/B1) CLI --fail-unless-ok=1: LEVEL red ⇒ exit 1 (bước CI đỏ)", () => {
  const r = runGuardCli(FIXTURE_STORAGE_SKIPS, [
    "--lane-db-set=1",
    "--strict=1",
    "--fail-unless-ok=1",
  ]);
  assert.equal(r.level, "red");
  assert.equal(r.status, 1);
});

test("R1(i/B1) đối chứng: --fail-unless-ok=1 với LEVEL ok ⇒ exit 0", () => {
  const text = [runLabel({ file: SF, bucket: "mediaos-test" }), ...SUMMARY].join("\n");
  const r = runGuardCli(text, ["--lane-db-set=1", "--strict=1", "--fail-unless-ok=1"]);
  assert.equal(r.level, "ok");
  assert.equal(r.status, 0);
});

test("R1(j/M1) decideGate: strict + có lời gọi storage bị tripwire chặn ⇒ red dù 0 skip", () => {
  const gate = decideGate({
    skippedFiles: 1,
    laneDbSet: true,
    strict: true,
    storageSkips: 0,
    storageRuns: 3,
    storageCalls: 1,
  });
  assert.equal(gate.level, "red");
});

// ══ Cổng LIGHT 20/10 — F2: guard đòi TỪNG tệp storage chạy · F1: check.sh không rơi về XANH khi guard sập ══

const MANIFEST = fileURLToPath(
  new URL("../apps/api/test/storage-spec-files.json", import.meta.url),
);
const CHECK_SH = fileURLToPath(new URL("./check.sh", import.meta.url));
const STRICT_LANE = ["--lane-db-set=1", "--strict=1", "--fail-unless-ok=1"];
const manifestFiles = () => JSON.parse(readFileSync(MANIFEST, "utf8"));
const runLog = (files) =>
  [...files.map((file) => runLabel({ file, bucket: "mediaos-test" })), ...SUMMARY].join("\n");

test("LIGHT-F2 parseStorageRunFiles: chỉ nhãn run hợp lệ, khử trùng lặp, sắp xếp (bỏ ANSI + tiền tố turbo)", () => {
  const text = [
    runLabel({ file: SF2, bucket: "b" }),
    `@mediaos/api:test: ${ESC}[2m${runLabel({ file: SF, bucket: "b" })}${ESC}[22m`,
    runLabel({ file: SF, bucket: "b" }),
    "[storage-test-run] {hỏng",
    ...SUMMARY,
  ].join("\n");
  assert.deepEqual(guard.parseStorageRunFiles(text), [SF, SF2].sort());
  assert.deepEqual(guard.parseStorageRunFiles(""), []);
});

test("LIGHT-F2 decideGate: strict + LANE_DB + THIẾU một tệp mong đợi ⇒ red dù runs > 0 (nêu tên tệp)", () => {
  const gate = decideGate({
    skippedFiles: 0,
    laneDbSet: true,
    strict: true,
    storageSkips: 0,
    storageRuns: 1,
    storageCalls: 0,
    expectedRunFiles: [SF, SF2],
    storageRunFiles: [SF],
  });
  assert.equal(gate.level, "red");
  assert.match(gate.message, /1\/2 tệp storage mong đợi/);
  assert.ok(gate.message.includes(SF2));
});

test("LIGHT-F2 đối chứng: đủ mọi tệp ⇒ ok · không strict ⇒ không xét theo tệp · không truyền danh sách ⇒ hành vi cũ", () => {
  const base = {
    skippedFiles: 0,
    laneDbSet: true,
    storageSkips: 0,
    storageRuns: 1,
    storageCalls: 0,
  };
  const expectedRunFiles = [SF, SF2];
  assert.equal(
    decideGate({ ...base, strict: true, expectedRunFiles, storageRunFiles: [SF2, SF] }).level,
    "ok",
  );
  assert.equal(
    decideGate({ ...base, strict: false, expectedRunFiles, storageRunFiles: [SF] }).level,
    "ok",
  );
  assert.equal(decideGate({ ...base, strict: true, storageRunFiles: [SF] }).level, "ok");
});

test("LIGHT-F2 CLI --expect-run-files (manifest THẬT của kho): đủ tệp ⇒ ok/exit 0; thiếu tệp đầu ⇒ red/exit 1 + tên tệp", () => {
  const expected = manifestFiles();
  assert.ok(expected.length > 1, "manifest phải liệt kê các tệp storage");
  const ok = runGuardCli(runLog(expected), [...STRICT_LANE, `--expect-run-files=${MANIFEST}`]);
  assert.equal(ok.level, "ok");
  assert.equal(ok.status, 0);
  const red = runGuardCli(runLog(expected.slice(1)), [
    ...STRICT_LANE,
    `--expect-run-files=${MANIFEST}`,
  ]);
  assert.equal(red.level, "red");
  assert.equal(red.status, 1);
  assert.ok(red.stdout.includes(expected[0]), red.stdout);
});

test("LIGHT-F2 CLI manifest vắng / rỗng / sai kiểu ⇒ red + exit 1 (không ngầm bỏ cổng theo tệp)", () => {
  const dir = mkdtempSync(join(tmpdir(), "lane-db-guard-manifest-"));
  const bad = [
    join(dir, "khong-co.json"),
    ...[["[]"], ['["a","a"]'], ['{"a":1}'], ["[1]"], ["{hỏng"]].map(([body], i) => {
      const f = join(dir, `bad-${i}.json`);
      writeFileSync(f, body, "utf8");
      return f;
    }),
  ];
  for (const manifest of bad) {
    const r = runGuardCli(runLog(manifestFiles()), [
      ...STRICT_LANE,
      `--expect-run-files=${manifest}`,
    ]);
    assert.equal(r.level, "red", manifest);
    assert.equal(r.status, 1, manifest);
  }
});

/** Chạy ĐÚNG hàm run_lane_db_guard trích từ harness/check.sh (không chạy cả check.sh). */
function runCheckShGuard({ guardPath, logText, strict, manifest = "" }) {
  const fn = readFileSync(CHECK_SH, "utf8")
    .replace(/\r/g, "")
    .match(/^run_lane_db_guard\(\) \{\n[\s\S]*?\n\}\n/m)?.[0];
  assert.ok(fn, "check.sh phải có hàm run_lane_db_guard ở cột 0");
  const dir = mkdtempSync(join(tmpdir(), "check-sh-guard-"));
  const log = join(dir, "test.log");
  writeFileSync(log, logText, "utf8");
  const script = [
    "set -uo pipefail",
    fn,
    'run_lane_db_guard "$G" "$L" 1 20 "$ST" "$MF"',
    'printf \'LEVEL=%s\\nMESSAGE=%s\\n\' "$GUARD_LEVEL" "$GUARD_MESSAGE"',
  ].join("\n");
  const res = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, G: guardPath, L: log, ST: String(strict), MF: manifest },
  });
  const out = res.stdout ?? "";
  const pick = (k) =>
    out
      .split(/\r?\n/)
      .find((l) => l.startsWith(`${k}=`))
      ?.slice(k.length + 1);
  return {
    status: res.status,
    level: pick("LEVEL"),
    message: pick("MESSAGE") ?? "",
    stderr: res.stderr,
  };
}

function stubGuard(body) {
  const dir = mkdtempSync(join(tmpdir(), "check-sh-stub-"));
  const f = join(dir, "guard.mjs");
  writeFileSync(f, body, "utf8");
  return f;
}

test("LIGHT-F1 check.sh: guard VẮNG (node exit 1, 0 dòng) ⇒ red khi strict · warn khi không — không bao giờ rỗng/XANH", () => {
  const guardPath = join(mkdtempSync(join(tmpdir(), "check-sh-missing-")), "khong-co.mjs");
  const red = runCheckShGuard({ guardPath, logText: runLog([SF]), strict: 1 });
  assert.equal(red.status, 0, red.stderr);
  assert.equal(red.level, "red");
  assert.match(red.message, /KHÔNG trả LEVEL hợp lệ \(node exit [1-9]/);
  assert.equal(runCheckShGuard({ guardPath, logText: runLog([SF]), strict: 0 }).level, "warn");
});

test("LIGHT-F1 check.sh: guard THROW · in LEVEL lạ · in LEVEL:ok rồi exit ≠ 0 ⇒ red (strict)", () => {
  for (const body of [
    'throw new Error("boom");',
    'console.log("LEVEL:bogus"); console.log("MESSAGE:x");',
    'console.log("LEVEL:ok"); process.exitCode = 3;',
  ]) {
    const r = runCheckShGuard({ guardPath: stubGuard(body), logText: runLog([SF]), strict: 1 });
    assert.equal(r.level, "red", body);
  }
});

test("LIGHT-F1/F2 check.sh đối chứng: guard THẬT + manifest — đủ tệp ⇒ ok; thiếu tệp ⇒ red (check.sh chuyển manifest)", () => {
  const expected = manifestFiles();
  const ok = runCheckShGuard({
    guardPath: GUARD_CLI,
    logText: runLog(expected),
    strict: 1,
    manifest: MANIFEST,
  });
  assert.equal(ok.level, "ok", ok.message + ok.stderr);
  const red = runCheckShGuard({
    guardPath: GUARD_CLI,
    logText: runLog(expected.slice(1)),
    strict: 1,
    manifest: MANIFEST,
  });
  assert.equal(red.level, "red");
  assert.ok(red.message.includes(expected[0]), red.message);
});

// ══ S16-SOCIAL-GUARDNOSUMMARY-1 — LANE_DB set KHÔNG thay được dòng tổng kết vitest ══
//
// Quan sát (q1, plan S16-SOCIAL-STORAGETESTGATE-1 §9.3 «L3 đo»): lô D chết `Channel closed` không in
// `Test Files`/`Tests`, các tệp storage kịp phát nhãn run ⇒ cổng storage `ok`; cổng lane-db trả `ok` vì
// `laneDbSet` được xét TRƯỚC summary vắng ⇒ guard `--strict=1 --lane-db-set=1` báo `LEVEL:ok`.
// Bất biến: strict ∧ LANE_DB ∧ log không có dòng tổng kết nào ⇒ red (không strict ⇒ warn); có summary ⇒ giữ nguyên.

/** Log lô chết giữa chừng: mọi tệp storage mong đợi đã phát nhãn run, rồi tinypool sập — KHÔNG có summary. */
const crashLogWithRuns = (files) =>
  [
    ...files.map((file) => runLabel({ file, bucket: "mediaos-test" })),
    FIXTURE_CRASH_NO_SUMMARY,
  ].join("\n");

test("NOSUMMARY decideGate: strict + LANE_DB + skippedFiles=null (không summary) ⇒ red (mã cũ trả ok)", () => {
  const gate = decideGate({ skippedFiles: null, laneDbSet: true, threshold: 20, strict: true });
  assert.equal(gate.level, "red");
  assert.match(gate.message, /dòng tổng kết/);
});

test("NOSUMMARY decideGate: KHÔNG strict + LANE_DB + skippedFiles=null ⇒ warn (không bao giờ XANH)", () => {
  assert.equal(decideGate({ skippedFiles: null, laneDbSet: true, strict: false }).level, "warn");
  assert.equal(
    decideGate({ skippedFiles: undefined, laneDbSet: true, strict: false }).level,
    "warn",
  );
});

test("NOSUMMARY decideGate: storage đủ bằng chứng KHÔNG che được summary vắng (strict + LANE_DB ⇒ red)", () => {
  const gate = decideGate({
    skippedFiles: null,
    laneDbSet: true,
    strict: true,
    storageSkips: 0,
    storageRuns: 2,
    storageCalls: 0,
    expectedRunFiles: [SF, SF2],
    storageRunFiles: [SF, SF2],
  });
  assert.equal(gate.level, "red");
});

test("NOSUMMARY đối chứng decideGate: có summary (skippedFiles=0/1) + LANE_DB ⇒ ok như cũ, strict hay không", () => {
  for (const strict of [true, false]) {
    for (const skippedFiles of [0, 1]) {
      assert.equal(decideGate({ skippedFiles, laneDbSet: true, strict }).level, "ok");
    }
  }
});

test("NOSUMMARY CLI: log `Channel closed` không summary + đủ nhãn run, --strict=1 --lane-db-set=1 ⇒ LEVEL:red, exit 1", () => {
  const expected = manifestFiles();
  const r = runGuardCli(crashLogWithRuns(expected), [
    ...STRICT_LANE,
    `--expect-run-files=${MANIFEST}`,
  ]);
  assert.equal(r.level, "red", r.stdout);
  assert.equal(r.status, 1);
  assert.equal(r.storage, `skips=0 runs=${expected.length} calls=0`);
  const bare = runGuardCli(crashLogWithRuns([SF]), ["--strict=1", "--lane-db-set=1"]);
  assert.equal(bare.level, "red", bare.stdout);
});

test("NOSUMMARY CLI đối chứng đứng cạnh: cùng nhãn run + CÓ summary ⇒ LEVEL:ok, exit 0", () => {
  const r = runGuardCli(runLog(manifestFiles()), [
    ...STRICT_LANE,
    `--expect-run-files=${MANIFEST}`,
  ]);
  assert.equal(r.level, "ok", r.stdout);
  assert.equal(r.status, 0);
});

test("NOSUMMARY CLI không strict: log không summary + LANE_DB ⇒ LEVEL:warn, exit 0 (tier thường không vỡ)", () => {
  const r = runGuardCli(crashLogWithRuns([SF]), [
    "--strict=0",
    "--lane-db-set=1",
    "--fail-unless-ok=0",
  ]);
  assert.equal(r.level, "warn", r.stdout);
  assert.equal(r.status, 0);
});

// Đường chunk-runner của check.sh (`node harness/chunk-test.mjs | tee`): mỗi chunk (kể cả lượt chạy lại) là MỘT tiến
// trình vitest riêng, reporter default ⇒ tự in summary. Chunk chết rồi được chạy lại vẫn để lại summary của lượt lại.
const CHUNK_CRASHED_THEN_RERUN = [
  "──▶ @mediaos/api: 2 file spec → 1 chunk",
  "  ── chunk 1/1",
  ` ${ESC}[32m✓${ESC}[39m test/integration/bonus-penalty-transition.int-spec.ts ${ESC}[2m(8 tests)${ESC}[22m`,
  `${ESC}[31m${ESC}[1mError${ESC}[22m: Channel closed${ESC}[39m`,
  "  ── chunk 1/1 · chạy lại 1/2 (crash hạ tầng)",
  runLabel({ file: SF, bucket: "mediaos-test" }),
  runLabel({ file: SF2, bucket: "mediaos-test" }),
  ...SUMMARY,
  "═══════════ KẾT QUẢ CHUNK-TEST ═══════════",
].join("\n");

test("NOSUMMARY check.sh chunk-runner: chunk chết rồi chạy lại có summary ⇒ ok (KHÔNG đỏ oan)", () => {
  const dir = mkdtempSync(join(tmpdir(), "guard-nosummary-manifest-"));
  const manifest = join(dir, "storage-spec-files.json");
  writeFileSync(manifest, JSON.stringify([SF, SF2]), "utf8");
  const r = runCheckShGuard({
    guardPath: GUARD_CLI,
    logText: CHUNK_CRASHED_THEN_RERUN,
    strict: 1,
    manifest,
  });
  assert.equal(r.level, "ok", r.message + r.stderr);
});

test("NOSUMMARY check.sh: log không summary nào (mọi chunk chết / runner chết sớm) ⇒ red khi strict · warn khi không", () => {
  const logText = crashLogWithRuns(manifestFiles());
  const red = runCheckShGuard({ guardPath: GUARD_CLI, logText, strict: 1, manifest: MANIFEST });
  assert.equal(red.level, "red", red.message + red.stderr);
  const warn = runCheckShGuard({ guardPath: GUARD_CLI, logText, strict: 0, manifest: MANIFEST });
  assert.equal(warn.level, "warn", warn.message + warn.stderr);
});
