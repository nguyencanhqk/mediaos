import { execFileSync } from "node:child_process";

/**
 * Dang nhap vao o dia chia se trong mang bang tai khoan nguoi dung da nhap o giao dien.
 *
 * ── VI SAO CAN ──
 * Dich vu chay bang `LocalSystem`, ma `LocalSystem` KHONG mang danh tinh nao ra mang: may ben kia
 * thay mot ke vo danh, nen moi dong quyen kieu "Authenticated Users duoc doc" deu khong khop vao
 * dau ca. Cach cu la doi tai khoan chay dich vu (phai tao tai khoan Windows TRUNG TEN TRUNG MAT
 * KHAU tren ca hai may, can Administrator ca hai ben). Cach nay tranh duoc toan bo viec do: tien
 * trinh tu dung mot phien SMB co danh tinh, giong het nhu go `net use` bang tay.
 *
 * ── MAT KHAU KHONG NAM TREN DONG LENH ──
 * `net use <share> * /user:<ten>` khien `net` HOI mat khau va doc tu stdin. Neu truyen mat khau
 * thang lam tham so thi no nam trong dong lenh cua tien trinh — bat ky ai xem duoc danh sach tien
 * trinh (Task Manager, WMI, `Get-CimInstance Win32_Process`) cung doc duoc. Dau `*` cong stdin
 * dong cai cua do lai. Da do: `net` doc stdin that, khong treo cho.
 *
 * ── PHAM VI BAO VE ──
 * Phien SMB nay thuoc ve PHIEN DANG NHAP cua tien trinh dich vu, mat khi tien trinh dung. Vi vay
 * ket noi duoc lap lai LUOI (lan dau cham toi kho sau moi lan khoi dong), khong phai lam gi khi
 * cai dat.
 */

/** Cac share da noi thanh cong trong VONG DOI tien trinh nay. Restart la mat — dung y do. */
const connected = new Set<string>();

/**
 * `\\MAY\share\thu\muc` → `\\MAY\share`. Tra `null` neu khong phai duong dan mang.
 *
 * SMB xac thuc o cap SHARE chu khong phai cap thu muc con, nen phai cat dung hai doan dau. Goi
 * `net use` voi ca duong dan sau se bao loi 67 (khong tim thay ten mang) — sai o kho tim.
 */
