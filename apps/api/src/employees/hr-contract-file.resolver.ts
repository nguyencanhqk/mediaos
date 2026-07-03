/**
 * S2-FND-BE-4 (fix-hr-contract-resolver) — HrContractFileResolver.
 *
 * Spec: BACKEND-04 §11.4 (FileOwnerPermissionResolver) · BACKEND-11 §11.10 (dispatch by
 * module_code/entity_type). Closes the CRITICAL regression: H1 made FilePolicyService fail-closed for any
 * LINKED file whose owning (module,entity) has no registered resolver ('deny-no-resolver'). The shipped
 * "Download contract" feature links a file via ContractService.linkFile with the REAL pair
 * (moduleCode='HR', entityType='contract' — CONTRACT_ENTITY, lowercase), so WITHOUT this resolver every
 * user got a 403 on the contract download/view/delete routes. This resolver registers that pair and
 * mirrors the contract module's own authorization exactly:
 *
 *   • VIEW / DOWNLOAD  → mirror ContractService.getById READ scope: resolve the strongest data_scope for
 *     the ('view','contract') pair (DataScopeService.resolveAndAssert — throws when the caller has NO
 *     view grant, exactly like getById; the policy layer catches that throw and maps it to deny-error),
 *     load the contract's owner scope-target INSIDE withTenant(companyId) (BẤT BIẾN #1 — RLS+FORCE), then
 *     isEmployeeInScope. Fail-closed: contract not found / cross-tenant 0-row / out-of-scope ⇒ false.
 *   • LINK / DELETE / UNLINK → mirror manage:contract (Company-only; no Own/Team grant is seeded, so
 *     employee/manager are denied) via PermissionService.can({action:'manage',resourceType:'contract'}).
 *
 * The resolver receives ONLY permission metadata (FilePermissionInput) — never storage_path / checksum /
 * binary (CLAUDE.md §2.3). Registration into the shared singleton FilePolicyService happens additively in
 * EmployeesModule.onModuleInit (that module already imports FilesModule → same FilePolicyService, and owns
 * DataScopeService/PermissionService/ContractRepository). No app.module.ts touch.
 */

import { Injectable } from "@nestjs/common";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import { PermissionService } from "../permission/permission.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { ContractRepository } from "./contract.repository";

/**
 * MUST match the exact strings ContractService.linkFile passes to FileService.link (HR_MODULE /
 * CONTRACT_ENTITY in contract.service.ts). Registry lookup is case/whitespace-insensitive, but keeping
 * the literals identical to the call-site avoids the pair-drift trap (a fictitious 'EmployeeContract'
 * would silently never match the real link rows).
 */
const HR_MODULE = "HR";
const CONTRACT_ENTITY = "contract";
/** resourceType used for BOTH the view data_scope (read) and the manage gate (write) — same as contract.service.ts. */
const CONTRACT_RESOURCE = "contract";

@Injectable()
export class HrContractFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = HR_MODULE;
  readonly entityTypes: readonly string[] = [CONTRACT_ENTITY];

  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly permission: PermissionService,
    private readonly repo: ContractRepository,
  ) {}

  /** VIEW file metadata ⇔ may READ the owning contract (contract READ scope). */
  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canReadContract(input);
  }

  /** DOWNLOAD file content ⇔ may READ the owning contract (same scope as VIEW — no separate download grant). */
  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canReadContract(input);
  }

  /** LINK a file ⇔ may MANAGE the contract (Company-only). */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canManageContract(input);
  }

  /** DELETE (soft) a file ⇔ may MANAGE the contract (Company-only). */
  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.canManageContract(input);
  }

  /** UNLINK a file ⇔ may MANAGE the contract (Company-only) — mirrors link, so an unlink can never be
   *  reached with a weaker grant than the link that created it. */
  canUnlinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canManageContract(input);
  }

  /**
   * Contract READ authorization, mirroring ContractService.getById exactly. resolveAndAssert throws
   * ForbiddenException when the caller has NO view:contract grant — that throw propagates to
   * FilePolicyService.decideViaResolver which maps it to a fail-closed deny-error (never a false-allow).
   * A resolved-but-out-of-scope contract (or a missing/cross-tenant 0-row) returns false ⇒ deny-resolver.
   */
  private async canReadContract(input: FilePermissionInput): Promise<boolean> {
    const scope = await this.dataScope.resolveAndAssert(
      input.userId,
      input.companyId,
      "view",
      CONTRACT_RESOURCE,
    );
    const ctx = await this.dataScope.resolveContext(input.userId, input.companyId);

    return this.db.withTenant(input.companyId, async (tx) => {
      // entityId IS the contractId (FilePolicyService dispatches each link on its own entityId).
      const target = await this.repo.findScopeTargetTx(tx, input.companyId, input.entityId);
      if (!target) return false; // not found / cross-tenant RLS 0-row ⇒ fail-closed
      return this.dataScope.isEmployeeInScope(scope, ctx, {
        userId: target.userId,
        companyId: target.companyId,
        orgUnitId: target.orgUnitId,
        directManagerUserId: target.directManagerUserId,
      });
    });
  }

  /**
   * Contract MANAGE authorization (Company-only). Type-level can() — mirrors the controller's
   * @RequirePermission("manage","contract"); employee/manager have no manage grant seeded ⇒ deny-default.
   */
  private async canManageContract(input: FilePermissionInput): Promise<boolean> {
    const decision = await this.permission.can({
      userId: input.userId,
      companyId: input.companyId,
      action: "manage",
      resourceType: CONTRACT_RESOURCE,
    });
    return decision.allow;
  }
}
