import { Injectable } from "@nestjs/common";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { payrollDependents, type PayrollDependent } from "../db/schema/payroll";

export interface PayrollDependentWrite {
  fullName?: string;
  relationship?: string;
  dependentTaxCode?: string | null;
  dateOfBirth?: string | null;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

/**
 * S15-PAYROLL-BE-1 — `payroll_dependents` (`PAYROLL-API-040/041/042`): người phụ thuộc giảm trừ TNCN.
 * Họ tên + MST NPT là **PII** (SPEC-11 §3.12) — chỉ ra qua `('view','payroll-employee')`.
 *
 * 🔴 **Chống chồng lấp khoảng hiệu lực** ép ở DB bằng `EXCLUDE USING gist`
 * (`payroll_dependents_no_overlap_excl`), khoá theo `full_name` **NOT NULL** chứ không theo
 * `dependent_tax_code` (nullable ⇒ EXCLUDE thành RỖNG: hai hàng NULL không "bằng" nhau nên ràng buộc
 * không loại được gì). Service tiền-kiểm để có thông điệp đọc được; DB là chốt cuối cho RACE và ném
 * **`23P01`**, KHÔNG `23505` ⇒ `mapPayrollPgError` có nhánh riêng.
 *
 * GRANT app SELECT/INSERT/UPDATE — **NO DELETE**: xoá là `deleted_at` (bất biến #2).
 */
@Injectable()
export class PayrollDependentsRepository {
  private static scope(companyId: string) {
    return and(eq(payrollDependents.companyId, companyId), isNull(payrollDependents.deletedAt));
  }

  /** 040 — NPT của một nhân sự, mới nhất trước. */
  async listByUserTx(tx: TenantTx, companyId: string, userId: string): Promise<PayrollDependent[]> {
    return tx
      .select()
      .from(payrollDependents)
      .where(
        and(PayrollDependentsRepository.scope(companyId), eq(payrollDependents.userId, userId)),
      )
      .orderBy(asc(payrollDependents.effectiveFrom), asc(payrollDependents.id));
  }

  /** 042 — một hàng. `userId` cho audit/kiểm quyền lấy TỪ ĐÂY, không từ URL (SPEC-11 §15.1). */
  async findTx(tx: TenantTx, companyId: string, id: string): Promise<PayrollDependent | null> {
    const [row] = await tx
      .select()
      .from(payrollDependents)
      .where(and(PayrollDependentsRepository.scope(companyId), eq(payrollDependents.id, id)))
      .limit(1);
    return row ?? null;
  }

  /**
   * Tiền-kiểm chồng lấp — **mirror ĐÚNG BẰNG** vị từ của `payroll_dependents_no_overlap_excl`:
   * cùng `(company_id, user_id, full_name)`, khoảng `[effective_from, effective_to]` với `NULL` =
   * vô hạn, giao nhau theo `&&` của `daterange`.
   *
   * ⚠️ Dùng `daterange(..., '[]')` khớp CHÍNH XÁC ngữ nghĩa BAO GỒM hai đầu mút của ràng buộc DB.
   * Lệch kiểu khoảng (ví dụ `'[)'`) làm tiền-kiểm và chốt cuối **bất đồng ở đúng ngày biên** ⇒ service
   * nói "được" rồi DB ném 409 — mã lỗi đúng nhưng thông điệp sai chỗ, và ca test sẽ xanh-rỗng.
   *
   * `excludeId` cho đường PATCH: hàng đang sửa không được tự chồng chính nó.
   */
  async overlapsTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    fullName: string,
    effectiveFrom: string,
    effectiveTo: string | null,
    excludeId?: string,
  ): Promise<boolean> {
    const rows = await tx
      .select({ id: payrollDependents.id })
      .from(payrollDependents)
      .where(
        and(
          PayrollDependentsRepository.scope(companyId),
          eq(payrollDependents.userId, userId),
          eq(payrollDependents.fullName, fullName),
          excludeId ? ne(payrollDependents.id, excludeId) : undefined,
          sql`daterange(effective_from, effective_to, '[]')
              && daterange(${effectiveFrom}::date, ${effectiveTo}::date, '[]')`,
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    userId: string,
    w: PayrollDependentWrite & { fullName: string; relationship: string; effectiveFrom: string },
    actorUserId: string,
  ): Promise<PayrollDependent> {
    const [row] = await tx
      .insert(payrollDependents)
      .values({
        companyId,
        userId,
        fullName: w.fullName,
        relationship: w.relationship,
        dependentTaxCode: w.dependentTaxCode ?? null,
        dateOfBirth: w.dateOfBirth ?? null,
        effectiveFrom: w.effectiveFrom,
        effectiveTo: w.effectiveTo ?? null,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row as PayrollDependent;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    w: PayrollDependentWrite,
    actorUserId: string,
  ): Promise<PayrollDependent | null> {
    const [row] = await tx
      .update(payrollDependents)
      .set({
        ...(w.fullName !== undefined ? { fullName: w.fullName } : {}),
        ...(w.relationship !== undefined ? { relationship: w.relationship } : {}),
        ...(w.dependentTaxCode !== undefined ? { dependentTaxCode: w.dependentTaxCode } : {}),
        ...(w.dateOfBirth !== undefined ? { dateOfBirth: w.dateOfBirth } : {}),
        ...(w.effectiveFrom !== undefined ? { effectiveFrom: w.effectiveFrom } : {}),
        ...(w.effectiveTo !== undefined ? { effectiveTo: w.effectiveTo } : {}),
        updatedBy: actorUserId,
        updatedAt: sql`now()`,
      })
      .where(and(PayrollDependentsRepository.scope(companyId), eq(payrollDependents.id, id)))
      .returning();
    return row ?? null;
  }

  /** Xoá MỀM (bất biến #2) — app role không có quyền DELETE trên bảng này. */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<PayrollDependent | null> {
    const [row] = await tx
      .update(payrollDependents)
      .set({ deletedAt: sql`now()`, deletedBy: actorUserId, updatedBy: actorUserId })
      .where(and(PayrollDependentsRepository.scope(companyId), eq(payrollDependents.id, id)))
      .returning();
    return row ?? null;
  }
}
