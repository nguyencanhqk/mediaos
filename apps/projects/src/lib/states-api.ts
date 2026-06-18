import { z } from "zod";
import type { CreateProjectStateRequest, UpdateProjectStateRequest } from "@mediaos/contracts";
import { projectStateSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * API trạng thái dự án (project_states — PM-1). Gated `read/create/update/delete:project_state`.
 * - GET  /projects/:projectId/states
 * - POST /projects/:projectId/states
 * - PATCH/DELETE /states/:stateId
 */
export const statesApi = {
  listStates: (projectId: string) =>
    apiFetch(`/projects/${projectId}/states`, z.array(projectStateSchema)),

  createState: (projectId: string, data: CreateProjectStateRequest) =>
    apiFetch(`/projects/${projectId}/states`, projectStateSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateState: (stateId: string, data: UpdateProjectStateRequest) =>
    apiFetch(`/states/${stateId}`, projectStateSchema, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  deleteState: (stateId: string) =>
    apiFetch(`/states/${stateId}`, z.void(), { method: "DELETE" }),
};
