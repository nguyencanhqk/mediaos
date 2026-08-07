import { NextResponse } from "next/server";

/**
 * Dieu huong NOI BO bang `Location` TUONG DOI.
 *
 * VI SAO PHAI CO HAM NAY (bug that, do duoc 06/08/2026 sau khi mo domain): fbpost dung sau
 * Cloudflare tunnel — cloudflared chuyen tiep toi `http://localhost:3500`, nen Next thay
 * `Host: localhost:3500` va `request.nextUrl.origin` thanh `https://localhost:3500`. Dung no de
 * dung URL tuyet doi thi nguoi dung bi day toi `https://localhost:3500/...` — mot dia chi khong
 * ton tai tren may ho (cong 3500 khong co TLS) ⇒ `ERR_SSL_PROTOCOL_ERROR`.
 *
 * `Location` tuong doi duoc trinh duyet giai theo URL YEU CAU (chinh la URL cong khai), nen dung
 * o MOI cach trien khai: localhost, sau tunnel, sau reverse-proxy, doi domain — khong can cau hinh
 * gi them, khong phai tin `X-Forwarded-Host` (header do gia duoc neu khong dung sau proxy tin cay).
 *
 * Middleware KHONG dinh loi nay: Next tu chuan hoa redirect cung-goc trong middleware thanh tuong
 * doi. Chi route handler moi phat nguyen URL tuyet doi minh dua vao — nen thay middleware chay
 * dung KHONG suy ra route handler chay dung.
 *
 * CHI dung cho duong dan noi bo. Chuyen huong ra ngoai (vi du sang dialog OAuth cua Facebook)
 * bat buoc phai la URL tuyet doi — dung `NextResponse.redirect()` cho ca do.
 */
export function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/** Dieu huong ve mot trang noi bo kem tham so truy van — tu ma hoa gia tri. */
export function redirectToPath(path: string, params: Record<string, string>): NextResponse {
  const query = new URLSearchParams(params).toString();
  return redirectTo(query ? `${path}?${query}` : path);
}
