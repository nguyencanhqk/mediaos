import { describe, expect, it, vi } from "vitest";
import { DatabaseNotConfiguredError, DatabaseService, InvalidCompanyIdError } from "./db.service";

/**
 * Unit test (KHÔNG cần Postgres) cho lưới chặn của `withTenant`: companyId không hợp lệ phải bị
 * từ chối TRƯỚC khi chạm DB — callback không được chạy, không mở transaction. Hành vi RLS/PgBouncer
 * thật kiểm ở db-tenant.int-spec.ts (Postgres thật, CI).
 */
describe("DatabaseService.withTenant — guard companyId", () => {
  const service = new DatabaseService();

  it.each(["", "   ", "not-a-uuid", "123", "abc-def", "0000"])(
    "ném InvalidCompanyIdError với companyId không phải UUID: %j",
    async (bad) => {
      const fn = vi.fn();
      await expect(service.withTenant(bad, fn)).rejects.toBeInstanceOf(InvalidCompanyIdError);
      expect(fn).not.toHaveBeenCalled();
    },
  );

  /**
   * S19-OPS-ZOD4-1 (§4.2 + §9.2-1) — ca DƯƠNG: id canonical đang sống trong DB (nibble version/variant = 0,
   * không chuẩn RFC) PHẢI qua cổng. zod 4 `z.uuid()` từ chối chúng ⇒ mutant `idSchema → z.uuid()` làm đỏ ca
   * này. Không có DB ở unit ⇒ kết cục hợp lệ là callback chạy (DB có cấu hình) hoặc
   * `DatabaseNotConfiguredError` — KHÔNG BAO GIỜ `InvalidCompanyIdError`.
   */
  it.each([
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000010",
    "00000000-0000-0000-0000-000000000011",
    "00000000-0000-0000-0000-0000000000a1",
    "11111111-1111-1111-1111-111111111111",
  ])("KHÔNG ném InvalidCompanyIdError với id canonical %s", async (id) => {
    const fn = vi.fn(async () => "ran");
    const outcome = await service.withTenant(id, fn).then(
      (v: unknown) => v,
      (e: unknown) => e,
    );
    expect(outcome).not.toBeInstanceOf(InvalidCompanyIdError);
    if (outcome instanceof DatabaseNotConfiguredError) {
      expect(fn).not.toHaveBeenCalled();
    } else {
      expect(outcome).toBe("ran");
    }
  });

  it("KHÔNG chạy callback khi companyId rỗng (không mở transaction)", async () => {
    const fn = vi.fn(async () => "should-not-run");
    await expect(service.withTenant("", fn)).rejects.toBeInstanceOf(InvalidCompanyIdError);
    expect(fn).not.toHaveBeenCalled();
  });
});
