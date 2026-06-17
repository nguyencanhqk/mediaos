import { Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { dbExportJobs } from "../db/schema";

export type DbExportJobRow = typeof dbExportJobs.$inferSelect;

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
}
