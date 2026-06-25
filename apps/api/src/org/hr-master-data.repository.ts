import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { contractTypes, jobLevels } from "../db/schema";

/**
 * S2-HR-BE-3 — HR master data repository (job_levels + contract_types).
 * BẤT BIẾN #1: company_id ở mọi query via withTenant.
 * BẤT BIẾN #2: soft-delete (deleted_at) — KHÔNG hard-delete.
 */
@Injectable()
export class HrMasterDataRepository {
  constructor(private readonly db: DatabaseService) {}

  private run<T>(companyId: string, fn: (tx: TenantTx) => Promise<T>, tx?: TenantTx): Promise<T> {
    return tx ? fn(tx) : this.db.withTenant(companyId, fn);
  }

  // ── Job Levels ────────────────────────────────────────────────────────────────

  listJobLevels(companyId: string, status?: string) {
    return this.db.withTenant(companyId, (tx) => {
      const base = and(eq(jobLevels.companyId, companyId), isNull(jobLevels.deletedAt));
      const where = status ? and(base, eq(jobLevels.status, status)) : base;
      return tx
        .select({
          id: jobLevels.id,
          companyId: jobLevels.companyId,
          code: jobLevels.code,
          name: jobLevels.name,
          rankOrder: jobLevels.rankOrder,
          status: jobLevels.status,
          createdAt: jobLevels.createdAt,
          updatedAt: jobLevels.updatedAt,
        })
        .from(jobLevels)
        .where(where)
        .orderBy(jobLevels.rankOrder, jobLevels.name);
    });
  }

  findJobLevelById(companyId: string, id: string, tx?: TenantTx) {
    return this.run(
      companyId,
      (t) =>
        t
          .select({
            id: jobLevels.id,
            companyId: jobLevels.companyId,
            code: jobLevels.code,
            name: jobLevels.name,
            rankOrder: jobLevels.rankOrder,
            status: jobLevels.status,
            createdAt: jobLevels.createdAt,
            updatedAt: jobLevels.updatedAt,
          })
          .from(jobLevels)
          .where(
            and(
              eq(jobLevels.companyId, companyId),
              eq(jobLevels.id, id),
              isNull(jobLevels.deletedAt),
            ),
          )
          .limit(1),
      tx,
    );
  }

  createJobLevel(
    companyId: string,
    data: { code: string; name: string; rankOrder?: number | null },
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .insert(jobLevels)
          .values({
            companyId,
            code: data.code,
            name: data.name,
            rankOrder: data.rankOrder ?? null,
          })
          .returning(),
      tx,
    );
  }

  updateJobLevel(
    companyId: string,
    id: string,
    data: Partial<{ code: string; name: string; rankOrder: number | null; status: string }>,
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .update(jobLevels)
          .set({ ...data, updatedAt: new Date() })
          .where(
            and(
              eq(jobLevels.companyId, companyId),
              eq(jobLevels.id, id),
              isNull(jobLevels.deletedAt),
            ),
          )
          .returning(),
      tx,
    );
  }

  softDeleteJobLevel(companyId: string, id: string, tx?: TenantTx) {
    return this.run(
      companyId,
      (t) =>
        t
          .update(jobLevels)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(jobLevels.companyId, companyId),
              eq(jobLevels.id, id),
              isNull(jobLevels.deletedAt),
            ),
          )
          .returning(),
      tx,
    );
  }

  // ── Contract Types ────────────────────────────────────────────────────────────

  listContractTypes(companyId: string, status?: string) {
    return this.db.withTenant(companyId, (tx) => {
      const base = and(eq(contractTypes.companyId, companyId), isNull(contractTypes.deletedAt));
      const where = status ? and(base, eq(contractTypes.status, status)) : base;
      return tx
        .select({
          id: contractTypes.id,
          companyId: contractTypes.companyId,
          code: contractTypes.code,
          name: contractTypes.name,
          requiresEndDate: contractTypes.requiresEndDate,
          status: contractTypes.status,
          createdAt: contractTypes.createdAt,
          updatedAt: contractTypes.updatedAt,
        })
        .from(contractTypes)
        .where(where)
        .orderBy(contractTypes.name);
    });
  }

  findContractTypeById(companyId: string, id: string, tx?: TenantTx) {
    return this.run(
      companyId,
      (t) =>
        t
          .select({
            id: contractTypes.id,
            companyId: contractTypes.companyId,
            code: contractTypes.code,
            name: contractTypes.name,
            requiresEndDate: contractTypes.requiresEndDate,
            status: contractTypes.status,
            createdAt: contractTypes.createdAt,
            updatedAt: contractTypes.updatedAt,
          })
          .from(contractTypes)
          .where(
            and(
              eq(contractTypes.companyId, companyId),
              eq(contractTypes.id, id),
              isNull(contractTypes.deletedAt),
            ),
          )
          .limit(1),
      tx,
    );
  }

  createContractType(
    companyId: string,
    data: { code: string; name: string; requiresEndDate: boolean },
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .insert(contractTypes)
          .values({
            companyId,
            code: data.code,
            name: data.name,
            requiresEndDate: data.requiresEndDate,
          })
          .returning(),
      tx,
    );
  }

  updateContractType(
    companyId: string,
    id: string,
    data: Partial<{
      code: string;
      name: string;
      requiresEndDate: boolean;
      status: string;
    }>,
    tx?: TenantTx,
  ) {
    return this.run(
      companyId,
      (t) =>
        t
          .update(contractTypes)
          .set({ ...data, updatedAt: new Date() })
          .where(
            and(
              eq(contractTypes.companyId, companyId),
              eq(contractTypes.id, id),
              isNull(contractTypes.deletedAt),
            ),
          )
          .returning(),
      tx,
    );
  }

  softDeleteContractType(companyId: string, id: string, tx?: TenantTx) {
    return this.run(
      companyId,
      (t) =>
        t
          .update(contractTypes)
          .set({ deletedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(contractTypes.companyId, companyId),
              eq(contractTypes.id, id),
              isNull(contractTypes.deletedAt),
            ),
          )
          .returning(),
      tx,
    );
  }
}
