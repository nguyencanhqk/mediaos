/**
 * Form schema tạo/sửa task core (S4-FE-TASK-2, SPEC-06 §13.6, TASK-SCREEN-006) — tách khỏi
 * createTaskCoreSchema/updateTaskCoreSchema (contracts) vì <input type="datetime-local"> KHÔNG khớp
 * `.datetime({offset:true})` ISO (thiếu offset). Form dùng string local rồi transform sang ISO ở
 * `taskFormToCreatePayload`/`taskFormToUpdatePayload` — mirror project-form-schema.ts/adjustment-form-schema.ts.
 */
import { z } from "zod";
import type {
  CreateTaskCoreRequest,
  UpdateTaskCoreRequest,
  TaskCoreResponseDto,
} from "@mediaos/contracts";
import { TASK_CORE_PRIORITY_OPTIONS, localDatetimeToIso, isoToLocalDatetime } from "./constants";

export const taskFormSchema = z
  .object({
    title: z.string().trim().min(1, "tasks.form.errors.titleRequired").max(500),
    description: z.string().max(20000).optional(),
    projectId: z.string().optional(),
    assigneeEmployeeId: z.string().optional(),
    departmentId: z.string().optional(),
    priority: z.enum(TASK_CORE_PRIORITY_OPTIONS).optional().or(z.literal("")),
    startAt: z.string().optional(),
    dueAt: z.string().optional(),
  })
  .refine(
    (v) => {
      if (!v.startAt || !v.dueAt) return true;
      const start = new Date(v.startAt).getTime();
      const due = new Date(v.dueAt).getTime();
      return Number.isNaN(start) || Number.isNaN(due) || due >= start;
    },
    { message: "tasks.form.errors.dueBeforeStart", path: ["dueAt"] },
  );

export type TaskFormValues = z.infer<typeof taskFormSchema>;

export const EMPTY_TASK_FORM: TaskFormValues = {
  title: "",
  description: "",
  projectId: "",
  assigneeEmployeeId: "",
  departmentId: "",
  priority: "",
  startAt: "",
  dueAt: "",
};

export function taskToFormValues(task: TaskCoreResponseDto): TaskFormValues {
  return {
    title: task.title,
    description: task.description ?? "",
    projectId: task.projectId ?? "",
    assigneeEmployeeId: task.mainAssigneeEmployeeId ?? "",
    departmentId: task.departmentId ?? "",
    priority: task.priority ?? "",
    startAt: isoToLocalDatetime(task.startAt),
    dueAt: isoToLocalDatetime(task.dueAt),
  };
}

export function taskFormToCreatePayload(v: TaskFormValues): CreateTaskCoreRequest {
  return {
    title: v.title,
    description: v.description || undefined,
    projectId: v.projectId || undefined,
    assigneeEmployeeId: v.assigneeEmployeeId || undefined,
    departmentId: v.departmentId || undefined,
    priority: v.priority || undefined,
    startAt: localDatetimeToIso(v.startAt),
    dueAt: localDatetimeToIso(v.dueAt),
  };
}

export function taskFormToUpdatePayload(v: TaskFormValues): UpdateTaskCoreRequest {
  return {
    title: v.title,
    description: v.description || null,
    projectId: v.projectId || null,
    assigneeEmployeeId: v.assigneeEmployeeId || null,
    departmentId: v.departmentId || null,
    priority: v.priority || null,
    startAt: localDatetimeToIso(v.startAt) ?? null,
    dueAt: localDatetimeToIso(v.dueAt) ?? null,
  };
}
