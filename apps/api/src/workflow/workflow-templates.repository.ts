import { Injectable } from "@nestjs/common";
import { and, eq, isNull, max } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import type { TenantTx } from "../db/db.service";
import {
  checklists,
  workflowDefinitionSteps,
  workflowDefinitions,
  workflowStepDependencies,
} from "../db/schema";

/**
 * WorkflowTemplatesRepository (G7-1c) — DB access cho aggregate template.
 * BẤT BIẾN #1: mọi query lọc company_id TƯỜNG MINH + chạy trong withTenant(companyId) (RLS ép ở DB —
 * predicate company_id là defense-in-depth, không dựa RLS một mình). Mutation nhận `tx` để cùng
 * transaction với audit. Detail reads cũng nhận `tx` (1 snapshot — không non-repeatable read đa connection).
 */
@Injectable()
export class WorkflowTemplatesRepository {
  constructor(private readonly db: DatabaseService) {}

  // ─── Template (workflow_definitions) ────────────────────────────────────────

  createTemplate(
    companyId: string,
    data: { code: string; name: string; appliesTo: string; createdBy: string },
    tx: TenantTx,
  ) {
    return tx
      .insert(workflowDefinitions)
      .values({
        companyId,
        code: data.code,
        name: data.name,
        appliesTo: data.appliesTo,
        createdBy: data.createdBy,
        version: 1,
        status: "draft",
        isActive: true,
      })
      .returning();
  }

