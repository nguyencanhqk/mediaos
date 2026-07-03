import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleAdminService } from "./role-admin.service";
import type { RoleAdminRepository } from "./role-admin.repository";
import type { Role } from "../db/schema";

/**
 * S2-AUTH-BE-6 RoleAdminService — unit (mock repo + permissionService + audit + withTenant). RED
 * viết-TRƯỚC (deny-path trước implementation). Crown-jewel checks:
 *  - createRole/updateRole ghi audit RoleCreated/RoleUpdated objectType='role' objectId=role.id TRONG
 *    cùng tx (append-only).
 *  - system role (is_system=true) → updateRole REJECT (BadRequest), KHÔNG audit, KHÔNG update.
 *  - thiếu quyền create/update:role → 403, KHÔNG chạm DB/audit.
 *  - SCOPE CEILING: assign dataScope='System' → 400, 0 role_permissions insert, 0 audit.
 *  - ANTI-ESCALATION: cặp (action,resourceType) KHÔNG có trong catalog → 400 (KHÔNG 500/FK error), 0 audit.
 *  - thiếu quyền assign:permission → 403, KHÔNG chạm DB/audit.
 *  - assign/revoke permission ghi audit PermissionAssigned/PermissionRevoked objectType='role_permission'
 *    objectId=role.id (KHÔNG null) + before/after chỉ {action,resourceType,effect,dataScope}.
 *  - revoke role không có permission này → NotFound, KHÔNG audit.
 */

const ACTOR = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};
const OTHER_COMPANY_ID = "99999999-9999-9999-9999-999999999999";
const ROLE_ID = "33333333-3333-3333-3333-333333333333";
const PERMISSION_ID = "44444444-4444-4444-4444-444444444444";

function makeRole(over: Partial<Role> = {}): Role {
  return {
    id: ROLE_ID,
    companyId: ACTOR.companyId,
    name: "custom-role",
    description: "Role tuỳ biến",
    isSystem: false,
    requiresTwoFactor: false,
    deletedAt: null,
    ...over,
  };
}

