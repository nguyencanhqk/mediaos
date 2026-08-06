import path from "node:path";
import { openSecret, sealSecret, type SecretLocation } from "../crypto/secret-box";
import { getDb } from "../db";
import type { LibraryRoot } from "./roots";

/**
 * Goc kho video do NGUOI DUNG cau hinh qua giao dien — luu trong bang `settings`, khoa
 * `mediaLibraryRoots`, gia tri la JSON.
 *
 * Vi sao dung bang `settings` san co thay vi them bang moi: day la cau hinh cua ung dung, dung
 * dung ban chat voi `appId`/`graphVersion` dang nam do. Them mot bang chi de giu vai dong cau hinh
 * la chi phi khong doi lai gi.
 *
 * Vi sao KHONG bo vao `AppSettings`: `AppSettings` la mot ban ghi phang gom ca ba khoa BI MAT
 * (`appSecret`, `userAccessToken`, `pageAccessToken`) di qua lop ma hoa. Nhet mot mang JSON khong
 * bi mat vao do se buoc moi cho doc `getSettings()` phai hieu them mot kieu du lieu, va lam mo
 * ranh gioi "khoa nao la bi mat" — dung ranh gioi ma lop ma hoa dua vao.
 */

const SETTING_KEY = "mediaLibraryRoots";

interface StoredRoot {
  id: number;
  label: string;
  path: string;
  /** Tai khoan dang nhap o dia chia se. Rong = thu muc cuc bo, khong can dang nhap. */
  username?: string;
  /** Mat khau DA BAO MAT bang secret-box (AES-256-GCM duoi KEK). KHONG BAO GIO ra khoi tang nay. */
  secret?: string;
}

/**
 * O luu cua mat khau — AAD rang buoc gia tri vao dung dong cua no, nen khong the cat mat khau cua
 * kho nay dan sang kho khac roi mong giai ma duoc. `rowKey` dung ID (khong dung duong dan): duong
 * dan co the sua, ID thi khong.
 */
function credentialLocation(id: number): SecretLocation {
  return { table: "settings", column: "mediaLibraryRoots", rowKey: `libraryRoot:${id}` };
}

/**
 * `seq` la bo dem TANG DAN, luu ben cung danh sach.
 *
 * Khong suy id moi tu `max(id hien co) + 1`: xoa goc cuoi roi them goc moi se cho ra DUNG id vua
 * xoa, va mot tab dang mo tro `cfg:2` se lang le doc sang kho khac. Bo dem rieng khong bao gio lui.
 */
interface RootsDocument {
  seq: number;
  roots: StoredRoot[];
}

const EMPTY: RootsDocument = { seq: 0, roots: [] };

function isStoredRoot(r: unknown): r is StoredRoot {
  return (
    typeof r === "object" &&
    r !== null &&
    typeof (r as StoredRoot).id === "number" &&
    typeof (r as StoredRoot).label === "string" &&
    typeof (r as StoredRoot).path === "string"
  );
}

function readRaw(): RootsDocument {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(SETTING_KEY) as
    | { value: string }
    | undefined;
  if (!row?.value) return EMPTY;

  try {
    const parsed: unknown = JSON.parse(row.value);
    // Chap nhan ca dang mang tran (ban ghi tay / phien ban dau) — khi do suy `seq` tu id lon nhat.
    const roots = (Array.isArray(parsed) ? parsed : ((parsed as RootsDocument)?.roots ?? [])).filter(
      isStoredRoot,
    );
    const storedSeq = Array.isArray(parsed) ? 0 : Number((parsed as RootsDocument)?.seq ?? 0);
    const maxId = roots.reduce((max, r) => Math.max(max, r.id), 0);
    return { seq: Math.max(storedSeq, maxId), roots };
  } catch {
    // Gia tri hong (sua tay nham) — coi nhu KHONG co goc nao. Fail-closed: tha khong duyet duoc
    // kho con hon la doan xem nguoi dung dinh khai bao gi roi mo nham mot thu muc.
    return EMPTY;
  }
}

function writeRaw(doc: RootsDocument): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(SETTING_KEY, JSON.stringify(doc));
}

