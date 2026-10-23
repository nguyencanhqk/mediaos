/**
 * ops-alert-rules.mjs — S6-REL-1 (D6) · LOGIC THUẦN của cảnh báo vận hành (IMPLEMENTATION-09 §18.3).
 *
 * Tách khỏi `scripts/ops-alert-check.mjs` (phần đi đo: HTTP/DB/đĩa/cert) để phần QUYẾT ĐỊNH test được
 * mà không cần hạ tầng. `ops-alert-check.mjs` lo THU THẬP, file này lo PHÁN XÉT.
 *
 * ═══ LUẬT NỀN: THIẾU DỮ LIỆU ≠ BÌNH THƯỜNG ═══
 * Mỗi luật trả một trong: `ok` · `warn` · `crit` · `unknown`. `unknown` KHÔNG được gộp vào `ok`.
 * Một hệ cảnh báo báo "xanh" vì nó không đo được gì chính là chế độ hỏng tệ nhất: người trực tin là
 * không có sự cố, trong khi thật ra là không có tín hiệu. Vì vậy `worstSeverity` xếp `unknown` TRÊN
 * `ok`, và `ops-alert-check.mjs` trả exit code khác 0 khi có `unknown`.
 *
 * ═══ MỞ RỘNG 2026-08-12: KHÔNG ĐO CÁI GÌ THÌ KHÔNG THẤY CÁI ĐÓ ═══
 * Luật nền trên chỉ bảo vệ những gì ĐÃ nằm trong danh sách đo. Ngày 11–12/08, `fbpost` (:3500) trả
 * **500 mọi đường dẫn suốt ~15 tiếng** mà 8/8 nhóm vẫn xanh/warn — vì cả bộ chỉ dò API :3100.
 * `Get-Service` = `Running`, log in `✓ Ready`; không một chỉ báo nào chạm tới sự thật. Nên thêm:
 *
 *   - `SITE_*` — mỗi trang PROD (fbpost :3500 · LMS :3400) là MỘT hàng, phán từ HÀNH VI HTTP thật.
 *     Danh sách RỖNG ⇒ `unknown`, vì "không dò trang nào" chính là hình dạng của lỗi vừa vá.
 *   - `NEXT_DEV_BUILD` — cùng sự cố nhìn từ NGUYÊN NHÂN: `next dev` ghi đè `.next` mà `next start`
 *     đang phục vụ ⇒ bundle `devtool:'eval'` ⇒ edge runtime cấm sinh mã từ chuỗi ⇒ `EvalError`.
 *     Bắt được TRƯỚC khi nó thành 500, và chỉ thẳng thủ phạm thay vì "trang chết, không rõ vì sao".
 */

import path from "node:path";

/**
 * Các mặt PROD KHÁC ngoài API — mỗi cái là một dịch vụ NSSM riêng, chết độc lập với :3100.
 * (Chuyển từ `ops-alert-check.mjs` sang đây ở S19-OPS-PRODDBBOOT-1 để HỢP ĐỒNG "thế nào là sống"
 * của từng trang test được — phần đi đo vẫn ở `ops-alert-check.mjs`.)
 *
 * `url` cố tình trỏ vào một trang CÔNG KHAI có thật (không phải `/api/health` — hai app này không
 * có), vì sự cố 11–12/08 giết cả `/login` lẫn đường dẫn không tồn tại: nó nằm ở **middleware**, tức
 * lớp mà mọi request đều đi qua. Dò một trang thật là dò đúng chỗ đau.
 *
 * `expect` = một chuỗi PHẢI có trong HTML trả về (khi 2xx). Lớp chắn thứ hai cho ca "200 nhưng trang
 * trắng" ([[web-core-stale-dist-white-page]]) — chọn chuỗi do CHÍNH trang đó sinh.
 *
 * `expectRedirect` (tuỳ chọn) = 3xx mà `Location` có ĐƯỜNG DẪN kết thúc bằng giá trị này là SỐNG.
 * LMS đăng nhập qua SSO từ 21/09: `/login` trả 307 về app chính (`…/lms`) — trước khi có trường này,
 * SITE_LMS kêu warn oan mỗi 10 phút. So phần CUỐI đường dẫn, KHÔNG ghim miền (miền app chính khác
 * nhau giữa PROD/dev-online) và KHÔNG xét query. Trang không khai trường này ⇒ 3xx vẫn là warn.
 *
 * `nextDir` = app dir để soi `.next` (xem `collectNextBuilds`); bỏ trống nếu không phải app Next.
 * Thêm một mặt PROD mới ⇒ THÊM VÀO ĐÂY, nếu không nó lại sập âm.
 */
