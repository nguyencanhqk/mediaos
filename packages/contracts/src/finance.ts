import { z } from "zod";
import { idSchema } from "./common/id";

/**
 * G13 Finance — Revenue · Cost · Allocation · Profit · Expense.
 *
 * Sổ cái (`revenue_records`/`cost_records`/`profit_snapshots`/`cost_allocations`) là APPEND-ONLY
 * (bất biến #2): "sửa/xoá" = bản ghi mới (`entryKind: adjustment|void` + `replacesRecordId`).
 * Số tiền nullable: null = bị MASK server-side (thiếu quyền `view-finance:finance` — sensitive).
 */

export const revenueSourceEnum = z.enum([
  "youtube_adsense",
  "tiktok",
  "facebook",
  "sponsorship",
  "affiliate",
  "manual",
  "other",
]);
export type RevenueSource = z.infer<typeof revenueSourceEnum>;

export const costTypeEnum = z.enum([
  "salary",
  "freelancer",
  "software",
  "equipment",
  "ads",
  "production",
  "training",
  "recruitment",
  "operation",
  "other",
]);
export type CostType = z.infer<typeof costTypeEnum>;

export const financeEntryKindEnum = z.enum(["original", "adjustment", "void"]);
export type FinanceEntryKind = z.infer<typeof financeEntryKindEnum>;

export const allocationTargetTypeEnum = z.enum([
  "channel",
  "project",
  "content_item",
  "team",
  "org_unit",
  "employee",
]);
export type AllocationTargetType = z.infer<typeof allocationTargetTypeEnum>;

export const allocationMethodEnum = z.enum([
  "equal_split",
  "manual_percent",
  "by_video_count",
  "by_task_count",
  "by_work_hours",
  "by_revenue_ratio",
]);
export type AllocationMethod = z.infer<typeof allocationMethodEnum>;

/** CHECK đủ 7 giá trị theo ERD §13.4; MVP chỉ COMPUTE 4 giá trị đầu (xem createProfitSnapshotSchema). */
export const profitTargetTypeEnum = z.enum([
  "company",
  "channel",
  "project",
  "content_item",
  "platform",
  "org_unit",
  "team",
]);
export type ProfitTargetType = z.infer<typeof profitTargetTypeEnum>;

export const expenseStatusEnum = z.enum(["pending", "approved", "rejected", "cancelled"]);
export type ExpenseStatus = z.infer<typeof expenseStatusEnum>;

export const expenseDecisionEnum = z.enum(["approved", "rejected"]);
export type ExpenseDecision = z.infer<typeof expenseDecisionEnum>;

// ─── Revenue (G13-1) ─────────────────────────────────────────────────────────

export const revenueRecordSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  platformId: idSchema.nullable().optional(),
  platformName: z.string().nullable().optional(),
  channelId: idSchema.nullable().optional(),
  channelName: z.string().nullable().optional(),
  projectId: idSchema.nullable().optional(),
  projectName: z.string().nullable().optional(),
  contentItemId: idSchema.nullable().optional(),
  contentTitle: z.string().nullable().optional(),
  /** null = mask (không có view-finance). */
  amount: z.number().nullable(),
  currency: z.string(),
  revenueDate: z.string().date(),
  periodStart: z.string().date().nullable().optional(),
  periodEnd: z.string().date().nullable().optional(),
  source: revenueSourceEnum,
  description: z.string().nullable().optional(),
  attachmentUrl: z.string().nullable().optional(),
  enteredBy: idSchema,
  enteredByName: z.string().nullable().optional(),
  entryKind: financeEntryKindEnum,
  replacesRecordId: idSchema.nullable().optional(),
  /** false = đã bị thay thế bởi bản ghi khác hoặc là bản void. */
  isEffective: z.boolean(),
  createdAt: z.string().datetime(),
});
export type RevenueRecordDto = z.infer<typeof revenueRecordSchema>;

const revenueFieldsSchema = z.object({
  platformId: idSchema.optional(),
  channelId: idSchema.optional(),
  projectId: idSchema.optional(),
  contentItemId: idSchema.optional(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).default("VND"),
  revenueDate: z.string().date(),
  periodStart: z.string().date().optional(),
  periodEnd: z.string().date().optional(),
  source: revenueSourceEnum,
  description: z.string().max(2000).optional(),
  attachmentUrl: z.string().url().max(1000).optional(),
});

