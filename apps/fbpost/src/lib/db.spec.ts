import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Chung minh migration ma hoa lam dung viec cua no tren mot CSDL THAT.
 *
 * Ca test quan trong nhat: gieo mot CSDL kieu CU (token nam tho, dung nhu `C:\fbpost\data` hien
 * gio), mo bang `getDb()`, roi doc lai bang mot ket noi SQLite ĐỘC LẬP — dung con duong ma ke
 * lay cap file CSDL se dung. Neu con doc ra token thi bai test do.
 *
 * Moi ca test chay tren mot thu muc rieng (`SOCIAL_DATA_DIR`) va mot KEK rieng, va phai
 * `resetModules()` vi ca `paths.ts` (duong dan) lan `db.ts` (bien `instance`) deu giu trang thai
 * o cap module.
 */

// Khong viet literal giong-secret (rule gitleaks generic-api-key). Ghep chuoi CHUA DU khi con
// mot manh entropy cao — dung chuoi don lap co chu "example". Xem session.spec.ts.
const PLAIN_APP_SECRET = "example-app-secret-".padEnd(40, "x");
const PLAIN_USER_TOKEN = ["EAAG", "fake", "user", "token", "0123456789"].join("-");
const PLAIN_PAGE_TOKEN = ["EAAG", "fake", "page", "token", "9876543210"].join("-");

let dataDir: string;

function seedLegacyDb(): string {
  const dbPath = join(dataDir, "fbpost.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, fb_user_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      app_id TEXT NOT NULL, app_secret TEXT NOT NULL, user_token TEXT NOT NULL,
      token_expires_at INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER NOT NULL DEFAULT 0,
      page_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, access_token TEXT NOT NULL,
      can_post INTEGER NOT NULL DEFAULT 1, is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(
    `INSERT INTO accounts (fb_user_id, name, app_id, app_secret, user_token, created_at, updated_at)
     VALUES ('fb-1', 'Tai khoan test', 'app-1', ?, ?, 0, 0)`,
  ).run(PLAIN_APP_SECRET, PLAIN_USER_TOKEN);
  db.prepare(
    `INSERT INTO pages (account_id, page_id, name, access_token, created_at, updated_at)
     VALUES (1, 'page-1', 'Page test', ?, 0, 0)`,
  ).run(PLAIN_PAGE_TOKEN);
  db.prepare("INSERT INTO settings (key, value) VALUES ('appSecret', ?)").run(PLAIN_APP_SECRET);
  db.close();
  return dbPath;
}

/** Doc tho tu file CSDL — dung con duong ke lay cap file se dung, khong qua repository. */
function readRaw(dbPath: string): { appSecret: string; userToken: string; pageToken: string } {
  const db = new DatabaseSync(dbPath);
  const account = db
    .prepare("SELECT app_secret, user_token FROM accounts WHERE fb_user_id = 'fb-1'")
    .get() as {
    app_secret: string;
    user_token: string;
  };
  const page = db.prepare("SELECT access_token FROM pages WHERE page_id = 'page-1'").get() as {
    access_token: string;
  };
  db.close();
  return {
    appSecret: account.app_secret,
    userToken: account.user_token,
    pageToken: page.access_token,
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "fbpost-db-"));
  writeFileSync(join(dataDir, "kek.bin"), randomBytes(32));
  process.env.SOCIAL_DATA_DIR = dataDir;
  process.env.SOCIAL_KEK_PATH = join(dataDir, "kek.bin");
  vi.resetModules();
});

afterEach(() => {
  delete process.env.SOCIAL_DATA_DIR;
  delete process.env.SOCIAL_KEK_PATH;
  vi.resetModules();
});

describe("migration ma hoa khi mo CSDL", () => {
  it("CSDL cu co token THO: sau khi mo, doc tho KHONG con thay token nao", async () => {
    const dbPath = seedLegacyDb();

    // Doi chung TRUOC khi va — chung minh bai test that su do duoc su khac biet.
    const before = readRaw(dbPath);
    expect(before.userToken).toBe(PLAIN_USER_TOKEN);
    expect(before.pageToken).toBe(PLAIN_PAGE_TOKEN);

    const { getDb } = await import("./db");
    getDb();

    const after = readRaw(dbPath);
    expect(after.appSecret).not.toBe(PLAIN_APP_SECRET);
    expect(after.userToken).not.toBe(PLAIN_USER_TOKEN);
    expect(after.pageToken).not.toBe(PLAIN_PAGE_TOKEN);
    expect(after.userToken.startsWith("v1.")).toBe(true);
    expect(after.pageToken.startsWith("v1.")).toBe(true);
  });

  it("repository van doc ra dung token sau khi ma hoa", async () => {
    seedLegacyDb();
    const { listAccounts } = await import("./repo/account-repo");
    const { listPages } = await import("./repo/page-repo");

    const account = listAccounts()[0];
    expect(account.appSecret).toBe(PLAIN_APP_SECRET);
    expect(account.userToken).toBe(PLAIN_USER_TOKEN);
    expect(listPages()[0].accessToken).toBe(PLAIN_PAGE_TOKEN);
  });

  it("token KHONG di ra ngoai qua ban ghi cong khai", async () => {
    seedLegacyDb();
    const { listAccounts, toPublicAccount } = await import("./repo/account-repo");
    const { listPages, toPublic } = await import("./repo/page-repo");

    const publicAccount = JSON.stringify(toPublicAccount(listAccounts()[0]));
    const publicPage = JSON.stringify(toPublic(listPages()[0]));

    for (const secret of [PLAIN_APP_SECRET, PLAIN_USER_TOKEN, PLAIN_PAGE_TOKEN]) {
      expect(publicAccount).not.toContain(secret);
      expect(publicPage).not.toContain(secret);
    }
  });

  it("mo lai CSDL DA ma hoa khong lam hong gi (chay duoc nhieu lan)", async () => {
    const dbPath = seedLegacyDb();

    const first = await import("./db");
    first.getDb();
    const afterFirst = readRaw(dbPath);

    // Lan mo thu hai: module nap lai tu dau, dung nhu tien trinh khoi dong lai.
    vi.resetModules();
    const second = await import("./db");
    second.getDb();
    const afterSecond = readRaw(dbPath);

    // Khong ma hoa chong len nhau — gia tri giu nguyen.
    expect(afterSecond).toEqual(afterFirst);

    const { listAccounts } = await import("./repo/account-repo");
    expect(listAccounts()[0].userToken).toBe(PLAIN_USER_TOKEN);
  });

  it("thieu KEK thi mo CSDL THAT BAI — khong khoi dong im lang voi token tho", async () => {
    seedLegacyDb();
    process.env.SOCIAL_KEK_PATH = join(dataDir, "khong-co-file-nay.bin");
    vi.resetModules();

    const { getDb } = await import("./db");
    expect(() => getDb()).toThrow(/khong doc duoc file KEK/);
  });
});
