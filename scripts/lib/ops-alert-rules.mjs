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
 *          transport?:string}} site
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
