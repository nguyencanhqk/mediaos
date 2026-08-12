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
 * ═══ MỘT DỊCH VỤ KHÔNG ĐO = MỘT DỊCH VỤ KHÔNG CÓ AI CANH (bổ sung 2026-08-12) ═══
 * Bản đầu chỉ dò API :3100. Ngày 11–12/08, `fbpost` :3500 trả **500 mọi đường dẫn suốt ~15 tiếng**
 * mà bộ này vẫn xanh/warn — `Get-Service` = Running, log in `✓ Ready`, và không ai biết. Nay mọi
 * mặt PROD đều được dò: xem `DEFAULT_SITES` (fbpost :3500 · LMS :3400) + `collectNextBuilds`.
 * Thêm một mặt PROD mới ⇒ THÊM VÀO `DEFAULT_SITES`, nếu không nó lại sập âm y hệt.
 *
 * ENV: OPS_BASE_URL (mặc định http://localhost:3100/api/v1) · OPS_DOMAIN (cert) · OPS_WINDOW_MIN
 *      OPS_BACKUP_DIR · OPS_LOG_FILE · OPS_LOG_TAIL_BYTES · OPS_ALERT_LOG · OPS_ALERT_WEBHOOK (tuỳ chọn)
 *      OPS_SITES (JSON ghi đè danh sách trang dò) · OPS_SITE_TIMEOUT_MS
 *      DATABASE_DIRECT_URL (đọc migration + system_job_runs; thiếu ⇒ 2 rule đó `unknown`)
 *
 * Exit: 0 tất cả ok · 1 có warn hoặc unknown · 2 có crit · 3 lỗi cấu hình.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, exitCodeFor, worstSeverity } from "./lib/ops-alert-rules.mjs";
import { DEFAULT_TAIL_BYTES, countErrorLinesInFile } from "./lib/ops-log-window.mjs";

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
/**
 * Đuôi log đọc mỗi lần. Đủ rộng để phủ hết cửa sổ khi log phun mạnh — xem `lib/ops-log-window.mjs`.
 * Giá trị env rác ⇒ quay về mặc định, KHÔNG để `NaN` biến rule thành `unknown` vĩnh viễn.
 */
const LOG_TAIL_BYTES = (() => {
  const n = Number.parseInt(process.env.OPS_LOG_TAIL_BYTES ?? "", 10);
  return Number.isNaN(n) || n <= 0 ? DEFAULT_TAIL_BYTES : n;
})();
const ALERT_LOG = process.env.OPS_ALERT_LOG ?? path.join(REPO_ROOT, "logs", "ops-alerts.log");
const WEBHOOK = process.env.OPS_ALERT_WEBHOOK ?? "";
const TIMEOUT_MS = 8000;

/**
 * Các mặt PROD KHÁC ngoài API — mỗi cái là một dịch vụ NSSM riêng, chết độc lập với :3100.
 *
 * `url` cố tình trỏ vào một trang CÔNG KHAI có thật (không phải `/api/health` — hai app này không
 * có), vì sự cố 11–12/08 giết cả `/login` lẫn đường dẫn không tồn tại: nó nằm ở **middleware**, tức
 * lớp mà mọi request đều đi qua. Dò một trang thật là dò đúng chỗ đau.
 *
 * `expect` = một chuỗi PHẢI có trong HTML trả về. Đây là lớp chắn thứ hai cho ca "200 nhưng trang
 * trắng" ([[web-core-stale-dist-white-page]]) — chọn chuỗi do CHÍNH trang đó sinh, đủ hẹp để trang
 * lỗi của Next không tình cờ khớp.
 *
 * `nextDir` = app dir để soi `.next` (xem `collectNextBuilds`); bỏ trống nếu không phải app Next.
 */
const DEFAULT_SITES = [
  {
    id: "SOCIAL",
    title: "fbpost đăng bài (:3500)",
    url: "http://localhost:3500/login",
    expect: "Cần đăng nhập từ MediaOS",
    nextDir: path.join("apps", "fbpost"),
  },
  {
    id: "LMS",
    title: "LMS đào tạo (:3400)",
    url: "http://localhost:3400/login",
    expect: "<title>FMC</title>",
    nextDir: path.join("apps", "lms"),
  },
];

/**
 * `OPS_SITES` rác ⇒ trả `null` ⇒ luật ra `unknown` (KHÔNG âm thầm quay về mặc định).
 * Quay về mặc định sẽ giấu mất việc người vận hành vừa gõ sai cấu hình.
 */
const SITES = (() => {
  const raw = process.env.OPS_SITES;
  if (!raw) return DEFAULT_SITES;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("OPS_SITES phải là mảng JSON");
    return parsed;
  } catch (err) {
    process.stderr.write(`[ops-alert] OPS_SITES không đọc được: ${err?.message ?? err}\n`);
    return null;
  }
})();

const SITE_TIMEOUT_MS = (() => {
  const n = Number.parseInt(process.env.OPS_SITE_TIMEOUT_MS ?? "", 10);
  return Number.isNaN(n) || n <= 0 ? 10_000 : n;
})();

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

/**
 * Đếm dòng lỗi trong cửa sổ — đọc TIMESTAMP TỪNG DÒNG (`lib/ops-log-window.mjs`), không suy từ
 * `mtime` của file.
 *
 * Bản trước gate bằng `mtime` rồi đếm mọi chữ `ERROR` trong 2MB cuối. Ngày 2026-08-01 nó trả **1787**
 * "lỗi trong 60 phút" trong khi dòng lỗi mới nhất là của **30/07** — CRIT giả nổ mỗi 10 phút. Lý do
 * đầy đủ + chiều hỏng ngược lại (âm tính giả): xem đầu `lib/ops-log-window.mjs`.
 */
