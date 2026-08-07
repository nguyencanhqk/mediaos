import { DatabaseSync } from "node:sqlite";
import { isSealed, sealSecret } from "./crypto/secret-box";
import { DB_PATH, ensureDataDirs } from "./paths";
import { SECRET_SETTING_KEYS, settingSecretAt } from "./repo/settings-repo";

/**
 * Ket noi SQLite dung `node:sqlite` co san trong Node 22+.
 * Chon module built-in thay vi better-sqlite3 de khong phai bien dich
 * native module tren may Windows (khong can Visual Studio Build Tools).
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  filename      TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  kind          TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  fb_user_id       TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  app_id           TEXT NOT NULL,
  app_secret       TEXT NOT NULL,
  user_token       TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL DEFAULT 0,
  page_id      TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  access_token TEXT NOT NULL,
  can_post     INTEGER NOT NULL DEFAULT 1,
  is_active    INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS contents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT,
  type       TEXT NOT NULL,
  message    TEXT NOT NULL DEFAULT '',
  link       TEXT,
  title      TEXT,
  media_ids  TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  config      TEXT NOT NULL,
  total_posts INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS posts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  page_ref      INTEGER NOT NULL DEFAULT 0,
  page_name     TEXT NOT NULL DEFAULT '',
  content_id    INTEGER,
  plan_id       INTEGER,
  batch_id      TEXT,
  type          TEXT NOT NULL,
  message       TEXT NOT NULL DEFAULT '',
  link          TEXT,
  title         TEXT,
  media_ids     TEXT NOT NULL DEFAULT '[]',
  scheduled_at  INTEGER,
  schedule_mode TEXT NOT NULL DEFAULT 'now',
  status        TEXT NOT NULL DEFAULT 'draft',
  fb_post_id    TEXT,
  fb_permalink  TEXT,
  error         TEXT,
  attempts      INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- S9-SOCIAL-BE-1: cac jti cua token SSO DA dung. Chan phat lai (replay) va chan chia se link:
-- token SSO song 60 giay VA chi dung duoc DUNG MOT LAN. PRIMARY KEY chinh la co che — lan chen
-- thu hai cho cung mot jti se vo rang buoc, va do la ket qua mong muon.
CREATE TABLE IF NOT EXISTS sso_consumed_tokens (
  jti         TEXT PRIMARY KEY,
  consumed_at INTEGER NOT NULL
);

`;

/**
 * Chi so tao sau khi migrate xong.
 *
 * Tach khoi SCHEMA vi CSDL cu chua co cac cot page_ref/plan_id: tao chi so
 * trong cung mot khoi voi CREATE TABLE se lam ca khoi do vo truoc khi
 * ALTER TABLE kip chay.
 */
const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts (status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_at ON posts (scheduled_at);
CREATE INDEX IF NOT EXISTS idx_posts_page_ref ON posts (page_ref);
CREATE INDEX IF NOT EXISTS idx_posts_plan_id ON posts (plan_id);
CREATE INDEX IF NOT EXISTS idx_pages_account_id ON pages (account_id);
`;

/**
 * Cac cot them vao bang `posts` o phien ban ho tro nhieu Page.
 * CSDL tao tu phien ban cu khong co nhung cot nay nen phai bo sung
 * bang ALTER TABLE, khong the chi dua vao CREATE TABLE IF NOT EXISTS.
 */
const POST_COLUMN_PATCHES: { name: string; ddl: string }[] = [
  { name: "page_ref", ddl: "ALTER TABLE posts ADD COLUMN page_ref INTEGER NOT NULL DEFAULT 0" },
  { name: "page_name", ddl: "ALTER TABLE posts ADD COLUMN page_name TEXT NOT NULL DEFAULT ''" },
  { name: "content_id", ddl: "ALTER TABLE posts ADD COLUMN content_id INTEGER" },
  { name: "plan_id", ddl: "ALTER TABLE posts ADD COLUMN plan_id INTEGER" },
  { name: "batch_id", ddl: "ALTER TABLE posts ADD COLUMN batch_id TEXT" },
];

/**
 * Tien to dat cho tai khoan duoc dung tu cau hinh cu, khi chua biet
 * Facebook user id. Lan ket noi sau se thay bang id that.
 */
export const LEGACY_ACCOUNT_PREFIX = "legacy-";

function columnsOf(db: DatabaseSync, table: string): Set<string> {
  return new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name),
  );
}

/**
 * Nang cap CSDL tu cac phien ban truoc:
 * 1. Bo sung cac cot moi cua bang `posts` va `pages`.
 * 2. Cau hinh mot tai khoan trong bang `settings` tro thanh dong dau tien
 *    cua bang `accounts`.
 * 3. Page duy nhat trong `settings` tro thanh dong dau tien cua bang `pages`,
 *    va moi bai cu duoc gan ve Page do.
 * 4. Cac Page da co nhung chua gan tai khoan duoc gan ve tai khoan tren.
 */
function migrate(db: DatabaseSync): void {
  const postColumns = columnsOf(db, "posts");
  for (const patch of POST_COLUMN_PATCHES) {
    if (!postColumns.has(patch.name)) db.exec(patch.ddl);
  }

  if (!columnsOf(db, "pages").has("account_id")) {
    db.exec("ALTER TABLE pages ADD COLUMN account_id INTEGER NOT NULL DEFAULT 0");
  }

  const settingRows = db.prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const stored = new Map(settingRows.map((r) => [r.key, r.value]));
  const ts = Math.floor(Date.now() / 1000);

  const accountCount = db.prepare("SELECT COUNT(*) AS total FROM accounts").get() as {
    total: number;
  };
  const appId = stored.get("appId");
  const appSecret = stored.get("appSecret");
  const userToken = stored.get("userAccessToken");

  let legacyAccountId = 0;
  // `!isSealed(...)`: chi chep sang bang `accounts` khi gia tri o `settings` con la ban ro.
  // Neu da bao mat roi thi ban ro do da tung duoc chep sang tu lan chay truoc; chep lai bay gio
  // se dua chuoi ma hoa duoi AAD cua `settings` vao cot cua `accounts` — nam sai o, khong bao gio
  // giai ma duoc. Ca nay xay ra khi nguoi dung xoa het tai khoan roi khoi dong lai.
  if (accountCount.total === 0 && appId && appSecret && userToken && !isSealed(appSecret)) {
    const inserted = db
      .prepare(
        `INSERT INTO accounts (fb_user_id, name, app_id, app_secret, user_token, token_expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        `${LEGACY_ACCOUNT_PREFIX}${appId}`,
        "Tài khoản đã kết nối",
        appId,
        appSecret,
        userToken,
        ts,
        ts,
      );
    legacyAccountId = Number(inserted.lastInsertRowid);
  }

  const pageCount = db.prepare("SELECT COUNT(*) AS total FROM pages").get() as { total: number };
  const pageId = stored.get("pageId");
  const pageToken = stored.get("pageAccessToken");

  if (pageCount.total === 0 && pageId && pageToken && !isSealed(pageToken)) {
    const pageName = stored.get("pageName") || pageId;
    const inserted = db
      .prepare(
        `INSERT INTO pages (account_id, page_id, name, access_token, can_post, is_active, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, 1, 0, ?, ?)`,
      )
      .run(legacyAccountId, pageId, pageName, pageToken, ts, ts);

    db.prepare("UPDATE posts SET page_ref = ?, page_name = ? WHERE page_ref = 0").run(
      inserted.lastInsertRowid,
      pageName,
    );
  }

  if (legacyAccountId > 0) {
    db.prepare("UPDATE pages SET account_id = ? WHERE account_id = 0").run(legacyAccountId);
  }
}

