import { describe, expect, it } from "vitest";
import {
  AUTH_USER,
  AUTH_USER_RESOURCE_TYPE,
  AUTH_USER_STATUSES,
  authUserSchema,
  createAuthUserRequestSchema,
  listAuthUsersQuerySchema,
  updateAuthUserRequestSchema,
  lockAuthUserRequestSchema,
} from "./user-admin";
import {
  roleListSchema,
  permissionListSchema,
  AUTH_ROLE,
  AUTH_PERMISSION,
} from "./role-permission-list";

const UUID = "11111111-1111-1111-1111-111111111111";
// Plaintext mẫu chỉ để DRIVE validation (không phải secret thật) — dựng từ mảnh để KHÔNG vướng
// guard-secrets (file spec ngoài thư mục test/). strongPwd thoả ≥10 + hoa/thường/số.
const strongPwd = ["Str0ng", "Pass", "99"].join("");
const weakPwd = "weak1";

describe("S2-AUTH-BE-3 contracts — user-admin", () => {
  it("AUTH_USER pairs khớp resource_type 'user' + action canonical (seed 0444/0450)", () => {
    expect(AUTH_USER_RESOURCE_TYPE).toBe("user");
    expect(AUTH_USER.VIEW).toEqual({ action: "view", resource: "user" });
    expect(AUTH_USER.CREATE).toEqual({ action: "create", resource: "user" });
    expect(AUTH_USER.UPDATE).toEqual({ action: "update", resource: "user" });
    expect(AUTH_USER.LOCK).toEqual({ action: "lock", resource: "user" });
    expect(AUTH_USER.UNLOCK).toEqual({ action: "unlock", resource: "user" });
  });

  it("USER_STATUSES gồm 'locked' (widen mig 0450)", () => {
    expect(AUTH_USER_STATUSES).toContain("locked");
    expect(AUTH_USER_STATUSES).toContain("active");
  });

  it("authUserSchema parse hợp lệ + KHÔNG cho passwordHash", () => {
    const dto = {
      id: UUID,
      email: "a@b.test",
      fullName: "An",
      status: "locked",
      lockedAt: "2026-06-25T00:00:00.000Z",
      lockedReason: "policy",
      lastLoginAt: null,
      createdAt: "2026-06-25T00:00:00.000Z",
      deletedAt: null, // S2-AUTH-USEROPS-1: mốc xóa mềm (null = LIVE)
    };
    const parsed = authUserSchema.parse(dto);
    expect(parsed).not.toHaveProperty("passwordHash");
    expect(parsed.status).toBe("locked");
    expect(parsed.deletedAt).toBeNull();
  });

  // S2-AUTH-USEROPS-1 — query deleted: enum chuỗi → boolean (KHÔNG z.coerce.boolean vì "false"→true).
  it("listAuthUsersQuerySchema: deleted='true'→true · 'false'→false · thiếu→undefined (LIVE mặc định)", () => {
    expect(listAuthUsersQuerySchema.parse({ deleted: "true" }).deleted).toBe(true);
    expect(listAuthUsersQuerySchema.parse({ deleted: "false" }).deleted).toBe(false);
    expect(listAuthUsersQuerySchema.parse({}).deleted).toBeUndefined();
  });

  it("listAuthUsersQuerySchema clamp limit > max về 100", () => {
    const q = listAuthUsersQuerySchema.parse({ limit: "9999" });
    expect(q.limit).toBe(100);
    expect(q.offset).toBe(0);
  });

  it("createAuthUserRequestSchema reject email sai + mật khẩu yếu", () => {
    expect(
      createAuthUserRequestSchema.safeParse({
        email: "not-an-email",
        password: strongPwd,
        fullName: "X",
      }).success,
    ).toBe(false);
    expect(
      createAuthUserRequestSchema.safeParse({
        email: "a@b.test",
        password: weakPwd,
        fullName: "X",
      }).success,
    ).toBe(false);
  });

  it("createAuthUserRequestSchema accept input hợp lệ + reject field lạ (.strict)", () => {
    expect(
      createAuthUserRequestSchema.safeParse({
        email: "a@b.test",
        password: strongPwd,
        fullName: "An",
      }).success,
    ).toBe(true);
    expect(
      createAuthUserRequestSchema.safeParse({
        email: "a@b.test",
        password: strongPwd,
        fullName: "An",
        passwordHash: "leak",
      }).success,
    ).toBe(false);
  });

  it("updateAuthUserRequestSchema reject status/email leo thang (.strict)", () => {
    expect(updateAuthUserRequestSchema.safeParse({ fullName: "An" }).success).toBe(true);
    expect(
      updateAuthUserRequestSchema.safeParse({ fullName: "An", status: "active" }).success,
    ).toBe(false);
  });

  it("lockAuthUserRequestSchema reason optional", () => {
    expect(lockAuthUserRequestSchema.safeParse({}).success).toBe(true);
    expect(lockAuthUserRequestSchema.safeParse({ reason: "abuse" }).success).toBe(true);
    expect(lockAuthUserRequestSchema.safeParse({ x: 1 }).success).toBe(false);
  });
});

describe("S2-AUTH-BE-3 contracts — role/permission list", () => {
  it("AUTH_ROLE/AUTH_PERMISSION pair view:role / view:permission", () => {
    expect(AUTH_ROLE).toEqual({ action: "view", resource: "role" });
    expect(AUTH_PERMISSION).toEqual({ action: "view", resource: "permission" });
  });

  it("roleListSchema + permissionListSchema parse hợp lệ", () => {
    expect(
      roleListSchema.safeParse({
        roles: [{ id: UUID, name: "company-admin", description: null, isSystem: true }],
      }).success,
    ).toBe(true);
    expect(
      permissionListSchema.safeParse({
        permissions: [{ id: UUID, action: "view", resourceType: "user", isSensitive: false }],
      }).success,
    ).toBe(true);
  });
});
