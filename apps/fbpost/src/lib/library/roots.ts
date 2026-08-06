import fs from "node:fs";
import path from "node:path";
import { ensureShareConnection, NetConnectError } from "./net-connect";
import { credentialFor, storedRoots } from "./roots-store";

/**
 * Kho video doc tu thu muc — DANH SACH GOC DUOC PHEP (whitelist).
 *
 * Vi sao phai co tang nay: truoc day `/api/import/commit` nhan `mediaPaths` la chuoi tuy y tu
 * client roi dua thang cho `importMediaFromPath`, nghia la bat ky ai co phien deu doc duoc file
 * BAT KY tren may chu roi tai ve qua `/api/media/:id/file`. Tu day tro di MOI duong dan tu client
 * — ke ca duong dan trong file CSV — deu phai nam trong mot goc da khai bao. Khong khai goc nao
 * thi khong nap duoc gi (fail-closed), chu khong phai mo toang.
 *
 * ── HAI NGUON GOC KHO ──
 *   - `env`    : bien moi truong `SOCIAL_MEDIA_LIBRARY_DIRS`, do NGUOI VAN HANH dat, doi thi phai
 *                khoi dong lai dich vu. Giao dien KHONG xoa duoc.
 *   - `config` : do nguoi dung them qua giao dien, luu trong bang `settings`. Doi khong can khoi
 *                dong lai. CHI tai khoan trong `SOCIAL_ADMIN_EMAILS` duoc them/xoa — xem
 *                `lib/auth/admin.ts`. Neu ai vao app cung them duoc goc thi whitelist nay vo
 *                nghia: no tro thanh mot cai nut "cho toi doc file bat ky tren may chu".
 *
 * ── DINH DANH GOC ──
 * Goc duoc dinh danh bang KHOA CHUOI on dinh (`env:0`, `cfg:3`), KHONG phai chi so trong danh
 * sach. Chi so se xe dich khi xoa mot goc, va mot tab dang mo se lang le tro sang goc khac.
 */

export type LibraryRootSource = "env" | "config";

export interface LibraryRoot {
  /** Khoa on dinh — thu client gui lai. Khong doi khi them/xoa goc khac. */
  key: string;
  label: string;
  /** Duong dan da chuan hoa (chua realpath — realpath doi thu muc phai ton tai). */
  path: string;
  source: LibraryRootSource;
  /** Tai khoan dang nhap o dia chia se (neu co). CHI ten — mat khau khong bao gio roi tang luu. */
  username?: string;
}

const SEPARATOR = ";";

/** Loi nghiep vu cua tang kho video — route dich thanh 400 chu khong phai 500. */
export class LibraryPathError extends Error {}

/**
 * Chuan hoa mot duong dan nguoi dung nhap.
 *
 * Duong dan mang nen ghi bang GACH XUOI (`//MAY/share/thu-muc`): dau `\` trong file .env va trong
 * o nhap rat de bi nuot mot cai, va khi do `\\MAY\share` thanh `\MAY\share` — Windows hieu thanh
 * thu muc goc cua o hien tai va `path.resolve` bien no thanh `C:\MAY\share` MA KHONG BAO LOI. Da
 * dinh dung loi nay khi seed lan dau. `path.resolve` xu ly gach xuoi thanh UNC dung.
 */
