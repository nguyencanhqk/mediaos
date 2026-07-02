import { z } from "zod";

/**
 * Schema validate form "quên mật khẩu" (S2-FE-AUTH-2) — chỉ email. `companySlug` KHÔNG nằm trong form
 * (đơn-tenant: lấy từ config SINGLE_COMPANY_SLUG, giống loginFormSchema).
 */
export const forgotPasswordFormSchema = z.object({
  email: z
    .string()
    .min(1, { message: "validation.emailRequired" })
    .email({ message: "validation.emailInvalid" })
    .max(255, { message: "validation.emailInvalid" }),
});

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;
