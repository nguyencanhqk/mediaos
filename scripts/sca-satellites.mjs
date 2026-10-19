#!/usr/bin/env node
// scripts/sca-satellites.mjs — S19-OPS-SCASATELLITE-1 (plan §4, D-3). Gõ qua: `m sca [fbpost|lms|all]`.
//
// Quét SCA cho hai app vệ tinh có lockfile RIÊNG, nằm ngoài workspace pnpm nên cổng `pnpm audit` của CI mù
// với chúng: apps/fbpost (npm, package-lock.json) · apps/lms (pnpm, pnpm-lock.yaml). Chỉ dependency CHẠY
// THẬT (`--omit=dev` / `--prod`), ngưỡng high|critical — cùng ngưỡng với cổng CI.
//
// Đầu ra: mỗi app một dòng đếm theo mức + một dòng đếm resolution không đến từ registry (audit mù với các gói
// đó) + một dòng đối chiếu CÂY ĐÃ CÀI với lockfile (audit chỉ đọc lockfile: đổi lockfile mà quên cài lại thì
// audit xanh về thứ không chạy ⇒ lệch = KHÔNG ĐO ĐƯỢC). Tên gói chỉ in ra terminal, không ghi tệp. Tiền tố dòng [OK]/[!]/[X] để mediaos.ps1 tô màu.
// Exit tổng: 2 nếu có app KHÔNG ĐO ĐƯỢC · 1 nếu có high/critical · 0 sạch. "Không đo được" ≠ "sạch".
//
//   node scripts/sca-satellites.mjs [fbpost|lms|all] [--fbpost-dir <thư mục>] [--lms-dir <thư mục>]
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { countNonRegistry, installDrift, summarizeAudit, verdict } from "./lib/sca-summary.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_BUFFER = 64 * 1024 * 1024;
const AUDIT_TIMEOUT_MS = 180_000;
const SERIOUS = new Set(["high", "critical"]);

const APPS = {
  fbpost: {
    kind: "npm",
    lockfile: "package-lock.json",
    defaultDir: "apps/fbpost",
    cmd: "npm",
    args: ["audit", "--omit=dev", "--audit-level=high", "--json"],
    installedCopy: "node_modules/.package-lock.json",
    installCmd: "npm ci",
  },
  lms: {
    kind: "pnpm",
    lockfile: "pnpm-lock.yaml",
    defaultDir: "apps/lms",
    cmd: "pnpm",
    args: ["audit", "--prod", "--audit-level=high", "--json"],
    installedCopy: "node_modules/.pnpm/lock.yaml",
    installCmd: "pnpm install --frozen-lockfile",
  },
};

const USAGE =
  "Cách dùng: node scripts/sca-satellites.mjs [fbpost|lms|all] [--fbpost-dir <thư mục>] [--lms-dir <thư mục>]";

function parseArgs(argv) {
  const dirs = {};
  let target = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--(fbpost|lms)-dir$/.exec(a);
    if (m) {
      const v = argv[++i];
      if (!v) throw new Error(`${a} thiếu giá trị`);
      dirs[m[1]] = path.resolve(v);
    } else if (target === null && (a === "all" || Object.hasOwn(APPS, a))) {
      target = a;
    } else {
      throw new Error(`tham số lạ: ${a}`);
    }
  }
  const names = target === null || target === "all" ? Object.keys(APPS) : [target];
  return { names, dirs };
}

/** Tên gói mức high/critical từ JSON audit (npm v2: vulnerabilities · pnpm: advisories). Chỉ để in. */
function seriousNames(json) {
  const names = new Set();
  for (const [name, v] of Object.entries(json?.vulnerabilities ?? {})) {
    if (SERIOUS.has(v?.severity)) names.add(name);
  }
  for (const adv of Object.values(json?.advisories ?? {})) {
    if (SERIOUS.has(adv?.severity) && adv?.module_name) names.add(adv.module_name);
  }
  return [...names].sort();
}

function runAudit(app, dir) {
  // Đối số CỐ ĐỊNH (không nội suy đầu vào người dùng). Windows cần shell để tìm npm.cmd/pnpm.cmd; khi có
  // shell thì truyền MỘT chuỗi lệnh (Node 24 cảnh báo DEP0190 nếu truyền mảng args kèm shell).
  const onWindows = process.platform === "win32";
  const opts = {
    cwd: dir,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    timeout: AUDIT_TIMEOUT_MS,
    windowsHide: true,
  };
  const r = onWindows
    ? spawnSync([app.cmd, ...app.args].join(" "), { ...opts, shell: true })
    : spawnSync(app.cmd, app.args, opts);
  if (r.error)
    return { error: `${app.cmd} audit không chạy được (${r.error.code ?? r.error.message})` };
  return { stdout: r.stdout, stderr: r.stderr, status: r.status, signal: r.signal };
}

