import { z } from "zod";

/**
 * S5-GOAL-BE-1 — contracts module GOAL (SPEC-10 · DB-11 §7 enum chuẩn).
 *
 * NGUỒN SỰ THẬT DTO: file này. Enum khớp CHÍNH XÁC CHECK của migration 0504 (`chk_goals_level`,
 * `chk_goals_period_type`, `chk_goals_measure`, `chk_goals_mode`, `chk_goals_status`).
 *
 * ⚠️ CỐ Ý ĐỂ "LỎNG" Ở ZOD, "CHẶT" Ở SERVICE cho các luật CÓ MÃ LỖI (SPEC-10 §12): `periodStart`/
 * `periodEnd`/`weight`/`targetValue`/`level='company'` KHÔNG bị chặn ở DTO, để service trả **422 kèm mã
 * GOAL-ERR-XXX** thay vì 400 zod vô danh. Ràng buộc thuần-hình-thức (uuid, độ dài chuỗi, enum) vẫn chặn
 * tại biên = 400.
 */

// ── Enum (DB-11 §7) ────────────────────────────────────────────────────────────

/** Cấp mục tiêu. `company` chừa sẵn schema — service MVP chặn (GOAL-ERR-004). */
export const goalLevelSchema = z.enum(["company", "department", "project", "employee"]);
export type GoalLevelDto = z.infer<typeof goalLevelSchema>;

export const goalPeriodTypeSchema = z.enum(["quarter", "year", "custom"]);
export type GoalPeriodTypeDto = z.infer<typeof goalPeriodTypeSchema>;

export const goalMeasureTypeSchema = z.enum(["percent", "number", "boolean"]);
export type GoalMeasureTypeDto = z.infer<typeof goalMeasureTypeSchema>;

export const goalProgressModeSchema = z.enum(["manual", "project", "tasks", "children"]);
export type GoalProgressModeDto = z.infer<typeof goalProgressModeSchema>;

export const goalStatusSchema = z.enum(["Draft", "Active", "Completed", "Cancelled"]);
export type GoalStatusDto = z.infer<typeof goalStatusSchema>;

/** DATE-only (period_start/period_end là cột `date`, KHÔNG timestamp — UTC-at-rest không áp dụng). */
const goalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Ngày phải theo định dạng YYYY-MM-DD");

// ── Write (GOAL-API-002/004) ───────────────────────────────────────────────────

/**
 * POST /goals (create:goal). Neo (`departmentId`/`projectId`/`employeeId`) và `parentGoalId` đều là id
 * DO CLIENT GỬI ⇒ service PHẢI resolve dưới company của actor trước khi ghi (FK đơn cột KHÔNG ép
 * cùng-tenant — finding gate S5-GOAL-DB-1); id của công ty khác ⇒ 404.
 *
 * `ownerEmployeeId` bỏ trống ⇒ service tự suy (goal nhân viên: = employeeId; còn lại: employee của actor).
 */
export const createGoalSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().max(5000).nullish(),
  level: goalLevelSchema,
  departmentId: z.string().uuid().nullish(),
  projectId: z.string().uuid().nullish(),
  employeeId: z.string().uuid().nullish(),
  parentGoalId: z.string().uuid().nullish(),
  ownerEmployeeId: z.string().uuid().nullish(),
  /** Vắng ⇒ service mặc định 'custom' (kỳ tự do). */
  periodType: goalPeriodTypeSchema.optional(),
  periodStart: goalDateSchema.optional(),
  periodEnd: goalDateSchema.optional(),
  measureType: goalMeasureTypeSchema.optional(),
  targetValue: z.number().finite().nullish(),
  unit: z.string().trim().max(50).nullish(),
  progressMode: goalProgressModeSchema.optional(),
  weight: z.number().finite().optional(),
  status: goalStatusSchema.optional(),
});
export type CreateGoalRequest = z.infer<typeof createGoalSchema>;

/**
 * PATCH /goals/:id (update:goal) — partial. Đổi `level`/neo/parent ⇒ service CHẠY LẠI TOÀN BỘ validate
 * như create (không patch từng field rời rạc — tránh đẻ hàng vỡ bất biến mà CHECK vẫn cho qua).
 * `goalCode`, `progressPercent`, `currentValue`, `finalizedAt` KHÔNG sửa qua đây (BE-2 sở hữu đường đo).
 */
export const updateGoalSchema = createGoalSchema.partial();
export type UpdateGoalRequest = z.infer<typeof updateGoalSchema>;

