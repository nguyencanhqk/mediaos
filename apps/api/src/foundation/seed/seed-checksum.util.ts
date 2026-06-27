import { createHash } from "node:crypto";

/**
 * FOUNDATION-BE-8 — checksum ổn định cho payload seed (DB-08 §8.13). SHA-256 trên JSON đã chuẩn-hoá
 * (sort key, đệ quy) ⇒ cùng nội dung bất kể thứ tự key/whitespace ⇒ cùng hex. Dùng để quyết Skip vs Update
 * khi seed lại (idempotent).
 *
 * BẤT BIẾN #3 (không secret plaintext): payload seed CHỈ là master/config data — KHÔNG được mang secret/
 * hash/PII nhạy cảm. Nếu phát hiện field nhạy cảm (deny-list, đệ quy) ⇒ throw SeedChecksumSecretError
 * (fail-closed) thay vì âm thầm hash secret. Hook guard-secrets canh thêm ở tầng diff.
 */

/** Mảnh tên field bị cấm xuất hiện trong payload seed (so khớp KHÔNG phân biệt hoa/thường, substring). */
const SECRET_KEY_FRAGMENTS = [
  "password",
  "passwordhash",
  "token",
  "secret",
  "apikey",
  "api_key",
  "envelope",
  "kms",
  "ciphertext",
  "private_key",
  "privatekey",
] as const;

/** Lỗi BẤT BIẾN #3: payload seed chứa field nhạy cảm — KHÔNG hash, KHÔNG ghi. */
export class SeedChecksumSecretError extends Error {
  constructor(key: string) {
    super(
      `Payload seed chứa field nhạy cảm "${key}" — vi phạm BẤT BIẾN #3 (không secret plaintext). ` +
        `Payload seed chỉ được mang master/config data.`,
    );
    this.name = "SeedChecksumSecretError";
  }
}

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_FRAGMENTS.some((frag) => lower.includes(frag));
}

/**
 * Chuẩn-hoá value thành dạng ổn định để hash:
 *  - object: sort key tăng dần, đệ quy (đồng thời QUÉT deny-list field nhạy cảm).
 *  - array: giữ thứ tự (thứ tự phần tử là một phần ngữ nghĩa), chuẩn-hoá từng phần tử.
 *  - primitive: trả nguyên (JSON.stringify lo encode).
 */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    if (isSecretKey(key)) {
      throw new SeedChecksumSecretError(key);
    }
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/**
 * SHA-256 hex của payload chuẩn-hoá. null/undefined ⇒ checksum xác định của chuỗi rỗng-chuẩn (đồng nhất).
 * @throws SeedChecksumSecretError nếu payload chứa field nhạy cảm (deny-list, đệ quy).
 */
export function computeChecksum(payload: unknown): string {
  const canonical = payload == null ? null : canonicalize(payload);
  const json = JSON.stringify(canonical);
  return createHash("sha256").update(json).digest("hex");
}
