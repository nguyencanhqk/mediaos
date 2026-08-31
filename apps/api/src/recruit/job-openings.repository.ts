import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { ListJobOpeningsQuery } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { jobOpenings, type JobOpening, type JobOpeningStatus } from "../db/schema/recruit";
import { recruitOffset } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — data-access `job_openings`. CHỈ Company (§13.6) — không row-filter ngoài
 * `company_id` (BẤT BIẾN #1: bind tường minh dù RLS đã đỡ) + `deleted_at IS NULL`.
 */
@Injectable()
export class JobOpeningsRepository {
  private liveWhere(companyId: string, extra: SQL[] = []): SQL | undefined {
    return and(eq(jobOpenings.companyId, companyId), isNull(jobOpenings.deletedAt), ...extra);
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    q: ListJobOpeningsQuery,
  ): Promise<{ rows: JobOpening[]; total: number }> {
    const conds: SQL[] = [];
    if (q.status?.length) conds.push(inArray(jobOpenings.status, q.status as JobOpeningStatus[]));
    if (q.orgUnitId) conds.push(eq(jobOpenings.orgUnitId, q.orgUnitId));
    if (q.recruiterUserId) conds.push(eq(jobOpenings.recruiterUserId, q.recruiterUserId));
    if (q.q) conds.push(ilike(jobOpenings.title, `%${q.q}%`));
    const where = this.liveWhere(companyId, conds);
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(jobOpenings)
        .where(where)
        .orderBy(desc(jobOpenings.createdAt), desc(jobOpenings.id))
        .limit(q.per_page)
        .offset(recruitOffset(q.page, q.per_page)),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(jobOpenings)
        .where(where),
    ]);
    return { rows, total };
  }

  async findTx(tx: TenantTx, companyId: string, id: string): Promise<JobOpening | null> {
    const [row] = await tx
      .select()
      .from(jobOpenings)
      .where(this.liveWhere(companyId, [eq(jobOpenings.id, id)]))
      .limit(1);
    return row ?? null;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    data: {
      title: string;
      description: string | null;
      orgUnitId: string;
      positionId: string | null;
      headcount: number;
      recruiterUserId: string | null;
      createdBy: string;
    },
  ): Promise<JobOpening> {
    const [row] = await tx
      .insert(jobOpenings)
      .values({ companyId, ...data, updatedBy: data.createdBy })
      .returning();
    return row;
  }

  /**
   * PATCH — `updated_at = now()` TƯỜNG MINH (khoá dedupe NOTI-016 dựa RETURNING updated_at; không có
   * trigger tự cập nhật — plan §8). Trả hàng SAU update.
   */
  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: Partial<
      Pick<JobOpening, "title" | "description" | "positionId" | "headcount" | "recruiterUserId">
    >,
    actorUserId: string,
  ): Promise<JobOpening | null> {
    const [row] = await tx
      .update(jobOpenings)
      .set({ ...patch, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(this.liveWhere(companyId, [eq(jobOpenings.id, id)]))
      .returning();
    return row ?? null;
  }

  async setStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    status: JobOpeningStatus,
    actorUserId: string,
  ): Promise<JobOpening | null> {
    const [row] = await tx
      .update(jobOpenings)
      .set({ status, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(this.liveWhere(companyId, [eq(jobOpenings.id, id)]))
      .returning();
    return row ?? null;
  }
}
