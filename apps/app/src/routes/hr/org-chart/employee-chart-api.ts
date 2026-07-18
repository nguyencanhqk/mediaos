/**
 * employee-chart-api — client GET /hr/org-chart/employees cho sơ đồ tổ chức (S5-HR-ORGCHART-FE-1).
 *
 * Đặt Ở apps/app (không ở web-core) CÓ CHỦ ĐÍCH: schema + type là bản MIRROR của @mediaos/contracts
 * `orgChartEmployeeTreeSchema` (nguồn sự thật hợp đồng ở BE). Giữ trong source app để Vite HMR nạp ngay,
 * KHÔNG phụ thuộc symbol dep mới bị cache stale trong dev server. `apiFetch` tái dùng từ web-core (đã ổn
 * định). Nếu contract BE đổi field directory-class, cập nhật cả file này.
 *
 * BẤT BIẾN #3 — node CHỈ directory-class (tên/chức vụ/đơn vị/cấp bậc/avatar/mã NV) — KHÔNG lương/PII.
 */
import { z } from "zod";
import { apiFetch } from "@mediaos/web-core";

export interface OrgChartEmployeeNode {
  employeeId: string;
  userId: string | null;
  displayName: string | null;
  positionName: string | null;
  orgUnitName: string | null;
  jobLevelName: string | null;
  avatarUrl: string | null;
  employeeCode: string | null;
  children: OrgChartEmployeeNode[];
}

const orgChartEmployeeNodeSchema: z.ZodType<OrgChartEmployeeNode> = z.lazy(() =>
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

const orgChartEmployeeTreeSchema = z
  .object({
    roots: z.array(orgChartEmployeeNodeSchema),
    warnings: z.object({ cyclesDetected: z.boolean() }).strict(),
  })
  .strict();

export type OrgChartEmployeeTree = z.infer<typeof orgChartEmployeeTreeSchema>;

/** Query key cục bộ (mirror quy ước web-core hrKeys.orgChart.*). */
export const orgChartEmployeesQueryKey = ["hr", "org-chart", "employees"] as const;

/**
 * GET /hr/org-chart/employees — cây nhân sự theo direct_manager_id, LỌC theo data-scope của actor
 * (BE gate read:employee; thiếu quyền → 403). Gọi CÓ ĐIỀU KIỆN (chỉ khi useCan(read:employee)).
 */
export function fetchEmployeeChart(): Promise<OrgChartEmployeeTree> {
  return apiFetch("/hr/org-chart/employees", orgChartEmployeeTreeSchema);
}