export const DEFAULT_SITES = Object.freeze([
  Object.freeze({
    id: "SOCIAL",
    title: "fbpost đăng bài (:3500)",
    url: "http://localhost:3500/login",
    expect: "Cần đăng nhập từ MediaOS",
    nextDir: path.join("apps", "fbpost"),
  }),
  Object.freeze({
    id: "LMS",
    title: "LMS đào tạo (:3400)",
    url: "http://localhost:3400/login",
    expect: "<title>FMC</title>",
    expectRedirect: "/lms",
    nextDir: path.join("apps", "lms"),
  }),
]);

/** `/lms/` · `lms` · `//lms` ⇒ `/lms`; `/` hoặc rỗng ⇒ `""` (không được khớp mọi thứ). */
function normalizeRedirectPath(p) {
  const trimmed = String(p).trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed === "" ? "" : `/${trimmed}`;
}

/**
 * `Location` có ĐƯỜNG DẪN kết thúc đúng bằng `expected` (đủ đoạn — `/xlms` không khớp `/lms`)?
 * Location tương đối được giải trên một gốc giả; query/fragment bị bỏ trước khi so.
 */
export function redirectMatches(location, expected) {
  if (typeof location !== "string" || location.trim() === "") return false;
  if (typeof expected !== "string") return false;
  const want = normalizeRedirectPath(expected);
  if (want === "") return false;
  let pathname;
  try {
    pathname = new URL(location.trim(), "http://ops-alert.invalid").pathname;
  } catch {
    return false;
  }
  return `${normalizeRedirectPath(pathname)}`.endsWith(want);
}

/**
 * Đọc `OPS_SITES`. Không đặt ⇒ `DEFAULT_SITES`. Rác ⇒ `sites: null` + `error` (luật ra `unknown`) —
 * KHÔNG âm thầm quay về mặc định, vì thế sẽ giấu mất việc người vận hành vừa gõ sai cấu hình.
 *
 * @returns {{sites: ReadonlyArray<object>|null, error: string|null}}
 */
export function parseSitesEnv(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") {
    return { sites: DEFAULT_SITES, error: null };
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("OPS_SITES phải là mảng JSON");
    parsed.forEach((site, i) => {
      if (site === null || typeof site !== "object" || Array.isArray(site)) {
        throw new Error(`OPS_SITES[${i}] phải là object`);
      }
      if (
        site.expectRedirect !== undefined &&
        (typeof site.expectRedirect !== "string" ||
          normalizeRedirectPath(site.expectRedirect) === "")
      ) {
        throw new Error(`OPS_SITES[${i}].expectRedirect phải là đường dẫn khác rỗng, khác "/"`);
      }
    });
    return { sites: parsed, error: null };
  } catch (err) {
    return { sites: null, error: String(err?.message ?? err) };
  }
}

/** In `Location` KHÔNG kèm query/fragment — có thể mang mã/phiên, không đưa vào sổ hay webhook. */
function describeLocation(location) {
  if (typeof location !== "string" || location.trim() === "") return "không có Location";
  try {
    const u = new URL(location.trim(), "http://ops-alert.invalid");
    const origin = u.origin === "http://ops-alert.invalid" ? "" : u.origin;
    return `Location ${origin}${u.pathname}`;
  } catch {
    return "Location không đọc được";
  }
}

/** Thứ tự nghiêm trọng — `unknown` nằm TRÊN `ok` (xem luật nền ở đầu file). */
export const SEVERITY_ORDER = ["ok", "unknown", "warn", "crit"];

