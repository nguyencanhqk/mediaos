import { z } from "zod";
import {
  goalCoreResponseSchema,
  type GoalCoreResponseDto,
  goalDetailResponseSchema,
  type GoalDetailResponseDto,
  goalTreeNodeSchema,
  type GoalTreeNodeDto,
  goalUpdateResponseSchema,
  type GoalUpdateResponseDto,
  taskCoreResponseSchema,
  type TaskCoreResponseDto,
  type CreateGoalRequest,
  type UpdateGoalRequest,
  type ListGoalsQueryRequest,
  type GoalTreeQueryRequest,
  type ListGoalUpdatesQueryRequest,
} from "@mediaos/contracts";
import { apiFetch } from "./api-client";
import { buildQueryString } from "./api-params";

/**
 * S5-GOAL-FE-1 — GOAL API client (SPEC-10 §15 GOAL-API-001..010). MIRROR BE `GoalsController`
 * (apps/api/src/goals/goals.controller.ts) + `MeGoalsController`.
 *
 * MẢNG TRẦN: mọi endpoint đọc danh sách trả `Dto[]` (KHÔNG `{data,meta}`). apiFetch gỡ envelope chuẩn
 * `{success,data,error}` rồi parse — nên schema truyền vào là `z.array(itemSchema)`, TUYỆT ĐỐI KHÔNG
 * schema envelope (memory apifetch-drops-pagination-bare-array). Không có `total` từ server ⇒ page dùng
 * limit lớn (GOAL_PAGE_LIMIT_MAX) + không phân trang server (tập goal/kỳ bị chặn nhỏ).
 *
 * company_id + data-scope + masking là việc của SERVER — client chỉ gửi filter/id, KHÔNG gửi company_id.
 * Response validate Zod ở ranh giới; shape sai → ném ngay (KHÔNG âm thầm render dữ liệu sai).
 * `progressPercent` NULL = "chưa đo" (§13.2) — mapper BE giữ NULL, contracts để `.nullable()`.
 */
export const goalApi = {
  /** GET /goals — danh sách phẳng (view:goal), filter kỳ/cấp/phòng/owner + limit/offset. */
  listGoals: (query?: Partial<ListGoalsQueryRequest>): Promise<GoalCoreResponseDto[]> =>
    apiFetch(`/goals${buildQueryString(query ?? {})}`, z.array(goalCoreResponseSchema)),

  /** GET /goals/tree — cây ≤3 tầng kèm % từng nút (view:goal), filter kỳ/phòng/trạng thái. */
  getTree: (query?: Partial<GoalTreeQueryRequest>): Promise<GoalTreeNodeDto[]> =>
    apiFetch(`/goals/tree${buildQueryString(query ?? {})}`, z.array(goalTreeNodeSchema)),

  /** GET /goals/:id — chi tiết + breadcrumb cha + đếm con (view:goal). */
  getGoal: (id: string): Promise<GoalDetailResponseDto> =>
    apiFetch(`/goals/${id}`, goalDetailResponseSchema),

  /** POST /goals — tạo (create:goal). Service re-validate §12 → 422 kèm mã GOAL-ERR-XXX. */
  createGoal: (body: CreateGoalRequest): Promise<GoalCoreResponseDto> =>
    apiFetch("/goals", goalCoreResponseSchema, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  /** PATCH /goals/:id — cập nhật (update:goal), chặn khi đã chốt kỳ (GOAL-ERR-005). */
  updateGoal: (id: string, body: UpdateGoalRequest): Promise<GoalCoreResponseDto> =>
    apiFetch(`/goals/${id}`, goalCoreResponseSchema, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  /** DELETE /goals/:id — xoá mềm (delete:goal, 204), chặn khi còn con active (GOAL-ERR-007). */
  deleteGoal: (id: string): Promise<void> =>
    apiFetch(`/goals/${id}`, z.void(), { method: "DELETE" }),

  /** GET /goals/:id/tasks — task đang gắn (view:goal + read:task ở server). Read-only ở FE-1. */
  listLinkedTasks: (id: string): Promise<TaskCoreResponseDto[]> =>
    apiFetch(`/goals/${id}/tasks`, z.array(taskCoreResponseSchema)),

  /** GET /goals/:id/updates — sổ check-in/chốt kỳ/mở lại (view:goal), append-only. */
  listUpdates: (
    id: string,
    query?: Partial<ListGoalUpdatesQueryRequest>,
  ): Promise<GoalUpdateResponseDto[]> =>
    apiFetch(
      `/goals/${id}/updates${buildQueryString(query ?? {})}`,
      z.array(goalUpdateResponseSchema),
    ),
};
