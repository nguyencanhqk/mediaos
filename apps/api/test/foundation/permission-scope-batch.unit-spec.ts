/**
 * S14-PERF-DASHACTOR-1 — cổng cho API batch scope (`PermissionService.resolveStrongestScopes` +
 * `DataScopeService.resolveManyOrNull`), là đường gộp 4 round-trip `getCompanyRoleGrantsWithScope`
 * của `RecruitAccessService.resolveActor` và N round-trip của `filterByGatePair`.
 *
 * ⚠️ **KHÔNG assert «batch === single»**: sau WO này `resolveStrongestScope` GỌI CHÍNH
 * `decideStrongestScope` mà bản batch cũng gọi ⇒ so hai thứ đó là so một hàm với chính nó, ca sẽ xanh
 * kể cả khi ngữ nghĩa sai (memory `same-builder-twice-makes-unit-spec-vacuous`). Mọi ca dưới đây assert
 * **GIÁ TRỊ LITERAL**, mở rộng đúng bộ oracle 8 ca của `src/permission/data-scope.service.spec.ts`
 * (khối `describe("PermissionService.resolveStrongestScope")`) sang trục batch.
 */
import { describe, expect, it, vi } from "vitest";
import type { DataScope } from "@mediaos/contracts";
import { PermissionService } from "../../src/permission/permission.service";
import { DataScopeService } from "../../src/permission/data-scope.service";
import type { DataScopeRepository } from "../../src/permission/data-scope.repository";
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  PermissionCatalogEntry,
} from "../../src/permission/permission.types";

/** Mirror `ScopeMockRepo` của data-scope.service.spec.ts, thêm bộ đếm để ĐO round-trip. */
class CountingScopeRepo implements IPermissionRepository {
  readonly withScopeCalls = vi.fn<() => void>();
  private grants: CompanyRoleGrantWithScope[] = [];
  private fail = false;

  withScopeGrants(grants: CompanyRoleGrantWithScope[]): this {
    this.grants = grants;
    return this;
  }
  withFailure(): this {
    this.fail = true;
    return this;
  }
  async getCompanyRoleGrants(): Promise<CompanyRoleGrant[]> {
    return [];
  }
  async getCompanyRoleGrantsWithScope(): Promise<CompanyRoleGrantWithScope[]> {
    this.withScopeCalls();
    if (this.fail) throw new Error("DB connection failed (simulated)");
    return this.grants;
  }
  async getObjectGrants(): Promise<ObjectGrant[]> {
    return [];
  }
  async getObjectGrantsBatch(): Promise<Map<string, ObjectGrant[]>> {
    return new Map();
  }
  async getPermissionsByIds(): Promise<PermissionCatalogEntry[]> {
    return [];
  }
  async getAllPermissions(): Promise<PermissionCatalogEntry[]> {
    return [];
  }
}

function g(
  action: string,
  resourceType: string,
  dataScope: string,
  effect: "ALLOW" | "DENY" = "ALLOW",
  isSensitive = false,
): CompanyRoleGrantWithScope {
  return { action, resourceType, isSensitive, effect, dataScope, expiresAt: null };
}

const svcOf = (repo: CountingScopeRepo): PermissionService => new PermissionService(repo);

