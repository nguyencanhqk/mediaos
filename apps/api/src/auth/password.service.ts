import { Algorithm, hash, verify } from "@node-rs/argon2";
import { Injectable } from "@nestjs/common";

/**
 * Lỗi verify mật khẩu do HẠ TẦNG / TOÀN VẸN DỮ LIỆU (hash hỏng, encoding sai, lib lỗi) — PHÂN BIỆT rạch
 * ròi với "sai mật khẩu" (mismatch → false). Caller (login/reauth) KHÔNG được nuốt lỗi này thành 401/deny
 * im lặng: một hash hỏng trong DB sẽ khoá nhầm user thật và che lỗi vận hành (G2 follow-up #4, silent-failure).
 */
export class PasswordVerificationError extends Error {
  constructor(cause?: unknown) {
    super("Xác minh mật khẩu thất bại do lỗi hạ tầng/toàn vẹn dữ liệu (không phải sai mật khẩu).");
    this.name = "PasswordVerificationError";
    // Giữ cause để chẩn đoán phía server (logger ở caller). KHÔNG bao giờ chứa plaintext/hash.
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Băm mật khẩu bằng argon2id (BẤT BIẾN #3). Tham số cost theo khuyến nghị OWASP (2024):
 * memory 19 MiB, 2 vòng lặp, parallelism 1 — cân bằng an toàn/độ trễ cho login server-side.
 * Dùng @node-rs/argon2 (binary prebuilt napi-rs) → KHÔNG cần node-gyp, chạy được trên Windows/CI.
 */
@Injectable()
export class PasswordService {
  private static readonly OPTS = {
    algorithm: Algorithm.Argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  hash(plain: string): Promise<string> {
    return hash(plain, PasswordService.OPTS);
  }

  /**
   * Mật khẩu KHÔNG khớp → `false` (argon2 trả false, KHÔNG ném). Mọi lỗi argon2 NÉM (hash rác / encoding
   * hỏng / lib lỗi) = hạ tầng/toàn vẹn dữ liệu → bọc lại thành `PasswordVerificationError` và NÉM, để caller
   * phân biệt với mismatch. Trước đây catch nuốt thành `false` (silent-failure: lỗi DB = "sai mật khẩu").
   */
  async verify(storedHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(storedHash, plain);
    } catch (err) {
      throw new PasswordVerificationError(err);
    }
  }
}