function collectErrorLines() {
  return countErrorLinesInFile(LOG_FILE, { windowMin: WINDOW_MIN, maxBytes: LOG_TAIL_BYTES });
}

/**
 * Dò MỘT trang PROD.
 *
 * `redirect: "manual"` là CỐ Ý: để `fetch` tự đi theo 307 thì một trang công khai bị cổng phiên đá
 * về `/login` vẫn hiện ra "200 ok" — đúng chế độ hỏng đã cắn ngày 12/08 (hai trang chính sách Meta
 * bị đá về /login, app không lên Live được). Ta muốn thấy 307, không muốn thấy cái đích của nó.
 *
 * Thử lại MỘT lần khi lỗi tầng vận chuyển: `next start` lạnh sau restart có thể lỡ nhịp đầu, và
 * một cảnh báo sai mỗi 10 phút thì chỉ vài ngày là không ai đọc nữa.
 */
async function probeSite(site) {
  const base = { id: site.id, title: site.title ?? site.id, url: site.url, expect: site.expect };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SITE_TIMEOUT_MS);
    try {
      const res = await fetch(site.url, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": "MediaOS-ops-alert-check" },
      });
      // KHÔNG nuốt lỗi đọc body thành chuỗi rỗng: nuốt xong `bodyOk` sẽ là `false` và ta báo "thân
      // trang thiếu dấu nhận dạng" cho một sự cố thật ra là ĐỨT KẾT NỐI. Để nó ném xuống `catch`
      // dưới ⇒ phân loại đúng là lỗi vận chuyển, và còn được thử lại một lần.
      const body = res.status >= 200 && res.status < 300 ? await res.text() : "";
      return {
        ...base,
        status: res.status,
        bodyOk: site.expect ? body.includes(site.expect) : null,
      };
    } catch (err) {
      const transport =
        err?.name === "AbortError"
          ? "timeout"
          : String(err?.cause?.code ?? err?.code ?? err?.name ?? err);
      if (attempt === 1) return { ...base, status: null, transport };
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ...base, status: null, transport: "unreachable" };
}

async function collectSites() {
  if (SITES === null) return null; // cấu hình hỏng — để luật ra `unknown`
  return Promise.all(SITES.map(probeSite));
}

/** Thư mục CỐ ĐỊNH trong `.next/static`; thứ còn lại chính là `<BUILD_ID>` của `next build`. */
const FIXED_STATIC_DIRS = new Set(["chunks", "css", "media", "development", "webpack"]);
/** Đọc tối đa ngần này byte mỗi bundle middleware — `eval(` của bản dev nằm ngay từ đầu file. */
const MIDDLEWARE_SCAN_BYTES = 1024 * 1024;

function listDirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }
}

/**
 * Đếm `eval(` trong bundle middleware — bằng chứng CHẮC NHẤT rằng `.next` đang giữ bản `next dev`.
 *
 * Đường dẫn lấy TỪ `middleware-manifest.json` chứ KHÔNG đoán: nó đổi theo vị trí file nguồn
 * (`src/middleware.ts` → `server/src/middleware.js`, `middleware.ts` → `server/middleware.js`).
 * Đo 12/08: fbpost dùng nhánh `src/`, LMS dùng nhánh gốc — đoán mò là sai một trong hai.
 *
 * @returns {number|null} số dòng `eval(`; `null` = app không có middleware để soi.
 */
function countEvalInMiddleware(nextDir) {
  let manifest;
  try {
    manifest = JSON.parse(
      fs.readFileSync(path.join(nextDir, "server", "middleware-manifest.json"), "utf8"),
    );
  } catch {
    return null;
  }
  const files = Object.values(manifest?.middleware ?? {}).flatMap((m) => m?.files ?? []);
  let scanned = 0;
  let hits = 0;
  for (const rel of files) {
    let fd;
    try {
      fd = fs.openSync(path.join(nextDir, rel), "r");
      const buf = Buffer.alloc(MIDDLEWARE_SCAN_BYTES);
      const read = fs.readSync(fd, buf, 0, MIDDLEWARE_SCAN_BYTES, 0);
      scanned += 1;
      hits += (
        buf
          .subarray(0, read)
          .toString("utf8")
          .match(/(^|\n)eval\(/g) ?? []
      ).length;
    } catch {
      /* file bay mất giữa chừng — coi như không soi được file này */
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  return scanned === 0 ? null : hits;
}

/** `prod` · `dev` · `missing` cho `.next` của một app. */
function nextBuildMode(appDir) {
  const nextDir = path.join(REPO_ROOT, appDir, ".next");
  const staticDirs = listDirs(path.join(nextDir, "static"));

  // (a) `next dev` để lại `development/` + `webpack/`; `next build` KHÔNG bao giờ tạo hai cái này.
  if (staticDirs?.some((n) => n === "development" || n === "webpack")) return "dev";

  // (b) Bằng chứng chắc: bundle middleware sinh bằng devtool:'eval'.
  const evalLines = countEvalInMiddleware(nextDir);
  if (evalLines !== null) return evalLines > 0 ? "dev" : "prod";

  // (c) App không có middleware ⇒ dựa vào sự tồn tại của `<BUILD_ID>/`.
  if (staticDirs === null) return "missing";
  return staticDirs.some((n) => !FIXED_STATIC_DIRS.has(n)) ? "prod" : "missing";
}

function collectNextBuilds() {
  if (SITES === null) return null;
  return SITES.filter((s) => s.nextDir).map((s) => ({
    id: s.id,
    dir: s.nextDir,
    mode: nextBuildMode(s.nextDir),
  }));
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
    sites: await collectSites(),
    nextBuilds: collectNextBuilds(),
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
