import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * secret-box — bao mat cac gia tri BI MAT truoc khi ghi xuong SQLite (BAT BIEN #3 cua MediaOS).
 *
 * Bao ve cai gi: `accounts.app_secret`, `accounts.user_token`, `pages.access_token` va ba khoa
 * bi mat con lai trong bang `settings`. Mot Page Access Token cho phep dang bai nhan danh cong ty
 * len trang cong khai — mat no la mat quyen phat ngon, khong phai mat mot ban ghi.
 *
 * ── VI SAO KHAC `SecretEncryptionService` cua apps/api (doc ky truoc khi "sua cho giong") ──
 * apps/api dung ENVELOPE (DEK moi moi lan ghi, DEK duoc boc boi KEK, phien ban khoa doc tu bang
 * `encryption_keys`). O day CO Y don gian hon: AES-256-GCM thang duoi KEK, khong co lop DEK.
 * Ly do: envelope co gia tri khi co MOT SO REGISTRY KHOA that (nhieu phien ban, xoay khoa qua
 * Vault transit, re-wrap khong can giai ma du lieu). fbpost la app ve tinh chay SQLite mot file,
 * khong co bang `encryption_keys`, khong co Vault. Them lop DEK duoc boc boi DUNG MOT KEK khong
 * tang them bao mat — chi them byte va them duong hong. Tien to phien ban `v1.` de danh cho
 * truong hop ve sau that su can xoay khoa.
 *
 * Dinh dang luu: `v1.<b64url(iv)>.<b64url(tag)>.<b64url(ciphertext)>` — tu mo ta, nhin la biet
 * da duoc bao mat hay chua, va `isSealed()` phan biet duoc voi du lieu cu chua ma hoa.
 *
 * AAD rang buoc gia tri vao DUNG O cua no: `table\x00column\x00rowKey`. Nho vay khong the
 * cat token cua Page A dan sang Page B (hoac doi app_secret thanh user_token) roi mong no giai
 * ma duoc — GCM se tu choi. Phan cach bang 0x00 vi khong ten bang/cot/khoa nao chua byte NUL.
 *
 * TUYET DOI khong log plaintext, khong log key, khong nem noi dung loi giai ma ra ngoai.
 */

const ALGO = "aes-256-gcm";
const KEK_BYTES = 32;
const IV_BYTES = 12; // nonce chuan cua GCM
const TAG_BYTES = 16;
const VERSION = "v1";

/**
 * Duong dan mac dinh toi file KEK. CO Y de ngoai `data/`: `data/` la thu muc bi SAO CHEP
 * (backup, gui file CSDL di de xem, dong goi mang sang may khac) — de KEK trong do thi ma hoa
 * chang bao ve duoc gi vi khoa di kem o khoa.
 *
 * MO HINH DE DOA (noi thang, dung ao tuong): bao ve nay chong lai viec FILE CSDL BI LO —
 * ban sao luu that lac, ai do copy `fbpost.db` ra ngoai, dia bi doc truc tiep. No KHONG chong
 * duoc ke da chiem duoc quyen chay code tren chinh may nay: nguoi do doc duoc ca KEK.
 * Muon chong ca ve sau thi phai chuyen KEK sang Vault/HSM — ngoai pham vi wave S9.
 */
const DEFAULT_KEK_PATH = ".secrets/fbpost-kek.bin";

/**
 * KEK nap luoi va giu lai trong bo nho. KHONG tu lam moi: doi file KEK thi phai khoi dong lai
 * tien trinh — giong LocalKekProvider ben apps/api, va o quy mo nay thi do la danh doi dung.
 */
let cachedKek: Buffer | undefined;

/** Chi dung trong test — xoa cache de mot ca test khac co the doi KEK. */
export function resetKekCache(): void {
  cachedKek?.fill(0);
  cachedKek = undefined;
}

function loadKek(): Buffer {
  if (cachedKek) return cachedKek;

  const path = process.env.SOCIAL_KEK_PATH ?? DEFAULT_KEK_PATH;
  let raw: Buffer;
  try {
    raw = readFileSync(path);
  } catch (err) {
    // Giu `cause` de phan biet ENOENT (thieu file) voi EACCES (khong co quyen) — van khong lo byte nao.
    throw new Error(
      `secret-box: khong doc duoc file KEK tai '${path}'. Tao bang: node scripts/gen-kek.mjs`,
      { cause: err },
    );
  }
  if (raw.length !== KEK_BYTES) {
    throw new Error(`secret-box: KEK phai dung ${KEK_BYTES} byte (file dang co ${raw.length}).`);
  }
  cachedKek = raw;
  return raw;
}

/** AAD rang buoc gia tri vao dung (bang, cot, dong). Doi bat ky ve nao la giai ma that bai. */
function buildAad(table: string, column: string, rowKey: string): Buffer {
  return Buffer.from(`${table}\x00${column}\x00${rowKey}`, "utf8");
}

export interface SecretLocation {
  /** Ten bang trong SQLite, vd `accounts`. */
  table: string;
  /** Ten cot, vd `user_token`. */
  column: string;
  /** Khoa ON DINH cua dong — KHONG dung id tu tang (chua biet luc INSERT). */
  rowKey: string;
}

/** Gia tri nay da o dang bao mat chua? Dung de migrate mot lan va de khong bao mat hai lan. */
export function isSealed(value: string): boolean {
  return value.startsWith(`${VERSION}.`) && value.split(".").length === 4;
}

/**
 * Bao mat mot gia tri. Chuoi rong tra ve chuoi rong: "chua cau hinh" khong phai bi mat, va
 * ma hoa no se lam hong moi cho dang kiem tra `if (!token)`.
 */
export function sealSecret(plaintext: string, at: SecretLocation): string {
  if (plaintext === "") return "";

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, loadKek(), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(buildAad(at.table, at.column, at.rowKey));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/**
 * Mo mot gia tri da bao mat.
 *
 * FAIL-CLOSED: gia tri chua bao mat (du lieu cu) se NEM LOI chu khong tra ve nguyen van. Tra ve
 * nguyen van la kieu hong im lang toi te nhat o day — no bien mot CSDL chua migrate thanh mot he
 * thong "chay tot" ma token van nam tho. Migration o `db.ts` bao mat toan bo TRUOC khi bat ky
 * repository nao doc, nen duong nay chi no khi co gi do that su sai.
 */
export function openSecret(stored: string, at: SecretLocation): string {
  if (stored === "") return "";
  if (!isSealed(stored)) {
    throw new Error(
      `secret-box: gia tri tai ${at.table}.${at.column} chua duoc bao mat — CSDL chua chay migration ma hoa.`,
    );
  }

  const [, ivPart, tagPart, ctPart] = stored.split(".");
  try {
    const decipher = createDecipheriv(ALGO, loadKek(), Buffer.from(ivPart, "base64url"), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAAD(buildAad(at.table, at.column, at.rowKey));
    decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ctPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Loi chung chung — khong bao gio lo tag/AAD/chi tiet crypto ra ngoai.
    throw new Error(`secret-box: khong giai ma duoc ${at.table}.${at.column}.`);
  }
}