export function normalizeRootPath(input: string): string {
  return path.resolve(input.trim().replace(/^["']|["']$/g, ""));
}

/** Doc `SOCIAL_MEDIA_LIBRARY_DIRS`. Doc MOI LAN goi — NSSM co the doi bien roi restart. */
function envRoots(): LibraryRoot[] {
  const raw = process.env.SOCIAL_MEDIA_LIBRARY_DIRS;
  if (!raw || raw.trim() === "") return [];

  const roots: LibraryRoot[] = [];
  for (const chunk of raw.split(SEPARATOR)) {
    const entry = chunk.trim();
    if (entry === "") continue;

    // Chi tach o dau `=` DAU TIEN. Chi coi la nhan khi phan truoc `=` khong chua `\` hay `/`
    // — nếu không thì `D:` cua duong dan Windows se bi hieu nham thanh nhan.
    const eq = entry.indexOf("=");
    const hasLabel = eq > 0 && !/[\\/]/.test(entry.slice(0, eq));
    const label = hasLabel ? entry.slice(0, eq).trim() : "";
    const dir = (hasLabel ? entry.slice(eq + 1) : entry).trim();
    if (dir === "") continue;

    const normalized = normalizeRootPath(dir);
    roots.push({
      key: `env:${roots.length}`,
      label: label || path.basename(normalized) || normalized,
      path: normalized,
      source: "env",
    });
  }
  return roots;
}

/** Toan bo goc kho: env (co dinh) + cau hinh qua giao dien. */
export function libraryRoots(): LibraryRoot[] {
  return [...envRoots(), ...storedRoots()];
}

export function findRoot(key: string): LibraryRoot | undefined {
  return libraryRoots().find((r) => r.key === key);
}

/**
 * Goc kho co that su doc duoc khong.
 *
 * Tach thanh buoc rieng vi ba nguyen nhan duoi day cho ra ba viec phai lam khac han nhau, ma neu
 * gop lai thi ca ba deu hien ra la "khong tim thay file" — mot thong bao dan nguoi dung di sai
 * huong hoan toan:
 *   - cau hinh sai duong dan (vd UNC bi nuot mot dau `\`) → sua o cau hinh
 *   - tai khoan chay dich vu khong co quyen tren share → viec van hanh, khong dong den cau hinh
 *   - duong dan dung, quyen du, nhung file/thu muc con khong ton tai → nguoi dung go nham
 */
function assertRootReadable(root: LibraryRoot): string {
  try {
    return fs.realpathSync.native(root.path);
  } catch (firstError) {
    // Chua doc duoc. Neu kho co tai khoan dang nhap thi rat co the chi la CHUA CO PHIEN SMB —
    // phien do thuoc ve tien trinh va mat sau moi lan khoi dong dich vu. Noi lai roi thu lai
    // MOT lan. Chi lam khi co tai khoan: khong co thi day dung la loi quyen/duong dan that.
    const credential = root.source === "config" ? credentialFor(root.key) : null;
    let diagnosisError = firstError;
    if (credential) {
      try {
        ensureShareConnection(root.path, credential, { force: true });
        return fs.realpathSync.native(root.path);
      } catch (retryError) {
        if (retryError instanceof NetConnectError) {
          throw new LibraryPathError(`Kho "${root.label}": ${retryError.message}`);
        }
        // Dang nhap ĐUOC nhung van khong doc duoc. Nguyen nhan that nam o LAN THU HAI (thuong la
        // EPERM = thieu quyen tren thu muc), con `firstError` chi la "chua co phien SMB" — chan
        // doan bang no se bao "kiem tra duong dan" trong khi duong dan hoan toan dung.
        diagnosisError = retryError;
      }
    }

    const code = (diagnosisError as NodeJS.ErrnoException).code;
    // `UNKNOWN` la ma Windows tra cho o dia mang khong toi duoc — DO DUOC tren chinh may nay. Thieu
    // no thi nhanh "khong co quyen" gan nhu chet voi dung loai kho ma no sinh ra de phuc vu.
    if (code === "EPERM" || code === "EACCES" || code === "UNKNOWN") {
      throw new LibraryPathError(
        `Không có quyền đọc kho "${root.label}". Nếu đây là ổ chia sẻ trong mạng, hãy sửa kho và nhập tài khoản đăng nhập của ổ đó.`,
      );
    }
    throw new LibraryPathError(
      `Không mở được kho "${root.label}". Kiểm tra đường dẫn — với ổ chia sẻ trong mạng hãy dùng dạng gạch xuôi //MÁY/share/thư-mục.`,
    );
  }
}

/**
 * `target` co nam trong `root` khong.
 *
 * Dung `path.relative` chu KHONG dung `startsWith`: `startsWith` coi `D:\kho-video-khac` la nam
 * trong `D:\kho-video` (trung tien to mot phan) — lo hong kinh dien cua kieu kiem tra do.
 * `path.relative` tren win32 so sanh khong phan biet hoa thuong, dung voi cach NTFS lam viec.
 *
 * Chinh `root` KHONG duoc coi la nam trong root (relative rong).
 */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export interface ResolvedLibraryPath {
  root: LibraryRoot;
  /** Duong dan tuyet doi da qua realpath — dung cai nay de doc file, KHONG dung dau vao goc. */
  absolutePath: string;
  /** Duong dan tuong doi so voi goc, de tra ve cho giao dien. */
  relativePath: string;
}

function assertHasRoots(): LibraryRoot[] {
  const roots = libraryRoots();
  if (roots.length === 0) {
    throw new LibraryPathError(
      "Chưa khai báo kho video nào. Vào trang Kho video để thêm thư mục, hoặc đặt biến môi trường SOCIAL_MEDIA_LIBRARY_DIRS.",
    );
  }
  return roots;
}

/**
 * Phan giai (khoa goc + duong dan tuong doi) → duong dan tuyet doi da kiem chung.
 * Day la duong client dung: client KHONG BAO GIO gui duong dan tuyet doi o day.
 */
/**
 * Duong dan TUONG DOI phai that su tuong doi.
 *
 * Bat buoc phai chan TRUOC moi loi goi he thong file. `path.resolve(goc, x)` tren win32 VUT BO
 * `goc` khi `x` la duong dan tuyet doi — va `//may/share/x` cung duoc coi la tuyet doi. Vong kiem
 * `isInside` phia sau van chan dung, NHUNG thiet hai da xay ra o buoc `realpathSync` o giua:
 *
 *   - Do duoc: `realpathSync.native('\\\\203.0.113.7\\share\\x')` khoa DONG BO 21 giay. Route
 *     handler cua Next chay tren main thread ⇒ ca app dung, ke ca worker hen gio dang bai. Mot
 *     request `/api/library/import` cho phep 50 item ⇒ nhan len hang chuc phut.
 *   - Nang hon: cham toi `\\<may la>\share` khien Windows TU DONG xac thuc ra ngoai bang danh tinh
 *     cua tien trinh. Hom nay la LocalSystem; sau khi doi dich vu sang tai khoan nguoi (S10-SOCIAL-
 *     OPS-1) thi do la NetNTLMv2 cua tai khoan do gui toi may do KE TAN CONG chon — crack offline
 *     hoac SMB relay.
 *
 * Loc TU VUNG (thuan chuoi, khong cham dia) dong ca hai cua truoc khi mo.
 */
function assertRelativeInput(relativePath: string): void {
  if (relativePath === "") return;
  const bad =
    path.isAbsolute(relativePath) ||
    /^[\\/]{2}/.test(relativePath) || // UNC: //may/share hoac \\may\share
    /^[A-Za-z]:/.test(relativePath); // co ky tu o dia: C:, D:\...
  if (bad) {
    throw new LibraryPathError("Đường dẫn nằm ngoài phạm vi kho video được phép.");
  }
}

export function resolveFromRoot(rootKey: string, relativePath: string): ResolvedLibraryPath {
  const roots = assertHasRoots();
  const root = roots.find((r) => r.key === rootKey);
  if (!root) throw new LibraryPathError("Kho video không hợp lệ hoặc đã bị xoá.");

  assertRelativeInput(relativePath);

  // Kiem GOC truoc: goc hong thi moi duong dan con deu bao "khong tim thay", che mat nguyen nhan that.
  const realRoot = assertRootReadable(root);
  // `relativePath` rong = chinh thu muc goc (dung khi duyet cay).
  const joined = path.resolve(realRoot, relativePath);

  // Chan TU VUNG lan hai: sau resolve van phai nam duoi goc. Re, khong cham dia, va la thu duy
  // nhat chay TRUOC realpath. Vong realpath ben duoi VAN GIU — no moi la thu chan junction.
  if (joined !== realRoot && !isInside(realRoot, joined)) {
    throw new LibraryPathError("Đường dẫn nằm ngoài phạm vi kho video được phép.");
  }

  let real: string;
  try {
    // realpath CA hai dau truoc khi so sanh: mot symlink/junction nam TRONG goc nhung tro RA NGOAI
    // se lot qua neu chi so sanh chuoi. Windows co junction nen day khong phai chuyen ly thuyet.
    real = fs.realpathSync.native(joined);
  } catch {
    // GOP chung mot thong bao voi nhanh "ngoai pham vi" ben duoi: neu hai truong hop phan biet
    // duoc thi bat ky ai co phien deu do duoc su TON TAI cua duong dan bat ky tren may chu (thu
    // "ngoai pham vi" = co that, "khong tim thay" = khong co). Ve ban do o dia la mot buoc chuan
    // bi cho don sau, khong phai loi vo hai.
    throw new LibraryPathError(`Không đọc được trong kho: ${relativePath || "(thư mục gốc)"}`);
  }

  if (real !== realRoot && !isInside(realRoot, real)) {
    throw new LibraryPathError(`Không đọc được trong kho: ${relativePath || "(thư mục gốc)"}`);
  }

  return { root, absolutePath: real, relativePath: path.relative(realRoot, real) };
}

/**
 * Phan giai mot duong dan TUYET DOI (cot `media` trong file CSV do nguoi dung go tay).
 * Phai duyet moi goc de tim goc chua no; khong thuoc goc nao thi tu choi.
 */
export function resolveAbsolute(inputPath: string): ResolvedLibraryPath {
  const roots = assertHasRoots();

  const trimmed = inputPath.trim().replace(/^["']|["']$/g, "");
  if (trimmed === "") throw new LibraryPathError("Đường dẫn file trống.");

  const resolved = path.resolve(trimmed);

  // LOC TU VUNG TRUOC khi cham dia — cung ly do nhu `assertRelativeInput`: mot duong dan UNC toi
  // may la se treo `realpathSync` hang chuc giay VA ep Windows xac thuc ra ngoai, du cuoi cung no
  // bi tu choi. Chi realpath khi duong dan da nam duoi mot goc VE MAT CHUOI.
  const lexicalMatches = roots.filter((r) => isInside(r.path, resolved));
  if (lexicalMatches.length === 0) {
    // KHONG in danh sach goc ra thong bao loi: do la thong tin bo cuc dia cua may chu.
    throw new LibraryPathError(
      `File nằm ngoài kho video được phép: ${trimmed}. Chỉ nhận file trong thư mục kho đã khai báo.`,
    );
  }

  let real: string;
  try {
    real = fs.realpathSync.native(resolved);
  } catch {
    throw new LibraryPathError(`Không đọc được file: ${trimmed}`);
  }

  for (const root of lexicalMatches) {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync.native(root.path);
    } catch {
      // Goc nay dang hong/mat ket noi — bo qua no, van xet cac goc con lai. Mot goc hong khong
      // duoc lam ket toan bo duong nhap CSV.
      continue;
    }
    if (isInside(realRoot, real)) {
      return { root, absolutePath: real, relativePath: path.relative(realRoot, real) };
    }
  }

  // Lot duoc buoc tu vung nhung realpath lai ra ngoai (junction/symlink), HOAC moi goc khop deu
  // dang khong doc duoc. Hai truong hop nay CO Y dung chung mot thong bao: phan biet chung se cho
  // biet duong dan co ton tai hay khong.
  throw new LibraryPathError(
    `Không đọc được file: ${trimmed}. Kiểm tra file có nằm trong thư mục kho đã khai báo và kho đó đang đọc được không.`,
  );
}
