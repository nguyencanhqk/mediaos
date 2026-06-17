import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { SecretEncryptionService } from "../crypto/secret-encryption.service";
import type { EncryptedColumns } from "../crypto/secret-encryption.types";

/** Số byte entropy của HMAC secret webhook (32B → hex 64 ký tự). */
const SECRET_BYTES = 32;
const HMAC_ALGO = "sha256";
const WEBHOOK_SECRET_PURPOSE = "webhook_secret" as const;

/**
 * WebhookSigner (AC-6 🔒) — sinh + niêm phong (envelope-KMS) HMAC secret, và ký payload.
 *
 * BẤT BIẾN #3: secret = reversible → envelope-KMS qua SecretEncryptionService (purpose='webhook_secret',
 *   AAD = companyId‖endpoint_id). Plaintext sinh server-side (randomBytes), trả reveal-once lúc tạo, KHÔNG
 *   lưu/log. Khi ký: decrypt CHỈ lúc cần, zero buffer secret sau dùng (finally).
 */
@Injectable()
export class WebhookSigner {
  constructor(private readonly secrets: SecretEncryptionService) {}

  /** Sinh plaintext HMAC secret server-side (hex 32 byte). Caller seal ngay + trả reveal-once. */
  generateSecret(): string {
    return randomBytes(SECRET_BYTES).toString("hex");
  }

  /**
   * Niêm phong secret thành 7 cột envelope. recordId = endpoint id (đã sinh trước INSERT để bind AAD —
   * KHÔNG dùng DB default gen_random_uuid()).
   */
  async sealSecret(
    plaintext: string,
    ctx: { companyId: string; endpointId: string },
  ): Promise<EncryptedColumns> {
    return this.secrets.encryptSecret(plaintext, {
      companyId: ctx.companyId,
      recordId: ctx.endpointId,
      purpose: WEBHOOK_SECRET_PURPOSE,
    });
  }

  /**
   * Ký payload bằng secret giải mã từ envelope. Trả chữ ký HMAC-SHA256 hex. Secret zero sau dùng.
   */
  async sign(
    payload: string,
    row: EncryptedColumns,
    ctx: { companyId: string; endpointId: string },
  ): Promise<string> {
    const secret = await this.secrets.decryptSecret(row, {
      companyId: ctx.companyId,
      recordId: ctx.endpointId,
      purpose: WEBHOOK_SECRET_PURPOSE,
    });
    const secretBuf = Buffer.from(secret, "utf8");
    try {
      return createHmac(HMAC_ALGO, secretBuf).update(payload, "utf8").digest("hex");
    } finally {
      secretBuf.fill(0); // zero key material — không để secret nằm trên heap
    }
  }
}

/** So khớp chữ ký HMAC hằng-thời-gian (chống timing attack). Public helper cho consumer/test. */
export function verifySignature(expectedHex: string, actualHex: string): boolean {
  const a = Buffer.from(expectedHex, "hex");
  const b = Buffer.from(actualHex, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
