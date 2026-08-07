import { openSecret, sealSecret, type SecretLocation } from "../crypto/secret-box";
import { asRow, asRows, getDb, nowSeconds, toNumber } from "../db";
import type { PageAccount, PageAccountWithToken } from "../types";
import { maskSecret } from "./settings-repo";

/**
 * Kho luu cac Page da ket noi.
 *
 * Moi Page giu Page Access Token rieng. Token khong bao gio roi khoi server:
 * ham `toPublic` cat token ra truoc khi du lieu di ve trinh duyet.
 */

interface PageRow {
  id: number;
  account_id: number;
  account_name: string | null;
  page_id: string;
  name: string;
  access_token: string;
  can_post: number;
  is_active: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

/**
 * Danh tinh o luu token cua mot Page. Dung `page_id` (Facebook cap, UNIQUE, khong bao gio doi)
 * lam khoa dong — khong dung `id` AUTOINCREMENT vi luc INSERT chua biet gia tri.
 */
function tokenAt(pageId: string): SecretLocation {
  return { table: "pages", column: "access_token", rowKey: pageId };
}

function mapRow(row: PageRow): PageAccountWithToken {
  const accessToken = openSecret(row.access_token, tokenAt(row.page_id));
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name ?? "",
    pageId: row.page_id,
    name: row.name,
    accessToken,
    canPost: row.can_post === 1,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
    tokenMasked: maskSecret(accessToken),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Bo token ra khoi ban ghi truoc khi tra ve cho giao dien. */
export function toPublic(page: PageAccountWithToken): PageAccount {
  const { accessToken: _token, ...rest } = page;
  void _token;
  return rest;
}

const ORDER = "ORDER BY p.sort_order ASC, p.id ASC";

/** Keo kem ten tai khoan de giao dien biet Page thuoc tai khoan nao. */
const SELECT = `
  SELECT p.*, a.name AS account_name
  FROM pages p LEFT JOIN accounts a ON a.id = p.account_id
`;

export function listPages(): PageAccountWithToken[] {
  const rows = asRows<PageRow>(getDb().prepare(`${SELECT} ${ORDER}`).all());
  return rows.map(mapRow);
}

/** Cac Page dang bat va co quyen dang bai - danh sach dung de rai bai. */
export function listUsablePages(): PageAccountWithToken[] {
  const rows = asRows<PageRow>(
    getDb().prepare(`${SELECT} WHERE p.is_active = 1 AND p.can_post = 1 ${ORDER}`).all(),
  );
  return rows.map(mapRow);
}

export function getPage(id: number): PageAccountWithToken | null {
  const row = asRow<PageRow>(getDb().prepare(`${SELECT} WHERE p.id = ?`).get(id));
  return row ? mapRow(row) : null;
}

export function getManyPages(ids: number[]): PageAccountWithToken[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = asRows<PageRow>(
    getDb()
      .prepare(`${SELECT} WHERE p.id IN (${placeholders}) ${ORDER}`)
      .all(...ids),
  );
  return rows.map(mapRow);
}

export function countPages(): number {
  const row = asRow<{ total: number }>(
    getDb().prepare("SELECT COUNT(*) AS total FROM pages").get(),
  );
  return row?.total ?? 0;
}

export interface UpsertPageInput {
  pageId: string;
  name: string;
  accessToken: string;
  canPost: boolean;
}

/**
 * Ghi danh sach Page cua mot tai khoan vao CSDL.
 *
 * Page da co thi cap nhat ten va token moi, giu nguyen trang thai bat/tat
 * de nguoi dung khong phai chon lai sau moi lan lam moi. Neu mot Page truoc
 * day thuoc tai khoan khac (hai tai khoan cung quan tri mot Page) thi no
 * chuyen ve tai khoan vua lam moi, vi do la token con dung chac chan nhat.
 */
export function upsertPages(
  accountId: number,
  inputs: UpsertPageInput[],
): { added: number; updated: number } {
  const db = getDb();
  const ts = nowSeconds();
  const existing = new Map(listPages().map((p) => [p.pageId, p]));

  const insert = db.prepare(
    `INSERT INTO pages (account_id, page_id, name, access_token, can_post, is_active, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  );
  const update = db.prepare(
    `UPDATE pages SET account_id = ?, name = ?, access_token = ?, can_post = ?, updated_at = ?
     WHERE page_id = ?`,
  );

  let added = 0;
  let updated = 0;
  let nextOrder = existing.size;

  for (const input of inputs) {
    const sealedToken = sealSecret(input.accessToken, tokenAt(input.pageId));
    if (existing.has(input.pageId)) {
      update.run(accountId, input.name, sealedToken, input.canPost ? 1 : 0, ts, input.pageId);
      updated += 1;
    } else {
      insert.run(
        accountId,
        input.pageId,
        input.name,
        sealedToken,
        input.canPost ? 1 : 0,
        nextOrder,
        ts,
        ts,
      );
      nextOrder += 1;
      added += 1;
    }
  }

  return { added, updated };
}

export function setPageActive(id: number, isActive: boolean): PageAccountWithToken | null {
  getDb()
    .prepare("UPDATE pages SET is_active = ?, updated_at = ? WHERE id = ?")
    .run(isActive ? 1 : 0, nowSeconds(), id);
  return getPage(id);
}

export function renamePage(id: number, name: string): PageAccountWithToken | null {
  getDb()
    .prepare("UPDATE pages SET name = ?, updated_at = ? WHERE id = ?")
    .run(name, nowSeconds(), id);
  return getPage(id);
}

/**
 * Go Page khoi phan mem. Cac bai da dang van con trong danh sach kem ten Page
 * (cot `page_name` cua bang posts) de xem lai lich su.
 */
export function deletePage(id: number): void {
  getDb().prepare("DELETE FROM pages WHERE id = ?").run(id);
}

/** So bai dang cho xu ly cua mot Page - dung de canh bao truoc khi go Page. */
export function countPendingPostsOfPage(id: number): number {
  const row = asRow<{ total: number }>(
    getDb()
      .prepare(
        `SELECT COUNT(*) AS total FROM posts
         WHERE page_ref = ? AND status IN ('draft', 'queued', 'publishing')`,
      )
      .get(id),
  );
  return toNumber(row?.total ?? 0);
}
