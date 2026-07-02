/**
 * FOUNDATION-BE-8 — SeedTrackingService contract (BACKEND-04 §11.8 + DB-08 §8.12/8.13).
 *
 * Idempotent seed tracking: startBatch (1 batch / company_id+seed_key+seed_version), markItem* (1 item /
 * batch+target_table+target_key, Skip nếu checksum không đổi), finishBatch (tổng hợp status batch).
 *
 * Enum khớp CHECK constraint migration 0435 (KHÔNG được lệch — DB từ chối giá trị ngoài tập):
 *   seed_batches.status ∈ Pending/Running/Success/Failed/Skipped/RolledBack
 *   seed_items.status   ∈ Pending/Success/Failed/Skipped
 *   seed_items.operation ∈ Insert/Update/Upsert/Delete/Skip
 *
 * BẤT BIẾN: mọi data-access qua DatabaseService.withTenant(companyId) (RLS+FORCE ép ở DB). KHÔNG ghi
 * global (company_id NULL) ở WO này — WITH CHECK của mig 0435 chặn app role ghi NULL. KHÔNG DELETE
 * seed_batches/seed_items (giữ lịch sử seed — §8.12). Checksum KHÔNG chứa secret (BẤT BIẾN #3).
 */

export const SEED_BATCH_STATUSES = [
  "Pending",
  "Running",
  "Success",
  "Failed",
  "Skipped",
  "RolledBack",
] as const;
export type SeedBatchStatus = (typeof SEED_BATCH_STATUSES)[number];

export const SEED_ITEM_STATUSES = ["Pending", "Success", "Failed", "Skipped"] as const;
export type SeedItemStatus = (typeof SEED_ITEM_STATUSES)[number];

export const SEED_ITEM_OPERATIONS = ["Insert", "Update", "Upsert", "Delete", "Skip"] as const;
export type SeedItemOperation = (typeof SEED_ITEM_OPERATIONS)[number];

/** Khởi tạo / lấy lại batch idempotent theo (companyId, seedKey, seedVersion). */
export interface StartBatchInput {
  companyId: string;
  seedKey: string;
  seedVersion: string;
  environment?: string | null;
  description?: string | null;
  executedBy?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Batch trả về sau startBatch — `reused=true` nếu batch đã tồn tại (chạy lại). */
export interface SeedBatchHandle {
  id: string;
  companyId: string | null;
  seedKey: string;
  seedVersion: string;
  status: SeedBatchStatus;
  reused: boolean;
}

/** Ghi 1 item seed (Insert/Update/Upsert). checksum dùng để quyết Skip khi không đổi. */
export interface MarkItemInput {
  companyId: string;
  batchId: string;
  targetTable: string;
  targetKey: string;
  operation?: SeedItemOperation;
  /** Payload KHÔNG chứa secret/hash/PII nhạy cảm — chỉ master/config data (BẤT BIẾN #3). */
  payload?: Record<string, unknown> | null;
  /** id của row đích sau khi seed (nếu biết). */
  targetId?: string | null;
}

/** Ghi item Skipped (vd: đã tồn tại, không cần ghi). */
export interface MarkItemSkippedInput {
  companyId: string;
  batchId: string;
  targetTable: string;
  targetKey: string;
  reason?: string | null;
  targetId?: string | null;
}

/** Ghi item Failed kèm thông điệp lỗi (KHÔNG chứa secret). */
export interface MarkItemFailedInput {
  companyId: string;
  batchId: string;
  targetTable: string;
  targetKey: string;
  errorMessage: string;
  operation?: SeedItemOperation;
}

/** Kết quả 1 lần markItem — phản ánh quyết định Skip vs Update theo checksum. */
export interface MarkItemResult {
  itemId: string;
  status: SeedItemStatus;
  operation: SeedItemOperation;
}

/** Kết quả finishBatch — status suy ra từ tập item (Failed nếu có >=1 Failed). */
export interface FinishBatchResult {
  batchId: string;
  status: SeedBatchStatus;
  finishedAt: Date;
}

/**
 * S2-FND-BE-2 — view trạng thái RUN 1 batch seed (GET /foundation/seeds). WHITELIST vận hành — KHÔNG
 * secret/payload/metadata/executedBy/errorMessage (BẤT BIẾN #3). Mốc thời gian = ISO-8601 string trên
 * wire (khớp contract seedBatchStatusViewSchema). checksum = hash cấu hình seed (KHÔNG secret).
 */
export interface SeedBatchStatusView {
  id: string;
  seedKey: string;
  seedVersion: string;
  environment: string | null;
  status: SeedBatchStatus;
  checksum: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
