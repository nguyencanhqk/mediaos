import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  type ProvisionResultDto,
  type TemplateBlueprint,
  templateBlueprintSchema,
} from "@mediaos/contracts";
import { DatabaseService, type TenantTx } from "../db/db.service";
import { AuditService } from "../events/audit.service";
import { TemplateRepository } from "./template.repository";

/**
 * TemplateCloneService (G16-3, CROWN — Done-criterion "clone template được cho công ty khác").
 *
 * Provision per-company từ blueprint (roles + role_permissions + workflow_definition(+steps+transitions)
 * + dashboard_configs) TRONG 1 transaction withTenant(targetCompanyId) ⇒ ATOMIC (lỗi bất kỳ → rollback,
 * KHÔNG để lại trạng thái nửa vời). IDEMPOTENT per-row (skip nếu đã tồn tại) ⇒ re-apply an toàn.
 * Audit dưới object_type 'company' (action 'TemplateApplied') cùng tx.
 *
 * Roles tham chiếu permission qua catalog toàn cục; workflow steps tham chiếu role qua CODE (soft-ref)
 * ⇒ clone KHÔNG cần remap id. Blueprint validate bằng templateBlueprintSchema (fail-loud nếu hỏng).
 */
@Injectable()
export class TemplateCloneService {
  private readonly logger = new Logger(TemplateCloneService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TemplateRepository,
    private readonly audit: AuditService,
  ) {}

  /** Endpoint đứng riêng: mở withTenant(target) rồi provision. */
  async applyTemplate(
    targetCompanyId: string,
    templateCode: string,
    actorUserId: string | null,
  ): Promise<ProvisionResultDto> {
    return this.db.withTenant(targetCompanyId, (tx) =>
      this.provisionInTx(tx, targetCompanyId, templateCode, actorUserId),
    );
  }

  /**
   * Provision TRONG tx đã có (caller đang ở withTenant(targetCompanyId)) — dùng bởi createCompany để
   * tạo công ty + provision + set plan + audit CÙNG 1 tx. KHÔNG tự mở tx mới (tránh nested withTenant).
   */
  async provisionInTx(
    tx: TenantTx,
    companyId: string,
    templateCode: string,
    actorUserId: string | null,
  ): Promise<ProvisionResultDto> {
    const template = await this.repo.findTemplateByCode(tx, templateCode);
    if (!template) {
      throw new NotFoundException(`Template not found: ${templateCode}`);
    }

    const blueprint = this.parseBlueprint(template.code, template.blueprintJson);

    let rolesCreated = 0;
    let workflowsCreated = 0;
    let dashboardsCreated = 0;

    // ── roles + role_permissions ──────────────────────────────────────────────
    for (const role of blueprint.roles) {
      const existing = await this.repo.findCompanyRoleByName(tx, companyId, role.code);
      let roleId: string;
      if (existing) {
        roleId = existing.id;
      } else {
        const inserted = await this.repo.insertCompanyRole(tx, {
          companyId,
          name: role.code,
          description: role.name,
          requiresTwoFactor: role.requiresTwoFactor,
        });
        roleId = inserted.id;
        rolesCreated += 1;
      }
      // Upsert permissions (ON CONFLICT DO NOTHING) — repair cả role đã tồn tại từ apply trước dở dang.
      for (const perm of role.permissions) {
        const permissionId = await this.repo.findPermissionId(tx, perm.action, perm.resourceType);
        if (!permissionId) {
          // Blueprint tham chiếu permission KHÔNG có trong catalog → fail-loud (KHÔNG bỏ qua âm thầm).
          throw new BadRequestException(
            `Template '${templateCode}' references unknown permission: ${perm.action}:${perm.resourceType}`,
          );
        }
        await this.repo.insertRolePermissionAllow(tx, roleId, permissionId);
      }
    }

    // ── workflows (+ steps + transitions) ─────────────────────────────────────
    for (const wf of blueprint.workflows) {
      const existing = await this.repo.findWorkflowDefByCode(tx, companyId, wf.code);
      if (existing) {
        continue; // đã có định nghĩa cùng code → KHÔNG tạo lại (tránh nhân đôi step/transition).
      }
      const def = await this.repo.insertWorkflowDef(tx, {
        companyId,
        code: wf.code,
        name: wf.name,
        appliesTo: wf.appliesTo,
        maxApprovalLevel: wf.maxApprovalLevel,
        allowParallelSteps: wf.allowParallelSteps,
        createdBy: actorUserId,
      });
      for (const step of wf.steps) {
        await this.repo.insertWorkflowStep(tx, {
          companyId,
          workflowDefinitionId: def.id,
          stepOrder: step.stepOrder,
          code: step.code,
          name: step.name,
          assigneeRoleCode: step.assigneeRoleCode ?? null,
          reviewerRoleCode: step.reviewerRoleCode ?? null,
          isRequired: step.isRequired,
          defaultTaskTitle: step.defaultTaskTitle,
          nodeKey: step.nodeKey,
          stepType: step.stepType,
        });
      }
      for (const tr of wf.transitions) {
        await this.repo.insertStepTransition(tx, {
          companyId,
          workflowDefinitionId: def.id,
          fromState: tr.fromState,
          event: tr.event,
          toState: tr.toState,
          appliesToStepCode: tr.appliesToStepCode ?? null,
        });
      }
      workflowsCreated += 1;
    }

    // ── dashboards ────────────────────────────────────────────────────────────
    for (const dash of blueprint.dashboards) {
      const existing = await this.repo.findDashboardConfig(tx, companyId, dash.roleCode);
      if (existing) {
        continue;
      }
      await this.repo.insertDashboardConfig(tx, {
        companyId,
        roleCode: dash.roleCode,
        layoutJson: dash.layout,
      });
      dashboardsCreated += 1;
    }

    const alreadyProvisioned =
      rolesCreated === 0 && workflowsCreated === 0 && dashboardsCreated === 0;

    await this.audit.record(tx, {
      action: "TemplateApplied",
      objectType: "company",
      objectId: companyId,
      actorUserId: actorUserId ?? undefined,
      after: { templateCode, rolesCreated, workflowsCreated, dashboardsCreated, alreadyProvisioned },
    });

    return {
      companyId,
      templateCode,
      rolesCreated,
      workflowsCreated,
      dashboardsCreated,
      alreadyProvisioned,
    };
  }

  /** Validate blueprint server-data. Hỏng = lỗi cấu hình nghiêm trọng → fail-loud (KHÔNG provision dở). */
  private parseBlueprint(code: string, raw: unknown): TemplateBlueprint {
    const parsed = templateBlueprintSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(`Template '${code}' has an invalid blueprint`, {
        issues: parsed.error.issues,
      });
      throw new BadRequestException(`Template '${code}' has an invalid blueprint`);
    }
    return parsed.data;
  }
}
