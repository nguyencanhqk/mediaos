import { z } from "zod";
import {
  labelSchema,
  type CreateLabelRequest,
  type LabelDto,
  type UpdateLabelRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";

/**
 * Gắn thẻ (labels PM-1, hồi sinh cho UX "Gắn thẻ" kiểu Base) — client nhãn màu theo dự án.
 * Routes ĐÃ sống ở BE: labels.controller (CRUD, gate read/create/update/delete:label — seed 0420)
 * + tasks.controller POST|DELETE /tasks/:taskId/labels/:labelId (gắn/gỡ, gate update:task).
 *
 * BẤT BIẾN: company_id do SERVER resolve — client KHÔNG forward. Response validate Zod ở ranh giới.
 */
export const taskLabelsApi = {
  /** GET /projects/:id/labels — danh sách nhãn của dự án (order theo tên). Gate read:label. */
  listLabels: (projectId: string): Promise<LabelDto[]> =>
    apiFetch(`/projects/${projectId}/labels`, z.array(labelSchema)),

  /** POST /projects/:id/labels — tạo nhãn (name + color hex, mặc định server #6366f1). Gate create:label. */
  createLabel: (projectId: string, body: CreateLabelRequest): Promise<LabelDto> =>
    apiFetch(`/projects/${projectId}/labels`, labelSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /labels/:labelId — đổi tên/màu nhãn. Gate update:label. */
  updateLabel: (labelId: string, body: UpdateLabelRequest): Promise<LabelDto> =>
    apiFetch(`/labels/${labelId}`, labelSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /labels/:labelId — xoá mềm nhãn (link task giữ nguyên nhưng bị lọc khỏi mọi đường đọc). */
  deleteLabel: (labelId: string): Promise<void> =>
    apiFetch(`/labels/${labelId}`, z.void(), { method: "DELETE" }),

  /** POST /tasks/:taskId/labels/:labelId — GẮN nhãn vào task (idempotent). Gate update:task. */
  addLabelToTask: (taskId: string, labelId: string): Promise<void> =>
    apiFetch(`/tasks/${taskId}/labels/${labelId}`, z.void(), { method: "POST" }),

  /** DELETE /tasks/:taskId/labels/:labelId — GỠ nhãn khỏi task. Gate update:task. */
  removeLabelFromTask: (taskId: string, labelId: string): Promise<void> =>
    apiFetch(`/tasks/${taskId}/labels/${labelId}`, z.void(), { method: "DELETE" }),
};
