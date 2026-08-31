import { Injectable } from "@nestjs/common";
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import type { ListCandidatesQuery } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import {
  candidateNotes,
  candidates,
  candidateStageEvents,
  jobOpenings,
  type Candidate,
  type CandidateNote,
  type CandidateStage,
  type CandidateStageEvent,
} from "../db/schema/recruit";
import { recruitOffset } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — data-access `candidates` + `candidate_stage_events` (append-only) +
 * `candidate_notes` (soft-delete qua UPDATE). CHỈ Company (§13.6). BẤT BIẾN #1: bind `company_id`
 * tường minh mọi câu.
 */
@Injectable()
export class CandidatesRepository {
  private liveWhere(companyId: string, extra: SQL[] = []): SQL | undefined {
    return and(eq(candidates.companyId, companyId), isNull(candidates.deletedAt), ...extra);
  }

  private filterConds(q: ListCandidatesQuery): SQL[] {
    const conds: SQL[] = [];
    if (q.jobOpeningId) conds.push(eq(candidates.jobOpeningId, q.jobOpeningId));
    if (q.stage?.length) conds.push(inArray(candidates.stage, q.stage as CandidateStage[]));
    if (q.source) conds.push(ilike(candidates.source, `%${q.source}%`));
    if (q.q) conds.push(ilike(candidates.fullName, `%${q.q}%`));
    return conds;
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    q: ListCandidatesQuery,
  ): Promise<{ rows: Candidate[]; total: number }> {
    const where = this.liveWhere(companyId, this.filterConds(q));
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(candidates)
        .where(where)
        .orderBy(desc(candidates.createdAt), desc(candidates.id))
        .limit(q.per_page)
        .offset(recruitOffset(q.page, q.per_page)),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(candidates)
        .where(where),
    ]);
    return { rows, total };
  }

  /** COUNT(*) tổng tập khớp filter — RECRUIT-ERR-015 đo TRƯỚC khi stream export (plan §2.2). */
  async countByFilterTx(
    tx: TenantTx,
    companyId: string,
    q: Omit<ListCandidatesQuery, "page" | "per_page">,
  ): Promise<number> {
    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(candidates)
      .where(this.liveWhere(companyId, this.filterConds({ ...q, page: 1, per_page: 1 })));
    return total;
  }

  /** Export — TOÀN BỘ tập khớp filter (đã qua cổng 015), không phân trang. */
  async listAllByFilterTx(
    tx: TenantTx,
    companyId: string,
    q: Omit<ListCandidatesQuery, "page" | "per_page">,
  ): Promise<Candidate[]> {
    return tx
      .select()
      .from(candidates)
      .where(this.liveWhere(companyId, this.filterConds({ ...q, page: 1, per_page: 1 })))
      .orderBy(desc(candidates.createdAt), desc(candidates.id));
  }

  async findTx(tx: TenantTx, companyId: string, id: string): Promise<Candidate | null> {
    const [row] = await tx
      .select()
      .from(candidates)
      .where(this.liveWhere(companyId, [eq(candidates.id, id)]))
      .limit(1);
    return row ?? null;
  }

  /**
   * Check-duplicate (008) — index đúng BIỂU THỨC: `lower(email)` / `regexp_replace(phone,...)`.
   * CỐ Ý tính cả hồ sơ ĐÃ xoá mềm (DB-14 §6.2 — cảnh báo mềm, trả cờ `deleted`).
   */
  async findDuplicatesTx(
    tx: TenantTx,
    companyId: string,
    email: string | undefined,
    phone: string | undefined,
  ): Promise<
    Array<{
      id: string;
      fullName: string;
      stage: string;
      jobTitle: string | null;
      deleted: boolean;
    }>
  > {
    const conds: SQL[] = [];
    if (email) conds.push(sql`lower(${candidates.email}) = lower(${email})`);
    if (phone)
      conds.push(
        sql`regexp_replace(${candidates.phone}, '[^0-9+]', '', 'g') = regexp_replace(${phone}, '[^0-9+]', '', 'g')`,
      );
    if (conds.length === 0) return [];
    const rows = await tx
      .select({
        id: candidates.id,
        fullName: candidates.fullName,
        stage: candidates.stage,
        jobTitle: jobOpenings.title,
        deletedAt: candidates.deletedAt,
      })
      .from(candidates)
      .leftJoin(
        jobOpenings,
        and(eq(jobOpenings.id, candidates.jobOpeningId), eq(jobOpenings.companyId, companyId)),
      )
      .where(and(eq(candidates.companyId, companyId), or(...conds)))
      .limit(20);
    return rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      stage: r.stage,
      jobTitle: r.jobTitle ?? null,
      deleted: r.deletedAt !== null,
    }));
  }

  /** Summary (009) — đếm theo stage (hồ sơ sống) + số vị trí đang Open. */
  async summaryTx(
    tx: TenantTx,
    companyId: string,
  ): Promise<{ byStage: Record<string, number>; openJobOpenings: number }> {
    const [stageRows, [{ open }]] = await Promise.all([
      tx
        .select({ stage: candidates.stage, count: sql<number>`count(*)::int` })
        .from(candidates)
        .where(this.liveWhere(companyId))
        .groupBy(candidates.stage),
      tx
        .select({ open: sql<number>`count(*)::int` })
        .from(jobOpenings)
        .where(
          and(
            eq(jobOpenings.companyId, companyId),
            isNull(jobOpenings.deletedAt),
            eq(jobOpenings.status, "Open"),
          ),
        ),
    ]);
    const byStage: Record<string, number> = {};
    for (const r of stageRows) byStage[r.stage] = r.count;
    return { byStage, openJobOpenings: open };
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    data: {
      jobOpeningId: string;
      fullName: string;
      email: string | null;
      phone: string | null;
      source: string | null;
      note: string | null;
      createdBy: string;
    },
  ): Promise<Candidate> {
    const [row] = await tx
      .insert(candidates)
      .values({ companyId, ...data, updatedBy: data.createdBy })
      .returning();
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: Partial<
      Pick<Candidate, "jobOpeningId" | "fullName" | "email" | "phone" | "source" | "note">
    >,
    actorUserId: string,
  ): Promise<Candidate | null> {
    const [row] = await tx
      .update(candidates)
      .set({ ...patch, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(this.liveWhere(companyId, [eq(candidates.id, id)]))
      .returning();
    return row ?? null;
  }

  /** Move stage + stage event (append-only) trong CÙNG tx của caller. */
  async moveStageTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    fromStage: CandidateStage,
    toStage: CandidateStage,
    action: "move" | "convert",
    reason: string,
    actorUserId: string,
  ): Promise<{ candidate: Candidate; stageEvent: CandidateStageEvent } | null> {
    const [candidate] = await tx
      .update(candidates)
      .set({ stage: toStage, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(this.liveWhere(companyId, [eq(candidates.id, id), eq(candidates.stage, fromStage)]))
      .returning();
    if (!candidate) return null;
    const [stageEvent] = await tx
      .insert(candidateStageEvents)
      .values({
        companyId,
        candidateId: id,
        fromStage,
        toStage,
        action,
        reason,
        actedBy: actorUserId,
      })
      .returning();
    return { candidate, stageEvent };
  }

  /** Chốt cuối convert — set employee_id CHỈ khi còn NULL (UNIQUE partial là lưới thứ hai). */
  async linkEmployeeTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    employeeId: string,
    actorUserId: string,
  ): Promise<Candidate | null> {
    const [row] = await tx
      .update(candidates)
      .set({ employeeId, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(this.liveWhere(companyId, [eq(candidates.id, id), isNull(candidates.employeeId)]))
      .returning();
    return row ?? null;
  }

  /** Hàng candidates + FOR UPDATE + JOIN job_openings — Pha 3 convert (plan §6.1 bước 1). */
  async findForConvertTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<
    (Candidate & { jobOrgUnitId: string; jobPositionId: string | null; jobTitle: string }) | null
  > {
    const rows = await tx
      .select({
        candidate: candidates,
        jobOrgUnitId: jobOpenings.orgUnitId,
        jobPositionId: jobOpenings.positionId,
        jobTitle: jobOpenings.title,
      })
      .from(candidates)
      .innerJoin(
        jobOpenings,
        and(eq(jobOpenings.id, candidates.jobOpeningId), eq(jobOpenings.companyId, companyId)),
      )
      .where(this.liveWhere(companyId, [eq(candidates.id, id)]))
      .for("update", { of: candidates })
      .limit(1);
    const r = rows[0];
    if (!r) return null;
    return {
      ...r.candidate,
      jobOrgUnitId: r.jobOrgUnitId,
      jobPositionId: r.jobPositionId ?? null,
      jobTitle: r.jobTitle,
    };
  }

  // ── stage events (014) ──
  async listStageEventsTx(
    tx: TenantTx,
    companyId: string,
    candidateId: string,
    page: number,
    perPage: number,
  ): Promise<{ rows: CandidateStageEvent[]; total: number }> {
    const where = and(
      eq(candidateStageEvents.companyId, companyId),
      eq(candidateStageEvents.candidateId, candidateId),
    );
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(candidateStageEvents)
        .where(where)
        .orderBy(desc(candidateStageEvents.actedAt), desc(candidateStageEvents.id))
        .limit(perPage)
        .offset(recruitOffset(page, perPage)),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(candidateStageEvents)
        .where(where),
    ]);
    return { rows, total };
  }

  // ── notes (015–017) ──
  async listNotesTx(
    tx: TenantTx,
    companyId: string,
    candidateId: string,
    page: number,
    perPage: number,
  ): Promise<{ rows: CandidateNote[]; total: number }> {
    const where = and(
      eq(candidateNotes.companyId, companyId),
      eq(candidateNotes.candidateId, candidateId),
      isNull(candidateNotes.deletedAt),
    );
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(candidateNotes)
        .where(where)
        .orderBy(desc(candidateNotes.createdAt), desc(candidateNotes.id))
        .limit(perPage)
        .offset(recruitOffset(page, perPage)),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(candidateNotes)
        .where(where),
    ]);
    return { rows, total };
  }

  async createNoteTx(
    tx: TenantTx,
    companyId: string,
    candidateId: string,
    body: string,
    actorUserId: string,
  ): Promise<CandidateNote> {
    const [row] = await tx
      .insert(candidateNotes)
      .values({ companyId, candidateId, body, createdBy: actorUserId, updatedBy: actorUserId })
      .returning();
    return row;
  }

  /** Sửa/xoá mềm ghi chú CỦA MÌNH — `created_by = actor` nằm NGAY TRONG WHERE (404 chung khi khác). */
  async updateOwnNoteTx(
    tx: TenantTx,
    companyId: string,
    candidateId: string,
    noteId: string,
    actorUserId: string,
    patch: { body?: string; softDelete?: boolean },
  ): Promise<CandidateNote | null> {
    const [row] = await tx
      .update(candidateNotes)
      .set({
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.softDelete ? { deletedAt: sql`now()`, deletedBy: actorUserId } : {}),
        updatedAt: sql`now()`,
        updatedBy: actorUserId,
      })
      .where(
        and(
          eq(candidateNotes.companyId, companyId),
          eq(candidateNotes.candidateId, candidateId),
          eq(candidateNotes.id, noteId),
          eq(candidateNotes.createdBy, actorUserId),
          isNull(candidateNotes.deletedAt),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Ứng viên SỐNG đang gắn job — kiểm job Closed (005) khi tạo/đổi jobOpeningId. */
  async jobStatusTx(
    tx: TenantTx,
    companyId: string,
    jobOpeningId: string,
  ): Promise<{ status: string; title: string } | null> {
    const [row] = await tx
      .select({ status: jobOpenings.status, title: jobOpenings.title })
      .from(jobOpenings)
      .where(
        and(
          eq(jobOpenings.id, jobOpeningId),
          eq(jobOpenings.companyId, companyId),
          isNull(jobOpenings.deletedAt),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
