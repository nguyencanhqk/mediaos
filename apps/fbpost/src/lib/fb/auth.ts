import { graphGet } from "./client";

/**
 * Luong lay token, thiet ke cho nguoi dung ca nhan chay phan mem tren may minh:
 * 1. Nguoi dung dan User Access Token ngan han lay tu Graph API Explorer
 * 2. Doi sang User Access Token dai han (~60 ngay)
 * 3. Lay Page Access Token tu token dai han - token nay khong het han
 *
 * Cach nay tranh phai dung OAuth redirect (can domain HTTPS cong khai),
 * von rat phien phuc khi chi chay localhost.
 */

export interface FacebookPage {
  id: string;
  name: string;
  accessToken: string;
  tasks: string[];
}

interface LongLivedTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

interface AccountsResponse {
  data?: {
    id: string;
    name: string;
    access_token?: string;
    tasks?: string[];
  }[];
}

export interface TokenDebugInfo {
  isValid: boolean;
  appId: string | null;
  type: string | null;
  scopes: string[];
  /** Unix seconds. 0 nghia la khong het han. */
  expiresAt: number;
}

/**
 * Doi authorization code (nhan duoc sau khi nguoi dung bam Dong y o cua so
 * dang nhap Facebook) sang User Access Token.
 *
 * `redirectUri` phai giong het chuoi da gui khi mo cua so dang nhap,
 * neu khong Facebook tu choi voi loi "redirect_uri isn't an absolute URI".
 */
export async function exchangeCodeForUserToken(
  appId: string,
  appSecret: string,
  redirectUri: string,
  code: string,
): Promise<string> {
  const result = await graphGet<LongLivedTokenResponse>("oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
  return result.access_token;
}

export async function exchangeForLongLivedUserToken(
  appId: string,
  appSecret: string,
  shortLivedToken: string,
): Promise<{ token: string; expiresIn: number }> {
  const result = await graphGet<LongLivedTokenResponse>("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortLivedToken,
  });
  return { token: result.access_token, expiresIn: result.expires_in ?? 0 };
}

/** Ten va id cua chu tai khoan - dung de dat ten cho tai khoan trong phan mem. */
export async function getMe(userAccessToken: string): Promise<{ id: string; name: string }> {
  return graphGet<{ id: string; name: string }>("me", {
    fields: "id,name",
    access_token: userAccessToken,
  });
}

/** Liet ke cac Page ma token co quyen quan ly, kem Page Access Token rieng. */
export async function listManagedPages(userAccessToken: string): Promise<FacebookPage[]> {
  const result = await graphGet<AccountsResponse>("me/accounts", {
    fields: "id,name,access_token,tasks",
    limit: 100,
    access_token: userAccessToken,
  });

  return (result.data ?? [])
    .filter((page) => Boolean(page.access_token))
    .map((page) => ({
      id: page.id,
      name: page.name,
      accessToken: page.access_token as string,
      tasks: page.tasks ?? [],
    }));
}

export async function debugToken(
  token: string,
  appId: string,
  appSecret: string,
): Promise<TokenDebugInfo> {
  const result = await graphGet<{
    data?: {
      is_valid?: boolean;
      app_id?: string;
      type?: string;
      scopes?: string[];
      expires_at?: number;
    };
  }>("debug_token", {
    input_token: token,
    access_token: `${appId}|${appSecret}`,
  });

  const data = result.data ?? {};
  return {
    isValid: Boolean(data.is_valid),
    appId: data.app_id ?? null,
    type: data.type ?? null,
    scopes: data.scopes ?? [],
    expiresAt: data.expires_at ?? 0,
  };
}

/** Kiem tra nhanh mot Page Access Token con dung hay khong. */
export async function verifyPageToken(
  pageId: string,
  pageAccessToken: string,
): Promise<{ id: string; name: string }> {
  return graphGet<{ id: string; name: string }>(pageId, {
    fields: "id,name",
    access_token: pageAccessToken,
  });
}
