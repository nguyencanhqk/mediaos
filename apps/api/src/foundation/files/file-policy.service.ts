/**
 * FOUNDATION-BE-5 — FilePolicyService: the single fail-closed decision point for file access.
 *
 * Spec: BACKEND-04 §11.4 (resolver registry) · BACKEND-11 §11.10 (dispatch by module_code/entity_type,
 * deny-by-default) · CLAUDE.md §2 (company_id every branch) / §3 (permission engine before sensitive data).
 *
 * Decision pipeline for each of the four actions (view/download/link/delete):
 *   1. Tenant guard — companyId AND userId are MANDATORY. Either missing ⇒ DENY ('deny-tenant') and
 *      NOTHING else runs (no resolver, no permission call). Prevents cross-tenant leak (CLAUDE.md §2.1).
 *   2. Resolver dispatch — look up a registered FileOwnerPermissionResolver by the normalized
 *      (module_code, entity_type) key, then by the module-wildcard key. A matched resolver is FINAL:
 *      true ⇒ ALLOW ('allow-resolver'), false ⇒ DENY ('deny-resolver'). NO escalation to the fallback.
 *   3. Fallback — no resolver matched ⇒ consult PermissionService.can() with the FOUNDATION.FILE.*
 *      (resourceType="file") permission mapped from the action. ALLOW ⇒ 'allow-foundation', else DENY.
 *   4. Fail-closed — any exception from a resolver or from can() ⇒ DENY ('deny-error') + a non-sensitive
 *      log. NEVER a false-ALLOW.
 *
 * The service receives ONLY permission metadata (FilePermissionInput) — never storage_path / checksum /
 * binary — and logs only requestId + reason + module/entity (CLAUDE.md §2.3). It performs NO DB access;
 * tenant isolation at the DB layer (RLS+FORCE) is owned by the migration lane, not here.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { PermissionDecision } from '../../permission/permission.types';
import type { CanInput } from '../../permission/permission.types';
import {
  FOUNDATION_FILE_PERMISSION,
  FilePolicyAction,
  type FilePermissionInput,
  type FilePolicyDecision,
} from './file-policy.types';
import type { FileOwnerPermissionResolver } from './resolvers/file-owner-permission-resolver';

/**
 * The slice of PermissionService this layer depends on. Declared here (not imported from
 * PermissionService) so the policy layer stays decoupled and unit-testable — and so the contract
 * (CanInput → PermissionDecision) is explicit. PermissionService.can() satisfies this structurally.
 */
export interface FilePermissionChecker {
  can(input: CanInput): Promise<PermissionDecision>;
}

/** Sentinel used in the registry key to mark a module-wildcard (resolver matches every entity). */
const MODULE_WILDCARD = '*';

/** Only the decision-method keys of the resolver (excludes moduleCode/entityTypes) — keeps the dynamic
 *  dispatch `resolver[method]` provably callable (no unsafe index). */
type FileResolverMethod = Exclude<
  {
    [K in keyof FileOwnerPermissionResolver]-?: FileOwnerPermissionResolver[K] extends (
      input: FilePermissionInput,
    ) => Promise<boolean>
      ? K
      : never;
  }[keyof FileOwnerPermissionResolver],
  undefined
>;

/** Maps a FilePolicyAction to the resolver method that answers it. */
const RESOLVER_METHOD: Readonly<Record<FilePolicyAction, FileResolverMethod>> = Object.freeze({
    [FilePolicyAction.View]: 'canViewFile',
    [FilePolicyAction.Download]: 'canDownloadFile',
    [FilePolicyAction.Link]: 'canLinkFile',
    [FilePolicyAction.Delete]: 'canDeleteFile',
  });

@Injectable()
export class FilePolicyService {
  private readonly logger = new Logger(FilePolicyService.name);

  /** key = `${normModule}|${normEntity}` or `${normModule}|*` (module-wildcard) → owning resolver. */
  private readonly resolvers = new Map<string, FileOwnerPermissionResolver>();

  constructor(private readonly checker: FilePermissionChecker) {}

  // ─── Registration ───────────────────────────────────────────────────────────

  /**
   * Registers a module resolver. For each declared entity type (or the module-wildcard when
   * entityTypes is empty/undefined) a normalized key is computed. A duplicate key (already claimed by
   * another resolver) is a configuration error → loud throw (never silently overwrite — CLAUDE.md §5).
   */
  registerResolver(resolver: FileOwnerPermissionResolver): void {
    const moduleKey = this.normalize(resolver.moduleCode);
    if (!moduleKey) {
      throw new Error('FilePolicyService.registerResolver: resolver.moduleCode must be non-empty');
    }

    const entityTypes = resolver.entityTypes ?? [];
    const keys =
      entityTypes.length === 0
        ? [this.buildKey(moduleKey, MODULE_WILDCARD)]
        : entityTypes.map((entity) => this.buildKey(moduleKey, this.normalize(entity)));

    // Validate ALL keys are free before mutating, so a duplicate cannot leave a half-registered state.
    for (const key of keys) {
      if (this.resolvers.has(key)) {
        throw new Error(
          `FilePolicyService.registerResolver: duplicate resolver for key "${key}" ` +
            `(module="${resolver.moduleCode}")`,
        );
      }
    }
    for (const key of keys) {
      this.resolvers.set(key, resolver);
    }
  }

