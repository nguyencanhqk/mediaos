#!/usr/bin/env node
// harness/lane-db-guard.mjs — chống "XANH giả" khi test bị SKIP im lặng vì thiếu LANE_DB.
//
// VÌ SAO: `pnpm test` (vitest, xem CLAUDE.md §9 mục 5) gate nhiều suite deny-path/IDOR/cross-tenant
// bằng `describe.skipIf(!hasDb)` — khi LANE_DB (hoặc DATABASE_URL cô lập) KHÔNG set, các suite này
// bị SKIP (không FAIL) → `pnpm test` báo "XANH" dù các đường-từ-chối chưa hề chạy. Đo thực tế
// (2026-07-11, worktree S5-QA-GATE-LANEDB-1): KHÔNG LANE_DB → 126 test-file / 2024 test bị skip
// (trên tổng 347 file / 5592 test của @mediaos/api); CÓ LANE_DB (chain-migrate qua
// scripts/lane-db-setup.sh) → tụt còn 1 test-file / 37 test (phần còn lại là placeholder RED cố ý
// skip, không liên quan LANE_DB). Ngưỡng mặc định 20 nằm giữa 2 mốc đó.
//
// File này CHỈ chứa logic THUẦN (không đọc file/env/process khi gọi như thư viện) để test được
// bằng golden-fixture (xem harness/lane-db-guard.test.mjs). Phần CLI ở cuối file (đọc file log +
// in kết quả `KEY:value` từng dòng cho check.sh) chỉ chạy khi file được gọi trực tiếp bằng `node`.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_THRESHOLD = Number(process.env.INT_SKIP_THRESHOLD ?? 20);

const ANSI_RE = /\x1b\[[0-9;]*m/g;
// Turbo tiền tố dòng log: "@mediaos/api:test: ", "@mediaos/contracts:build: " …
const TURBO_PREFIX_RE = /^@[^\s:]+:[^\s:]+:/;

function cleanLine(rawLine) {
  return rawLine.replace(ANSI_RE, "").replace(TURBO_PREFIX_RE, "").trim();
}

function extractSkipped(segment) {
  const m = segment.match(/(\d+)\s+skipped\b/);
  return m ? Number(m[1]) : 0;
}

/**
 * parseVitestSkips(text) — đọc output vitest THÔ (có thể có mã màu ANSI + tiền tố turbo,
 * nhiều package nối tiếp nhau) → tổng số test-file bị skip + tổng số test bị skip.
 *
 * Trả {files: number, tests: number} khi tìm thấy ít nhất 1 dòng summary tương ứng
 * ("Test Files … (N)" / "Tests … (N)"), CỘNG DỒN nếu nhiều package đều in dòng đó.
 * Trả {files: null, tests: null} khi KHÔNG tìm thấy dòng summary nào (turbo cache
 * suppress log, hoặc process crash giữa chừng trước khi vitest kịp in tổng kết) — nghĩa là
 * KHÔNG CÓ BẰNG CHỨNG, không được ngầm hiểu là 0.
 */
export function parseVitestSkips(text) {
  if (typeof text !== "string" || text.length === 0) return { files: null, tests: null };

  let files = null;
  let tests = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (line.startsWith("Test Files")) {
      files = (files ?? 0) + extractSkipped(line.slice("Test Files".length));
    } else if (line.startsWith("Tests")) {
      tests = (tests ?? 0) + extractSkipped(line.slice("Tests".length));
    }
  }

  return { files, tests };
}

/** shouldWarn(n, threshold) — n là số nguyên đã biết (KHÔNG null); so ngưỡng thuần. */
export function shouldWarn(n, threshold) {
  return typeof n === "number" && Number.isFinite(n) && n > threshold;
}

// ══ S16-SOCIAL-STORAGETESTGATE-1 (plan D-4/D-6) — ca storage bị bỏ qua THEO TỪNG CA bên trong tệp đang chạy ══
//
// «Test Files … skipped» chỉ thấy cả-tệp bị skip. Ca storage bị `ctx.skip()` bên trong một tệp CHẠY thì vô hình
// với nó ⇒ cổng cũ trả `ok` khi LANE_DB set dù 16 ca storage không chạy (đo ở RED, plan §9.3). Helper test in nhãn
// (định dạng sinh ở `apps/api/test/helpers/storage-test-target.ts` — đổi ở đó ⇒ đổi ở đây, R2 khứ hồi canh):
//   [storage-test-skip] {"file":…,"task":…,"case":…,"reason":…}  — khử trùng lặp theo (file, task)
//   [storage-test-run]  {"file":…,"bucket":…}                      — khử trùng lặp theo file
//   [storage-test-call] {"file":…,"command":…}                     — tripwire D-10 chặn; đếm TỪNG dòng
export const STORAGE_SKIP_TAG = "[storage-test-skip]";
export const STORAGE_RUN_TAG = "[storage-test-run]";
export const STORAGE_CALL_TAG = "[storage-test-call]";

