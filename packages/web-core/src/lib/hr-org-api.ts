import { z } from "zod";
import { apiFetch } from "./api-client";

/**
 * HR Org Chart API client — S2-FE-HR-6.
 *
 * GET /org/units/tree (apps/api/src/org/org.controller.ts) — READ mở cho mọi user tenant đã đăng
 * nhập (cơ cấu tổ chức KHÔNG nhạy cảm, KHÔNG PermissionGuard ở BE); JwtAuthGuard + CompanyGuard
 * toàn cục vẫn ép đăng nhập + company_id (BẤT BIẾN #1). FE gate hiển thị bằng `read:department`
 * (cặp seed thật mig 0444/0005 — cùng cặp dùng cho /hr/departments) để nhất quán trải nghiệm
 * "phòng ban" trong module HR, KHÔNG bịa cặp mới cho org-chart.
 *
 * Masking: đây chỉ là danh sách org_unit (tên/mã/loại/trưởng đơn vị) — KHÔNG chứa dữ liệu nhân
 * viên nhạy cảm (lương/liên hệ cá nhân). Server không mask field nào ở endpoint này.
 */

// Đệ quy: node org_unit + children cùng shape (buildTree ở org.repository.ts).
export interface OrgTreeNode {
  id: string;
  parentId: string | null;
  name: string;
  type: string;
  code: string | null;
  status: string;
  headUserName: string | null;
  children: OrgTreeNode[];
}

export const orgTreeNodeSchema: z.ZodType<OrgTreeNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    parentId: z.string().nullable(),
    name: z.string(),
    type: z.string(),
    code: z.string().nullable(),
    status: z.string(),
    headUserName: z.string().nullable(),
    children: z.array(orgTreeNodeSchema),
  }),
);

const orgTreeResponseSchema = z.array(orgTreeNodeSchema);

export const orgApi = {
  /** GET /org/units/tree — cây phòng ban đầy đủ của company hiện tại (server resolve từ AuthContext). */
  getTree: (): Promise<OrgTreeNode[]> => apiFetch("/org/units/tree", orgTreeResponseSchema),
};
