#!/usr/bin/env node
/**
 * contrast-check.mjs — đo tương phản WCAG 2.1 cho design token, và so hai file token.
 *
 * Vì sao có file này: S5-LMS-UI-1 đo tay 32 cặp rồi phát hiện 4 cặp trượt AA ở chế độ
 * light; S5-FND-THEME-AA-1 vá chúng. Đo tay lần nữa = làm lại từ đầu ⇒ đóng băng ở đây.
 *
 * Dùng:
 *   node scripts/contrast-check.mjs                 # đo nguồn token MediaOS (packages/ui)
 *   node scripts/contrast-check.mjs --all           # đo CẢ packages/ui lẫn apps/lms + so hai file
 *   node scripts/contrast-check.mjs <file.css>...   # đo file bất kỳ
 *   node scripts/contrast-check.mjs --diff a.css b.css   # chỉ so token hai file
 *
 * Exit 1 khi có cặp dưới ngưỡng hoặc hai file lệch giá trị token ⇒ dùng được trong CI.
 *
 * Giới hạn có chủ ý: chỉ đọc token dạng hex đặc (#rgb/#rrggbb) khai trong khối `:root`
 * và `.dark`. Token dạng color-mix()/var() (ví dụ khối .chrome-surface của LMS) phụ
 * thuộc ngữ cảnh runtime nên KHÔNG đo tĩnh được — bỏ qua, smoke bằng mắt.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const REPO = path.resolve(import.meta.dirname, "..");
const UI_THEME = path.join(REPO, "packages/ui/src/styles/theme.css");
const LMS_THEME = path.join(REPO, "apps/lms/app/globals.css");

/** Ngưỡng WCAG 2.1 — text thường AA. Text lớn (≥18.66px bold / 24px) chỉ cần 3.0. */
const AA_NORMAL = 4.5;

/**
 * Cặp (chữ, nền) phải đạt AA. Đây là hợp đồng đọc-được của bảng màu: mỗi cặp tương ứng
 * một chỗ dùng thật trong UI, không phải tích Descartes của mọi token.
 */
const PAIRS = [
  ["foreground", "background", "chữ thân trên nền trang"],
  ["foreground", "card", "chữ thân trên card"],
  ["foreground", "muted", "chữ trên vùng mờ"],
  ["foreground", "secondary", "chữ trên nền phụ"],
  ["card-foreground", "card", "chữ card"],
  ["popover-foreground", "popover", "chữ popover/menu"],
  ["muted-foreground", "background", "chữ phụ trên nền trang"],
  ["muted-foreground", "card", "chữ phụ trên card"],
  ["muted-foreground", "muted", "chữ phụ trên vùng mờ"],
  ["secondary-foreground", "secondary", "chữ nút phụ"],
  ["accent-foreground", "accent", "chữ trên accent (hover menu)"],
  ["primary-foreground", "primary", "chữ trên nút chính"],
  ["brand-foreground", "brand", "chữ trên nền brand"],
  ["brand", "background", "link brand trên nền trang"],
  ["brand", "card", "link brand trên card"],
  ["brand", "brand-muted", "chữ brand trên chip brand"],
  ["destructive-foreground", "destructive", "chữ trên nút xoá"],
  ["destructive", "background", "chữ/icon xoá trên nền trang"],
  ["destructive", "card", "chữ/icon xoá trên card"],
  ["success", "background", "chữ thành công trên nền trang"],
  ["success", "card", "chữ thành công trên card"],
  ["success", "success-muted", "chip thành công"],
  ["warning", "background", "chữ cảnh báo trên nền trang"],
  ["warning", "card", "chữ cảnh báo trên card"],
  ["warning", "warning-muted", "chip cảnh báo"],
  ["danger", "background", "chữ nguy hiểm trên nền trang"],
  ["danger", "card", "chữ nguy hiểm trên card"],
  ["danger", "danger-muted", "chip nguy hiểm"],
  ["info", "background", "chữ thông tin trên nền trang"],
  ["info", "card", "chữ thông tin trên card"],
  ["info", "info-muted", "chip thông tin"],
  ["chrome-foreground", "chrome", "chữ trên thanh chrome navy"],
];

/**
 * Bất biến giá trị: token PHẢI trùng nhau (thiết kế cố ý, không phải trùng ngẫu nhiên).
 * Đổi một cái mà quên cái kia = nút xoá một màu, chip cảnh báo một màu khác.
 */
const MUST_MATCH = [
  ["danger", "destructive", "both", "cảnh báo và hành động phá huỷ dùng chung một đỏ"],
  ["brand", "info", "light", "brand và info trùng ở light theo thiết kế Control Room"],
  ["chrome", "chrome", "cross-mode", "chrome là hằng số navy ở CẢ hai chế độ"],
];

// ── Màu ─────────────────────────────────────────────────────────────────────
function parseHex(value) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

