import { createHash, randomBytes } from "node:crypto";
import { Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { loadEnv } from "../config/env.schema";

export interface AccessTokenClaims {
  sub: string; // user id
  companyId: string;
  email: string;
}

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

  /** Giải mã + verify chữ ký/hạn. Throw nếu sai (caller map → 401). */
  verifyAccessToken(token: string): AccessTokenClaims {
    const decoded = jwt.verify(token, this.secret(), { algorithms: ["HS256"] });
    if (typeof decoded === "string") throw new Error("token payload không hợp lệ");
    return { sub: String(decoded.sub), companyId: String(decoded.companyId), email: String(decoded.email) };
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
