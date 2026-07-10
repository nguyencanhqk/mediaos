import { z } from "zod";
import type {
  CreateTaskProjectRequest,
  UpdateTaskProjectRequest,
  TaskProjectResponseDto,
  TaskProjectPriorityDto,
} from "@mediaos/contracts";

/**
 * ProjectFormDrawer schema — S4-FE-TASK-1 (SPEC-06 §13.2, TASK-SCREEN-002).
 *
 * Form values đều là string (kể cả select rỗng = "") để khớp input HTML gốc — convert sang payload
 * thật (undefined/null) ở `toCreatePayload`/`toUpdatePayload`. KHÔNG có trường `status`/`visibility`:
 * BE thật (createTaskProjectSchema/updateTaskProjectSchema, packages/contracts/src/task.ts) không nhận
 * 2 trường này ở create/update — status đổi qua verb riêng (close), visibility CHƯA có cột DB (S4-TASK-BE-1
 * không build) → KHÔNG bịa field theo spec lý tưởng khi contract thật không có.
 */
export const PROJECT_PRIORITY_OPTIONS: readonly TaskProjectPriorityDto[] = [
  "Low",
  "Medium",
  "High",
  "Urgent",
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const projectFormSchema = z
  .object({
    name: z.string().min(1, "tasks:projects.form.errors.nameRequired").max(255),
    code: z.string().max(50),
    description: z.string().max(10000),
    ownerEmployeeId: z.string(),
    departmentId: z.string(),
    priority: z.union([z.enum(["Low", "Medium", "High", "Urgent"]), z.literal("")]),
    startDate: z.union([z.string().regex(ISO_DATE), z.literal("")]),
    endDate: z.union([z.string().regex(ISO_DATE), z.literal("")]),
  })
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "tasks:projects.form.errors.endBeforeStart",
    path: ["endDate"],
  });

export type ProjectFormValues = z.infer<typeof projectFormSchema>;

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  name: "",
  code: "",
  description: "",
  ownerEmployeeId: "",
  departmentId: "",
  priority: "",
  startDate: "",
  endDate: "",
};

export function projectToFormValues(item: TaskProjectResponseDto): ProjectFormValues {
  return {
    name: item.name,
    code: item.code ?? "",
    description: item.description ?? "",
    ownerEmployeeId: item.ownerEmployeeId ?? "",
    departmentId: item.departmentId ?? "",
    priority: item.priority ?? "",
    startDate: item.startDate ?? "",
    endDate: item.endDate ?? "",
  };
}

export function projectToCreatePayload(values: ProjectFormValues): CreateTaskProjectRequest {
  return {
    name: values.name,
    code: values.code || undefined,
    description: values.description || null,
    ownerEmployeeId: values.ownerEmployeeId || undefined,
    departmentId: values.departmentId || undefined,
    priority: values.priority || undefined,
    startDate: values.startDate || undefined,
    endDate: values.endDate || undefined,
  };
}

export function projectToUpdatePayload(values: ProjectFormValues): UpdateTaskProjectRequest {
  return {
    name: values.name,
    code: values.code || null,
    description: values.description || null,
    ownerEmployeeId: values.ownerEmployeeId || null,
    departmentId: values.departmentId || null,
    priority: values.priority || null,
    startDate: values.startDate || null,
    endDate: values.endDate || null,
  };
}
