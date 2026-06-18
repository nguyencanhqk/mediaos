import { describe, expect, it } from "vitest";
import {
  acceptInviteSchema,
  createUserInviteSchema,
  USER_INVITE_STATUSES,
  userInviteSchema,
} from "./user-invite";

/**
 * CS-10 contract test — validate biên (reject-path là chính). companyId KHÔNG ở body invite (lấy từ JWT);
 * accept yêu cầu companySlug + token + password (≥8). DTO view KHÔNG có token/hash/password.
 */

describe("createUserInviteSchema", () => {
  it("chấp nhận email + fullName hợp lệ", () => {
    expect(
      createUserInviteSchema.safeParse({ email: "a@b.com", fullName: "Nguyễn A" }).success,
    ).toBe(true);
  });

  it.each([
    { email: "not-an-email", fullName: "X" },
    { email: "a@b.com", fullName: "" },
    { email: "a@b.com" },
  ])("từ chối input rác %o", (v) => {
    expect(createUserInviteSchema.safeParse(v).success).toBe(false);
  });

  it("KHÔNG nhận companyId từ body (strip — không có trong schema output)", () => {
    const parsed = createUserInviteSchema.parse({
      email: "a@b.com",
      fullName: "X",
      companyId: "evil",
    } as never);
    expect(parsed).not.toHaveProperty("companyId");
  });
});

describe("acceptInviteSchema", () => {
  it("chấp nhận companySlug + token + password ≥8", () => {
    expect(
      acceptInviteSchema.safeParse({ companySlug: "demo", token: "tok", password: "Sup3rSecret" })
        .success,
    ).toBe(true);
  });

  it.each([
    { companySlug: "demo", token: "tok", password: "short" }, // <8
    { companySlug: "", token: "tok", password: "longenough" },
    { companySlug: "demo", token: "", password: "longenough" },
  ])("từ chối %o", (v) => {
    expect(acceptInviteSchema.safeParse(v).success).toBe(false);
  });
});

describe("userInviteSchema (DTO view)", () => {
  it("KHÔNG khai token/tokenHash/password trong shape", () => {
    const keys = Object.keys(userInviteSchema.shape);
    for (const forbidden of ["token", "tokenHash", "password", "passwordHash"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("statuses ổn định", () => {
    expect(USER_INVITE_STATUSES).toEqual(["pending", "accepted", "approved", "rejected"]);
  });
});
