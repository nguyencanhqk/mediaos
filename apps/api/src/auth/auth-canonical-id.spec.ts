import { NotFoundException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

/**
 * S19-OPS-ZOD4-1 — C1.2 (§4.2 + §9.2-1): ca DƯƠNG cho hai lối dùng `uuidSchema` của `auth.service.ts`.
 *
 * Id canonical đang SỐNG trong DB không chuẩn RFC (nibble version/variant = 0): role `…0010/0011`
 * (`0444_…canonical_roles_perms.sql`), company `…0001`, gói `…00a1` (`0231_…saas_scaffold.sql`). zod 4
 * `z.uuid()` từ chối chúng ⇒ nếu cổng auth đổi sang `z.uuid()` thì refresh/reset (company id ở tiền tố
 * token) và thu hồi phiên (session id) sẽ trả 401/404 OAN cho cả công ty. Ca ở đây XANH trên zod 3 và
 * phải ĐỎ với mutant `idSchema → z.uuid()`.
 *
 * Không chạm DB: `withTenant` là mock ném SENTINEL — chỉ đo cổng parse TRƯỚC transaction.
 */
vi.mock("../config/env.schema", () => ({ loadEnv: () => ({}) }));
vi.mock("../db/index", () => ({ db: { execute: vi.fn() } }));

import { AuthService } from "./auth.service";

const CANONICAL_IDS = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000010",
  "00000000-0000-0000-0000-000000000011",
  "00000000-0000-0000-0000-0000000000a1",
  "11111111-1111-1111-1111-111111111111",
] as const;
const JUNK_IDS = ["", "not-a-uuid", "123", "00000000-0000-0000-0000-00000000001"] as const;
const USER_ID = "33333333-3333-3333-3333-333333333333";
const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

class ReachedTenant extends Error {}

function build() {
  const withTenant = vi.fn(async (companyId: string) => {
    throw new ReachedTenant(companyId);
  });
  const tokens = { hashToken: vi.fn((t: string) => `h:${t.length}`) };
  const service = new AuthService(
    { withTenant } as never,
    {} as never,
    tokens as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { getMyApps: async () => [] } as never,
  );
  return { service, withTenant };
}

describe("AuthService — uuidSchema nhận id canonical (ca dương, chống mutant z.uuid())", () => {
  it.each(CANONICAL_IDS)(
    "refresh: company id canonical %s ở tiền tố token ⇒ tới withTenant",
    async (id) => {
      const { service, withTenant } = build();
      await expect(service.refresh(`${id}.opaque-part`)).rejects.toBeInstanceOf(ReachedTenant);
      expect(withTenant).toHaveBeenCalledWith(id, expect.any(Function));
    },
  );

  it.each(JUNK_IDS)("refresh: tiền tố rác %j ⇒ 401 đồng nhất, KHÔNG mở withTenant", async (bad) => {
    const { service, withTenant } = build();
    await expect(service.refresh(`${bad}.opaque-part`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(withTenant).not.toHaveBeenCalled();
  });

  it.each(CANONICAL_IDS)("revokeSession: session id canonical %s ⇒ tới withTenant", async (id) => {
    const { service, withTenant } = build();
    await expect(service.revokeSession(COMPANY_ID, USER_ID, id, {})).rejects.toBeInstanceOf(
      ReachedTenant,
    );
    expect(withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
  });

  it.each(JUNK_IDS)("revokeSession: session id rác %j ⇒ 404, KHÔNG mở withTenant", async (bad) => {
    const { service, withTenant } = build();
    await expect(service.revokeSession(COMPANY_ID, USER_ID, bad, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(withTenant).not.toHaveBeenCalled();
  });
});
