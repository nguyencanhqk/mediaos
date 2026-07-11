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

/**
 * decideGate({skippedFiles, laneDbSet, threshold, strict}) → {level, message}
 *   level: 'ok' | 'warn' | 'red'
 *   - laneDbSet=true            → 'ok' LUÔN (kể cả skippedFiles cao/null — LANE_DB là bằng chứng
 *                                  deny-path đã chạy như CI; số skip còn lại là RED-placeholder cố ý).
 *   - skippedFiles null/undefined (không đọc được summary) → 'warn' (strict → 'red'): KHÔNG có
 *     bằng chứng test đã thực sự chạy (nghi turbo-cache hoặc crash giữa chừng).
 *   - skippedFiles > threshold  → 'warn' (strict → 'red'): banner LOUD.
 *   - còn lại                   → 'ok'.
 */
export function decideGate({
  skippedFiles,
  laneDbSet = false,
  threshold = DEFAULT_THRESHOLD,
  strict = false,
} = {}) {
  if (laneDbSet) {
    return {
      level: "ok",
      message: `LANE_DB đã set — int-spec chạy đầy đủ (skipped files=${skippedFiles ?? 0}).`,
    };
  }

  if (skippedFiles === null || skippedFiles === undefined) {
    return {
      level: strict ? "red" : "warn",
      message:
        "KHÔNG xác định được số int-spec bị skip (không tìm thấy dòng summary vitest — nghi turbo-cache/crash) " +
        "— KHÔNG có bằng chứng deny-path/IDOR/cross-tenant đã chạy",
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

// ── CLI: `node harness/lane-db-guard.mjs <logfile> --lane-db-set=0|1 --threshold=N --strict=0|1` ──
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

  let text;
  try {
    text = readFileSync(logPath, "utf8");
  } catch (err) {
    console.log("LEVEL:warn");
    console.log("FILES:");
    console.log("TESTS:");
    console.log(`MESSAGE:không đọc được log test (${logPath}): ${err.message}`);
    return;
  }

  const { files, tests } = parseVitestSkips(text);
  const gate = decideGate({ skippedFiles: files, laneDbSet, threshold, strict });

  console.log(`LEVEL:${gate.level}`);
  console.log(`FILES:${files ?? ""}`);
  console.log(`TESTS:${tests ?? ""}`);
  console.log(`MESSAGE:${gate.message}`);
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