  // ─── Public decision API ─────────────────────────────────────────────────────

  canView(input: FilePermissionInput): Promise<FilePolicyDecision> {
    return this.decide({ ...input, action: FilePolicyAction.View });
  }

  canDownload(input: FilePermissionInput): Promise<FilePolicyDecision> {
    return this.decide({ ...input, action: FilePolicyAction.Download });
  }

  canLink(input: FilePermissionInput): Promise<FilePolicyDecision> {
    return this.decide({ ...input, action: FilePolicyAction.Link });
  }

  canDelete(input: FilePermissionInput): Promise<FilePolicyDecision> {
    return this.decide({ ...input, action: FilePolicyAction.Delete });
  }

  // ─── Core pipeline ────────────────────────────────────────────────────────────

  private async decide(input: FilePermissionInput): Promise<FilePolicyDecision> {
    // 1. Tenant guard — runs BEFORE any resolver/permission call (CLAUDE.md §2.1, fail-closed).
    if (!input.companyId || !input.userId) {
      this.logger.warn(
        `file-policy deny-tenant: missing tenant scope ` +
          `(requestId=${input.requestId ?? '-'} module=${input.moduleCode} entity=${input.entityType})`,
      );
      return { allow: false, reason: 'deny-tenant' };
    }

    // 2. Resolver dispatch — exact (module,entity) then module-wildcard. Matched resolver is FINAL.
    const resolver = this.lookupResolver(input.moduleCode, input.entityType);
    if (resolver) {
      return this.decideViaResolver(resolver, input);
    }

    // 3. Fallback — FOUNDATION.FILE.* via PermissionService.can().
    return this.decideViaFallback(input);
  }

  private async decideViaResolver(
    resolver: FileOwnerPermissionResolver,
    input: FilePermissionInput,
  ): Promise<FilePolicyDecision> {
    const method = RESOLVER_METHOD[input.action];
    try {
      const ok = await resolver[method](input);
      // Matched resolver verdict is final — NEVER escalate to FOUNDATION.FILE.* (BACKEND-11 §11.10).
      return ok
        ? { allow: true, reason: 'allow-resolver' }
        : { allow: false, reason: 'deny-resolver' };
    } catch (err) {
      this.logError('resolver threw', input, err);
      return { allow: false, reason: 'deny-error' };
    }
  }

  private async decideViaFallback(input: FilePermissionInput): Promise<FilePolicyDecision> {
    const perm = FOUNDATION_FILE_PERMISSION[input.action];
    try {
      const decision = await this.checker.can({
        userId: input.userId,
        companyId: input.companyId,
        action: perm.action,
        resourceType: perm.resourceType,
        resourceId: input.fileId ?? null,
      });
      return decision.allow
        ? { allow: true, reason: 'allow-foundation' }
        : { allow: false, reason: 'deny-foundation' };
    } catch (err) {
      this.logError('permission.can() threw', input, err);
      return { allow: false, reason: 'deny-error' };
    }
  }

  // ─── Registry helpers ──────────────────────────────────────────────────────────

  private lookupResolver(
    moduleCode: string,
    entityType: string,
  ): FileOwnerPermissionResolver | undefined {
    const moduleKey = this.normalize(moduleCode);
    const exact = this.resolvers.get(this.buildKey(moduleKey, this.normalize(entityType)));
    if (exact) return exact;
    return this.resolvers.get(this.buildKey(moduleKey, MODULE_WILDCARD));
  }

  /** Single normalization used by BOTH registration and lookup so keys always agree. */
  private normalize(value: string): string {
    return value.trim().toLowerCase();
  }

  private buildKey(moduleKey: string, entityKey: string): string {
    return `${moduleKey}|${entityKey}`;
  }

  private logError(what: string, input: FilePermissionInput, err: unknown): void {
    // Fail-closed log carries ONLY non-sensitive correlation metadata (CLAUDE.md §2.3).
    this.logger.error(
      `file-policy deny-error: ${what} ` +
        `(requestId=${input.requestId ?? '-'} module=${input.moduleCode} ` +
        `entity=${input.entityType} action=${input.action})`,
      err instanceof Error ? err.stack : String(err),
    );
  }
}
