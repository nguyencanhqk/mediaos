/**
 * S1-FND-MODULE-1 — ModuleCatalogService unit tests (repo/settings/permission mocked, no Postgres).
 *
 * Crown-jewel deny-path (RED — DoD #6b/#5):
 *  - user thiếu HẾT requiredAny của module → module BỊ LỌC; có ≥1 cap → HIỆN.
 *  - setting module.<code>.enabled=false → LỌC dù có quyền; default (không seed) → enabled=true.
 *  - wildcard cap (*:*) → HIỆN dù thiếu cap exact.
 *  - module active thiếu metadata → bỏ qua (warn), KHÔNG bịa.
 *  - 2-tenant: resolveMany/getCapabilities/getAllowlistedSensitiveCapabilities keyed actor.companyId/id.
 * + S2-FND-BE-5 Option B: getMyApps MERGE getCapabilities()+getAllowlistedSensitiveCapabilities() ⇒ app gate
 *   bằng cặp SENSITIVE-canonical (vd ATT view-own:attendance) HIỆN khi cap ở nhánh allowlist-sensitive.
 * + hasAnyCapability thuần (requiredAny rỗng → HIỆN).
 */

import { describe, expect, it, vi } from "vitest";
import { ModuleCatalogService } from "./module-catalog.service";
import { hasAnyCapability } from "./module-app-metadata";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const actor = { id: ACTOR_ID, companyId: COMPANY_A };

function mod(moduleCode: string, sortOrder: number, over: Record<string, unknown> = {}) {
  return {
    id: `id-${moduleCode}`,
    moduleCode,
    name: moduleCode,
    description: `desc ${moduleCode}`,
    moduleGroup: "Core",
    version: null,
    isCore: false,
    isMvp: true,
    isActive: true,
    sortOrder,
    dependencies: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    ...over,
  };
}

/** resolveMany trả 1 ResolvedSetting/key — mặc định found=false (⇒ default enabled=true). */
function resolveManyImpl(overrides: Record<string, boolean> = {}) {
  return vi
    .fn()
    .mockImplementation((_companyId: string, keys: string[]) =>
      Promise.resolve(
        keys.map((key) =>
          key in overrides
            ? { key, value: overrides[key], scope: "company", found: true }
            : { key, value: undefined, scope: "default", found: false },
        ),
      ),
    );
}

function makeService(opts: {
  modules?: ReturnType<typeof mod>[];
  resolveMany?: ReturnType<typeof vi.fn>;
  caps?: Record<string, boolean>;
  /** Cặp NHẠY CẢM đã allowlist (view-*:attendance / view:audit-log) — nhánh Option B. */
  sensitiveCaps?: Record<string, boolean>;
}) {
  const repo = { findActiveModules: vi.fn().mockResolvedValue(opts.modules ?? []) };
  const settings = { resolveMany: opts.resolveMany ?? resolveManyImpl() };
  const permission = {
    getCapabilities: vi.fn().mockResolvedValue(opts.caps ?? {}),
    getAllowlistedSensitiveCapabilities: vi.fn().mockResolvedValue(opts.sensitiveCaps ?? {}),
  };
  const svc = new ModuleCatalogService(repo as never, settings as never, permission as never);
  return { svc, repo, settings, permission };
}

