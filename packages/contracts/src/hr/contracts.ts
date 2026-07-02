import { z } from "zod";

/**
 * S2-HR-BE-6 — Employee contracts (hợp đồng lao động) DTOs. Source of truth: DB-03 §7.7 / SPEC-03 / API-03.
 * Permission pair (CHỐT 2026-07-02): ('view','contract') VIEW · ('manage','contract') create/update/delete.
 *
 * DTO list/detail KHÔNG lộ trường nhạy cảm ngoài allowlist. note/title/metadata KHÔNG chứa lương/PII chưa
 * mask (validate ở service — masker che nếu lọt vào audit). employee_id/contract_type_id/file_id là id-only.
 */

export const contractStatusEnum = z.enum(["Draft", "Active", "Expired", "Terminated", "Cancelled"]);
export type ContractStatus = z.infer<typeof contractStatusEnum>;

/** ISO date string (YYYY-MM-DD). date-only cột (start_date/end_date/signed_date). */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date phải là YYYY-MM-DD");

// ── Response DTO ───────────────────────────────────────────────────────────────

export const employeeContractSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  employeeId: z.string().uuid(),
  contractTypeId: z.string().uuid(),
  contractCode: z.string().nullable(),
  title: z.string().nullable(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  signedDate: z.string().nullable(),
  status: contractStatusEnum,
  isPrimary: z.boolean(),
  fileId: z.string().uuid().nullable(),
  note: z.string().nullable(),
  /** true khi hợp đồng active có end_date trong ngưỡng cảnh báo (mặc định 30 ngày). */
  expiringSoon: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type EmployeeContractDto = z.infer<typeof employeeContractSchema>;

// ── List query ─────────────────────────────────────────────────────────────────

export const listContractsQuerySchema = z.object({
  employeeId: z.string().uuid().optional(),
  status: contractStatusEnum.optional(),
  /** Chỉ trả HĐ sắp hết hạn (active, end_date trong ngưỡng expiringWithinDays). */
  expiringOnly: z.coerce.boolean().optional(),
  /** Ngưỡng cảnh báo hết hạn (ngày). Mặc định 30. */
  expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListContractsQuery = z.infer<typeof listContractsQuerySchema>;

// ── Create / Update ──────────────────────────────────────────────────────────────

export const createContractSchema = z.object({
  employeeId: z.string().uuid(),
  contractTypeId: z.string().uuid(),
  contractCode: z.string().min(1).max(100).optional(),
  title: z.string().min(1).max(255).optional(),
  startDate: isoDate,
  endDate: isoDate.optional(),
  signedDate: isoDate.optional(),
  status: contractStatusEnum.optional(),
  isPrimary: z.boolean().optional(),
  fileId: z.string().uuid().optional(),
  note: z.string().max(2000).optional(),
});
export type CreateContractRequest = z.infer<typeof createContractSchema>;

export const updateContractSchema = z.object({
  contractTypeId: z.string().uuid().optional(),
  contractCode: z.string().min(1).max(100).nullable().optional(),
  title: z.string().min(1).max(255).nullable().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.nullable().optional(),
  signedDate: isoDate.nullable().optional(),
  status: contractStatusEnum.optional(),
  isPrimary: z.boolean().optional(),
  fileId: z.string().uuid().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});
export type UpdateContractRequest = z.infer<typeof updateContractSchema>;

// ── Link file to contract (FileService entity 'contract') ────────────────────────

export const linkContractFileSchema = z.object({
  fileId: z.string().uuid(),
});
export type LinkContractFileRequest = z.infer<typeof linkContractFileSchema>;
