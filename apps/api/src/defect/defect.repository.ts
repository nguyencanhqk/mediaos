import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { TenantTx } from "../db/db.service";
import { DatabaseService } from "../db/db.service";
import { defects, workflowSteps } from "../db/schema";
import type { DefectTypeDto } from "@mediaos/contracts";

export interface CreateDefectData {
  workflowStepId: string;
  causedByApprovalStepId: string | null;
  responsibleUserId: string | null;
  defectType: DefectTypeDto;
  description: string;
  revisionTaskId: string | null;
}

@Injectable()
export class DefectRepository {
  constructor(private readonly db: DatabaseService) {}

  /** Verify the step belongs to the tenant (cross-tenant FK guard, in-tx). */
  async findStepInTenant(tx: TenantTx, companyId: string, stepId: string) {
    const [row] = await tx
      .select({ id: workflowSteps.id, companyId: workflowSteps.companyId })
      .from(workflowSteps)
      .where(and(eq(workflowSteps.companyId, companyId), eq(workflowSteps.id, stepId)))
      .limit(1);
    return row;
  }

  /** Append-only INSERT — no update/delete methods on this repository (BẤT BIẾN #2). */
  insertDefect(companyId: string, data: CreateDefectData, tx: TenantTx) {
    return tx
      .insert(defects)
      .values({
        companyId,
        workflowStepId: data.workflowStepId,
        causedByApprovalStepId: data.causedByApprovalStepId,
        responsibleUserId: data.responsibleUserId,
        // defectType and revisionTaskId columns added by migration 0086
        // Drizzle will ignore unknown columns at type-level until migration runs;
        // cast via spread to allow extra fields without TS error.
        ...({ defect_type: data.defectType, revision_task_id: data.revisionTaskId } as Record<
          string,
          unknown
        >),
        description: data.description,
      })
      .returning();
  }

  /** List defects for a step, scoped to tenant. */
  listByStep(tx: TenantTx, companyId: string, stepId: string) {
    return tx
      .select()
      .from(defects)
      .where(and(eq(defects.companyId, companyId), eq(defects.workflowStepId, stepId)))
      .orderBy(defects.createdAt);
  }
}
