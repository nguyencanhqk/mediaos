import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * Cong phien cho toan bo fbpost.
 *
 * MAC DINH LA DONG: moi duong dan deu can phien hop le, tru dung nhung gi liet ke o
 * `PUBLIC_PATHS`. Viet theo chieu nay (allowlist) chu khong phai "chan mot vai duong nhay cam"
 * de mot route them vao ngay mai duoc bao ve san — khong phu thuoc vao viec nguoi them nho sua
 * file nay.
 *
 * ⚠️ `/api/auth/facebook/callback` KHONG nam trong allowlist, va do la CO Y. Nguoi dung bam
 * "ket noi Facebook" khi DA co phien, nen luc Facebook chuyen huong nguoc ve thi cookie phien
 * van con — cookie dat `SameSite=Lax` nen van duoc gui kem trong dieu huong GET cap cao nhat.
 * De callback mo la mo mot cua khong can thiet.
 */

const PUBLIC_PATHS = [
  // Duong DUY NHAT tao ra phien: cau SSO tu MediaOS. Tu no da xac minh chu ky HMAC + jti mot-lan.
  "/api/auth/sso",
  // Trang giai thich "hay vao tu MediaOS" — khong doc du lieu gi.
  "/login",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  if (session) return NextResponse.next();

  // API tra ve 401 JSON; trang tra ve dieu huong. Tra HTML cho mot loi goi fetch se hien ra
  // duoi dang loi phan tich JSON kho hieu o phia client.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Chua dang nhap. Hay mo ung dung tu MediaOS." },
      { status: 401 },
    );
  }

  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  /**
   * Bo qua tai nguyen tinh cua Next va favicon. KHONG bo qua `/api` — do moi la cho can gac nhat.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
