/**
 * S14-PERF-DASHACTOR-1 — **số đo** round-trip `getCompanyRoleGrantsWithScope` (done_when #2:
 * «Đo số round-trip TRƯỚC/SAU cho mỗi widget bằng spy đếm lệnh gọi … không nhận "đã tối ưu" bằng cảm giác»).
 *
 * Spy đặt ở `IPermissionRepository` — tầng REPO, DƯỚI passthrough cache (`permission.cache.ts:95` KHÔNG
 * cache method này) ⇒ mỗi lời gọi đếm được ở đây là một query DB thật ngoài đời.
 *
 * Ca «TRƯỚC» tái dựng nguyên văn hình dạng cũ bằng `resolveOrNull` lẻ, nên bảng số không phải trí nhớ:
 * nếu bản gộp tuột về hình dạng cũ, ca SAU sẽ bằng ca TRƯỚC và spec đỏ.
 */
import { describe, expect, it, vi } from "vitest";
import { PermissionService } from "../../src/permission/permission.service";
import { DataScopeService } from "../../src/permission/data-scope.service";
import { RecruitAccessService } from "../../src/recruit/recruit-access.service";
import type { DataScopeRepository } from "../../src/permission/data-scope.repository";
import type {
  CompanyRoleGrant,
  CompanyRoleGrantWithScope,
  IPermissionRepository,
  ObjectGrant,
  PermissionCatalogEntry,
} from "../../src/permission/permission.types";
import type { RecruitRequestUser } from "../../src/recruit/recruit.types";
import {
  DASH_WIDGET_GATE_PAIR,
  DASH_WIDGET_MIN_DATA_SCOPE,
} from "../../src/dashboard/dashboard-widget-catalog.const";

class CountingRepo implements IPermissionRepository {
  readonly hits = vi.fn<() => void>();
  constructor(private readonly grants: CompanyRoleGrantWithScope[]) {}
  async getCompanyRoleGrants(): Promise<CompanyRoleGrant[]> {
    return this.grants;
  }
  async getCompanyRoleGrantsWithScope(): Promise<CompanyRoleGrantWithScope[]> {
    this.hits();
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

const grant = (
  action: string,
  resourceType: string,
  dataScope = "Company",
  isSensitive = false,
): CompanyRoleGrantWithScope => ({
  action,
  resourceType,
  isSensitive,
  effect: "ALLOW",
  dataScope,
  expiresAt: null,
});

/** Grant của một admin thấy đủ 4 widget (cặp exact cho cả 4 cặp sensitive). */
const ADMIN_GRANTS: CompanyRoleGrantWithScope[] = [
  grant("view", "room"),
  grant("view", "asset"),
  grant("view", "candidate", "Company", true),
  grant("view-line", "payroll-period", "Company", true),
  grant("view", "interview"),
  grant("update", "candidate", "Company", true),
  grant("manage", "offer"),
];

const stubScopeRepo = {
  getRequesterScopeContext: async () => ({
    orgUnitId: null,
    managedUserIds: [],
    headedOrgUnitIds: [],
  }),
} as unknown as DataScopeRepository;

function wire(grants: CompanyRoleGrantWithScope[]) {
  const repo = new CountingRepo(grants);
  const permission = new PermissionService(repo);
  const dataScope = new DataScopeService(permission, stubScopeRepo);
  return { repo, permission, dataScope };
}

/** Các mã widget CÓ khai sàn scope — đúng tập mà `filterByGatePair` hỏi scope. */
const FLOORED = Object.keys(DASH_WIDGET_MIN_DATA_SCOPE);

describe("Số đo — GET /dashboard/me (đường sàn scope của filterByGatePair)", () => {
  it("TRƯỚC (một resolveOrNull mỗi widget khai sàn) = 3", async () => {
    const { repo, dataScope } = wire(ADMIN_GRANTS);
    for (const code of FLOORED) {
      const pair = DASH_WIDGET_GATE_PAIR[code];
      await dataScope.resolveOrNull("u1", "co1", pair.action, pair.resourceType);
    }
    expect(FLOORED).toHaveLength(3); // ASSET_SUMMARY · RECRUIT_FUNNEL · PAYROLL_COST
    expect(repo.hits).toHaveBeenCalledTimes(3);
  });

  it("SAU (một resolveManyOrNull cho cả tập) = 1", async () => {
    const { repo, dataScope } = wire(ADMIN_GRANTS);
    await dataScope.resolveManyOrNull(
      "u1",
      "co1",
      FLOORED.map((code) => {
        const pair = DASH_WIDGET_GATE_PAIR[code];
        return { action: pair.action, resourceType: pair.resourceType };
      }),
    );
    expect(repo.hits).toHaveBeenCalledTimes(1);
  });

  it("SAU, nhân viên thường (0 widget khai sàn qua được can()) = 0 — KHÔNG phải 1", async () => {
    // Ca này là lý do `resolveStrongestScopes` short-circuit TRƯỚC repository: gom ra ngoài vòng lặp
    // mà không chặn danh sách rỗng sẽ đẩy dashboard PHỔ BIẾN NHẤT từ 0 lên 1 query.
    const { repo, dataScope } = wire([]);
    await dataScope.resolveManyOrNull("u1", "co1", []);
    expect(repo.hits).toHaveBeenCalledTimes(0);
  });
});

describe("Số đo — recruit-funnel/data (RecruitAccessService.resolveActor)", () => {
  const user = { id: "u1", companyId: "co1" } as unknown as RecruitRequestUser;

  it("TRƯỚC (1 resolveAndAssert + 3 resolveOrNull) = 4", async () => {
    const { repo, dataScope } = wire(ADMIN_GRANTS);
    await dataScope.resolveAndAssert("u1", "co1", "view", "candidate", { isSensitive: true });
    await Promise.all([
      dataScope.resolveOrNull("u1", "co1", "view", "interview"),
      dataScope.resolveOrNull("u1", "co1", "update", "candidate", { isSensitive: true }),
      dataScope.resolveOrNull("u1", "co1", "manage", "offer", { isSensitive: false }),
    ]);
    expect(repo.hits).toHaveBeenCalledTimes(4);
  });

  it("SAU (resolveActor thật) = 1", async () => {
    const { repo, dataScope } = wire(ADMIN_GRANTS);
    const actor = await new RecruitAccessService(dataScope).resolveActor(user, "candidateSummary");
    expect(repo.hits).toHaveBeenCalledTimes(1);
    // Cùng lượt: kết quả KHÔNG đổi so với hình dạng cũ (cùng grant ⇒ cùng scope + cùng cờ).
    expect(actor.routeScope).toBe("Company");
    expect(actor.interviewViewScope).toBe("Company");
    expect(actor.canSeeCandidatePii).toBe(true);
    expect(actor.canSeeSalary).toBe(true);
  });

  it("SAU, actor KHÔNG có cờ phụ nào ⇒ vẫn 1 lượt đọc, cờ tắt (fail-closed, không undefined)", async () => {
    const { repo, dataScope } = wire([grant("view", "candidate", "Company", true)]);
    const actor = await new RecruitAccessService(dataScope).resolveActor(user, "candidateSummary");
    expect(repo.hits).toHaveBeenCalledTimes(1);
    expect(actor.canSeeCandidatePii).toBe(false);
    expect(actor.canSeeSalary).toBe(false);
    expect(actor.interviewViewScope).toBeNull();
  });
});
