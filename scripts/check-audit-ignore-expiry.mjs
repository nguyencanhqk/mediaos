#!/usr/bin/env node
/**
 * Hạn cho ngoại lệ `auditConfig.ignoreGhsas` của `pnpm audit` (S19-OPS-AUDITDOS-1, owner 24/10/2026).
 *
 * VÌ SAO CẦN: bỏ qua một GHSA trong cổng `pnpm audit --audit-level=high` mà không có hạn = ỉm vĩnh viễn
 * (nguyên tắc owner 25/07: «luôn vá, không ỉm»). Ngoại lệ chỉ được phép khi CÓ HẠN và có WO gỡ. Script
 * này ép điều đó bằng máy, chạy cùng job «Dependency scan (pnpm audit)» trong security.yml.
 *
 * QUY TẮC DƯƠNG (không đoán mọi cách viết YAML): cấu hình audit chỉ được viết ở ĐÚNG một dạng chuẩn —
 *
 *   auditConfig:
 *     ignoreGhsas:
 *       - GHSA-xxxx-xxxx-xxxx
 *
 * (chú thích + dòng trống được phép). Mọi dòng khác trong khối (vd `ignoreCves`, mục viết hai dòng, giá trị
 * có nháy), dạng flow mapping `auditConfig: { … }`, khoá có nháy, hoặc bất kỳ dòng KHÔNG phải chú thích nào
 * ngoài khối có nhắc `auditConfig` / `ignoreGhsas` / `ignoreCves` / `GHSA-` / `CVE-` ⇒ ĐỎ. Muốn dạng khác thì
 * sửa script này trước.
 *
 * ĐỎ (exit 1) khi: lệch dạng chuẩn · một GHSA bị bỏ qua mà KHÔNG có mục trong `EXPIRY` · mục `EXPIRY` sai
 * dạng (`until` không phải ngày YYYY-MM-DD có thật, `wo` không phải mã WO) · hạn xa hơn `MAX_WINDOW_DAYS`
 * kể từ hôm nay (gia hạn phải làm lại trong cửa sổ ngắn) · đã QUÁ hạn (so ngày UTC) · `EXPIRY` còn mục cho
 * GHSA không còn bị bỏ qua (sổ lệch) · `pnpm-lock.yaml` có bản của gói ngoài major mà ngoại lệ khoanh
 * (`scope`), hoặc không còn bản nào của gói đó.
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * GHSA bị bỏ qua → hạn (YYYY-MM-DD, so theo ngày UTC) + WO sẽ gỡ ngoại lệ + PHẠM VI: ngoại lệ chỉ đúng cho
 * một gói ở một major (`ignoreGhsas` của pnpm bỏ qua CẢ advisory, không theo phiên bản ⇒ nếu lockfile có bản
 * của gói đó ở major KHÁC — dòng có bản vá — script ĐỎ thay vì để ignore ỉm luôn nó).
 */
export const EXPIRY = {
  "GHSA-mrhx-c7xc-m3w5": {
    until: "2026-11-23",
    wo: "S19-OPS-ZOD4-1",
    scope: { pkg: "zod", major: 3 },
  },
};

/** Hạn không được xa hơn số ngày này kể từ hôm nay. */
export const MAX_WINDOW_DAYS = 45;

const HEADER = /^auditConfig:$/;
const LIST_KEY = /^ {2}ignoreGhsas:$/;
const LIST_ITEM = /^ {4}- (GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})$/;
const MENTION = /auditConfig|ignoreGhsas|ignoreCves|GHSA-|CVE-\d/i;
const WO_ID = /^S\d+-[A-Z0-9]+(-[A-Z0-9]+)*$/;
const DAY_MS = 86_400_000;

