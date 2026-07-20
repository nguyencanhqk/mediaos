/**
 * Form schema thêm/sửa việc con (S5-TASK-SUBTASK-1, DECISIONS-05 D-31) — mirror task-form-schema.ts:
 * <input type="datetime-local"> KHÔNG khớp `.datetime({offset:true})` ISO của contracts (thiếu offset)
 * nên form dùng string local rồi transform sang ISO ở `subtaskFormToCreatePayload`/`ToUpdatePayload`.
 *
 * CHỈ 3 field (title/assignee/due) — mirror plan fe mục 1 "(title + assignee + due)": panel việc con
 * KHÔNG cần description/department/priority/project (project suy TỪ CHA — BE 400 nếu gửi kèm lệch).
 */
import { z } from "zod";
import type { CreateTaskCoreRequest, UpdateTaskCoreRequest } from "@mediaos/contracts";
import { localDatetimeToIso, isoToLocalDatetime } from "./constants";

export const subtaskFormSchema = z.object({
  title: z.string().trim().min(1, "tasks.form.errors.titleRequired").max(500),
  assigneeEmployeeId: z.string().optional(),
  dueAt: z.string().optional(),
});

export type SubtaskFormValues = z.infer<typeof subtaskFormSchema>;

export const EMPTY_SUBTASK_FORM: SubtaskFormValues = {
  title: "",
  assigneeEmployeeId: "",
  dueAt: "",
};

/** POST /tasks với `parentTaskId` — KHÔNG gửi kèm `projectId`/`stateId` (BE suy từ cha; suy khác → 400). */
export function subtaskFormToCreatePayload(
  v: SubtaskFormValues,
  parentTaskId: string,
): CreateTaskCoreRequest {
  return {
    title: v.title,
    assigneeEmployeeId: v.assigneeEmployeeId || undefined,
    dueAt: localDatetimeToIso(v.dueAt),
    parentTaskId,
  };
}

/** PATCH /tasks/:id — sửa nhanh 1 việc con hiện có (title/assignee/due). */
export function subtaskFormToUpdatePayload(v: SubtaskFormValues): UpdateTaskCoreRequest {
  return {
    title: v.title,
    assigneeEmployeeId: v.assigneeEmployeeId || null,
    dueAt: localDatetimeToIso(v.dueAt) ?? null,
  };
}

/** Prefill form sửa nhanh từ 1 dòng SubtaskListItemDto (đủ field, không cần fetch thêm). */
export function subtaskItemToFormValues(item: {
  title: string;
  mainAssigneeEmployeeId: string | null;
  dueAt: string | null;
}): SubtaskFormValues {
  return {
    title: item.title,
    assigneeEmployeeId: item.mainAssigneeEmployeeId ?? "",
    dueAt: isoToLocalDatetime(item.dueAt),
  };
}
