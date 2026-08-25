import { z } from "zod";

const workTypeEnum = z.enum(["offline", "remote", "hybrid"]);
const employmentTypeEnum = z.enum(["full_time", "part_time", "freelancer", "intern", "probation"]);
const salaryTypeEnum = z.enum(["monthly", "hourly", "project"]);
const employeeStatusEnum = z.enum(["active", "inactive", "resigned", "terminated"]);

/** DTO employee profile — base_salary nullable: null = không có quyền xem. */
export const employeeProfileSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  employeeCode: z.string().nullable().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  orgUnitName: z.string().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  positionName: z.string().nullable().optional(),
  directManagerId: z.string().uuid().nullable().optional(),
  directManagerName: z.string().nullable().optional(),
  workType: workTypeEnum,
  employmentType: employmentTypeEnum,
  startDate: z.string().date().nullable().optional(),
  endDate: z.string().date().nullable().optional(),
  contractType: z.string().nullable().optional(),
  baseSalary: z.number().nullable(),
  salaryType: salaryTypeEnum,
  phone: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: employeeStatusEnum,
  userFullName: z.string().nullable().optional(),
  userEmail: z.string().email().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmployeeProfileDto = z.infer<typeof employeeProfileSchema>;

export const employeeListItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  employeeCode: z.string().nullable().optional(),
  userFullName: z.string().nullable().optional(),
  userEmail: z.string().email().optional(),
  orgUnitName: z.string().nullable().optional(),
  positionName: z.string().nullable().optional(),
  workType: workTypeEnum,
  employmentType: employmentTypeEnum,
  status: employeeStatusEnum,
  baseSalary: z.number().nullable(),
});
export type EmployeeListItemDto = z.infer<typeof employeeListItemSchema>;

/**
 * S10-HR-EMPPAGE-1 (KI-010) — TRẦN `per_page` của `GET /employees`.
 *
 * ⚠️ ĐÂY LÀ CHÍNH CON SỐ `EMPLOYEE_LIST_MAX_ROWS` cũ (`employees.repository.ts`), chuyển về contracts
 * để BIÊN và SQL dùng CHUNG một nguồn. Trước WO này nó là một **CẮT CÂM**: repo `.limit(2000)` và
 * client nhận 2000 hàng mà KHÔNG có cách nào biết còn hàng phía sau (không `total`, không `has_more`).
 *
 * ⛔ KHÔNG XOÁ, KHÔNG NỚI. Cái cap này là thứ đang chặn rủi ro quét bảng; WO này thay cắt-CÂM bằng
 * cắt-CÓ-BÁO (`total` + `pagination`), KHÔNG thay cái trần.
 */
export const EMPLOYEE_LIST_PAGE_SIZE_MAX = 2000;
export const EMPLOYEE_LIST_PAGE_SIZE_DEFAULT = 50;

/**
 * Create employee profile.
 * EMP-001: either link an existing `userId`, OR create a new login account by supplying
 * `email` + `fullName` (server hashes `password`, or generates a temporary one). The
 * "userId XOR (email+fullName)" rule is enforced server-side (EmployeesService).
 */
export const createEmployeeProfileSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().email().optional(),
  fullName: z.string().min(1).max(200).optional(),
  password: z.string().min(8).optional(),
  employeeCode: z.string().optional(),
  orgUnitId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  directManagerId: z.string().uuid().optional(),
  workType: workTypeEnum.default("offline"),
  employmentType: employmentTypeEnum.default("full_time"),
  startDate: z.string().date().optional(),
  contractType: z.string().optional(),
  baseSalary: z.number().nonnegative().optional(),
  salaryType: salaryTypeEnum.default("monthly"),
  phone: z.string().optional(),
  avatarUrl: z.string().url().optional(),
  notes: z.string().optional(),
});
export type CreateEmployeeProfileRequest = z.infer<typeof createEmployeeProfileSchema>;

