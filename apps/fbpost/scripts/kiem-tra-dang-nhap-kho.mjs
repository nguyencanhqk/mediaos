import { execFileSync } from "node:child_process";
import readline from "node:readline";

/**
 * Kiem chung mot cap tai khoan/mat khau cua o chia se — NGOAI app.
 *
 * ── VI SAO CAN ──
 * Khi giao dien bao "sai tai khoan hoac mat khau" ma nguoi dung chac chan mat khau dung, co DUNG HAI
 * kha nang, va chung doi hoi hai viec sua khac han nhau:
 *   (A) cap tai khoan/mat khau that su bi may kia tu choi  → viec o may chua thu muc
 *   (B) cap do DUNG, nhung duong dua mat khau cua app lam hong no → viec o code
 * Khong tach duoc hai cai nay thi se sua mo: doi mat khau nhieu lan (lam khoa tai khoan) trong khi
 * loi nam o code, hoac nguoc lai.
 *
 * Script chay dung hai phep thu, theo thu tu, va DUNG NGAY khi phep dau that bai:
 *   1. mat khau dua qua THAM SO dong lenh — duong "chuan", giong het go `net use` bang tay
 *   2. mat khau dua qua STDIN dang UTF-8 — dung y het `lib/library/net-connect.ts` cua app
 *
 *   1 do  → (A): cap tai khoan sai. Khong thu tiep, khoi lam day bo dem khoa tai khoan.
 *   1 xanh, 2 do  → (B): loi o app, khong phai o mat khau.
 *   1 xanh, 2 xanh → co che chay duoc tu phien co console; khac biet nam o moi truong dich vu.
 *
 * ── AN TOAN ──
 * - Toi da 2 lan dang nhap. Windows khoa tai khoan sau vai lan sai (ma 1909), moi lan thu them con
 *   keo dai thoi gian khoa — nen script khong bao gio "thu lai cho chac".
 * - Mat khau KHONG hien khi go va KHONG BAO GIO duoc in ra. Chi in do dai va co ky tu ngoai ASCII
 *   khong — hai thong tin nay du de nhan ra loi go nham ma khong lo mat khau ra man hinh/log.
 * - Ket noi tao ra deu duoc ngat o cuoi.
 *
 * ── DUNG ──
 *   node scripts/kiem-tra-dang-nhap-kho.mjs "//TÊN-MÁY/tên-share" "TÊN-MÁY\tài-khoản"
 *
 * MEO: neu may chu DA co san ket noi (hoac credential da luu) toi may do bang tai khoan khac,
 * Windows tra loi 1219 — khong cho hai bo thong tin dang nhap toi cung mot may. Dung DIA CHI IP
 * thay cho ten may de tranh: Windows coi `\\10.0.0.5` va `\\TÊN-MÁY` la hai dich khac nhau, nen
 * phep thu di duong rieng, khong dung den credential da luu cho ten may.
 */