export const DEFAULT_THRESHOLDS = {
  /** Readiness DB: latency (ms) vượt ngưỡng ⇒ warn. */
  dbLatencyWarnMs: 500,
  /** Migration tồn đọng: > 0 là warn ngay (dist mới trên schema cũ đã gây sự cố PROD 2026-07-24). */
  migrationPendingWarn: 1,
  /** Số job nền Failed trong cửa sổ quan sát. */
  jobFailedWarn: 1,
  jobFailedCrit: 10,
  /** Số dòng lỗi trong log API ở cửa sổ quan sát. */
  errorLogWarn: 20,
  errorLogCrit: 200,
  /** Dung lượng trống (GB) của ổ chứa pgdata + logs. */
  diskFreeWarnGb: 10,
  diskFreeCritGb: 2,
  /** Tuổi bản backup mới nhất (giờ). */
  backupAgeWarnH: 26,
  backupAgeCritH: 50,
  /** Số ngày còn lại của chứng chỉ TLS. */
  certExpiryWarnDays: 14,
  certExpiryCritDays: 3,
};

/** So sánh và trả về mức nặng nhất trong danh sách. */
export function worstSeverity(severities) {
  let worst = "ok";
  for (const s of severities) {
    if (SEVERITY_ORDER.indexOf(s) > SEVERITY_ORDER.indexOf(worst)) worst = s;
  }
  return worst;
}

function verdict(id, title, severity, detail) {
  return { id, title, severity, detail };
}

const missing = (id, title, what) =>
  verdict(
    id,
    title,
    "unknown",
    `KHÔNG ĐO ĐƯỢC (${what}) — không có tín hiệu, KHÔNG phải bình thường`,
  );

/**
 * Đánh giá toàn bộ tín hiệu thu được.
 * @param {object} s tín hiệu; mỗi trường có thể là `null`/`undefined` = không đo được.
 * @param {object} [t] ngưỡng (mặc định `DEFAULT_THRESHOLDS`).
 */