export const updateEmployeeProfileSchema = z.object({
  employeeCode: z.string().optional(),
  orgUnitId: z.string().uuid().nullable().optional(),
  positionId: z.string().uuid().nullable().optional(),
  directManagerId: z.string().uuid().nullable().optional(),
  workType: workTypeEnum.optional(),
  employmentType: employmentTypeEnum.optional(),
  startDate: z.string().date().nullable().optional(),
  endDate: z.string().date().nullable().optional(),
  contractType: z.string().nullable().optional(),
  baseSalary: z.number().nonnegative().nullable().optional(),
  salaryType: salaryTypeEnum.optional(),
  phone: z.string().nullable().optional(),
  avatarUrl: z.string().url().nullable().optional(),
  notes: z.string().nullable().optional(),
  status: employeeStatusEnum.optional(),
});
export type UpdateEmployeeProfileRequest = z.infer<typeof updateEmployeeProfileSchema>;

/**
 * Import CSV employee row schema.
 * NOTE: base_salary is intentionally EXCLUDED — salary is sensitive and changing it requires the
 * `update-salary` permission + audit (PATCH /employees/:id). Bulk import must never set salaries.
 */
export const importEmployeeRowSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(200),
  employeeCode: z.string().optional(),
  orgUnitName: z.string().optional(),
  positionName: z.string().optional(),
  workType: workTypeEnum.optional(),
  employmentType: employmentTypeEnum.optional(),
  startDate: z.string().date().optional(),
});
export type ImportEmployeeRow = z.infer<typeof importEmployeeRowSchema>;

export const importEmployeePreviewSchema = z.object({
  valid: z.array(importEmployeeRowSchema),
  invalid: z.array(
    z.object({
      row: z.number().int(),
      errors: z.array(z.string()),
    }),
  ),
  sessionId: z.string(),
});
export type ImportEmployeePreviewDto = z.infer<typeof importEmployeePreviewSchema>;

export const importEmployeeConfirmSchema = z.object({
  sessionId: z.string().min(1),
});
export type ImportEmployeeConfirmRequest = z.infer<typeof importEmployeeConfirmSchema>;

/**
 * GET /employees query filters (F8: free-text `search` over name/email/employee_code) + PHÂN TRANG.
 *
 * ⟲ S10-HR-EMPPAGE-1 (KI-010) — schema NÀY đã tồn tại từ trước nhưng **controller chưa hề dùng**:
 * `EmployeesController.listEmployees` nhận 4 `@Query("...")` RỜI, không đi qua Zod nào. Đó chính là
 * cách file đó trôi tới hiện trạng, nên WO này NỐI schema có sẵn vào biên thay vì thêm tham số rời
 * thứ năm.
 *
 * ⚠️ ĐỘ LỆCH TÊN THAM SỐ — nói ra để không ai tưởng là bỏ sót: đường này dùng `per_page` (khớp
 * `paginated()`/`ResponseEnvelopeInterceptor` và các viewer `auth-logs`/`files`), trong khi
 * `hrEmployeeListQuerySchema` của `/hr/employees` dùng `pageSize`. Hai quy ước tồn tại song song
 * TRƯỚC WO này. Chọn `per_page` vì đây là đường LEGACY có đúng MỘT hộ tiêu thụ (`apps/console`) và
 * envelope phân trang là quy ước rộng hơn; hợp nhất hai tên là việc của WO gộp hai đường.
 *
 * Query-string là chuỗi ⇒ `z.coerce`. `per_page` kẹp `[1..MAX]`; ngoài dải ⇒ VALIDATION-ERR
 * field-level ở BIÊN, KHÔNG phải 500.
 */
export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  per_page: z.coerce
    .number()
    .int()
    .positive()
    .max(EMPLOYEE_LIST_PAGE_SIZE_MAX)
    .default(EMPLOYEE_LIST_PAGE_SIZE_DEFAULT),
  orgUnitId: z.string().uuid().optional(),
  positionId: z.string().uuid().optional(),
  status: z.string().optional(),
  search: z.string().trim().min(1).optional(),
});
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
