import { Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { dbExportJobs } from "../db/schema";

export type DbExportJobRow = typeof dbExportJobs.$inferSelect;

/** Lý do fail tối đa lưu (truncate — chống bloat; error là infra message, KHÔNG row data). */
const MAX_ERROR_LEN = 500;

export interface InsertExportJobData {
  requesterUserId: string;
  targetTenantId: string;
  tableName: string;
  filter: unknown;
}

/**
 * DbExportJobRepository — data-access cho db_export_jobs (GLOBAL no-RLS operator-scoped). Worker materialize
 * file DEFER (như AC-6 delivery worker) — repo chỉ enqueue + list + read 1 job.
 */
@Injectable()
export class DbExportJobRepository {
  async insertJobTx(tx: TenantTx, data: InsertExportJobData): Promise<DbExportJobRow> {
    const [row] = await tx
      .insert(dbExportJobs)
      .values({
        requesterUserId: data.requesterUserId,
        targetTenantId: data.targetTenantId,
        tableName: data.tableName,
        filter: data.filter ?? null,
      })
      .returning();
    return row;
  }

  async listJobsForRequesterTx(tx: TenantTx, requesterUserId: string): Promise<DbExportJobRow[]> {
    return tx
      .select()
      .from(dbExportJobs)
      .where(eq(dbExportJobs.requesterUserId, requesterUserId))
      .orderBy(desc(dbExportJobs.createdAt));
  }

  async findJobByIdTx(tx: TenantTx, jobId: string): Promise<DbExportJobRow | null> {
    const [row] = await tx.select().from(dbExportJobs).where(eq(dbExportJobs.id, jobId)).limit(1);
    return row ?? null;
  }

  /**
   * WAVE 3 C2 worker — claim atomically (CTE FOR UPDATE SKIP LOCKED): chọn 'queued', khoá, set 'running'.
   * Inner SELECT...FOR UPDATE SKIP LOCKED + UPDATE chung 1 snapshot ⇒ KHÔNG double-claim dưới đồng thời
   * (mirror OutboxWorker.claim). Trả các job đã claim (giờ 'running') để worker materialize NGOÀI tx này.
   */
  async claimQueuedJobsTx(tx: TenantTx, batchSize: number): Promise<DbExportJobRow[]> {
    const res = await tx.execute(sql`
      WITH claimed AS (
        SELECT id FROM db_export_jobs
        WHERE status = 'queued'
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE db_export_jobs SET status = 'running'
      WHERE id IN (SELECT id FROM claimed)
      RETURNING id, requester_user_id, target_tenant_id, table_name, filter, status, row_count,
                object_key, error, created_at, completed_at
    `);
    return res.rows.map((r) => mapRawRow(r as Record<string, unknown>));
  }

  /** Finalize 'done': object_key + row_count + completed_at. Guard status='running' ⇒ idempotent dưới đua. */
  async markDoneTx(
    tx: TenantTx,
    jobId: string,
    objectKey: string,
    rowCount: number,
  ): Promise<number> {
    const res = await tx
      .update(dbExportJobs)
      .set({ status: "done", objectKey, rowCount, completedAt: new Date() })
      .where(and(eq(dbExportJobs.id, jobId), eq(dbExportJobs.status, "running")));
    return res.rowCount ?? 0;
  }

  /** Finalize 'failed': error (truncate, non-sensitive) + completed_at. Guard status='running'. */
  async markFailedTx(tx: TenantTx, jobId: string, error: string): Promise<number> {
    const res = await tx
      .update(dbExportJobs)
      .set({ status: "failed", error: error.slice(0, MAX_ERROR_LEN), completedAt: new Date() })
      .where(and(eq(dbExportJobs.id, jobId), eq(dbExportJobs.status, "running")));
    return res.rowCount ?? 0;
  }
}

/** Map raw execute() row (snake_case) → DbExportJobRow (camelCase) cho claim CTE. */
function mapRawRow(r: Record<string, unknown>): DbExportJobRow {
  return {
    id: r.id as string,
    requesterUserId: r.requester_user_id as string,
    targetTenantId: r.target_tenant_id as string,
    tableName: r.table_name as string,
    filter: (r.filter ?? null) as DbExportJobRow["filter"],
    status: r.status as string,
    rowCount: (r.row_count ?? null) as number | null,
    objectKey: (r.object_key ?? null) as string | null,
    error: (r.error ?? null) as string | null,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at as string),
    completedAt:
      r.completed_at == null
        ? null
        : r.completed_at instanceof Date
          ? r.completed_at
          : new Date(r.completed_at as string),
  };
}
