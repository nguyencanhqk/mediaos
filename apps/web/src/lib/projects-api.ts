import { z } from "zod";
import type {
  AddProjectChannelRequest,
  AddProjectMemberRequest,
  AddProjectTeamRequest,
  CreateProjectRequest,
  UpdateProjectChannelRequest,
  UpdateProjectMemberRequest,
  UpdateProjectRequest,
} from "@mediaos/contracts";
import { projectSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/** Filter list dự án (PRJ-001) — gửi sang `GET /projects` dưới dạng query param. */
export interface ProjectFilters {
  status?: string;
  projectType?: string;
  priority?: string;
  managerId?: string;
  q?: string;
}

function buildProjectQuery(filters: ProjectFilters = {}): string {
  const qs = new URLSearchParams();
  if (filters.status) qs.set("status", filters.status);
  if (filters.projectType) qs.set("projectType", filters.projectType);
  if (filters.priority) qs.set("priority", filters.priority);
  if (filters.managerId) qs.set("managerId", filters.managerId);
  if (filters.q) qs.set("q", filters.q);
  const suffix = qs.toString();
  return suffix ? `?${suffix}` : "";
}

export const projectsApi = {
  // ── Projects ──────────────────────────────────────────────────────────────
  listProjects: (filters?: ProjectFilters) =>
    apiFetch(`/projects${buildProjectQuery(filters)}`, z.array(projectSchema)),

  getProject: (id: string) => apiFetch(`/projects/${id}`, projectSchema),

  createProject: (data: CreateProjectRequest) =>
    apiFetch("/projects", projectSchema, { method: "POST", body: JSON.stringify(data) }),

  updateProject: (id: string, data: UpdateProjectRequest) =>
    apiFetch(`/projects/${id}`, projectSchema, { method: "PATCH", body: JSON.stringify(data) }),

  deleteProject: (id: string) => apiFetch(`/projects/${id}`, z.void(), { method: "DELETE" }),

  // ── Channels ──────────────────────────────────────────────────────────────
  addProjectChannel: (projectId: string, data: AddProjectChannelRequest) =>
    apiFetch(`/projects/${projectId}/channels`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateProjectChannel: (projectId: string, channelId: string, data: UpdateProjectChannelRequest) =>
    apiFetch(`/projects/${projectId}/channels/${channelId}`, z.unknown(), {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  removeProjectChannel: (projectId: string, channelId: string) =>
    apiFetch(`/projects/${projectId}/channels/${channelId}`, z.void(), { method: "DELETE" }),

  // ── Teams ─────────────────────────────────────────────────────────────────
  addProjectTeam: (projectId: string, data: AddProjectTeamRequest) =>
    apiFetch(`/projects/${projectId}/teams`, z.unknown(), {
      method: "POST",
      body: JSON.stringify(data),
    }),

  removeProjectTeam: (projectId: string, teamId: string) =>
    apiFetch(`/projects/${projectId}/teams/${teamId}`, z.void(), { method: "DELETE" }),

  // ── Members ───────────────────────────────────────────────────────────────
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