/** Bỏ chú thích cuối dòng (` # …`) và khoảng trắng cuối; dòng chỉ có chú thích ⇒ chuỗi rỗng. */
function codeOf(line) {
  if (/^\s*#/.test(line)) return "";
  return line.replace(/\s+#.*$/, "").replace(/\s+$/, "");
}

/** Đọc danh sách theo dạng chuẩn. Trả `{ ids, problems }` — `problems` khác rỗng là ĐỎ. */
export function parseIgnoreGhsas(yamlText) {
  const ids = [];
  const problems = [];
  let headers = 0;
  let inBlock = false;
  let seenKey = false;
  yamlText.split(/\r?\n/).forEach((raw, i) => {
    const code = codeOf(raw);
    if (code === "") return;
    const where = `dòng ${i + 1}: \`${code.trim()}\``;
    if (inBlock && /^\S/.test(code)) inBlock = false;
    if (HEADER.test(code)) {
      headers += 1;
      inBlock = true;
      seenKey = false;
      return;
    }
    if (inBlock) {
      if (!seenKey && LIST_KEY.test(code)) {
        seenKey = true;
        return;
      }
      const m = seenKey ? code.match(LIST_ITEM) : null;
      if (m) ids.push(m[1]);
      else problems.push(`${where} — lệch dạng chuẩn trong khối auditConfig`);
      return;
    }
    if (MENTION.test(code)) problems.push(`${where} — nhắc cấu hình audit ngoài khối chuẩn`);
  });
  if (headers > 1) problems.push(`có ${headers} khối auditConfig — chỉ được một`);
  if (headers === 1 && ids.length === 0)
    problems.push("khối auditConfig không có GHSA nào — gỡ hẳn khối");
  return { ids, problems };
}

function isRealDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** Mọi phiên bản của `pkg` có trong `pnpm-lock.yaml` (khoá `packages:` / `snapshots:` dạng `  pkg@x.y.z…:`). */
export function lockVersions(lockText, pkg) {
  const name = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`^ {2}['"]?${name}@(\\d+\\.\\d+\\.\\d+)`, "gm");
  return [...new Set([...lockText.matchAll(re)].map((m) => m[1]))];
}

function scopeProblems(ghsa, scope, lockText) {
  if (!scope || typeof scope.pkg !== "string" || !Number.isInteger(scope.major))
    return [
      `${ghsa}: thiếu \`scope: { pkg, major }\` — ngoại lệ phải khoanh đúng một gói ở một major`,
    ];
  const versions = lockVersions(lockText, scope.pkg);
  if (versions.length === 0)
    return [`${ghsa}: lockfile không còn bản ${scope.pkg} nào — gỡ ignore + mục EXPIRY`];
  return versions
    .filter((v) => Number(v.split(".")[0]) !== scope.major)
    .map(
      (v) =>
        `${ghsa}: ${scope.pkg}@${v} trong lockfile nằm NGOÀI phạm vi ngoại lệ (chỉ major ${scope.major})`,
    );
}

/** Trả danh sách vấn đề (rỗng = đạt). `today` dạng YYYY-MM-DD (UTC); `lockText` = nội dung pnpm-lock.yaml. */
export function checkIgnores(parsed, expiry, today, lockText) {
  const problems = [...parsed.problems];
  for (const ghsa of parsed.ids) {
    const entry = expiry[ghsa];
    if (!entry) {
      problems.push(`${ghsa}: bị bỏ qua nhưng KHÔNG có hạn trong EXPIRY`);
      continue;
    }
    if (!isRealDate(entry.until)) {
      problems.push(
        `${ghsa}: \`until\` phải là ngày YYYY-MM-DD có thật (đang là ${JSON.stringify(entry.until)})`,
      );
      continue;
    }
    problems.push(...scopeProblems(ghsa, entry.scope, lockText));
    if (typeof entry.wo !== "string" || !WO_ID.test(entry.wo))
      problems.push(`${ghsa}: \`wo\` phải là mã WO (đang là ${JSON.stringify(entry.wo)})`);
    const days =
      (Date.parse(`${entry.until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS;
    if (days < 0)
      problems.push(`${ghsa}: ngoại lệ đã QUÁ HẠN ${entry.until} — làm ${entry.wo} rồi gỡ ignore`);
    else if (days > MAX_WINDOW_DAYS)
      problems.push(`${ghsa}: hạn ${entry.until} xa hơn ${MAX_WINDOW_DAYS} ngày kể từ ${today}`);
  }
  for (const ghsa of Object.keys(expiry)) {
    if (!parsed.ids.includes(ghsa))
      problems.push(`${ghsa}: còn trong EXPIRY nhưng không còn bị bỏ qua — xoá mục EXPIRY`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const parsed = parseIgnoreGhsas(
    readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"),
  );
  const lockText = readFileSync(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const problems = checkIgnores(parsed, EXPIRY, today, lockText);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  for (const ghsa of parsed.ids)
    console.log(`✓ ${ghsa} bị bỏ qua tới ${EXPIRY[ghsa].until} (${EXPIRY[ghsa].wo})`);
  if (!parsed.ids.length) console.log("✓ không có GHSA nào bị bỏ qua");
}