function parseLabelBody(line, tag) {
  const at = line.indexOf(tag);
  if (at === -1) return undefined;
  try {
    const body = JSON.parse(line.slice(at + tag.length).trim());
    return body !== null && typeof body === "object" ? body : null;
  } catch {
    return null; // nhãn bị cắt/chen dòng — VẪN là một nhãn, người gọi đếm riêng (không nuốt)
  }
}

/**
 * parseStorageMarkers(text) → {skips, runs, calls} — LUÔN là số (0 khi không có nhãn; không bao giờ null).
 * Nhãn hỏng JSON vẫn được đếm (mỗi dòng một khoá riêng) — thà đếm thừa thành ĐỎ còn hơn nuốt thành XANH.
 */
export function parseStorageMarkers(text) {
  const skips = new Set();
  const runs = new Set();
  let calls = 0;
  if (typeof text !== "string" || text.length === 0) return { skips: 0, runs: 0, calls: 0 };

  text.split(/\r?\n/).forEach((rawLine, lineNo) => {
    const line = cleanLine(rawLine);
    const opaque = `#dòng-${lineNo}`;
    const skip = parseLabelBody(line, STORAGE_SKIP_TAG);
    if (skip !== undefined) {
      const ok = skip && typeof skip.file === "string" && typeof skip.task === "string";
      skips.add(ok ? JSON.stringify([skip.file, skip.task]) : opaque);
      return;
    }
    const run = parseLabelBody(line, STORAGE_RUN_TAG);
    if (run !== undefined) {
      runs.add(run && typeof run.file === "string" ? JSON.stringify([run.file]) : opaque);
      return;
    }
    if (parseLabelBody(line, STORAGE_CALL_TAG) !== undefined) calls += 1;
  });

  return { skips: skips.size, runs: runs.size, calls };
}

/**
 * parseStorageRunFiles(text) → tên tệp (trường `file`) của mọi nhãn `[storage-test-run]` HỢP LỆ, khử trùng lặp, sắp xếp.
 * Dùng cho cổng THEO TỪNG TỆP (`--expect-run-files`): tổng `runs > 0` không đủ — một tệp storage bị skip cả tệp
 * (`describe.skip`) hay không còn gọi cổng thì mất nhãn run mà 10 tệp còn lại vẫn đẩy `runs` > 0 (cổng LIGHT F2).
 */
export function parseStorageRunFiles(text) {
  if (typeof text !== "string" || text.length === 0) return [];
  const files = new Set();
  for (const rawLine of text.split(/\r?\n/)) {
    const run = parseLabelBody(cleanLine(rawLine), STORAGE_RUN_TAG);
    if (run && typeof run.file === "string" && run.file.length > 0) files.add(run.file);
  }
  return [...files].sort();
}

/**
 * parseExpectedRunFiles(jsonText) → mảng tên tệp storage mong đợi (manifest dùng chung với ratchet R4:
 * `apps/api/test/storage-spec-files.json`). Ném khi không phải mảng chuỗi không rỗng, không trùng — manifest hỏng
 * KHÔNG được ngầm thành «không mong đợi gì» (xanh giả).
 */
export function parseExpectedRunFiles(jsonText) {
  const list = JSON.parse(jsonText);
  const valid =
    Array.isArray(list) &&
    list.length > 0 &&
    list.every((f) => typeof f === "string" && f.length > 0) &&
    new Set(list).size === list.length;
  if (!valid) throw new Error("manifest phải là mảng KHÔNG rỗng các tên tệp (chuỗi, không trùng)");
  return list;
}

const LEVEL_RANK = { ok: 0, warn: 1, red: 2 };

function isCount(n) {
  return typeof n === "number" && Number.isFinite(n);
}

