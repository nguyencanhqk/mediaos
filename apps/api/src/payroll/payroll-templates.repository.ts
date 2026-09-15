import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { orgUnits } from "../db/schema/org";
import { countOrThrow } from "./payroll-sql.util";
import {
  payrollTemplateComponents,
  payrollTemplates,
  salaryComponents,
  type PayrollTemplate,
} from "../db/schema/payroll";

export interface PayrollTemplateListFilter {
  readonly scope?: string;
  readonly isActive?: boolean;
  readonly page: number;
  readonly perPage: number;
}

export interface PayrollTemplateWrite {
  readonly name?: string;
  readonly scope?: string;
  readonly orgUnitId?: string | null;
  readonly isActive?: boolean;
}

/** Một thành phần của mẫu, đã JOIN catalog. `fixedAmount` là chuỗi numeric — chỉ để dựng đồ thị/fingerprint. */
export interface TemplateComponentRow {
  readonly componentId: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
  readonly valueType: string;
  readonly catalogFormula: string | null;
  readonly fixedAmount: string | null;
  readonly pitDeductible: boolean;
  /** S15-PAYROLL-BE-3 — hàng catalog hệ thống: cổng drift + cổng độ phủ đầu vào lúc gắn/tính (plan §4.8 · §0b B1). */
  readonly isSystem: boolean;
  readonly componentActive: boolean;
  /** Hàng catalog đã xoá mềm mà link còn sót (ghi thẳng DB) — preview fail-closed trên cả vế này. */
  readonly componentDeletedAt: Date | null;
  readonly columnLabel: string | null;
  readonly formulaOverride: string | null;
  readonly isVisible: boolean;
  readonly sortOrder: number;
}

export interface TemplateComponentInsert {
  readonly componentId: string;
  readonly columnLabel: string | null;
  readonly formulaOverride: string | null;
  readonly isVisible: boolean;
  readonly sortOrder: number;
}

export interface TemplateRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * S15-PAYROLL-BE-2 — `payroll_templates` + `payroll_template_components` (PAYROLL-API-049..054).
 *
 * `payroll_template_components` là bảng PAYROLL DUY NHẤT có GRANT DELETE (DB-13 §13.6): 053 ĐẶT LẠI toàn bộ danh
 * sách bằng DELETE-rồi-INSERT trong MỘT transaction (cùng advisory lock catalog + `FOR UPDATE` hàng mẫu).
 */
