import { z } from "zod";

/**
 * Schema validate FORM đăng nhập (chỉ email + password) — tương thích `loginRequestSchema` của
 * @mediaos/contracts. `companySlug` KHÔNG nằm trong form (đơn-tenant: lấy từ config SINGLE_COMPANY_SLUG,
 * user không gõ) → inject ở tầng submit, không validate ở form.
 *
 * Thông điệp lỗi dùng i18n KEY (namespace "auth", prefix "validation.") — component map sang text qua
 * `t(message)`; không hard-code chuỗi tiếng Việt ở đây.
 */
export const loginFormSchema = z.object({
  email: z
    .string()
    .min(1, { message: "validation.emailRequired" })
    .email({ message: "validation.emailInvalid" })
    .max(255, { message: "validation.emailInvalid" }),
  password: z.string().min(1, { message: "validation.passRequired" }).max(200),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;
