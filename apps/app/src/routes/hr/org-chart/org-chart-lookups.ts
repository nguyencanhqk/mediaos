/**
 * org-chart-lookups — dựng option cho các picker của nút hành động trên sơ đồ tổ chức
 * (S5-HR-ORGCHART-FE-2): danh sách phòng ban (từ cây org) có thụt cấp, để chọn phòng cha / phòng đích.
 */
import type { OrgTreeNode } from "@mediaos/web-core";

export interface DeptOption {
  id: string;
  name: string;
  /** Độ sâu trong cây — dùng để thụt lề nhãn option. */
  depth: number;
}

/** Duyệt cây phòng ban → danh sách phẳng (giữ thứ tự cha-trước-con) kèm depth để thụt lề. */
export function flattenDepartments(nodes: readonly OrgTreeNode[], depth = 0): DeptOption[] {
  const out: DeptOption[] = [];
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, depth });
    if (node.children.length > 0) out.push(...flattenDepartments(node.children, depth + 1));
  }
  return out;
}

/** Tiền tố thụt lề cho nhãn option theo depth (dùng khoảng trắng cứng để <option> giữ thụt). */
export function indentLabel(name: string, depth: number): string {
  return depth > 0 ? `${"  ".repeat(depth)}${name}` : name;
}
