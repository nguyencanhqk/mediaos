import { NextRequest } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { consumeSsoToken } from "@/lib/auth/sso";
import { redirectTo } from "@/lib/http/relative-redirect";
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
 * Dieu huong bang `Location` TUONG DOI, KHONG dung `NextResponse.redirect(new URL(..., origin))` —
 * ly do day du nam trong `lib/http/relative-redirect` (bug that do duoc 06/08/2026 sau khi mo domain).
 */
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
