import { execFileSync } from "node:child_process";

/**
 * Dang nhap vao o dia chia se trong mang bang tai khoan nguoi dung da nhap o giao dien.
 *
 * ── VI SAO CAN ──
 * Dich vu chay bang `LocalSystem`, ma `LocalSystem` KHONG mang danh tinh nao ra mang: may ben kia
 * thay mot ke vo danh, nen moi dong quyen kieu "Authenticated Users duoc doc" deu khong khop vao
 * dau ca. Cach cu la doi tai khoan chay dich vu (phai tao tai khoan Windows TRUNG TEN TRUNG MAT
 * KHAU tren ca hai may, can Administrator ca hai ben). Cach nay tranh duoc toan bo viec do: tien
 * trinh tu dung mot phien SMB co danh tinh.
 *
 * ── VI SAO KHONG CON DUNG `net use` ──
 * Ban dau ham nay goi `net use <share> * /user:<ten>` roi ghi mat khau vao STDIN cua `net`, voi ly
 * do (dung) la mat khau khong duoc nam tren dong lenh. Nhung `net use *` doc mat khau tu CONSOLE
 * chu khong phai tu stdin, ma tien trinh spawn ra thi stdin luon la ong dan ⇒ `net` doc duoc chuoi
 * RONG va dang nhap voi mat khau rong.
 *
 * Do duoc tren PROD 07/08/2026, voi mot cap tai khoan DA XAC MINH la dung va thuan ASCII:
 *   mat khau qua tham so → vao duoc  |  mat khau qua stdin → 1326
 * Tuc duong nay chua tung dang nhap thanh cong lan nao ke tu khi viet.
 *
 * Cai bay nam o cho no THAT BAI GIONG HET mat khau sai (1326 / 86), nen moi dau moi deu chi ve phia
 * nguoi dung: "go lai mat khau di". Nguoi dung go dung hang chuc lan, moi lan lai lam day them bo
 * dem khoa tai khoan cua may ben kia (den luc khoa that thi ma doi sang 1909, cang giong "loi cua
 * anh"), va khong co gi trong thong bao goi y rang loi nam o may chu.
 *
 * ── CACH LAM HIEN TAI ──
 * Goi THANG `WNetAddConnection2` — chinh la API ma `net use` dung ben duoi — qua mot tien trinh
 * PowerShell, mat khau di bang BIEN MOI TRUONG:
 *   - Windows truyen khoi bien moi truong cho tien trinh con dang UTF-16 → khong co buoc doi bang
 *     ma nao, nen mat khau CO DAU tieng Viet cung nguyen ven. Duong stdin cu con vo them ca cho
 *     nay: `net` doc stdin theo codepage console, do duoc chu "đ" ra HAI ky tu sai.
 *   - Bien moi truong cua mot tien trinh khac chi doc duoc bang quyen Administrator, con DONG LENH
 *     thi ai cung xem duoc qua Task Manager / `Get-CimInstance Win32_Process`. Rang buoc "mat khau
 *     khong nam tren dong lenh" — ly do ban dau chon stdin — van duoc giu nguyen.
 *   - API tra ve MA LOI Win32 dang SO thay vi van ban tieng Anh phai do lai, nen chan doan hien ra
 *     cho nguoi dung cung dung hon.
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
 * SMB xac thuc o cap SHARE chu khong phai cap thu muc con, nen phai cat dung hai doan dau. Noi toi
 * ca duong dan sau se bao loi 67 (khong tim thay ten mang) — sai o kho tim.
 */