// ── Read (GOAL-API-001/003/006/013) ────────────────────────────────────────────

/** Bản ghi goal chuẩn trả về mọi endpoint đọc. `progressPercent` NULL = "chưa đo" (KHÁC 0% — §13.2). */
export const goalCoreResponseSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  goalCode: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  level: goalLevelSchema,
  departmentId: z.string().uuid().nullable(),
  projectId: z.string().uuid().nullable(),
  employeeId: z.string().uuid().nullable(),
  parentGoalId: z.string().uuid().nullable(),
  ownerEmployeeId: z.string().uuid(),
  periodType: goalPeriodTypeSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  measureType: goalMeasureTypeSchema,
  targetValue: z.number().nullable(),
  currentValue: z.number().nullable(),
  unit: z.string().nullable(),
  progressMode: goalProgressModeSchema,
  progressPercent: z.number().nullable(),
  weight: z.number(),
  status: goalStatusSchema,
  finalizedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type GoalCoreResponseDto = z.infer<typeof goalCoreResponseSchema>;

/** Breadcrumb cha (GOAL-API-003) — chỉ định danh, KHÔNG lồng cả bản ghi cha. */
export const goalBreadcrumbSchema = z.object({
  id: z.string().uuid(),
  goalCode: z.string(),
  name: z.string(),
  level: goalLevelSchema,
});
export type GoalBreadcrumbDto = z.infer<typeof goalBreadcrumbSchema>;

/** GET /goals/:id — core + breadcrumb cha + số goal con còn sống. */
export const goalDetailResponseSchema = goalCoreResponseSchema.extend({
  parent: goalBreadcrumbSchema.nullable(),
  childCount: z.number().int().nonnegative(),
});
export type GoalDetailResponseDto = z.infer<typeof goalDetailResponseSchema>;

/** Nút cây (GOAL-API-006) — đệ quy; cấu trúc dữ liệu chặn ở 3 tầng (department → project|employee). */
export type GoalTreeNodeDto = GoalCoreResponseDto & { children: GoalTreeNodeDto[] };
export const goalTreeNodeSchema: z.ZodType<GoalTreeNodeDto> = z.lazy(() =>
  goalCoreResponseSchema.extend({ children: z.array(goalTreeNodeSchema) }),
);

/** Trần trang cho danh sách goal (repo re-clamp lần nữa — defense-in-depth). */
export const GOAL_PAGE_LIMIT_MAX = 200;

/**
 * GET /goals (GOAL-API-001). `periodFrom`/`periodTo` lọc GIAO NHAU với kỳ của goal
 * (`period_end >= periodFrom` AND `period_start <= periodTo`) — không đòi trùng khít mốc.
 * `limit`/`offset` dùng `z.coerce.number()` (idempotent khi ZodValidationPipe chạy 2 lần —
 * memory zod-query-param-double-pipe-idempotent).
 */