export function shareRootOf(inputPath: string): string | null {
  const unc = inputPath.replace(/\//g, "\\");
  if (!unc.startsWith("\\\\")) return null;

  const parts = unc.slice(2).split("\\").filter(Boolean);
  if (parts.length < 2) return null;
  return `\\\\${parts[0]}\\${parts[1]}`;
}

function runNet(args: string[], password?: string): { ok: boolean; output: string } {
  try {
    const out = execFileSync("net", args, {
      input: password === undefined ? undefined : `${password}\r\n`,
      encoding: "utf8",
      // Ket noi SMB toi mot may dang tat co the treo kha lau; 30s la du de biet no khong len.
      timeout: 30_000,
      windowsHide: true,
    });
    return { ok: true, output: out };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    // stderr cua `net` la noi loi that su nam. KHONG bao gio dua `password` vao chuoi tra ve.
    return { ok: false, output: `${e.stderr ?? ""}${e.stdout ?? ""}`.trim() };
  }
}

/**
 * Loi dang nhap — nhanh duy nhat duoc thu lai voi ten tai khoan day du.
 *
 * PHAI gom ca `System error 86` (ERROR_INVALID_PASSWORD). Ban dau chi bat 1326 nen mot lan tu choi
 * vi mat khau KHONG duoc coi la loi dang nhap: vua khong thu lai voi ten day du, vua roi xuong
 * nhanh cuoi cua `explain()` va nem nguyen dong tieng Anh cua `net` ra man hinh nguoi dung.
 */
function isLogonFailure(output: string): boolean {
  return /System error (86|1326|1327|1331)\b|logon failure|user name or password|network password is not correct/i.test(
    output,
  );
}

/** `\\MAY\share` → `MAY`. */
function serverOf(share: string): string {
  return share.replace(/^\\\\/, "").split("\\")[0] ?? "";
}

/** Ten tai khoan da co phan may/mien chua (`MAY\ten` hoac `ten@mien`). */
function isQualified(username: string): boolean {
  return username.includes("\\") || username.includes("@");
}

/**
 * Ghep ten may vao truoc ten tai khoan de dang nhap dung MAY DICH.
 *
 * Ten tai khoan tran (`ADMIN`) khien Windows gui kem domain la ten MAY CHU, nen may dich workgroup
 * tra 1326 "sai tai khoan hoac mat khau" DU mat khau dung. Ten da co phan may/mien thi giu nguyen.
 *
 * Export de test duoc chinh ham nay — mot bai test chep lai phep ghep chuoi thi chi chung minh
 * ban sao trong bai test dung, khong noi gi ve code that.
 */
export function qualifyUsername(share: string, username: string): string {
  const name = username.trim();
  const server = serverOf(share);
  if (name === "" || isQualified(name) || server === "") return name;
  return `${server}\\${name}`;
}

/** Dich ma loi cua `net` sang cau nguoi dung hieu duoc. */
export function explainNetError(output: string): string {
  // 86 noi RIENG ve mat khau; 1326 mo ho giua ten va mat khau. Gop hai cai lam mot se lam mat dung
  // manh thong tin quy nhat: biet chac tai khoan ton tai va chi mat khau sai.
  if (/System error 86\b|network password is not correct/i.test(output)) {
    return "Mật khẩu không đúng (tài khoản có tồn tại). Kiểm tra lại mật khẩu của tài khoản đó trên chính máy chứa thư mục.";
  }
  if (/System error 1331\b|account is currently disabled/i.test(output)) {
    return "Tài khoản này đang bị vô hiệu hoá trên máy chứa thư mục.";
  }
  if (/System error 1327\b|restrictions/i.test(output)) {
    return "Tài khoản bị hạn chế: mật khẩu rỗng, mật khẩu hết hạn, hoặc không được phép đăng nhập vào giờ này.";
  }
  if (isLogonFailure(output)) {
    return "Sai tài khoản hoặc mật khẩu.";
  }
  if (/System error 53|network path was not found/i.test(output)) {
    return "Không thấy máy trong mạng. Kiểm tra tên máy và xem máy đó đã bật chưa.";
  }
  if (/System error 67|network name cannot be found/i.test(output)) {
    // Windows tra dung ma 67 cho CA "sai ten may" lan "sai ten thu muc chia se" (do thi nghiem:
    // //MAY-KHONG-CO-THAT/share cung ra 67 chu khong ra 53). Neu chi noi "kiem tra ten share" thi
    // mot nua so truong hop bi day di sai huong — nen noi ca hai.
    return "Không thấy thư mục chia sẻ. Kiểm tra cả tên máy lẫn tên thư mục chia sẻ, và xem máy đó đã bật chưa.";
  }
  if (/System error 5|Access is denied/i.test(output)) {
    return "Tài khoản đăng nhập được nhưng không được phép truy cập thư mục chia sẻ này.";
  }
  if (/System error 1219|Multiple connections/i.test(output)) {
    return "Máy chủ đang có sẵn một kết nối khác tới máy này bằng tài khoản khác.";
  }
  return output.split("\n")[0]?.trim() || "Không kết nối được tới ổ chia sẻ.";
}

export class NetConnectError extends Error {}

/**
 * Bao dam da co phien SMB toi share chua `dirPath`.
 *
 * - Duong dan cuc bo → khong lam gi.
 * - Da noi trong tien trinh nay → khong lam gi (tranh goi `net` moi lan duyet thu muc).
 * - `force` → bo qua cache va noi lai; dung khi nguoi dung vua doi tai khoan.
 */
export function ensureShareConnection(
  dirPath: string,
  credential: { username: string; password: string } | null,
  options: { force?: boolean } = {},
): void {
  const share = shareRootOf(dirPath);
  if (!share || !credential) return;
  if (!options.force && connected.has(share)) return;

  const username = credential.username.trim();
  const attempt = (user: string) =>
    runNet(["use", share, "*", `/user:${user}`], credential.password);

  let result = attempt(username);

  if (!result.ok && /1219|Multiple connections/i.test(result.output)) {
    // Windows khong cho mot phien dang nhap giu hai ket noi toi cung mot may bang hai tai khoan
    // khac nhau. Go ket noi cu roi noi lai — day la ket noi cua CHINH tien trinh dich vu, khong
    // dong cham gi toi phien lam viec cua nguoi dung tren may.
    runNet(["use", share, "/delete", "/y"]);
    result = attempt(username);
  }

  /**
   * Thu lai voi ten tai khoan CO PHAN MAY: `DESKTOP-XXX\ADMIN`.
   *
   * Vi sao can: khi ten tai khoan khong co phan may/mien, Windows gui kem domain la ten MAY CHU
   * (may dang chay dich vu) chu khong phai may dich. Voi hai may workgroup — dung mo hinh o day —
   * may dich khong biet `NASHP\ADMIN` la ai va tra ve 1326, tuc "sai tai khoan hoac mat khau", DU
   * mat khau hoan toan dung. Day la mot trong nhung loi mat thoi gian nhat cua SMB workgroup vi
   * thong bao noi sai hoan toan ve nguyen nhan.
   *
   * Chi thu khi ten CHUA co phan may (khong pha ten kieu `MIEN\ten` hay `ten@mien` nguoi dung da
   * go dung), va chi khi loi dung la loi dang nhap.
   */
  const qualified = qualifyUsername(share, username);
  if (!result.ok && isLogonFailure(result.output) && qualified !== username) {
    result = attempt(qualified);
  }

  if (!result.ok) {
    connected.delete(share);
    const hint =
      isLogonFailure(result.output) && qualified !== username
        ? ` Đã thử cả "${username}" lẫn "${qualified}".`
        : "";
    throw new NetConnectError(`${explainNetError(result.output)} (${share})${hint}`);
  }
  connected.add(share);
}

/**
 * NGAT phien SMB toi share, khong chi quen no.
 *
 * Ban dau ham nay chi xoa khoi `Set` trong bo nho — va do la mot lo that: xoa kho xong, may chu
 * VAN dang dang nhap vao share bang tai khoan vua bi xoa, den tan lan khoi dong sau. Hau qua cu
 * the: them lai mot kho tro vao chinh share do MA KHONG nhap tai khoan van `probe` ra "ok" (nho
 * phien cu con song) roi duoc luu vao whitelist — nghia la mot muc whitelist ton tai duoc nho mot
 * credential khong con duoc khai bao o dau ca. Sau lan restart tiep theo no chet, khong ai hieu vi sao.
 */
export function forgetShareConnection(dirPath: string): void {
  const share = shareRootOf(dirPath);
  if (!share) return;
  connected.delete(share);
  runNet(["use", share, "/delete", "/y"]);
}
