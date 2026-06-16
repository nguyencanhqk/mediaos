import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { type TenantTx } from "../db/db.service";
import {
  dashboardConfigs,
  permissions,
  rolePermissions,
  roles,
  stepTransitions,
  workflowDefinitions,
  workflowDefinitionSteps,
  workspaceTemplates,
} from "../db/schema";

/**
 * TemplateRepository (G16-3) — đọc catalog template + ghi per-company rows khi clone.
 * Mọi method nhận `tx` (TenantTx). Ghi per-company (roles/workflow/dashboard) PHẢI trong withTenant(target)
 * để RLS WITH CHECK (company_id = current) cho qua. workspace_templates/permissions là catalog toàn cục
 * (no RLS) nên đọc được trong bất kỳ tx.
 */
@Injectable()
export class TemplateRepository {
  // ── catalog (đọc) ───────────────────────────────────────────────────────────

  async findTemplateByCode(
    tx: TenantTx,
    code: string,
  ): Promise<typeof workspaceTemplates.$inferSelect | undefined> {
    const [row] = await tx
      .select()
      .from(workspaceTemplates)
      .where(and(eq(workspaceTemplates.code, code), isNull(workspaceTemplates.deletedAt)))
      .limit(1);
    return row;
  }

  async listTemplates(tx: TenantTx): Promise<(typeof workspaceTemplates.$inferSelect)[]> {
    return tx
      .select()
      .from(workspaceTemplates)
      .where(isNull(workspaceTemplates.deletedAt));
  }

  async findPermissionId(
    tx: TenantTx,
    action: string,
    resourceType: string,
  ): Promise<string | undefined> {
    const [row] = await tx
      .select({ id: permissions.id })
      .from(permissions)
      .where(and(eq(permissions.action, action), eq(permissions.resourceType, resourceType)))
      .limit(1);
    return row?.id;
  }

  // ── roles (clone đích) ───────────────────────────────────────────────────────

  /** Role công ty đích theo name (RLS lọc company_id) — chưa soft-delete. */
  async findCompanyRoleByName(
    tx: TenantTx,
    companyId: string,
    name: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(
        and(eq(roles.companyId, companyId), eq(roles.name, name), isNull(roles.deletedAt)),
      )
      .limit(1);
    return row;
  }

  async insertCompanyRole(
    tx: TenantTx,
    data: { companyId: string; name: string; description: string | null; requiresTwoFactor: boolean },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(roles)
      .values({
        companyId: data.companyId,
        name: data.name,
        description: data.description,
        isSystem: false,
        requiresTwoFactor: data.requiresTwoFactor,
      })
      .returning({ id: roles.id });
    if (!row) throw new Error("insertCompanyRole returned no row");
    return row;
  }

  /** Gán permission cho role; ON CONFLICT DO NOTHING (unique role_id,permission_id,effect). */
  async insertRolePermissionAllow(
    tx: TenantTx,
    roleId: string,
    permissionId: string,
  ): Promise<void> {
    await tx
      .insert(rolePermissions)
      .values({ roleId, permissionId, effect: "ALLOW" })
      .onConflictDoNothing();
  }

  // ── workflow (clone đích) ────────────────────────────────────────────────────

  async findWorkflowDefByCode(
    tx: TenantTx,
    companyId: string,
    code: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: workflowDefinitions.id })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.companyId, companyId),
          eq(workflowDefinitions.code, code),
          isNull(workflowDefinitions.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async insertWorkflowDef(
    tx: TenantTx,
    data: {
      companyId: string;
      code: string;
      name: string;
      appliesTo: string;
      maxApprovalLevel: number;
      allowParallelSteps: boolean;
      createdBy: string | null;
    },
  ): Promise<{ id: string }> {
    const [row] = await tx
      .insert(workflowDefinitions)
      .values({
        companyId: data.companyId,
        code: data.code,
        name: data.name,
        appliesTo: data.appliesTo,
        maxApprovalLevel: data.maxApprovalLevel,
        allowParallelSteps: data.allowParallelSteps,
        isActive: true,
        version: 1,
        status: "published",
        publishedAt: new Date(),
        createdBy: data.createdBy,
      })
      .returning({ id: workflowDefinitions.id });
    if (!row) throw new Error("insertWorkflowDef returned no row");
    return row;
  }

  async insertWorkflowStep(
    tx: TenantTx,
    data: {
      companyId: string;
      workflowDefinitionId: string;
      stepOrder: number;
      code: string;
      name: string;
      assigneeRoleCode: string | null;
      reviewerRoleCode: string | null;
      isRequired: boolean;
      defaultTaskTitle: string;
      nodeKey: string;
      stepType: string;
    },
  ): Promise<void> {
    await tx.insert(workflowDefinitionSteps).values({
      companyId: data.companyId,
      workflowDefinitionId: data.workflowDefinitionId,
      stepOrder: data.stepOrder,
      code: data.code,
      name: data.name,
      assigneeRoleCode: data.assigneeRoleCode,
      reviewerRoleCode: data.reviewerRoleCode,
      isRequired: data.isRequired,
      defaultTaskTitle: data.defaultTaskTitle,
      nodeKey: data.nodeKey,
      stepType: data.stepType,
      requiresEvaluation: false,
    });
  }

  async insertStepTransition(
    tx: TenantTx,
    data: {
      companyId: string;
      workflowDefinitionId: string;
      fromState: string;
      event: string;
      toState: string;
      appliesToStepCode: string | null;
    },
  ): Promise<void> {
    await tx.insert(stepTransitions).values({
      companyId: data.companyId,
      workflowDefinitionId: data.workflowDefinitionId,
      fromState: data.fromState,
      event: data.event,
      toState: data.toState,
      appliesToStepCode: data.appliesToStepCode,
      writtenBy: "template-clone",
    });
  }

  // ── dashboard (clone đích) ───────────────────────────────────────────────────

  async findDashboardConfig(
    tx: TenantTx,
    companyId: string,
    roleCode: string,
  ): Promise<{ id: string } | undefined> {
    const [row] = await tx
      .select({ id: dashboardConfigs.id })
      .from(dashboardConfigs)
      .where(
        and(
          eq(dashboardConfigs.companyId, companyId),
          eq(dashboardConfigs.roleCode, roleCode),
          isNull(dashboardConfigs.deletedAt),
        ),
      )
      .limit(1);
    return row;
  }

  async insertDashboardConfig(
    tx: TenantTx,
    data: { companyId: string; roleCode: string; layoutJson: unknown },
  ): Promise<void> {
    await tx.insert(dashboardConfigs).values({
      companyId: data.companyId,
      roleCode: data.roleCode,
      layoutJson: data.layoutJson,
    });
  }
}
