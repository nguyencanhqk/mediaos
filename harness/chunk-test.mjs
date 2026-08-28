#!/usr/bin/env node
// harness/chunk-test.mjs — chạy TOÀN BỘ test của workspace theo CHUNK, gộp về MỘT mã thoát.
//
// VÌ SAO TỒN TẠI (KI-014 · S6-QA-CHUNK-1):
//   Trên máy dev Windows này, `pnpm test` (một tiến trình cho mỗi package) chết giữa chừng với
//   `Unhandled Rejection: Error: Channel closed (ERR_IPC_CHANNEL_CLOSED)` — **0 ca test đỏ**. Đo
//   được 100% (5/5 lần) ở tier `pnpm test`. Gốc nằm NGOÀI repo:
//
//     tinypool@1.1.1 `ProcessWorker.send()` chỉ chặn `if (!this.isTerminating)` — KHÔNG kiểm tra
//     kênh IPC đã đóng. Khi một worker fork thoát ngoài dự kiến, message birpc còn trong hàng đợi
//     của MessagePort vẫn được đẩy vào `process.send()` của tiến trình đã chết → ném
//     ERR_IPC_CHANNEL_CLOSED ở TIẾN TRÌNH CHÍNH → vitest tính là Unhandled Rejection → cả run ĐỎ.
//
//   Số đo đầy đủ của ma trận cấu hình (pool · maxForks · isolate · tầng gọi · Node 22 vs 24):
//   `docs/QA/evidence/S6-QA-CHUNK-1-KI-014-ROOT-CAUSE.md`. Tóm tắt vì sao KHÔNG vá được tận gốc
//   trong phạm vi WO này: tinypool 1.1.1 là bản CUỐI của nhánh 1.x, vitest 3.2.6 ghim `^1.1.1`,
//   tinypool 2.x là major khác API ⇒ chỉ nâng được bằng cách nâng vitest lên 4.x (di trú toàn
//   workspace, ngoài phạm vi). Đổi pool (`threads` → SEGV 139) và `--no-isolate` (test đỏ thật)
//   đều TỆ HƠN. Node 22 (đúng bản CI dùng) VẪN crash ⇒ không phải lệch runtime.
//
// CHIẾN LƯỢC: giảm XÁC SUẤT trúng đua bằng cách chia nhỏ (ít vòng tạo/huỷ worker mỗi tiến trình)
// + hạ trần worker, rồi CHẠY LẠI chunk nào chết vì hạ tầng. An toàn của luật chạy-lại dựa trên số
// đo: 27/27 lần crash IPC quan sát được đều có **0 test đỏ** (xem evidence §3). Test đỏ THẬT thì
// KHÔNG BAO GIỜ được chạy lại.
//
// ── BISECT (2026-08-03) — vì sao chạy-lại-nguyên-chunk là KHÔNG ĐỦ ──────────────────────────
// Đo trên chính máy này (@mediaos/api, 469 file, LANE_DB): chunk 8/12 crash hạ tầng, chạy lại 2
// lần vẫn crash ⇒ **429/469 file chạy, MẤT 40 file**. Runner báo ĐỎ đúng (không xanh-giả), nhưng
// kết quả thực dụng là 40 file không có bằng chứng gì — trong đó có cả cổng như
// `xtenant-fk-ratchet`. Chạy lại NGUYÊN chunk không cứu được vì xác suất crash phụ thuộc KÍCH
// THƯỚC chunk (RELEASE-06 §4.4: gộp 64 file chết, tách <50 thì xanh) — chạy lại y nguyên là lặp
// lại đúng điều kiện đã hỏng.
//
// Nên khi chạy lại hết lượt mà VẪN crash: CHIA ĐÔI rồi đệ quy. Hai thứ thu được:
//   1. cứu phần lớn file (nửa lành vẫn chạy) ⇒ phạm vi không còn co 40 file một lúc;
//   2. hội tụ về ĐÍCH DANH file gây crash. "1 file crash không cứu được: <tên>" là thứ sửa được;
//      "40 file thiếu" thì không.
// Test đỏ THẬT vẫn KHÔNG chia, KHÔNG chạy lại — chia đôi chỉ áp cho nhánh crash hạ tầng.
//
// CHỐNG GIẢM PHẠM VI LÉN: danh sách file lấy từ chính `vitest list --filesOnly` của từng package;
// cuối run đối chiếu tập file ĐÃ CHẠY (đọc từ reporter JSON) với tập mong đợi — thiếu file ⇒ ĐỎ.
// File khớp tên spec nhưng vitest KHÔNG thu thập (exclude/parked/đặt sai thư mục) được CÔNG BỐ
// tường minh thay vì biến mất.
//
// Dùng:
//   node harness/chunk-test.mjs                       # tất cả package có test
//   node harness/chunk-test.mjs --packages=@mediaos/api,@mediaos/app
//   node harness/chunk-test.mjs --chunk-size=40 --max-forks=8 --retries=2
//   node harness/chunk-test.mjs --no-build            # bỏ bước build deps (^build của turbo)
//
// CI ubuntu KHÔNG dùng file này — `check.sh` chỉ gọi runner khi chạy trên Windows; đường
// `pnpm test` một-lần giữ nguyên cho CI (xem RELEASE-06 §4.4: CI ubuntu chưa từng dính KI-014).

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rescueRun } from "./chunk-bisect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Trần mặc định. chunk-size: RELEASE-06 §4.4 đo được crash phụ thuộc KÍCH THƯỚC chunk (gộp 64 file
// chết, tách <50 thì xanh). max-forks: mặc định của vitest là `availableParallelism()-1` = 31 trên
// máy 32 nhân này; hạ trần làm giảm hẳn số vòng tạo/huỷ worker (xem evidence §2).
const DEFAULTS = { chunkSize: 40, maxForks: 8, retries: 2, bisect: true };