export function evaluate(s = {}, t = DEFAULT_THRESHOLDS) {
  const th = { ...DEFAULT_THRESHOLDS, ...t };
  const out = [];

  // ── Backend down (§18.3) ────────────────────────────────────────────────────────────────
  if (s.liveness === null || s.liveness === undefined) {
    out.push(missing("BACKEND_DOWN", "Backend down", "không gọi được /health"));
  } else if (s.liveness.ok !== true) {
    out.push(
      verdict(
        "BACKEND_DOWN",
        "Backend down",
        "crit",
        `/health không OK (${s.liveness.detail ?? "?"})`,
      ),
    );
  } else {
    out.push(verdict("BACKEND_DOWN", "Backend down", "ok", "/health 200 status=ok"));
  }

  // ── DB readiness / connection (§18.3) ───────────────────────────────────────────────────
  if (!s.readiness) {
    out.push(missing("DB_CONNECTION", "DB connection/readiness", "không gọi được /health/db"));
  } else if (s.readiness.status !== "ok") {
    // /health/db fail-SOFT: luôn HTTP 200 ⇒ phải đọc BODY. Bẫy đã ghi ở canary-watch.sh.
    out.push(
      verdict(
        "DB_CONNECTION",
        "DB connection/readiness",
        "crit",
        `body.status=${s.readiness.status}`,
      ),
    );
  } else if (
    typeof s.readiness.latencyMs === "number" &&
    s.readiness.latencyMs > th.dbLatencyWarnMs
  ) {
    out.push(
      verdict(
        "DB_CONNECTION",
        "DB connection/readiness",
        "warn",
        `latency ${s.readiness.latencyMs}ms > ${th.dbLatencyWarnMs}ms`,
      ),
    );
  } else {
    out.push(
      verdict(
        "DB_CONNECTION",
        "DB connection/readiness",
        "ok",
        `latency ${s.readiness.latencyMs ?? "?"}ms`,
      ),
    );
  }

  // ── Lệch migration (không có trong §18.3 nhưng là sự cố PROD ĐÃ xảy ra 2026-07-24) ──────
  if (s.migrationPending === null || s.migrationPending === undefined) {
    out.push(
      missing("MIGRATION_DRIFT", "Lệch migration (schema ↔ journal)", "không truy vấn được DB"),
    );
  } else if (s.migrationPending >= th.migrationPendingWarn) {
    out.push(
      verdict(
        "MIGRATION_DRIFT",
        "Lệch migration (schema ↔ journal)",
        "warn",
        `${s.migrationPending} migration chưa áp — build mới đang ngồi trên schema cũ`,
      ),
    );
  } else {
    out.push(
      verdict("MIGRATION_DRIFT", "Lệch migration (schema ↔ journal)", "ok", "schema ở head"),
    );
  }

  // ── Job nền thất bại (§18.3 "Audit write fail" / job) ───────────────────────────────────
  out.push(
    band(
      "JOB_FAILED",
      "Job nền thất bại",
      s.jobFailed,
      th.jobFailedWarn,
      th.jobFailedCrit,
      "không truy vấn được system_job_runs",
      (n) => `${n} lần chạy Failed trong cửa sổ`,
    ),
  );

  // ── 5xx / lỗi ứng dụng (§18.3 "API 5xx spike") ─────────────────────────────────────────
  out.push(
    band(
      "ERROR_SPIKE",
      "Lỗi ứng dụng trong log",
      s.errorLines,
      th.errorLogWarn,
      th.errorLogCrit,
      "không đọc được log API",
      (n) => `${n} dòng lỗi trong cửa sổ`,
    ),
  );

  // ── Đĩa (§18.3 hạ tầng) — NGƯỢC CHIỀU: càng nhỏ càng nặng ──────────────────────────────
  out.push(
    bandDesc(
      "DISK_FREE",
      "Dung lượng trống",
      s.diskFreeGb,
      th.diskFreeWarnGb,
      th.diskFreeCritGb,
      "không đọc được dung lượng ổ",
      (n) => `còn ${n} GB`,
    ),
  );

  // ── Tuổi backup (§18.3 backup-fail) ────────────────────────────────────────────────────
  out.push(
    band(
      "BACKUP_AGE",
      "Tuổi bản backup mới nhất",
      s.backupAgeHours,
      th.backupAgeWarnH,
      th.backupAgeCritH,
      "không thấy thư mục/bản backup nào",
      (n) => `${n} giờ kể từ bản gần nhất`,
    ),
  );

  // ── Hạn chứng chỉ TLS (§18.3 SSL) — NGƯỢC CHIỀU ────────────────────────────────────────
  out.push(
    bandDesc(
      "CERT_EXPIRY",
      "Hạn chứng chỉ TLS",
      s.certExpiryDays,
      th.certExpiryWarnDays,
      th.certExpiryCritDays,
      "không đọc được chứng chỉ",
      (n) => `còn ${n} ngày`,
    ),
  );

  // ── Trang PROD ngoài API — fbpost :3500 · LMS :3400 (sự cố 11–12/08, xem đầu file) ──────
  if (!Array.isArray(s.sites) || s.sites.length === 0) {
    out.push(
      missing(
        "SITE_PROBES",
        "Trang PROD ngoài API",
        "danh sách trang dò RỖNG — mù mà im lặng chính là lỗi đang vá",
      ),
    );
  } else {
    for (const site of s.sites) out.push(evaluateSite(site));
  }

  // ── Bản build Next đang được phục vụ ───────────────────────────────────────────────────
  out.push(evaluateNextBuilds(s.nextBuilds));

  // ── Docker watchdog (S19-OPS-PRODDBBOOT-1) ─────────────────────────────────────────────
  out.push(evaluateDockerWatchdog(s.dockerWatchdog));

  return out;
}

/**
 * Mã lỗi mạng có nghĩa "KHÔNG AI TRẢ LỜI".
 *
 * Đây là chỗ dễ nhầm: một kết nối bị từ chối KHÔNG phải "thiếu dữ liệu" — nó là một PHÉP ĐO đã
 * hoàn thành, và kết quả là dịch vụ không có ở đó. Hạ nó xuống `unknown` sẽ biến "trang chết" thành
 * cùng một mức với "hôm nay không chạy được phép đo", tức là đúng cái nhầm lẫn mà cả file này chống.
 * Mã lạ ngoài danh sách thì mới là `unknown` — không đoán bừa.
 */
const NO_ANSWER = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_SOCKET",
  "timeout",
]);

/**
 * Phán một trang PROD từ hành vi HTTP thật.
 *
 * @param {{id:string,title?:string,url?:string,status?:number|null,bodyOk?:boolean|null,
 *          transport?:string,location?:string|null,expectRedirect?:string}} site
 */
