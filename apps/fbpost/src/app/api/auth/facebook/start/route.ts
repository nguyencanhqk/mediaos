import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { resolveLoginApp } from "@/lib/fb/connect";
import {
  buildAuthorizeUrl,
  OAUTH_STATE_COOKIE,
  resolveRedirectUri,
  type OAuthMode,
} from "@/lib/fb/oauth";
import { redirectToPath } from "@/lib/http/relative-redirect";
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
 *
 * Hai kieu chuyen huong o day KHAC NHAU va co y:
 * - sang Facebook: URL tuyet doi (khac goc, bat buoc phai tuyet doi);
 * - ve /settings: `Location` TUONG DOI — dung URL tuyet doi dung tu request se day nguoi dung ve
 *   `https://localhost:3500` khi chay sau tunnel (xem `lib/http/relative-redirect`).
 */
export async function GET(request: NextRequest) {
  const failWith = (message: string) => redirectToPath("/settings", { loginError: message });

  try {
    const app = resolveLoginApp();
    if (!app) {
      return failWith(
        "Chưa lưu App ID và App Secret. Điền hai ô đó rồi bấm Lưu trước khi đăng nhập.",
      );
    }

    const mode: OAuthMode =
      request.nextUrl.searchParams.get("mode") === "desktop" ? "desktop" : "local";
    const state = `${mode}.${crypto.randomBytes(16).toString("hex")}`;

    const target = buildAuthorizeUrl({
      appId: app.appId,
      redirectUri: resolveRedirectUri(mode, request.nextUrl.origin),
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
    return failWith(error instanceof Error ? error.message : "Không mở được cửa sổ đăng nhập.");
  }
}
