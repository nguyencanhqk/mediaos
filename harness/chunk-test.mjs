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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

// Trần mặc định. chunk-size: RELEASE-06 §4.4 đo được crash phụ thuộc KÍCH THƯỚC chunk (gộp 64 file
// chết, tách <50 thì xanh). max-forks: mặc định của vitest là `availableParallelism()-1` = 31 trên
// máy 32 nhân này; hạ trần làm giảm hẳn số vòng tạo/huỷ worker (xem evidence §2).
const DEFAULTS = { chunkSize: 40, maxForks: 8, retries: 2 };

// Chữ ký crash HẠ TẦNG (được phép chạy lại). KHÔNG bao gồm test đỏ.
const CRASH_SIGNATURES = [
  /ERR_IPC_CHANNEL_CLOSED/,
  /Channel closed/,
  /Segmentation fault/i,
  /SIGSEGV/,
  /3221225477/, // 0xC0000005 ACCESS_VIOLATION (Windows)
];

const SPEC_FILE_RE = /\.(spec|e2e-spec|int-spec)\.(ts|tsx)$/;

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

/** Mọi package trong workspace có script `test` chạy vitest. */
function discoverTargets() {
  const targets = [];
  for (const group of ["apps", "packages"]) {
    const dir = path.join(REPO_ROOT, group);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      // apps/lms = workspace RIÊNG (pnpm-workspace.yaml loại trừ) — không thuộc turbo run test.
      if (group === "apps" && name === "lms") continue;
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
    let unresolvedCrash = 0;

    for (let gi = 0; gi < groups.length; gi++) {
      const files = groups[gi];
      const label = `${target.name} chunk ${gi + 1}/${groups.length} (${files.length} file)`;
      let attempt = 0;
      let res;

      for (;;) {
        console.log(`\n  ── ${label}${attempt > 0 ? ` — chạy lại lần ${attempt}` : ""}`);
        res = await runChunk(
          target,
          files,
          opts,
          path.join(tmpDir, `${target.name.replace(/[^a-z0-9]/gi, "-")}-${gi}-${attempt}.json`),
        );
        res.ranFiles.forEach((f) => ran.add(f));

        if (res.status === 0) break;
        if (!res.crashed) break; // đỏ THẬT — KHÔNG chạy lại
        if (attempt >= opts.retries) break;
        attempt++;
        retriesUsed++;
        console.log(
          `  ⚠️  ${label}: crash HẠ TẦNG (0 test đỏ) — chạy lại (${attempt}/${opts.retries})`,
        );
      }

      if (res.status !== 0) {
        if (res.crashed) {
          unresolvedCrash++;
          console.log(`  ❌ ${label}: vẫn crash hạ tầng sau ${opts.retries} lần chạy lại`);
        } else {
          realFailures += res.failed || 1;
          console.log(`  ❌ ${label}: ${res.failed} test ĐỎ THẬT`);
        }
      }
    }

    // Chống giảm phạm vi lén: tập file ĐÃ CHẠY phải phủ hết tập `vitest list`.
    const missing = expected.filter((f) => !ran.has(f));
    const ok = realFailures === 0 && unresolvedCrash === 0 && missing.length === 0;
    if (!ok) hardFail = true;

    results.push({
      name: target.name,
      expected: expected.length,
      ran: ran.size,
      missing,
      uncollected,
      realFailures,
      unresolvedCrash,
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
        (r.unresolvedCrash ? ` · ${r.unresolvedCrash} chunk crash không cứu được` : ""),
    );
    if (r.missing.length) {
      console.log(`      ⚠️  THIẾU ${r.missing.length} file (phạm vi bị co lại):`);
      r.missing.slice(0, 20).forEach((f) => console.log(`        · ${f}`));
      if (r.missing.length > 20) console.log(`        · … và ${r.missing.length - 20} file nữa`);
    }
    if (r.uncollected.length) {
      // Công bố (done_when[2]) — KHÔNG phải lỗi: exclude cố ý hoặc file đặt ngoài `include`.
      console.log(
        `      ℹ️  ${r.uncollected.length} file tên-spec KHÔNG được vitest thu thập (exclude cố ý / ngoài include):`,
      );
      r.uncollected.forEach((f) => console.log(`        · ${f}`));
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
