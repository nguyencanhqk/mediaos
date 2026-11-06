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
/**
 * Bản gốc zod 3 là `/…[A-Z0-9…]…/i`. Vá FULL gate (plan §10.8): JSON Schema `pattern` KHÔNG mang cờ ⇒ client sinh
 * từ openapi.json đọc `[A-Z]` theo nghĩa đen và từ chối email chữ thường. Nên viết lại KHÔNG cờ: mọi lớp ký tự
 * `A-Z` thành `A-Za-z`. TƯƠNG ĐƯƠNG bản có `/i`: cờ `i` không-unicode chỉ gập chữ ASCII (ký tự ngoài ASCII không
 * bao giờ gập về ASCII — ES Canonicalize) ⇒ `[A-Z]/i` ≡ `[A-Za-z]`. Ca ghim (`email.spec.ts`): so hai regex trên
 * tập chuỗi sinh có hạt giống + `pattern` của `z.toJSONSchema` dùng không cờ. KHÔNG thêm cờ trở lại.
 */
export const ZOD3_EMAIL_REGEX = new RegExp(
  String.raw`^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$`,
);

/** Tham số cho `.email()`. Không thông điệp ⇒ `{}` (y như `.email()` không đối số trên zod 3). */
export function emailParams(message?: string): { pattern: RegExp; message?: string } {
  return message === undefined
    ? { pattern: ZOD3_EMAIL_REGEX }
    : { pattern: ZOD3_EMAIL_REGEX, message };
}

export const emailSchema = z.string().email(emailParams());