describe("PermissionService.resolveStrongestScopes — ma trận LITERAL", () => {
  it("trả đúng một kết quả cho MỖI request, theo CHỈ SỐ, trên 6 luật PIN cùng một lượt", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([
      // strongest-of-many
      g("view", "employee", "Own"),
      g("view", "employee", "Department"),
      // deny-override (wildcard-aware) trên cặp KHÁC
      g("view", "task", "Company"),
      g("*", "task", "Company", "DENY"),
      // exact > wildcard, và wildcard KHÔNG được nâng cấp
      g("view", "project", "Team"),
      g("*", "*", "Company"),
      // cặp sensitive có grant exact
      g("view", "salary", "Company", "ALLOW", true),
    ]);

    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view", resourceType: "employee" }, // [0] mạnh nhất trong nhiều exact ALLOW
      { action: "view", resourceType: "task" }, // [1] DENY wildcard-aware chặn
      { action: "view", resourceType: "project" }, // [2] exact Team thắng *:* Company
      { action: "view", resourceType: "note" }, // [3] chỉ *:* khớp — giữ NGUYÊN Company, không nâng System
      { action: "view", resourceType: "salary", isSensitive: true }, // [4] sensitive + exact ⇒ có scope
      { action: "view", resourceType: "secret", isSensitive: true }, // [5] sensitive + chỉ *:* ⇒ null
    ]);

    expect(out).toEqual([
      "Department",
      null,
      "Team",
      "Company",
      "Company",
      null,
    ] satisfies (DataScope | null)[]);
  });

  it("cặp không có grant nào khớp ⇒ null (không phải undefined, không phải phần tử thiếu)", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([g("view", "task", "Own")]);
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view", resourceType: "employee" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBeNull();
    // Ghim ĐÚNG cái bẫy §2a: caller kiểm deny bằng `!== null`; một `undefined` lọt qua là ALLOW.
    expect(out[0]).not.toBeUndefined();
  });

  it("grant HẾT HẠN bị lọc ở tầng decide (repo có thể trả hàng cũ từ cache)", async () => {
    const expired: CompanyRoleGrantWithScope = {
      action: "view",
      resourceType: "employee",
      isSensitive: false,
      effect: "ALLOW",
      dataScope: "Company",
      expiresAt: new Date(Date.now() - 60_000),
    };
    const repo = new CountingScopeRepo().withScopeGrants([expired]);
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view", resourceType: "employee" },
    ]);
    expect(out).toEqual([null]);
  });
});

describe("PermissionService.resolveStrongestScopes — cổng sensitive vs wildcard (done_when #3)", () => {
  // ⚠️ Ca DENY dưới đây CHỈ có ý nghĩa khi ca ALLOW đối chứng cũng xanh: nếu fixture dựng sai và MỌI
  // request đều ra null thì ca DENY xanh-RỖNG (memory `deny-cases-vacuous-without-allow-case`).
  it("wildcard *:* KHÔNG thoả cặp sensitive ⇒ null", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([g("*", "*", "Company")]);
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view-line", resourceType: "payroll-period", isSensitive: true },
      { action: "view", resourceType: "candidate", isSensitive: true },
    ]);
    expect(out).toEqual([null, null]);
  });

  it("ĐỐI CHỨNG — cùng cặp sensitive, grant EXACT ⇒ có scope (ca DENY trên không rỗng)", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([
      g("view-line", "payroll-period", "Company", "ALLOW", true),
      g("view", "candidate", "Company", "ALLOW", true),
    ]);
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view-line", resourceType: "payroll-period", isSensitive: true },
      { action: "view", resourceType: "candidate", isSensitive: true },
    ]);
    expect(out).toEqual(["Company", "Company"]);
  });

  it("cờ sensitive suy từ HÀNG GRANT: cặp không khai isSensitive nhưng grant is_sensitive=true vẫn ép exact", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([
      g("*", "*", "Company"),
      g("view", "salary", "Own", "ALLOW", true),
    ]);
    // Không truyền isSensitive ⇒ engine tự bật vì hàng exact khớp mang is_sensitive=true ⇒ wildcard bị loại.
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view", resourceType: "salary" },
    ]);
    expect(out).toEqual(["Own"]);
  });

  it("HAI request CÙNG cặp khác isSensitive ⇒ HAI kết quả RIÊNG theo chỉ số (không đè nhau)", async () => {
    // Đây là hình dạng THẬT ở RecruitAccessService: routeKey 'candidateUpdate' hỏi update:candidate ở
    // vai cặp-route, và cờ mask PII hỏi CÙNG cặp ở vai thứ hai. Tra theo khoá `action:resourceType`
    // thì bản này đè bản kia — mảng theo chỉ số không có chỗ cho lỗi đó.
    const repo = new CountingScopeRepo().withScopeGrants([g("*", "*", "Company")]);
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "update", resourceType: "candidate", isSensitive: false },
      { action: "update", resourceType: "candidate", isSensitive: true },
    ]);
    expect(out).toEqual(["Company", null]);
  });
});

