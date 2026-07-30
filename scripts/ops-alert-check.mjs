#!/usr/bin/env node
/**
 * ops-alert-check.mjs — S6-REL-1 (D6) · ĐÓNG KI-011 ("chưa có cảnh báo tự động", S2, chặn go-live).
 *
 * `IMPLEMENTATION-09` §18.3 liệt kê 9 alert rule đề xuất. Trước WO này chúng chỉ tồn tại dưới dạng
 * BẢNG — không có gì chạy, nên §18.2 monitoring của `RELEASE-01` ghi ❌. Script này ĐO thật những
 * tín hiệu đo được trên hạ tầng hiện có (NSSM + cloudflared + Postgres trong docker), rồi giao cho
 * `scripts/lib/ops-alert-rules.mjs` phán xét.
 *
 * ═══ CHỈ NHẬN CÁI ĐO ĐƯỢC ═══
 * Không khai những rule cần APM/metric store mà dự án chưa có (p95/p99 theo endpoint, 403-spike theo
 * module). Khai một rule rồi để nó luôn xanh vì không có nguồn dữ liệu còn tệ hơn không khai: nó tạo
 * cảm giác được canh gác. Cái không đo được ghi thẳng "KHÔNG ĐO ĐƯỢC" trong RELEASE-09.
 *
 * ═══ THIẾU DỮ LIỆU ⇒ unknown ⇒ exit 1 ═══
 * Không đo được KHÔNG phải "bình thường". Xem luật nền ở đầu ops-alert-rules.mjs.
 *
 * ═══ DÙNG ═══
 *   node scripts/ops-alert-check.mjs                # bảng người đọc
 *   node scripts/ops-alert-check.mjs --json         # máy đọc (đưa vào monitor/cron)
 *   node scripts/ops-alert-check.mjs --quiet        # chỉ in khi có warn/crit/unknown
 * Lịch chạy (Windows Task Scheduler) — xem docs/RELEASE/RELEASE-09.
 *
 * ENV: OPS_BASE_URL (mặc định http://localhost:3100/api/v1) · OPS_DOMAIN (cert) · OPS_WINDOW_MIN
 *      OPS_BACKUP_DIR · OPS_LOG_FILE · OPS_ALERT_LOG · OPS_ALERT_WEBHOOK (tuỳ chọn)
 *      DATABASE_DIRECT_URL (đọc migration + system_job_runs; thiếu ⇒ 2 rule đó `unknown`)
 *
 * Exit: 0 tất cả ok · 1 có warn hoặc unknown · 2 có crit · 3 lỗi cấu hình.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, exitCodeFor, worstSeverity } from "./lib/ops-alert-rules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");

/**
 * Nạp `.env` vào `process.env` — KHÔNG ghi đè biến đã có (cùng precedence với
 * `apps/api/src/config/load-env.ts` và `@nestjs/config`).
 *
 * VÌ SAO CẦN: lệnh này chạy từ **Windows Task Scheduler** (`RELEASE-09` §4), nơi shell không source
 * `.env`. Thiếu `DATABASE_DIRECT_URL` ⇒ hai luật "lệch migration" và "job nền thất bại" luôn ra
 * `unknown` ⇒ exit 1 **mỗi 10 phút, vĩnh viễn**. Cảnh báo kêu liên tục vì lý do sai thì chỉ sau vài
 * ngày là không ai đọc nữa — và lúc đó nó tệ hơn không có cảnh báo. Đo được khi chạy thử script này
 * trong shell chưa source `.env` (2026-07-30).
 */
function loadDotEnv() {
  try {
    for (const line of fs.readFileSync(path.join(REPO_ROOT, ".env"), "utf8").split(/\r?\n/)) {
      const trimmedLine = line.trim();
      if (trimmedLine === "" || trimmedLine.startsWith("#")) continue;
      const eq = trimmedLine.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmedLine.slice(0, eq).trim();
      if (key in process.env) continue;
      process.env[key] = trimmedLine.slice(eq + 1).trim();
    }
  } catch {
    /* không có .env (vd worktree lane) — các luật cần DB sẽ ra `unknown`, đúng luật fail-closed */
  }
}
loadDotEnv();

const ARGV = process.argv.slice(2);
const JSON_OUT = ARGV.includes("--json");
const QUIET = ARGV.includes("--quiet");

