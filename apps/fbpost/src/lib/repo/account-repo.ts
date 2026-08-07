import { openSecret, sealSecret, type SecretLocation } from "../crypto/secret-box";
import { asRow, asRows, getDb, LEGACY_ACCOUNT_PREFIX, nowSeconds, toNumber } from "../db";
import type { Account, AccountWithSecrets } from "../types";
import { maskSecret } from "./settings-repo";

/**
 * Kho tai khoan Facebook.
 *
 * Nhieu tai khoan cung ton tai song song, moi tai khoan mang mot bo
 * App ID / App Secret / User Access Token rieng va mot nhom Page rieng.
 * Nho vay dung duoc ca hai cach: mot app dung chung cho moi tai khoan,
 * hoac moi tai khoan mot app rieng.
 */

interface AccountRow {
  id: number;
  fb_user_id: string;
  name: string;
  app_id: string;
  app_secret: string;
  user_token: string;
  token_expires_at: number;
  created_at: number;
  updated_at: number;
  page_count: number;
}

const SELECT = `
  SELECT a.*, (SELECT COUNT(*) FROM pages p WHERE p.account_id = a.id) AS page_count
  FROM accounts a
`;

/**
 * Danh tinh o luu bi mat cua mot tai khoan.
 *
 * Dung `fb_user_id` lam khoa dong chu KHONG dung `id`: `id` la AUTOINCREMENT nen luc INSERT ta
 * chua biet no, ma AAD thi phai giong het nhau giua luc ghi va luc doc. `fb_user_id` co UNIQUE
 * va da biet truoc khi ghi.
 *
 * ⚠️ `saveAccount` CO doi `fb_user_id` (tu ban ghi tam `legacy-*` sang id that). Cho do an toan
 * vi cung mot cau UPDATE ghi lai CA hai token bang khoa dong MOI — khong bao gio con token cu
 * nam duoi khoa dong da doi.
 */
function secretAt(fbUserId: string, column: "app_secret" | "user_token"): SecretLocation {
  return { table: "accounts", column, rowKey: fbUserId };
}

function mapRow(row: AccountRow): AccountWithSecrets {
  const appSecret = openSecret(row.app_secret, secretAt(row.fb_user_id, "app_secret"));
  const userToken = openSecret(row.user_token, secretAt(row.fb_user_id, "user_token"));
  return {
    id: row.id,
    fbUserId: row.fb_user_id,
    name: row.name,
    appId: row.app_id,
    appSecret,
    appSecretMasked: maskSecret(appSecret),
    userToken,
    userTokenMasked: maskSecret(userToken),
    tokenExpiresAt: row.token_expires_at,
    pageCount: toNumber(row.page_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Bo bi mat ra khoi ban ghi truoc khi tra ve cho giao dien. */
export function toPublicAccount(account: AccountWithSecrets): Account {
  const { appSecret: _secret, userToken: _token, ...rest } = account;
  void _secret;
  void _token;
  return rest;
}

export function listAccounts(): AccountWithSecrets[] {
  return asRows<AccountRow>(getDb().prepare(`${SELECT} ORDER BY a.id ASC`).all()).map(mapRow);
}

export function getAccount(id: number): AccountWithSecrets | null {
  const row = asRow<AccountRow>(getDb().prepare(`${SELECT} WHERE a.id = ?`).get(id));
  return row ? mapRow(row) : null;
}

export function countAccounts(): number {
  const row = asRow<{ total: number }>(
    getDb().prepare("SELECT COUNT(*) AS total FROM accounts").get(),
  );
  return toNumber(row?.total ?? 0);
}

export interface SaveAccountInput {
  fbUserId: string;
  name: string;
  appId: string;
  appSecret: string;
  userToken: string;
  tokenExpiresAt: number;
}

/**
 * Ghi mot tai khoan vua ket noi.
 *
 * Nhan dien theo Facebook user id. Neu chua co, van con mot kha nang:
 * ban ghi tam sinh ra khi nang cap tu phien ban mot tai khoan (chua biet
 * user id) - khop theo App ID roi thay bang thong tin that.
 */
export function saveAccount(input: SaveAccountInput): {
  account: AccountWithSecrets;
  isNew: boolean;
} {
  const db = getDb();
  const ts = nowSeconds();

  const existing =
    asRow<AccountRow>(getDb().prepare(`${SELECT} WHERE a.fb_user_id = ?`).get(input.fbUserId)) ??
    asRow<AccountRow>(
      getDb()
        .prepare(`${SELECT} WHERE a.fb_user_id = ? AND a.app_id = ?`)
        .get(`${LEGACY_ACCOUNT_PREFIX}${input.appId}`, input.appId),
    );

  // Bao mat theo khoa dong MOI (input.fbUserId) — khop voi gia tri cau UPDATE ngay duoi ghi vao.
  const sealedSecret = sealSecret(input.appSecret, secretAt(input.fbUserId, "app_secret"));
  const sealedToken = sealSecret(input.userToken, secretAt(input.fbUserId, "user_token"));

  if (existing) {
    db.prepare(
      `UPDATE accounts SET fb_user_id = ?, name = ?, app_id = ?, app_secret = ?,
                           user_token = ?, token_expires_at = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      input.fbUserId,
      input.name,
      input.appId,
      sealedSecret,
      sealedToken,
      input.tokenExpiresAt,
      ts,
      existing.id,
    );
    const updated = getAccount(existing.id);
    if (!updated) throw new Error("Khong cap nhat duoc tai khoan");
    return { account: updated, isNew: false };
  }

  const inserted = db
    .prepare(
      `INSERT INTO accounts (fb_user_id, name, app_id, app_secret, user_token, token_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.fbUserId,
      input.name,
      input.appId,
      sealedSecret,
      sealedToken,
      input.tokenExpiresAt,
      ts,
      ts,
    );

  const account = getAccount(toNumber(inserted.lastInsertRowid));
  if (!account) throw new Error("Khong tao duoc tai khoan");
  return { account, isNew: true };
}

export function renameAccount(id: number, name: string): AccountWithSecrets | null {
  getDb()
    .prepare("UPDATE accounts SET name = ?, updated_at = ? WHERE id = ?")
    .run(name, nowSeconds(), id);
  return getAccount(id);
}

/**
 * Go tai khoan. Cac Page cua tai khoan do cung bi go theo, vi khong con
 * cach lam moi token cho chung nua.
 */
export function deleteAccount(id: number): { removedPages: number } {
  const db = getDb();
  const result = db.prepare("DELETE FROM pages WHERE account_id = ?").run(id);
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  return { removedPages: toNumber(result.changes) };
}
