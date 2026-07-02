import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import { employeeCodeConfigs, type EmployeeCodeConfig } from "../db/schema";

/**
 * S2-HR-BE-7 — persistence for `employee_code_configs` (DB-03 §4.8). Every method runs INSIDE the
 * caller's tenant tx (`withTenant` → RLS+FORCE); each WHERE also ANDs `company_id` (defense-in-depth,
 * BẤT BIẾN #1). No hard-delete (BẤT BIẾN #2): the partial-unique index keeps ≤1 non-deleted row/company,
 * so we read/write that single active row. This surface NEVER touches the running counter — padding/
 * reset_policy/current_value live in `sequence_counters` (S1-FND-SEQ-1).
 */

export interface EmployeeCodeConfigPatch {
  prefix?: string | null;
  pattern?: string | null;
  numberLength?: number;
  allowManualOverride?: boolean;
  status?: string;
}

export interface EmployeeCodeConfigInsert {
  prefix: string | null;
  pattern: string | null;
  numberLength: number;
  allowManualOverride: boolean;
  status: string;
}

@Injectable()
export class EmployeeCodeConfigRepository {
  /** The single non-deleted config row for the tenant (there is at most one — partial-unique index). */
  async findConfigTx(tx: TenantTx, companyId: string): Promise<EmployeeCodeConfig | undefined> {
    const [row] = await tx
      .select()
      .from(employeeCodeConfigs)
      .where(
        and(eq(employeeCodeConfigs.companyId, companyId), isNull(employeeCodeConfigs.deletedAt)),
      )
      .limit(1);
    return row;
  }

  /** Insert the tenant's config row (first PATCH when none exists yet). */
  async insertConfigTx(
    tx: TenantTx,
    companyId: string,
    data: EmployeeCodeConfigInsert,
  ): Promise<EmployeeCodeConfig | undefined> {
    const [row] = await tx
      .insert(employeeCodeConfigs)
      .values({ companyId, ...data })
      .returning();
    return row;
  }

  /** Update the config row in-tenant. CONFIG fields ONLY — never a counter/current_value column. */
  async updateConfigTx(
    tx: TenantTx,
    companyId: string,
    id: string,
    patch: EmployeeCodeConfigPatch,
  ): Promise<EmployeeCodeConfig | undefined> {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.prefix !== undefined) values["prefix"] = patch.prefix;
    if (patch.pattern !== undefined) values["pattern"] = patch.pattern;
    if (patch.numberLength !== undefined) values["numberLength"] = patch.numberLength;
    if (patch.allowManualOverride !== undefined) {
      values["allowManualOverride"] = patch.allowManualOverride;
    }
    if (patch.status !== undefined) values["status"] = patch.status;

    const [row] = await tx
      .update(employeeCodeConfigs)
      .set(values)
      .where(
        and(
          eq(employeeCodeConfigs.id, id),
          eq(employeeCodeConfigs.companyId, companyId),
          isNull(employeeCodeConfigs.deletedAt),
        ),
      )
      .returning();
    return row;
  }
}
