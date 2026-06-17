import { BadRequestException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TokenService } from "../auth/token.service";
import { API_KEY_TOKEN_PREFIX } from "@mediaos/contracts";
import { ApiKeysService } from "./api-keys.service";
import type { ApiKeyRepository, ApiKeyRow } from "./api-keys.repository";

/**
 * AC-5 ApiKeysService — unit (mock repo + permission). RED-first. Crown-jewel checks:
 *  - create: trả plaintext mok_ ĐÚNG 1 LẦN; lưu HASH (KHÔNG plaintext); validate scope ⊆ catalog ∩ ⊆ grant user.
 *  - create: scope vượt grant user → BadRequest, KHÔNG ghi.
 *  - list:   DTO KHÔNG token material (no token/tokenHash).
 *  - revoke: set revoked_at + audit; key của tenant khác / không tồn tại → NotFound.
 */

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
};
const READ_TASK_PERM = "33333333-3333-3333-3333-333333333333";
const MANAGE_SECRET_PERM = "44444444-4444-4444-4444-444444444444";

function makeRow(over: Partial<ApiKeyRow> = {}): ApiKeyRow {
  return {
    id: "99999999-9999-9999-9999-999999999999",
    companyId: USER.companyId,
    userId: USER.id,
    name: "bot",
    tokenPrefix: "mok_abcd",
    scopePermissionIds: [READ_TASK_PERM],
    expiresAt: null,
    revokedAt: null,
    lastUsedAt: null,
    createdAt: new Date("2026-06-17T00:00:00.000Z"),
    ...over,
  };
}

describe("ApiKeysService", () => {
  let repo: ApiKeyRepository;
  let permission: { userGrantsPermissionIds: ReturnType<typeof vi.fn> };
  let service: ApiKeysService;
  const tokens = new TokenService();

  beforeEach(() => {
    process.env.JWT_SECRET = "k".repeat(40);
    repo = {
      // Only the methods the service calls are mocked.
      insertKey: vi.fn(async (_companyId, input) =>
        makeRow({ scopePermissionIds: input.scopePermissionIds }),
      ),
      listKeys: vi.fn(async () => [makeRow()]),
      revokeKey: vi.fn(async () => makeRow({ revokedAt: new Date() })),
      catalogPermissionIdsExisting: vi.fn(async (ids: string[]) => ids),
    } as unknown as ApiKeyRepository;
    permission = {
      // user holds read:task only (NOT the sensitive manage-secret perm).
      userGrantsPermissionIds: vi.fn(async () => [READ_TASK_PERM]),
    };
    service = new ApiKeysService(repo, tokens, permission as never, { record: vi.fn() } as never);
  });

  it("create: returns plaintext mok_ token ONCE + safe DTO (no token material)", async () => {
    const res = await service.createKey(USER, {
      name: "bot",
      scopePermissionIds: [READ_TASK_PERM],
    });
    expect(res.token.startsWith(API_KEY_TOKEN_PREFIX)).toBe(true);
    expect(Object.keys(res.apiKey)).not.toContain("tokenHash");
    expect(res.apiKey).not.toHaveProperty("token");
    // Repo received a HASH (64 hex), never the plaintext.
    const call = (repo.insertKey as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(call.tokenHash).not.toContain(res.token);
  });

  it("create: scope ⊄ user grant (manage-secret not held) → BadRequest, nothing written", async () => {
    await expect(
      service.createKey(USER, {
        name: "evil",
        scopePermissionIds: [READ_TASK_PERM, MANAGE_SECRET_PERM],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertKey).not.toHaveBeenCalled();
  });

  it("create: scope id not in catalog → BadRequest", async () => {
    (repo.catalogPermissionIdsExisting as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await expect(
      service.createKey(USER, { name: "x", scopePermissionIds: [READ_TASK_PERM] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.insertKey).not.toHaveBeenCalled();
  });

  it("list: maps to DTO WITHOUT token material", async () => {
    const list = await service.listKeys(USER);
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0])).not.toContain("tokenHash");
    expect(list[0]).not.toHaveProperty("token");
    expect(list[0].tokenPrefix).toBe("mok_abcd");
  });

  it("revoke: returns DTO with revokedAt + status revoked", async () => {
    const dto = await service.revokeKey(USER, "99999999-9999-9999-9999-999999999999");
    expect(dto.status).toBe("revoked");
    expect(dto.revokedAt).not.toBeNull();
  });

  it("revoke: key not found / cross-tenant → NotFound", async () => {
    (repo.revokeKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    await expect(
      service.revokeKey(USER, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
