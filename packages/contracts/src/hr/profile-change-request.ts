import { z } from "zod";

/**
 * S2-HR-BE-4 — Profile change request contracts (SPEC-03 §14.18/14.19/14.20 / API-03 §16.7).
 *
 * Employee tự đề xuất sửa trường cá nhân; HR/Admin duyệt/từ chối.
 * Dữ liệu hồ sơ chính KHÔNG thay đổi trước khi được duyệt.
 *
 * Sensitive guard (BẤT BIẾN #3): identity_number + field nhạy cảm đi qua AuditMaskerService
 * trước khi vào audit_logs. DTO này là dạng API response — KHÔNG chứa secret/hash.
 */

// ── Allowed field names that an employee can request to change ───────────────────

/**
 * Danh sách field được phép đề xuất sửa (SPEC-03 §13.4 / §14.18).
 * Server validate changedFields chỉ gồm các key này; KHÔNG cho phép sửa
 * department_id/position_id/employment_status/role/contract (public deny-list).
 */
export const PROFILE_CHANGE_ALLOWED_FIELDS = [
  "avatar_file_id",
  "date_of_birth",
  "gender",
  "marital_status",
  "personal_email",
  "phone",
  "current_address",
  "permanent_address",
  "emergency_contact_name",
  "emergency_contact_phone",
  "identity_number",
  "identity_issue_date",
  "identity_issue_place",
] as const;

export type ProfileChangeAllowedField = (typeof PROFILE_CHANGE_ALLOWED_FIELDS)[number];

// ── Request status ────────────────────────────────────────────────────────────────

export const PROFILE_CHANGE_STATUSES = [
  "Draft",
  "Pending",
  "Approved",
  "Rejected",
  "Cancelled",
] as const;
export type ProfileChangeStatus = (typeof PROFILE_CHANGE_STATUSES)[number];

// ── Create request ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/hr/profile-change-requests
 * Employee gửi yêu cầu cập nhật hồ sơ cá nhân.
 * changedFields phải ⊆ PROFILE_CHANGE_ALLOWED_FIELDS (server từ chối field bị cấm → HR-ERR-040).
 * newValues phải chứa đúng các key trong changedFields.
 * Không gửi nếu không có field nào thay đổi (HR-ERR-041).
 */
export const createProfileChangeRequestSchema = z.object({
  changedFields: z
    .array(z.enum(PROFILE_CHANGE_ALLOWED_FIELDS))
    .min(1, "Phải có ít nhất một trường thay đổi"),
  newValues: z.record(z.string(), z.unknown()),
  reason: z.string().trim().max(1000).optional(),
});
export type CreateProfileChangeRequest = z.infer<typeof createProfileChangeRequestSchema>;

// ── Approve request ───────────────────────────────────────────────────────────────

/**
 * POST /api/v1/hr/profile-change-requests/:id/approve
 * HR/Admin duyệt yêu cầu → hệ thống ghi newValues vào employees.
 */
export const approveProfileChangeRequestSchema = z.object({
  note: z.string().trim().max(500).optional(),
});
export type ApproveProfileChangeRequest = z.infer<typeof approveProfileChangeRequestSchema>;

// ── Reject request ────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/hr/profile-change-requests/:id/reject
 * HR/Admin từ chối yêu cầu; rejectionReason bắt buộc (HR-ERR-042).
 */
export const rejectProfileChangeRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1, "Lý do từ chối là bắt buộc").max(1000),
});
export type RejectProfileChangeRequest = z.infer<typeof rejectProfileChangeRequestSchema>;

// ── List query ────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/hr/profile-change-requests (HR view — all requests in scope)
 * GET /api/v1/hr/profile-change-requests/me (Employee view — own requests only)
 */
export const profileChangeRequestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(PROFILE_CHANGE_STATUSES).optional(),
  employeeId: z.string().uuid().optional(),
});
export type ProfileChangeRequestListQuery = z.infer<typeof profileChangeRequestListQuerySchema>;

// ── Response DTOs ─────────────────────────────────────────────────────────────────

/** One row in list. */
export const profileChangeRequestListItemSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  employeeFullName: z.string(),
  status: z.enum(PROFILE_CHANGE_STATUSES),
  changedFields: z.array(z.string()),
  reason: z.string().nullable(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
  reviewedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type ProfileChangeRequestListItem = z.infer<typeof profileChangeRequestListItemSchema>;

/** Detail view — includes old/new values comparison (BẤT BIẾN #3: sensitive fields masked). */
export const profileChangeRequestDetailSchema = z.object({
  id: z.string().uuid(),
  employeeId: z.string().uuid(),
  employeeCode: z.string().nullable(),
  employeeFullName: z.string(),
  requestedBy: z.string().uuid(),
  status: z.enum(PROFILE_CHANGE_STATUSES),
  changedFields: z.array(z.string()),
  oldValues: z.record(z.string(), z.unknown()),
  newValues: z.record(z.string(), z.unknown()),
  reason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  reviewedBy: z.string().uuid().nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  submittedAt: z.string(),
  cancelledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProfileChangeRequestDetail = z.infer<typeof profileChangeRequestDetailSchema>;

export const profileChangeRequestListResponseSchema = z.object({
  items: z.array(profileChangeRequestListItemSchema),
  meta: z.object({
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
    hasNext: z.boolean(),
    hasPrev: z.boolean(),
  }),
});
export type ProfileChangeRequestListResponse = z.infer<
  typeof profileChangeRequestListResponseSchema
>;
