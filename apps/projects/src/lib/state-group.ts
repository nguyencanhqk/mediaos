import type { ProjectStateGroupDto } from "@mediaos/contracts";

/**
 * Hằng số nhóm trạng thái Plane (project_states.state_group) — nhãn vi + màu mặc định + thứ tự.
 * `ProjectStateGroupDto` = "backlog" | "unstarted" | "started" | "completed" | "cancelled".
 *
 * Màu mặc định dùng khi tạo state mới (server cho phép ghi đè `color`). Thứ tự `order` quyết
 * cách gom cột mặc định trên board khi state chưa đặt sortOrder rõ ràng.
 */
export interface StateGroupMeta {
  value: ProjectStateGroupDto;
  labelKey: string;
  /** Màu HEX mặc định khi tạo state thuộc nhóm này. */
  defaultColor: string;
  order: number;
}

export const STATE_GROUP_META: Record<ProjectStateGroupDto, StateGroupMeta> = {
  backlog: { value: "backlog", labelKey: "stateGroup.backlog", defaultColor: "#94a3b8", order: 0 },
  unstarted: {
    value: "unstarted",
    labelKey: "stateGroup.unstarted",
    defaultColor: "#64748b",
    order: 1,
  },
  started: { value: "started", labelKey: "stateGroup.started", defaultColor: "#3b82f6", order: 2 },
  completed: {
    value: "completed",
    labelKey: "stateGroup.completed",
    defaultColor: "#22c55e",
    order: 3,
  },
  cancelled: {
    value: "cancelled",
    labelKey: "stateGroup.cancelled",
    defaultColor: "#ef4444",
    order: 4,
  },
};

export const STATE_GROUP_ORDER: readonly ProjectStateGroupDto[] = [
  "backlog",
  "unstarted",
  "started",
  "completed",
  "cancelled",
];
