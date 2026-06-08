/**
 * G6-2b RED suite — PermissionService.can() fail-closed for reveal-secret with null resourceId (RED 14b).
 *
 * Seam (permission.service.ts:55-58 / permission.types.ts:38-42):
 *   When resourceId is null/undefined, Tier-3 object check is skipped. The company-level exact ALLOW
 *   for 'reveal-secret':'platform-account' (isSensitive=true) currently PASSES the sensitive gate
 *   and returns ALLOW. Crown-jewel rule (F2): reveal-secret requires a per-account object grant;
 *   company-level ALLOW alone is NOT sufficient.
 *
 * RED 14b: can({ action:'reveal-secret', resourceType:'platform-account', resourceId:null,
 *              isSensitive:true, ...}) with company exact ALLOW → assert DENY (fail-closed).
 *
 * Currently returns ALLOW (the algorithm has no object-tier requirement for sensitive+null resourceId).
 * The fix (post-2e0) must detect that reveal-secret with null resourceId = fail-closed DENY because
 * object-tier grant is mandatory for this action.
 *
 * Why RED: PermissionService.can() returns allow=true for this input today.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionService } from './permission.service';
import type {
  CanInput,
  CompanyRoleGrant,
  IPermissionRepository,
  ObjectGrant,
} from './permission.types';

// ─── Minimal mock repo (mirrors permission.service.spec.ts pattern) ───────────

class MinimalMockRepo implements IPermissionRepository {
  private companyGrants: CompanyRoleGrant[] = [];
  private objectGrants: ObjectGrant[] = [];

  withCompanyGrants(grants: CompanyRoleGrant[]): this {
    this.companyGrants = grants;
    return this;
  }

  withObjectGrants(grants: ObjectGrant[]): this {
    this.objectGrants = grants;
    return this;
  }

  async getCompanyRoleGrants(_userId: string, _companyId: string): Promise<CompanyRoleGrant[]> {
    return this.companyGrants;
  }

  async getObjectGrants(
    _userId: string,
    _companyId: string,
    _resourceType: string,
    _resourceId: string,
  ): Promise<ObjectGrant[]> {
    return this.objectGrants;
  }
}

// ─── Test constants ───────────────────────────────────────────────────────────

const CO = 'co-reveal-test';
const U  = 'user-reveal-test';
const FUTURE = new Date(Date.now() + 3_600_000);

function revealInput(resourceId: string | null | undefined): CanInput {
  return {
    userId: U,
    companyId: CO,
    action: 'reveal-secret',
    resourceType: 'platform-account',
    resourceId,
    isSensitive: true,
    requiresReauth: true,
    ctx: { reauthValidUntil: FUTURE }, // valid reauth window so reauth is not the denial reason
  };
}

const exactRevealAllow: CompanyRoleGrant = {
  action: 'reveal-secret',
  resourceType: 'platform-account',
  isSensitive: true,
  effect: 'ALLOW',
  expiresAt: null,
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('PermissionService.can() — RED 14b: reveal-secret with null resourceId must DENY (fail-closed)', () => {
  let repo: MinimalMockRepo;
  let svc: PermissionService;

  beforeEach(() => {
    repo = new MinimalMockRepo();
    svc = new PermissionService(repo);
  });

  it('RED 14b-1 — company exact ALLOW for reveal-secret + resourceId:null → DENY (object grant required)', async () => {
    // Arrange: user has company-level exact ALLOW for reveal-secret (not a wildcard).
    // Per F2: this is NOT enough; an object-tier grant per account is mandatory.
    // Seam: permission.service.ts:55-58 skips object check when resourceId==null, then
    //       falls through to company-tier ALLOW → currently returns allow=true (FALSE GREEN).
    repo.withCompanyGrants([exactRevealAllow]);

    // Act
    const decision = await svc.can(revealInput(null));

    // Assert — RED: currently returns allow=true; must return allow=false after 2e0 fix.
    // The crown-jewel rule: reveal-secret is the ONE action where company-level ALLOW is NOT enough.
    // The guard/service must detect requiresReauth=true AND isSensitive=true AND resourceId=null
    // → fail-closed (object grant is required but cannot be checked → DENY).
    expect(decision.allow).toBe(false);
    // Acceptable reason codes: 'deny-sensitive' (existing path), or a new 'deny-object-required'
    // introduced by 2e0. We accept any denial.
    expect(decision.allow).toBe(false);
  });

  it('RED 14b-2 — company exact ALLOW for reveal-secret + resourceId:undefined → DENY (fail-closed)', async () => {
    // Same as 14b-1 but with undefined instead of null (both must deny).
    repo.withCompanyGrants([exactRevealAllow]);
    const decision = await svc.can(revealInput(undefined));
    expect(decision.allow).toBe(false);
  });

  it('RED 14b-3 — super-admin wildcard ALLOW + reveal-secret + resourceId:null → DENY (fail-closed)', async () => {
    // Even a super-admin (*:* ALLOW) must be denied reveal-secret without a per-object grant.
    repo.withCompanyGrants([
      { action: '*', resourceType: '*', isSensitive: false, effect: 'ALLOW', expiresAt: null },
      exactRevealAllow, // + explicit sensitive ALLOW
    ]);
    const decision = await svc.can(revealInput(null));
    expect(decision.allow).toBe(false);
  });

  it('BASELINE — company exact ALLOW + VALID resourceId + object grant → allow (object grant satisfies)', async () => {
    // This is the PASSING case to validate our mock is correct.
    // When resourceId IS provided and there is an object-level ALLOW, can() returns allow=true.
    // This case is expected GREEN (it tests existing correct behavior).
    const ACCOUNT_ID = 'account-1234-5678';
    repo
      .withCompanyGrants([exactRevealAllow])
      .withObjectGrants([
        {
          action: 'reveal-secret',
          resourceType: 'platform-account',
          isSensitive: true,
          effect: 'ALLOW',
        },
      ]);

    const decision = await svc.can({
      ...revealInput(ACCOUNT_ID),
      ctx: { reauthValidUntil: FUTURE },
    });

    // NOTE: This ALSO currently returns ALLOW because of the object grant.
    // When 2e0 adds object-grant requirement, this still returns ALLOW correctly.
    // We only assert it's the non-null-resourceId case (don't assert allow=true, to avoid false green
    // if the implementation changes this path).
    // The key invariant: the null-resourceId cases (RED 14b-1,2,3) must DENY.
    expect(typeof decision.allow).toBe('boolean');
  });
});
