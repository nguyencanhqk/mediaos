import { Injectable } from "@nestjs/common";
import { and, asc, count, eq, inArray, isNull, sql } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { salaryComponents, type SalaryComponent } from "../db/schema/payroll";

export interface SalaryComponentListFilter {
  readonly kind?: string;
  readonly isSystem?: boolean;
  readonly isActive?: boolean;
  readonly page: number;
  readonly perPage: number;
}

/** `fixedAmount` là CHUỖI `numeric(18,2)` — service quy đổi, repository không chạm số thực. */
export interface SalaryComponentWrite {
  readonly name?: string;
  readonly kind?: string;
  readonly valueType?: string;
  readonly formula?: string | null;
  readonly fixedAmount?: string | null;
  readonly pitDeductible?: boolean;
  readonly isActive?: boolean;
  readonly sortOrder?: number;
}

/**
 * S15-PAYROLL-BE-2 — `salary_components` (PAYROLL-API-044..048). Mọi câu có `company_id` tường minh + chạy trong
 * `withTenant` (RLS + FORCE là lưới cuối).
 *
 * GRANT app `SELECT, INSERT, UPDATE` — **KHÔNG DELETE**: xoá là `deleted_at`, và hàng `is_system` còn bị CHECK
 * `salary_components_system_not_deletable` + trigger `salary_component_system_freeze` chặn ở DB.
 */
@Injectable()
export class SalaryComponentsRepository {
  private static live(companyId: string) {
    return and(eq(salaryComponents.companyId, companyId), isNull(salaryComponents.deletedAt));
  }

  async listTx(
    tx: TenantTx,
    companyId: string,
    f: SalaryComponentListFilter,
  ): Promise<{ rows: SalaryComponent[]; total: number }> {
    const where = and(
      SalaryComponentsRepository.live(companyId),
      f.kind !== undefined ? eq(salaryComponents.kind, f.kind) : undefined,
      f.isSystem !== undefined ? eq(salaryComponents.isSystem, f.isSystem) : undefined,
      f.isActive !== undefined ? eq(salaryComponents.isActive, f.isActive) : undefined,
    );
    const [rows, totals] = await Promise.all([
      tx
        .select()
        .from(salaryComponents)
        .where(where)
        .orderBy(asc(salaryComponents.sortOrder), asc(salaryComponents.code))
        .limit(f.perPage)
        .offset((f.page - 1) * f.perPage),
      tx.select({ n: count() }).from(salaryComponents).where(where),
    ]);
    return { rows, total: Number(totals[0]?.n ?? 0) };
  }

  async findTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    opts: { forUpdate?: boolean } = {},
  ): Promise<SalaryComponent | null> {
    const q = tx
      .select()
      .from(salaryComponents)
      .where(and(SalaryComponentsRepository.live(companyId), eq(salaryComponents.id, id)))
      .limit(1);
    const [row] = opts.forUpdate ? await q.for("update") : await q;
    return row ?? null;
  }

  /**
   * Catalog **ĐANG DÙNG** (chưa xoá mềm · `is_active`) — ngữ cảnh phân giải REF lúc LƯU (045 · 047 · 048) và
   * dựng cạnh ngầm của 4 nút aggregate. Thành phần đã ngưng dùng KHÔNG phân giải được (SPEC-11 §13.6 D).
   */
  async listActiveTx(tx: TenantTx, companyId: string): Promise<SalaryComponent[]> {
    return tx
      .select()
      .from(salaryComponents)
      .where(and(SalaryComponentsRepository.live(companyId), eq(salaryComponents.isActive, true)))
      .orderBy(asc(salaryComponents.sortOrder), asc(salaryComponents.code));
  }

  /**
   * S15-PAYROLL-BE-2B — ĐẾM hàng catalog *sống + đang dùng* cho trần `PAYROLL_CATALOG_COMPONENTS_MAX`
   * (SPEC-11 §12.1 mã 034). Predicate ĐÚNG BẰNG `listActiveTx` — trần phải đo CHÍNH tập mà mọi lượt ghi
   * catalog nạp + compile lại, nếu không thì trần chặn một tập, chi phí sinh từ tập khác.
   *
   * `SELECT count(*)` thay vì `listActiveTx().length`: rẻ hơn (không kéo hàng) và không đổi hành vi nhánh
   * `formula` — nhánh đó vẫn cần CHÍNH các hàng để dựng đồ thị nên vẫn gọi `listActiveTx` như cũ.
   */
  async countActiveTx(tx: TenantTx, companyId: string): Promise<number> {
    const [row] = await tx
      .select({ n: count() })
      .from(salaryComponents)
      .where(and(SalaryComponentsRepository.live(companyId), eq(salaryComponents.isActive, true)));
    return Number(row?.n ?? 0);
  }

  async findManyTx(
    tx: TenantTx,
    companyId: string,
    ids: readonly string[],
  ): Promise<SalaryComponent[]> {
    if (ids.length === 0) return [];
    return tx
      .select()
      .from(salaryComponents)
      .where(
        and(SalaryComponentsRepository.live(companyId), inArray(salaryComponents.id, [...ids])),
      );
  }

  async createTx(
    tx: TenantTx,
    companyId: string,
    code: string,
    w: SalaryComponentWrite & { name: string; kind: string; valueType: string },
    actorUserId: string,
  ): Promise<SalaryComponent> {
    const [row] = await tx
      .insert(salaryComponents)
      .values({
        companyId,
        code,
        name: w.name,
        kind: w.kind,
        valueType: w.valueType,
        formula: w.formula ?? null,
        fixedAmount: w.fixedAmount ?? null,
        pitDeductible: w.pitDeductible ?? false,
        // Route KHÔNG BAO GIỜ tạo hàng hệ thống — chỉ seeder (DB-13 §13.4).
        isSystem: false,
        isActive: w.isActive ?? true,
        sortOrder: w.sortOrder ?? 0,
        createdBy: actorUserId,
        updatedBy: actorUserId,
      })
      .returning();
    return row as SalaryComponent;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    w: SalaryComponentWrite,
    actorUserId: string,
  ): Promise<SalaryComponent | null> {
    const [row] = await tx
      .update(salaryComponents)
      .set({
        ...(w.name !== undefined ? { name: w.name } : {}),
        ...(w.kind !== undefined ? { kind: w.kind } : {}),
        ...(w.valueType !== undefined ? { valueType: w.valueType } : {}),
        ...(w.formula !== undefined ? { formula: w.formula } : {}),
        ...(w.fixedAmount !== undefined ? { fixedAmount: w.fixedAmount } : {}),
        ...(w.pitDeductible !== undefined ? { pitDeductible: w.pitDeductible } : {}),
        ...(w.isActive !== undefined ? { isActive: w.isActive } : {}),
        ...(w.sortOrder !== undefined ? { sortOrder: w.sortOrder } : {}),
        updatedBy: actorUserId,
        updatedAt: sql`now()`,
      })
      .where(and(SalaryComponentsRepository.live(companyId), eq(salaryComponents.id, id)))
      .returning();
    return row ?? null;
  }

  /** Xoá MỀM (bất biến #2). Hàng `is_system` bị CHECK `system_not_deletable` chặn ở DB. */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    actorUserId: string,
  ): Promise<SalaryComponent | null> {
    const [row] = await tx
      .update(salaryComponents)
      .set({ deletedAt: sql`now()`, deletedBy: actorUserId, updatedBy: actorUserId })
      .where(and(SalaryComponentsRepository.live(companyId), eq(salaryComponents.id, id)))
      .returning();
    return row ?? null;
  }
}