export function shareRootOf(inputPath: string): string | null {
  const unc = inputPath.replace(/\//g, "\\");
  if (!unc.startsWith("\\\\")) return null;

  const parts = unc.slice(2).split("\\").filter(Boolean);
  if (parts.length < 2) return null;
  return `\\\\${parts[0]}\\${parts[1]}`;
}

/**
 * Script PowerShell goi `WNetAddConnection2`. In ra DUNG mot dong `WNET=<ma Win32>`.
 *
 * `dwType = 0` (RESOURCETYPE_ANY) chu khong phai 1 (DISK): voi DISK thi share khong phai o dia —
 * `IPC$` chang han — tra ve 67 "khong tim thay ten mang", mot ma loi chi thang vao "sai ten share"
 * trong khi ten share hoan toan dung. Da do.
 *
 * `dwFlags = 0`: KHONG co CONNECT_UPDATE_PROFILE. Ket noi song theo phien dang nhap cua dich vu va
 * chet cung no — dung y do, khong de lai gi tren may sau khi go kho.
 *
 * `$ProgressPreference`: `Add-Type` bien dich lan dau ban mot ban ghi tien trinh ra stderr duoi
 * dang CLIXML. Khong tat thi moi lan noi kho lai do vao log mot khoi XML vo nghia.
 */
const PS_CONNECT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -Namespace MediaOS -Name Mpr -MemberDefinition @'
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct NETRESOURCE {
    public int dwScope; public int dwType; public int dwDisplayType; public int dwUsage;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpLocalName;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpRemoteName;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpComment;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpProvider;
}
[DllImport("mpr.dll", CharSet = CharSet.Unicode)]
public static extern int WNetAddConnection2(ref NETRESOURCE lpNetResource, string lpPassword, string lpUserName, int dwFlags);
'@
$nr = New-Object 'MediaOS.Mpr+NETRESOURCE'
$nr.dwType = 0
$nr.lpRemoteName = $env:MEDIAOS_SMB_SHARE
$code = [MediaOS.Mpr]::WNetAddConnection2([ref]$nr, $env:MEDIAOS_SMB_PASSWORD, $env:MEDIAOS_SMB_USER, 0)
[Console]::Out.Write("WNET=" + $code)
`;

const PS_CONNECT_ENCODED = Buffer.from(PS_CONNECT, "utf16le").toString("base64");

interface AttemptResult {
  ok: boolean;
  /** Van ban cho `explainNetError` doc. Voi loi Win32 la chuoi `System error <ma> has occurred.` */
  output: string;
}

/**
 * Noi toi `share` bang mot cap tai khoan. KHONG nem — tra ve ket qua de cho goi quyet dinh co thu
 * lai voi ten khac hay khong.
 */
function connectShare(share: string, username: string, password: string): AttemptResult {
  let raw: string;
  try {
    raw = execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", PS_CONNECT_ENCODED],
      {
        // Mat khau chi song trong khoi env cua tien trinh con. KHONG vao args, KHONG ghi ra dia.
        env: {
          ...process.env,
          MEDIAOS_SMB_SHARE: share,
          MEDIAOS_SMB_USER: username,
          MEDIAOS_SMB_PASSWORD: password,
        },
        encoding: "utf8",
        // Do duoc 07/08/2026: mat khau DUNG tra ve sau ~0,5s, nhung mat khau SAI mat toi ~23s moi bi
        // tu choi (Windows thu lai qua nhieu co che xac thuc truoc khi bo cuoc). 30s truot le ngay
        // dung ca hay gap nhat — va khi bi cat ngang thi khong co dong `WNET=` nao, nen loi hien ra
        // se la "khong chay duoc buoc dang nhap" thay vi "sai mat khau": sai han huong chan doan.
        timeout: 60_000,
        windowsHide: true,
        // Chi dinh `stdio` tuong minh de execFileSync KHONG do stderr cua con ra stderr cua dich
        // vu: khong co no thi moi loi PowerShell deu chay thang vao `social.err.log`.
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    raw = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim() || (e.message ?? "");
  }

  const code = raw.match(/WNET=(-?\d+)/)?.[1];
  if (code === undefined) {
    // Khong co dong ket qua = PowerShell chet truoc khi goi duoc API (thieu trinh bien dich cho
    // Add-Type, bi chan chay script…). Day KHONG phai loi dang nhap, va KHONG duoc de no roi vao
    // nhanh "sai mat khau": nguoi dung se doi mat khau ca buoi trong khi loi nam o may chu.
    return {
      ok: false,
      output: `Không chạy được bước đăng nhập ổ chia sẻ trên máy chủ. ${raw}`.trim(),
    };
  }
  if (code === "0") return { ok: true, output: "" };

  // Dan ve dung dang van ban cua `net` de dung chung mot bang dich loi — bang do da doi chieu voi
  // loi that tren PROD, khong viet lai lam gi.
  return { ok: false, output: `System error ${code} has occurred.` };
}

/** Ngat ket noi. Khong dinh gi toi mat khau nen `net use /delete` la du va don gian nhat. */
function disconnectShare(share: string): void {
  try {
    execFileSync("net", ["use", share, "/delete", "/y"], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    // Khong co ket noi de go la truong hop BINH THUONG (goi khi don dep truoc luc noi lai).
  }
}

/**
 * Loi dang nhap — nhanh duy nhat duoc thu lai voi ten tai khoan day du.
 *
 * PHAI gom ca `System error 86` (ERROR_INVALID_PASSWORD). Ban dau chi bat 1326 nen mot lan tu choi
 * vi mat khau KHONG duoc coi la loi dang nhap: vua khong thu lai voi ten day du, vua roi xuong
 * nhanh cuoi cua `explain()` va nem nguyen dong tieng Anh ra man hinh nguoi dung.
 */
function isLogonFailure(output: string): boolean {
  return /System error (86|1326|1327|1331)\b|logon failure|user name or password|network password is not correct/i.test(
    output,
  );
}

/**
 * Tai khoan bi KHOA vi go sai nhieu lan — khac han moi loi dang nhap khac o cho: thu lai KHONG bao
 * gio thanh cong, va moi lan thu con keo dai them thoi gian khoa. Phai tach ra de (1) khong thu lai
 * voi ten day du, (2) noi voi nguoi dung la dung go nua.
 */
function isLockedOut(output: string): boolean {
  return /System error 1909\b|account is currently locked out/i.test(output);
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

/** Dich ma loi Win32 sang cau nguoi dung hieu duoc. */
export function explainNetError(output: string): string {
  // Xet TRUOC 86/1326: may dich tra 1909 ke ca khi mat khau vua go la dung, nen neu de no roi vao
  // nhanh "sai mat khau" thi nguoi dung se ngoi doi mat khau — trong khi viec phai lam la NGUNG go.
  if (isLockedOut(output)) {
    return 'Tài khoản đã bị KHOÁ trên máy chứa thư mục do sai mật khẩu nhiều lần. Đừng thử thêm — mỗi lần thử lại kéo dài thời gian khoá. Đợi khoảng 10–30 phút cho hết khoá, hoặc mở khoá ngay trên máy đó (lusrmgr.msc → Users → bỏ dấu "Account is locked out"), rồi nhập lại đúng mật khẩu.';
  }
  // 86 noi RIENG ve mat khau; 1326 mo ho giua ten va mat khau. Gop hai cai lam mot se lam mat dung
  // manh thong tin quy nhat: biet chac tai khoan ton tai va chi mat khau sai.
  if (/System error 86\b|network password is not correct/i.test(output)) {
    // Nhac PIN o day chu khong o cho khac: 86 la ma DUY NHAT khang dinh tai khoan co that va chi
    // mat khau sai — dung luc de noi ra nguyen nhan hay gap nhat cua tinh huong do.
    return "Mật khẩu không đúng (tài khoản có tồn tại). Kiểm tra lại mật khẩu của tài khoản đó trên chính máy chứa thư mục. Nếu máy đó đăng nhập bằng mã PIN thì mật khẩu ở đây là MẬT KHẨU tài khoản, không phải PIN.";
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
  if (/System error 53\b|network path was not found/i.test(output)) {
    return "Không thấy máy trong mạng. Kiểm tra tên máy và xem máy đó đã bật chưa.";
  }
  if (/System error 67\b|network name cannot be found/i.test(output)) {
    // Windows tra dung ma 67 cho CA "sai ten may" lan "sai ten thu muc chia se" (do thi nghiem:
    // //MAY-KHONG-CO-THAT/share cung ra 67 chu khong ra 53). Neu chi noi "kiem tra ten share" thi
    // mot nua so truong hop bi day di sai huong — nen noi ca hai.
    return "Không thấy thư mục chia sẻ. Kiểm tra cả tên máy lẫn tên thư mục chia sẻ, và xem máy đó đã bật chưa.";
  }
  if (/System error 5\b|Access is denied/i.test(output)) {
    return "Tài khoản đăng nhập được nhưng không được phép truy cập thư mục chia sẻ này.";
  }
  if (/System error 1219\b|Multiple connections/i.test(output)) {
    return "Máy chủ đang có sẵn một kết nối khác tới máy này bằng tài khoản khác.";
  }
  return output.split("\n")[0]?.trim() || "Không kết nối được tới ổ chia sẻ.";
}

export class NetConnectError extends Error {}

/**
 * Bao dam da co phien SMB toi share chua `dirPath`.
 *
 * - Duong dan cuc bo → khong lam gi.
 * - Da noi trong tien trinh nay → khong lam gi (tranh goi lai moi lan duyet thu muc).
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
  const attempt = (user: string) => connectShare(share, user, credential.password);

  let result = attempt(username);

  if (!result.ok && /1219|Multiple connections/i.test(result.output)) {
    // Windows khong cho mot phien dang nhap giu hai ket noi toi cung mot may bang hai tai khoan
    // khac nhau. Go ket noi cu roi noi lai — day la ket noi cua CHINH tien trinh dich vu, khong
    // dong cham gi toi phien lam viec cua nguoi dung tren may.
    disconnectShare(share);
    result = attempt(username);
  }

  /**
   * Thu lai voi ten tai khoan CO PHAN MAY: `DESKTOP-XXX\ADMIN`.
   *
   * Vi sao can: khi ten tai khoan khong co phan may/mien, Windows gui kem domain la ten MAY CHU
   * (may dang chay dich vu) chu khong phai may dich. Voi hai may workgroup — dung mo hinh o day —
   * may dich khong biet `NASHP\ADMIN` la ai va tra ve 1326, tuc "sai tai khoan hoac mat khau", DU
   * mat khau hoan toan dung.
   *
   * `isLockedOut` chan tuong minh du `isLogonFailure` hien khong khop 1909: mot lan noi long cai
   * regex kia (rat de xay ra vi no da phinh mot lan) se bien moi lan bam "Thêm kho" thanh HAI lan
   * dang nhap sai — lap day bo dem khoa nhanh gap doi, bang chinh co che sinh ra de giup.
   */
  const qualified = qualifyUsername(share, username);
  if (
    !result.ok &&
    isLogonFailure(result.output) &&
    !isLockedOut(result.output) &&
    qualified !== username
  ) {
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
  disconnectShare(share);
}
