import { z } from "zod";
import {
  taskSchema,
  commentSchema,
  attachmentSchema,
  attachmentDownloadUrlSchema,
  type CreateCommentRequest,
  type OfficeTaskStatusDto,
} from "@mediaos/contracts";
import { apiFetch } from "./client";

/**
 * Task API client for mobile — mirrors apps/web/src/lib/tasks-api.ts route-for-route.
 * Every call attaches the Bearer token (authenticated: true) and parses via the shared Zod contract.
 * The server gates each route with PermissionGuard / RLS; the client never decides authorization.
 */
export const tasksApi = {
  /** GET /tasks — the caller's own assigned tasks (ungated; RLS + assignee-scoped server-side). */
  getMyTasks: () => apiFetch("/tasks", z.array(taskSchema), { authenticated: true }),

  /** GET /tasks/:taskId/comments — activity trail for a task (read ungated; RLS-scoped). */
  getComments: (taskId: string) =>
    apiFetch(`/tasks/${taskId}/comments`, z.array(commentSchema), { authenticated: true }),

  /** POST /tasks/:taskId/comments — gated `comment:comment` server-side. */
  addComment: (taskId: string, data: CreateCommentRequest) =>
    apiFetch(`/tasks/${taskId}/comments`, commentSchema, {
      authenticated: true,
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * PATCH /tasks/:taskId/status — shortened office flow only. `status` is narrowed to
   * OfficeTaskStatusDto at compile time; the server re-validates (SEC-2 defense-in-depth) and
   * gates `update:task`.
   */
  updateTaskStatus: (taskId: string, status: OfficeTaskStatusDto) =>
    apiFetch(`/tasks/${taskId}/status`, taskSchema, {
      authenticated: true,
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  /** GET /tasks/:taskId/attachments — metadata only (no signed URL persisted). Gated `read:task`. */
  listAttachments: (taskId: string) =>
    apiFetch(`/tasks/${taskId}/attachments`, z.array(attachmentSchema), { authenticated: true }),

  /**
   * GET /tasks/:taskId/attachments/:id/download — ephemeral presigned GET url. Gated `read:task`.
   * (M1 supports viewing/downloading existing attachments; binary UPLOAD is deferred — see report.)
   */
  getAttachmentDownloadUrl: (taskId: string, attachmentId: string) =>
    apiFetch(
      `/tasks/${taskId}/attachments/${attachmentId}/download`,
      attachmentDownloadUrlSchema,
      { authenticated: true },
    ),
};
