/**
 * G6-2 PR-B ROUND 1 — RED integration suite: BreakGlassGrantService lifecycle (request → approve → revoke).
 *
 * Chạy trên Postgres THẬT (mediaos_app role, RLS enforced). Tự skip khi thiếu DATABASE_URL (skipIf(!hasDb)).
 *
 * RED sources (vì sao mỗi case ĐỎ tới khi GREEN xong):
 *   BreakGlassGrantService.{requestGrant,approveGrant,revokeGrant} ném NOT_IMPLEMENTED:b5r1.
 *   Mỗi test khẳng định KẾT QUẢ MONG ĐỢI sau GREEN (ForbiddenException / DTO 'pending'/'active' / 409 …).
 *   Vì method ném thay vì trả giá trị → assertion fail → ĐỎ đúng lý do.
 *
 * SoD ép Ở DB (verify hành vi, KHÔNG query CHECK tay — psql không trên PATH):
 *   • 2 người duyệt KHÁC NHAU mới 'active' (1 người / tự-duyệt → KHÔNG active).
 *   • duyệt-trùng cùng người → 409 (UNIQUE), COUNT(DISTINCT) giữ nguyên.
 *   • grant hết hạn / chéo tenant / non-approver → deny.
 */

import { randomUUID } from "node:crypto";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BreakGlassGrantService } from "../../src/break-glass/break-glass-grant.service";
import type { RequestUser } from "../../src/break-glass/break-glass-grant.service";
import { BreakGlassRepository } from "../../src/break-glass/break-glass.repository";
import { DatabaseService } from "../../src/db/db.service";
import { PermissionService } from "../../src/permission/permission.service";
import { PermissionRepository } from "../../src/permission/permission.repository";
import { AuditService } from "../../src/events/audit.service";
import { directPool, hasDb } from "../helpers/integration-db";
import {
  cleanupTenants,
  seedBreakGlassGrant,
  seedCompany,
  seedPermissionCatalog,
  seedPlatformAccount,
  seedRole,
  seedRolePermission,
  seedUser,
  seedUserRole,
  type SeededTenant,
} from "../helpers/seed";

const RESOURCE = "break-glass";
const ACTION_REQUEST = "request-break-glass";
const ACTION_APPROVE = "approve-break-glass";
const ACTION_REVOKE = "revoke-break-glass";

