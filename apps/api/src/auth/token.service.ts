import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { loadEnv } from "../config/env.schema";

export interface AccessTokenClaims {
  sub: string; // user id
  companyId: string;
  email: string;
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

  signAccessToken(claims: AccessTokenClaims): string {
    return jwt.sign(claims, this.secret(), {
      algorithm: "HS256",
      expiresIn: this.accessTtlSec,
    });
  }

  /**
   * Giải mã + verify chữ ký/hạn. Throw nếu sai (caller map → 401). CHẶN token confusion: challenge 2FA
   * (`tfp:true`, ký cùng secret) KHÔNG được dùng như access token — phải có `email` và KHÔNG có cờ `tfp`,
   * nếu không JwtAuthGuard sẽ nhận challenge token (phiên chưa qua bước 2) làm phiên đầy đủ.
   */
  verifyAccessToken(token: string): AccessTokenClaims {
    const decoded = jwt.verify(token, this.secret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string" || decoded.tfp === true || typeof decoded.email !== "string") {
      throw new Error("token không phải access token hợp lệ");
    }
    return { sub: String(decoded.sub), companyId: String(decoded.companyId), email: decoded.email };
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
