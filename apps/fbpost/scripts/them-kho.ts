import fs from "node:fs";
import { ensureShareConnection, NetConnectError } from "../src/lib/library/net-connect";
import { libraryRoots, normalizeRootPath } from "../src/lib/library/roots";
import { addStoredRoot, credentialFor } from "../src/lib/library/roots-store";

/**
 * Them mot thu muc kho video tu DONG LENH, khong qua giao dien.
 *
 * Dung khi nao: giao dien khong vao duoc (chua dang nhap duoc, dich vu dang hong), hoac khi nguoi
 * van hanh muon khai kho ngay luc cai dat. Duong giao dien (`POST /api/library/roots`) van la duong
 * chinh — script nay lam DUNG cac buoc do, khong bo qua buoc nao:
 *   chuan hoa duong dan → dang nhap that vao o chia se → doc thu thu muc → moi luu.
 *
 * Va lam THEM mot buoc nua ma giao dien khong lam: doc lai ban ghi VUA LUU, giai ma mat khau tu do
 * ra roi dang nhap LAI bang chinh no. Khong co buoc nay thi "luu thanh cong" chi chung minh rang
 * ghi duoc vao CSDL — con viec ban ghi do co dung duoc hay khong thi phai doi den lan khoi dong sau
 * moi biet, dung kieu that bai tri hoan da tung xay ra o day.
 *
 * ── DUNG ──
 *   $env:SMB_PASSWORD = '...'
 *   node_modules\.bin\vite-node scripts/them-kho.ts -- "Tên hiển thị" "//MÁY/share/thư-mục" "MÁY\tài-khoản"
 *
 * Mat khau lay tu bien moi truong `SMB_PASSWORD`, KHONG nhan qua tham so: tham so nam tren dong
 * lenh cua tien trinh va ai cung doc duoc, con bien moi truong thi phai co quyen Administrator.
 * Cung ly do voi cach `net-connect.ts` dua mat khau cho Windows.
 */

/**
 * `--bo-qua-dang-nhap-thu`: BO buoc dang nhap thu, van luu.
 *
 * Chi dung cho DUNG MOT tinh huong, va no la tinh huong cua nguoi van hanh chu khong phai cua dich
 * vu: phien Windows dang chay script da co san credential/ket noi toi may do, nen Windows tra 1219
 * ("credential xung dot") cho MOI lan dang nhap bang mat khau khac — ke ca mat khau dung. Dich vu
 * chay o phien dang nhap RIENG, khong co xung dot nay, nen han che o day khong noi gi ve viec kho
 * co dung duoc hay khong.
 *
 * Doi lai, kho luu ra CHUA duoc kiem chung o tang mang. Buoc kiem chung that se do chinh dich vu
 * lam khi khoi dong: trang Kho video hien "Đọc được · N mục" hay mot loi cu the.
 */
const argv = process.argv.slice(2).filter((a) => a !== "--");
const skipLogin = argv.includes("--bo-qua-dang-nhap-thu");
const [label, rawPath, username] = argv.filter((a) => !a.startsWith("--"));
const password = process.env.SMB_PASSWORD ?? "";

if (!label || !rawPath) {
  console.error('Dung: vite-node scripts/them-kho.ts -- "Tên" "//MÁY/share/thư-mục" ["MÁY\\tài-khoản"]');
  console.error("Mat khau dat o bien moi truong SMB_PASSWORD.");
  process.exit(2);
}
if (username && password === "") {
  console.error("Co ten tai khoan thi phai dat ca SMB_PASSWORD.");
  process.exit(2);
}

const normalized = normalizeRootPath(rawPath);
const credential = username ? { username, password } : null;

console.log(`Kho       : ${label}`);
console.log(`Duong dan : ${normalized}`);
console.log(`Tai khoan : ${username || "(khong can — thu muc cuc bo)"}`);
console.log("");

if (skipLogin) {
  console.log("① Dang nhap thu: BO QUA (--bo-qua-dang-nhap-thu)");
  console.log("   ⚠ Kho se duoc luu MA CHUA kiem chung o tang mang.");
  console.log("   ⚠ Kiem chung that: khoi dong lai dich vu roi mo trang Kho video — phai thay");
  console.log('   ⚠ "Đọc được · N mục". Thay bat ky thong bao nao khac tuc la chua xong.');
} else {
  console.log("① Dang nhap vao o chia se…");
  try {
    ensureShareConnection(normalized, credential, { force: true });
    console.log("   ✓ dang nhap duoc");
  } catch (error) {
    console.error(`   ✗ ${error instanceof NetConnectError ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log("② Doc thu thu muc…");
  try {
    const count = fs.readdirSync(fs.realpathSync.native(normalized), { withFileTypes: true }).length;
    console.log(`   ✓ doc duoc ${count} muc`);
  } catch (error) {
    console.error(`   ✗ ${(error as NodeJS.ErrnoException).code ?? String(error)}`);
    console.error("   Dang nhap duoc nhung khong vao duoc thu muc — tai khoan thieu quyen tren chinh thu muc do.");
    process.exit(1);
  }
}

console.log("③ Luu vao danh sach kho…");
const saved = addStoredRoot(label, normalized, credential);
console.log(`   ✓ da luu, khoa = ${saved.key}`);

console.log("④ Doc lai ban ghi vua luu va dang nhap LAI bang chinh no…");
const reloaded = libraryRoots().find((r) => r.key === saved.key);
if (!reloaded) {
  console.error("   ✗ khong doc lai duoc kho vua luu");
  process.exit(1);
}
const storedCredential = credentialFor(saved.key);
if (credential && !storedCredential) {
  console.error("   ✗ mat khau khong giai ma lai duoc (KEK lech?) — kho nay se chet o lan khoi dong sau");
  process.exit(1);
}
// Kiem TUNG PHAN chu khong chi "co giai ma duoc khong": mot ban ghi giai ma ra chuoi KHAC voi cai
// vua nhap van "giai ma duoc" binh thuong, roi chet o tang mang voi thong bao "sai mat khau" —
// dung kieu that bai tri hoan da lam mat ca buoi hom nay.
if (credential && storedCredential) {
  const sameUser = storedCredential.username === credential.username;
  const samePassword = storedCredential.password === credential.password;
  if (!sameUser || !samePassword) {
    console.error(`   ✗ ban ghi doc lai KHONG khop cai vua nhap (ten khop: ${sameUser}, mat khau khop: ${samePassword})`);
    process.exit(1);
  }
  console.log("   ✓ tai khoan + mat khau doc lai KHOP nguyen ven cai vua nhap");
}

if (skipLogin) {
  console.log("");
  console.log(`DA LUU kho "${reloaded.label}" — CHUA kiem chung o tang mang (xem canh bao o buoc ①).`);
} else {
  try {
    ensureShareConnection(reloaded.path, storedCredential, { force: true });
    const recount = fs.readdirSync(fs.realpathSync.native(reloaded.path), { withFileTypes: true }).length;
    console.log(`   ✓ ban ghi da luu dung dung duoc — doc lai ${recount} muc`);
  } catch (error) {
    console.error(`   ✗ ${error instanceof NetConnectError ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log("");
  console.log(`XONG. Kho "${reloaded.label}" san sang dung.`);
}