const BASE_URL = (process.env.OPS_BASE_URL ?? "http://localhost:3100/api/v1").replace(/\/$/, "");
const DOMAIN = process.env.OPS_DOMAIN ?? "api.funtimemediacorp.com";
const WINDOW_MIN = Number.parseInt(process.env.OPS_WINDOW_MIN ?? "60", 10);
const BACKUP_DIR = process.env.OPS_BACKUP_DIR ?? path.join(REPO_ROOT, "backups");
const LOG_FILE = process.env.OPS_LOG_FILE ?? path.join(REPO_ROOT, "logs", "api.err.log");
const ALERT_LOG = process.env.OPS_ALERT_LOG ?? path.join(REPO_ROOT, "logs", "ops-alerts.log");
const WEBHOOK = process.env.OPS_ALERT_WEBHOOK ?? "";
const TIMEOUT_MS = 8000;

// ── Thu thập (mọi hàm: đo được ⇒ giá trị, không đo được ⇒ null; KHÔNG BAO GIỜ ném) ──────────
async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => null) };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      json: null,
      err: err?.name === "AbortError" ? "timeout" : String(err?.code ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function collectLiveness() {
  const r = await getJson(`${BASE_URL}/health`);
  if (r.status === 0) return null; // không với tới được ⇒ để rule quyết (unknown vs crit)
  return { ok: r.ok && r.json?.data?.status === "ok", detail: `HTTP ${r.status}` };
}

/** /health/db fail-SOFT: luôn 200 ⇒ PHẢI đọc body, không được tin mã HTTP (bẫy ghi ở canary-watch.sh). */
async function collectReadiness() {
  const r = await getJson(`${BASE_URL}/health/db`);
  if (r.status === 0 || !r.json?.data) return null;
  return { status: r.json.data.status, latencyMs: r.json.data.database?.latencyMs ?? null };
}

/** psql qua container khi host không có client — cùng cách migrate-verify-ephemeral.sh đã giải. */
function psql(sqlText) {
  const url = process.env.DATABASE_DIRECT_URL;
  if (!url) return null;
  const container = process.env.OPS_PG_CONTAINER ?? "mediaos-postgres";
  const attempts = [
    ["psql", [url, "-tAc", sqlText]],
    ["docker", ["exec", "-i", container, "psql", url, "-tAc", sqlText]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      return execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: TIMEOUT_MS,
      }).trim();
    } catch {
      /* thử cách kế tiếp */
    }
  }
  return null;
}

function collectMigrationPending() {
  const applied = psql("select count(*) from drizzle.__drizzle_migrations");
  if (applied === null) return null;
  try {
    const journal = JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, "apps", "api", "migrations", "meta", "_journal.json"),
        "utf8",
      ),
    );
    const total = Array.isArray(journal.entries) ? journal.entries.length : null;
    const n = Number.parseInt(applied, 10);
    if (total === null || Number.isNaN(n)) return null;
    return Math.max(0, total - n);
  } catch {
    return null;
  }
}

function collectJobFailed() {
  const out = psql(
    `select count(*) from system_job_runs where status = 'Failed' and started_at > now() - interval '${WINDOW_MIN} minutes'`,
  );
  if (out === null) return null;
  const n = Number.parseInt(out, 10);
  return Number.isNaN(n) ? null : n;
}

/** Đếm dòng lỗi trong cửa sổ. File log NSSM không có timestamp chuẩn ⇒ đếm theo phần ĐUÔI mới ghi. */
function collectErrorLines() {
  try {
    const stat = fs.statSync(LOG_FILE);
    const ageMin = (Date.now() - stat.mtimeMs) / 60000;
    if (ageMin > WINDOW_MIN) return 0; // log không được ghi thêm trong cửa sổ ⇒ 0 lỗi mới
    // Chỉ đọc 2MB cuối: file này từng phình tới 149MB (sự cố 2026-07-24), không đọc cả file.
    const size = stat.size;
    const readBytes = Math.min(size, 2 * 1024 * 1024);
    const fd = fs.openSync(LOG_FILE, "r");
    const buf = Buffer.alloc(readBytes);
    fs.readSync(fd, buf, 0, readBytes, size - readBytes);
    fs.closeSync(fd);
    return (buf.toString("utf8").match(/\bERROR\b/g) ?? []).length;
  } catch {
    return null;
  }
}

