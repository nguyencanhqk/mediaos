import { nowSeconds } from "../db";
import { getAccount, listAccounts, saveAccount, toPublicAccount } from "../repo/account-repo";
import { upsertPages } from "../repo/page-repo";
import { getSettings } from "../repo/settings-repo";
import type { Account } from "../types";
import { debugToken, exchangeForLongLivedUserToken, getMe, listManagedPages } from "./auth";
import { REQUIRED_SCOPES } from "./constants";

/**
 * Buoc cuoi cua moi cach ket noi tai khoan.
 *
 * Ba loi vao khac nhau - bam nut dang nhap, dan URL tra ve, dan token tu
 * Graph API Explorer - deu quy ve mot chuoi viec giong het nhau o day,
 * nen quy tac chi ton tai o mot cho.
 */

export interface LoginApp {
  appId: string;
  appSecret: string;
  configId: string;
  /** true khi muon tam tu tai khoan da ket noi chu khong phai cau hinh rieng. */
  inherited: boolean;
  /** Ten tai khoan cho muon, de giao dien noi ro dang dung app cua ai. */
  inheritedFrom: string;
}

/**
 * Ung dung Facebook dung cho nut dang nhap.
 *
 * Uu tien cau hinh o trang Cai dat. Neu chua khai bao ma da co tai khoan
 * ket noi bang cach thu cong thi muon luon App ID/Secret cua tai khoan do -
 * nguoi dung khoi phai go lai thu minh da dien mot lan roi.
 */
export function resolveLoginApp(): LoginApp | null {
  const settings = getSettings();
  if (settings.appId && settings.appSecret) {
    return {
      appId: settings.appId,
      appSecret: settings.appSecret,
      configId: settings.loginConfigId,
      inherited: false,
      inheritedFrom: "",
    };
  }

  const [first] = listAccounts();
  if (first?.appId && first.appSecret) {
    return {
      appId: first.appId,
      appSecret: first.appSecret,
      configId: settings.loginConfigId,
      inherited: true,
      inheritedFrom: first.name,
    };
  }

  return null;
}

export interface ConnectResult {
  account: Account;
  isNew: boolean;
  /** null nghia la Facebook khong bao han - thuong la token khong het han. */
  expiresInDays: number | null;
  scopes: string[];
  missingScopes: string[];
  added: number;
  updated: number;
}

export async function connectAccount(params: {
  appId: string;
  appSecret: string;
  /** Token vua lay duoc, ngan han hay dai han deu duoc. */
  userToken: string;
  /** Ten tu dat. Bo trong thi lay ten tren Facebook. */
  name?: string;
}): Promise<ConnectResult> {
  // Doi sang token dai han. Goi tren mot token da dai han cung khong sao,
  // Facebook tra ve mot token dai han khac.
  const { token: longLivedToken, expiresIn } = await exchangeForLongLivedUserToken(
    params.appId,
    params.appSecret,
    params.userToken,
  );

  const info = await debugToken(longLivedToken, params.appId, params.appSecret);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !info.scopes.includes(scope));

  const me = await getMe(longLivedToken);
  const { account, isNew } = saveAccount({
    fbUserId: me.id,
    name: params.name?.trim() || me.name || `Tài khoản ${me.id}`,
    appId: params.appId,
    appSecret: params.appSecret,
    userToken: longLivedToken,
    tokenExpiresAt: expiresIn ? nowSeconds() + expiresIn : 0,
  });

  const fromFacebook = await listManagedPages(longLivedToken);
  const sync = upsertPages(
    account.id,
    fromFacebook.map((page) => ({
      pageId: page.id,
      name: page.name,
      accessToken: page.accessToken,
      canPost: page.tasks.includes("CREATE_CONTENT"),
    })),
  );

  // Doc lai de so Page tinh ca cac Page vua nap ve.
  const saved = getAccount(account.id) ?? account;

  return {
    account: toPublicAccount(saved),
    isNew,
    expiresInDays: expiresIn ? Math.round(expiresIn / 86400) : null,
    scopes: info.scopes,
    missingScopes,
    added: sync.added,
    updated: sync.updated,
  };
}
