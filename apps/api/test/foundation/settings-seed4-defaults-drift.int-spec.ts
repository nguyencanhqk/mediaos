/**
 * S2-FND-SEED-4 (🟢 seed4-defaults) — 3-source drift guard cho company-default fallback tier.
 *
 * MỤC TIÊU: SETTING_DEFAULTS (tầng cuối precedence — BACKEND-11 §13.3) phải PHỦ 11 company-default key
 * (DB-10 §11.2, KHÔNG gồm notification.in_app_enabled — key này system-scope THẮNG, mig 0470). KHÔNG
 * migration company-scoped (bài học 0445:14-18 — per-company seed = drift). Đồng bộ 3 NGUỒN:
 *   (1) migration-seed system_settings  — mig 0435 (5 key) + 0470 (10 key) = 14 canonical §11.1 + DÔI.
 *   (2) SETTING_DEFAULTS                 — fallback hard-coded (src/foundation/settings/setting-defaults.ts).
 *   (3) DB-10 §11.1 (system) + §11.2 (company) — NGUỒN SỰ THẬT.
 * Fail nếu THIẾU/THỪA key ngoài danh mục đã CHỐT (DÔI file.allowed_mime_types + hr.contract_expiring_warning_days).
 *
 * PURE (KHÔNG cần Postgres) → chạy trong MỌI run (KHÔNG gate LANE_DB). Đọc file migration THẬT (fs) để
 * cross-check migration-seed KHÔNG lệch SQL↔declared. Đây là driver RED của WO: trước khi mở rộng
 * SETTING_DEFAULTS, 11 company-default key VẮNG ⇒ suite "SETTING_DEFAULTS covers §11.2" ĐỎ.
 *
 * QA-06 (security): SETTING_DEFAULTS TUYỆT ĐỐI KHÔNG SecretRef / secret-like value (BẤT BIẾN #3).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SETTING_DEFAULTS } from "../../src/foundation/settings/setting-defaults";

// tsconfig module=commonjs → dùng __dirname (như force-before-backfill-order.int-spec) thay vì import.meta.
// __dirname = apps/api/test/foundation → lùi 2 cấp tới apps/api, rồi vào migrations.
const MIGRATIONS_DIR = join(__dirname, "..", "..", "migrations");

// ── NGUỒN SỰ THẬT: DB-10 §11.1 (14 system canonical) ──────────────────────────────────────────
const DB10_SYSTEM_KEYS = [
  "system.default_timezone",
  "system.default_locale",
  "system.default_currency",
  "security.password_min_length",
  "security.password_require_uppercase",
  "security.password_require_number",
  "security.session_ttl_minutes",
  "security.refresh_token_ttl_days",
  "file.max_upload_size_mb",
  "file.default_visibility",
  "audit.default_retention_days",
  "notification.in_app_enabled",
  "notification.email_enabled",
  "dashboard.cache_default_ttl_seconds",
] as const;

// ── NGUỒN SỰ THẬT: DB-10 §11.2 (12 company default) — value/valueType/moduleCode ──────────────
// notification.in_app_enabled Ở §11.2 NHƯNG system-scope thắng (mig 0470) ⇒ KHÔNG có trong SETTING_DEFAULTS.
interface CompanyDefaultSpec {
  key: string;
  value: unknown;
  valueType: string;
  moduleCode: string;
}
const DB10_COMPANY_DEFAULTS: readonly CompanyDefaultSpec[] = [
  { key: "company.timezone", value: "Asia/Ho_Chi_Minh", valueType: "String", moduleCode: "SYSTEM" },
  { key: "company.locale", value: "vi-VN", valueType: "String", moduleCode: "SYSTEM" },
  { key: "company.currency", value: "VND", valueType: "String", moduleCode: "SYSTEM" },
  {
    key: "attendance.default_shift_code",
    value: "OFFICE_8H",
    valueType: "String",
    moduleCode: "ATT",
  },
  { key: "attendance.allow_web_checkin", value: true, valueType: "Boolean", moduleCode: "ATT" },
  { key: "attendance.allow_mobile_checkin", value: true, valueType: "Boolean", moduleCode: "ATT" },
  {
    key: "attendance.block_checkin_when_leave_approved",
    value: true,
    valueType: "Boolean",
    moduleCode: "ATT",
  },
  { key: "leave.allow_negative_balance", value: false, valueType: "Boolean", moduleCode: "LEAVE" },
  { key: "leave.default_annual_leave_days", value: 12, valueType: "Number", moduleCode: "LEAVE" },
  { key: "task.allow_personal_task", value: true, valueType: "Boolean", moduleCode: "TASK" },
  // notification.in_app_enabled → system-scope (mig 0470) → KHÔNG default (owner-note 1).
  { key: "notification.in_app_enabled", value: true, valueType: "Boolean", moduleCode: "NOTI" },
  { key: "dashboard.cache_enabled", value: true, valueType: "Boolean", moduleCode: "DASH" },
];

/** §11.2 key mà SETTING_DEFAULTS PHẢI phủ (fallback tier). = §11.2 \ {notification.in_app_enabled}. */
const COMPANY_DEFAULT_KEYS_IN_DEFAULTS = DB10_COMPANY_DEFAULTS.filter(
  (d) => d.key !== "notification.in_app_enabled",
).map((d) => d.key);

