import { z } from "zod";

/**
 * Schema validate form đặt lại mật khẩu (S2-FE-AUTH-2). `newPassword` mirror
 * `resetPasswordRequestSchema` của @mediaos/contracts (min 8, max 200). `confirmPassword` chỉ tồn tại
 * ở tầng FORM (không gửi lên server) — đối chiếu khớp qua `.refine`.
 *
 * Thông điệp lỗi dùng i18n KEY (namespace "auth", prefix "validationShared.") — component map qua `t()`.
 */
export const resetPasswordFormSchema = z
  .object({
    newPassword: z
      .string()
      .min(1, { message: "validationShared.passwordRequired" })
      .min(8, { message: "validationShared.passwordMinLength" })
      .max(200, { message: "validationShared.passwordMinLength" }),
    confirmPassword: z.string().min(1, { message: "validationShared.confirmPasswordRequired" }),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "validationShared.passwordMismatch",
    path: ["confirmPassword"],
  });

export type ResetPasswordFormValues = z.infer<typeof resetPasswordFormSchema>;
