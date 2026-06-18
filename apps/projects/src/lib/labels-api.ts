import { z } from "zod";
import type { CreateLabelRequest, UpdateLabelRequest } from "@mediaos/contracts";
import { labelSchema } from "@mediaos/contracts";
import { apiFetch } from "@mediaos/web-core";

/**
 * API nhãn dự án (labels — PM-1). Gated `read/create/update/delete:label`.
 * - GET  /projects/:projectId/labels
 * - POST /projects/:projectId/labels
 * - PATCH/DELETE /labels/:labelId
 */
export const labelsApi = {
  listLabels: (projectId: string) =>
    apiFetch(`/projects/${projectId}/labels`, z.array(labelSchema)),

  createLabel: (projectId: string, data: CreateLabelRequest) =>
    apiFetch(`/projects/${projectId}/labels`, labelSchema, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateLabel: (labelId: string, data: UpdateLabelRequest) =>
    apiFetch(`/labels/${labelId}`, labelSchema, { method: "PATCH", body: JSON.stringify(data) }),

  deleteLabel: (labelId: string) =>
    apiFetch(`/labels/${labelId}`, z.void(), { method: "DELETE" }),
};
