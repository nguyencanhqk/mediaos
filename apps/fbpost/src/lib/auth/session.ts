/**
 * Phien dang nhap cua fbpost.
 *
 * fbpost KHONG co man dang nhap rieng va CO Y khong co: danh tinh do MediaOS cap, di vao qua cau
 * SSO (`/api/auth/sso`). O day chi lo hai viec — ky mot cookie phien sau khi cau SSO da xac minh
 * xong, va doc lai cookie do o middleware.
 *
 * Dung WEB CRYPTO (`globalThis.crypto.subtle`) chu khong phai `node:crypto`: middleware cua Next
 * chay tren edge runtime, noi khong co module node. Web Crypto chay duoc o CA HAI, nen chi can
 * mot ban cai dat duy nhat cho ca middleware lan route handler.
 *
 * Chu ky HMAC-SHA256 tren phan payload, kiem bang `subtle.verify` (so sanh theo thoi gian hang
 * so — khong tu viet vong so sanh tung byte).
 */

export const SESSION_COOKIE = "fbpost_session";

/** Phien song 8 tieng — dai bang mot ngay lam viec, het thi quay ve MediaOS bam lai. */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

export interface SessionPayload {
  /** id nguoi dung ben MediaOS. */
  sub: string;
  email: string;
  name: string;
  /** Het han, giay Unix. */
  exp: number;
}

function encode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64url");
}

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

/**
 * Bi mat ky cookie phien. Bat buoc >=32 ky tu va KHONG co gia tri mac dinh: mot gia tri du phong
 * kieu "dev-secret" se im lang bien ca he thanh mo toang khi ai do quen dat bien moi truong.
 */
function sessionSecret(): string {
  const secret = process.env.SOCIAL_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SOCIAL_SESSION_SECRET chua duoc dat hoac ngan hon 32 ky tu.");
  }
  return secret;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Ky mot phien. Tra ve gia tri de dat vao cookie. */
export async function signSession(
  user: Omit<SessionPayload, "exp">,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload: SessionPayload = { ...user, exp: nowSeconds + SESSION_TTL_SECONDS };
  const body = encode(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body));
  return `${body}.${Buffer.from(signature).toString("base64url")}`;
}

/**
 * Doc lai mot phien. Tra ve `null` cho MOI truong hop khong hop le — sai chu ky, het han, sai
 * dinh dang, thieu bi mat. Ben goi chi can biet "co phien hay khong", khong can biet vi sao:
 * phan biet "chu ky sai" voi "het han" la mot kenh ro thong tin khong doi lai duoc gi.
 */
export async function verifySession(
  token: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      Buffer.from(signature, "base64url"),
      new TextEncoder().encode(body),
    );
    if (!valid) return null;

    const payload = JSON.parse(decode(body)) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
    if (typeof payload.sub !== "string" || payload.sub === "") return null;
    return payload;
  } catch {
    return null;
  }
}

/** Thuoc tinh cookie dung chung cho luc dat va luc xoa — lech nhau la cookie khong xoa duoc. */
export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // `lax` (khong phai `strict`): cookie phai duoc gui kem khi Facebook chuyen huong nguoc ve
    // `/api/auth/facebook/callback`. Voi `strict` thi dieu huong tu ten mien khac se khong mang
    // cookie, va chinh cong phien se chan mat duong OAuth quay ve.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