describe.skipIf(!hasDb)("G6-2 PR-B break-glass grant lifecycle — RED deny-path suite", () => {
  const direct = directPool();
  let A: SeededTenant;
  let B: SeededTenant;
  let requester: string; // A: has request + approve + revoke perms (for self-approve SoD test)
  let approver1: string; // A: has approve perm
  let approver2: string; // A: has approve perm
  let outsider: string; // A: NO perms (non-approver / non-requester)
  let userB: string; // B: has approve perm in company B (cross-tenant test)
  let accountA: string;
  let accountB: string;
  let svc: BreakGlassGrantService;

  beforeAll(async () => {
    const db = new DatabaseService();
    const permissions = new PermissionService(new PermissionRepository(db));
    svc = new BreakGlassGrantService(
      db,
      new BreakGlassRepository(db),
      permissions,
      new AuditService(),
    );

    A = await seedCompany(direct, "bgA");
    B = await seedCompany(direct, "bgB");
    requester = await seedUser(direct, A.companyId, `bg-req-${randomUUID().slice(0, 8)}@x.test`);
    approver1 = await seedUser(direct, A.companyId, `bg-a1-${randomUUID().slice(0, 8)}@x.test`);
    approver2 = await seedUser(direct, A.companyId, `bg-a2-${randomUUID().slice(0, 8)}@x.test`);
    outsider = await seedUser(direct, A.companyId, `bg-out-${randomUUID().slice(0, 8)}@x.test`);
    userB = await seedUser(direct, B.companyId, `bg-b-${randomUUID().slice(0, 8)}@x.test`);
    accountA = await seedPlatformAccount(direct, A.companyId);
    accountB = await seedPlatformAccount(direct, B.companyId);

    // permission catalog rows already seeded by mig 0200; seedPermissionCatalog upserts → returns ids.
    const permRequest = await seedPermissionCatalog(direct, ACTION_REQUEST, RESOURCE, true);
    const permApprove = await seedPermissionCatalog(direct, ACTION_APPROVE, RESOURCE, true);
    const permRevoke = await seedPermissionCatalog(direct, ACTION_REVOKE, RESOURCE, true);

    // requester role (A): request + approve + revoke (approve included so self-approve fails on SoD, not perm).
    const reqRole = await seedRole(direct, A.companyId, `bg-req-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, reqRole, permRequest, "ALLOW");
    await seedRolePermission(direct, reqRole, permApprove, "ALLOW");
    await seedRolePermission(direct, reqRole, permRevoke, "ALLOW");
    await seedUserRole(direct, requester, reqRole, A.companyId);

    // approver role (A): approve only → assigned to approver1 + approver2.
    const aprRole = await seedRole(direct, A.companyId, `bg-apr-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, aprRole, permApprove, "ALLOW");
    await seedUserRole(direct, approver1, aprRole, A.companyId);
    await seedUserRole(direct, approver2, aprRole, A.companyId);

    // userB role (B): approve in company B (for cross-tenant deny).
    const bRole = await seedRole(direct, B.companyId, `bg-b-role-${randomUUID().slice(0, 8)}`);
    await seedRolePermission(direct, bRole, permApprove, "ALLOW");
    await seedUserRole(direct, userB, bRole, B.companyId);
    // outsider: intentionally NO role/permission.
  });

  afterAll(async () => {
    await cleanupTenants(direct, [A.companyId, B.companyId]);
    await direct.end();
  });

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function ctx(userId: string, companyId: string): RequestUser {
    return { id: userId, companyId };
  }

  async function invoke<T>(fn: () => T | Promise<T>): Promise<{ result?: T; error?: Error }> {
    try {
      return { result: await fn() };
    } catch (e) {
      return { error: e instanceof Error ? e : new Error(String(e)) };
    }
  }

  /** Seed a fresh pending grant (requester=requester, accountA) via service-independent direct insert. */
  async function freshGrant(
    overrides?: Partial<Parameters<typeof seedBreakGlassGrant>[1]>,
  ): Promise<string> {
    return seedBreakGlassGrant(direct, {
      companyId: A.companyId,
      platformAccountId: accountA,
      requesterUserId: requester,
      ...overrides,
    });
  }

  async function grantStatus(grantId: string): Promise<string | undefined> {
    const r = await direct.query("SELECT status FROM break_glass_grants WHERE id = $1", [grantId]);
    return r.rows[0]?.status as string | undefined;
  }

  async function approvalCount(grantId: string): Promise<number> {
    const r = await direct.query(
      "SELECT count(DISTINCT approver_user_id)::int AS n FROM break_glass_approvals WHERE grant_id = $1",
      [grantId],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  async function auditCount(grantId: string, action: string): Promise<number> {
    const r = await direct.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE object_type = 'break_glass_access' AND object_id = $1 AND action = $2`,
      [grantId, action],
    );
    return Number(r.rows[0]?.n ?? 0);
  }

  // ─── REQUEST ────────────────────────────────────────────────────────────────

  it("RED 1 — requestGrant (permitted) returns a pending DTO with 0 approvals (empty-approver-set ≠ active)", async () => {
    const { result } = await invoke(() =>
      svc.requestGrant(ctx(requester, A.companyId), {
        platformAccountId: accountA,
        reason: "incident #42 — locked out of channel",
        ttlSeconds: 3600,
      }),
    );
    expect(result).toBeDefined();
    expect(result?.status).toBe("pending");
    expect(result?.approvalCount).toBe(0);
    expect(result?.requiredApprovals).toBeGreaterThanOrEqual(2);
    if (result)
      expect(await auditCount(result.id, "break_glass_access.requested")).toBeGreaterThan(0);
  });

  it("RED 2 — requestGrant without request permission → ForbiddenException", async () => {
    const { error } = await invoke(() =>
      svc.requestGrant(ctx(outsider, A.companyId), {
        platformAccountId: accountA,
        reason: "no perm",
        ttlSeconds: 3600,
      }),
    );
    expect(error).toBeInstanceOf(ForbiddenException);
  });

  it("RED 3 — requestGrant on a cross-tenant account → throws (account not in tenant, RLS)", async () => {
    const { error } = await invoke(() =>
      svc.requestGrant(ctx(requester, A.companyId), {
        platformAccountId: accountB,
        reason: "cross-tenant account",
        ttlSeconds: 3600,
      }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain("NOT_IMPLEMENTED");
  });

  // ─── APPROVE (SoD) ────────────────────────────────────────────────────────────

  it("RED 4 — approve by non-approver (no permission) → ForbiddenException", async () => {
    const grantId = await freshGrant();
    const { error } = await invoke(() => svc.approveGrant(ctx(outsider, A.companyId), grantId));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(await grantStatus(grantId)).toBe("pending");
  });

  it("RED 5 — self-approval (approver == requester) → ForbiddenException (SoD), stays pending", async () => {
    const grantId = await freshGrant();
    const { error } = await invoke(() => svc.approveGrant(ctx(requester, A.companyId), grantId));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(await grantStatus(grantId)).toBe("pending");
    expect(await approvalCount(grantId)).toBe(0);
    // Deny phải để lại vết audit (ghi NGOÀI tx duyệt — KHÔNG bị rollback cùng throw).
    expect(await auditCount(grantId, "break_glass_access.denied")).toBeGreaterThan(0);
  });

  it("RED 6 — a single distinct approval is NOT enough → grant stays pending (count 1 < 2)", async () => {
    const grantId = await freshGrant();
    const { result } = await invoke(() => svc.approveGrant(ctx(approver1, A.companyId), grantId));
    expect(result).toBeDefined();
    expect(result?.status).toBe("pending");
    expect(result?.approvalCount).toBe(1);
    expect(await grantStatus(grantId)).toBe("pending");
  });

  it("RED 7 — TWO distinct approvers flip the grant to active (SoD threshold met)", async () => {
    const grantId = await freshGrant();
    await invoke(() => svc.approveGrant(ctx(approver1, A.companyId), grantId));
    const { result } = await invoke(() => svc.approveGrant(ctx(approver2, A.companyId), grantId));
    expect(result).toBeDefined();
    expect(result?.status).toBe("active");
    expect(result?.approvalCount).toBe(2);
    expect(await grantStatus(grantId)).toBe("active");
    expect(await auditCount(grantId, "break_glass_access.activated")).toBeGreaterThan(0);
  });

  it("RED 8 — same approver twice → ConflictException; DISTINCT count stays 1; not active", async () => {
    const grantId = await freshGrant();
    await invoke(() => svc.approveGrant(ctx(approver1, A.companyId), grantId));
    const { error } = await invoke(() => svc.approveGrant(ctx(approver1, A.companyId), grantId));
    expect(error).toBeInstanceOf(ConflictException);
    expect(await approvalCount(grantId)).toBe(1);
    expect(await grantStatus(grantId)).toBe("pending");
  });

  it("RED 9 — approving an EXPIRED grant → throws (deny), stays pending", async () => {
    // expires_at in the past + created_at further past so the ttl CHECK (expires_at > created_at) passes.
    const grantId = await freshGrant({
      createdAt: new Date(Date.now() - 7200_000).toISOString(),
      expiresAt: new Date(Date.now() - 3600_000).toISOString(),
    });
    const { error } = await invoke(() => svc.approveGrant(ctx(approver1, A.companyId), grantId));
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain("NOT_IMPLEMENTED");
    expect(await grantStatus(grantId)).toBe("pending");
    // Deny "expired" phải để lại vết audit (ghi NGOÀI tx duyệt đã rollback).
    expect(await auditCount(grantId, "break_glass_access.denied")).toBeGreaterThan(0);
  });

  it("RED 10 — cross-tenant approve (company B user on company A grant) → throws (RLS hides grant)", async () => {
    const grantId = await freshGrant();
    const { error } = await invoke(() => svc.approveGrant(ctx(userB, B.companyId), grantId));
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).not.toContain("NOT_IMPLEMENTED");
    expect(await approvalCount(grantId)).toBe(0);
  });

  // ─── REVOKE ─────────────────────────────────────────────────────────────────

  it("RED 11 — revoke (permitted) flips the grant to revoked", async () => {
    const grantId = await freshGrant();
    const { result } = await invoke(() => svc.revokeGrant(ctx(requester, A.companyId), grantId));
    expect(result).toBeDefined();
    expect(result?.status).toBe("revoked");
    expect(await grantStatus(grantId)).toBe("revoked");
  });

  it("RED 12 — revoke without revoke permission → ForbiddenException", async () => {
    const grantId = await freshGrant();
    const { error } = await invoke(() => svc.revokeGrant(ctx(outsider, A.companyId), grantId));
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(await grantStatus(grantId)).toBe("pending");
  });
});
