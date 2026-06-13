import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import type {
  AllocateCostRequest,
  AllocationMethod,
  AllocationTargetInput,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { costRecords } from "../db/schema";
import { AuditService } from "../events/audit.service";
import { OutboxService } from "../events/outbox.service";
import { PermissionService } from "../permission/permission.service";
import { CostAllocationRepository } from "./cost-allocation.repository";
import { computeAllocationLines, staticWeight, type AllocationTargetWeight } from "./allocation";
import { centsToDbString, decimalStringToCents, MoneyError } from "./money";

/**
 * G13-2 (FIN-003) — CostAllocationService: phân bổ chi phí 5+1 kiểu chia. cost_allocations mutable CÓ
 * KIỂM SOÁT (soft-delete khi re-allocate, KHÔNG DELETE). Tài chính nhạy cảm — gate create:finance.
 *
 * BẤT BIẾN:
 *  - permission fail-closed: assertCanWrite NGOÀI tx → deny ⇒ 0 side-effect.
 *  - withTenant cho mọi đọc/ghi (RLS); cross-tenant target guard (polymorphic, không FK).
 *  - cents-exact: SUM(allocatedAmount) === amount cost gốc tuyệt đối (money.ts dồn dư target cuối).
 *  - audit-in-tx: CostAllocated (lần đầu) / CostReallocated (re-run) object_type='cost_allocation'.
 *  - re-allocate = soft-delete set cũ + insert set mới CÙNG 1 tx.
 */

const RESOURCE_TYPE = "finance";
const ACTION_WRITE = "create";

/** 3 method weight resolve từ DB (COUNT/SUM theo target trong kỳ) — KHÔNG dùng staticWeight. */
export const DB_RESOLVED_METHODS = [
  "by_video_count",
  "by_task_count",
  "by_revenue_ratio",
] as const satisfies readonly AllocationMethod[];

export function isDbResolvedMethod(
  method: AllocationMethod,
): method is (typeof DB_RESOLVED_METHODS)[number] {
  return (DB_RESOLVED_METHODS as readonly string[]).includes(method);
}

/**
 * Resolve weight cho 3 method TĨNH (không DB): equal_split / manual_percent / by_work_hours.
 * Method DB-resolved → ném (caller phải resolve qua repository). THUẦN — test ở allocation-resolve.spec.ts.
 */
export function resolveStaticWeights(
  method: AllocationMethod,
  targets: readonly AllocationTargetInput[],
): number[] {
  if (isDbResolvedMethod(method)) {
    throw new Error(`resolveStaticWeights không áp dụng cho method DB-resolved '${method}'`);
  }
  return targets.map((t) => staticWeight(method, { percent: t.percent, hours: t.hours }));
}

@Injectable()
export class CostAllocationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CostAllocationRepository,
    private readonly permissions: PermissionService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Phân bổ amount của cost `costRecordId` cho các target theo `method`. Re-allocate = soft-delete set
   * active cũ + insert set mới CÙNG tx. Permission check NGOÀI tx (fail-closed). Cents-exact.
   */
  async allocate(
    companyId: string,
    userId: string,
    costRecordId: string,
    dto: AllocateCostRequest,
  ) {
    await this.assertCanWrite(companyId, userId);

    return this.db.withTenant(companyId, async (tx) => {
      // 1. Load cost gốc (guard tenant + hiệu lực). RLS đã lọc company_id.
      const [cost] = await tx
        .select()
        .from(costRecords)
        .where(and(eq(costRecords.companyId, companyId), eq(costRecords.id, costRecordId)))
        .limit(1);
      if (!cost) throw new NotFoundException(`Cost record not found: ${costRecordId}`);
      if (cost.entryKind === "void") {
        throw new BadRequestException("Không thể phân bổ cost đã void.");
      }
      // Bản đã bị thay thế (adjustment/void trỏ tới) → không phân bổ trên bản cũ.
      const superseded = await tx.execute(
        sql`SELECT 1 FROM cost_records WHERE replaces_record_id = ${costRecordId} LIMIT 1`,
      );
      if ((superseded.rows?.length ?? 0) > 0) {
        throw new BadRequestException("Cost đã bị thay thế (adjustment/void) — phân bổ trên bản hiệu lực.");
      }

      const totalCents = decimalStringToCents(cost.amount);

      // 2. Cross-tenant target guard (polymorphic) — mọi target phải tồn tại trong tenant.
      for (const t of dto.targets) {
        const exists = await this.repo.targetExistsTx(tx, t.targetType, t.targetId);
        if (!exists) {
          throw new BadRequestException(
            `Target không tồn tại trong công ty: ${t.targetType}:${t.targetId}`,
          );
        }
      }

      // 3. Resolve weights theo method.
      const weights = await this.resolveWeights(tx, dto);

      // 4. Chia tiền cents-exact (dồn dư target cuối). Tổng weight = 0 ⇒ MoneyError → 400.
      const targetWeights: AllocationTargetWeight[] = dto.targets.map((t, i) => ({
        targetType: t.targetType,
        targetId: t.targetId,
        weight: weights[i],
      }));
      let lines;
      try {
        lines = computeAllocationLines(totalCents, targetWeights);
      } catch (e) {
        if (e instanceof MoneyError) {
          throw new BadRequestException(`Không thể phân bổ: ${e.message}`);
        }
        throw e;
      }

      // 5. Re-allocate: soft-delete set active cũ TRƯỚC khi insert set mới (CÙNG tx).
      const softDeleted = await this.repo.softDeleteActiveTx(tx, companyId, costRecordId);
      const isReallocate = softDeleted > 0;

      // 6. Insert set mới (1 allocation_run_id chung).
      const runId = randomUUID();
      const allocations = [];
      for (const line of lines) {
        const row = await this.repo.insertTx(tx, {
          costRecordId,
          allocationRunId: runId,
          allocationTargetType: line.targetType,
          allocationTargetId: line.targetId,
          allocationMethod: dto.method,
          allocatedAmount: centsToDbString(line.allocatedCents),
          allocationPercent: line.percent != null ? line.percent.toFixed(4) : null,
        });
        allocations.push(row);
      }

      // 7. Audit-in-tx (CostAllocated lần đầu / CostReallocated re-run).
      const action = isReallocate ? "CostReallocated" : "CostAllocated";
      await this.audit.record(tx, {
        action,
        objectType: "cost_allocation",
        objectId: costRecordId,
        actorUserId: userId,
        after: {
          allocationRunId: runId,
          method: dto.method,
          targetCount: allocations.length,
          softDeleted,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: isReallocate ? "finance.cost.reallocated" : "finance.cost.allocated",
        payload: { costRecordId, allocationRunId: runId, actorUserId: userId },
      });

      // 8. Warnings: cost có direct target (channel/project/content) trùng target phân bổ → nguy cơ
      //    đếm-đôi khi tính profit. Cảnh báo, KHÔNG chặn.
      const warnings: string[] = [];
      const directKeys = new Set<string>();
      if (cost.channelId) directKeys.add(`channel:${cost.channelId}`);
      if (cost.projectId) directKeys.add(`project:${cost.projectId}`);
      if (cost.contentItemId) directKeys.add(`content_item:${cost.contentItemId}`);
      for (const t of dto.targets) {
        if (directKeys.has(`${t.targetType}:${t.targetId}`)) {
          warnings.push(
            `Cost đã gắn trực tiếp ${t.targetType} ${t.targetId} — phân bổ thêm có thể đếm đôi profit.`,
          );
        }
      }

      return { allocationRunId: runId, allocations, warnings };
    });
  }

  /**
   * Resolve weights cho mọi target theo method. TĨNH (equal/manual/hours) qua resolveStaticWeights;
   * DB-resolved (video/task/revenue) qua repository COUNT/SUM trong kỳ (CÙNG tx).
   */
  private async resolveWeights(
    tx: Parameters<Parameters<DatabaseService["withTenant"]>[1]>[0],
    dto: AllocateCostRequest,
  ): Promise<number[]> {
    if (!isDbResolvedMethod(dto.method)) {
      return resolveStaticWeights(dto.method, dto.targets);
    }
    const period = { from: dto.periodStart, to: dto.periodEnd };
    const weights: number[] = [];
    for (const t of dto.targets) {
      weights.push(
        await this.repo.resolveWeightTx(tx, dto.method, t.targetType, t.targetId, period),
      );
    }
    return weights;
  }

  private async assertCanWrite(companyId: string, userId: string): Promise<void> {
    const decision = await this.permissions.can({
      userId,
      companyId,
      action: ACTION_WRITE,
      resourceType: RESOURCE_TYPE,
    });
    if (!decision.allow) {
      throw new ForbiddenException(`Permission denied: ${decision.reason}`);
    }
  }
}
