import { Injectable } from "@nestjs/common";
import { desc, sql } from "drizzle-orm";
import {
  DEFAULT_AUDIT_PAGE_LIMIT,
  MAX_AUDIT_PAGE_LIMIT,
  type DeadLetterRow,
  type QueueStatusResponse,
} from "@mediaos/contracts";
import { DatabaseService } from "../db/db.service";
import { deadLetterEvents, outboxEvents } from "../db/schema";
import { OperatorActionAuditService } from "../platform/operator-action-audit.service";
import type { OperatorUser } from "./audit-read.service";

type DeadLetterRowSelect = typeof deadLetterEvents.$inferSelect;

/**
 * AC-8 QueueMonitorService — đếm trạng thái event queue CHÉO tenant cho platform operator:
 *  - outbox_events: count theo status + tổng.
 *  - dead_letter_events: unresolved/total + 1 trang rows (row-capped §8.3).
 *
 * Chạy qua withPlatformReadContext (GUC HẸP app.platform_audit_read, SELECT-only). MỖI lần đọc GHI 1
 * operator-action audit row (action='operator.queue_read') trong tx withTenant(home) RIÊNG (forensic
 * gap=0 — silent-failure target: aggregate path dễ quên audit).
 *
 * KHÔNG payload thô vào DTO (chỉ metadata + error). limit kẹp [1..MAX].
 */
@Injectable()
export class QueueMonitorService {
  constructor(
    private readonly db: DatabaseService,
    private readonly operatorAudit: OperatorActionAuditService,
  ) {}

  private clampLimit(limit: number | undefined): number {
    if (limit == null || !Number.isFinite(limit)) return DEFAULT_AUDIT_PAGE_LIMIT;
    return Math.min(MAX_AUDIT_PAGE_LIMIT, Math.max(1, Math.trunc(limit)));
  }

  /** Aggregate queue status chéo tenant. `limit` áp cho trang dead-letter rows (row-cap). */
  async getQueueStatus(operator: OperatorUser, limit?: number): Promise<QueueStatusResponse> {
    const cap = this.clampLimit(limit);

    const result = await this.db.withPlatformReadContext(async (tx) => {
      const outboxCounts = await tx
        .select({
          status: outboxEvents.status,
          count: sql<number>`count(*)::int`,
        })
        .from(outboxEvents)
        .groupBy(outboxEvents.status);

      const [{ outboxTotal }] = await tx
        .select({ outboxTotal: sql<number>`count(*)::int` })
        .from(outboxEvents);

      const [{ dlTotal }] = await tx
        .select({ dlTotal: sql<number>`count(*)::int` })
        .from(deadLetterEvents);

      const [{ dlUnresolved }] = await tx
        .select({ dlUnresolved: sql<number>`count(*)::int` })
        .from(deadLetterEvents)
        .where(sql`${deadLetterEvents.resolvedAt} IS NULL`);

      const dlRows = await tx
        .select()
        .from(deadLetterEvents)
        .orderBy(desc(deadLetterEvents.createdAt), desc(deadLetterEvents.id))
        .limit(cap);

      return {
        outbox: {
          counts: outboxCounts.map((c) => ({ status: c.status, count: c.count })),
          total: outboxTotal,
        },
        deadLetter: {
          unresolved: dlUnresolved,
          total: dlTotal,
          rows: dlRows.map((r) => this.toDeadLetterDto(r)),
        },
      } satisfies QueueStatusResponse;
    });

    // Forensic: ghi 1 operator-action audit cho mỗi lần đọc queue (KHÔNG quên — silent-failure target).
    await this.db.withTenant(operator.companyId, async (tx) => {
      await this.operatorAudit.recordOperatorAction(tx, {
        operatorId: operator.id,
        targetTenantId: operator.companyId,
        action: "operator.queue_read",
        after: {
          outboxTotal: result.outbox.total,
          deadLetterUnresolved: result.deadLetter.unresolved,
        },
      });
    });

    return result;
  }

  /** DTO 1 dòng dead-letter — KHÔNG payload thô (chỉ metadata forensic + error). */
  private toDeadLetterDto(row: DeadLetterRowSelect): DeadLetterRow {
    return {
      id: row.id,
      companyId: row.companyId,
      eventId: row.eventId,
      consumerName: row.consumerName,
      eventType: row.eventType,
      error: row.error,
      createdAt: row.createdAt.toISOString(),
      resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    };
  }
}