/** §11.2 key CỐ Ý KHÔNG có trong SETTING_DEFAULTS (system-scope thắng — fallback unreachable). */
const COMPANY_DEFAULT_KEYS_SYSTEM_WINS = ["notification.in_app_enabled"];

/**
 * KEY DÔI đã CHỐT (ngoài 14-key canonical §11.1 / 12-key §11.2) — được phép tồn tại trong SETTING_DEFAULTS
 * và/hoặc migration-seed mà KHÔNG tính là drift:
 *   • file.allowed_mime_types           — seed 0435, DB-10 §11.1 CHỐT "DÔI, giữ, KHÔNG xoá".
 *   • hr.contract_expiring_warning_days — S2-HR-BE-6 company-configurable fallback (không thuộc §11 seed).
 *   • file.blocked_extensions           — S2-FND-FILE-2 code-default-ONLY (fallback tier, KHÔNG migration
 *     seed): blocklist extension nguy hiểm cho register-upload; company override qua company_settings.
 */
const AGREED_EXTRA_DEFAULT_KEYS = [
  "file.allowed_mime_types",
  "hr.contract_expiring_warning_days",
  "file.blocked_extensions",
];
const AGREED_EXTRA_MIGRATION_KEYS = ["file.allowed_mime_types"];

/** Tập key system_settings mà migration THẬT seed (0435 5 key + 0470 10 key) = 14 canonical + DÔI. */
const MIGRATION_SEED_SYSTEM_KEYS = [...DB10_SYSTEM_KEYS, ...AGREED_EXTRA_MIGRATION_KEYS];

// ── Đọc migration THẬT: trích setting_key từ mọi file có `INSERT INTO system_settings` ────────────
function extractMigrationSystemKeys(): Set<string> {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql"));
  const keys = new Set<string>();
  const MARKER = "INSERT INTO system_settings";
  for (const f of files) {
    const raw = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    if (!raw.includes(MARKER)) continue;
    // Bỏ dòng comment (down-migration / mô tả) để không nhặt key trong ghi chú.
    const sql = raw
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    // CHỈ trích trong block `INSERT INTO system_settings ... ;` (KHÔNG lấy `set_config('app.current_company_id'
    // …)` của RLS policy hay DO-block assertion — chúng ở statement KHÁC). setting_value literal ('"VND"',
    // MIME array…) chứa ngoặc kép / '[' / '/' / chữ HOA ⇒ KHÔNG khớp; chỉ setting_key thuần chữ-thường + dấu chấm.
    let idx = sql.indexOf(MARKER);
    while (idx !== -1) {
      const end = statementEnd(sql, idx);
      const block = sql.slice(idx, end);
      const re = /'([a-z][a-z0-9_.]*)'/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(block)) !== null) {
        if (m[1].includes(".")) keys.add(m[1]);
      }
      idx = sql.indexOf(MARKER, end + 1);
    }
  }
  return keys;
}

/** Vị trí `;` KẾT statement (bỏ qua `;` NẰM TRONG chuỗi '...' — vd description "UTC-at-rest; hiển thị"). */
function statementEnd(sql: string, start: number): number {
  let inStr = false;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") inStr = !inStr;
    else if (ch === ";" && !inStr) return i;
  }
  return sql.length;
}

const asSet = (arr: readonly string[]) => new Set(arr);
const sortedMissing = (want: readonly string[], have: Set<string>) =>
  want.filter((k) => !have.has(k)).sort();
const sortedExtra = (have: Iterable<string>, want: readonly string[]) =>
  [...have].filter((k) => !want.includes(k)).sort();