  findByIdInTx(companyId: string, id: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.companyId, companyId),
          eq(workflowDefinitions.id, id),
          isNull(workflowDefinitions.deletedAt),
        ),
      )
      .limit(1);
  }

  list(companyId: string) {
    return this.db.withTenant(companyId, (tx) =>
      tx
        .select()
        .from(workflowDefinitions)
        .where(
          and(
            eq(workflowDefinitions.companyId, companyId),
            isNull(workflowDefinitions.deletedAt),
          ),
        )
        .orderBy(workflowDefinitions.code, workflowDefinitions.version),
    );
  }

  // Mutation filter gồm `deleted_at IS NULL` → atomic ở DB (chống TOCTOU mutate row đã soft-delete,
  // không dựa vào read-trước-write của service). 0 row affected → service ném lỗi (returning() rỗng).
  updateName(companyId: string, id: string, name: string, tx: TenantTx) {
    return tx
      .update(workflowDefinitions)
      .set({ name })
      .where(
        and(
          eq(workflowDefinitions.companyId, companyId),
          eq(workflowDefinitions.id, id),
          isNull(workflowDefinitions.deletedAt),
        ),
      )
      .returning();
  }

  softDelete(companyId: string, id: string, tx: TenantTx) {
    return tx
      .update(workflowDefinitions)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(workflowDefinitions.companyId, companyId),
          eq(workflowDefinitions.id, id),
          isNull(workflowDefinitions.deletedAt),
        ),
      )
      .returning();
  }

  // ─── Detail child reads (InTx — cùng withTenant của getTemplateDetail) ───────

  findStepsInTx(companyId: string, templateId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowDefinitionSteps)
      .where(
        and(
          eq(workflowDefinitionSteps.companyId, companyId),
          eq(workflowDefinitionSteps.workflowDefinitionId, templateId),
        ),
      )
      .orderBy(workflowDefinitionSteps.stepOrder);
  }

  findDependenciesInTx(companyId: string, templateId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowStepDependencies)
      .where(
        and(
          eq(workflowStepDependencies.companyId, companyId),
          eq(workflowStepDependencies.workflowDefinitionId, templateId),
        ),
      )
      .orderBy(workflowStepDependencies.fromStepId, workflowStepDependencies.toStepId);
  }

  /** Checklists gắn step thuộc template. Lọc company_id ở CẢ hai bảng (defense-in-depth, không dựa RLS). */
  findChecklistsInTx(companyId: string, templateId: string, tx: TenantTx) {
    return tx
      .select({
        id: checklists.id,
        companyId: checklists.companyId,
        name: checklists.name,
        workflowDefinitionStepId: checklists.workflowDefinitionStepId,
        createdAt: checklists.createdAt,
      })
      .from(checklists)
      .innerJoin(
        workflowDefinitionSteps,
        eq(checklists.workflowDefinitionStepId, workflowDefinitionSteps.id),
      )
      .where(
        and(
          eq(checklists.companyId, companyId),
          eq(workflowDefinitionSteps.companyId, companyId),
          eq(workflowDefinitionSteps.workflowDefinitionId, templateId),
        ),
      );
  }

  // ─── Template steps (workflow_definition_steps) — 1c-ii ──────────────────────

  createStep(
    companyId: string,
    data: {
      templateId: string;
      nodeKey: string;
      code: string;
      name: string;
      defaultTaskTitle: string;
      stepType: string;
      assigneeRoleCode: string | null;
      reviewerRoleCode: string | null;
      isRequired: boolean;
      stepOrder: number;
      positionX: number | null;
      positionY: number | null;
    },
    tx: TenantTx,
  ) {
    return tx
      .insert(workflowDefinitionSteps)
      .values({
        companyId,
        workflowDefinitionId: data.templateId,
        nodeKey: data.nodeKey,
        code: data.code,
        name: data.name,
        defaultTaskTitle: data.defaultTaskTitle,
        stepType: data.stepType,
        assigneeRoleCode: data.assigneeRoleCode,
        reviewerRoleCode: data.reviewerRoleCode,
        isRequired: data.isRequired,
        stepOrder: data.stepOrder,
        positionX: data.positionX,
        positionY: data.positionY,
      })
      .returning();
  }

  /** Lấy step thuộc ĐÚNG template + tenant (scope chống đổi step của template/tenant khác). */
  findStepByIdInTx(companyId: string, templateId: string, stepId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowDefinitionSteps)
      .where(
        and(
          eq(workflowDefinitionSteps.companyId, companyId),
          eq(workflowDefinitionSteps.workflowDefinitionId, templateId),
          eq(workflowDefinitionSteps.id, stepId),
        ),
      )
      .limit(1);
  }

  updateStep(companyId: string, stepId: string, fields: StepUpdateFields, tx: TenantTx) {
    return tx
      .update(workflowDefinitionSteps)
      .set(fields)
      .where(
        and(
          eq(workflowDefinitionSteps.companyId, companyId),
          eq(workflowDefinitionSteps.id, stepId),
        ),
      )
      .returning();
  }

  // Hard-delete (draft-only, ép ở service): schema con không có deleted_at (1b frozen) → config draft
  // hard-delete được; FK cascade workflow_step_dependencies, SET NULL checklists.workflow_definition_step_id.
  deleteStep(companyId: string, stepId: string, tx: TenantTx) {
    return tx
      .delete(workflowDefinitionSteps)
      .where(
        and(
          eq(workflowDefinitionSteps.companyId, companyId),
          eq(workflowDefinitionSteps.id, stepId),
        ),
      )
      .returning();
  }

  maxStepOrderInTx(companyId: string, templateId: string, tx: TenantTx) {
    return tx
      .select({ maxOrder: max(workflowDefinitionSteps.stepOrder) })
      .from(workflowDefinitionSteps)
      .where(
        and(
          eq(workflowDefinitionSteps.companyId, companyId),
          eq(workflowDefinitionSteps.workflowDefinitionId, templateId),
        ),
      );
  }

  // ─── Step dependencies (workflow_step_dependencies) — 1c-iii ─────────────────

  createDependency(
    companyId: string,
    data: { templateId: string; fromStepId: string; toStepId: string; dependencyType: string },
    tx: TenantTx,
  ) {
    return tx
      .insert(workflowStepDependencies)
      .values({
        companyId,
        workflowDefinitionId: data.templateId,
        fromStepId: data.fromStepId,
        toStepId: data.toStepId,
        dependencyType: data.dependencyType,
      })
      .returning();
  }

  findDependencyByIdInTx(companyId: string, templateId: string, depId: string, tx: TenantTx) {
    return tx
      .select()
      .from(workflowStepDependencies)
      .where(
        and(
          eq(workflowStepDependencies.companyId, companyId),
          eq(workflowStepDependencies.workflowDefinitionId, templateId),
          eq(workflowStepDependencies.id, depId),
        ),
      )
      .limit(1);
  }

  // Hard-delete edge (draft-only, ép ở service). Edge không có deleted_at (1b frozen).
  // Scope đủ (company, template, id) — self-defending, không dựa vào find trước đó.
  deleteDependency(companyId: string, templateId: string, depId: string, tx: TenantTx) {
    return tx
      .delete(workflowStepDependencies)
      .where(
        and(
          eq(workflowStepDependencies.companyId, companyId),
          eq(workflowStepDependencies.workflowDefinitionId, templateId),
          eq(workflowStepDependencies.id, depId),
        ),
      )
      .returning();
  }
}

/** Field set cho updateStep — nodeKey BẤT BIẾN (không nằm ở đây). null = clear cột nullable. */
export type StepUpdateFields = Partial<{
  code: string;
  name: string;
  defaultTaskTitle: string;
  stepType: string;
  assigneeRoleCode: string | null;
  reviewerRoleCode: string | null;
  isRequired: boolean;
  stepOrder: number;
  positionX: number | null;
  positionY: number | null;
}>;
