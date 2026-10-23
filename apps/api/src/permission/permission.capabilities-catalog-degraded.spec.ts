/**
 * S14-SEC-CAPWILDCARD-1 — nhánh SUY BIẾN của nguồn catalog cặp dùng khai triển wildcard (plan §4.3, §4.3.1,
 * §4.4; ca §9.2 #15–#17, #20–#22, #23b).
 *
 * Bất biến (kể ĐÚNG chiều, plan §4.4):
 *   - actor KHÔNG giữ wildcard ⇒ KHÔNG đọc catalog (0 lượt) ⇒ không có nhánh suy biến;
 *   - có wildcard · ảnh chụp ĐÃ nạp ≥1 lần · lượt nạp mới ném ⇒ dùng ẢNH CŨ, caps đầy đủ, `logger.error`;
 *   - có wildcard · ảnh chụp CHƯA từng nạp · nạp ném / RỖNG / quá trần ⇒ giữ khoá EXACT, MẤT phần
 *     wildcard, `logger.error` (chiều SIẾT) — KHÔNG phát `*:*` để «giữ hành vi cũ»;
 *   - `getCompanyRoleGrants` ném ⇒ `{}` + log (hợp đồng cũ, không đổi).
 *
 * Logger: spy trên `Logger.prototype.error` — bắt được mọi logger Nest của service lẫn lớp ảnh chụp mới,
 * không ràng buộc bản cài đặt vào một instance logger cụ thể.
 */
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionService } from "./permission.service";
import { CapabilityStubRepo, grant, pair } from "../../test/helpers/capability-stub-repo";

const U = "11111111-1111-4111-8111-111111111111";
const CO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** Trần nạp catalog của plan §4.3.1 (mượn hình dạng `PERMISSION_CATALOG_LOAD_TIMEOUT_MS = 5_000`). */
const CATALOG_LOAD_CEILING_MS = 5_000;
/** TTL ảnh chụp của plan §4.3.1 (300 s). */
const CATALOG_TTL_MS = 300_000;

function catalogRows() {
  return [pair("view", "user", false), pair("view", "role", false), pair("view", "salary", true)];
}

function starKeys(map: Record<string, unknown>): string[] {
  return Object.keys(map).filter((k) => k.includes("*"));
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("S14-SEC-CAPWILDCARD-1 — đọc catalog CHỈ khi có wildcard (§9.2 #20)", () => {
  it("#20 actor KHÔNG wildcard + catalog ném ⇒ catalog KHÔNG được gọi, caps đầy đủ", async () => {
    const repo = new CapabilityStubRepo()
      .withGrants([grant("view", "role"), grant("update", "user")])
      .withCatalogFailure();
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilities(U, CO)).toEqual({ "view:role": true, "update:user": true });
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({
      "view:role": ["Company"],
      "update:user": ["Company"],
    });
    expect(repo.catalogCalls, "actor không giữ wildcard ⇒ 0 lượt đọc catalog").toBe(0);
  });
});

describe("S14-SEC-CAPWILDCARD-1 — ảnh chụp ĐÃ nạp, lượt mới hỏng (§9.2 #15)", () => {
  it("#15 có wildcard · đã nạp · hết TTL · lượt mới ném ⇒ ẢNH CŨ, caps ĐẦY ĐỦ, logger.error", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-23T08:00:00.000Z") });
    const repo = new CapabilityStubRepo().withGrants([grant("*", "*")]).withCatalog(catalogRows());
    const svc = new PermissionService(repo);
    const expected = { "view:user": true, "view:role": true };
    expect(await svc.getCapabilities(U, CO)).toEqual(expected);

    vi.setSystemTime(new Date(Date.now() + CATALOG_TTL_MS + 1_000));
    repo.withCatalogFailure();
    errorSpy.mockClear();

    expect(await svc.getCapabilities(U, CO)).toEqual(expected);
    await vi.advanceTimersByTimeAsync(10);
    expect(repo.catalogCalls, "phải đã thử nạp lại sau TTL").toBeGreaterThanOrEqual(2);
    expect(errorSpy, "nhánh giữ ảnh cũ phải để lại vết").toHaveBeenCalled();
  });
});

