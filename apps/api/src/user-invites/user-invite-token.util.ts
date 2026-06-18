import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Số byte ngẫu nhiên cho token mời (256-bit entropy — không thể đoán/brute-force). */
const INVITE_TOKEN_BYTES = 32;

/**
 * Sinh token mời ngẫu nhiên + hash để lưu DB.
 *   - `token`: giá trị THẬT (base64url) — CHỈ gửi qua email, KHÔNG lưu, KHÔNG log.
 *   - `tokenHash`: sha256 hex của token — lưu DB (`user_invites.token_hash`). Lookup = băm token-trình-bày
 *     rồi so khớp hằng-thời-gian.
 */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

/** sha256 hex của token. Deterministic — dùng cả khi tạo (lưu) và khi accept (lookup). */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * So khớp hash hằng-thời-gian (chống timing oracle). Lookup token đi qua index DB theo `token_hash`;
 * hàm này dùng để kiểm tra LẦN CUỐI sau khi lấy row (phòng thủ kép). Trả false nếu độ dài lệch.
 */
export function inviteTokenHashEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
