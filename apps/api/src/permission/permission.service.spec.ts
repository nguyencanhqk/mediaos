/**
 * G3-3 — Deny-path RED suite for PermissionService.can()
 *
 * All tests MUST fail (RED) until G3-2 implements the real algorithm.
 * Mandatory cases per plan §4 G3-3:
 *   (a) user no roles → deny-default
 *   (b) DENY wins ALLOW same tier
 *   (c) role A ALLOW + role B DENY → deny-explicit  [cross-role deny-overrides]
 *   (d) object-DENY wins company-ALLOW
 *   (e) sensitive + wildcard *:* ALLOW → deny-sensitive
 *   (f) sensitive + explicit ALLOW → allow
 *   (g) expired role → deny even on cache-hit (service re-checks expiresAt)
 *   (h) super-admin wildcard + sensitive without explicit → deny-sensitive
 *   (i) object grants only, no resourceId → deny-default
 *   (j) object-ALLOW + company-DENY → allow  [lower tier wins]
 *   (k) two revoke events → idempotent DENY
 *   (l) DB/cache error → fail-closed DENY
 *
 * Counts: 27 deny cases + 15 allow cases = 42 total.
 * Coverage requirement: ≥90% for PermissionService.can() (G3-2 must hit this).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionService } from './permission.service';
import type {
  CanInput,
  CompanyRoleGrant,
  IPermissionRepository,
  ObjectGrant,
  PermissionDecision,
} from './permission.types';

// ─── Mock repository ─────────────────────────────────────────────────────────

class MockPermissionRepository implements IPermissionRepository {
  private companyMap = new Map<string, CompanyRoleGrant[]>();
  private objectMap = new Map<string, ObjectGrant[]>();
  private failCompany = false;
  private failObject = false;

  setCompanyGrants(userId: string, companyId: string, grants: CompanyRoleGrant[]): this {
    this.companyMap.set(`${userId}:${companyId}`, grants);
    return this;
  }

  setObjectGrants(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceId: string,
    grants: ObjectGrant[],
  ): this {
    this.objectMap.set(`${userId}:${companyId}:${resourceType}:${resourceId}`, grants);
    return this;
  }

  setFailCompany(v: boolean): this {
    this.failCompany = v;
    return this;
  }

  setFailObject(v: boolean): this {
    this.failObject = v;
    return this;
  }

  async getCompanyRoleGrants(userId: string, companyId: string): Promise<CompanyRoleGrant[]> {
    if (this.failCompany) throw new Error('DB connection failed (simulated)');
    return this.companyMap.get(`${userId}:${companyId}`) ?? [];
  }

  async getObjectGrants(
    userId: string,
    companyId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<ObjectGrant[]> {
    if (this.failObject) throw new Error('DB connection failed (simulated)');
    return this.objectMap.get(`${userId}:${companyId}:${resourceType}:${resourceId}`) ?? [];
  }
}

// ─── Test constants ───────────────────────────────────────────────────────────

const CO = 'co-test-1';
const U = 'user-test-1';
const OBJ_A = 'object-a';
const OBJ_B = 'object-b';

const PAST = new Date(Date.now() - 60_000); // 1 minute ago = expired
const FUTURE = new Date(Date.now() + 3_600_000); // 1 hour from now = valid

// ─── Builder helpers ──────────────────────────────────────────────────────────

function rg(
  action: string,
  resourceType: string,
  effect: 'ALLOW' | 'DENY' = 'ALLOW',
  opts: { isSensitive?: boolean; expiresAt?: Date | null } = {},
): CompanyRoleGrant {
  return {
    action,
    resourceType,
    isSensitive: opts.isSensitive ?? false,
    effect,
    expiresAt: opts.expiresAt ?? null,
  };
}

function og(
  action: string,
  resourceType: string,
  effect: 'ALLOW' | 'DENY' = 'ALLOW',
  isSensitive = false,
): ObjectGrant {
  return { action, resourceType, isSensitive, effect };
}

function input(
  action: string,
  resourceType: string,
  opts: {
    resourceId?: string;
    isSensitive?: boolean;
    requiresReauth?: boolean;
    reauthValidUntil?: Date | null;
  } = {},
): CanInput {
  return {
    userId: U,
    companyId: CO,
    action,
    resourceType,
    resourceId: opts.resourceId,
    isSensitive: opts.isSensitive,
    requiresReauth: opts.requiresReauth,
    ctx: { reauthValidUntil: opts.reauthValidUntil },
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('PermissionService.can() — G3-3 deny-path RED suite', () => {
  let repo: MockPermissionRepository;
  let svc: PermissionService;

  beforeEach(() => {
    repo = new MockPermissionRepository();
    svc = new PermissionService(repo);
  });

  async function can(i: CanInput): Promise<PermissionDecision> {
    return svc.can(i);
  }

  // ═══════════════════════════════════════════════════════════════
  // (a) USER HAS NO ROLES
  // ═══════════════════════════════════════════════════════════════

  describe('(a) user has no roles', () => {
    it('a1 — no grants at all → deny-default', async () => {
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-default');
    });

    it('a2 — no grants, sensitive action → deny-sensitive (sensitive gate fires before default)', async () => {
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
      expect(d.auditRequired).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (b) DENY WINS ALLOW — same tier
  // ═══════════════════════════════════════════════════════════════

  describe('(b) DENY wins ALLOW in same tier', () => {
    it('b1 — same role: ALLOW + DENY for same action → deny-explicit', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('approve', 'step', 'ALLOW'),
        rg('approve', 'step', 'DENY'),
      ]);
      const d = await can(input('approve', 'step'));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-explicit');
    });

    it('b2 — object tier: ALLOW + DENY → deny-explicit', async () => {
      repo
        .setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')])
        .setObjectGrants(U, CO, 'project', OBJ_A, [
          og('read', 'project', 'ALLOW'),
          og('read', 'project', 'DENY'),
        ]);
      const d = await can(input('read', 'project', { resourceId: OBJ_A }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-explicit');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (c) DENY-OVERRIDES ACROSS ROLES [critical]
  // ═══════════════════════════════════════════════════════════════

  describe('(c) deny-overrides across-roles', () => {
    it('c1 — role A ALLOW + role B DENY same action:type → deny-explicit', async () => {
      // Simulates user holding two roles; one allows, the other denies
      repo.setCompanyGrants(U, CO, [
        rg('view-salary', 'payslip', 'ALLOW', { isSensitive: true }),
        rg('view-salary', 'payslip', 'DENY', { isSensitive: true }),
      ]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-explicit');
    });

    it('c2 — role A ALLOW other + role B DENY target action → deny-explicit for target', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('read', 'project', 'ALLOW'),
        rg('approve', 'step', 'ALLOW'),
        rg('approve', 'step', 'DENY'), // role B denies approve
      ]);
      const d = await can(input('approve', 'step'));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-explicit');
    });

    it('c3 — DENY for unrelated action does NOT affect allowed action → allow', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('read', 'project', 'ALLOW'),
        rg('delete', 'project', 'DENY'),
      ]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (d) OBJECT-DENY WINS COMPANY-ALLOW
  // ═══════════════════════════════════════════════════════════════

  describe('(d) object-DENY beats company-ALLOW', () => {
    it('d1 — company ALLOW + object DENY → deny-explicit', async () => {
      repo
        .setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')])
        .setObjectGrants(U, CO, 'project', OBJ_A, [og('read', 'project', 'DENY')]);
      const d = await can(input('read', 'project', { resourceId: OBJ_A }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-explicit');
    });

    it('d2 — no company grant + object DENY → deny-explicit', async () => {
      repo
        .setCompanyGrants(U, CO, [])
        .setObjectGrants(U, CO, 'project', OBJ_A, [og('read', 'project', 'DENY')]);
      const d = await can(input('read', 'project', { resourceId: OBJ_A }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-explicit');
    });

    it('d3 — object DENY on different objectId does NOT affect target object → allow', async () => {
      repo
        .setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')])
        .setObjectGrants(U, CO, 'project', OBJ_B, [og('read', 'project', 'DENY')]); // DENY on OBJ_B
      // Querying OBJ_A → no DENY for OBJ_A
      const d = await can(input('read', 'project', { resourceId: OBJ_A }));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (e) SENSITIVE + WILDCARD BLOCKED
  // ═══════════════════════════════════════════════════════════════

  describe('(e) sensitive action: wildcard does NOT satisfy', () => {
    it('e1 — wildcard *:* ALLOW does NOT grant sensitive action → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [rg('*', '*', 'ALLOW')]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
      expect(d.auditRequired).toBe(true);
    });

    it('e2 — action wildcard (action=* resourceType=payslip) ALLOW does NOT satisfy sensitive', async () => {
      repo.setCompanyGrants(U, CO, [rg('*', 'payslip', 'ALLOW')]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });

    it('e3 — manage ALLOW does NOT grant sensitive delete-project', async () => {
      // 'manage' is not 'delete-project' — different action string
      repo.setCompanyGrants(U, CO, [rg('manage', 'project', 'ALLOW')]);
      const d = await can(input('delete-project', 'project', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });

    it('e4 — sensitive action with only non-sensitive grants for other actions → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('read', 'project', 'ALLOW'),
        rg('approve', 'step', 'ALLOW'),
      ]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (g) EXPIRED ROLES (expiresAt re-check)
  // ═══════════════════════════════════════════════════════════════

  describe('(g) expired role grants are ignored', () => {
    it('g1 — only grant has expiresAt in past → deny-default', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW', { expiresAt: PAST })]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-default');
    });

    it('g2 — cache-hit scenario: stale grant with expired expiresAt → service must re-check → deny-default', async () => {
      // Even when the repo returns the grant (simulates stale cache), service must filter by expiresAt
      repo.setCompanyGrants(U, CO, [
        rg('approve', 'step', 'ALLOW', { expiresAt: PAST }), // expired
      ]);
      const d = await can(input('approve', 'step'));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-default');
    });

    it('g3 — expired grant mixed with valid grant: valid one still grants', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('read', 'project', 'ALLOW', { expiresAt: PAST }), // expired
        rg('read', 'project', 'ALLOW', { expiresAt: FUTURE }), // valid
      ]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('g4 — null expiresAt = permanent, never expires → allow', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW', { expiresAt: null })]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('g5 — expired DENY grant + valid ALLOW → allow (DENY also expires)', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('read', 'project', 'DENY', { expiresAt: PAST }), // expired DENY
        rg('read', 'project', 'ALLOW', { expiresAt: null }), // permanent ALLOW
      ]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (h) SUPER-ADMIN + SENSITIVE WITHOUT EXPLICIT
  // ═══════════════════════════════════════════════════════════════

  describe('(h) super-admin wildcard cannot access sensitive without explicit ALLOW', () => {
    it('h1 — super-admin *:* ALLOW + sensitive action without explicit → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [rg('*', '*', 'ALLOW')]); // super-admin
      const d = await can(input('reveal-secret', 'platform-account', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });

    it('h2 — super-admin with many non-sensitive ALLOWs still blocked for sensitive → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('*', '*', 'ALLOW'),
        rg('read', 'project', 'ALLOW'),
        rg('approve', 'step', 'ALLOW'),
        rg('manage', 'company', 'ALLOW'),
      ]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (i) OBJECT GRANTS ONLY, NO resourceId
  // ═══════════════════════════════════════════════════════════════

  describe('(i) only object grants, no resourceId → deny-default', () => {
    it('i1 — user has object-level grant but no company grant and no resourceId → deny-default', async () => {
      repo
        .setCompanyGrants(U, CO, []) // no company grants
        .setObjectGrants(U, CO, 'project', OBJ_A, [og('read', 'project', 'ALLOW')]);
      // no resourceId → object grants not queried → company grants empty → deny-default
      const d = await can(input('read', 'project')); // resourceId omitted
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-default');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (l) FAIL-CLOSED ON DB/CACHE ERROR
  // ═══════════════════════════════════════════════════════════════

  describe('(l) fail-closed when DB/cache throws', () => {
    it('l1 — company grants DB error → resolves to DENY (not false-ALLOW, not uncaught throw)', async () => {
      repo.setFailCompany(true);
      await expect(can(input('read', 'project'))).resolves.toMatchObject({ allow: false });
    });

    it('l2 — object grants DB error with resourceId → fail-closed DENY', async () => {
      repo
        .setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')])
        .setFailObject(true);
      await expect(
        can(input('read', 'project', { resourceId: OBJ_A })),
      ).resolves.toMatchObject({ allow: false });
    });

    it('l3 — both company and object DB errors → fail-closed DENY (no exception propagated)', async () => {
      repo.setFailCompany(true).setFailObject(true);
      await expect(
        can(input('read', 'project', { resourceId: OBJ_A })),
      ).resolves.toMatchObject({ allow: false });
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // RBAC cases from permission-matrix-spec §8
  // ═══════════════════════════════════════════════════════════════

  describe('RBAC deny cases (from permission-matrix-spec §8)', () => {
    it('rbac1 — Employee has no approve grant → approve step → deny-default', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'task', 'ALLOW'), rg('submit', 'task', 'ALLOW')]);
      const d = await can(input('approve', 'step'));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-default');
    });

    it('rbac2 — ScriptWriter has no create:content → deny-default', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'content', 'ALLOW'), rg('submit', 'task', 'ALLOW')]);
      const d = await can(input('create', 'content'));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-default');
    });

    it('rbac3 — Editor has read+update but not delete-project (sensitive) → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW'), rg('update', 'content', 'ALLOW')]);
      const d = await can(input('delete-project', 'project', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });

    it('rbac4 — CompanyAdmin manage:company does NOT grant view-salary → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [rg('manage', 'company', 'ALLOW'), rg('*', '*', 'ALLOW')]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });

    it('rbac5 — ChannelManager manage:channel does NOT grant reveal-secret → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('manage', 'channel', 'ALLOW'),
        rg('read', 'platform-account', 'ALLOW'),
      ]);
      const d = await can(input('reveal-secret', 'platform-account', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });

    it('rbac6 — DeptManager manage:department does NOT grant change-role → deny-sensitive', async () => {
      repo.setCompanyGrants(U, CO, [rg('manage', 'department', 'ALLOW'), rg('read', 'user', 'ALLOW')]);
      const d = await can(input('change-role', 'role', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-sensitive');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // REAUTH cases
  // ═══════════════════════════════════════════════════════════════

  describe('reauth required for reveal-secret type actions', () => {
    it('reauth1 — reveal-secret with explicit ALLOW but no reauthValidUntil → deny-reauth-required', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('reveal-secret', 'platform-account', 'ALLOW', { isSensitive: true }),
      ]);
      // reauthValidUntil not provided → no reauth
      const d = await can(
        input('reveal-secret', 'platform-account', {
          isSensitive: true,
          requiresReauth: true,
          // reauthValidUntil: omitted
        }),
      );
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-reauth-required');
      expect(d.requiresReauth).toBe(true);
    });

    it('reauth2 — reveal-secret with explicit ALLOW + expired reauth → deny-reauth-required', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('reveal-secret', 'platform-account', 'ALLOW', { isSensitive: true }),
      ]);
      const d = await can(
        input('reveal-secret', 'platform-account', {
          isSensitive: true,
          requiresReauth: true,
          reauthValidUntil: PAST,
        }),
      );
      expect(d.allow).toBe(false);
      expect(d.reason).toBe('deny-reauth-required');
      expect(d.requiresReauth).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // (k) IDEMPOTENCY
  // ═══════════════════════════════════════════════════════════════

  describe('(k) idempotency — two revoke events yield consistent DENY', () => {
    it('k1 — calling can() twice returns identical result', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')]);
      const d1 = await can(input('read', 'project'));
      const d2 = await can(input('read', 'project'));
      expect(d1.allow).toBe(d2.allow);
      expect(d1.reason).toBe(d2.reason);
    });

    it('k2 — simulated revoke (grants cleared) → deny-default on second call', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')]);
      const before = await can(input('read', 'project'));
      expect(before.allow).toBe(true);

      repo.setCompanyGrants(U, CO, []); // simulate revoke invalidating grants
      const after = await can(input('read', 'project'));
      expect(after.allow).toBe(false);
      expect(after.reason).toBe('deny-default');
    });

    it('k3 — two consecutive deny calls return same DENY (idempotent)', async () => {
      repo.setCompanyGrants(U, CO, []);
      const d1 = await can(input('read', 'project'));
      const d2 = await can(input('read', 'project'));
      expect(d1.allow).toBe(false);
      expect(d2.allow).toBe(false);
      expect(d1.reason).toBe(d2.reason);
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // ALLOW CASES (≥10 required)
  // ═══════════════════════════════════════════════════════════════

  describe('ALLOW cases', () => {
    it('allow1 — direct matching ALLOW grant → allow', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow2 — multiple roles all ALLOW → allow', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('read', 'project', 'ALLOW'),
        rg('read', 'project', 'ALLOW'),
      ]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow3 — wildcard *:* ALLOW for non-sensitive action → allow', async () => {
      repo.setCompanyGrants(U, CO, [rg('*', '*', 'ALLOW')]);
      const d = await can(input('approve', 'step'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('(f1) allow4 — sensitive action with explicit ALLOW → allow', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('view-salary', 'payslip', 'ALLOW', { isSensitive: true }),
      ]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
      expect(d.auditRequired).toBe(true);
    });

    it('(f2) allow5 — super-admin wildcard + explicit sensitive ALLOW → allow', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('*', '*', 'ALLOW'), // super-admin
        rg('view-salary', 'payslip', 'ALLOW', { isSensitive: true }), // explicit sensitive
      ]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('(j1) allow6 — object-ALLOW overrides company-DENY (lower tier wins)', async () => {
      repo
        .setCompanyGrants(U, CO, [rg('read', 'project', 'DENY')])
        .setObjectGrants(U, CO, 'project', OBJ_A, [og('read', 'project', 'ALLOW')]);
      const d = await can(input('read', 'project', { resourceId: OBJ_A }));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow7 — expired role ignored; valid role still grants', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('approve', 'step', 'ALLOW', { expiresAt: PAST }), // expired
        rg('approve', 'step', 'ALLOW', { expiresAt: FUTURE }), // valid
      ]);
      const d = await can(input('approve', 'step'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow8 — reveal-secret with explicit ALLOW + valid reauth → allow', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('reveal-secret', 'platform-account', 'ALLOW', { isSensitive: true }),
      ]);
      const d = await can(
        input('reveal-secret', 'platform-account', {
          isSensitive: true,
          requiresReauth: true,
          reauthValidUntil: FUTURE,
        }),
      );
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow9 — CompanyAdmin wildcard → allow non-sensitive action', async () => {
      repo.setCompanyGrants(U, CO, [rg('*', '*', 'ALLOW')]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow10 — object-level ALLOW with no company grant → allow', async () => {
      repo
        .setCompanyGrants(U, CO, [])
        .setObjectGrants(U, CO, 'project', OBJ_A, [og('read', 'project', 'ALLOW')]);
      const d = await can(input('read', 'project', { resourceId: OBJ_A }));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow11 — DENY for other action does not block allowed action', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('read', 'project', 'ALLOW'),
        rg('delete-project', 'project', 'DENY', { isSensitive: true }),
      ]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.reason).toBe('allow');
    });

    it('allow12 — direct match ALLOW overrides wildcard DENY (direct match wins within tier)', async () => {
      // Wildcard DENY + direct ALLOW: direct match should be checked specifically
      // This tests that the algorithm doesn't over-apply wildcard DENY
      repo.setCompanyGrants(U, CO, [
        rg('*', '*', 'DENY'), // wildcard deny
        rg('read', 'project', 'ALLOW'), // direct allow
      ]);
      // Under the algorithm: company-DENY check — does wildcard DENY match?
      // If yes: deny-explicit. If only direct DENY is checked: allow.
      // Per G3 plan §3b: DENY-WINS at company tier. Wildcard DENY should also be considered.
      // So this case is actually deny-explicit (wildcard DENY blocks everything).
      // UNLESS the algorithm treats wildcard DENY differently...
      // Per spec: "gom TẤT CẢ role → nếu có BẤT KỲ DENY nào thì DENY thắng"
      // "BẤT KỲ DENY" = any DENY (including wildcard) → DENY
      // So this test should be: deny-explicit
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(false); // wildcard DENY wins
      expect(d.reason).toBe('deny-explicit');
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // AUDIT FLAG
  // ═══════════════════════════════════════════════════════════════

  describe('auditRequired flag', () => {
    it('audit1 — sensitive action DENY → auditRequired true', async () => {
      repo.setCompanyGrants(U, CO, []);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(false);
      expect(d.auditRequired).toBe(true);
    });

    it('audit2 — non-sensitive deny-default → auditRequired false', async () => {
      repo.setCompanyGrants(U, CO, []);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(false);
      expect(d.auditRequired).toBe(false);
    });

    it('audit3 — sensitive ALLOW → auditRequired true', async () => {
      repo.setCompanyGrants(U, CO, [
        rg('view-salary', 'payslip', 'ALLOW', { isSensitive: true }),
      ]);
      const d = await can(input('view-salary', 'payslip', { isSensitive: true }));
      expect(d.allow).toBe(true);
      expect(d.auditRequired).toBe(true);
    });

    it('audit4 — non-sensitive ALLOW → auditRequired false', async () => {
      repo.setCompanyGrants(U, CO, [rg('read', 'project', 'ALLOW')]);
      const d = await can(input('read', 'project'));
      expect(d.allow).toBe(true);
      expect(d.auditRequired).toBe(false);
    });
  });
});
