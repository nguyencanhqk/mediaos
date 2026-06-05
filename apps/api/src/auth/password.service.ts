import { Algorithm, hash, verify } from "@node-rs/argon2";
import { Injectable } from "@nestjs/common";

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

  /** Trả false thay vì throw khi hash hỏng/không khớp (verify an toàn, không lộ chi tiết). */
  async verify(storedHash: string, plain: string): Promise<boolean> {
    try {
      return await verify(storedHash, plain);
    } catch {
      return false;
    }
  }
}
