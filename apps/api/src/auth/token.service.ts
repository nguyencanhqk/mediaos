import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { loadEnv } from "../config/env.schema";

/**
 * Token audience (AC-0b operator-auth boundary). `operator` = platform-admin session (cross-tenant
 * control plane); `tenant` = normal company session. SERVER-INTERNAL claim — KHÔNG vào contracts
 * (authTokensSchema/meResponseSchema không đổi). Operator routes (@OperatorOnly) chỉ nhận `operator`;
 * route thường chỉ nhận `tenant`. Token CŨ (không có `aud`) mặc định `tenant` (backward-compat).
 */
export type TokenAudience = "operator" | "tenant";

export interface AccessTokenClaims {
  sub: string; // user id
  companyId: string;
  email: string;
  /** Optional khi ký: vắng ⇒ ký KHÔNG kèm aud (legacy). Khi verify ⇒ luôn trả 'tenant' nếu token thiếu. */
  aud?: TokenAudience;
  /**
   * S2-AUTH-BE-7: id phiên (user_sessions.id) — CHỈ định danh, KHÔNG cấp quyền. Optional để token
   * legacy (ký trước WO này, hoặc test dựng tay) vẫn verify được (jti vắng ⇒ verify trả undefined,
   * currentSessionId ở FE/BE coi như "không xác định được phiên hiện tại" — KHÔNG throw).
   */
  jti?: string;
}

/** Claims của challenge 2FA (bước-1 login đã qua password, chờ verify mã). KHÔNG cấp quyền API. */
export interface TwoFactorChallengeClaims {
  sub: string; // user id
  companyId: string;
  /** jti — định danh DUY NHẤT của challenge này, để ép single-use (chống replay challengeToken). */
  jti: string;
}

/** TTL challenge 2FA — đủ ngắn để hạn chế cửa sổ brute-force mã, đủ dài để user nhập mã. */
const TWO_FACTOR_CHALLENGE_TTL_SEC = 300; // 5 phút

/** Lỗi khi thiếu JWT_SECRET — fail-fast (không ký token bằng secret rỗng). */
export class JwtSecretMissingError extends Error {
  constructor() {
    super("JWT_SECRET chưa cấu hình — không thể ký/giải mã access token.");
    this.name = "JwtSecretMissingError";
  }
}

/**
 * TokenService — access token (JWT HS256, stateless, TTL ngắn) + refresh/reset token (random entropy
 * cao, lưu HASH SHA-256 at-rest). plain token chỉ trả cho client 1 lần, server không bao giờ lưu plain.
 */
@Injectable()
export class TokenService {
  private readonly env = loadEnv();

  get accessTtlSec(): number {
    return this.env.ACCESS_TOKEN_TTL_SEC;
  }
  get refreshTtlSec(): number {
    return this.env.REFRESH_TOKEN_TTL_SEC;
  }
  get resetTtlSec(): number {
    return this.env.RESET_TOKEN_TTL_SEC;
  }

  private secret(): string {
    if (!this.env.JWT_SECRET) throw new JwtSecretMissingError();
    return this.env.JWT_SECRET;
  }

  get operatorAccessTtlSec(): number {
    return this.env.OPERATOR_ACCESS_TOKEN_TTL_SEC;
  }

  /**
   * Ký access token. `aud` (nếu có) đi vào payload làm CLAIM audience (operator|tenant); vắng ⇒ token
   * legacy KHÔNG kèm aud (verify sẽ coi là 'tenant'). TTL theo audience: operator ngắn hơn
   * (OPERATOR_ACCESS_TOKEN_TTL_SEC) — phiên control-plane chéo tenant rủi ro cao nên cửa sổ ngắn.
   */
  signAccessToken(claims: AccessTokenClaims): string {
    const { aud, ...rest } = claims;
    const expiresIn = aud === "operator" ? this.operatorAccessTtlSec : this.accessTtlSec;
    // Chỉ nhúng aud khi có (giữ hình token legacy y nguyên cho phiên tenant cũ).
    const payload = aud ? { ...rest, aud } : rest;
    return jwt.sign(payload, this.secret(), { algorithm: "HS256", expiresIn });
  }