@Injectable()
export class PayrollTemplatesRepository {
  private static live(companyId: string) {
    return and(eq(payrollTemplates.companyId, companyId), isNull(payrollTemplates.deletedAt));
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    f: PayrollTemplateListFilter,
  ): Promise<{ rows: PayrollTemplate[]; total: number }> {
    const where = and(
      PayrollTemplatesRepository.live(companyId),
      f.scope !== undefined ? eq(payrollTemplates.scope, f.scope) : undefined,
      f.isActive !== undefined ? eq(payrollTemplates.isActive, f.isActive) : undefined,
    );
    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(payrollTemplates)
        .where(where)
        .orderBy(asc(payrollTemplates.code))
        .limit(f.perPage)
        .offset((f.page - 1) * f.perPage),
      tx.select({ n: count() }).from(payrollTemplates).where(where),
    ]);
    return { rows, total: Number(totals[0]?.n ?? 0) };
  }

  async findTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<PayrollTemplate | null> {
    const q = tx
      .select()
      .from(payrollTemplates)
      .where(and(PayrollTemplatesRepository.live(companyId), eq(payrollTemplates.id, id)))
      .limit(1);
    const [row] = opts.forUpdate ? await q.for("update") : await q;
    return row ?? null;
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    code: string,
    w: PayrollTemplateWrite & { name: string; scope: string },
    actorUserId: string,
  ): Promise<PayrollTemplate> {
    const [row] = await tx
      .insert(payrollTemplates)
      .values({
        companyId,
        code,
        name: w.name,
        scope: w.scope,
        orgUnitId: w.orgUnitId ?? null,
        isActive: w.isActive ?? true,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row as PayrollTemplate;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    w: PayrollTemplateWrite,
    actorUserId: string,
  ): Promise<PayrollTemplate | null> {
    const [row] = await tx
      .update(payrollTemplates)
      .set({
        ...(w.name !== undefined ? { name: w.name } : {}),
        ...(w.scope !== undefined ? { scope: w.scope } : {}),
        ...(w.orgUnitId !== undefined ? { orgUnitId: w.orgUnitId } : {}),
        ...(w.isActive !== undefined ? { isActive: w.isActive } : {}),
        updatedBy: actorUserId,
        updatedAt: sql`now()`,
      })
      .where(and(PayrollTemplatesRepository.live(companyId), eq(payrollTemplates.id, id)))
      .returning();
    return row ?? null;
  }

  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<PayrollTemplate | null> {
    const [row] = await tx
      .update(payrollTemplates)
      .set({ deletedAt: sql`now()`, deletedBy: actorUserId, updatedBy: actorUserId })
      .where(and(PayrollTemplatesRepository.live(companyId), eq(payrollTemplates.id, id)))
      .returning();
    return row ?? null;
  }

  /**
   * Thành phần của mẫu — **KHÔNG lọc `is_visible`**: «đang bật trong mẫu» nghĩa là CÓ MẶT trong mẫu; ẩn cột chỉ
   * là hiển thị, vẫn cộng vào aggregate (SPEC-11 §13.6 E — plan-review BE-2 MF4).
   */
  async componentsTx(
    tx: TenantTx,
    companyId: string,
    templateId: string,
  ): Promise<TemplateComponentRow[]> {
    return tx
      .select({
        componentId: payrollTemplateComponents.componentId,
        code: salaryComponents.code,
        name: salaryComponents.name,
        kind: salaryComponents.kind,
        valueType: salaryComponents.valueType,
        catalogFormula: salaryComponents.formula,
        fixedAmount: salaryComponents.fixedAmount,
        pitDeductible: salaryComponents.pitDeductible,
        isSystem: salaryComponents.isSystem,
        componentActive: salaryComponents.isActive,
        componentDeletedAt: salaryComponents.deletedAt,
        columnLabel: payrollTemplateComponents.columnLabel,
        formulaOverride: payrollTemplateComponents.formulaOverride,
        isVisible: payrollTemplateComponents.isVisible,
        sortOrder: payrollTemplateComponents.sortOrder,
      })
      .from(payrollTemplateComponents)
      .innerJoin(
        salaryComponents,
        and(
          eq(salaryComponents.companyId, payrollTemplateComponents.companyId),
          eq(salaryComponents.id, payrollTemplateComponents.componentId),
        ),
      )
      .where(
        and(
          eq(payrollTemplateComponents.companyId, companyId),
          eq(payrollTemplateComponents.templateId, templateId),
        ),
      )
      .orderBy(asc(payrollTemplateComponents.sortOrder), asc(salaryComponents.code));
  }

  /** 053 — ĐẶT LẠI toàn bộ trong tx hiện tại. Người gọi PHẢI giữ advisory lock catalog + `FOR UPDATE` hàng mẫu. */
  async replaceComponentsTx(
    tx: TenantTx,
    companyId: string,
    templateId: string,
    rows: readonly TemplateComponentInsert[],
    actorUserId: string,
  ): Promise<void> {
    await tx
      .delete(payrollTemplateComponents)
      .where(
        and(
          eq(payrollTemplateComponents.companyId, companyId),
          eq(payrollTemplateComponents.templateId, templateId),
        ),
      );
    if (rows.length === 0) return;
    await tx.insert(payrollTemplateComponents).values(
      rows.map((r) => ({
        companyId,
        templateId,
        componentId: r.componentId,
        columnLabel: r.columnLabel,
        formulaOverride: r.formulaOverride,
        isVisible: r.isVisible,
        sortOrder: r.sortOrder,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })),
    );
  }

  /** Mẫu **CHƯA XOÁ** đang chứa một thành phần (MF15 — mẫu xoá mềm không giữ thành phần «đang dùng»). */
  async templatesContainingTx(
    tx: TenantTx,
    companyId: string,
    componentId: string,
  ): Promise<TemplateRef[]> {
    return tx
      .select({ id: payrollTemplates.id, code: payrollTemplates.code, name: payrollTemplates.name })
      .from(payrollTemplateComponents)
      .innerJoin(
        payrollTemplates,
        and(
          eq(payrollTemplates.companyId, payrollTemplateComponents.companyId),
          eq(payrollTemplates.id, payrollTemplateComponents.templateId),
        ),
      )
      .where(
        and(
          eq(payrollTemplateComponents.companyId, companyId),
          eq(payrollTemplateComponents.componentId, componentId),
          isNull(payrollTemplates.deletedAt),
        ),
      )
      .orderBy(asc(payrollTemplates.code));
  }

  /**
   * Đơn vị chọn cho mẫu `scope='org_unit'` tồn tại + CHƯA XOÁ MỀM. FK composite `payroll_templates_org_unit_id_company_fk`
   * chặn khác tenant/không tồn tại nhưng KHÔNG chặn hàng đã xoá mềm (MF15) ⇒ tiền-kiểm ở đây.
   */
  /**
   * S15-PAYROLL-BE-4 (052 `template-in-use`, D-5) — số kỳ lương SỐNG (bất kể trạng thái) đang gắn mẫu. `SELECT count(*)`
   * THƯỜNG dưới khoá catalog ĐỘC QUYỀN đã có ở 052 — **KHÔNG `FOR SHARE/UPDATE`** hàng kỳ (BE-3 §0b M1: advisory TRƯỚC,
   * khoá hàng SAU; `calculate`/004 lấy shared TRƯỚC khoá kỳ, nên 052 khoá kỳ là chu trình 40P01).
   */
  async periodsUsingTx(tx: TenantTx, companyId: string, templateId: string): Promise<number> {
    const res = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n
        from payroll_periods pp
       where pp.company_id = ${companyId}::uuid
         and pp.template_id = ${templateId}::uuid
         and pp.deleted_at is null`);
    // silent-failure-hunter BE-4 H1: KHÔNG `?? 0` — 0 = «không kỳ nào dùng» ⇒ xoá/ngưng được mẫu; thiếu hàng phải NÉM.
    return countOrThrow(res, "periodsUsingTx");
  }

  async orgUnitLiveTx(tx: TenantTx, companyId: string, orgUnitId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(
        and(
          eq(orgUnits.companyId, companyId),
          eq(orgUnits.id, orgUnitId),
          isNull(orgUnits.deletedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }
}
