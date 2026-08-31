import { Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { ListOffersQuery } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { offers, type Offer, type OfferStatus } from "../db/schema/recruit";
import { OFFER_TERMINAL_STATUSES } from "./recruit-fsm";
import { recruitOffset } from "./recruit.types";

/**
 * S12-RECRUIT-BE-1 — data-access `offers` (UPDATE cấp cột: title·start_date·salary·note·status·
 * responded_at·updated_at·updated_by). "Vào terminal" = MỘT câu UPDATE đủ `status`+`responded_at`
 * (chk_offers_responded_pair — memory s12-recruit-wave). CHỈ Company (§13.6).
 */
@Injectable()
export class OffersRepository {
  async listTx(
    tx: TenantTx,
    companyId: string,
    q: ListOffersQuery,
  ): Promise<{ rows: Offer[]; total: number }> {
    const conds: SQL[] = [eq(offers.companyId, companyId)];
    if (q.candidateId) conds.push(eq(offers.candidateId, q.candidateId));
    if (q.status?.length) conds.push(inArray(offers.status, q.status as OfferStatus[]));
    const where = and(...conds);
    const [rows, [{ total }]] = await Promise.all([
      tx
        .select()
        .from(offers)
        .where(where)
        .orderBy(desc(offers.createdAt), desc(offers.id))
        .limit(q.per_page)
        .offset(recruitOffset(q.page, q.per_page)),
      tx
        .select({ total: sql<number>`count(*)::int` })
        .from(offers)
        .where(where),
    ]);
    return { rows, total };
  }

  async findTx(tx: TenantTx, companyId: string, id: string): Promise<Offer | null> {
    const [row] = await tx
      .select()
      .from(offers)
      .where(and(eq(offers.companyId, companyId), eq(offers.id, id)))
      .limit(1);
    return row ?? null;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    data: {
      candidateId: string;
      title: string | null;
      startDate: string;
      salary: string;
      note: string | null;
      createdBy: string;
    },
  ): Promise<Offer> {
    const [row] = await tx
      .insert(offers)
      .values({ companyId, ...data, updatedBy: data.createdBy })
      .returning();
    return row;
  }

  /** PATCH nội dung — service đã ép `Draft` (khoá lạc quan `status='Draft'` trong WHERE chống race). */
  async updateDraftTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: Partial<Pick<Offer, "title" | "startDate" | "salary" | "note">>,
    actorUserId: string,
  ): Promise<Offer | null> {
    const [row] = await tx
      .update(offers)
      .set({ ...patch, updatedAt: sql`now()`, updatedBy: actorUserId })
      .where(and(eq(offers.companyId, companyId), eq(offers.id, id), eq(offers.status, "Draft")))
      .returning();
    return row ?? null;
  }

  /** Đổi trạng thái — terminal set LUÔN `responded_at` CÙNG câu (chk_offers_responded_pair). */
  async setStatusTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    fromStatus: OfferStatus,
    toStatus: OfferStatus,
    actorUserId: string,
  ): Promise<Offer | null> {
    const isTerminal = OFFER_TERMINAL_STATUSES.has(toStatus);
    const [row] = await tx
      .update(offers)
      .set({
        status: toStatus,
        ...(isTerminal ? { respondedAt: sql`now()` } : {}),
        updatedAt: sql`now()`,
        updatedBy: actorUserId,
      })
      .where(and(eq(offers.companyId, companyId), eq(offers.id, id), eq(offers.status, fromStatus)))
      .returning();
    return row ?? null;
  }

  /** Offers của candidate — dùng ở convert Pha 3 (re-select, KHÔNG dùng lại Pha 1). */
  async byCandidateTx(tx: TenantTx, companyId: string, candidateId: string): Promise<Offer[]> {
    return tx
      .select()
      .from(offers)
      .where(and(eq(offers.companyId, companyId), eq(offers.candidateId, candidateId)))
      .orderBy(desc(offers.createdAt), desc(offers.id));
  }
}
