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

  return out;
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