// Chữ ký crash HẠ TẦNG (được phép chạy lại). KHÔNG bao gồm test đỏ.
const CRASH_SIGNATURES = [
  /ERR_IPC_CHANNEL_CLOSED/,
  /Channel closed/,
  /Segmentation fault/i,
  /SIGSEGV/,
  /3221225477/, // 0xC0000005 ACCESS_VIOLATION (Windows)
];

const SPEC_FILE_RE = /\.(spec|e2e-spec|int-spec)\.(ts|tsx)$/;

/**
 * BASELINE "mang tên spec nhưng vitest KHÔNG thu thập" — đo 2026-07-28 (gate bù S6-QA-CHUNK-1).
 *
 * Đây là CỔNG, không phải ghi chú. Vế `missing` bên dưới chỉ bắt được file đã lọt vào `vitest list`
 * rồi không chạy; nó MÙ với kiểu co phạm vi nguy hiểm hơn: file spec nằm NGOÀI `include` nên không
 * bao giờ vào danh sách. Bẫy này đã có tiền lệ trong repo (apps/api chỉ chạy `src/**\/*.spec.ts` ⇒
 * spec đặt ở `test/unit/**` không bao giờ chạy mà mọi reporter vẫn XANH). In ra dạng ℹ️ là không đủ:
 * log dài, không ai đọc.
 *
 * LUẬT: file KHÔNG có trong baseline mà không được thu thập ⇒ ĐỎ. Muốn thêm dòng vào đây là một
 * quyết định (module park / exclude cố ý), phải sửa chính file này.
 * Dòng thừa (đã xoá hoặc nay chạy được) chỉ CẢNH BÁO — nó không giấu được test nào.
 *
 * 5 dòng hiện tại đều là module đã PARK theo de-media-fy (CLAUDE.md §1): finance · ui-config ·
 * webhooks.
 *
 * ⓘ Dòng `test/workflow-lifecycle.e2e-spec.ts` ĐÃ GỠ ở `S10-CLEAN-WORKFLOWCLUSTER-2`: file bị XOÁ
 * hẳn cùng cụm workflow, nên nó không còn là "spec park không thu thập" mà là dòng baseline mồ côi.
 */
const UNCOLLECTED_BASELINE = {
  "@mediaos/api": [
    "test/integration/finance-cost-allocation-controller-deny.int-spec.ts",
    "test/integration/finance-cost-controller-deny.int-spec.ts",
    "test/integration/finance-revenue-controller-deny.int-spec.ts",
    "test/integration/ui-config-deny.int-spec.ts",
    "test/integration/webhooks-deny.int-spec.ts",
  ],
};