describe("S2-FND-SEED-4 drift — migration-seed system_settings ↔ DB-10 §11.1", () => {
  const migKeys = extractMigrationSystemKeys();

  it("migration THẬT (0435+0470) seed ĐÚNG 14 canonical §11.1 + DÔI file.allowed_mime_types (không thiếu)", () => {
    expect(sortedMissing(MIGRATION_SEED_SYSTEM_KEYS, migKeys)).toEqual([]);
  });

  it("migration KHÔNG seed system key THỪA ngoài danh mục CHỐT (declared == extracted)", () => {
    expect(sortedExtra(migKeys, MIGRATION_SEED_SYSTEM_KEYS)).toEqual([]);
  });

  it("14 canonical §11.1 KHÔNG trùng lặp key", () => {
    expect(new Set(DB10_SYSTEM_KEYS).size).toBe(DB10_SYSTEM_KEYS.length);
    expect(DB10_SYSTEM_KEYS.length).toBe(14);
  });
});

describe("S2-FND-SEED-4 drift — SETTING_DEFAULTS phủ 11 company-default §11.2 (fallback tier)", () => {
  const defaultKeys = asSet(Object.keys(SETTING_DEFAULTS));

  it("SETTING_DEFAULTS phủ ĐỦ 11 company-default key (§11.2 \\ notification.in_app_enabled)", () => {
    // DRIVER RED: trước khi mở rộng setting-defaults.ts → 11 key VẮNG → mảng missing != [].
    expect(sortedMissing(COMPANY_DEFAULT_KEYS_IN_DEFAULTS, defaultKeys)).toEqual([]);
    expect(COMPANY_DEFAULT_KEYS_IN_DEFAULTS).toHaveLength(11);
  });

  it("mỗi company-default key khớp value/valueType/moduleCode theo DB-10 §11.2", () => {
    for (const spec of DB10_COMPANY_DEFAULTS) {
      if (spec.key === "notification.in_app_enabled") continue; // system-scope, không default
      const d = SETTING_DEFAULTS[spec.key];
      expect(d, `thiếu default cho ${spec.key}`).toBeDefined();
      expect(d.value, `${spec.key}.value`).toEqual(spec.value);
      expect(d.valueType, `${spec.key}.valueType`).toBe(spec.valueType);
      expect(d.moduleCode, `${spec.key}.moduleCode`).toBe(spec.moduleCode);
    }
  });

  it("notification.in_app_enabled (§11.2) CỐ Ý KHÔNG có trong SETTING_DEFAULTS — system-scope thắng (unreachable)", () => {
    for (const k of COMPANY_DEFAULT_KEYS_SYSTEM_WINS) {
      expect(defaultKeys.has(k), `${k} phải KHÔNG có default (mig 0470 luôn seed system)`).toBe(
        false,
      );
    }
    // §11.2 key THIẾU trong SETTING_DEFAULTS phải ĐÚNG BẰNG danh mục system-wins (không thiếu ngoài ý muốn).
    const missingFrom112 = DB10_COMPANY_DEFAULTS.map((d) => d.key).filter(
      (k) => !defaultKeys.has(k),
    );
    expect(missingFrom112.sort()).toEqual([...COMPANY_DEFAULT_KEYS_SYSTEM_WINS].sort());
  });

  it("SETTING_DEFAULTS KHÔNG chứa key lạ (⊆ §11.1 ∪ §11.2 ∪ DÔI đã CHỐT)", () => {
    const allowed = new Set<string>([
      ...DB10_SYSTEM_KEYS,
      ...DB10_COMPANY_DEFAULTS.map((d) => d.key),
      ...AGREED_EXTRA_DEFAULT_KEYS,
    ]);
    const stray = [...defaultKeys].filter((k) => !allowed.has(k)).sort();
    expect(stray).toEqual([]);
  });
});

describe("S2-FND-SEED-4 security — SETTING_DEFAULTS KHÔNG secret plaintext (BẤT BIẾN #3)", () => {
  it("KHÔNG entry nào valueType='SecretRef'", () => {
    for (const [key, d] of Object.entries(SETTING_DEFAULTS)) {
      expect(d.valueType, `${key} không được là SecretRef ở tầng fallback`).not.toBe("SecretRef");
    }
  });

  it("KHÔNG entry nào lộ secret-like value / con trỏ secret manager", () => {
    const SECRET_RX = /secret|password|token|vault:\/\/|api[_-]?key|private[_-]?key/i;
    for (const [key, d] of Object.entries(SETTING_DEFAULTS)) {
      const serialized = JSON.stringify(d.value);
      expect(SECRET_RX.test(serialized), `${key} value nghi secret: ${serialized}`).toBe(false);
      // Interface SettingDefault KHÔNG có field secret_ref/secretRef — chốt bằng shape.
      expect(Object.prototype.hasOwnProperty.call(d, "secretRef")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(d, "secret_ref")).toBe(false);
    }
  });
});
