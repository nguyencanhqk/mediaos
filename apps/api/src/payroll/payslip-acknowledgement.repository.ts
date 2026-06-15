import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { payrollPeriods, payslipAcknowledgements, payslips } from "../db/schema";

const COLUMNS = {
  id: payslipAcknowledgements.id,
  companyId: payslipAcknowledgements.companyId,
  payslipId: payslipAcknowledgements.payslipId,
  userId: payslipAcknowledgements.userId,
  status: payslipAcknowledgements.status,
  reason: payslipAcknowledgements.reason,
  resolvedBy: payslipAcknowledgements.resolvedBy,
  resolvedAt: payslipAcknowledgements.resolvedAt,
  resolutionNote: payslipAcknowledgements.resolutionNote,
  createdAt: payslipAcknowledgements.createdAt,
  updatedAt: payslipAcknowledgements.updatedAt,
} as const;

export interface AckInsertData {
  payslipId: string;
  userId: string;
  status: "acknowledged" | "disputed";
  reason?: string | null;
}

export interface PayslipOwnership {
  payslipUserId: string;
  periodStatus: string;
}

export interface AckListFilters {
  status?: string;
}

/**
 * PayslipAcknowledgementRepository — MỌI method qua db.withTenant (RLS) + eq(companyId). *Tx để service
 * ghép audit cùng tx (atomic). KHÔNG raw query (BẤT BIẾN #1). MUTABLE hẹp: insert + resolve (disputed→resolved).
 */
@Injectable()
export class PayslipAcknowledgementRepository {
  /**
   * Chủ sở hữu payslip + trạng thái kỳ (join payslips→payroll_periods) — service kiểm ownership +
   * 'published' TRƯỚC khi cho ack/dispute. RLS ép cùng tenant ở cả 2 bảng.
   */
  async findPayslipOwnershipTx(
    tx: TenantTx,
    companyId: string,
    payslipId: string,
  ): Promise<PayslipOwnership | undefined> {
    const [row] = await tx
      .select({
        payslipUserId: payslips.userId,
        periodStatus: payrollPeriods.status,
      })
      .from(payslips)
      .innerJoin(payrollPeriods, eq(payslips.payrollPeriodId, payrollPeriods.id))
      .where(and(eq(payslips.companyId, companyId), eq(payslips.id, payslipId)))
      .limit(1);
    return row;
  }

  insertTx(tx: TenantTx, companyId: string, data: AckInsertData) {
    return tx
      .insert(payslipAcknowledgements)
      .values({
        companyId,
        payslipId: data.payslipId,
        userId: data.userId,
        status: data.status,
        reason: data.reason ?? null,
      })
      .returning(COLUMNS);
  }

  async findByIdTx(tx: TenantTx, companyId: string, id: string) {
    const [row] = await tx
      .select(COLUMNS)
      .from(payslipAcknowledgements)
      .where(
        and(eq(payslipAcknowledgements.companyId, companyId), eq(payslipAcknowledgements.id, id)),
      )
      .limit(1);
    return row;
  }

  async listByPayslipTx(
    tx: TenantTx,
    companyId: string,
    payslipId: string,
    filters: AckListFilters,
  ) {
    const conditions = [
      eq(payslipAcknowledgements.companyId, companyId),
      eq(payslipAcknowledgements.payslipId, payslipId),
    ];
    if (filters.status) conditions.push(eq(payslipAcknowledgements.status, filters.status));
    return await tx
      .select(COLUMNS)
      .from(payslipAcknowledgements)
      .where(and(...(conditions as [(typeof conditions)[0], ...typeof conditions])))
      .orderBy(payslipAcknowledgements.createdAt);
  }

  /** Resolve khiếu nại (disputed→resolved). Compare-and-set status='disputed' (đua → 0 hàng → 409). */
  resolveTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    resolvedBy: string,
    resolutionNote: string | null,
  ) {
    const now = new Date();
    return tx
      .update(payslipAcknowledgements)
      .set({ status: "resolved", resolvedBy, resolvedAt: now, resolutionNote, updatedAt: now })
      .where(
        and(
          eq(payslipAcknowledgements.companyId, companyId),
          eq(payslipAcknowledgements.id, id),
          eq(payslipAcknowledgements.status, "disputed"),
        ),
      )
      .returning(COLUMNS);
  }
}