/** Phán quyết riêng phần storage; `null` khi người gọi không truyền số storage (hành vi cũ). */
function decideStorage({
  storageSkips,
  storageRuns,
  storageCalls,
  laneDbSet,
  strict,
  expectedRunFiles,
  storageRunFiles,
}) {
  if (![storageSkips, storageRuns, storageCalls].some(isCount)) return null;
  const skips = isCount(storageSkips) ? storageSkips : 0;
  const runs = isCount(storageRuns) ? storageRuns : 0;
  const calls = isCount(storageCalls) ? storageCalls : 0;
  const counts = `storage: ${skips} ca BỎ QUA · ${runs} tệp CHẠY · ${calls} lời gọi bị tripwire chặn`;

  if (skips > 0 || calls > 0) {
    return {
      level: strict ? "red" : "warn",
      message: `${counts} — ca storage KHÔNG chạy trên bucket test cho phép (hồ sơ offline?)`,
    };
  }
  if (strict && laneDbSet && runs === 0) {
    return {
      level: "red",
      message: `${counts} — 0 tệp storage CHẠY dù LANE_DB set: thành công RỖNG, không có bằng chứng`,
    };
  }
  if (strict && laneDbSet && Array.isArray(expectedRunFiles)) {
    const ran = new Set(Array.isArray(storageRunFiles) ? storageRunFiles : []);
    const missing = expectedRunFiles.filter((f) => !ran.has(f));
    if (missing.length > 0) {
      return {
        level: "red",
        message:
          `${counts} — ${missing.length}/${expectedRunFiles.length} tệp storage mong đợi KHÔNG phát nhãn run ` +
          `(skip cả tệp / không gọi cổng?): ${missing.join(", ")}`,
      };
    }
  }
  return { level: "ok", message: counts };
}

/**
 * decideGate({skippedFiles, laneDbSet, threshold, strict, storageSkips?, storageRuns?, storageCalls?}) → {level, message}
 *   level: 'ok' | 'warn' | 'red' — lấy MỨC CAO HƠN của hai phán quyết:
 *   (A) storage (D-6, chỉ khi truyền ít nhất một số storage — CLI LUÔN truyền; gọi thư viện kiểu cũ ⇒ bỏ qua):
 *     - strict ∧ (skips > 0 ∨ calls > 0)        → 'red'  (BẤT KỂ LANE_DB — đây là lỗ cũ)
 *     - strict ∧ laneDbSet ∧ runs === 0         → 'red'  (thành công rỗng)
 *     - strict ∧ laneDbSet ∧ có tệp trong expectedRunFiles KHÔNG nằm trong storageRunFiles → 'red' (theo từng tệp)
 *     - không strict ∧ (skips ∨ calls) > 0      → 'warn' (tối thiểu)
 *   (B) lane-db:
 *     - skippedFiles null/undefined (không đọc được summary) → 'warn' (strict → 'red') BẤT KỂ LANE_DB
 *       (S16-SOCIAL-GUARDNOSUMMARY-1): KHÔNG có bằng chứng test đã chạy xong (turbo-cache, crash giữa chừng).
 *     - laneDbSet=true            → 'ok' (kể cả skippedFiles cao — LANE_DB là bằng chứng
 *                                  deny-path đã chạy như CI; số skip còn lại là RED-placeholder cố ý).
 *     - skippedFiles > threshold  → 'warn' (strict → 'red'): banner LOUD.
 *     - còn lại                   → 'ok'.
 */
export function decideGate({
  skippedFiles,
  laneDbSet = false,
  threshold = DEFAULT_THRESHOLD,
  strict = false,
  storageSkips,
  storageRuns,
  storageCalls,
  expectedRunFiles,
  storageRunFiles,
} = {}) {
  const laneGate = decideLaneDbGate({ skippedFiles, laneDbSet, threshold, strict });
  const storageGate = decideStorage({
    storageSkips,
    storageRuns,
    storageCalls,
    laneDbSet,
    strict,
    expectedRunFiles,
    storageRunFiles,
  });
  if (storageGate === null) return laneGate;
  if (LEVEL_RANK[storageGate.level] > LEVEL_RANK[laneGate.level]) return storageGate;
  if (storageGate.level === "ok") return laneGate;
  return { level: laneGate.level, message: `${laneGate.message} · ${storageGate.message}` };
}

