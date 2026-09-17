import { z } from "zod";
import { periodMonthSchema } from "./attendance";
import { bonusKindEnum, bonusPenaltyStatusEnum, csvEnumList, payrollPageQuery } from "./payroll";

/**
 * MediaOS — PAYROLL thưởng/phạt/khấu trừ theo kỳ (`bonus_penalties`, PAYROLL-API-023..028 · SPEC-11 §15).
 * Tách nguyên văn khỏi `payroll.ts` (S15-PAYROLL-DEBT-1 — file đã vượt 800 dòng). Cùng luật tách file như
 * `./payroll-employees`: import NGƯỢC từ `./payroll`, KHÔNG re-export tên của nó.
 */

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 6. bonus_penalties — thưởng/phạt/khấu trừ theo kỳ
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** DTO thưởng/phạt. `amount` là tiền per-người ⇒ `.optional()` theo luật masking. */
export const bonusPenaltySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  userId: z.string().uuid(),
  kind: bonusKindEnum,
  amount: z.number().positive().optional(),
  periodMonth: periodMonthSchema,
  reason: z.string(),
  status: bonusPenaltyStatusEnum,
  decidedBy: z.string().uuid().nullable(),
  decidedAt: z.string().datetime().nullable(),
  decisionNote: z.string().nullable(),
  payrollPeriodId: z.string().uuid().nullable(),
  consumedAt: z.string().datetime().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type BonusPenaltyDto = z.infer<typeof bonusPenaltySchema>;

/**
 * Tạo thưởng/phạt. `amount > 0` mirror `bonus_penalties_amount_check`; `reason` **bắt buộc** mirror
 * `reason NOT NULL` (`.trim().min(1)` là lớp NỘI DUNG — DB chỉ chặn NULL, không chặn chuỗi khoảng trắng).
 */
export const createBonusPenaltySchema = z.object({
  userId: z.string().uuid(),
  kind: bonusKindEnum,
  amount: z.number().positive(),
  periodMonth: periodMonthSchema,
  reason: z.string().trim().min(1).max(500),
});
export type CreateBonusPenaltyRequest = z.infer<typeof createBonusPenaltySchema>;

/**
 * Sửa (PAYROLL-API-026) — CHỈ khi còn `Pending` và chưa consume; `delete: true` là đường **xoá mềm**.
 * Service tiền-kiểm dưới `FOR UPDATE` (⇒ 011 / 013); trigger `enforce_bonus_penalty_freeze` là chốt
 * cuối ở DB cho race. `.strict()`: khoá lạ ⇒ 400.
 */
export const updateBonusPenaltySchema = z
  .object({
    kind: bonusKindEnum.optional(),
    amount: z.number().positive().optional(),
    periodMonth: periodMonthSchema.optional(),
    reason: z.string().trim().min(1).max(500).optional(),
    delete: z.literal(true).optional(),
  })
  .strict();
export type UpdateBonusPenaltyRequest = z.infer<typeof updateBonusPenaltySchema>;

/** Duyệt — `decisionNote` tuỳ chọn (mirror: CHECK chỉ bắt buộc note khi `Rejected`). */
export const approveBonusPenaltySchema = z.object({
  decisionNote: z.string().trim().min(1).max(500).optional(),
});
export type ApproveBonusPenaltyRequest = z.infer<typeof approveBonusPenaltySchema>;

/**
 * Từ chối — `decisionNote` **BẮT BUỘC**, mirror ĐÚNG BẰNG CHECK `bonus_penalties_reject_note_check`
 * (`status <> 'Rejected' OR decision_note IS NOT NULL`). Để optional ⇒ 23514 = 500 ở vùng đỏ.
 */
export const rejectBonusPenaltySchema = z.object({
  decisionNote: z.string().trim().min(1).max(500),
});
export type RejectBonusPenaltyRequest = z.infer<typeof rejectBonusPenaltySchema>;

/** PAYROLL-API-023 — filter `periodMonth` · `status[]` · `kind` · `userId` (SPEC-11 §15) + pagination. */
export const bonusPenaltyListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  status: csvEnumList(bonusPenaltyStatusEnum),
  periodMonth: periodMonthSchema.optional(),
  kind: bonusKindEnum.optional(),
  ...payrollPageQuery,
});
export type BonusPenaltyListQuery = z.infer<typeof bonusPenaltyListQuerySchema>;
