import { Injectable } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { BonusKind, BonusPenaltyStatus } from "@mediaos/contracts";
import type { TenantTx } from "../db/db.service";
import { bonusPenalties, type BonusPenalty } from "../db/schema/payroll";

export interface BonusPenaltyListFilter {
  userId?: string;
  status?: BonusPenaltyStatus[];
  periodMonth?: string;
  kind?: BonusKind;
}

/**
 * S13-PAYROLL-BE-1 — `bonus_penalties`: thưởng/phạt nhập tay, có duyệt (SPEC-01 §17.17 · SPEC-11 §13.3).
 *
 * FSM: `Pending → Approved | Rejected`, hai đích **TERMINAL**. Chỉ hàng `Approved` cùng `period_month`
 * **chưa consume** mới được máy tính lương gộp (BE-2); lúc gộp ghi cặp `payroll_period_id`/`consumed_at`.
 *
 * ⚠️ Trigger `enforce_bonus_penalty_freeze` (`0564`) là lớp DB duy nhất so được OLD/NEW, nhưng nó
 * `RAISE … USING ERRCODE='check_violation'` **không kèm `USING CONSTRAINT`** ⇒ mã lỗi về không mang tên
 * ⇒ **không phân biệt được nhánh**. Vì vậy service **tiền-kiểm 011/013 dưới `FOR UPDATE`** (xem
 * `lockForUpdateTx`); trigger chỉ còn là chốt cuối cho RACE.
 */
@Injectable()
export class BonusPenaltiesRepository {
  private static scope(companyId: string) {
    return and(eq(bonusPenalties.companyId, companyId), isNull(bonusPenalties.deletedAt));
  }

  private static filterCond(companyId: string, f: BonusPenaltyListFilter) {
    const conds = [BonusPenaltiesRepository.scope(companyId)];
    if (f.userId) conds.push(eq(bonusPenalties.userId, f.userId));
    if (f.status?.length) conds.push(inArray(bonusPenalties.status, f.status));
    if (f.periodMonth) conds.push(eq(bonusPenalties.periodMonth, f.periodMonth));
    if (f.kind) conds.push(eq(bonusPenalties.kind, f.kind));
    return and(...conds);
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    f: BonusPenaltyListFilter,
    limit: number,
    offset: number,
  ): Promise<BonusPenalty[]> {
    return tx
      .select()
      .from(bonusPenalties)
      .where(BonusPenaltiesRepository.filterCond(companyId, f))
      .orderBy(desc(bonusPenalties.periodMonth), desc(bonusPenalties.id))
      .limit(limit)
      .offset(offset);
  }

  async countTx(tx: TenantTx, companyId: string, f: BonusPenaltyListFilter): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(bonusPenalties)
      .where(BonusPenaltiesRepository.filterCond(companyId, f));
    return Number(row?.n ?? 0);
  }

  async findTx(tx: TenantTx, companyId: string, id: string): Promise<BonusPenalty | null> {
    const [row] = await tx
      .select()
      .from(bonusPenalties)
      .where(and(BonusPenaltiesRepository.scope(companyId), eq(bonusPenalties.id, id)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Khoá hàng TRƯỚC khi sửa/quyết định — điều kiện 011 (`status <> 'Pending'`) và 013
   * (`payroll_period_id IS NOT NULL`) phải đọc **dưới lock**, nếu không hai request song song cùng
   * thấy `Pending` rồi cùng ghi, và cái thua nhận `23514` không tên ⇒ không map được mã đúng.
   */
  async lockForUpdateTx(tx: TenantTx, companyId: string, id: string): Promise<BonusPenalty | null> {
    const [row] = await tx
      .select()
      .from(bonusPenalties)
      .where(and(BonusPenaltiesRepository.scope(companyId), eq(bonusPenalties.id, id)))
      .limit(1)
      .for("update");
    return row ?? null;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    input: {
      userId: string;
      kind: BonusKind;
      amount: number;
      periodMonth: string;
      reason: string;
    },
    actorUserId: string,
  ): Promise<BonusPenalty> {
    const [row] = await tx
      .insert(bonusPenalties)
      .values({
        companyId,
        userId: input.userId,
        kind: input.kind,
        // numeric(18,2) — CHUỖI, không để float JS đi vào cột tiền.
        amount: input.amount.toFixed(2),
        periodMonth: input.periodMonth,
        reason: input.reason,
        status: "Pending",
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row;
  }

  /** Sửa nội dung — CHỈ khi còn `Pending` và chưa consume (service đã tiền-kiểm dưới lock). */
  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: { kind?: BonusKind; amount?: number; periodMonth?: string; reason?: string },
    actorUserId: string,
  ): Promise<BonusPenalty | null> {
    const set: Record<string, unknown> = { updatedBy: actorUserId, updatedAt: new Date() };
    if (patch.kind !== undefined) set["kind"] = patch.kind;
    if (patch.amount !== undefined) set["amount"] = patch.amount.toFixed(2);
    if (patch.periodMonth !== undefined) set["periodMonth"] = patch.periodMonth;
    if (patch.reason !== undefined) set["reason"] = patch.reason;
    const [row] = await tx
      .update(bonusPenalties)
      .set(set)
      .where(and(BonusPenaltiesRepository.scope(companyId), eq(bonusPenalties.id, id)))
      .returning();
    return row ?? null;
  }

  /**
   * Quyết định (approve/reject). **KHÔNG kèm sửa tiền** — nhánh (D) của trigger chặn câu UPDATE vừa
   * duyệt vừa đổi `amount`, và vì `RAISE` không mang tên constraint thì lỗi đó về dạng `23514` mù.
   */
  async decideTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    status: "Approved" | "Rejected",
    decisionNote: string | null,
    actorUserId: string,
  ): Promise<BonusPenalty | null> {
    const [row] = await tx
      .update(bonusPenalties)
      .set({
        status,
        decidedBy: actorUserId,
        decidedAt: new Date(),
        decisionNote,
        updatedBy: actorUserId,
        updatedAt: new Date(),
      })
      .where(and(BonusPenaltiesRepository.scope(companyId), eq(bonusPenalties.id, id)))
      .returning();
    return row ?? null;
  }

  /** Xoá MỀM — không có GRANT DELETE cho app role. */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<BonusPenalty | null> {
    const [row] = await tx
      .update(bonusPenalties)
      .set({ deletedAt: new Date(), deletedBy: actorUserId, updatedBy: actorUserId })
      .where(and(BonusPenaltiesRepository.scope(companyId), eq(bonusPenalties.id, id)))
      .returning();
    return row ?? null;
  }
}
