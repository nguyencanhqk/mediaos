import { z } from "zod";

/**
 * Users — DTO hồ sơ người dùng. Module 2a: self-service (cập nhật hồ sơ của chính mình).
 * Nền cho Module 2b (admin user CRUD) mở rộng sau.
 */

/**
 * Cập nhật hồ sơ của CHÍNH user (self-service). CHỈ field non-sensitive — `email` là định danh (immutable
 * theo tenant), `status` do admin quản. `fullName` trim + bắt buộc ≥ 1 ký tự (không cho xoá trắng tên).
 */
export const updateProfileRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