export const createRevenueSchema = revenueFieldsSchema.refine(
  (d) => !d.periodStart || !d.periodEnd || d.periodEnd >= d.periodStart,
  { message: "periodEnd phải >= periodStart", path: ["periodEnd"] },
);
export type CreateRevenueRequest = z.infer<typeof createRevenueSchema>;

/** "Sửa" sổ cái append-only: bản ghi adjustment thay thế toàn bộ giá trị bản cũ. */
export const adjustRevenueSchema = createRevenueSchema;
export type AdjustRevenueRequest = z.infer<typeof adjustRevenueSchema>;

/** "Xoá" sổ cái append-only: bản ghi void + lý do (audit). */
export const voidFinanceRecordSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type VoidFinanceRecordRequest = z.infer<typeof voidFinanceRecordSchema>;

/**
 * Pagination chung cho list sổ cái finance: limit [1..100] default 50 · offset ≥0 default 0.
 * MIRROR attendance paginationSchema (G11 F6) — Zod REJECT out-of-range (KHÔNG silent-clamp) → 400.
 * Chống BẤT BIẾN unbounded-query: list LUÔN có LIMIT.
 */
const financePaginationFields = {
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

export const listRevenueQuerySchema = z.object({
  platformId: idSchema.optional(),
  channelId: idSchema.optional(),
  projectId: idSchema.optional(),
  contentItemId: idSchema.optional(),
  source: revenueSourceEnum.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  /** true = trả cả bản ghi đã thay thế/void (xem lịch sử chain). Mặc định chỉ bản hiệu lực. */
  includeSuperseded: z.coerce.boolean().optional(),
  ...financePaginationFields,
});
export type ListRevenueQuery = z.infer<typeof listRevenueQuerySchema>;

// ─── Cost (G13-2) ────────────────────────────────────────────────────────────

export const costRecordSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  costType: costTypeEnum,
  /** null = mask. */
  amount: z.number().nullable(),
  currency: z.string(),
  costDate: z.string().date(),
  orgUnitId: idSchema.nullable().optional(),
  teamId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  projectName: z.string().nullable().optional(),
  channelId: idSchema.nullable().optional(),
  channelName: z.string().nullable().optional(),
  contentItemId: idSchema.nullable().optional(),
  contentTitle: z.string().nullable().optional(),
  userId: idSchema.nullable().optional(),
  vendorName: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  attachmentUrl: z.string().nullable().optional(),
  enteredBy: idSchema,
  enteredByName: z.string().nullable().optional(),
  entryKind: financeEntryKindEnum,
  replacesRecordId: idSchema.nullable().optional(),
  expenseRequestId: idSchema.nullable().optional(),
  isEffective: z.boolean(),
  createdAt: z.string().datetime(),
});
export type CostRecordDto = z.infer<typeof costRecordSchema>;

const costFieldsSchema = z.object({
  costType: costTypeEnum,
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).default("VND"),
  costDate: z.string().date(),
  orgUnitId: idSchema.optional(),
  teamId: idSchema.optional(),
  projectId: idSchema.optional(),
  channelId: idSchema.optional(),
  contentItemId: idSchema.optional(),
  userId: idSchema.optional(),
  vendorName: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
  attachmentUrl: z.string().url().max(1000).optional(),
});

export const createCostSchema = costFieldsSchema;
export type CreateCostRequest = z.infer<typeof createCostSchema>;
export const adjustCostSchema = costFieldsSchema;
export type AdjustCostRequest = z.infer<typeof adjustCostSchema>;

export const listCostQuerySchema = z.object({
  costType: costTypeEnum.optional(),
  channelId: idSchema.optional(),
  projectId: idSchema.optional(),
  contentItemId: idSchema.optional(),
  orgUnitId: idSchema.optional(),
  teamId: idSchema.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  includeSuperseded: z.coerce.boolean().optional(),
  ...financePaginationFields,
});
export type ListCostQuery = z.infer<typeof listCostQuerySchema>;

