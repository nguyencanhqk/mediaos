/**
 * Ai duoc CAU HINH kho video.
 *
 * fbpost khong co mo hinh vai tro trong app: phien la nhi phan — vao duoc thi lam duoc moi thu.
 * Voi hau het man hinh dieu do chap nhan duoc (moi nguoi vao day deu de dang bai). Nhung "them
 * mot thu muc goc" thi KHAC HAN: no la quyen tu mo rong pham vi file ma may chu duoc doc. Cho
 * moi nguoi lam viec do thi ca lop whitelist tro thanh mot cai nut "cho toi doc file bat ky tren
 * may chu" — dung thu ma no sinh ra de chan.
 *
 * Nen cong nay tach rieng va dua tren DANH SACH EMAIL trong env. Email lay tu phien do MediaOS
 * cap (`SessionPayload.email`, ky HMAC) — client khong tu khai duoc.
 *
 * `SOCIAL_ADMIN_EMAILS`: cac email ngan cach bang dau phay hoac cham phay.
 * KHONG dat = KHONG AI cau hinh duoc (fail-closed). Khi do kho van chay binh thuong bang
 * `SOCIAL_MEDIA_LIBRARY_DIRS` — tuc la lui ve dung hanh vi truoc khi co man cau hinh, chu khong
 * phai mo toang cho tat ca.
 *
 * ĐAY LA GIAI PHAP TAM DUNG MUC: dung han thi phien SSO nen mang theo capability tu MediaOS de
 * dung dung cap quyen `manage:social-account` (da seed, is_sensitive=true, hien KHONG duoc doc o
 * dau ca). Xem WO S10-SOCIAL-LIB-2.
 */
export function adminEmails(): string[] {
  const raw = process.env.SOCIAL_ADMIN_EMAILS;
  if (!raw) return [];
  return raw
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e !== "");
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = adminEmails();
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
