/**
 * FOUNDATION-BE-5 — Resolver-dispatch contract for FileOwnerPermissionResolver via FilePolicyService.
 *
 * Complements file-policy.service.spec.ts (deny-path suite). Here we pin the registry dispatch rules
 * that the resolver interface promises (BACKEND-04 §11.4):
 *   - entityTypes=undefined / empty  → module-wildcard: matches EVERY entity of the module
 *   - entityTypes=[...]              → matches ONLY listed entity types
 *   - exact (module,entity) wins over a module-wildcard for the same module
 *   - registration rejects an empty moduleCode (loud-fail)
 *
 * These exercise the wildcard branch of FilePolicyService.lookupResolver/registerResolver, which the
 * deny-path suite (always-explicit entityTypes) does not reach.
 */

import { describe, expect, it } from 'vitest';
import { FilePolicyService } from '../file-policy.service';
import type { FilePermissionChecker } from '../file-policy.service';
import { FilePolicyAction, type FilePermissionInput } from '../file-policy.types';
import type { FileOwnerPermissionResolver } from './file-owner-permission-resolver';

// can() that would ALLOW — proves a matched resolver short-circuits the fallback (no escalation).
const allowAllChecker: FilePermissionChecker = {
  can: async () => ({ allow: true, reason: 'allow', auditRequired: false }),
};

function makeResolver(
  moduleCode: string,
  entityTypes: string[] | undefined,
  verdict: boolean,
): FileOwnerPermissionResolver & { seen: string[] } {
  const seen: string[] = [];
  const answer = async (i: FilePermissionInput): Promise<boolean> => {
    seen.push(i.entityType);
    return verdict;
  };
  return {
    moduleCode,
    entityTypes,
    seen,
    canViewFile: answer,
    canDownloadFile: answer,
    canLinkFile: answer,
    canDeleteFile: answer,
  };
}

const input = (overrides: Partial<FilePermissionInput> = {}): FilePermissionInput => ({
  companyId: 'co-1',
  userId: 'user-1',
  fileId: 'file-1',
  moduleCode: 'TASK',
  entityType: 'TaskAttachment',
  entityId: 'ent-1',
  action: FilePolicyAction.View,
  ...overrides,
});

describe('FileOwnerPermissionResolver dispatch contract', () => {
  it('module-wildcard (entityTypes undefined) matches EVERY entity of the module', async () => {
    const service = new FilePolicyService(allowAllChecker);
    const task = makeResolver('TASK', undefined, true);
    service.registerResolver(task);

    const a = await service.canView(input({ entityType: 'TaskAttachment' }));
    const b = await service.canDownload(input({ entityType: 'TaskComment' }));

    expect(a.allow).toBe(true);
    expect(b.allow).toBe(true);
    expect(a.reason).toBe('allow-resolver');
    expect(task.seen).toEqual(['TaskAttachment', 'TaskComment']);
  });

  it('module-wildcard (entityTypes empty array) behaves like undefined', async () => {
    const service = new FilePolicyService(allowAllChecker);
    const task = makeResolver('TASK', [], true);
    service.registerResolver(task);

    const d = await service.canDelete(input({ entityType: 'Anything' }));
    expect(d.allow).toBe(true);
    expect(task.seen).toEqual(['Anything']);
  });

  it('listed entityTypes restrict dispatch to exactly those entities', async () => {
    const service = new FilePolicyService(allowAllChecker);
    // resolver DENIES; if it were consulted the decision would be deny-resolver. For an unlisted
    // entity the resolver is NOT matched → falls through to the allow-all fallback.
    const hr = makeResolver('HR', ['EmployeeContract'], false);
    service.registerResolver(hr);

    const listed = await service.canView(input({ moduleCode: 'HR', entityType: 'EmployeeContract' }));
    const unlisted = await service.canView(input({ moduleCode: 'HR', entityType: 'Payslip' }));

    expect(listed.allow).toBe(false);
    expect(listed.reason).toBe('deny-resolver');
    expect(unlisted.allow).toBe(true); // fallback ran because no resolver matched
    expect(unlisted.reason).toBe('allow-foundation');
    expect(hr.seen).toEqual(['EmployeeContract']); // unlisted entity never touched the resolver
  });

  it('an exact (module,entity) resolver wins over a module-wildcard for the same module', async () => {
    const service = new FilePolicyService(allowAllChecker);
    const wildcard = makeResolver('TASK', undefined, true);
    const exact = makeResolver('TASK', ['TaskAttachment'], false);
    service.registerResolver(wildcard);
    service.registerResolver(exact);

    const decision = await service.canView(input({ entityType: 'TaskAttachment' }));

    expect(decision.allow).toBe(false); // exact resolver (deny) took precedence
    expect(exact.seen).toEqual(['TaskAttachment']);
    expect(wildcard.seen).toEqual([]); // wildcard not consulted for an exactly-claimed entity
  });

  it('rejects registration with an empty moduleCode (loud-fail)', () => {
    const service = new FilePolicyService(allowAllChecker);
    expect(() => service.registerResolver(makeResolver('   ', ['X'], true))).toThrow();
  });
});
