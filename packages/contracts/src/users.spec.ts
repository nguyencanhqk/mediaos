import { describe, expect, it } from "vitest";
import {
  adminUserSchema,
  listUsersQuerySchema,
  suspendUserRequestSchema,
  updateUserRequestSchema,
  USER_STATUSES,
} from "./users";

/**
 * ACCT-2 contract test — DTO admin user CRUD. Trọng tâm:
 *   - adminUserSchema (view) KHÔNG bao giờ chứa secret (passwordHash/tokenHash) — BẤT BIẾN #3.
 *   - updateUserRequestSchema CHỈ field non-sensitive (fullName) — không cho leo thang status/email/role.
 *   - listUsersQuerySchema clamp limit [1..100] default 50; offset ≥0 default 0.
 *   - USER_STATUSES enum ổn định ['active','suspended'].
 *   - suspendUserRequestSchema reason optional, reject body lạ.
 */

describe("USER_STATUSES", () => {
  it("enum ổn định ['active','suspended']", () => {
    expect(USER_STATUSES).toEqual(["active", "suspended"]);
  });
});

describe("adminUserSchema (DTO view)", () => {
  it("KHÔNG khai passwordHash/tokenHash/password trong shape (mask ở server)", () => {
    const keys = Object.keys(adminUserSchema.shape);
    for (const forbidden of [
      "passwordHash",
      "password_hash",
      "tokenHash",
      "token_hash",
      "password",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("có các field non-secret cần thiết", () => {
    const keys = Object.keys(adminUserSchema.shape);
    for (const required of ["id", "email", "fullName", "status", "createdAt"]) {
      expect(keys).toContain(required);
    }
  });

  it("chấp nhận row hợp lệ (status active/suspended; fullName nullable; deletedAt nullable)", () => {
    const ok = adminUserSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      email: "a@b.com",
      fullName: "Nguyễn A",
      status: "active",
      lastLoginAt: null,
      createdAt: "2026-06-19T00:00:00.000Z",
      deletedAt: null,
    });
    expect(ok.success).toBe(true);
  });

  it("từ chối status ngoài enum", () => {
    const bad = adminUserSchema.safeParse({
      id: "11111111-1111-1111-1111-111111111111",
      email: "a@b.com",
      fullName: null,
      status: "deleted",
      lastLoginAt: null,
      createdAt: "2026-06-19T00:00:00.000Z",
      deletedAt: null,
    });
    expect(bad.success).toBe(false);
  });
});

describe("updateUserRequestSchema", () => {
  it("chấp nhận fullName hợp lệ", () => {
    expect(updateUserRequestSchema.safeParse({ fullName: "Tên Mới" }).success).toBe(true);
  });

  it("từ chối fullName rỗng / quá dài", () => {
    expect(updateUserRequestSchema.safeParse({ fullName: "" }).success).toBe(false);
    expect(updateUserRequestSchema.safeParse({ fullName: "x".repeat(201) }).success).toBe(false);
  });

  it("KHÔNG cho field nhạy cảm (status/email/role/passwordHash) leo qua DTO — strict reject", () => {
    // .strict() → từ chối toàn bộ field lạ (fail-fast, không nuốt im lặng) — chống leo thang qua body.
    expect(
      updateUserRequestSchema.safeParse({ fullName: "X", status: "suspended" }).success,
    ).toBe(false);
    expect(
      updateUserRequestSchema.safeParse({ fullName: "X", email: "evil@x.com" }).success,
    ).toBe(false);
    expect(
      updateUserRequestSchema.safeParse({ fullName: "X", passwordHash: "evil" }).success,
    ).toBe(false);
  });
});

describe("listUsersQuerySchema", () => {
  it("default limit=50 offset=0 khi không truyền", () => {
    const parsed = listUsersQuerySchema.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
  });

  it("clamp limit về [1..100]", () => {
    expect(listUsersQuerySchema.parse({ limit: "0" }).limit).toBe(1);
    expect(listUsersQuerySchema.parse({ limit: "500" }).limit).toBe(100);
    expect(listUsersQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });

  it("offset không âm", () => {
    expect(listUsersQuerySchema.parse({ offset: "-5" }).offset).toBe(0);
    expect(listUsersQuerySchema.parse({ offset: "20" }).offset).toBe(20);
  });

  it("status filter chỉ nhận enum hợp lệ; q là string optional", () => {
    expect(listUsersQuerySchema.safeParse({ status: "active" }).success).toBe(true);
    expect(listUsersQuerySchema.safeParse({ status: "bogus" }).success).toBe(false);
    expect(listUsersQuerySchema.safeParse({ q: "nguyen" }).success).toBe(true);
  });
});

describe("suspendUserRequestSchema", () => {
  it("chấp nhận body rỗng (reason optional)", () => {
    expect(suspendUserRequestSchema.safeParse({}).success).toBe(true);
  });

  it("chấp nhận reason string", () => {
    expect(suspendUserRequestSchema.safeParse({ reason: "vi phạm" }).success).toBe(true);
  });

  it("từ chối field lạ (strict)", () => {
    expect(suspendUserRequestSchema.safeParse({ evil: true }).success).toBe(false);
  });
});
