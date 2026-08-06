import { NextRequest } from "next/server";
import { exchangeCodeForUserToken } from "@/lib/fb/auth";
import { connectAccount, resolveLoginApp } from "@/lib/fb/connect";
import { OAUTH_STATE_COOKIE, resolveRedirectUri } from "@/lib/fb/oauth";
import { redirectToPath } from "@/lib/http/relative-redirect";
// Import gay hieu ung phu: khoi dong worker hen gio khi route dau tien duoc nap.
import "@/lib/worker-boot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Facebook goi ve day sau khi nguoi dung bam Dong y.
 *
 * Doi authorization code sang token, nap tai khoan va toan bo Page cua no,
 * roi dua nguoi dung ve trang Cai dat kem ket qua. Moi ket thuc deu la mot
 * lan chuyen huong - nguoi dung khong bao gio nhin thay JSON.
 *
 * Chuyen huong ve /settings dung `Location` TUONG DOI: dung sau tunnel, URL tuyet doi dung tu
 * request se tro toi `https://localhost:3500` (xem `lib/http/relative-redirect`).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const failWith = (message: string) => {
    const response = redirectToPath("/settings", { loginError: message });
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  };

  // Nguoi dung bam Huy, hoac Facebook tu choi.
  const oauthError = params.get("error_description") ?? params.get("error");
  if (oauthError) {
    return failWith(`Facebook từ chối yêu cầu đăng nhập: ${oauthError}`);
  }

  const code = params.get("code");
  if (!code) return failWith("Không nhận được mã đăng nhập từ Facebook. Thử đăng nhập lại.");

  const state = params.get("state");
  const expectedState = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    return failWith(
      "Phiên đăng nhập không khớp hoặc đã quá hạn (10 phút). Bấm Đăng nhập bằng Facebook lại từ đầu.",
    );
  }

  try {
    const app = resolveLoginApp();
    if (!app) return failWith("Chưa lưu App ID và App Secret.");

    const userToken = await exchangeCodeForUserToken(
      app.appId,
      app.appSecret,
      // PHAI la dung chuoi da gui o buoc /start - Facebook doi chieu tung ky tu khi doi code.
      resolveRedirectUri("local", request.nextUrl.origin),
      code,
    );

    const result = await connectAccount({
      appId: app.appId,
      appSecret: app.appSecret,
      userToken,
    });

    const outcome: Record<string, string> = {
      connected: result.account.name,
      pages: String(result.account.pageCount),
      added: String(result.added),
    };
    if (result.missingScopes.length > 0) {
      outcome.missingScopes = result.missingScopes.join(",");
    }

    const response = redirectToPath("/settings", outcome);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    console.error("[auth]", error);
    return failWith(error instanceof Error ? error.message : "Kết nối tài khoản thất bại.");
  }
}