/** Độ chói tương đối sRGB — WCAG 2.1 §relative luminance. */
function luminance([r, g, b]) {
  const lin = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(hexA, hexB) {
  const a = luminance(parseHex(hexA));
  const b = luminance(parseHex(hexB));
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ── Đọc token ───────────────────────────────────────────────────────────────
/**
 * Bóc `--token: #hex;` trong khối `:root { … }` và `.dark { … }`.
 * Quét theo dấu ngoặc thay vì regex nuốt cả file — file token có nhiều khối lồng.
 */
function readTokens(file) {
  const css = fs.readFileSync(file, "utf8");
  const out = { light: {}, dark: {} };
  for (const [mode, selector] of [
    ["light", ":root"],
    ["dark", ".dark"],
  ]) {
    const start = css.indexOf(selector + " {");
    if (start === -1) continue;
    let depth = 0;
    let end = start;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    for (const m of css.slice(start, end).matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
      const hex = parseHex(m[2]);
      if (hex) out[mode][m[1]] = m[2].trim().toLowerCase();
    }
  }
  // Chrome là hằng số: LMS/MediaOS đều khai lại trong .dark, nhưng nếu file nào quên thì
  // kế thừa từ :root chứ không phải "thiếu token".
  for (const [k, v] of Object.entries(out.light)) if (!(k in out.dark)) out.dark[k] = v;
  return out;
}

// ── Báo cáo ─────────────────────────────────────────────────────────────────
function measure(file) {
  const tokens = readTokens(file);
  const rows = [];
  for (const mode of ["light", "dark"]) {
    for (const [fg, bg, note] of PAIRS) {
      const fgHex = tokens[mode][fg];
      const bgHex = tokens[mode][bg];
      if (!fgHex || !bgHex) continue; // token không tồn tại ở file này (vd LMS thiếu grid-line)
      rows.push({ mode, fg, bg, note, fgHex, bgHex, ratio: contrast(fgHex, bgHex) });
    }
  }
  return { tokens, rows };
}

function printTable(label, rows) {
  console.log(`\n── ${label} — ${rows.length} cặp, ngưỡng AA ${AA_NORMAL} ──`);
  const w = Math.max(...rows.map((r) => `${r.fg}/${r.bg}`.length));
  for (const r of rows.sort((a, b) => a.mode.localeCompare(b.mode) || a.ratio - b.ratio)) {
    const ok = r.ratio >= AA_NORMAL;
    console.log(
      `  ${ok ? "✅" : "❌"} ${r.mode.padEnd(5)} ${`${r.fg}/${r.bg}`.padEnd(w)}  ` +
        `${r.ratio.toFixed(2).padStart(5)}  ${r.fgHex} on ${r.bgHex}  — ${r.note}`,
    );
  }
}

function checkMustMatch(tokens) {
  const problems = [];
  for (const [a, b, scope, why] of MUST_MATCH) {
    const modes = scope === "both" ? ["light", "dark"] : scope === "cross-mode" ? [] : [scope];
    for (const mode of modes) {
      const [va, vb] = [tokens[mode][a], tokens[mode][b]];
      if (va && vb && va !== vb)
        problems.push(`--${a} (${va}) ≠ --${b} (${vb}) ở ${mode} — ${why}`);
    }
    if (scope === "cross-mode" && tokens.light[a] && tokens.light[a] !== tokens.dark[a]) {
      problems.push(`--${a} light (${tokens.light[a]}) ≠ dark (${tokens.dark[a]}) — ${why}`);
    }
  }
  return problems;
}

function diffTokens(fileA, fileB) {
  const a = readTokens(fileA);
  const b = readTokens(fileB);
  const problems = [];
  for (const mode of ["light", "dark"]) {
    // Chỉ so token có ở CẢ hai bên: LMS có token riêng (--chart-*, --sidebar-*) và
    // MediaOS có token riêng (--grid-line) — lệch tập hợp là bình thường, lệch GIÁ TRỊ thì không.
    for (const [k, va] of Object.entries(a[mode])) {
      const vb = b[mode][k];
      if (vb && vb !== va)
        problems.push(
          `${mode}  --${k}: ${path.basename(fileA)}=${va}  ≠  ${path.basename(fileB)}=${vb}`,
        );
    }
  }
  return problems;
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let failed = false;

if (argv[0] === "--diff") {
  const [, fileA, fileB] = argv;
  const problems = diffTokens(fileA ?? UI_THEME, fileB ?? LMS_THEME);
  console.log(
    problems.length
      ? `\n❌ ${problems.length} token lệch giá trị:`
      : "\n✅ Hai file khớp giá trị từng token chung.",
  );
  problems.forEach((p) => console.log("   " + p));
  process.exit(problems.length ? 1 : 0);
}

const files = argv.filter((a) => !a.startsWith("--"));
const targets = files.length ? files : argv.includes("--all") ? [UI_THEME, LMS_THEME] : [UI_THEME];

for (const file of targets) {
  if (!fs.existsSync(file)) {
    console.error(`❌ không thấy file: ${file}`);
    failed = true;
    continue;
  }
  const { tokens, rows } = measure(file);
  printTable(path.relative(REPO, file), rows);

  const under = rows.filter((r) => r.ratio < AA_NORMAL);
  const mismatched = checkMustMatch(tokens);
  console.log(
    `\n  → ${rows.length - under.length}/${rows.length} đạt AA` +
      (under.length
        ? `; TRƯỢT: ${under.map((r) => `${r.fg}/${r.bg}(${r.ratio.toFixed(2)})`).join(", ")}`
        : "") +
      `; thấp nhất ${Math.min(...rows.map((r) => r.ratio)).toFixed(2)}`,
  );
  mismatched.forEach((p) => console.log(`  ⚠️  bất biến giá trị: ${p}`));
  if (under.length || mismatched.length) failed = true;
}

if (argv.includes("--all")) {
  const problems = diffTokens(UI_THEME, LMS_THEME);
  console.log(
    problems.length
      ? `\n❌ ${problems.length} token lệch giữa packages/ui và apps/lms:`
      : "\n✅ packages/ui và apps/lms khớp giá trị từng token chung.",
  );
  problems.forEach((p) => console.log("   " + p));
  if (problems.length) failed = true;
}

console.log("");
process.exit(failed ? 1 : 0);
