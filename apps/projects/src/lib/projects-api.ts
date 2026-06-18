import { z } from "zod";
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  UpdateProjectMemberRequest,
  UpdateProjectRequest,
} from "@mediaos/contracts";
import { projectSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * API dự án (PM-1) — list/detail/create/update + members. Server là nguồn sự thật:
 * mọi route gated PermissionGuard (`read/create/update:project`); client chỉ ẩn UX qua <PermissionGate>.
 * Tạo dự án server tự seed 5 state mặc định.
 */
export const projectsApi = {
  listProjects: () => apiFetch("/projects", z.array(projectSchema)),

  getProject: (id: string) => apiFetch(`/projects/${id}`, projectSchema),

  createProject: (data: CreateProjectRequest) =>
    apiFetch("/projects", projectSchema, { method: "POST", body: JSON.stringify(data) }),

  updateProject: (id: string, data: UpdateProjectRequest) =>
    apiFetch(`/projects/${id}`, projectSchema, { method: "PATCH", body: JSON.stringify(data) }),

  // ── Members ──────────────────────────────────────────────────────────────
  // Endpoint members trả envelope tự do (BE chưa cố định DTO chuẩn) → parse z.unknown(); UI lấy danh sách
  // thành viên qua getProject (project.members khi detail). Add/remove dùng cho trang Settings → Thành viên.
  addProjectMember: (projectId: string, data: AddProjectMemberRequest) =>
    apiFetch(`/projects/${projectId}/members`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateProjectMember: (projectId: string, memberId: string, data: UpdateProjectMemberRequest) =>
    apiFetch(`/projects/${projectId}/members/${memberId}`, z.unknown(), {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  removeProjectMember: (projectId: string, memberId: string) =>
    apiFetch(`/projects/${projectId}/members/${memberId}`, z.void(), { method: "DELETE" }),
};
