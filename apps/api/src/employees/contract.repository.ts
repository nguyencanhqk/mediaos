import { Injectable } from "@nestjs/common";
import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { employeeContracts, type EmployeeContract } from "../db/schema";

/**
 * S2-HR-BE-6 — persistence for `employee_contracts` (DB-03 §7.7). Every method runs INSIDE the caller's
 * tenant tx (`withTenant` → RLS+FORCE); each WHERE also ANDs `company_id` (defense-in-depth, BẤT BIẾN #1).
 * No hard-delete (BẤT BIẾN #2): delete = set deleted_at/deleted_by; default reads filter deleted_at IS NULL.
 */

export interface ContractInsert {
  employeeId: string;
  contractTypeId: string;
  contractCode: string | null;
  title: string | null;
  startDate: string;
  endDate: string | null;
  signedDate: string | null;
  status: string;
  isPrimary: boolean;
  fileId: string | null;
  note: string | null;
}

export interface ContractPatch {
  contractTypeId?: string;
  contractCode?: string | null;
  title?: string | null;
  startDate?: string;
  endDate?: string | null;
  signedDate?: string | null;
  status?: string;
  isPrimary?: boolean;
  fileId?: string | null;
  note?: string | null;
}

export interface ListContractsFilter {
  employeeId?: string;
  status?: string;
  /** Chỉ HĐ Active có end_date ≤ (today + expiringWithinDays). */
  expiringBefore?: string;
  limit: number;
  offset: number;
}

@Injectable()
export class ContractRepository {
  /** List HĐ của tenant (soft-delete filtered), newest start_date first. */
  async listTx(
    tx: TenantTx,
    companyId: string,
    filter: ListContractsFilter,
  ): Promise<EmployeeContract[]> {
    return tx
      .select()
      .from(employeeContracts)
      .where(this.listWhere(companyId, filter))
      .orderBy(desc(employeeContracts.startDate))
      .limit(filter.limit)
      .offset(filter.offset);
  }

  async countTx(tx: TenantTx, companyId: string, filter: ListContractsFilter): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(employeeContracts)
      .where(this.listWhere(companyId, filter));
    return row?.n ?? 0;
  }

  private listWhere(companyId: string, filter: ListContractsFilter) {
    const conds = [eq(employeeContracts.companyId, companyId), isNull(employeeContracts.deletedAt)];
    if (filter.employeeId) conds.push(eq(employeeContracts.employeeId, filter.employeeId));
    if (filter.status) conds.push(eq(employeeContracts.status, filter.status));
    if (filter.expiringBefore) {
      conds.push(eq(employeeContracts.status, "Active"));
      conds.push(gte(employeeContracts.endDate, sql`CURRENT_DATE`));
      conds.push(lte(employeeContracts.endDate, filter.expiringBefore));
    }
    return and(...conds);
  }

  async findByIdTx(
    tx: TenantTx,
    companyId: string,
    id: string,
  ): Promise<EmployeeContract | undefined> {
    const [row] = await tx
      .select()
      .from(employeeContracts)
      .where(
        and(
          eq(employeeContracts.id, id),
          eq(employeeContracts.companyId, companyId),
          isNull(employeeContracts.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async insertTx(
    tx: TenantTx,
    companyId: string,
    createdBy: string,
    data: ContractInsert,
  ): Promise<EmployeeContract | undefined> {
    const [row] = await tx
      .insert(employeeContracts)
      .values({ companyId, createdBy, updatedBy: createdBy, ...data })
      .returning();
    return row;
  }

  async updateTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    updatedBy: string,
    patch: ContractPatch,
  ): Promise<EmployeeContract | undefined> {
    const values: Record<string, unknown> = { updatedAt: new Date(), updatedBy };
    const keys: (keyof ContractPatch)[] = [
      "contractTypeId",
      "contractCode",
      "title",
      "startDate",
      "endDate",
      "signedDate",
      "status",
      "isPrimary",
      "fileId",
      "note",
    ];
    for (const k of keys) {
      if (patch[k] !== undefined) values[k] = patch[k];
    }

    const [row] = await tx
      .update(employeeContracts)
      .set(values)
      .where(
        and(
          eq(employeeContracts.id, id),
          eq(employeeContracts.companyId, companyId),
          isNull(employeeContracts.deletedAt),
        ),
      )
      .returning();
    return row;
  }

  /** Set file_id (link/unlink primary contract file). */
  async setFileTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    updatedBy: string,
    fileId: string | null,
  ): Promise<EmployeeContract | undefined> {
    const [row] = await tx
      .update(employeeContracts)
      .set({ fileId, updatedAt: new Date(), updatedBy })
      .where(
        and(
          eq(employeeContracts.id, id),
          eq(employeeContracts.companyId, companyId),
          isNull(employeeContracts.deletedAt),
        ),
      )
      .returning();
    return row;
  }

  /** Soft-delete (BẤT BIẾN #2 — KHÔNG hard-delete). Returns affected count. */
  async softDeleteTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    deletedBy: string,
  ): Promise<number> {
    const rows = await tx
      .update(employeeContracts)
      .set({ deletedAt: new Date(), deletedBy, updatedAt: new Date(), updatedBy: deletedBy })
      .where(
        and(
          eq(employeeContracts.id, id),
          eq(employeeContracts.companyId, companyId),
          isNull(employeeContracts.deletedAt),
        ),
      )
      .returning({ id: employeeContracts.id });
    return rows.length;
  }
}
