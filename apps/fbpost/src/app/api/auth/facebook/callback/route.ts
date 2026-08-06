import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForUserToken } from "@/lib/fb/auth";
import { connectAccount, resolveLoginApp } from "@/lib/fb/connect";
import { OAUTH_STATE_COOKIE, resolveRedirectUri } from "@/lib/fb/oauth";
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
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const settingsPage = new URL("/settings", origin);
  const params = request.nextUrl.searchParams;

  const failWith = (message: string) => {
    settingsPage.searchParams.set("loginError", message);
    const response = NextResponse.redirect(settingsPage);
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
      resolveRedirectUri("local", origin),
      code,
    );

    const result = await connectAccount({
      appId: app.appId,
      appSecret: app.appSecret,
      userToken,
    });

    settingsPage.searchParams.set("connected", result.account.name);
    settingsPage.searchParams.set("pages", String(result.account.pageCount));
    settingsPage.searchParams.set("added", String(result.added));
    if (result.missingScopes.length > 0) {
      settingsPage.searchParams.set("missingScopes", result.missingScopes.join(","));
    }

    const response = NextResponse.redirect(settingsPage);
    response.cookies.delete(OAUTH_STATE_COOKIE);
    return response;
  } catch (error) {
    console.error("[auth]", error);
    return failWith(error instanceof Error ? error.message : "Kết nối tài khoản thất bại.");
  }
}