  /**
   * Giải mã + verify chữ ký/hạn. Throw nếu sai (caller map → 401). CHẶN token confusion: challenge 2FA
   * (`tfp:true`, ký cùng secret) KHÔNG được dùng như access token — phải có `email` và KHÔNG có cờ `tfp`,
   * nếu không JwtAuthGuard sẽ nhận challenge token (phiên chưa qua bước 2) làm phiên đầy đủ.
   *
   * AC-0b: `expectedAudience` ép biên audience. Token thiếu `aud` (legacy) ⇒ coi là 'tenant'. Mismatch
   * (vd operator token trên route tenant, hoặc ngược lại) ⇒ throw (caller → 401). Mặc định 'tenant' để
   * MỌI caller cũ (không truyền tham số) giữ nguyên hành vi: chỉ nhận phiên tenant.
   *
   * `"any"` (CHỈ cho endpoint định-danh: /auth/me, WS handshake) chấp nhận CẢ 2 audience — đây là điểm
   * xác thực CHÍNH CHỦ (không phải ghi dữ liệu tenant), nên operator lẫn tenant đều phải load được /me.
   * Vẫn trả `aud` để caller phân biệt phiên nếu cần. KHÔNG dùng "any" cho route ghi dữ liệu.
   */
  verifyAccessToken(
    token: string,
    expectedAudience: TokenAudience | "any" = "tenant",
  ): AccessTokenClaims & { aud: TokenAudience } {
    const decoded = jwt.verify(token, this.secret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string" || decoded.tfp === true || typeof decoded.email !== "string") {
      throw new Error("token không phải access token hợp lệ");
    }
    // `aud` có thể là string | string[] (registered claim). Chuẩn hoá array → phần tử đầu trước khi
    // so khớp (tránh `["operator"] === "operator"` ra false → demote câm). Legacy (vắng) ⇒ 'tenant'.
    const rawAud = decoded.aud;
    const normalizedAud = Array.isArray(rawAud) ? rawAud[0] : rawAud;
    const aud: TokenAudience = normalizedAud === "operator" ? "operator" : "tenant";
    if (expectedAudience !== "any" && aud !== expectedAudience) {
      throw new Error("token sai audience (operator/tenant không khớp route)");
    }
    // S2-AUTH-BE-7: jti — token cũ (ký trước WO này) không có claim → undefined (KHÔNG throw, giữ
    // backward-compat). jwt.sign KHÔNG tự sinh 'jti' trừ khi truyền option `jwtid`; ở đây jti nằm
    // trong payload thường (do signAccessToken set), nên decoded.jti là string thuần | undefined.
    const jti = typeof decoded.jti === "string" ? decoded.jti : undefined;
    return {
      sub: String(decoded.sub),
      companyId: String(decoded.companyId),
      email: decoded.email,
      aud,
      jti,
    };
  }

  /**
   * Ký challenge 2FA (bước-1 login OK, chờ verify mã). Marker `tfp:true` để KHÔNG nhầm với access token —
   * verifyAccessToken sẽ bỏ qua vì thiếu email/khác đường verify. TTL ngắn (5'). KHÔNG cấp quyền API.
   * `jti` (random) cấp nếu caller không truyền → ép SINGLE-USE qua ReplayGuard (chống replay challengeToken).
   */
  signTwoFactorChallenge(claims: Omit<TwoFactorChallengeClaims, "jti"> & { jti?: string }): string {
    const jti = claims.jti ?? randomBytes(16).toString("base64url");
    return jwt.sign(
      { sub: claims.sub, companyId: claims.companyId, tfp: true, jti },
      this.secret(),
      { algorithm: "HS256", expiresIn: TWO_FACTOR_CHALLENGE_TTL_SEC },
    );
  }

  /**
   * Verify challenge 2FA. Throw nếu sai chữ ký/hạn HOẶC thiếu marker `tfp` (chống dùng nhầm access token)
   * HOẶC thiếu `jti` (challenge cũ không có jti → từ chối, ép mọi challenge phải single-use-able).
   */
  verifyTwoFactorChallenge(token: string): TwoFactorChallengeClaims {
    const decoded = jwt.verify(token, this.secret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string" || decoded.tfp !== true || typeof decoded.jti !== "string") {
      throw new Error("token không phải challenge 2FA hợp lệ");
    }
    return { sub: String(decoded.sub), companyId: String(decoded.companyId), jti: decoded.jti };
  }

  /** Sinh token ngẫu nhiên (32 byte) — trả plain (cho client) để gọi hàm băm lưu DB. */
  generateOpaqueToken(): string {
    return randomBytes(32).toString("base64url");
  }

  /** Băm token at-rest (SHA-256). Token entropy cao ⇒ SHA-256 đủ (không cần argon2). */
  hashToken(plain: string): string {
    return createHash("sha256").update(plain).digest("hex");
  }
}
