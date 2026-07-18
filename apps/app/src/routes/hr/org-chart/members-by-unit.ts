/**
 * members-by-unit — gom cây nhân sự (GET /hr/org-chart/employees, theo direct_manager_id) thành
 * Map<orgUnitName, thành-viên[]> để render "thành viên phòng" trong sơ đồ tổ chức (S5-HR-ORGCHART-FE-1).
 *
 * Vì node nhân sự CHỈ mang `orgUnitName` (không orgUnitId — hợp đồng directory-class crown-jewel),
 * khoá gom = tên đơn vị (khớp với `OrgTreeNode.name`). Duyệt LẶP (stack) để không tràn stack với cây sâu.
 */
import type { OrgChartEmployeeNode } from "./employee-chart-api";

export interface UnitMember {
  employeeId: string;
  userId: string | null;
  displayName: string | null;
  positionName: string | null;
  jobLevelName: string | null;
  avatarUrl: string | null;
  employeeCode: string | null;
  orgUnitName: string | null;
}

/**
 * Duyệt phẳng rừng node (dedup theo employeeId, giữ thứ tự gặp đầu tiên) → danh sách nhân viên.
 * Dùng cho cả gom-theo-phòng lẫn picker chọn quản lý (cần toàn bộ, kể cả người chưa gán phòng).
 */
export function flattenEmployeeChart(roots: readonly OrgChartEmployeeNode[]): UnitMember[] {
  const flat: UnitMember[] = [];
  const seen = new Set<string>();
  const stack: OrgChartEmployeeNode[] = [...roots];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (!seen.has(node.employeeId)) {
      seen.add(node.employeeId);
      flat.push({
        employeeId: node.employeeId,
        userId: node.userId,
        displayName: node.displayName,
        positionName: node.positionName,
        jobLevelName: node.jobLevelName,
        avatarUrl: node.avatarUrl,
        employeeCode: node.employeeCode,
        orgUnitName: node.orgUnitName,
      });
    }
    for (const child of node.children) stack.push(child);
  }
  return flat;
}

const byDisplayName = (a: UnitMember, b: UnitMember): number => {
  if (a.displayName == null && b.displayName == null) return 0;
  if (a.displayName == null) return 1;
  if (b.displayName == null) return -1;
  return a.displayName.localeCompare(b.displayName);
};

/**
 * Gom theo `orgUnitName` (bỏ node không có tên phòng). Trong mỗi phòng sắp theo displayName (nulls-last).
 */
export function buildMembersByUnit(
  roots: readonly OrgChartEmployeeNode[],
): Map<string, UnitMember[]> {
  const byUnit = new Map<string, UnitMember[]>();
  for (const m of flattenEmployeeChart(roots)) {
    if (!m.orgUnitName) continue;
    const list = byUnit.get(m.orgUnitName) ?? [];
    list.push(m);
    byUnit.set(m.orgUnitName, list);
  }
  for (const list of byUnit.values()) list.sort(byDisplayName);
  return byUnit;
}
