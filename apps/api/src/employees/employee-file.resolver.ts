/**
 * S2-HR-EMPFILE-1 — EmployeeFileResolver.
 *
 * Spec: BACKEND-04 §11.4 (FileOwnerPermissionResolver) · BACKEND-11 §11.10 (dispatch by
 * module_code/entity_type). Registers the (module='HR', entity_type='employee_profile') pair into the
 * shared singleton FilePolicyService so employee-file link rows no longer fail-closed to
 * 'deny-no-resolver'. It mirrors the employee-file authorization exactly:
 *
 *   • VIEW / DOWNLOAD → resolve the strongest data_scope for ('file-view','employee'), then isEmployeeInScope
 *     on the owning employee_profile (entityId = employeeId). resolveAndAssert throws ForbiddenException when
 *     the caller has NO file-view grant — the policy layer catches that and maps it to a fail-closed
 *     deny-error (never a false-allow). Cross-tenant / not-found / out-of-scope ⇒ false ⇒ deny-resolver.
 *   • LINK   → same shape but the ('file-upload','employee') pair.
 *   • DELETE / UNLINK → same shape but the ('file-delete','employee') pair.
 *
 * The pairs are DISTINCT from the HrContractFileResolver (view/manage:contract) — employee documents and
 * employment contracts have separate gates. The resolver receives ONLY permission metadata
 * (FilePermissionInput) — never storage_path / checksum / binary (BẤT BIẾN #2.3). Registration into the
 * shared FilePolicyService happens additively in EmployeesModule.onModuleInit.
 */

import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { EMPLOYEE_ENTITY, HR_MODULE, EmployeeFileRepository } from "./employee-file.repository";

/** resourceType for every employee-file data_scope resolution (matches seed mig 0477). */
const EMPLOYEE_RESOURCE = "employee";
const ACTION_VIEW = "file-view";
const ACTION_UPLOAD = "file-upload";
const ACTION_DELETE = "file-delete";

@Injectable()
export class EmployeeFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = HR_MODULE;
  readonly entityTypes: readonly string[] = [EMPLOYEE_ENTITY];

  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly repo: EmployeeFileRepository,
  ) {}

  /** VIEW file metadata ⇔ file-view:employee scope over the owning employee. */
  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessEmployee(input, ACTION_VIEW);
  }

  /** DOWNLOAD file content ⇔ file-view:employee (same scope as VIEW — no separate download grant). */
  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessEmployee(input, ACTION_VIEW);
  }

  /** LINK a file ⇔ file-upload:employee scope over the owning employee. */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessEmployee(input, ACTION_UPLOAD);
  }

  /** DELETE (soft) a file ⇔ file-delete:employee scope over the owning employee. */
  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessEmployee(input, ACTION_DELETE);
  }

  /** UNLINK ⇔ file-delete:employee (mirrors delete — cannot be reached with a weaker grant than link). */
  canUnlinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessEmployee(input, ACTION_DELETE);
  }

  /**
   * Employee-file authorization for `action`: resolve the strongest data_scope for (action,'employee')
   * — resolveAndAssert throws when the caller has NO grant (→ deny-error in the policy layer) — then load
   * the owning employee_profile scope-target INSIDE withTenant(companyId) (BẤT BIẾN #1) and isEmployeeInScope.
   * Fail-closed: employee not found / cross-tenant 0-row / out-of-scope ⇒ false ⇒ deny-resolver.
   */
  private async canAccessEmployee(input: FilePermissionInput, action: string): Promise<boolean> {
    const scope = await this.dataScope.resolveAndAssert(
      input.userId,
      input.companyId,
      action,
      EMPLOYEE_RESOURCE,
    );
    const ctx = await this.dataScope.resolveContext(input.userId, input.companyId);

    return this.db.withTenant(input.companyId, async (tx) => {
      // entityId IS the employee_profiles.id (FilePolicyService dispatches each link on its own entityId).
      const target = await this.repo.findEmployeeScopeTargetTx(tx, input.companyId, input.entityId);
      if (!target) return false; // not found / cross-tenant RLS 0-row ⇒ fail-closed
      return this.dataScope.isEmployeeInScope(scope, ctx, {
        userId: target.userId,
        companyId: target.companyId,
        orgUnitId: target.orgUnitId,
        directManagerUserId: target.directManagerUserId,
      });
    });
  }
}