/**
 * Bao mat tai cho moi gia tri bi mat con nam duoi dang ban ro (BAT BIEN #3).
 *
 * PHAI chay SAU `migrate()`: `migrate()` doc `settings` o dang ban ro de dung ban ghi dau tien
 * cho `accounts`/`pages`. Dao thu tu thi no se chep chuoi da ma hoa sang bang khac — nam sai o,
 * giai ma khong bao gio ra.
 *
 * CHAY DUOC NHIEU LAN: bo qua moi gia tri da co tien to `v1.`, nen khoi dong lai bao nhieu lan
 * cung khong ma hoa chong len nhau.
 *
 * Chu y: ham nay im lang khi khong co gi de lam, nhung KHONG im lang khi that bai — thieu file
 * KEK thi `sealSecret` nem loi va app khong khoi dong duoc. Do la chu y: mot app khoi dong "binh
 * thuong" voi token nam tho la kieu hong te nhat o day.
 */
function sealPlaintextSecrets(db: DatabaseSync): void {
  const accounts = db.prepare("SELECT fb_user_id, app_secret, user_token FROM accounts").all() as {
    fb_user_id: string;
    app_secret: string;
    user_token: string;
  }[];
  const updateAccount = db.prepare(
    "UPDATE accounts SET app_secret = ?, user_token = ? WHERE fb_user_id = ?",
  );
  for (const row of accounts) {
    if (isSealed(row.app_secret) && isSealed(row.user_token)) continue;
    updateAccount.run(
      isSealed(row.app_secret)
        ? row.app_secret
        : sealSecret(row.app_secret, {
            table: "accounts",
            column: "app_secret",
            rowKey: row.fb_user_id,
          }),
      isSealed(row.user_token)
        ? row.user_token
        : sealSecret(row.user_token, {
            table: "accounts",
            column: "user_token",
            rowKey: row.fb_user_id,
          }),
      row.fb_user_id,
    );
  }

  const pages = db.prepare("SELECT page_id, access_token FROM pages").all() as {
    page_id: string;
    access_token: string;
  }[];
  const updatePage = db.prepare("UPDATE pages SET access_token = ? WHERE page_id = ?");
  for (const row of pages) {
    if (isSealed(row.access_token)) continue;
    updatePage.run(
      sealSecret(row.access_token, {
        table: "pages",
        column: "access_token",
        rowKey: row.page_id,
      }),
      row.page_id,
    );
  }

  const updateSetting = db.prepare("UPDATE settings SET value = ? WHERE key = ?");
  for (const key of SECRET_SETTING_KEYS) {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    if (!row || row.value === "" || isSealed(row.value)) continue;
    updateSetting.run(sealSecret(row.value, settingSecretAt(key)), key);
  }
}

let instance: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (instance) return instance;

  ensureDataDirs();
  const db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  sealPlaintextSecrets(db);
  db.exec(INDEXES);
  instance = db;
  return db;
}

/**
 * node:sqlite tra ve Record<string, SQLOutputValue>. Hai ham duoi ep ve
 * kieu hang cua bang - tap trung mot cho thay vi rai `as` khap repository.
 */
export function asRows<T>(values: unknown[]): T[] {
  return values as T[];
}

export function asRow<T>(value: unknown): T | undefined {
  return (value ?? undefined) as T | undefined;
}

/** SQLite tra ve rowid dang number|bigint tuy gia tri - chuan hoa ve number. */
export function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