describe("RoleAdminService", () => {
  let repo: RoleAdminRepository;
  let audit: { record: ReturnType<typeof vi.fn> };
  let db: { withTenant: ReturnType<typeof vi.fn> };
  let permissionService: { can: ReturnType<typeof vi.fn> };
  let service: RoleAdminService;
  const TX = Symbol("tx");

  beforeEach(() => {
    audit = { record: vi.fn(async () => undefined) };
    db = {
      withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(TX),
      ),
    };
    // Mặc định ALLOW mọi permission check — từng test override deny-path riêng.
    permissionService = { can: vi.fn(async () => ({ allow: true, reason: "allow" })) };
    repo = {
      findRoleByIdTx: vi.fn(async () => makeRole()),
      insertRoleTx: vi.fn(async () => makeRole()),
      updateRoleTx: vi.fn(async () => makeRole({ name: "renamed" })),
      findPermissionTx: vi.fn(async () => ({ id: PERMISSION_ID, isSensitive: false })),
      findRolePermissionTx: vi.fn(async () => undefined),
      insertRolePermissionTx: vi.fn(async () => ({
        roleId: ROLE_ID,
        permissionId: PERMISSION_ID,
        effect: "ALLOW",
        dataScope: "Company",
      })),
      deleteRolePermissionReturningTx: vi.fn(async () => ({ dataScope: "Company" })),
    } as unknown as RoleAdminRepository;
    service = new RoleAdminService(db as never, permissionService as never, audit as never, repo);
  });

  // ── (A) create role ──────────────────────────────────────────────────────────

  it("createRole: ghi audit 'RoleCreated' objectType 'role' TRONG cùng tx", async () => {
    await service.createRole(ACTOR, { name: "custom-role", description: null });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(TX);
    expect(entry.action).toBe("RoleCreated");
    expect(entry.objectType).toBe("role");
    expect(entry.objectId).toBe(ROLE_ID);
    expect(entry.actorUserId).toBe(ACTOR.id);
  });

  it("createRole: thiếu quyền create:role → 403, KHÔNG chạm DB/audit", async () => {
    permissionService.can.mockResolvedValueOnce({ allow: false, reason: "deny-default" });
    await expect(
      service.createRole(ACTOR, { name: "x", description: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── (A) update role — system role protection ──────────────────────────────────

  it("updateRole: ghi audit 'RoleUpdated' objectType 'role' TRONG cùng tx", async () => {
    await service.updateRole(ACTOR, ROLE_ID, { name: "renamed" });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1].action).toBe("RoleUpdated");
    expect(audit.record.mock.calls[0][1].objectType).toBe("role");
    expect(audit.record.mock.calls[0][1].objectId).toBe(ROLE_ID);
  });

  it("updateRole: role system-defined (is_system=true) → BadRequest, KHÔNG update, KHÔNG audit", async () => {
    (repo.findRoleByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ isSystem: true, companyId: null }),
    );
    await expect(service.updateRole(ACTOR, ROLE_ID, { name: "hacked" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.updateRoleTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("updateRole: role thuộc company khác → NotFound (2-tenant), KHÔNG update/audit", async () => {
    (repo.findRoleByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ companyId: OTHER_COMPANY_ID }),
    );
    await expect(service.updateRole(ACTOR, ROLE_ID, { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.updateRoleTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("updateRole: role không thấy → NotFound, KHÔNG audit", async () => {
    (repo.findRoleByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(service.updateRole(ACTOR, ROLE_ID, { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("updateRole: thiếu quyền update:role → 403, KHÔNG chạm DB/audit", async () => {
    permissionService.can.mockResolvedValueOnce({ allow: false, reason: "deny-default" });
    await expect(service.updateRole(ACTOR, ROLE_ID, { name: "x" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── (B) assign permission — SCOPE CEILING (crown, plan-review 2026-07-01) ─────

  it("assignPermissionToRole: dataScope='System' → 400, 0 role_permissions insert, 0 audit", async () => {
    await expect(
      service.assignPermissionToRole(ACTOR, ROLE_ID, {
        action: "read",
        resourceType: "employee",
        // @ts-expect-error — RED test cố ý gửi 'System' dù type hẹp {Own,Team,Department,Company}.
        dataScope: "System",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(repo.insertRolePermissionTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("assignPermissionToRole: dataScope='Company' (≤ ceiling) → cho phép, insert + audit", async () => {
    await service.assignPermissionToRole(ACTOR, ROLE_ID, {
      action: "read",
      resourceType: "employee",
      dataScope: "Company",
    });
    expect(repo.insertRolePermissionTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  // ── (B) assign permission — ANTI-ESCALATION (crown, CHỐT 2026-07-02) ──────────

  it("assignPermissionToRole: cặp (action,resourceType) KHÔNG có trong catalog → 400 (KHÔNG 500/FK), 0 audit", async () => {
    (repo.findPermissionTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(
      service.assignPermissionToRole(ACTOR, ROLE_ID, {
        action: "bogus-action",
        resourceType: "bogus-resource",
        dataScope: "Company",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertRolePermissionTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("assignPermissionToRole: thiếu quyền assign:permission → 403, KHÔNG chạm DB/audit", async () => {
    permissionService.can.mockResolvedValueOnce({ allow: false, reason: "deny-sensitive" });
    await expect(
      service.assignPermissionToRole(ACTOR, ROLE_ID, {
        action: "read",
        resourceType: "employee",
        dataScope: "Company",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("assignPermissionToRole: gọi permission.can với isSensitive=true (wildcard KHÔNG kế thừa)", async () => {
    await service.assignPermissionToRole(ACTOR, ROLE_ID, {
      action: "read",
      resourceType: "employee",
      dataScope: "Company",
    });
    const callArgs = permissionService.can.mock.calls[0][0];
    expect(callArgs.action).toBe("assign");
    expect(callArgs.resourceType).toBe("permission");
    expect(callArgs.isSensitive).toBe(true);
  });

  it("assignPermissionToRole: role thuộc company khác → NotFound, KHÔNG insert/audit", async () => {
    (repo.findRoleByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ companyId: OTHER_COMPANY_ID }),
    );
    await expect(
      service.assignPermissionToRole(ACTOR, ROLE_ID, {
        action: "read",
        resourceType: "employee",
        dataScope: "Company",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.insertRolePermissionTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("assignPermissionToRole: ghi audit 'PermissionAssigned' objectType 'role_permission' objectId=role.id (KHÔNG null)", async () => {
    await service.assignPermissionToRole(ACTOR, ROLE_ID, {
      action: "read",
      resourceType: "employee",
      dataScope: "Company",
    });
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(TX);
    expect(entry.action).toBe("PermissionAssigned");
    expect(entry.objectType).toBe("role_permission");
    expect(entry.objectId).toBe(ROLE_ID);
    expect(entry.objectId).not.toBeNull();
    expect(entry.after).toEqual({
      action: "read",
      resourceType: "employee",
      effect: "ALLOW",
      dataScope: "Company",
    });
  });

  it("assignPermissionToRole: đã gán cùng scope → no-op idempotent, KHÔNG insert/audit lại", async () => {
    (repo.findRolePermissionTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      dataScope: "Company",
    });
    await service.assignPermissionToRole(ACTOR, ROLE_ID, {
      action: "read",
      resourceType: "employee",
      dataScope: "Company",
    });
    expect(repo.insertRolePermissionTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("assignPermissionToRole: đổi scope (đã có Team → Company) → DELETE + INSERT (KHÔNG UPDATE grant)", async () => {
    (repo.findRolePermissionTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      dataScope: "Team",
    });
    await service.assignPermissionToRole(ACTOR, ROLE_ID, {
      action: "read",
      resourceType: "employee",
      dataScope: "Company",
    });
    expect(repo.deleteRolePermissionReturningTx).toHaveBeenCalledTimes(1);
    expect(repo.insertRolePermissionTx).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0][1].action).toBe("PermissionReassigned");
  });

  // ── (B) revoke permission ──────────────────────────────────────────────────────

  it("revokePermissionFromRole: ghi audit 'PermissionRevoked' objectType 'role_permission' objectId=role.id", async () => {
    await service.revokePermissionFromRole(ACTOR, ROLE_ID, {
      action: "read",
      resourceType: "employee",
    });
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(TX);
    expect(entry.action).toBe("PermissionRevoked");
    expect(entry.objectType).toBe("role_permission");
    expect(entry.objectId).toBe(ROLE_ID);
  });

  it("revokePermissionFromRole: role không giữ permission này → NotFound, KHÔNG audit", async () => {
    (repo.deleteRolePermissionReturningTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      undefined,
    );
    await expect(
      service.revokePermissionFromRole(ACTOR, ROLE_ID, {
        action: "read",
        resourceType: "employee",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("revokePermissionFromRole: thiếu quyền assign:permission → 403, KHÔNG chạm DB/audit", async () => {
    permissionService.can.mockResolvedValueOnce({ allow: false, reason: "deny-sensitive" });
    await expect(
      service.revokePermissionFromRole(ACTOR, ROLE_ID, {
        action: "read",
        resourceType: "employee",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("revokePermissionFromRole: cặp KHÔNG có trong catalog → 400, KHÔNG audit", async () => {
    (repo.findPermissionTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    await expect(
      service.revokePermissionFromRole(ACTOR, ROLE_ID, {
        action: "bogus",
        resourceType: "bogus",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── (E) S2-AUTH-BE-11 — requiresTwoFactor flag trên role thường (RED viết-TRƯỚC) ─
  //  - insertRoleTx/updateRoleTx nhận + set cột requires_two_factor.
  //  - audit RoleCreated/RoleUpdated before/after CHỨA requiresTwoFactor (diff cờ).
  //  - roleWriteResult trả requiresTwoFactor (KHÔNG lộ deletedAt).
  //  - system role (is_system=true) gửi requiresTwoFactor → BadRequest 400, 0 update, 0 audit
  //    (rule isSystem hiện có bao trọn field mới — KHÔNG bypass).

  it("createRole: requiresTwoFactor=true (role thường) → insertRoleTx nhận cờ + audit after chứa cờ", async () => {
    (repo.insertRoleTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ requiresTwoFactor: true }),
    );
    await service.createRole(ACTOR, {
      name: "role-2fa",
      description: null,
      requiresTwoFactor: true,
    });
    expect(repo.insertRoleTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ requiresTwoFactor: true }),
    );
    expect(audit.record.mock.calls[0][1].after).toEqual(
      expect.objectContaining({ requiresTwoFactor: true }),
    );
  });

  it("createRole: KHÔNG gửi requiresTwoFactor → mặc định false (non-breaking client cũ) + audit after=false", async () => {
    await service.createRole(ACTOR, { name: "role-plain", description: null });
    expect(repo.insertRoleTx).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ requiresTwoFactor: false }),
    );
    expect(audit.record.mock.calls[0][1].after).toEqual(
      expect.objectContaining({ requiresTwoFactor: false }),
    );
  });

  it("createRole: roleWriteResult trả requiresTwoFactor + KHÔNG lộ deletedAt", async () => {
    (repo.insertRoleTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ requiresTwoFactor: true }),
    );
    const result = await service.createRole(ACTOR, { name: "r", requiresTwoFactor: true });
    expect(result.requiresTwoFactor).toBe(true);
    expect(result.id).toBe(ROLE_ID);
    expect(result).not.toHaveProperty("deletedAt");
  });

  it("updateRole: role thường bật requiresTwoFactor → updateRoleTx set cờ + audit before/after diff", async () => {
    (repo.findRoleByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ requiresTwoFactor: false }),
    );
    (repo.updateRoleTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ requiresTwoFactor: true }),
    );
    await service.updateRole(ACTOR, ROLE_ID, { requiresTwoFactor: true });
    expect(repo.updateRoleTx).toHaveBeenCalledWith(
      TX,
      ACTOR.companyId,
      ROLE_ID,
      expect.objectContaining({ requiresTwoFactor: true }),
    );
    const entry = audit.record.mock.calls[0][1];
    expect(entry.before.requiresTwoFactor).toBe(false);
    expect(entry.after.requiresTwoFactor).toBe(true);
  });

  it("updateRole: roleWriteResult trả requiresTwoFactor sau khi set + KHÔNG lộ deletedAt", async () => {
    (repo.findRoleByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ requiresTwoFactor: false }),
    );
    (repo.updateRoleTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ requiresTwoFactor: true }),
    );
    const result = await service.updateRole(ACTOR, ROLE_ID, { requiresTwoFactor: true });
    expect(result.requiresTwoFactor).toBe(true);
    expect(result).not.toHaveProperty("deletedAt");
  });

  it("updateRole: system role (is_system=true) gửi requiresTwoFactor → BadRequest 400, 0 update, 0 audit", async () => {
    (repo.findRoleByIdTx as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      makeRole({ isSystem: true, companyId: null }),
    );
    await expect(
      service.updateRole(ACTOR, ROLE_ID, { requiresTwoFactor: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateRoleTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