// Dấu hiệu test ĐỎ THẬT đọc từ VĂN BẢN (không phải từ báo cáo JSON). Cần thiết cho trường hợp xấu:
// chunk có test đỏ RỒI mới crash ⇒ không kịp ghi JSON ⇒ `failed` đọc ra 0 ⇒ nếu chỉ tin JSON thì
// runner sẽ tưởng là crash hạ tầng và CHẠY LẠI, che mất cái đỏ thật. Reporter mặc định của vitest in
// file đỏ theo dạng `× đường/dẫn.spec.ts` (sau khi bóc mã màu ANSI).
const REAL_FAILURE_TEXT_RE = /^\s*×\s+\S+/m;
const ANSI_RE = /\x1b\[[0-9;]*m/g;

// ── tiện ích ────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const opts = { ...DEFAULTS, packages: null, build: true };
  for (const a of argv) {
    if (a.startsWith("--packages=")) opts.packages = a.slice(11).split(",").filter(Boolean);
    else if (a.startsWith("--chunk-size=")) opts.chunkSize = Number(a.slice(13));
    else if (a.startsWith("--max-forks=")) opts.maxForks = Number(a.slice(12));
    else if (a.startsWith("--retries=")) opts.retries = Number(a.slice(10));
    else if (a === "--no-build") opts.build = false;
    // Thoát hiểm khi cần tái hiện HÀNH VI CŨ để so sánh (vd. đo lại số đo trong header).
    else if (a === "--no-bisect") opts.bisect = false;
  }
  return opts;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

/**
 * Package bị `pnpm-workspace.yaml` LOẠI TRỪ (dòng `- "!apps/x"`) — workspace RIÊNG, không thuộc
 * `turbo run test`, không có node_modules sau `pnpm install` ở gốc.
 *
 * ĐỌC TỪ pnpm-workspace.yaml thay vì hard-code tên: hard-code `lms` là lý do `fbpost` (loại trừ từ
 * S9-SOCIAL-APP-1) lọt lưới suốt — chunk-test cố chạy vitest ở đó và ĐỎ vì THIẾU node_modules, không
 * vì có bài đỏ. Suy từ nguồn sự thật ⇒ app vệ tinh thứ ba không tái diễn lỗi này.
 */
function workspaceExcluded() {
  const ws = path.join(REPO_ROOT, "pnpm-workspace.yaml");
  if (!fs.existsSync(ws)) return new Set();
  // Chỉ nhận mục phủ định của khối `packages:` — `- "!apps/lms"` / `- '!apps/fbpost'` / - !apps/x
  const out = new Set();
  for (const line of fs.readFileSync(ws, "utf8").split(/\r?\n/)) {
    const m = /^\s*-\s*["']?!([^"'#\s]+)["']?\s*(?:#.*)?$/.exec(line);
    if (m) out.add(m[1].replace(/\/+$/, ""));
  }
  return out;
}

/** Mọi package trong workspace có script `test` chạy vitest. */
function discoverTargets() {
  const targets = [];
  const excluded = workspaceExcluded();
  for (const group of ["apps", "packages"]) {
    const dir = path.join(REPO_ROOT, group);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      if (excluded.has(`${group}/${name}`)) continue;
      const pkgDir = path.join(dir, name);
      const pkgJson = path.join(pkgDir, "package.json");
      if (!fs.existsSync(pkgJson)) continue;
      const pkg = JSON.parse(fs.readFileSync(pkgJson, "utf8"));
      if (!pkg.scripts?.test?.includes("vitest")) continue;
      targets.push({ name: pkg.name, dir: pkgDir, testScript: pkg.scripts.test });
    }
  }
  return targets;
}

/** Đường dẫn entry vitest.mjs GIẢI TỪ chính package đó (tránh overhead + phân giải sai của npx). */
function resolveVitestEntry(pkgDir) {
  const require = createRequire(path.join(pkgDir, "package.json"));
  const pkgPath = require.resolve("vitest/package.json");
  return path.join(path.dirname(pkgPath), "vitest.mjs");
}

/** `vitest list --filesOnly` → danh sách file spec (đường dẫn tương đối, dấu /). */
function listSpecFiles(target) {
  const entry = resolveVitestEntry(target.dir);
  const res = spawnSync(process.execPath, [entry, "list", "--filesOnly"], {
    cwd: target.dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    throw new Error(
      `vitest list thất bại cho ${target.name} (exit ${res.status})\n${res.stderr ?? ""}`,
    );
  }
  return res.stdout
    .split(/\r?\n/)
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim())
    .filter((l) => SPEC_FILE_RE.test(l))
    .map((l) => toPosix(path.isAbsolute(l) ? path.relative(target.dir, l) : l))
    .sort();
}

/**
 * File TRÔNG như spec nhưng vitest KHÔNG thu thập — exclude cố ý (de-media-fy / phase-defer) HOẶC
 * đặt sai thư mục nên không khớp `include` (bẫy đã biết: apps/api chỉ chạy src/**\/*.spec.ts, spec
 * nằm ở test/unit/** KHÔNG BAO GIỜ chạy). Công bố thay vì để biến mất khỏi mọi reporter.
 */
function listUncollected(target, collected) {
  const res = spawnSync("git", ["ls-files", "--", "."], {
    cwd: target.dir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) return [];
  const collectedSet = new Set(collected);
  return res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => SPEC_FILE_RE.test(l))
    .filter((l) => !collectedSet.has(l))
    .sort();
}

/** Chạy MỘT chunk. Trả {status, crashed, ranFiles, failed, output}. */
function runChunk(target, files, opts, jsonPath) {
  const entry = resolveVitestEntry(target.dir);
  const args = [
    entry,
    "run",
    ...files,
    `--poolOptions.forks.maxForks=${opts.maxForks}`,
    "--reporter=default",
    "--reporter=json",
    `--outputFile.json=${jsonPath}`,
  ];

  try {
    fs.rmSync(jsonPath, { force: true });
  } catch {
    /* không sao */
  }

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: target.dir,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let output = "";
    // Vẫn stream ra console: check.sh `tee` log này cho harness/lane-db-guard.mjs đếm số int-spec
    // bị SKIP. Bỏ stream = guard mù = mất chốt chống XANH-giả khi thiếu LANE_DB.
    const tee = (buf, sink) => {
      const s = buf.toString();
      output += s;
      sink.write(s);
    };
    child.stdout.on("data", (b) => tee(b, process.stdout));
    child.stderr.on("data", (b) => tee(b, process.stderr));

    child.on("close", (status) => {
      let ranFiles = [];
      let failed = 0;
      let jsonOk = false;
      try {
        const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
        ranFiles = (report.testResults ?? []).map((r) =>
          toPosix(path.relative(target.dir, r.name)),
        );
        // Đếm CA test đỏ (không cộng dồn số suite đỏ — cùng một lỗi sẽ bị đếm hai lần, làm báo cáo
        // sai lệch). Suite đỏ mà 0 ca đỏ (ví dụ vỡ lúc import/collect) vẫn phải tính là đỏ THẬT.
        const failedTests = Number(report.numFailedTests ?? 0);
        const failedSuites = Number(report.numFailedTestSuites ?? 0);
        failed = failedTests > 0 ? failedTests : failedSuites > 0 ? failedSuites : 0;
        jsonOk = true;
      } catch {
        jsonOk = false;
      }

      const hasCrashSig = CRASH_SIGNATURES.some((re) => re.test(output));
      // Test đỏ nhìn thấy được trong văn bản, kể cả khi JSON không ghi được (crash sau khi đã có đỏ).
      const sawRealFailureText = REAL_FAILURE_TEXT_RE.test(output.replace(ANSI_RE, ""));
      // Crash HẠ TẦNG = có chữ ký crash, HOẶC chết mà không kịp ghi báo cáo JSON (log cụt).
      // Điều kiện CỨNG: chỉ coi là hạ tầng khi KHÔNG có test đỏ nào — theo CẢ hai nguồn (JSON và
      // văn bản). Có bất kỳ dấu hiệu đỏ thật ⇒ KHÔNG chạy lại, báo đỏ ngay.
      const crashed =
        status !== 0 && failed === 0 && !sawRealFailureText && (hasCrashSig || !jsonOk);

      resolve({ status, crashed, ranFiles, failed, jsonOk, sawRealFailureText, output });
    });
  });
}