describe("S14-SEC-CAPWILDCARD-1 — cold start, catalog hỏng (§9.2 #16, #17, #21, #23b)", () => {
  it("#16 có wildcard · CHƯA nạp · load ném ⇒ khoá exact CÒN, khoá wildcard MẤT, logger.error", async () => {
    const repo = new CapabilityStubRepo()
      .withGrants([grant("*", "*"), grant("update", "user")])
      .withCatalogFailure();
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilities(U, CO)).toEqual({ "update:user": true });
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({ "update:user": ["Company"] });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("#17 y hệt #16 nhưng catalog trả [] — kể cả vế log", async () => {
    const repo = new CapabilityStubRepo()
      .withGrants([grant("*", "*"), grant("update", "user")])
      .withCatalog([]);
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilities(U, CO)).toEqual({ "update:user": true });
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({ "update:user": ["Company"] });
    expect(errorSpy, "catalog RỖNG là suy biến hạ tầng — phải log").toHaveBeenCalled();
  });

  it("#21 load VƯỢT TRẦN 5 s ⇒ rơi nhánh suy biến, không treo; khoá exact còn, không khoá '*'", async () => {
    vi.useFakeTimers();
    const repo = new CapabilityStubRepo()
      .withGrants([grant("*", "*"), grant("update", "user")])
      .withHangingCatalog();
    const svc = new PermissionService(repo);

    let settled = false;
    const pending = svc.getCapabilities(U, CO).finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(CATALOG_LOAD_CEILING_MS + 100);

    expect(settled, "getCapabilities phải trả trong trần nạp catalog").toBe(true);
    const caps = await pending;
    expect(starKeys(caps)).toEqual([]);
    expect(caps).toEqual({ "update:user": true });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("#23b phản ví dụ T2: cold start + catalog ném + actor CHỈ wildcard ⇒ caps = {} (SIẾT tối đa)", async () => {
    const repo = new CapabilityStubRepo().withGrants([grant("*", "*")]).withCatalogFailure();
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilities(U, CO)).toEqual({});
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({});
  });
});

describe("S14-SEC-CAPWILDCARD-1 — hợp đồng lỗi grant cũ không đổi (§9.2 #22)", () => {
  it("#22 getCompanyRoleGrants ném ⇒ {} + logger.error (caps và scopes)", async () => {
    const repo = new CapabilityStubRepo().withGrantFailure().withCatalog(catalogRows());
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilities(U, CO)).toEqual({});
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({});
    expect(errorSpy).toHaveBeenCalled();
  });

  it("gate F4: log lỗi grant giữ stack + chuỗi cause (mã SQLSTATE) — caps VÀ scopes", async () => {
    // Hình dạng lỗi Drizzle: message chung ở ngoài, mã PG nằm trong `cause` (quy ước `serializeErrorChain`).
    const pgError = Object.assign(new Error("permission denied for table role_permissions"), {
      code: "42501",
    });
    const failure = new Error("Failed query: select role grants", { cause: pgError });
    const repo = new CapabilityStubRepo().withCatalog(catalogRows());
    vi.spyOn(repo, "getCompanyRoleGrants").mockRejectedValue(failure);
    vi.spyOn(repo, "getCompanyRoleGrantsWithScope").mockRejectedValue(failure);
    const svc = new PermissionService(repo);

    expect(await svc.getCapabilities(U, CO)).toEqual({});
    expect(await svc.getCapabilityScopes(U, CO)).toEqual({});

    const logged = errorSpy.mock.calls.filter(([message]) =>
      String(message).includes("infrastructure error — returning empty map"),
    );
    expect(logged.map(([message]) => String(message).split("(")[0])).toEqual([
      "getCapabilities",
      "getCapabilityScopes",
    ]);
    for (const [, context] of logged) {
      expect(context).toMatchObject({
        userId: U,
        companyId: CO,
        stack: failure.stack,
        error: {
          message: failure.message,
          cause: { message: pgError.message, code: "42501" },
        },
      });
    }
  });
});
