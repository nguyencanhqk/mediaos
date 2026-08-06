import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { consumeSsoToken } from "@/lib/auth/sso";
// Import gay hieu ung phu: khoi dong worker hen gio khi route dau tien duoc nap.
import "@/lib/worker-boot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/sso?token=... — DUONG DUY NHAT tao ra phien trong fbpost.
 *
 * MediaOS phat token (SocialSsoService), nguoi dung dap xuong day, ta doi lay mot cookie phien
 * 8 tieng roi cho di tiep vao trang chu.
 *
 * Day cung la duong DUY NHAT nam trong allowlist cua middleware — moi duong khac deu doi phien.
 *
 * KHONG bao gio noi ro vi sao token hong (chu ky sai / het han / da dung roi) ra ngoai: ba ly do
 * do phan biet duoc la mot kenh do thong tin cho ke thu token. Nguoi dung that chi can biet "hay
 * quay lai MediaOS bam lai", va log server thi ghi du chi tiet de chan doan.
 */
/**
 * Dieu huong bang `Location` TUONG DOI, KHONG dung `NextResponse.redirect(new URL(..., origin))`.
 *
 * VI SAO (bug that, do duoc 06/08/2026 sau khi mo domain): fbpost dung sau Cloudflare tunnel —
 * cloudflared chuyen tiep toi `http://localhost:3500`, nen Next thay `Host: localhost:3500` va
 * `request.nextUrl.origin` thanh `https://localhost:3500`. Dung no de dung URL tuyet doi thi
 * nguoi dung dang nhap XONG se bi day toi `https://localhost:3500/` — mot dia chi khong ton tai
 * tren may ho. Cookie dat dung, ma van khong vao duoc.
 *
 * `Location` tuong doi duoc trinh duyet giai theo URL YEU CAU (chinh la URL cong khai), nen dung
 * o MOI cach trien khai: localhost, sau tunnel, sau reverse-proxy, doi domain — khong can cau hinh
 * gi them, khong phai tin `X-Forwarded-Host` (header do gia duoc neu khong dung sau proxy tin cay).
 *
 * Middleware KHONG dinh loi nay: Next tu chuan hoa redirect cung-goc trong middleware thanh tuong
 * doi. Chi route handler moi phat nguyen URL tuyet doi minh dua vao.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return redirectTo("/login?error=missing-token");
  }

  const result = consumeSsoToken(token);
  if (!result.ok) {
    // Ly do chi tiet chi di vao log server, khong ra URL/response.
    console.warn("[sso] tu choi token:", result.reason);
    return redirectTo("/login?error=invalid-token");
  }

  const session = await signSession({
    sub: result.payload.sub,
    email: result.payload.email,
    name: result.payload.name ?? "",
  });

  const response = redirectTo("/");
  response.cookies.set(SESSION_COOKIE, session, sessionCookieOptions(SESSION_TTL_SECONDS));
  return response;
}
