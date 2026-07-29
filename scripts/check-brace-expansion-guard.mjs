#!/usr/bin/env node
/**
 * Chốt hồi quy cho GHSA-mh99-v99m-4gvg (CVE-2026-14257 — brace-expansion DoS OOM).
 *
 * VÌ SAO CẦN: cổng `pnpm audit` phải ignore GHSA này (dải advisory ghi `<=5.0.7` nên nó cờ CẢ những
 * bản đã vá của dòng 1.x/2.x). Ignore mà không có gì thay thế = ỉm. Script này là vật thay thế:
 * nó KHÔNG tin số hiệu phiên bản, mà CHẠY THẬT `expand()` trên đúng file mà `require()` nạp.
 *
 * BẪY nó được dựng để bắt (đo 2026-07-29): brace-expansion 1.1.16 và 2.1.2 CÓ ship bản đã vá ở
 * `dist/commonjs/index.js` + kèm cả file ADVISORY.md, nhưng `package.json` của chúng có
 * `main: index.js` và KHÔNG có `exports` map ⇒ `require('brace-expansion')` (đường mà minimatch@3/@5
 * đi) nạp `index.js` = CODE CŨ CHƯA VÁ. Đọc phiên bản hay đọc changelog đều KHÔNG phát hiện được;
 * chỉ chạy mới thấy. 2.1.3 và 5.0.8 mới thực sự có guard ở entry `main`.
 *
 * CÁCH ĐO: `expand('{a,b}'.repeat(60))`.
 *   - CÓ guard  → bị cắt tại EXPANSION_MAX_LENGTH (4.000.000 ký tự) ⇒ tiến trình con thoát 0.
 *   - KHÔNG guard → V8 fatal out-of-memory (KHÔNG bắt được bằng try/catch) ⇒ tiến trình con chết 134.
 * Chạy trong TIẾN TRÌNH CON có `--max-old-space-size` để bản thủng chết gọn, không kéo theo runner.
 *
 * Dùng:
 *   node scripts/check-brace-expansion-guard.mjs              # quét mọi bản trong pnpm-lock.yaml
 *   node scripts/check-brace-expansion-guard.mjs --probe <dir> # đo tay một thư mục gói (chứng minh RED)
 */
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCKFILE = path.join(REPO_ROOT, "pnpm-lock.yaml");

/** Ngưỡng guard của thượng nguồn (EXPANSION_MAX_LENGTH mặc định). */
const EXPANSION_MAX_LENGTH = 4_000_000;
/** Số nhóm ngoặc: đủ để bản KHÔNG guard vượt trần bộ nhớ, bản CÓ guard vẫn nhẹ. */
const BRACE_GROUPS = 60;
/** Trần heap của tiến trình con — bản thủng phải chết ở đây thay vì ăn hết RAM máy. */
const CHILD_HEAP_MB = 1024;

/** Bản vá thật của từng dòng major (đo bằng chính script này, không lấy từ changelog). */
const MIN_GUARDED = [
  { below: 3, min: "2.1.3" }, // dòng 1.x KHÔNG có bản vá (1.1.16 là bản cuối) ⇒ phải redirect sang 2.1.3
  { below: Infinity, min: "5.0.8" },
];

const cmp = (a, b) => {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

const minGuardedFor = (version) =>
  MIN_GUARDED.find((r) => Number(version.split(".")[0]) < r.below)?.min ?? "5.0.8";

/** Các phiên bản brace-expansion THỰC SỰ được lockfile phân giải (bỏ qua dòng `overrides`). */
function resolvedVersions() {
  const lock = readFileSync(LOCKFILE, "utf8");
  const found = new Set();
  for (const m of lock.matchAll(/^ {2}brace-expansion@(\d+\.\d+\.\d+):/gm)) found.add(m[1]);
  return [...found].sort(cmp);
}

function packageDir(version) {
  return path.join(
    REPO_ROOT,
    "node_modules",
    ".pnpm",
    `brace-expansion@${version}`,
    "node_modules",
    "brace-expansion",
  );
}

/**
 * Chạy expand() trong tiến trình con. Trả { guarded, detail }.
 * Tiến trình con chết (OOM) ⇒ guarded=false — đó chính là dấu hiệu của lỗ hổng.
 */
function probe(dir) {
  const script = `
    const mod = require(${JSON.stringify(dir)});
    const expand = typeof mod === "function" ? mod : mod.expand;
    const out = expand("{a,b}".repeat(${BRACE_GROUPS}));
    process.stdout.write(JSON.stringify({ results: out.length, chars: out.reduce((s, x) => s + x.length, 0) }));
  `;
  try {
    const stdout = execFileSync(
      process.execPath,
      [`--max-old-space-size=${CHILD_HEAP_MB}`, "-e", script],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 120_000,
      },
    );
    const { results, chars } = JSON.parse(stdout);
    return {
      guarded: chars <= EXPANSION_MAX_LENGTH,
      detail: `${results} kết quả / ${chars.toLocaleString("vi-VN")} ký tự`,
    };
  } catch (err) {
    // exit 134 = SIGABRT do V8 fatal OOM — chính là hành vi của bản chưa vá.
    return {
      guarded: false,
      detail: `tiến trình con chết (${err.status ?? err.signal ?? err.code}) — dấu hiệu OOM chưa vá`,
    };
  }
}

function main() {
  const probeArg = process.argv.indexOf("--probe");
  if (probeArg !== -1) {
    const dir = path.resolve(process.argv[probeArg + 1] ?? "");
    const r = probe(dir);
    console.log(`${r.guarded ? "CÓ guard" : "KHÔNG guard"} — ${dir}\n  ${r.detail}`);
    process.exit(r.guarded ? 0 : 1);
  }

  const versions = resolvedVersions();
  if (versions.length === 0) {
    console.error(
      "❌ Không tìm thấy brace-expansion nào trong pnpm-lock.yaml — script hỏng hoặc lockfile đổi định dạng.",
    );
    process.exit(1);
  }

  const failures = [];
  console.log(`Kiểm tra ${versions.length} bản brace-expansion do pnpm-lock.yaml phân giải:`);
  for (const v of versions) {
    const min = minGuardedFor(v);
    if (cmp(v, min) < 0) {
      failures.push(`${v} — dưới bản vá tối thiểu ${min} của dòng major này`);
      console.log(`  ✗ ${v} — dưới ngưỡng ${min}`);
      continue;
    }
    const dir = packageDir(v);
    if (!existsSync(dir)) {
      failures.push(`${v} — không thấy ở node_modules/.pnpm (chạy pnpm install trước)`);
      console.log(`  ✗ ${v} — chưa cài`);
      continue;
    }
    const r = probe(dir);
    console.log(`  ${r.guarded ? "✓" : "✗"} ${v} — ${r.detail}`);
    if (!r.guarded) failures.push(`${v} — entry \`main\` KHÔNG có guard độ dài (${r.detail})`);
  }

  if (failures.length > 0) {
    console.error("\n❌ GHSA-mh99-v99m-4gvg: có bản brace-expansion CHƯA VÁ trong cây phụ thuộc.");
    for (const f of failures) console.error(`   - ${f}`);
    console.error(
      "\n   Cổng `pnpm audit` đang ignore GHSA này (dải `<=5.0.7` cờ cả bản đã vá) nên nó KHÔNG bắt được ca này.",
    );
    console.error("   Sửa `overrides` trong pnpm-workspace.yaml rồi chạy lại `pnpm install`.");
    process.exit(1);
  }

  console.log("\n✅ Mọi bản brace-expansion được phân giải đều có guard độ dài ở entry `main`.");
}

main();
