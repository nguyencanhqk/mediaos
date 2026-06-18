import type { ListTasksQueryRequest } from "@mediaos/contracts";

/**
 * Khóa react-query tập trung — tránh lệch chuỗi giữa các component (đọc/ghi cùng cache).
 * Mỗi mutation invalidate đúng prefix tương ứng.
 */
export const queryKeys = {
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  states: (projectId: string) => ["states", projectId] as const,
  labels: (projectId: string) => ["labels", projectId] as const,
  board: (projectId: string, filter?: ListTasksQueryRequest) =>
    ["board", projectId, filter ?? {}] as const,
  comments: (taskId: string) => ["comments", taskId] as const,
  employees: ["employees"] as const,
};
