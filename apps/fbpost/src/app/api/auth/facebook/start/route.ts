import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveLoginApp } from "@/lib/fb/connect";
import {
  buildAuthorizeUrl,
  OAUTH_STATE_COOKIE,
  resolveRedirectUri,
  type OAuthMode,
} from "@/lib/fb/oauth";
import { getSettings } from "@/lib/repo/settings-repo";
// Import gay hieu ung phu: khoi dong worker hen gio khi route dau tien duoc nap.
import "@/lib/worker-boot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mo cua so dang nhap Facebook.
 *
 * Khong tra ve JSON: trinh duyet di thang sang Facebook nen day la mot lan
 * chuyen huong. Loi cung chuyen huong nguoc ve trang Cai dat kem thong bao,
 * de nguoi dung khong nhin thay JSON tho.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const settingsPage = new URL("/settings", origin);

  try {
    const app = resolveLoginApp();
    if (!app) {
      settingsPage.searchParams.set(
        "loginError",
        "Chưa lưu App ID và App Secret. Điền hai ô đó rồi bấm Lưu trước khi đăng nhập.",
      );
      return NextResponse.redirect(settingsPage);
    }

    const mode: OAuthMode =
      request.nextUrl.searchParams.get("mode") === "desktop" ? "desktop" : "local";
    const state = `${mode}.${crypto.randomBytes(16).toString("hex")}`;

    const target = buildAuthorizeUrl({
      appId: app.appId,
      redirectUri: resolveRedirectUri(mode, origin),
      state,
      graphVersion: getSettings().graphVersion,
      configId: app.configId || undefined,
    });

    const response = NextResponse.redirect(target);
    // Chong CSRF: Facebook tra lai chuoi state nay, phai khop voi cookie.
    response.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 600,
    });
    return response;
  } catch (error) {
    console.error("[auth]", error);
    settingsPage.searchParams.set(
      "loginError",
      error instanceof Error ? error.message : "Không mở được cửa sổ đăng nhập.",
    );
    return NextResponse.redirect(settingsPage);
  }
}
