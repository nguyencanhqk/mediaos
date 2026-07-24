import { z } from "zod";
import type {
  CreateGoalRequest,
  GoalDetailResponseDto,
  UpdateGoalRequest,
} from "@mediaos/contracts";

/**
 * S5-GOAL-FE-1 — schema + mapper FORM tạo/sửa mục tiêu (GOAL-SCREEN-003). Zod message = KHÓA i18n (ns
 * "goals") — component render `t(error.message)` (mẫu EmployeeFormPage). Validate CLIENT sớm cho các
 * mã lỗi hình-thức (GOAL-ERR-001/003/011/015); server re-validate §12 là cổng cuối (trả 422 + mã lỗi).
 *
 * Ràng buộc theo cấp (GOAL-ERR-001): ĐÚNG 1 cột neo theo `level`, còn lại NULL — toCreateDto chỉ set neo
 * đúng cấp, ép các neo khác về null (KHÔNG gửi rác).
 */

const dateOnly = z.string();

export const goalFormSchema = z
  .object({
    name: z.string().trim().min(1, "form.errors.nameRequired").max(255),
    description: z.string().max(5000),
    level: z.enum(["", "department", "project", "employee"]),
    departmentId: z.string(),
    projectId: z.string(),
    employeeId: z.string(),
    ownerEmployeeId: z.string(),
    parentGoalId: z.string(),
    periodType: z.enum(["quarter", "year", "custom"]),
    periodStart: dateOnly,
    periodEnd: dateOnly,
    measureType: z.enum(["percent", "number", "boolean"]),
    targetValue: z.string(),
    unit: z.string().max(50),
    progressMode: z.enum(["manual", "project", "tasks", "children"]),
    weight: z.string(),
    status: z.enum(["Draft", "Active", "Completed", "Cancelled"]),
  })
  .superRefine((v, ctx) => {
    // Cấp bắt buộc.
    if (v.level === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["level"],
        message: "form.errors.levelRequired",
      });
    }
    // Neo đúng cấp (GOAL-ERR-001).
    if (v.level === "department" && !v.departmentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["departmentId"],
        message: "form.errors.anchorRequired",
      });
    }
    if (v.level === "project" && !v.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["projectId"],
        message: "form.errors.anchorRequired",
      });
    }
    if (v.level === "employee" && !v.employeeId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["employeeId"],
        message: "form.errors.anchorRequired",
      });
    }
    // Kỳ (GOAL-ERR-003): cần cả 2 mốc + end > start.
    if (!v.periodStart || !v.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "form.errors.periodRequired",
      });
    } else if (v.periodEnd < v.periodStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodEnd"],
        message: "form.errors.periodOrder",
      });
    }
    // Trọng số > 0 (GOAL-ERR-011).
    const weightNum = Number(v.weight);
    if (v.weight.trim() === "" || !Number.isFinite(weightNum) || weightNum <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["weight"],
        message: "form.errors.weightPositive",
      });
    }
    // Giá trị mục tiêu bắt buộc khi đo bằng số + mode manual (GOAL-ERR-015).
    if (v.measureType === "number" && v.progressMode === "manual") {
      const targetNum = Number(v.targetValue);
      if (v.targetValue.trim() === "" || !Number.isFinite(targetNum)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetValue"],
          message: "form.errors.targetRequired",
        });
      }
    }
  });

export type GoalFormValues = z.infer<typeof goalFormSchema>;

export const EMPTY_GOAL_FORM: GoalFormValues = {
  name: "",
  description: "",
  level: "",
  departmentId: "",
  projectId: "",
  employeeId: "",
  ownerEmployeeId: "",
  parentGoalId: "",
  periodType: "custom",
  periodStart: "",
  periodEnd: "",
  measureType: "percent",
  targetValue: "",
  unit: "",
  progressMode: "manual",
  weight: "1",
  status: "Draft",
};

/** GoalDetailResponseDto → giá trị form (điền sẵn khi sửa). Số → chuỗi cho input; null → "". */
export function detailToFormValues(goal: GoalDetailResponseDto): GoalFormValues {
  return {
    name: goal.name,
    description: goal.description ?? "",
    level: goal.level === "company" ? "" : goal.level,
    departmentId: goal.departmentId ?? "",
    projectId: goal.projectId ?? "",
    employeeId: goal.employeeId ?? "",
    ownerEmployeeId: goal.ownerEmployeeId ?? "",
    parentGoalId: goal.parentGoalId ?? "",
    periodType: goal.periodType,
    periodStart: goal.periodStart,
    periodEnd: goal.periodEnd,
    measureType: goal.measureType,
    targetValue: goal.targetValue === null ? "" : String(goal.targetValue),
    unit: goal.unit ?? "",
    progressMode: goal.progressMode,
    weight: String(goal.weight),
    status: goal.status,
  };
}

/** Neo đúng cấp: chỉ set cột của `level`, các neo khác undefined (KHÔNG gửi). */
function anchorFor(
  values: GoalFormValues,
): Pick<CreateGoalRequest, "departmentId" | "projectId" | "employeeId"> {
  return {
    departmentId: values.level === "department" ? values.departmentId : undefined,
    projectId: values.level === "project" ? values.projectId : undefined,
    employeeId: values.level === "employee" ? values.employeeId : undefined,
  };
}

function optionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/** GoalFormValues → CreateGoalRequest (POST /goals). `level` đã đảm bảo ≠ "" nhờ validate trước submit. */
export function toCreateDto(values: GoalFormValues): CreateGoalRequest {
  return {
    name: values.name.trim(),
    description: values.description.trim() || undefined,
    level: values.level === "" ? "department" : values.level,
    ...anchorFor(values),
    parentGoalId: values.parentGoalId || undefined,
    ownerEmployeeId: values.ownerEmployeeId || undefined,
    periodType: values.periodType,
    periodStart: values.periodStart,
    periodEnd: values.periodEnd,
    measureType: values.measureType,
    targetValue: optionalNumber(values.targetValue),
    unit: values.unit.trim() || undefined,
    progressMode: values.progressMode,
    weight: optionalNumber(values.weight),
    status: values.status,
  };
}

/** GoalFormValues → UpdateGoalRequest (PATCH /goals/:id). Service chạy lại validate toàn bộ sau merge. */
export function toUpdateDto(values: GoalFormValues): UpdateGoalRequest {
  return toCreateDto(values);
}