// ─── Cost Allocation (G13-2 · FIN-003) ───────────────────────────────────────

export const costAllocationSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  costRecordId: idSchema,
  allocationRunId: idSchema,
  allocationTargetType: allocationTargetTypeEnum,
  allocationTargetId: idSchema,
  targetName: z.string().nullable().optional(),
  allocationMethod: allocationMethodEnum,
  /** null = mask. */
  allocatedAmount: z.number().nullable(),
  allocationPercent: z.number().nullable(),
  calculatedAt: z.string().datetime(),
});
export type CostAllocationDto = z.infer<typeof costAllocationSchema>;

export const allocationTargetInputSchema = z.object({
  targetType: allocationTargetTypeEnum,
  targetId: idSchema,
  /** Bắt buộc với manual_percent (tổng = 100). */
  percent: z.number().positive().max(100).optional(),
  /** Bắt buộc với by_work_hours (G11 chưa có attendance — nhập tay). */
  hours: z.number().positive().optional(),
});
export type AllocationTargetInput = z.infer<typeof allocationTargetInputSchema>;

export const allocateCostSchema = z
  .object({
    method: allocationMethodEnum,
    targets: z.array(allocationTargetInputSchema).min(1).max(200),
    /** Lọc dữ liệu trọng số (video/task/revenue) theo kỳ — tùy chọn. */
    periodStart: z.string().date().optional(),
    periodEnd: z.string().date().optional(),
  })
  .refine((d) => d.method !== "manual_percent" || d.targets.every((t) => t.percent != null), {
    message: "manual_percent: mỗi target phải có percent",
    path: ["targets"],
  })
  .refine(
    (d) =>
      d.method !== "manual_percent" ||
      Math.abs(d.targets.reduce((s, t) => s + (t.percent ?? 0), 0) - 100) < 0.0001,
    { message: "manual_percent: tổng percent phải bằng 100", path: ["targets"] },
  )
  .refine((d) => d.method !== "by_work_hours" || d.targets.every((t) => t.hours != null), {
    message: "by_work_hours: mỗi target phải có hours",
    path: ["targets"],
  })
  .refine(
    (d) => new Set(d.targets.map((t) => `${t.targetType}:${t.targetId}`)).size === d.targets.length,
    { message: "targets trùng nhau", path: ["targets"] },
  );
export type AllocateCostRequest = z.infer<typeof allocateCostSchema>;

export const allocationResultSchema = z.object({
  allocationRunId: idSchema,
  allocations: z.array(costAllocationSchema),
  /** Vd: cảnh báo phân bổ cost đã có direct target (nguy cơ đếm đôi profit). */
  warnings: z.array(z.string()),
});
export type AllocationResultDto = z.infer<typeof allocationResultSchema>;

/** List allocation hiệu lực của 1 cost (hoặc theo target). Pagination như revenue/cost. */
export const listCostAllocationQuerySchema = z.object({
  costRecordId: idSchema.optional(),
  allocationTargetType: allocationTargetTypeEnum.optional(),
  allocationTargetId: idSchema.optional(),
  ...financePaginationFields,
});
export type ListCostAllocationQuery = z.infer<typeof listCostAllocationQuerySchema>;

// ─── Profit snapshot (G13-3) ─────────────────────────────────────────────────

export const profitSnapshotSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  targetType: profitTargetTypeEnum,
  targetId: idSchema.nullable(),
  targetName: z.string().nullable().optional(),
  periodStart: z.string().date(),
  periodEnd: z.string().date(),
  /** null = mask. */
  totalRevenue: z.number().nullable(),
  totalDirectCost: z.number().nullable(),
  totalAllocatedCost: z.number().nullable(),
  totalCost: z.number().nullable(),
  profit: z.number().nullable(),
  /** profit / totalRevenue; null khi revenue = 0 hoặc bị mask. */
  profitMargin: z.number().nullable(),
  calculatedAt: z.string().datetime(),
  createdBy: idSchema.nullable().optional(),
});
export type ProfitSnapshotDto = z.infer<typeof profitSnapshotSchema>;

