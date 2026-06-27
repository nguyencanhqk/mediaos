/**
 * FOUNDATION-BE-8 — RetentionService contract (BACKEND-11 §17.3/§17.4).
 *
 * CRUD chính sách lưu trữ + simulate (đếm eligible, KHÔNG mutate) + runCleanup (dry-run mặc định; chỉ
 * xóa khi policy is_enabled && !dryRun — §17.4.1 "không xóa khi policy chưa active").
 *
 * cleanup_action khớp CHECK migration 0435: None/Archive/Delete/Anonymize.
 *
 * BẤT BIẾN: CRUD policy qua DatabaseService.withTenant(companyId) (RLS+FORCE). KHÔNG ghi global
 * (company_id NULL). KHÔNG hard-delete policy (soft-delete deleted_at — mig 0435 GRANT không cấp DELETE).
 * Cleanup TUYỆT ĐỐI KHÔNG xóa khi policy chưa is_enabled (§17.4.1).
 */

export const CLEANUP_ACTIONS = ["None", "Archive", "Delete", "Anonymize"] as const;
export type CleanupAction = (typeof CLEANUP_ACTIONS)[number];

/** Tạo chính sách lưu trữ cho tenant (company_id = companyId, KHÔNG global). */
export interface CreatePolicyInput {
  companyId: string;
  moduleCode: string;
  entityType: string;
  retentionDays: number;
  cleanupAction?: CleanupAction;
  archiveAfterDays?: number | null;
  deleteAfterDays?: number | null;
  isLegalHoldSupported?: boolean;
  isEnabled?: boolean;
  description?: string | null;
  createdBy?: string | null;
}

/** Patch chính sách (chỉ các trường mutable). */
export interface UpdatePolicyInput {
  retentionDays?: number;
  cleanupAction?: CleanupAction;
  archiveAfterDays?: number | null;
  deleteAfterDays?: number | null;
  isLegalHoldSupported?: boolean;
  isEnabled?: boolean;
  description?: string | null;
  updatedBy?: string | null;
}

/** Hàng policy ở tầng service. */
export interface RetentionPolicyRow {
  id: string;
  companyId: string | null;
  moduleCode: string;
  entityType: string;
  retentionDays: number;
  cleanupAction: CleanupAction;
  archiveAfterDays: number | null;
  deleteAfterDays: number | null;
  isLegalHoldSupported: boolean;
  isEnabled: boolean;
  description: string | null;
  deletedAt: Date | null;
}

/** Kết quả simulate (§17.3) — đếm eligible, KHÔNG mutate. */
export interface SimulateResult {
  policyId: string;
  moduleCode: string;
  entityType: string;
  eligibleRecords: number;
  action: CleanupAction;
  cutoffTime: Date;
  /** true nếu policy chưa active (is_enabled=false) — runCleanup sẽ KHÔNG xóa (§17.4.1). */
  isEnabled: boolean;
}

/** Kết quả runCleanup — phản ánh chế độ (dryRun/disabled) + số đã xử lý. */
export interface CleanupResult {
  policyId: string;
  eligibleRecords: number;
  deletedRecords: number;
  cutoffTime: Date;
  dryRun: boolean;
  skippedDisabled: boolean;
}

export interface RunCleanupOptions {
  /** Mặc định true — KHÔNG xóa, chỉ đếm (§17.4 safety). */
  dryRun?: boolean;
  /** Giới hạn số record xóa mỗi lượt (§17.4.5) — chống xóa không kiểm soát. */
  batchSize?: number;
}

/** Trần batch mặc định cho 1 lượt cleanup (§17.4.5). */
export const DEFAULT_CLEANUP_BATCH_SIZE = 1000;