// ── chạy chính ──────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let targets = discoverTargets();
  if (opts.packages) {
    // Gõ sai tên package KHÔNG được phép im lặng bỏ qua — đó chính là kiểu "giảm phạm vi lén"
    // mà WO cấm (chạy 3/4 package rồi báo XANH).
    const known = new Set(targets.map((t) => t.name));
    const unknown = opts.packages.filter((p) => !known.has(p));
    if (unknown.length) {
      console.error(
        `[chunk-test] ❌ --packages có tên KHÔNG tồn tại (hoặc không có script test): ${unknown.join(", ")}`,
      );
      console.error(`[chunk-test]    package hợp lệ: ${[...known].join(", ")}`);
      process.exit(1);
    }
    targets = targets.filter((t) => opts.packages.includes(t.name));
  }

  if (targets.length === 0) {
    console.error("[chunk-test] KHÔNG tìm thấy package nào có test — dừng ĐỎ (nghi lọc sai).");
    process.exit(1);
  }

  console.log("");
  console.log("══════════ chunk-test (KI-014 workaround · S6-QA-CHUNK-1) ══════════");
  console.log(
    `  máy: ${os.platform()} ${os.arch()} · ${os.availableParallelism()} nhân · Node ${process.version}`,
  );
  console.log(
    `  chunk-size=${opts.chunkSize} · max-forks=${opts.maxForks} (mặc định vitest sẽ là ${os.availableParallelism() - 1}) · retries=${opts.retries}`,
  );
  console.log(`  LANE_DB=${process.env.LANE_DB ?? "(chưa set)"}`);
  console.log(`  package: ${targets.map((t) => t.name).join(", ")}`);
  console.log("");

  // `turbo run test` khai `dependsOn: ["^build"]` — gọi vitest thẳng sẽ BỎ bước đó ⇒ dist cũ của
  // contracts/ui/web-core gây đỏ-giả (memory stale-contracts-dist-typecheck-false-red).
  if (opts.build) {
    console.log("──▶ build deps (thay cho `^build` của turbo)");
    const b = spawnSync("npx", ["turbo", "run", "build", "--filter=./packages/*"], {
      cwd: REPO_ROOT,
      stdio: "inherit",
      shell: true,
    });
    if (b.status !== 0) {
      console.error("[chunk-test] ❌ build deps ĐỎ — dừng (test sau đó sẽ là đỏ-giả).");
      process.exit(1);
    }
    console.log("");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chunk-test-"));
  const results = [];
  let hardFail = false;

  for (const target of targets) {
    const expected = listSpecFiles(target);
    const uncollected = listUncollected(target, expected);
    const groups = chunk(expected, opts.chunkSize);

    console.log(`──▶ ${target.name}: ${expected.length} file spec → ${groups.length} chunk`);

    const ran = new Set();
    let realFailures = 0;
    let retriesUsed = 0;
    const crashedFiles = []; // file KHÔNG cứu được kể cả sau khi chia đôi
    let runSeq = 0;

    // Luật cứu (chạy lại → chia đôi → gọi tên thủ phạm) sống ở `chunk-bisect.mjs` để test được TẤT
    // ĐỊNH; ở đây chỉ bơm cách chạy THẬT một nhóm file vào.
    const runOne = async (files, label) => {
      console.log(`\n  ── ${label}`);
      return runChunk(
        target,
        files,
        opts,
        path.join(tmpDir, `${target.name.replace(/[^a-z0-9]/gi, "-")}-${runSeq++}.json`),
      );
    };

    for (let gi = 0; gi < groups.length; gi++) {
      const r = await rescueRun({
        files: groups[gi],
        label: `${target.name} chunk ${gi + 1}/${groups.length} (${groups[gi].length} file)`,
        runOne,
        opts,
        log: (m) => console.log(m),
      });
      r.ran.forEach((f) => ran.add(f));
      realFailures += r.realFailures;
      retriesUsed += r.retriesUsed;
      crashedFiles.push(...r.crashedFiles);
    }
    const unresolvedCrash = crashedFiles.length;

    // Chống giảm phạm vi lén: tập file ĐÃ CHẠY phải phủ hết tập `vitest list`.
    const missing = expected.filter((f) => !ran.has(f));
    // Vế thứ hai của cùng bất biến: file spec rơi RA NGOÀI `vitest list` (xem UNCOLLECTED_BASELINE).
    const baseline = UNCOLLECTED_BASELINE[target.name] ?? [];
    const unexpectedUncollected = uncollected.filter((f) => !baseline.includes(f));
    const staleBaseline = baseline.filter((f) => !uncollected.includes(f));
    const ok =
      realFailures === 0 &&
      unresolvedCrash === 0 &&
      missing.length === 0 &&
      unexpectedUncollected.length === 0;
    if (!ok) hardFail = true;

    results.push({
      name: target.name,
      expected: expected.length,
      ran: ran.size,
      missing,
      uncollected,
      unexpectedUncollected,
      staleBaseline,
      realFailures,
      unresolvedCrash,
      crashedFiles,
      retriesUsed,
      ok,
    });
    console.log("");
  }

  // ── báo cáo ───────────────────────────────────────────────────────────────
  console.log("");
  console.log("═══════════ KẾT QUẢ CHUNK-TEST ═══════════");
  for (const r of results) {
    const mark = r.ok ? "✅" : "❌";
    console.log(
      `  ${mark} ${r.name}: ${r.ran}/${r.expected} file chạy` +
        (r.retriesUsed ? ` · ${r.retriesUsed} lần chạy lại (crash hạ tầng)` : "") +
        (r.realFailures ? ` · ${r.realFailures} ĐỎ THẬT` : "") +
        (r.unresolvedCrash ? ` · ${r.unresolvedCrash} file crash không cứu được` : ""),
    );
    if (r.crashedFiles.length) {
      // Sau khi chia đôi, danh sách này đã hội tụ về ĐÍCH DANH file gây crash — khác hẳn
      // "thiếu 40 file" của bản trước, vốn không chỉ ra được gì để sửa.
      console.log(
        `      ❌ ${r.crashedFiles.length} file crash hạ tầng KHÔNG cứu được (chạy cô lập để xác nhận):`,
      );
      r.crashedFiles.forEach((f) => console.log(`        · ${f}`));
    }
    if (r.missing.length) {
      console.log(`      ⚠️  THIẾU ${r.missing.length} file (phạm vi bị co lại):`);
      r.missing.slice(0, 20).forEach((f) => console.log(`        · ${f}`));
      if (r.missing.length > 20) console.log(`        · … và ${r.missing.length - 20} file nữa`);
    }
    if (r.unexpectedUncollected.length) {
      // ĐỎ: file mang tên spec nhưng vitest không thu thập, và KHÔNG có trong baseline ⇒ đúng kiểu
      // co phạm vi im lặng mà runner này tồn tại để chặn (spec đặt sai thư mục = xanh giả).
      console.log(
        `      ❌ ${r.unexpectedUncollected.length} file tên-spec KHÔNG được vitest thu thập và KHÔNG có trong baseline:`,
      );
      r.unexpectedUncollected.forEach((f) => console.log(`        · ${f}`));
      console.log(
        `        → sửa vị trí file cho khớp \`include\` của ${r.name}, HOẶC thêm vào UNCOLLECTED_BASELINE`,
      );
      console.log(`          trong harness/chunk-test.mjs kèm lý do (đó là một quyết định).`);
    }
    if (r.staleBaseline.length) {
      // Chỉ cảnh báo: dòng thừa trong baseline không giấu được test nào (file đã xoá hoặc nay chạy).
      console.log(`      ⚠️  ${r.staleBaseline.length} dòng UNCOLLECTED_BASELINE đã cũ — gỡ đi:`);
      r.staleBaseline.forEach((f) => console.log(`        · ${f}`));
    }
    const knownUncollected = r.uncollected.length - r.unexpectedUncollected.length;
    if (knownUncollected > 0) {
      // Công bố (done_when[2]) — KHÔNG phải lỗi: exclude cố ý / module đã PARK, đã ký trong baseline.
      console.log(
        `      ℹ️  ${knownUncollected} file tên-spec không thu thập theo BASELINE đã ký (module park / exclude cố ý)`,
      );
    }
  }
  console.log("");
  if (hardFail) {
    console.log("═════════ ĐỎ ❌ — xem chi tiết từng chunk ở trên ═════════");
  } else {
    console.log("═════════════ XANH ✅ (mọi chunk) ════════════");
  }

  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* không sao */
  }
  process.exit(hardFail ? 1 : 0);
}

main().catch((err) => {
  console.error("[chunk-test] lỗi không lường trước:", err);
  process.exit(1);
});