function decideLaneDbGate({ skippedFiles, laneDbSet, threshold, strict }) {
  // S16-SOCIAL-GUARDNOSUMMARY-1: summary vắng xét TRƯỚC LANE_DB — LANE_DB chỉ chứng minh int-spec KHÔNG bị skip vì
  // thiếu DB, không chứng minh bộ test đã chạy XONG (lượt chết `Channel closed` giữa chừng vẫn có LANE_DB).
  if (skippedFiles === null || skippedFiles === undefined) {
    const why = laneDbSet
      ? "LANE_DB đã set nhưng log KHÔNG có dòng tổng kết vitest (Test Files/Tests) — lượt test chết giữa chừng/log cụt"
      : "KHÔNG xác định được số int-spec bị skip (không tìm thấy dòng tổng kết vitest — nghi turbo-cache/crash)";
    return {
      level: strict ? "red" : "warn",
      message: `${why} — KHÔNG có bằng chứng deny-path/IDOR/cross-tenant đã chạy xong`,
    };
  }

  if (laneDbSet) {
    return {
      level: "ok",
      message: `LANE_DB đã set — int-spec chạy đầy đủ (skipped files=${skippedFiles}).`,
    };
  }

  if (shouldWarn(skippedFiles, threshold)) {
    return {
      level: strict ? "red" : "warn",
      message: `${skippedFiles} int-spec SKIPPED (thiếu LANE_DB) — deny-path/IDOR/cross-tenant KHÔNG chạy`,
    };
  }

  return { level: "ok", message: `int-spec skip trong ngưỡng (${skippedFiles} <= ${threshold}).` };
}

// ── CLI: `node harness/lane-db-guard.mjs <logfile> --lane-db-set=0|1 --threshold=N --strict=0|1 [--fail-unless-ok=1]
//        [--expect-run-files=<manifest.json>]` ──
// In kết quả từng dòng `KEY:value` (KHÔNG JSON) để bash check.sh đọc bằng grep/cut, tránh phụ thuộc
// parser JSON trong bash.
function runCli(argv) {
  const [logPath, ...rest] = argv;
  const flags = Object.fromEntries(
    rest
      .filter((a) => a.startsWith("--"))
      .map((a) => {
        const eq = a.indexOf("=");
        return eq === -1 ? [a.slice(2), "1"] : [a.slice(2, eq), a.slice(eq + 1)];
      }),
  );

  const laneDbSet = flags["lane-db-set"] === "1";
  const strict = flags.strict === "1";
  const threshold = Number(flags.threshold ?? DEFAULT_THRESHOLD);
  // S16-SOCIAL-STORAGETESTGATE-1 (D-6/D-8): CI cần mã thoát thay cho bash tự grep/cut. Mặc định GIỮ exit 0
  // (check.sh đọc LEVEL rồi tự quyết) — chỉ cờ này mới biến LEVEL ≠ ok thành exit 1.
  const failUnlessOk = flags["fail-unless-ok"] === "1";

  const failNoEvidence = (message) => {
    console.log(`LEVEL:${strict ? "red" : "warn"}`);
    console.log("FILES:");
    console.log("TESTS:");
    console.log("STORAGE:");
    console.log(`MESSAGE:${message}`);
    if (failUnlessOk) process.exitCode = 1;
  };

  let text;
  try {
    text = readFileSync(logPath, "utf8");
  } catch (err) {
    failNoEvidence(`không đọc được log test (${logPath}): ${err.message}`);
    return;
  }

  // Cổng THEO TỪNG TỆP (cổng LIGHT F2): cờ có mặt mà manifest đọc/parse hỏng ⇒ KHÔNG có bằng chứng, không bỏ qua cổng.
  let expectedRunFiles;
  if (flags["expect-run-files"] !== undefined) {
    try {
      expectedRunFiles = parseExpectedRunFiles(readFileSync(flags["expect-run-files"], "utf8"));
    } catch (err) {
      failNoEvidence(
        `không đọc được manifest tệp storage (${flags["expect-run-files"]}): ${err.message}`,
      );
      return;
    }
  }

  const { files, tests } = parseVitestSkips(text);
  const storage = parseStorageMarkers(text);
  const gate = decideGate({
    skippedFiles: files,
    laneDbSet,
    threshold,
    strict,
    storageSkips: storage.skips,
    storageRuns: storage.runs,
    storageCalls: storage.calls,
    expectedRunFiles,
    storageRunFiles: parseStorageRunFiles(text),
  });

  console.log(`LEVEL:${gate.level}`);
  console.log(`FILES:${files ?? ""}`);
  console.log(`TESTS:${tests ?? ""}`);
  console.log(`STORAGE:skips=${storage.skips} runs=${storage.runs} calls=${storage.calls}`);
  console.log(`MESSAGE:${gate.message}`);
  if (failUnlessOk && gate.level !== "ok") process.exitCode = 1;
}

const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runCli(process.argv.slice(2));
}
