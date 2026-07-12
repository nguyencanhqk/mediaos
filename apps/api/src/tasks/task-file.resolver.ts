/**
 * S4-TASK-BE-5 — TaskFileResolver.
 *
 * Spec: BACKEND-04 §11.4 (FileOwnerPermissionResolver) · BACKEND-11 §11.10 (dispatch by
 * module_code/entity_type). Registers the (module='TASK', entity_type='task') pair into the shared singleton
 * FilePolicyService so task-linked file rows no longer fail-closed to 'deny-no-resolver'. It mirrors the
 * task-file authorization exactly:
 *
 *   • VIEW / DOWNLOAD → resolve the strongest data_scope for ('read','task'), then task-in-scope
 *     (assignee-in-scope OR active project-member) on the owning task (entityId = taskId). resolveAndAssert
 *     throws ForbiddenException when the caller has NO read:task grant — the policy layer catches that and
 *     maps it to a fail-closed deny-error (never a false-allow). Cross-tenant / not-found / out-of-scope
 *     ⇒ false ⇒ deny-resolver.
 *   • LINK   → same shape but the ('file-upload','task') pair.
 *   • DELETE / UNLINK → same shape but the ('file-delete','task') pair.
 *
 * There is NO 'file-view':task pair (seed 0485) — viewing/downloading a task attachment reuses read:task
 * (the same gate the task itself uses). The resolver receives ONLY permission metadata (FilePermissionInput)
 * — never storage_path / checksum / binary (BẤT BIẾN #2.3). A resolver `false`/throw is FINAL: the policy
 * layer does NOT escalate to FOUNDATION.FILE.* — a broad file grant can never read a task-owned file.
 * Registration into the shared FilePolicyService happens additively in TasksModule.onModuleInit.
 */

import { Injectable } from "@nestjs/common";
import type { SQL } from "drizzle-orm";
import { DatabaseService } from "../db/db.service";
import { DataScopeService } from "../permission/data-scope.service";
import type { FilePermissionInput } from "../foundation/files/file-policy.types";
import type { FileOwnerPermissionResolver } from "../foundation/files/resolvers/file-owner-permission-resolver";
import { TaskCoreRepository } from "./task-core.repository";
import { TASK_ENTITY, TASK_MODULE, TaskFileRepository } from "./task-file.repository";

/** resourceType + actions for every task-file data_scope resolution (matches seed mig 0485). */
const TASK_RESOURCE = "task";
const ACTION_READ = "read";
const ACTION_UPLOAD = "file-upload";
const ACTION_DELETE = "file-delete";

@Injectable()
export class TaskFileResolver implements FileOwnerPermissionResolver {
  readonly moduleCode = TASK_MODULE;
  readonly entityTypes: readonly string[] = [TASK_ENTITY];

  constructor(
    private readonly db: DatabaseService,
    private readonly dataScope: DataScopeService,
    private readonly coreRepo: TaskCoreRepository,
    private readonly fileRepo: TaskFileRepository,
  ) {}

  /** VIEW file metadata ⇔ read:task scope over the owning task. */
  canViewFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessTask(input, ACTION_READ);
  }

  /** DOWNLOAD file content ⇔ read:task (same scope as VIEW — no separate download grant). */
  canDownloadFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessTask(input, ACTION_READ);
  }

  /** LINK a file ⇔ file-upload:task scope over the owning task. */
  canLinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessTask(input, ACTION_UPLOAD);
  }

  /** DELETE (soft) a file ⇔ file-delete:task scope over the owning task. */
  canDeleteFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessTask(input, ACTION_DELETE);
  }

  /** UNLINK ⇔ file-delete:task (mirrors delete — cannot be reached with a weaker grant than link). */
  canUnlinkFile(input: FilePermissionInput): Promise<boolean> {
    return this.canAccessTask(input, ACTION_DELETE);
  }

  /**
   * Task-file authorization for `action`: resolve the strongest data_scope for (action,'task')
   * — resolveAndAssert throws when the caller has NO grant (→ deny-error in the policy layer) — then check
   * task-in-scope INSIDE withTenant(companyId) (BẤT BIẾN #1). Company/System ⇒ any live in-tenant task;
   * Own/Team/Department ⇒ assignee-in-scope OR active project-member. Fail-closed: task not found /
   * cross-tenant RLS 0-row / out-of-scope ⇒ false ⇒ deny-resolver (no FOUNDATION.FILE.* escalation).
   */
  private async canAccessTask(input: FilePermissionInput, action: string): Promise<boolean> {
    const scope = await this.dataScope.resolveAndAssert(
      input.userId,
      input.companyId,
      action,
      TASK_RESOURCE,
    );
    return this.db.withTenant(input.companyId, async (tx) => {
      let scopeExists: SQL | undefined;
      if (scope !== "Company" && scope !== "System") {
        const ctx = await this.dataScope.resolveContext(input.userId, input.companyId);
        const scopeCond = this.dataScope.buildEmployeeScopeCondition(scope, ctx);
        const actorEmp = await this.coreRepo.findActiveEmployeeByUserTx(
          tx,
          input.companyId,
          input.userId,
        );
        scopeExists = this.coreRepo.buildReadScopeExists(
          input.companyId,
          scopeCond,
          actorEmp?.id ?? null,
          input.userId,
        );
      }
      // entityId IS the tasks.id (FilePolicyService dispatches each link on its own entityId).
      return this.fileRepo.isTaskInScopeTx(tx, input.companyId, input.entityId, scopeExists);
    });
  }
}