/** `\\MAY\share\thu\muc` → `\\MAY\share`. SMB xac thuc o cap SHARE, khong phai thu muc con. */
function shareRootOf(inputPath) {
  const unc = inputPath.replace(/\//g, "\\");
  if (!unc.startsWith("\\\\")) return null;
  const parts = unc.slice(2).split("\\").filter(Boolean);
  if (parts.length < 2) return null;
  return `\\\\${parts[0]}\\${parts[1]}`;
}

function runNet(args, stdinPassword) {
  try {
    const out = execFileSync("net", args, {
      input: stdinPassword === undefined ? undefined : `${stdinPassword}\r\n`,
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
      // Chan `net` in stderr thang ra man hinh: script tu in ket luan, hai dong tieng Anh chen vao
      // giua chi lam nguoi doc tuong da hong.
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { ok: true, output: out };
  } catch (error) {
    return { ok: false, output: `${error.stderr ?? ""}${error.stdout ?? ""}`.trim() };
  }
}

function disconnect(share) {
  runNet(["use", share, "/delete", "/y"]);
}

/** Lay ma loi so cua `net` de doi chieu — dong tieng Anh phia sau doi theo ngon ngu Windows. */
function codeOf(output) {
  return output.match(/System error (\d+)/)?.[1] ?? "?";
}

/** Doc mat khau ma KHONG hien ky tu nao ra man hinh. */
function askPassword(prompt) {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // In loi nhac TRUOC roi bit hoan toan duong ve cua readline: `_writeToOutput` la cho duy nhat
    // readline ve lai ky tu vua go, nen de no im lang la mat khau khong bao gio hien tren man hinh
    // (va khong nam lai trong lich su cuon cua cua so terminal).
    rl._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}

const [rawPath, username] = process.argv.slice(2);
if (!rawPath || !username) {
  console.error(
    'Dung: node scripts/kiem-tra-dang-nhap-kho.mjs "//TÊN-MÁY/tên-share" "TÊN-MÁY\\tài-khoản"',
  );
  process.exit(2);
}

const share = shareRootOf(rawPath);
if (!share) {
  console.error(
    `"${rawPath}" khong phai duong dan mang. Phai co dang //MAY/share hoac \\\\MAY\\share.`,
  );
  process.exit(2);
}

const password = await askPassword("Mat khau (go xong bam Enter, khong hien ra): ");
if (password === "") {
  console.error("Chua nhap mat khau.");
  process.exit(2);
}

console.log("");
console.log(`Share      : ${share}`);
console.log(`Tai khoan  : ${username}`);
console.log(
  `Mat khau   : ${password.length} ky tu, ${Buffer.byteLength(password, "utf8")} byte UTF-8` +
    (Buffer.byteLength(password, "utf8") === password.length
      ? " (thuan ASCII)"
      : " ⚠ CO KY TU NGOAI ASCII — day chinh la loai ky tu de bi dich sai tren duong truyen"),
);
if (/^\s|\s$/.test(password)) {
  console.log("⚠ Mat khau co khoang trang o dau hoac cuoi — rat de la do dan nham.");
}
console.log("");

// ── Phep thu 1: mat khau qua THAM SO (duong chuan) ────────────────────────────────────────────
disconnect(share);
console.log("① Thu bang cach chuan (mat khau la tham so, giong go net use bang tay)…");
const direct = runNet(["use", share, password, `/user:${username}`]);
disconnect(share);

if (!direct.ok) {
  console.log(`   ✗ THAT BAI — mã ${codeOf(direct.output)}`);
  console.log("");
  console.log(
    "KET LUAN: cap tai khoan/mat khau nay bi CHINH MAY KIA tu choi — khong phai loi app.",
  );
  console.log("DUNG thu them: Windows khoa tai khoan sau vai lan sai (mã 1909) va moi lan thu lai");
  console.log("keo dai them thoi gian khoa.");
  console.log("");
  console.log("Kiem tra tren may chua thu muc:");
  console.log("  · ten tai khoan co dung khong  → mo Command Prompt tren may do, go: net user");
  console.log(
    "  · neu may do dang nhap bang ma PIN thi MAT KHAU tai khoan la thu khac, khong phai PIN",
  );
  console.log(
    "  · neu la tai khoan Microsoft thi ten dang nhap la dia chi email, khong phai ten hien thi",
  );
  console.log(
    "  · tai khoan co dang bi khoa khong  → lusrmgr.msc → Users → bo dau 'Account is locked out'",
  );
  process.exit(1);
}

console.log("   ✓ VAO DUOC — cap tai khoan/mat khau nay ĐUNG.");
console.log("");

// ── Phep thu 2: mat khau qua STDIN, y het app ─────────────────────────────────────────────────
console.log("② Thu bang dung duong cua app (mat khau qua stdin, UTF-8)…");
const piped = runNet(["use", share, "*", `/user:${username}`], password);
disconnect(share);

if (piped.ok) {
  console.log("   ✓ VAO DUOC.");
  console.log("");
  console.log(
    "KET LUAN: ca hai duong deu chay tu day. Cap tai khoan dung, co che dua mat khau dung.",
  );
  console.log("Khac biet con lai nam o MOI TRUONG DICH VU (dich vu MediaOS-Social chay bang");
  console.log("LocalSystem, khong co console) — bao lai de kiem tiep phia do.");
} else {
  console.log(`   ✗ THAT BAI — mã ${codeOf(piped.output)}`);
  console.log("");
  console.log("KET LUAN: mat khau ĐUNG nhung duong dua mat khau cua app lam hong no.");
  console.log("Day la LOI CODE trong lib/library/net-connect.ts, khong phai loi mat khau.");
  process.exit(1);
}
