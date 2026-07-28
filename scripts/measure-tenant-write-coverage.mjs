#!/usr/bin/env node
/**
 * S6-QA-TENANTWRITE-1 / KI-037 — đo phủ vế GHI chéo tenant của bộ int-spec.
 *
 * VÌ SAO CÓ FILE NÀY: done_when của WO đòi "ĐO TRƯỚC (số, không phải cảm giác)". Số đo mà không tái
 * lập được thì lần sau lại phải đoán, nên phép đo đi kèm repo thay vì nằm trong một tin nhắn.
 *
 *   node scripts/measure-tenant-write-coverage.mjs            # bảng tóm tắt
 *   node scripts/measure-tenant-write-coverage.mjs --list      # + danh sách bảng từng nhóm
 *
 * ⚠️ Tên bảng CÓ CHỮ SỐ (`i18n_overrides`) — lớp ký tự phải là [a-z0-9_], bản đầu dùng [a-z_]
 * và âm thầm bỏ sót đúng 1 bảng (154 thay vì 155).
 *
 * ⚠️ ĐÂY LÀ HEURISTIC, KHÔNG PHẢI CHỨNG MINH. Nó đọc mã nguồn spec bằng regex:
 *   • đếm DƯ  — một khối `it()` dài có thể ôm cả fixture INSERT lẫn assert của thứ khác;
 *   • đếm THIẾU — spec đặt tên biến tenant khác `B`/`companyB`/`tenantB` sẽ không bị nhận ra.
 * Dùng để KHOANH PHẠM VI. Bằng chứng thật là lưới W0/W1/W2/W3 trong
 * `apps/api/test/integration/tenant-isolation.int-spec.ts` — nó chạy SQL thật trên Postgres thật.
 */
import fs from "node:fs";
import path from "node:path";

const REGISTRY = "apps/api/test/integration/rls-registry.ts";
const ROOTS = ["apps/api/test", "apps/api/src"];

/** Khẳng định trông như một vế DENY. */
const DENY =
  /rejects|toThrow|toHaveLength\(0\)|violates row-level security|permission denied|\.toBe\(0\)/i;
/** Khối có nhắc tới tenant THỨ HAI ⇒ mới tính là ca chéo tenant (không phải append-only trong-tenant). */
const CROSS = /\bB\.companyId|companyB|tenantB|otherCompany|otherTenant|\bcoB\b|companyIdB/;

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(int-spec|int\.spec|e2e-spec)\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Cắt file thành các khối `it(`/`test(` thô — đủ chính xác để PHÂN LOẠI, không cần parse AST. */
function blocks(src) {
  const idx = [...src.matchAll(/\b(it|test)(\.\w+)?\s*\(/g)].map((m) => m.index);
  return idx.map((s, i) => src.slice(s, idx[i + 1] ?? src.length));
}

const registrySrc = fs.readFileSync(REGISTRY, "utf8");
const tables = [...registrySrc.matchAll(/table:\s*["'`]([a-z0-9_]+)["'`]/g)].map((m) => m[1]);
const files = ROOTS.flatMap((d) => (fs.existsSync(d) ? walk(d) : []));

const xtenant = new Map();
const inTenantOnly = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  for (const b of blocks(src)) {
    if (!DENY.test(b)) continue;
    const cross = CROSS.test(b);
    for (const t of tables) {
      const w = new RegExp(
        String.raw`(INSERT\s+INTO\s+${t}\b|UPDATE\s+${t}\b|DELETE\s+FROM\s+${t}\b)`,
        "i",
      );
      if (!w.test(b)) continue;
      const bucket = cross ? xtenant : inTenantOnly;
      if (!bucket.has(t)) bucket.set(t, new Set());
      bucket.get(t).add(path.basename(f));
    }
  }
}

const covered = [...xtenant.keys()].sort();
const onlyInTenant = [...inTenantOnly.keys()].filter((t) => !xtenant.has(t)).sort();
const none = tables.filter((t) => !xtenant.has(t) && !inTenantOnly.has(t)).sort();

console.log(`registry            : ${tables.length} bảng (${REGISTRY})`);
console.log(`int-spec quét       : ${files.length}`);
console.log(`ca GHI CHÉO TENANT  : ${covered.length}`);
console.log(`chỉ deny trong-tenant: ${onlyInTenant.length}`);
console.log(`KHÔNG ca GHI-deny   : ${none.length}`);

if (process.argv.includes("--list")) {
  const show = (label, arr) => console.log(`\n— ${label} (${arr.length}) —\n` + arr.join("\n"));
  show("có ca GHI chéo tenant", covered);
  show("chỉ deny GHI trong-tenant", onlyInTenant);
  show("không có ca GHI-deny nào", none);
}
