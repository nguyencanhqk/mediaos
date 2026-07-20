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
    // S5-TASK-MOVEPROJ-1 — CỘT pipeline đích. Chỉ có nghĩa khi đã chọn dự án; gửi kèm để tránh
    // task nằm ở dự án này mà state_id còn trỏ cột dự án khác (xem taskFormToUpdatePayload).
    stateId: z.string().optional(),
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
  stateId: "",
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
    // CỐ Ý để RỖNG (không prefill task.stateId): form sửa gửi stateId là mỗi lần sửa tiêu đề/mô tả
    // đều đòi THÊM `update-state:task` ⇒ người chỉ có `update:task` mất khả năng sửa. Đổi cột/dự án
    // đi qua đường riêng (TaskMoveProjectDialog), nơi quyền đó được kiểm tường minh.
    stateId: "",
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
    // Chỉ gửi khi CÓ giá trị: `createTaskCoreSchema` là .strict() và `stateId` không nhận null;
    // gửi kèm stateId còn đòi THÊM `update-state:task` ở server (task-core.service §3c).
    stateId: v.stateId || undefined,
    assigneeEmployeeId: v.assigneeEmployeeId || undefined,
    departmentId: v.departmentId || undefined,
    priority: v.priority || undefined,
    startAt: localDatetimeToIso(v.startAt),
    dueAt: localDatetimeToIso(v.dueAt),
  };
}

/**
 * S5-TASK-MOVEPROJ-1 — KHÔNG gửi `projectId` (và do đó không gửi `stateId`).
 *
 * BUG ĐÃ VÁ: bản cũ LUÔN gửi `projectId` và KHÔNG BAO GIỜ gửi `stateId`. Server đổi `project_id`
 * nhưng không đụng `state_id` (nhánh ghi project không gọi applyStateChangeTx) ⇒ task nằm ở dự án
 * mới trong khi cột vẫn trỏ dự án CŨ. Board dự án mới không khớp cột nào nên thả thẻ vào cột mặc
 * định, còn DB mang tham chiếu chéo dự án tới lần kéo-thả kế tiếp. Im lặng: không lỗi, không cảnh báo.
 *
 * Đổi dự án giờ đi ĐÚNG MỘT đường — `TaskMoveProjectDialog`, nơi bắt buộc chọn cột đích và gửi cả
 * hai trong CÙNG một PATCH. Bỏ hẳn `projectId` khỏi đây thay vì khoá ô ở giao diện: ô bị `disabled`
 * có thể làm react-hook-form trả `undefined` ⇒ payload gửi `projectId: null` ⇒ GỠ task khỏi dự án.
 * Hỏng nặng hơn bug đang vá, và trông y hệt "không làm gì".
 */
export function taskFormToUpdatePayload(v: TaskFormValues): UpdateTaskCoreRequest {
  return {
    title: v.title,
    description: v.description || null,
    assigneeEmployeeId: v.assigneeEmployeeId || null,
    departmentId: v.departmentId || null,
    priority: v.priority || null,
    startAt: localDatetimeToIso(v.startAt) ?? null,
    dueAt: localDatetimeToIso(v.dueAt) ?? null,
  };
}