export const listGoalsQuerySchema = z.object({
  level: goalLevelSchema.optional(),
  departmentId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  parentGoalId: z.string().uuid().optional(),
  status: goalStatusSchema.optional(),
  periodFrom: goalDateSchema.optional(),
  periodTo: goalDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(GOAL_PAGE_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListGoalsQueryRequest = z.infer<typeof listGoalsQuerySchema>;

/** GET /goals/tree (GOAL-API-006) — cùng bộ lọc kỳ/phòng/trạng thái, KHÔNG phân trang (cây nông). */
export const goalTreeQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  status: goalStatusSchema.optional(),
  periodFrom: goalDateSchema.optional(),
  periodTo: goalDateSchema.optional(),
});
export type GoalTreeQueryRequest = z.infer<typeof goalTreeQuerySchema>;

/**
 * GET /me/goals (GOAL-API-013) — CỐ Ý KHÔNG CÓ `employeeId`: chủ thể resolve TỪ TOKEN (SPEC-09 §14.4).
 * Zod strip field lạ ⇒ client bơm `?employeeId=` không tới được service. ĐỪNG dùng chung
 * `listGoalsQuerySchema` cho route này (ở đó `employeeId` là bộ lọc hợp lệ trong phạm vi actor).
 */
export const meGoalsQuerySchema = z.object({
  status: goalStatusSchema.optional(),
  periodFrom: goalDateSchema.optional(),
  periodTo: goalDateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(GOAL_PAGE_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type MeGoalsQueryRequest = z.infer<typeof meGoalsQuerySchema>;

// ══ S5-GOAL-BE-2 — vòng đo: check-in · sổ cập nhật · chốt kỳ · gắn/tháo task ══════════════════════

/** Loại bản ghi trong sổ `goal_updates` (DB-11 §6.2). Recompute tự động KHÔNG ghi sổ — tránh phình. */
export const goalUpdateTypeSchema = z.enum(["checkin", "finalize", "reopen"]);
export type GoalUpdateTypeDto = z.infer<typeof goalUpdateTypeSchema>;

/**
 * POST /goals/:id/check-in (GOAL-API-007, cặp `('checkin','goal')`).
 *
 * `currentValue` và `progressPercent` là HAI CÁCH GỌI CÙNG MỘT CHỖ (cột `current_value`) tuỳ
 * `measure_type` của mục tiêu — `percent` thì con số CHÍNH LÀ phần trăm, `number` thì là giá trị thực
 * đo được, `boolean` thì 0/khác-0. Gửi cả hai ⇒ 422 ở service (mã GOAL-ERR-006): đoán hộ người dùng
 * xem họ muốn cái nào là cách chắc chắn ghi sai một nửa số lần.
 *
 * Cả hai đều OPTIONAL: check-in "chỉ ghi cảm nhận + ghi chú" (confidence/note) là hợp lệ và KHÔNG đổi
 * số — với mục tiêu đo bằng task/dự án/mục tiêu con thì đó là hình thức check-in DUY NHẤT có nghĩa.
 */
export const checkinGoalSchema = z.object({
  currentValue: z.number().finite().nullish(),
  progressPercent: z.number().finite().nullish(),
  /** Cảm nhận khả năng đạt 0–100 (DB CHECK cùng khoảng). */
  confidence: z.number().int().min(0).max(100).nullish(),
  note: z.string().trim().max(2000).nullish(),
});
export type CheckinGoalRequest = z.infer<typeof checkinGoalSchema>;

/** POST /goals/:id/finalize · /reopen (GOAL-API-009, cặp `('finalize','goal')`) — ghi chú tuỳ chọn. */
export const finalizeGoalSchema = z.object({
  note: z.string().trim().max(2000).nullish(),
});
export type FinalizeGoalRequest = z.infer<typeof finalizeGoalSchema>;

/** Một dòng sổ `goal_updates` (GOAL-API-008). Ledger append-only ⇒ KHÔNG có updatedAt/deletedAt. */
export const goalUpdateResponseSchema = z.object({
  id: z.string().uuid(),
  goalId: z.string().uuid(),
  updateType: goalUpdateTypeSchema,
  actorUserId: z.string().uuid(),
  oldCurrentValue: z.number().nullable(),
  newCurrentValue: z.number().nullable(),
  oldProgressPercent: z.number().nullable(),
  newProgressPercent: z.number().nullable(),
  confidence: z.number().int().nullable(),
  note: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type GoalUpdateResponseDto = z.infer<typeof goalUpdateResponseSchema>;

/** GET /goals/:id/updates — `z.coerce` để idempotent khi ZodValidationPipe chạy 2 LẦN. */
export const listGoalUpdatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(GOAL_PAGE_LIMIT_MAX).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
export type ListGoalUpdatesQueryRequest = z.infer<typeof listGoalUpdatesQuerySchema>;

/** Trần số task gắn trong MỘT lần gọi (chống payload khổng lồ khoá hàng loạt trong 1 tx). */
export const GOAL_LINK_TASKS_MAX = 100;

/** POST /goals/:id/tasks (GOAL-API-010, bulk) — gắn task vào mục tiêu. */
export const linkGoalTasksSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(GOAL_LINK_TASKS_MAX),
});
export type LinkGoalTasksRequest = z.infer<typeof linkGoalTasksSchema>;

/**
 * Kết quả gắn/tháo. `warnings` = CẢNH BÁO MỀM của GOAL-ERR-008 vế mục tiêu cấp phòng (task không liên
 * quan phòng vẫn được gắn — SPEC-10 §12 nói rõ "không chặn"); vế `employee`/`project` thì CHẶN bằng 422
 * nên không bao giờ xuất hiện ở đây.
 */
export const goalTaskLinkResultSchema = z.object({
  goalId: z.string().uuid(),
  linked: z.number().int().nonnegative(),
  alreadyLinked: z.number().int().nonnegative(),
  warnings: z.array(
    z.object({
      taskId: z.string().uuid(),
      taskCode: z.string().nullable(),
      message: z.string(),
    }),
  ),
});
export type GoalTaskLinkResultDto = z.infer<typeof goalTaskLinkResultSchema>;
