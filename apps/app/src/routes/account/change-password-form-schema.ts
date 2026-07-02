import { z } from "zod";

/**
 * Schema validate form đổi mật khẩu (S2-FE-AUTH-2, /account/change-password). `newPassword` mirror
 * `changePasswordRequestSchema` của @mediaos/contracts (min 8, max 200). `confirmPassword` chỉ tồn tại
 * ở tầng FORM — đối chiếu qua `.refine`. "Khác mật khẩu cũ" là rule server-side (lỗi rõ ràng từ API),
 * KHÔNG duplicate ở client (client không biết mật khẩu cũ thật để so — chỉ so chuỗi nhập lại).
 *
 * Thông điệp lỗi dùng i18n KEY (namespace "auth", prefix "validationShared."/"validation.").
 */
export const changePasswordFormSchema = z
  .object({
    currentPassword: z.string().min(1, { message: "validationShared.passwordRequired" }),
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
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "validationShared.samePassword",
    path: ["newPassword"],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordFormSchema>;