function collectDiskFreeGb() {
  try {
    const drive = path.parse(REPO_ROOT).root.replace(/\\$/, "");
    if (process.platform === "win32") {
      const out = execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `(Get-PSDrive -Name '${drive.replace(":", "")}').Free`],
        { encoding: "utf8", timeout: TIMEOUT_MS },
      ).trim();
      const bytes = Number.parseFloat(out);
      return Number.isNaN(bytes) ? null : Math.round((bytes / 1024 ** 3) * 10) / 10;
    }
    const out = execFileSync("df", ["-k", REPO_ROOT], { encoding: "utf8", timeout: TIMEOUT_MS });
    const kb = Number.parseInt(out.trim().split("\n").pop().split(/\s+/)[3], 10);
    return Number.isNaN(kb) ? null : Math.round((kb / 1024 ** 2) * 10) / 10;
  } catch {
    return null;
  }
}

function collectBackupAgeHours() {
  try {
    const files = fs
      .readdirSync(BACKUP_DIR, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => fs.statSync(path.join(BACKUP_DIR, e.name)).mtimeMs);
    if (files.length === 0) return null;
    return Math.round(((Date.now() - Math.max(...files)) / 3_600_000) * 10) / 10;
  } catch {
    return null;
  }
}

function collectCertExpiryDays() {
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `$c=[Net.Sockets.TcpClient]::new('${DOMAIN}',443);$s=[Net.Security.SslStream]::new($c.GetStream());` +
          `$s.AuthenticateAsClient('${DOMAIN}');$s.RemoteCertificate.GetExpirationDateString()`,
      ],
      { encoding: "utf8", timeout: TIMEOUT_MS },
    ).trim();
    const when = new Date(out);
    if (Number.isNaN(when.getTime())) return null;
    return Math.round((when.getTime() - Date.now()) / 86_400_000);
  } catch {
    return null;
  }
}

// ── Ra ──────────────────────────────────────────────────────────────────────────────────────
function appendAlertLog(payload) {
  try {
    fs.mkdirSync(path.dirname(ALERT_LOG), { recursive: true });
    fs.appendFileSync(ALERT_LOG, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    /* không ghi được sổ cảnh báo thì vẫn phải in ra stdout — đừng nuốt cả phán quyết */
  }
}

async function notifyWebhook(payload) {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `[MediaOS ops] ${payload.worst.toUpperCase()}`, ...payload }),
    });
  } catch {
    /* webhook hỏng không được làm hỏng kết quả kiểm tra */
  }
}

async function main() {
  const signals = {
    liveness: await collectLiveness(),
    readiness: await collectReadiness(),
    migrationPending: collectMigrationPending(),
    jobFailed: collectJobFailed(),
    errorLines: collectErrorLines(),
    diskFreeGb: collectDiskFreeGb(),
    backupAgeHours: collectBackupAgeHours(),
    certExpiryDays: collectCertExpiryDays(),
  };

  const rows = evaluate(signals);
  const worst = worstSeverity(rows.map((r) => r.severity));
  const payload = {
    at: new Date().toISOString(),
    baseUrl: BASE_URL,
    windowMin: WINDOW_MIN,
    worst,
    rows,
  };

  if (worst !== "ok") {
    appendAlertLog(payload);
    await notifyWebhook(payload);
  }

  if (JSON_OUT) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (!QUIET || worst !== "ok") {
    const icon = { ok: "✓", unknown: "?", warn: "!", crit: "✗" };
    process.stdout.write(
      `\nOPS ALERT CHECK (IMPL-09 §18.3) — ${BASE_URL} · cửa sổ ${WINDOW_MIN} phút\n\n`,
    );
    for (const r of rows)
      process.stdout.write(
        `  ${icon[r.severity]} ${r.severity.padEnd(7)} ${r.title.padEnd(34)} ${r.detail}\n`,
      );
    process.stdout.write(
      `\n  Tổng thể: ${worst.toUpperCase()}${worst === "ok" ? "" : `  → ghi ${path.relative(REPO_ROOT, ALERT_LOG)}`}\n\n`,
    );
  }

  process.exit(exitCodeFor(worst));
}

main().catch((err) => {
  process.stderr.write(`[ops-alert] lỗi ngoài dự kiến: ${err?.stack ?? err}\n`);
  process.exit(3);
});
