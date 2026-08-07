import { openSecret, sealSecret, type SecretLocation } from "../crypto/secret-box";
import { asRows, getDb } from "../db";
import type { AppSettings } from "../types";

/** Phien ban Graph API mac dinh. Doi o day khi Facebook phat hanh ban moi. */
export const DEFAULT_GRAPH_VERSION = "v26.0";

/**
 * Ba khoa trong bang `settings` mang gia tri BI MAT — phai ma hoa nhu cot token o bang khac.
 *
 * Day la di san cua phien ban mot-tai-khoan: `migrate()` trong db.ts da chep chung sang bang
 * `accounts`/`pages`, nhung ban goc VAN NAM LAI o day. Bo sot cho nay thi ma hoa hai bang kia
 * chang co y nghia gi — cung mot token, nam tho o bang thu ba.
 */
export const SECRET_SETTING_KEYS = ["appSecret", "userAccessToken", "pageAccessToken"] as const;

type SecretSettingKey = (typeof SECRET_SETTING_KEYS)[number];

function isSecretKey(key: string): key is SecretSettingKey {
  return (SECRET_SETTING_KEYS as readonly string[]).includes(key);
}

/** Danh tinh o luu — khoa dong chinh la ten khoa cau hinh (PRIMARY KEY cua bang). */
export function settingSecretAt(key: SecretSettingKey): SecretLocation {
  return { table: "settings", column: "value", rowKey: key };
}

const DEFAULTS: AppSettings = {
  appId: "",
  appSecret: "",
  loginConfigId: "",
  userAccessToken: "",
  pageId: "",
  pageName: "",
  pageAccessToken: "",
  graphVersion: DEFAULT_GRAPH_VERSION,
};

const KEYS = Object.keys(DEFAULTS) as (keyof AppSettings)[];

export function getSettings(): AppSettings {
  const rows = asRows<{ key: string; value: string }>(
    getDb().prepare("SELECT key, value FROM settings").all(),
  );

  const stored = new Map(rows.map((r) => [r.key, r.value]));
  const result = { ...DEFAULTS };
  for (const key of KEYS) {
    const value = stored.get(key);
    if (typeof value !== "string" || value === "") continue;
    result[key] = isSecretKey(key) ? openSecret(value, settingSecretAt(key)) : value;
  }
  return result;
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const key of KEYS) {
    const value = patch[key];
    if (value === undefined) continue;
    const raw = String(value);
    stmt.run(key, isSecretKey(key) ? sealSecret(raw, settingSecretAt(key)) : raw);
  }
  return getSettings();
}

/** Che bot token khi tra ve client - chi lo 6 ky tu cuoi de doi chieu. */
export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 6) return "••••••";
  return `••••••${value.slice(-6)}`;
}

/**
 * Da ket noi tai khoan Facebook hay chua.
 *
 * Day chi la dieu kien can. Dieu kien du de dang bai la co it nhat mot Page
 * dang bat trong bang `pages` - xem `listUsablePages` trong page-repo.
 */
export function isAccountConnected(settings: AppSettings): boolean {
  return Boolean(settings.appId && settings.appSecret && settings.userAccessToken);
}
