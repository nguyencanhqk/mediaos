import { Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { DatabaseService } from "../../db/db.service";
import { seedBatches, seedItems } from "../../db/schema/seed-tracking";
import { computeChecksum } from "./seed-checksum.util";
import type {
  FinishBatchResult,
  MarkItemFailedInput,
  MarkItemInput,
  MarkItemResult,
  MarkItemSkippedInput,
  SeedBatchHandle,
  SeedBatchStatus,
  SeedItemOperation,
  SeedItemStatus,
  StartBatchInput,
} from "./seed-tracking.types";

/**
 * FOUNDATION-BE-8 — SeedTrackingService (DB-08 §8.12/8.13).
 *
 * Idempotent seed tracking: startBatch là idempotent theo (companyId, seedKey, seedVersion) — ON
 * CONFLICT DO NOTHING + SELECT-back. markItem idempotent theo (batchId, targetTable, targetKey) —
 * Skip nếu checksum không đổi; Update nếu đổi. finishBatch tổng hợp status từ items.
 *
 * BẤT BIẾN:
 *  #1 — mọi write đi qua withTenant(companyId).
 *  #2 — KHÔNG DELETE seed_batches / seed_items (giữ lịch sử seed, §8.12).
 *  #3 — payload seed KHÔNG chứa secret (computeChecksum throw nếu vi phạm).
 */
@Injectable()
export class SeedTrackingService {
  private readonly logger = new Logger(SeedTrackingService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Khởi tạo batch hoặc lấy lại batch đã tồn tại (idempotent).
   * Dùng ON CONFLICT DO NOTHING: nếu returning() rỗng ⇒ batch đã tồn tại ⇒ SELECT-back + reused=true.
   */
  async startBatch(input: StartBatchInput): Promise<SeedBatchHandle> {
    const { companyId, seedKey, seedVersion, environment, description, executedBy, metadata } =
      input;

    return this.db.withTenant(companyId, async (tx) => {
      const inserted = await (tx as typeof tx & { insert: Function })
        .insert(seedBatches)
        .values({
          companyId,
          seedKey,
          seedVersion,
          environment: environment ?? null,
          description: description ?? null,
          executedBy: executedBy ?? null,
          metadata: metadata ?? null,
          status: "Running" as SeedBatchStatus,
          startedAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();

      if (inserted.length > 0) {
        const row = inserted[0] as { id: string; companyId: string | null; seedKey: string; seedVersion: string; status: string };
        this.logger.log(`startBatch: new batch id=${row.id} seedKey=${seedKey}`);
        return {
          id: row.id,
          companyId: row.companyId,
          seedKey: row.seedKey,
          seedVersion: row.seedVersion,
          status: row.status as SeedBatchStatus,
          reused: false,
        };
      }

      // ON CONFLICT DO NOTHING → returning() rỗng → batch đã tồn tại → SELECT-back.
      const existing = await (tx as typeof tx & { select: Function })
        .select()
        .from(seedBatches)
        .where(
          and(
            eq(seedBatches.companyId, companyId),
            eq(seedBatches.seedKey, seedKey),
            eq(seedBatches.seedVersion, seedVersion),
          ),
        )
        .limit(1);

      const row = existing[0] as { id: string; companyId: string | null; seedKey: string; seedVersion: string; status: string };
      this.logger.log(`startBatch: reused batch id=${row.id} seedKey=${seedKey}`);
      return {
        id: row.id,
        companyId: row.companyId,
        seedKey: row.seedKey,
        seedVersion: row.seedVersion,
        status: row.status as SeedBatchStatus,
        reused: true,
      };
    });
  }

  /**
   * Ghi 1 item seed. Idempotent theo (batchId, targetTable, targetKey):
   *  - item chưa có ⇒ Insert/Upsert với payload+checksum, status=Success.
   *  - item đã có + checksum KHÔNG đổi ⇒ Skipped/Skip (KHÔNG UPDATE payload — idempotent §8.13).
   *  - item đã có + checksum ĐỔI ⇒ Update payload+checksum.
   *
   * @throws SeedChecksumSecretError nếu payload chứa field nhạy cảm (BẤT BIẾN #3).
   */
  async markItem(input: MarkItemInput): Promise<MarkItemResult> {
    const {
      companyId,
      batchId,
      targetTable,
      targetKey,
      operation = "Upsert",
      payload,
      targetId,
    } = input;

    // Tính checksum TRƯỚC khi mở transaction — throw SeedChecksumSecretError nếu chứa secret (fail-closed).
    const checksum = computeChecksum(payload);

    return this.db.withTenant(companyId, async (tx) => {
      // Check existing item.
      const existing = await (tx as typeof tx & { select: Function })
        .select()
        .from(seedItems)
        .where(
          and(
            eq(seedItems.seedBatchId, batchId),
            eq(seedItems.targetTable, targetTable),
            eq(seedItems.targetKey, targetKey),
          ),
        )
        .limit(1);

      if (existing.length === 0) {
        // Item chưa có → INSERT.
        const inserted = await (tx as typeof tx & { insert: Function })
          .insert(seedItems)
          .values({
            seedBatchId: batchId,
            companyId,
            targetTable,
            targetKey,
            operation,
            payload: payload ?? null,
            checksum,
            status: "Success" as SeedItemStatus,
            targetId: targetId ?? null,
          })
          .returning();

        const row = inserted[0] as { id: string };
        return {
          itemId: row.id,
          status: "Success" as SeedItemStatus,
          operation: operation as SeedItemOperation,
        };
      }

      const existingRow = existing[0] as { id: string; checksum: string | null; operation: string };

      // Checksum không đổi → Skip (idempotent, KHÔNG update payload).
      if (existingRow.checksum === checksum) {
        return {
          itemId: existingRow.id,
          status: "Skipped" as SeedItemStatus,
          operation: "Skip" as SeedItemOperation,
        };
      }

      // Checksum đổi → Update.
      const updated = await (tx as typeof tx & { update: Function })
        .update(seedItems)
        .set({
          operation: "Update" as SeedItemOperation,
          payload: payload ?? null,
          checksum,
          status: "Success" as SeedItemStatus,
          targetId: targetId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(seedItems.id, existingRow.id))
        .returning();

      const updatedRow = updated[0] as { id: string };
      return {
        itemId: updatedRow.id,
        status: "Success" as SeedItemStatus,
        operation: "Update" as SeedItemOperation,
      };
    });
  }

  /** Ghi item bỏ qua (skip tường minh — đã tồn tại / không cần seed). */
  async markItemSkipped(input: MarkItemSkippedInput): Promise<MarkItemResult> {
    const { companyId, batchId, targetTable, targetKey, reason, targetId } = input;

    return this.db.withTenant(companyId, async (tx) => {
      const inserted = await (tx as typeof tx & { insert: Function })
        .insert(seedItems)
        .values({
          seedBatchId: batchId,
          companyId,
          targetTable,
          targetKey,
          operation: "Skip" as SeedItemOperation,
          status: "Skipped" as SeedItemStatus,
          errorMessage: reason ?? null,
          targetId: targetId ?? null,
        })
        .onConflictDoNothing()
        .returning();

      const id =
        inserted.length > 0
          ? (inserted[0] as { id: string }).id
          : await this._getItemId(tx, batchId, targetTable, targetKey);

      return { itemId: id, status: "Skipped", operation: "Skip" };
    });
  }

  /** Ghi item thất bại kèm thông điệp lỗi (KHÔNG chứa secret). */
  async markItemFailed(input: MarkItemFailedInput): Promise<MarkItemResult> {
    const { companyId, batchId, targetTable, targetKey, errorMessage, operation = "Upsert" } =
      input;

    return this.db.withTenant(companyId, async (tx) => {
      const inserted = await (tx as typeof tx & { insert: Function })
        .insert(seedItems)
        .values({
          seedBatchId: batchId,
          companyId,
          targetTable,
          targetKey,
          operation,
          status: "Failed" as SeedItemStatus,
          errorMessage,
        })
        .onConflictDoNothing()
        .returning();

      const id =
        inserted.length > 0
          ? (inserted[0] as { id: string }).id
          : await this._getItemId(tx, batchId, targetTable, targetKey);

      return { itemId: id, status: "Failed", operation: operation as SeedItemOperation };
    });
  }

  /**
   * Hoàn tất batch: đọc các item, suy status (Failed nếu có >=1 item Failed, else Success),
   * cập nhật seed_batches.status + finishedAt.
   */
  async finishBatch(companyId: string, batchId: string): Promise<FinishBatchResult> {
    return this.db.withTenant(companyId, async (tx) => {
      const items = await (tx as typeof tx & { select: Function })
        .select()
        .from(seedItems)
        .where(eq(seedItems.seedBatchId, batchId))
        .limit(10_000);

      const hasFailed = (items as { status: string }[]).some((i) => i.status === "Failed");
      const batchStatus: SeedBatchStatus = hasFailed ? "Failed" : "Success";
      const finishedAt = new Date();

      await (tx as typeof tx & { update: Function })
        .update(seedBatches)
        .set({ status: batchStatus, finishedAt, updatedAt: finishedAt })
        .where(eq(seedBatches.id, batchId))
        .returning();

      this.logger.log(`finishBatch: batch id=${batchId} status=${batchStatus}`);
      return { batchId, status: batchStatus, finishedAt };
    });
  }

  private async _getItemId(
    tx: unknown,
    batchId: string,
    targetTable: string,
    targetKey: string,
  ): Promise<string> {
    const rows = await (tx as typeof tx & { select: Function })
      .select()
      .from(seedItems)
      .where(
        and(
          eq(seedItems.seedBatchId, batchId),
          eq(seedItems.targetTable, targetTable),
          eq(seedItems.targetKey, targetKey),
        ),
      )
      .limit(1);
    return (rows[0] as { id: string }).id;
  }
}
