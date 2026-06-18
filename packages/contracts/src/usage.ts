import { z } from "zod";

/**
 * CS-7 Tình hình sử dụng — contracts cho GET /tenant/usage.
 *
 * Endpoint trả tổng hợp sử dụng tenant: login count, per-user last-login, task/việc created/completed.
 * Guard: view:usage (resource_type='company', is_sensitive=false, mig 0370).
 * RLS: withTenant(companyId) — KHÔNG cross-tenant.
 */

/** Query params cho /tenant/usage (lọc thời gian tùy chọn). */
export const usageQuerySchema = z.object({
  /** ISO 8601 datetime — lọc từ ngày (login + task). */
  dateFrom: z.string().datetime().optional(),
  /** ISO 8601 datetime — lọc đến ngày (login + task). */
  dateTo: z.string().datetime().optional(),
}).refine(
  (q) => !q.dateFrom || !q.dateTo || new Date(q.dateFrom).getTime() <= new Date(q.dateTo).getTime(),
  { message: "dateFrom phải <= dateTo.", path: ["dateFrom"] },
);
export type UsageQuery = z.infer<typeof usageQuerySchema>;

/** Thông tin đăng nhập per-user: tên, email, đơn vị (phòng ban), lần cuối dùng. */
export const userLastLoginDtoSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().nullable(),
  email: z.string(),
  /** Tên phòng ban / đơn vị (nullable nếu chưa phân công). */
  departmentName: z.string().nullable(),
  /** ISO datetime của lần đăng nhập cuối; null nếu chưa đăng nhập lần nào (sau khi cột được thêm). */
  lastLoginAt: z.string().datetime().nullable(),
});
export type UserLastLoginDto = z.infer<typeof userLastLoginDtoSchema>;

/** Response tổng hợp GET /tenant/usage. */
export const tenantUsageResponseSchema = z.object({
  /** Số lần đăng nhập thành công trong khoảng thời gian (nếu có lọc) hoặc toàn bộ. */
  loginCount: z.number().int().nonnegative(),
  /** Số user đang active (chưa xoá mềm). */
  activeUserCount: z.number().int().nonnegative(),
  /** Số task/việc đã tạo trong khoảng. */
  tasksCreated: z.number().int().nonnegative(),
  /** Số task/việc đã hoàn thành (status='done') trong khoảng. */
  tasksCompleted: z.number().int().nonnegative(),
  /** Danh sách per-user last-login (chỉ user active, sắp xếp theo last_login_at desc nulls last). */
  users: z.array(userLastLoginDtoSchema),
});
export type TenantUsageResponse = z.infer<typeof tenantUsageResponseSchema>;
