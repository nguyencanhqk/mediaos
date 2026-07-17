import { z } from "zod";

/**
 * S5-HR-ORGCHART-BE-1 — sơ đồ tổ chức: cây nhân sự theo `employee_profiles.direct_manager_id`
 * (một `users.id`) ↔ `employee.user_id`, lọc theo data-scope của actor (Option A: chỉ subtree trong
 * quyền — KHÔNG đường quản lý lên trên).
 *
 * BẤT BIẾN #3 — node CHỈ directory-class (không PII/salary/identity/contact). DTO `.strict()` là chốt
 * cuối: một field ngoài allowlist dưới đây KHÔNG parse được ⇒ không thể rò qua đường org-chart.
 */

/** Một node nhân viên trong cây — CHỈ field directory (đối chiếu strict với repo SELECT). */
export type OrgChartEmployeeNode = {
  /** employee_profiles.id */
  employeeId: string;
  /** employee_profiles.user_id — để nối cây (child.directManagerId ↔ parent.userId) + FE điều hướng. */
  userId: string | null;
  /** users.full_name (null khi employee chưa link user). */
  displayName: string | null;
  /** positions.name */
  positionName: string | null;
  /** org_units.name */
  orgUnitName: string | null;
  /** job_levels.name */
  jobLevelName: string | null;
  /** employee_profiles.avatar_url */
  avatarUrl: string | null;
  /** employee_profiles.employee_code */
  employeeCode: string | null;
  children: OrgChartEmployeeNode[];
};

export const orgChartEmployeeNodeSchema: z.ZodType<OrgChartEmployeeNode> = z.lazy(() =>
  z
    .object({
      employeeId: z.string().uuid(),
      userId: z.string().uuid().nullable(),
      displayName: z.string().nullable(),
      positionName: z.string().nullable(),
      orgUnitName: z.string().nullable(),
      jobLevelName: z.string().nullable(),
      avatarUrl: z.string().nullable(),
      employeeCode: z.string().nullable(),
      children: z.array(orgChartEmployeeNodeSchema),
    })
    .strict(),
);

/**
 * Response GET /hr/org-chart/employees. `roots` = rừng node gốc (orphan / manager ngoài tập / cắt cạnh
 * vòng). `warnings.cyclesDetected` = true khi dữ liệu có vòng (self-manage hoặc A→B→A) đã bị cắt để dựng
 * cây — client hiển thị cảnh báo, dữ liệu vẫn trả về (không treo/500).
 */
export const orgChartEmployeeTreeSchema = z
  .object({
    roots: z.array(orgChartEmployeeNodeSchema),
    warnings: z
      .object({
        cyclesDetected: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type OrgChartEmployeeTree = z.infer<typeof orgChartEmployeeTreeSchema>;