/** stderr của audit (cắt ngắn, một dòng) — để «không đo được» nói được nguyên nhân: mạng, thiếu pnpm, endpoint… */
function stderrHint(stderr) {
  const s = String(stderr ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return s ? s.slice(0, 300) : "";
}

/**
 * Gate SCA-1: audit chỉ đọc lockfile ⇒ đối chiếu bản sao cây đã cài. Trả 0 (khớp / chưa cài gì) hoặc 2.
 * Chưa có node_modules: không có mã nào chạy từ thư mục này để lệch — báo [!], không đổi kết quả.
 */
function checkInstalled(app, tag, dir, lockPath) {
  if (!existsSync(path.join(dir, "node_modules"))) {
    console.log(
      `  [!]  ${tag} chưa cài deps (không có node_modules) — kết quả trên chỉ nói về lockfile`,
    );
    return 0;
  }
  const copyPath = path.join(dir, app.installedCopy);
  try {
    if (!existsSync(copyPath))
      throw new Error(`không đo được: có node_modules nhưng thiếu ${app.installedCopy}`);
    const d = installDrift(
      readFileSync(lockPath, "utf8"),
      readFileSync(copyPath, "utf8"),
      app.kind,
    );
    if (d.extra + d.missing + d.changed === 0) {
      console.log(`  [OK] ${tag} cây đã cài khớp lockfile`);
      return 0;
    }
    console.log(
      `  [X]  ${tag} CÂY ĐÃ CÀI LỆCH LOCKFILE (thừa ${d.extra} · thiếu ${d.missing} · khác bản ${d.changed}) — deps CHƯA cài lại sau khi đổi lockfile ⇒ audit ở trên KHÔNG mô tả mã đang chạy`,
    );
    console.log(`  [X]  ${tag} chạy '${app.installCmd}' trong ${dir} rồi build + restart lại`);
  } catch (err) {
    console.log(`  [X]  ${tag} cây đã cài KHÔNG ĐO ĐƯỢC: ${err.message}`);
  }
  return 2;
}

function scanOne(name, dir) {
  const app = APPS[name];
  const tag = `[${name}]`;
  const lockPath = path.join(dir, app.lockfile);
  if (!existsSync(lockPath)) {
    console.log(`  [X]  ${tag} KHÔNG ĐO ĐƯỢC: thiếu ${lockPath}`);
    return 2;
  }

  let result = 2;
  const r = runAudit(app, dir);
  if (r.error) {
    console.log(`  [X]  ${tag} KHÔNG ĐO ĐƯỢC: ${r.error}`);
  } else {
    let counts = null;
    let json = null;
    try {
      counts = summarizeAudit(r.stdout);
      json = JSON.parse(r.stdout);
    } catch (err) {
      console.log(`  [X]  ${tag} ${err.message}`); // message đã mở đầu bằng «không đo được: …»
      const hint = stderrHint(r.stderr);
      if (hint) console.log(`  [X]  ${tag} stderr: ${hint}`);
    }
    result = verdict(counts, r.status);
    const exitTxt = r.status === null ? `bị dừng (${r.signal ?? "?"})` : `exit ${r.status}`;
    if (counts) {
      const line = `critical ${counts.critical} · high ${counts.high} · moderate ${counts.moderate} · low ${counts.low} (${app.cmd} audit ${exitTxt})`;
      if (result === 0)
        console.log(`  [OK] ${tag} ${line} — không có high/critical trên dependency chạy thật`);
      else if (result === 1) {
        console.log(`  [X]  ${tag} ${line} — CÓ high/critical trên dependency chạy thật`);
        console.log(
          `  [X]  ${tag} gói: ${seriousNames(json).join(", ") || "(không đọc được tên)"}`,
        );
      } else console.log(`  [X]  ${tag} KHÔNG ĐO ĐƯỢC: JSON và exit code lệch nhau — ${line}`);
    } else if (r.status !== null) {
      console.log(`  [X]  ${tag} (${app.cmd} audit ${exitTxt})`);
    }
  }

  // Dòng resolution ngoài registry — không đổi kết quả audit (không phải advisory), nhưng lockfile không
  // đọc được thì cả lần đo coi như không đo được.
  try {
    const nr = countNonRegistry(readFileSync(lockPath, "utf8"), app.kind);
    if (nr.count === 0) console.log(`  [OK] ${tag} resolution ngoài registry: 0`);
    else {
      console.log(
        `  [!]  ${tag} resolution ngoài registry: ${nr.count} — audit KHÔNG thấy các gói này, theo dõi tay`,
      );
      console.log(`  [!]  ${tag} gói ngoài registry: ${nr.names.join(", ")}`);
    }
  } catch (err) {
    console.log(`  [X]  ${tag} resolution ngoài registry KHÔNG ĐO ĐƯỢC: ${err.message}`);
    result = 2;
  }
  // 2 trội hơn 1 trội hơn 0: cây cài lệch ⇒ số đếm audit ở trên không phải của mã đang chạy.
  return Math.max(result, checkInstalled(app, tag, dir, lockPath));
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.log(`  [X]  ${err.message}`);
    console.log(`  ${USAGE}`);
    return 2;
  }
  const results = opts.names.map((name) =>
    scanOne(name, opts.dirs[name] ?? path.join(ROOT, APPS[name].defaultDir)),
  );
  if (results.includes(2)) return 2;
  if (results.includes(1)) return 1;
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  // Lỗi bất ngờ của chính bộ quét = KHÔNG ĐO ĐƯỢC (2), không để Node trả 1 (trùng nghĩa "có high/critical").
  console.log(`  [X]  bộ quét SCA lỗi bất ngờ — không đo được: ${err?.stack ?? err}`);
  process.exitCode = 2;
}
