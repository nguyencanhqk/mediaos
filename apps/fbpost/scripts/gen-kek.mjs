#!/usr/bin/env node
/**
 * Sinh file KEK 32 byte cho secret-box (ma hoa token Facebook trong SQLite).
 *
 *   node scripts/gen-kek.mjs                 → tao .secrets/fbpost-kek.bin
 *   SOCIAL_KEK_PATH=... node scripts/gen-kek.mjs
 *
 * TU CHOI ghi de file da ton tai. Ghi de KEK = MAT TRANG toan bo token da ma hoa (khong the
 * giai ma lai duoc nua, phai ket noi lai tung tai khoan Facebook). Muon xoay khoa that su thi
 * phai giai ma bang khoa cu roi ma hoa lai bang khoa moi — chua co trong pham vi wave S9.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const path = process.env.SOCIAL_KEK_PATH ?? ".secrets/fbpost-kek.bin";

if (existsSync(path)) {
  console.error(`TU CHOI: '${path}' da ton tai.`);
  console.error("Ghi de KEK se lam moi token da ma hoa thanh rac vinh vien.");
  console.error("Neu that su muon tao khoa moi: doi ten file cu di truoc, roi chay lai.");
  process.exit(1);
}

mkdirSync(dirname(path), { recursive: true });
// mode 0600: chi chu so huu doc duoc. Tren Windows co nay bi bo qua — bao ve o day dua vao
// ACL cua thu muc, khong dua vao bit quyen POSIX.
writeFileSync(path, randomBytes(32), { mode: 0o600 });

console.log(`Da tao KEK 32 byte tai '${path}'.`);
console.log("SAO LUU file nay o noi an toan va TACH KHOI ban sao luu cua data/fbpost.db —");
console.log("mat KEK = mat toan bo token da ma hoa.");