describe("PermissionService.resolveStrongestScopes — đo round-trip (done_when #2)", () => {
  it("N cặp = ĐÚNG 1 lượt đọc grant", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([g("view", "employee", "Company")]);
    await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view", resourceType: "employee" },
      { action: "view", resourceType: "interview" },
      { action: "update", resourceType: "candidate", isSensitive: true },
      { action: "manage", resourceType: "offer", isSensitive: false },
    ]);
    // `toHaveBeenCalledTimes(1)` — KHÔNG `≤N`: một assert lỏng sẽ xanh cả khi refactor tuột về 4 query.
    expect(repo.withScopeCalls).toHaveBeenCalledTimes(1);
  });

  it("BASELINE — 4 lời gọi ĐƠN vẫn là 4 lượt đọc (chứng minh ca trên đo thật, không phải repo im lặng)", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([g("view", "employee", "Company")]);
    const svc = svcOf(repo);
    await svc.resolveStrongestScope("u1", "co1", "view", "employee");
    await svc.resolveStrongestScope("u1", "co1", "view", "interview");
    await svc.resolveStrongestScope("u1", "co1", "update", "candidate", { isSensitive: true });
    await svc.resolveStrongestScope("u1", "co1", "manage", "offer", { isSensitive: false });
    expect(repo.withScopeCalls).toHaveBeenCalledTimes(4);
  });

  it("danh sách RỖNG ⇒ 0 lượt đọc (short-circuit TRƯỚC repository)", async () => {
    // Không có nó, `filterByGatePair` đi từ 0 → 1 query cho dashboard nhân viên thường (0 widget khai sàn).
    const repo = new CountingScopeRepo().withScopeGrants([g("view", "employee", "Company")]);
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", []);
    expect(out).toEqual([]);
    expect(repo.withScopeCalls).toHaveBeenCalledTimes(0);
  });
});

describe("PermissionService.resolveStrongestScopes — fail-closed TOÀN LƯỢT", () => {
  it("lỗi hạ tầng ⇒ mảng ĐỦ ĐỘ DÀI toàn null (không rỗng, không partial, không undefined)", async () => {
    const repo = new CountingScopeRepo().withFailure();
    const out = await svcOf(repo).resolveStrongestScopes("u1", "co1", [
      { action: "view", resourceType: "employee" },
      { action: "view", resourceType: "candidate", isSensitive: true },
      { action: "manage", resourceType: "offer" },
    ]);
    expect(out).toHaveLength(3);
    expect(out).toEqual([null, null, null]);
    // Mảng rỗng cũng "toàn null" khi đọc bằng [i] — nên phải ghim ĐỘ DÀI, không chỉ nội dung.
    expect(out.every((s) => s === null)).toBe(true);
  });
});

describe("DataScopeService.resolveManyOrNull — passthrough KHÔNG ném", () => {
  const stubScopeRepo = {
    getRequesterScopeContext: async () => ({
      orgUnitId: null,
      managedUserIds: [],
      headedOrgUnitIds: [],
    }),
  } as unknown as DataScopeRepository;

  it("trả null cho cặp thiếu grant thay vì ForbiddenException (khác resolveAndAssert)", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([g("view", "employee", "Company")]);
    const ds = new DataScopeService(svcOf(repo), stubScopeRepo);
    await expect(
      ds.resolveManyOrNull("u1", "co1", [
        { action: "view", resourceType: "employee" },
        { action: "view", resourceType: "nothing-granted" },
      ]),
    ).resolves.toEqual(["Company", null]);
  });

  it("ĐỐI CHỨNG — resolveAndAssert trên CÙNG cặp thiếu grant vẫn NÉM (hợp đồng hai hàm khác nhau)", async () => {
    const repo = new CountingScopeRepo().withScopeGrants([g("view", "employee", "Company")]);
    const ds = new DataScopeService(svcOf(repo), stubScopeRepo);
    await expect(ds.resolveAndAssert("u1", "co1", "view", "nothing-granted")).rejects.toThrowError(
      "AUTH-ERR-FORBIDDEN: out of permission scope",
    );
  });
});