/** MVP compute 4 scope: company/channel/project/content_item (ERD đủ 7 — phần còn lại chờ module liên quan). */
export const createProfitSnapshotSchema = z
  .object({
    targetType: z.enum(["company", "channel", "project", "content_item"]),
    targetId: idSchema.optional(),
    periodStart: z.string().date(),
    periodEnd: z.string().date(),
  })
  .refine((d) => d.targetType === "company" || d.targetId != null, {
    message: "targetId bắt buộc khi targetType khác company",
    path: ["targetId"],
  })
  .refine((d) => d.periodEnd >= d.periodStart, {
    message: "periodEnd phải >= periodStart",
    path: ["periodEnd"],
  });
export type CreateProfitSnapshotRequest = z.infer<typeof createProfitSnapshotSchema>;

export const listProfitQuerySchema = z.object({
  targetType: profitTargetTypeEnum.optional(),
  targetId: idSchema.optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});
export type ListProfitQuery = z.infer<typeof listProfitQuerySchema>;

// ─── Expense Request (G13-4 — duyệt qua Task Hub, bất biến #4) ───────────────

export const expenseApprovalSchema = z.object({
  id: idSchema,
  expenseRequestId: idSchema,
  approvalLevel: z.number().int().positive(),
  approverUserId: idSchema,
  approverName: z.string().nullable().optional(),
  decision: expenseDecisionEnum,
  comment: z.string().nullable().optional(),
  decidedAt: z.string().datetime(),
});
export type ExpenseApprovalDto = z.infer<typeof expenseApprovalSchema>;

export const expenseRequestSchema = z.object({
  id: idSchema,
  companyId: idSchema,
  requestedBy: idSchema,
  requestedByName: z.string().nullable().optional(),
  orgUnitId: idSchema.nullable().optional(),
  projectId: idSchema.nullable().optional(),
  channelId: idSchema.nullable().optional(),
  title: z.string(),
  description: z.string().nullable().optional(),
  /** KHÔNG mask: requester/approver phải thấy số mình đề xuất/duyệt (khác sổ cái). */
  amount: z.number(),
  currency: z.string(),
  expenseType: costTypeEnum,
  neededAt: z.string().date().nullable().optional(),
  status: expenseStatusEnum,
  currentApprovalLevel: z.number().int(),
  attachmentUrl: z.string().nullable().optional(),
  /** Task duyệt trong Task Hub (task_type='finance') — tạo cùng tx với request. */
  taskId: idSchema.nullable().optional(),
  /** Cost record sinh ra sau duyệt (lineage). */
  costRecordId: idSchema.nullable().optional(),
  approvals: z.array(expenseApprovalSchema).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ExpenseRequestDto = z.infer<typeof expenseRequestSchema>;

export const createExpenseRequestSchema = z.object({
  title: z.string().min(3).max(300),
  description: z.string().max(2000).optional(),
  amount: z.number().positive(),
  currency: z.string().min(3).max(3).default("VND"),
  expenseType: costTypeEnum,
  neededAt: z.string().date().optional(),
  orgUnitId: idSchema.optional(),
  projectId: idSchema.optional(),
  channelId: idSchema.optional(),
  attachmentUrl: z.string().url().max(1000).optional(),
  /** Người duyệt — nhận task `finance` trong Task Hub. */
  approverUserId: idSchema,
});
export type CreateExpenseRequestRequest = z.infer<typeof createExpenseRequestSchema>;

export const decideExpenseSchema = z
  .object({
    decision: expenseDecisionEnum,
    comment: z.string().max(1000).optional(),
  })
  .refine((d) => d.decision !== "rejected" || (d.comment ?? "").trim().length > 0, {
    message: "Từ chối phải có lý do (comment)",
    path: ["comment"],
  });
export type DecideExpenseRequest = z.infer<typeof decideExpenseSchema>;

export const listExpenseQuerySchema = z.object({
  status: expenseStatusEnum.optional(),
  /** true = chỉ request mình tạo (mặc định server tự áp khi thiếu read:finance). */
  mine: z.coerce.boolean().optional(),
});
export type ListExpenseQuery = z.infer<typeof listExpenseQuerySchema>;
