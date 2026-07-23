#!/usr/bin/env node
/**
 * S5-LMS-BE-4 §6 — verify PROD: `audit_logs` lms_sync ĐỨNG YÊN qua ≥N nhịp job, trong khi
 * `system_job_runs` VẪN TĂNG (bằng chứng "job có chạy" không mất, chỉ audit rác biến mất).
 *
 * Dùng: node scripts/qa/lms-be4-prod-verify.mjs [số_nhịp]   (mặc định 3)
 * Nhịp job = SYSTEM_JOBS_POLL_MS (đọc từ .env). Script tự chờ đủ số nhịp.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));
const { Client } = require("pg");

function env(key) {
  const line = readFileSync(join(ROOT, ".env"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : undefined;
}

const TICKS = Number(process.argv[2] ?? 3);
const POLL_MS = Number(env("SYSTEM_JOBS_POLL_MS") ?? 60_000);
const client = new Client({ connectionString: env("DATABASE_DIRECT_URL") });

async function snapshot() {
  const a = await client.query(
    `SELECT count(*)::int AS n, max(created_at) AS last FROM audit_logs WHERE object_type = 'lms_sync'`,
  );
  const j = await client.query(
    `SELECT count(*)::int AS n, max(started_at) AS last FROM system_job_runs WHERE job_code = 'LMS_USER_SYNC'`,
  );
  return { audit: a.rows[0], jobs: j.rows[0] };
}

await client.connect();
const t0 = await snapshot();
console.log(
  `Nhịp job: ${POLL_MS}ms · theo dõi ${TICKS} nhịp (~${Math.round((POLL_MS * TICKS) / 60000)} phút)\n`,
);
console.log(`T0  audit lms_sync = ${t0.audit.n}  (mới nhất ${t0.audit.last ?? "—"})`);
console.log(`T0  system_job_runs = ${t0.jobs.n}  (mới nhất ${t0.jobs.last ?? "—"})\n`);

for (let i = 1; i <= TICKS; i += 1) {
  await new Promise((r) => setTimeout(r, POLL_MS + 5_000));
  const s = await snapshot();
  console.log(
    `nhịp ${i}: audit ${t0.audit.n} → ${s.audit.n} (+${s.audit.n - t0.audit.n})  ·  job_runs ${t0.jobs.n} → ${s.jobs.n} (+${s.jobs.n - t0.jobs.n})`,
  );
}

const end = await snapshot();
const auditDelta = end.audit.n - t0.audit.n;
const jobDelta = end.jobs.n - t0.jobs.n;
await client.end();

console.log("");
const auditOk = auditDelta === 0;
const jobOk = jobDelta >= TICKS;
console.log(
  `${auditOk ? "✅" : "❌"} audit_logs lms_sync +${auditDelta} (phải = 0 — không có thay đổi tài khoản nào)`,
);
console.log(
  `${jobOk ? "✅" : "❌"} system_job_runs +${jobDelta} (phải ≥ ${TICKS} — bằng chứng job VẪN chạy)`,
);
console.log(`\n${auditOk && jobOk ? "✅ VERIFY PROD PASS" : "❌ VERIFY PROD FAIL"}`);
process.exit(auditOk && jobOk ? 0 : 1);
