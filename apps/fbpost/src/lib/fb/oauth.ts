import { REQUIRED_SCOPES } from "./constants";

/**
 * Luong dang nhap bang Facebook cho phan mem chay tren may ca nhan.
 *
 * Hai kieu dia chi tra ve:
 * - 'local': Facebook goi thang ve `http://localhost:.../api/auth/facebook/callback`,
 *   nguoi dung khong phai lam gi them. Can khai bao dia chi nay trong
 *   Valid OAuth Redirect URIs cua app.
 * - 'desktop': dung dia chi chinh chu cua Facebook danh cho ung dung desktop.
 *   Khong phai khai bao gi, doi lai nguoi dung phai copy URL tra ve dan vao
 *   phan mem. Duong lui khi app khong nhan dia chi localhost.
 */

export type OAuthMode = "local" | "desktop";

/** Dia chi Facebook danh san cho ung dung desktop - khong can khai bao truoc. */
export const DESKTOP_REDIRECT_URI = "https://www.facebook.com/connect/login_success.html";

export const OAUTH_CALLBACK_PATH = "/api/auth/facebook/callback";

/** Cookie giu chuoi state de chong CSRF khi Facebook goi nguoc ve. */
export const OAUTH_STATE_COOKIE = "fbpost_oauth_state";

export function resolveRedirectUri(mode: OAuthMode, origin: string): string {
  return mode === "desktop" ? DESKTOP_REDIRECT_URI : `${origin}${OAUTH_CALLBACK_PATH}`;
}

export function buildAuthorizeUrl(params: {
  appId: string;
  redirectUri: string;
  state: string;
  graphVersion: string;
  /**
   * Id cau hinh cua Facebook Login for Business. Chi can khi app dung
   * san pham do thay cho Facebook Login thong thuong.
   */
  configId?: string;
}): string {
  const url = new URL(`https://www.facebook.com/${params.graphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", params.appId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("response_type", "code");

  if (params.configId) {
    url.searchParams.set("config_id", params.configId);
  } else {
    url.searchParams.set("scope", REQUIRED_SCOPES.join(","));
  }

  return url.toString();
}

/**
 * Lay authorization code tu chuoi nguoi dung dan vao.
 *
 * Nhan ca URL day du (`https://www.facebook.com/connect/login_success.html?code=...`)
 * lan chuoi code tran, vi nguoi dung hay copy thieu.
 */
export function extractAuthorizationCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
    if (error) throw new Error(error);
    const code = url.searchParams.get("code");
    if (code) return code;
    // Mot so truong hop Facebook dat tham so sau dau #.
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    return hash.get("code");
  } catch (error) {
    if (error instanceof Error && !(error instanceof TypeError)) throw error;
    // Khong phai URL - coi nhu nguoi dung dan thang chuoi code.
    return /^[\w-]{20,}$/.test(trimmed) ? trimmed : null;
  }
}
