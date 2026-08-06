import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb, nowSeconds } from "../db";

/**
 * Nhan token SSO tu MediaOS (`SocialSsoService`).
 *
 * Token: base64url(JSON {sub, email, name, iat, exp, jti}) + "." + base64url(HMAC-SHA256(payload)).
 * Kiem theo dung thu tu nay, va thu tu la co chu y:
 *   1. dung dinh dang         → sai thi dung ngay, khong dong toi DB
 *   2. chu ky HMAC hop le     → so sanh THOI GIAN HANG SO
 *   3. chua het han (60s)     → theo `exp` trong payload
 *   4. jti CHUA tung dung     → chen vao `sso_consumed_tokens`; trung khoa = da dung roi
 * Buoc 4 dat CUOI CUNG vi no la buoc duy nhat co ghi: mot token sai chu ky khong duoc phep de lai
 * dau vet gi trong bang, neu khong ke tan cong co the lam day bang bang jti tu bia.
 */

export interface SsoTokenPayload {
  sub: string;
  email: string;
  name?: string;
  iat: number;
  /** Het han — MILI giay (MediaOS dung Date.now(), khong phai giay Unix). */
  exp: number;
  jti: string;
}

export type SsoResult =
  | { ok: true; payload: SsoTokenPayload }
  | { ok: false; reason: "format" | "signature" | "expired" | "replay" | "config" };

function ssoSecret(): string | null {
  const secret = process.env.MEDIAOS_SSO_SECRET;
  return secret && secret.length >= 32 ? secret : null;
}

/**
 * Xac minh + TIEU THU token. Goi ham nay LA da dung token: goi lan hai voi cung token se tra
 * `replay`. Vi vay chi goi no o dung mot cho — route handler `/api/auth/sso`.
 */
export function consumeSsoToken(token: string, nowMs: number = Date.now()): SsoResult {
  const secret = ssoSecret();
  if (!secret) return { ok: false, reason: "config" };

  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "format" };
  const [payloadB64, signatureB64] = parts;

  // (2) Chu ky — so sanh thoi gian hang so. `timingSafeEqual` NEM LOI khi hai buffer khac do dai,
  // nen phai chan do dai truoc; khac do dai thi tu no da la chu ky sai.
  const expected = createHmac("sha256", secret).update(payloadB64).digest();
  const actual = Buffer.from(signatureB64, "base64url");
  if (actual.length !== expected.length) return { ok: false, reason: "signature" };
  if (!timingSafeEqual(actual, expected)) return { ok: false, reason: "signature" };

  let payload: SsoTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "format" };
  }
  if (typeof payload.jti !== "string" || payload.jti === "") return { ok: false, reason: "format" };
  if (typeof payload.sub !== "string" || payload.sub === "") return { ok: false, reason: "format" };
  if (typeof payload.email !== "string" || payload.email === "") {
    return { ok: false, reason: "format" };
  }
  if (typeof payload.exp !== "number") return { ok: false, reason: "format" };

  // (3) Han dung — kiem TRUOC khi tieu thu, de mot token het han khong chiem cho trong bang.
  if (payload.exp <= nowMs) return { ok: false, reason: "expired" };

  // (4) Mot-lan — de chinh PRIMARY KEY quyet dinh. Khong doc-roi-ghi (SELECT truoc INSERT sau) vi
  // hai request den cung luc deu se thay "chua co" roi ca hai cung vao.
  try {
    getDb()
      .prepare("INSERT INTO sso_consumed_tokens (jti, consumed_at) VALUES (?, ?)")
      .run(payload.jti, nowSeconds());
  } catch {
    return { ok: false, reason: "replay" };
  }

  return { ok: true, payload };
}

/**
 * Don cac jti qua cu. Token chi song 60 giay nen giu 1 ngay la du rong; muc dich duy nhat cua bang
 * la chan phat lai TRONG thoi gian token con hieu luc.
 */
export function pruneConsumedTokens(olderThanSeconds = 24 * 60 * 60): number {
  const result = getDb()
    .prepare("DELETE FROM sso_consumed_tokens WHERE consumed_at < ?")
    .run(nowSeconds() - olderThanSeconds);
  return Number(result.changes);
}