describe("ModuleCatalogService.getMyApps — permission filter (RED)", () => {
  it("HR hiện khi user có read:employee; ẨN khi thiếu hết requiredAny", async () => {
    const withCap = makeService({ modules: [mod("HR", 2)], caps: { "read:employee": true } });
    const shown = await withCap.svc.getMyApps(actor);
    expect(shown.map((a) => a.module_code)).toEqual(["HR"]);
    expect(shown[0].required_permissions).toContain("HR.EMPLOYEE.VIEW");

    const noCap = makeService({ modules: [mod("HR", 2)], caps: {} });
    expect(await noCap.svc.getMyApps(actor)).toEqual([]);
  });

  it("setting enabled=false → LỌC dù có quyền", async () => {
    const { svc } = makeService({
      modules: [mod("HR", 2)],
      caps: { "read:employee": true },
      resolveMany: resolveManyImpl({ "module.HR.enabled": false }),
    });
    expect(await svc.getMyApps(actor)).toEqual([]);
  });

  it("default (không seed setting) → enabled=true", async () => {
    const { svc } = makeService({ modules: [mod("HR", 2)], caps: { "read:employee": true } });
    expect((await svc.getMyApps(actor)).map((a) => a.module_code)).toEqual(["HR"]);
  });

  it("wildcard cap *:* → HIỆN dù thiếu cap exact", async () => {
    const { svc } = makeService({ modules: [mod("HR", 2)], caps: { "*:*": true } });
    expect((await svc.getMyApps(actor)).map((a) => a.module_code)).toEqual(["HR"]);
  });

  it("module active thiếu metadata → bỏ qua (KHÔNG bịa app card)", async () => {
    const { svc } = makeService({ modules: [mod("UNKNOWN_X", 9)], caps: { "*:*": true } });
    expect(await svc.getMyApps(actor)).toEqual([]);
  });

  // S2-FND-BE-5 Option B: ATT gate CHỈ bằng cặp SENSITIVE (view-*:attendance). getCapabilities() lọc sensitive
  // ⇒ nếu chỉ dùng nhánh đó, ATT ẨN-NGẦM. Merge getAllowlistedSensitiveCapabilities() làm cap surface → HIỆN.
  it("ATT (gate sensitive-canonical) HIỆN khi cap ở nhánh allowlist-sensitive, ẨN khi cả 2 nhánh trống", async () => {
    const shown = makeService({
      modules: [mod("ATT", 3)],
      caps: {}, // getCapabilities() rỗng (view-own:attendance is_sensitive=true → bị lọc)
      sensitiveCaps: { "view-own:attendance": true }, // allowlisted sensitive surface
    });
    expect((await shown.svc.getMyApps(actor)).map((a) => a.module_code)).toEqual(["ATT"]);

    const hidden = makeService({ modules: [mod("ATT", 3)], caps: {}, sensitiveCaps: {} });
    expect(await hidden.svc.getMyApps(actor)).toEqual([]);
  });
});

describe("ModuleCatalogService.getMyApps — shape + isolation", () => {
  it("giữ thứ tự sort_order + shape my-apps đúng (is_favorite/is_recent=false, allowed_actions)", async () => {
    const { svc } = makeService({
      modules: [mod("LEAVE", 4), mod("HR", 2)], // repo đã sort; service giữ nguyên
      // LEAVE canonical (0455) = view-own:leave (non-sensitive); HR = read:employee.
      caps: { "read:employee": true, "view-own:leave": true },
    });
    const apps = await svc.getMyApps(actor);
    expect(apps.map((a) => a.module_code)).toEqual(["LEAVE", "HR"]);
    const hr = apps.find((a) => a.module_code === "HR")!;
    expect(hr.route).toBe("/hr");
    expect(hr.icon).toBe("users");
    expect(hr.is_active).toBe(true);
    expect(hr.is_favorite).toBe(false);
    expect(hr.is_recent).toBe(false);
    expect(hr.allowed_actions).toEqual(["open", "favorite"]);
  });

  it("2-tenant: resolveMany + getCapabilities keyed actor.companyId/id", async () => {
    const { svc, settings, permission } = makeService({
      modules: [mod("HR", 2)],
      caps: { "read:employee": true },
    });
    await svc.getMyApps(actor);
    expect(settings.resolveMany).toHaveBeenCalledWith(COMPANY_A, expect.any(Array));
    expect(permission.getCapabilities).toHaveBeenCalledWith(ACTOR_ID, COMPANY_A);
    expect(permission.getAllowlistedSensitiveCapabilities).toHaveBeenCalledWith(
      ACTOR_ID,
      COMPANY_A,
    );
  });

  it("không có module active → []", async () => {
    const { svc } = makeService({ modules: [] });
    expect(await svc.getMyApps(actor)).toEqual([]);
  });
});

describe("hasAnyCapability (pure)", () => {
  it("requiredAny rỗng → true (HIỆN)", () => {
    expect(hasAnyCapability({}, [])).toBe(true);
  });
  it("exact match → true; thiếu → false", () => {
    expect(
      hasAnyCapability({ "read:employee": true }, [{ action: "read", resourceType: "employee" }]),
    ).toBe(true);
    expect(hasAnyCapability({}, [{ action: "read", resourceType: "employee" }])).toBe(false);
  });
  it("wildcard *:resource | action:* | *:* → true", () => {
    const need = [{ action: "read", resourceType: "employee" }];
    expect(hasAnyCapability({ "*:employee": true }, need)).toBe(true);
    expect(hasAnyCapability({ "read:*": true }, need)).toBe(true);
    expect(hasAnyCapability({ "*:*": true }, need)).toBe(true);
  });
});