function evaluateSite(site) {
  const id = `SITE_${site.id}`;
  const title = site.title ?? site.id;
  const where = site.url ? ` — ${site.url}` : "";

  if (typeof site.status === "number") {
    if (site.status >= 500) {
      return verdict(id, title, "crit", `HTTP ${site.status}${where} — trang chết`);
    }
    if (site.status >= 200 && site.status < 300) {
      // 200 vẫn có thể là trang trắng / bản dựng sai. Dấu nhận dạng là lớp chắn thứ hai; không
      // khai `expect` thì `bodyOk` = null và ta KHÔNG phạt (đo được tới đâu phán tới đó).
      if (site.bodyOk === false) {
        const mark = site.expect ? ` "${site.expect}"` : "";
        return verdict(
          id,
          title,
          "warn",
          `HTTP ${site.status} nhưng thân trang thiếu dấu nhận dạng${mark}${where}`,
        );
      }
      return verdict(
        id,
        title,
        "ok",
        `HTTP ${site.status}${site.bodyOk === true ? " + dấu nhận dạng khớp" : ""}`,
      );
    }
    // 3xx ĐÚNG CHỖ đã khai (`expectRedirect`, vd LMS → SSO app chính) là sống. Mọi 3xx khác giữ
    // nguyên warn bên dưới.
    if (site.status >= 300 && site.status < 400 && site.expectRedirect !== undefined) {
      if (redirectMatches(site.location, site.expectRedirect)) {
        return verdict(
          id,
          title,
          "ok",
          // In cả origin của Location (không query): miền KHÔNG bị ghim (PROD ≠ dev-online), nên người
          // đọc log phải tự thấy được trang đang đẩy về host nào.
          `HTTP ${site.status} → ${describeLocation(site.location)} (chuyển hướng đúng như khai …${normalizeRedirectPath(site.expectRedirect)})`,
        );
      }
      return verdict(
        id,
        title,
        "warn",
        `HTTP ${site.status}${where} — ${describeLocation(site.location)}, không về …${normalizeRedirectPath(String(site.expectRedirect))} như khai`,
      );
    }
    // 3xx/4xx: KHÔNG dò bằng redirect tự động, nên 307 nghĩa là đường dò công khai đã bị đóng lại
    // (đúng thứ đã xảy ra với 2 trang chính sách Meta ngày 12/08) — tín hiệu thật, phải kêu.
    return verdict(id, title, "warn", `HTTP ${site.status}${where} — không phải 2xx`);
  }

  const transport = site.transport;
  if (typeof transport === "string" && NO_ANSWER.has(transport)) {
    return verdict(
      id,
      title,
      "crit",
      `không ai trả lời (${transport})${where} — dịch vụ dừng/treo`,
    );
  }
  return missing(id, title, `không dò được${where}${transport ? ` — ${transport}` : ""}`);
}

/**
 * Phán bản build Next đang nằm trong `.next` của từng app.
 *
 * `dev` THẮNG `missing`: đã có bằng chứng hỏng thì không được hạ xuống "không rõ".
 *
 * @param {Array<{id:string,dir:string,mode:'prod'|'dev'|'missing'}>|null|undefined} builds
 */
function evaluateNextBuilds(builds) {
  const ID = "NEXT_DEV_BUILD";
  const TITLE = "Bản build Next đang phục vụ";
  if (!Array.isArray(builds) || builds.length === 0) {
    return missing(ID, TITLE, "không đọc được thư mục .next nào");
  }
  const dev = builds.filter((b) => b.mode === "dev");
  if (dev.length > 0) {
    return verdict(
      ID,
      TITLE,
      "crit",
      `bundle DEV đang được next start phục vụ: ${dev.map((b) => b.dir ?? b.id).join(", ")} — ` +
        "edge runtime sẽ ném EvalError ⇒ 500 MỌI request. Chạy lại `next build` rồi restart service",
    );
  }
  const blind = builds.filter((b) => b.mode !== "prod");
  if (blind.length > 0) {
    return missing(
      ID,
      TITLE,
      `không đọc được bản build: ${blind.map((b) => b.dir ?? b.id).join(", ")}`,
    );
  }
  return verdict(ID, TITLE, "ok", `${builds.length} app đều chạy bundle PROD`);
}

/** Dòng log của scripts/windows/docker-watchdog.ps1: `<ISO có offset> [LEVEL] <thông điệp>`. */
const WATCHDOG_LINE_RE = /^(\S+) \[([A-Z]+)\] (.*)$/;
const WATCHDOG_DETAIL_MAX = 160;

