import { REQUIRED_SCOPES } from "./constants";

/**
 * Luong dang nhap bang Facebook cho phan mem chay tren may ca nhan.
 *
 * Hai kieu dia chi tra ve:
 * - 'local': Facebook goi thang ve `<goc cong khai>/api/auth/facebook/callback` — goc do lay tu
 *   `SOCIAL_BASE_URL` (xem `resolvePublicOrigin`), khong phai tu request. Phai khai bao dung
 *   chuoi do trong Valid OAuth Redirect URIs cua app.
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

/**
 * Bien env giu goc CONG KHAI cua fbpost (vi du `https://dangfb.funtimemediacorp.com`).
 * PHAI trung gia tri voi `SOCIAL_BASE_URL` ben `apps/api` — do la cung mot dia chi.
 */
export const PUBLIC_ORIGIN_ENV = "SOCIAL_BASE_URL";

/**
 * Goc cong khai cua ung dung — dia chi ma TRINH DUYET nhin thay.
 *
 * KHONG duoc suy tu `request.nextUrl.origin`: dung sau Cloudflare tunnel, Next thay
 * `Host: localhost:3500` nen origin thanh `https://localhost:3500`. Voi mot redirect noi bo thi
 * chua Location tuong doi la xong (xem `lib/http/relative-redirect`), nhung dia chi tra ve gui cho
 * Facebook BAT BUOC phai tuyet doi va phai khop TUNG KY TU voi "URI chuyen huong OAuth hop le"
 * khai trong app Facebook. Vi vay no phai den tu cau hinh, khong the doan tu request.
 *
 * Bug that 06/08/2026: origin suy tu request ⇒ redirect_uri = `https://localhost:3500/...` ⇒ dang
 * nhap xong Facebook day trinh duyet ve localhost:3500 qua HTTPS, cong do khong co TLS ⇒
 * `ERR_SSL_PROTOCOL_ERROR`. App dang o che do Development nen Facebook VAN NHAN dia chi localhost
 * (localhost duoc mien khoi danh sach hop le) — nghia la loi khong lo ra o phia Facebook, chi lo ra
 * tren man hinh nguoi dung.
 *
 * Chua dat env thi lui ve origin cua request: dung cho may dev chay `next dev` tren localhost.
 */
export function resolvePublicOrigin(requestOrigin: string): string {
  const configured = process.env[PUBLIC_ORIGIN_ENV]?.trim();
  if (!configured) return requestOrigin;

  try {
    // Lay .origin de bo duong dan/dau gach cuoi neu nguoi cau hinh lo go them.
    return new URL(configured).origin;
  } catch {
    // Cau hinh sai thi noi ro ra, KHONG lui ve localhost roi de nguoi dung tu doan.
    throw new Error(
      `${PUBLIC_ORIGIN_ENV} không phải URL hợp lệ: "${configured}". Sửa trong apps/fbpost/.env.production, ví dụ https://dangfb.funtimemediacorp.com`,
    );
  }
}

export function resolveRedirectUri(mode: OAuthMode, requestOrigin: string): string {
  return mode === "desktop"
    ? DESKTOP_REDIRECT_URI
    : `${resolvePublicOrigin(requestOrigin)}${OAUTH_CALLBACK_PATH}`;
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
