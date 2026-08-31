import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import type { ListInterviewsQuery } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import {
  candidates,
  interviewFeedbacks,
  interviewParticipants,
  interviews,
  type Interview,
  type InterviewFeedback,
  type InterviewStatus,
} from "../db/schema/recruit";
import { recruitOffset } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — data-access `interviews` + `interview_participants` (chỉ-INSERT) +
 * `interview_feedbacks` (UPDATE cấp cột). Own-scope = `EXISTS interview_participants` theo employee
 * của caller (KHÔNG `buildEmployeeScopeCondition` — plan §4.2); caller không có hồ sơ ⇒ vị từ
 * `FALSE` fail-closed (danh sách rỗng, không lỗi).
 */
@Injectable()
export class InterviewsRepository {
  /** Vị từ Own — EXISTS participant theo employee SỐNG của caller (plan §4.2). */
  ownCond(companyId: string, callerEmployeeId: string | null): SQL {
    if (!callerEmployeeId) return sql`false`;
    return sql`exists (
      select 1 from interview_participants ip
       where ip.company_id = ${companyId}
         and ip.interview_id = ${interviews.id}
         and ip.employee_id = ${callerEmployeeId}
    )`;
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    q: ListInterviewsQuery,
    ownFilter: SQL | null,
  ): Promise<{ rows: Interview[]; total: number }> {
    const conds: SQL[] = [eq(interviews.companyId, companyId)];
    if (q.candidateId) conds.push(eq(interviews.candidateId, q.candidateId));
    if (q.from) conds.push(gte(interviews.startsAt, new Date(q.from)));
    if (q.to) conds.push(lte(interviews.startsAt, new Date(q.to)));
    if (q.status?.length) conds.push(inArray(interviews.status, q.status as InterviewStatus[]));
    if (ownFilter) conds.push(ownFilter);
    const where = and(...conds);
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(interviews)
        .where(where)
        .orderBy(desc(interviews.startsAt), desc(interviews.id))
        .limit(q.per_page)
        .offset(recruitOffset(q.page, q.per_page)),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(interviews)
        .where(where),
    ]);
    return { rows, total };
  }

  /** Chi tiết TRONG scope — `ownFilter` (nếu có) nằm NGAY TRONG WHERE ⇒ ngoài scope = 404 chung. */
  async findScopedTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    ownFilter: SQL | null,
  ): Promise<Interview | null> {
    const conds: SQL[] = [eq(interviews.companyId, companyId), eq(interviews.id, id)];
    if (ownFilter) conds.push(ownFilter);
    const [row] = await tx
      .select()
      .from(interviews)
      .where(and(...conds))
      .limit(1);
    return row ?? null;
  }

  async candidateEmbedTx(
    tx: TenantTx,
    companyId: string,
    candidateId: string,
  ): Promise<{ id: string; fullName: string; stage: string } | null> {
    const [row] = await tx
      .select({ id: candidates.id, fullName: candidates.fullName, stage: candidates.stage })
      .from(candidates)
      .where(and(eq(candidates.companyId, companyId), eq(candidates.id, candidateId)))
      .limit(1);
    return row ?? null;
  }

  /** Batch embed cho list (FULL gate M5 — gỡ N+1: MỘT câu `IN` cho cả trang). */
  async candidateEmbedsTx(
    tx: TenantTx,
    companyId: string,
    candidateIds: readonly string[],
  ): Promise<Map<string, { id: string; fullName: string; stage: string }>> {
    const out = new Map<string, { id: string; fullName: string; stage: string }>();
    const ids = [...new Set(candidateIds)];
    if (ids.length === 0) return out;
    const rows = await tx
      .select({ id: candidates.id, fullName: candidates.fullName, stage: candidates.stage })
      .from(candidates)
      .where(and(eq(candidates.companyId, companyId), inArray(candidates.id, ids)));
    for (const r of rows) out.set(r.id, r);
    return out;
  }

  async participantsTx(
    tx: TenantTx,
    companyId: string,
    interviewIds: readonly string[],
  ): Promise<Map<string, Array<{ employeeId: string }>>> {
    const out = new Map<string, Array<{ employeeId: string }>>();
    if (interviewIds.length === 0) return out;
    const rows = await tx
      .select({
        interviewId: interviewParticipants.interviewId,
        employeeId: interviewParticipants.employeeId,
      })
      .from(interviewParticipants)
      .where(
        and(
          eq(interviewParticipants.companyId, companyId),
          inArray(interviewParticipants.interviewId, [...interviewIds]),
        ),
      );
    for (const r of rows) {
      (out.get(r.interviewId) ?? out.set(r.interviewId, []).get(r.interviewId)!).push({
        employeeId: r.employeeId,
      });
    }
    return out;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    data: {
      candidateId: string;
      round: number;
      startsAt: Date;
      endsAt: Date;
      location: string | null;
      note: string | null;
      createdBy: string;
      participantEmployeeIds: readonly string[];
    },
  ): Promise<Interview> {
    const [row] = await tx
      .insert(interviews)
      .values({
        companyId,
        candidateId: data.candidateId,
        round: data.round,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        location: data.location,
        note: data.note,
        createdBy: data.createdBy,
        updatedBy: data.createdBy,
      })
      .returning();
    await tx.insert(interviewParticipants).values(
      [...new Set(data.participantEmployeeIds)].map((employeeId) => ({
        companyId,
        interviewId: row.id,
        employeeId,
      })),
    );
    return row;
  }

  /** Sửa nội dung — khoá lạc quan `status='Scheduled'` NGAY TRONG WHERE (FULL gate F1: mirror
   * offers.updateDraftTx — pre-check ở service không chặn được race giữa SELECT và UPDATE). */
  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: Partial<Pick<Interview, "round" | "startsAt" | "endsAt" | "location" | "note">>,
    actorUserId: string,
  ): Promise<Interview | null> {
    const [row] = await tx
      .update(interviews)
      .set({ ...patch, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(
        and(
          eq(interviews.companyId, companyId),
          eq(interviews.id, id),
          eq(interviews.status, "Scheduled"),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Đổi trạng thái — khoá lạc quan `status=fromStatus` (FULL gate F1: mirror offers.setStatusTx;
   * 0 hàng = thua race ⇒ service map 409 004, audit không ghi before cũ sai). */
  async setStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    fromStatus: InterviewStatus,
    status: InterviewStatus,
    actorUserId: string,
  ): Promise<Interview | null> {
    const [row] = await tx
      .update(interviews)
      .set({ status, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(
        and(
          eq(interviews.companyId, companyId),
          eq(interviews.id, id),
          eq(interviews.status, fromStatus),
        ),
      )
      .returning();
    return row ?? null;
  }

  // ── feedbacks ──
  async feedbacksByInterviewTx(
    tx: TenantTx,
    companyId: string,
    interviewId: string,
  ): Promise<InterviewFeedback[]> {
    return tx
      .select()
      .from(interviewFeedbacks)
      .where(
        and(
          eq(interviewFeedbacks.companyId, companyId),
          eq(interviewFeedbacks.interviewId, interviewId),
        ),
      )
      .orderBy(desc(interviewFeedbacks.createdAt));
  }

  async isParticipantTx(
    tx: TenantTx,
    companyId: string,
    interviewId: string,
    employeeId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: interviewParticipants.id })
      .from(interviewParticipants)
      .where(
        and(
          eq(interviewParticipants.companyId, companyId),
          eq(interviewParticipants.interviewId, interviewId),
          eq(interviewParticipants.employeeId, employeeId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async createFeedbackTx(
    tx: TenantTx,
    companyId: string,
    interviewId: string,
    interviewerEmployeeId: string,
    data: { rating: number; comment: string | null; recommendation: string },
  ): Promise<InterviewFeedback> {
    const [row] = await tx
      .insert(interviewFeedbacks)
      .values({
        companyId,
        interviewId,
        interviewerEmployeeId,
        rating: data.rating,
        comment: data.comment,
        recommendation: data.recommendation as InterviewFeedback["recommendation"],
      })
      .returning();
    return row;
  }

  /** PATCH feedback CỦA MÌNH — resolve theo (interview, interviewer), KHÔNG nhận id feedback. */
  async updateOwnFeedbackTx(
    tx: TenantTx,
    companyId: string,
    interviewId: string,
    interviewerEmployeeId: string,
    patch: Partial<{ rating: number; comment: string | null; recommendation: string }>,
  ): Promise<InterviewFeedback | null> {
    const [row] = await tx
      .update(interviewFeedbacks)
      .set({
        ...(patch.rating !== undefined ? { rating: patch.rating } : {}),
        ...(patch.comment !== undefined ? { comment: patch.comment } : {}),
        ...(patch.recommendation !== undefined
          ? { recommendation: patch.recommendation as InterviewFeedback["recommendation"] }
          : {}),
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(interviewFeedbacks.companyId, companyId),
          eq(interviewFeedbacks.interviewId, interviewId),
          eq(interviewFeedbacks.interviewerEmployeeId, interviewerEmployeeId),
        ),
      )
      .returning();
    return row ?? null;
  }
}