/**
 * Goc kho da luu, doi sang dang dung chung voi goc tu env.
 *
 * CSDL chua san sang (dang chay test thuan duong dan, hoac dich vu vua khoi dong va thu muc du
 * lieu chua tao) thi tra ve rong. Nuot loi o day la AN TOAN vi ket qua nghieng ve phia CHAT HON —
 * it goc hon = it duong dan duoc phep hon. Nguoc lai moi dang lo.
 */
export function storedRoots(): LibraryRoot[] {
  let doc: RootsDocument;
  try {
    doc = readRaw();
  } catch {
    return [];
  }
  return doc.roots.map((r) => ({
    key: `cfg:${r.id}`,
    label: r.label,
    path: r.path,
    source: "config" as const,
    username: r.username || undefined,
  }));
}

export interface StoredCredential {
  username: string;
  password: string;
}

/**
 * Tai khoan dang nhap cua mot kho, DA GIAI MA.
 *
 * Chi tang ket noi SMB duoc goi ham nay. Gia tri tra ve KHONG duoc di vao bat ky response, log
 * hay thong bao loi nao (BAT BIEN #3).
 */
export function credentialFor(key: string): StoredCredential | null {
  if (!key.startsWith("cfg:")) return null;
  const id = Number(key.slice("cfg:".length));
  if (!Number.isInteger(id)) return null;

  const root = readRaw().roots.find((r) => r.id === id);
  if (!root?.username || !root.secret) return null;

  try {
    return { username: root.username, password: openSecret(root.secret, credentialLocation(id)) };
  } catch {
    // Giai ma hong (KEK bi thay, ban ghi bi sua tay) — coi nhu KHONG co tai khoan thay vi nem loi
    // kem chi tiet mat ma ra ngoai. Nguoi dung se thay "khong co quyen doc" va nhap lai tai khoan.
    return null;
  }
}

/**
 * Them kho, hoac CAP NHAT kho da co neu trung duong dan.
 *
 * Trung duong dan ma tao them dong moi se de lai hai the cung tro mot cho — nguoi dung xoa mot
 * cai roi ngac nhien vi file van con thay o cai kia. Cap nhat cung la cach doi tai khoan/mat khau
 * cua mot kho: nhap lai duong dan cu kem tai khoan moi.
 *
 * `credential === undefined` = giu nguyen tai khoan dang co (nguoi dung chi doi nhan).
 * `credential === null`      = xoa tai khoan (chuyen ve thu muc khong can dang nhap).
 */
export function addStoredRoot(
  label: string,
  normalizedPath: string,
  credential?: StoredCredential | null,
): LibraryRoot {
  const doc = readRaw();
  const existing = doc.roots.find((r) => r.path.toLowerCase() === normalizedPath.toLowerCase());
  const id = existing ? existing.id : doc.seq + 1;
  const resolvedLabel = label.trim() || path.basename(normalizedPath) || normalizedPath;

  let username = existing?.username;
  let secret = existing?.secret;
  if (credential === null) {
    username = undefined;
    secret = undefined;
  } else if (credential) {
    username = credential.username;
    secret = sealSecret(credential.password, credentialLocation(id));
  }

  const entry: StoredRoot = { id, label: resolvedLabel, path: normalizedPath, username, secret };
  const roots = existing
    ? doc.roots.map((r) => (r.id === id ? entry : r))
    : [...doc.roots, entry];

  writeRaw({ seq: Math.max(doc.seq, id), roots });
  return {
    key: `cfg:${id}`,
    label: resolvedLabel,
    path: normalizedPath,
    source: "config",
    username,
  };
}

/** Tra ve true neu that su co xoa. */
export function removeStoredRoot(key: string): boolean {
  if (!key.startsWith("cfg:")) return false;
  const id = Number(key.slice("cfg:".length));
  if (!Number.isInteger(id)) return false;

  const doc = readRaw();
  const remaining = doc.roots.filter((r) => r.id !== id);
  if (remaining.length === doc.roots.length) return false;
  // `seq` GIU NGUYEN khi xoa — do la toan bo diem cua no.
  writeRaw({ seq: doc.seq, roots: remaining });
  return true;
}
