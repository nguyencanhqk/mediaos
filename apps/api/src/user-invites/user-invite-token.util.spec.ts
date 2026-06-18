import { describe, expect, it } from "vitest";
import {
  generateInviteToken,
  hashInviteToken,
  inviteTokenHashEquals,
} from "./user-invite-token.util";

describe("user-invite-token.util", () => {
  it("generateInviteToken trả token base64url + tokenHash sha256-hex khớp", () => {
    const { token, tokenHash } = generateInviteToken();
    // token là base64url (không '+', '/', '=').
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40); // 32 byte → ~43 ký tự base64url.
    // hash là 64 hex (sha256).
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("hashInviteToken deterministic + KHÁC nhau cho token khác", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abd"));
  });

  it("token sinh ngẫu nhiên — 2 lần KHÁC nhau", () => {
    expect(generateInviteToken().token).not.toBe(generateInviteToken().token);
  });

  it("inviteTokenHashEquals: khớp → true, lệch/độ-dài-khác → false", () => {
    const h = hashInviteToken("xyz");
    expect(inviteTokenHashEquals(h, h)).toBe(true);
    expect(inviteTokenHashEquals(h, hashInviteToken("zzz"))).toBe(false);
    expect(inviteTokenHashEquals(h, "short")).toBe(false);
  });
});
