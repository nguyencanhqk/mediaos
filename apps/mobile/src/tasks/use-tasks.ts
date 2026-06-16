import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateCommentRequest, OfficeTaskStatusDto, TaskDto } from "@mediaos/contracts";
import { tasksApi } from "../api/tasks-api";

/** Query keys — mirror web (["tasks", ...]) so cache semantics line up across clients. */
export const MY_TASKS_KEY = ["tasks", "mine"] as const;
export const taskCommentsKey = (taskId: string) => ["tasks", taskId, "comments"] as const;
export const taskAttachmentsKey = (taskId: string) => ["tasks", taskId, "attachments"] as const;

/** GET /tasks — the caller's own tasks. */
export function useMyTasks() {
  return useQuery({ queryKey: MY_TASKS_KEY, queryFn: tasksApi.getMyTasks });
}

/**
 * Single task detail. The backend has NO `GET /tasks/:id`, so we read the task out of the shared
 * my-tasks cache (same queryKey ⇒ same cache entry). `select` narrows to the one task; a cache miss
 * (e.g. deep link before the list loaded) yields `null` and the screen shows a not-found state.
 */
export function useTask(taskId: string) {
  return useQuery({
    queryKey: MY_TASKS_KEY,
    queryFn: tasksApi.getMyTasks,
    select: (tasks: TaskDto[]) => tasks.find((t) => t.id === taskId) ?? null,
  });
}

/** GET /tasks/:id/comments — the task's activity trail (mobile has no status-history endpoint). */
export function useTaskComments(taskId: string) {
  return useQuery({
    queryKey: taskCommentsKey(taskId),
    queryFn: () => tasksApi.getComments(taskId),
  });
}

/** GET /tasks/:id/attachments — existing attachment metadata (read-only in M1). */
export function useTaskAttachments(taskId: string) {
  return useQuery({
    queryKey: taskAttachmentsKey(taskId),
    queryFn: () => tasksApi.listAttachments(taskId),
  });
}

/** POST /tasks/:id/comments. */
export function useAddComment(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCommentRequest) => tasksApi.addComment(taskId, data),
    onSuccess: () => void qc.invalidateQueries({ queryKey: taskCommentsKey(taskId) }),
  });
}

/** PATCH /tasks/:id/status — shortened office flow. Invalidates the list so the new status shows. */
export function useUpdateOfficeStatus(taskId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (status: OfficeTaskStatusDto) => tasksApi.updateTaskStatus(taskId, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: MY_TASKS_KEY }),
  });
}