/**
 * Tóm tắt docker-watchdog.log trong cửa sổ `windowMin` phút: đếm [WARN] / [ERROR] / [ACTION] và giữ
 * dòng có vấn đề mới nhất. Watchdog chỉ ghi file — thiếu luật này thì watchdog HỎNG (không bật được
 * Docker, engine kẹt, cờ tạm dừng bị quên) không tới được ai.
 *
 * @returns {{present:true, warn:number, error:number, actions:number, last:string|null}}
 */
export function summarizeWatchdogLog(text, { nowMs = Date.now(), windowMin = 60 } = {}) {
  const since = nowMs - windowMin * 60_000;
  let warn = 0;
  let error = 0;
  let actions = 0;
  let last = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    // PowerShell 5.1 `Add-Content -Encoding UTF8` mở đầu file bằng BOM.
    const m = WATCHDOG_LINE_RE.exec(raw.replace(/^\uFEFF/, "").trim());
    if (!m) continue;
    const at = Date.parse(m[1]);
    if (Number.isNaN(at) || at < since) continue;
    if (m[2] === "ACTION") actions += 1;
    if (m[2] !== "WARN" && m[2] !== "ERROR") continue;
    if (m[2] === "ERROR") error += 1;
    else warn += 1;
    last = `[${m[2]}] ${m[3]}`.slice(0, WATCHDOG_DETAIL_MAX);
  }
  return { present: true, warn, error, actions, last };
}

/**
 * Phán docker-watchdog.log. Chưa có file ⇒ ok: watchdog CHỈ ghi khi phải ra tay, nên máy khoẻ không
 * có log là bình thường. Đọc lỗi khác ⇒ unknown (luật nền).
 *
 * @param {{present:boolean, warn?:number, error?:number, actions?:number, last?:string|null}|null|undefined} w
 */
function evaluateDockerWatchdog(w) {
  const ID = "DOCKER_WATCHDOG";
  const TITLE = "Docker watchdog";
  if (w === null || w === undefined || typeof w !== "object") {
    return missing(ID, TITLE, "không đọc được docker-watchdog.log");
  }
  if (w.present === false) {
    return verdict(ID, TITLE, "ok", "chưa có log — watchdog chưa phải ra tay");
  }
  if (![w.warn, w.error].every((n) => Number.isInteger(n) && n >= 0)) {
    return missing(ID, TITLE, "tóm tắt docker-watchdog.log hỏng");
  }
  const latest = w.last ? `; mới nhất: ${w.last}` : "";
  if (w.error > 0) {
    return verdict(
      ID,
      TITLE,
      "crit",
      `${w.error} dòng ERROR trong cửa sổ — watchdog không bật được Docker Desktop hoặc script lỗi${latest}`,
    );
  }
  if (w.warn > 0) {
    return verdict(
      ID,
      TITLE,
      "warn",
      `${w.warn} dòng WARN trong cửa sổ — engine kẹt hoặc cờ tạm dừng quá hạn${latest}`,
    );
  }
  const acted = w.actions > 0 ? ` (đã tự bật Docker Desktop ${w.actions} lần)` : "";
  return verdict(ID, TITLE, "ok", `không có WARN/ERROR trong cửa sổ${acted}`);
}

/** Luật "càng LỚN càng nặng" (job failed · error lines · backup age). */
function band(id, title, value, warnAt, critAt, missingWhat, fmt) {
  if (value === null || value === undefined || Number.isNaN(value))
    return missing(id, title, missingWhat);
  if (value >= critAt) return verdict(id, title, "crit", fmt(value));
  if (value >= warnAt) return verdict(id, title, "warn", fmt(value));
  return verdict(id, title, "ok", fmt(value));
}

/** Luật "càng NHỎ càng nặng" (đĩa trống · số ngày còn lại của cert). */
function bandDesc(id, title, value, warnBelow, critBelow, missingWhat, fmt) {
  if (value === null || value === undefined || Number.isNaN(value))
    return missing(id, title, missingWhat);
  if (value <= critBelow) return verdict(id, title, "crit", fmt(value));
  if (value <= warnBelow) return verdict(id, title, "warn", fmt(value));
  return verdict(id, title, "ok", fmt(value));
}

/** Exit code cho lệnh: 0 tất cả ok · 1 có warn hoặc unknown · 2 có crit. */
export function exitCodeFor(severity) {
  if (severity === "crit") return 2;
  if (severity === "warn" || severity === "unknown") return 1;
  return 0;
}
