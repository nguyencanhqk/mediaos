import { describe, expect, it, vi } from "vitest";
import { DatabaseService, InvalidCompanyIdError } from "./db.service";

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

  it("KHÔNG chạy callback khi companyId rỗng (không mở transaction)", async () => {
    const fn = vi.fn(async () => "should-not-run");
    await expect(service.withTenant("", fn)).rejects.toBeInstanceOf(InvalidCompanyIdError);
    expect(fn).not.toHaveBeenCalled();
  });
});
