#!/usr/bin/env node
/**
 * Hạn cho ngoại lệ `auditConfig.ignoreGhsas` của `pnpm audit` (S19-OPS-AUDITDOS-1, owner 24/10/2026).
 *
 * VÌ SAO CẦN: bỏ qua một GHSA trong cổng `pnpm audit --audit-level=high` mà không có hạn = ỉm vĩnh viễn
 * (nguyên tắc owner 25/07: «luôn vá, không ỉm»). Ngoại lệ chỉ được phép khi CÓ HẠN và có WO gỡ. Script
 * này ép điều đó bằng máy, chạy cùng job «Dependency scan (pnpm audit)» trong security.yml.
 *
 * ĐỎ (exit 1) khi:
 *   - một GHSA trong `pnpm-workspace.yaml › auditConfig.ignoreGhsas` KHÔNG có mục trong `EXPIRY`;
 *   - ngày hôm nay (UTC) đã QUA hạn `until` của GHSA đó;
 *   - `EXPIRY` còn mục cho GHSA không còn bị bỏ qua (sổ lệch — xoá mục khi gỡ ignore);
 *   - tệp có nhắc `ignoreGhsas` nhưng không đọc được danh sách (fail-closed, không bao giờ «sạch» khi mù).
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** GHSA bị bỏ qua → hạn (YYYY-MM-DD, so theo ngày UTC) + WO sẽ gỡ ngoại lệ. */
export const EXPIRY = {
  "GHSA-mrhx-c7xc-m3w5": { until: "2026-11-23", wo: "S19-OPS-ZOD4-1" },
};

const GHSA_ITEM = /^\s+-\s+["']?(GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4})["']?\s*(#.*)?$/i;

/** Đọc danh sách dạng khối dưới `auditConfig:` › `ignoreGhsas:`. Trả `null` nếu có nhắc mà không đọc được. */
export function parseIgnoreGhsas(yamlText) {
  const out = [];
  let inAudit = false;
  let inList = false;
  for (const line of yamlText.split(/\r?\n/)) {
    if (/^auditConfig:\s*(#.*)?$/.test(line)) {
      inAudit = true;
      inList = false;
      continue;
    }
    if (inAudit && /^\S/.test(line) && !/^#/.test(line)) {
      inAudit = false;
      inList = false;
    }
    if (!inAudit) continue;
    if (/^\s+ignoreGhsas:\s*(#.*)?$/.test(line)) {
      inList = true;
      continue;
    }
    if (!inList || /^\s*(#.*)?$/.test(line)) continue;
    const m = line.match(GHSA_ITEM);
    if (m) out.push(m[1]);
    else inList = false;
  }
  const mentions = /^\s+ignoreGhsas\s*:/m.test(yamlText);
  if (mentions && out.length === 0) return null;
  return out;
}

/** Trả danh sách vấn đề (rỗng = đạt). `today` dạng YYYY-MM-DD. */
export function checkIgnores(ignored, expiry, today) {
  if (ignored === null)
    return ["không đọc được `auditConfig.ignoreGhsas` (chỉ hỗ trợ danh sách dạng khối `- GHSA-…`)"];
  const problems = [];
  for (const ghsa of ignored) {
    const entry = expiry[ghsa];
    if (!entry) problems.push(`${ghsa}: bị bỏ qua nhưng KHÔNG có hạn trong EXPIRY`);
    else if (today > entry.until)
      problems.push(`${ghsa}: ngoại lệ đã QUÁ HẠN ${entry.until} — làm ${entry.wo} rồi gỡ ignore`);
  }
  for (const ghsa of Object.keys(expiry)) {
    if (!ignored.includes(ghsa))
      problems.push(`${ghsa}: còn trong EXPIRY nhưng không còn bị bỏ qua — xoá mục EXPIRY`);
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ignored = parseIgnoreGhsas(
    readFileSync(new URL("../pnpm-workspace.yaml", import.meta.url), "utf8"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const problems = checkIgnores(ignored, EXPIRY, today);
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }
  for (const ghsa of ignored)
    console.log(`✓ ${ghsa} bị bỏ qua tới ${EXPIRY[ghsa].until} (${EXPIRY[ghsa].wo})`);
  if (!ignored.length) console.log("✓ không có GHSA nào bị bỏ qua");
}
