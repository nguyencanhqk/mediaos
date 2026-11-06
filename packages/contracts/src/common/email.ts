import { z } from "zod";

/**
 * S19-OPS-ZOD4-1 — NGUỒN DUY NHẤT của kiểm email toàn monorepo (plan §9.2-5).
 *
 * Regex dưới đây chép NGUYÊN VĂN từ zod 3.25.76 (`node_modules/zod/v3/types.js:384`, `emailRegex`) — đó là
 * hành vi đang chạy hôm nay. zod 4 đổi regex mặc định; để hành vi TRUNG TÍNH qua lần nâng, pha C3 truyền regex
 * này làm `pattern` trong `emailParams()` (một chỗ sửa cho mọi call-site).
 *
 * Vì sao trên zod 3 KHÔNG dùng `.regex(ZOD3_EMAIL_REGEX)`: issue sẽ ra `validation: "regex"` thay vì `"email"`
 * và OpenAPI sinh `pattern` thay vì `format: email` ⇒ đổi hợp đồng. Nên trên zod 3 vẫn gọi `.email()` gốc (regex
 * Y HỆT, mã issue `invalid_string` + `validation: "email"` giữ nguyên) nhưng MỌI lời gọi đi qua `emailParams()`.
 *
 * Cách dùng: field email trơn ⇒ `emailSchema`; cần chạy sau `.trim()` hoặc mang thông điệp ⇒
 * `z.string().trim().email(emailParams())` / `.email(emailParams("khoá.i18n"))` (giữ thứ tự check của zod 3:
 * trim TRƯỚC email). Ca ghim: `common/email.spec.ts`.
 */
export const ZOD3_EMAIL_REGEX = new RegExp(
  String.raw`^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-\.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9\-]*\.)+[A-Z]{2,}$`,
  "i",
);

/** Tham số cho `.email()`. Không thông điệp ⇒ `{}` (y như `.email()` không đối số trên zod 3). */
export function emailParams(message?: string): { message?: string } {
  return message === undefined ? {} : { message };
}

export const emailSchema = z.string().email(emailParams());
