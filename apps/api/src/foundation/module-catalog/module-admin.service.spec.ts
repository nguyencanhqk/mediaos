/**
 * S2-FND-BE-1 — ModuleCatalogService admin-catalog unit tests (repo/settings mocked, no Postgres).
 *
 * KHÁC my-apps: admin thấy TẤT CẢ module (active + inactive) — KHÔNG lọc theo capability user; getCapabilities
 * KHÔNG được gọi. enabled resolve theo setting module.<code>.enabled (default=true). Module thiếu metadata
 * vẫn hiện (route/icon rỗng, required_permissions=[]) — KHÔNG bịa. getModuleDetail(code lạ) → NotFoundException.
 */

import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ModuleCatalogService } from "./module-catalog.service";

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
  all?: ReturnType<typeof mod>[];
  byCode?: ReturnType<typeof mod>[];
  resolveMany?: ReturnType<typeof vi.fn>;
}) {
  const repo = {
    findAllModules: vi.fn().mockResolvedValue(opts.all ?? []),
    findByCode: vi.fn().mockResolvedValue(opts.byCode ?? []),
    findActiveModules: vi.fn().mockResolvedValue([]),
  };
  const settings = { resolveMany: opts.resolveMany ?? resolveManyImpl() };
  const permission = { getCapabilities: vi.fn().mockResolvedValue({}) };
  const svc = new ModuleCatalogService(repo as never, settings as never, permission as never);
  return { svc, repo, settings, permission };
}

describe("ModuleCatalogService.getAllModules — admin catalog", () => {
  it("BAO GỒM module INACTIVE (khác my-apps — admin thấy hết); giữ thứ tự sort_order", async () => {
    const { svc } = makeService({
      all: [mod("HR", 2), mod("PAYROLL", 8, { isActive: false, moduleGroup: "Extension" })],
    });
    const items = await svc.getAllModules(actor);
    expect(items.map((i) => i.module_code)).toEqual(["HR", "PAYROLL"]);
    const payroll = items.find((i) => i.module_code === "PAYROLL")!;
    expect(payroll.is_active).toBe(false);
  });

  it("KHÔNG lọc theo capability user — getCapabilities KHÔNG được gọi (admin thấy hết)", async () => {
    const { svc, permission } = makeService({ all: [mod("HR", 2)] });
    const items = await svc.getAllModules(actor);
    expect(items.map((i) => i.module_code)).toEqual(["HR"]);
    expect(permission.getCapabilities).not.toHaveBeenCalled();
  });

  it("enabled resolve theo settingKey module.<code>.enabled (false → enabled=false, vẫn hiện)", async () => {
    const { svc } = makeService({
      all: [mod("HR", 2), mod("ATT", 3)],
      resolveMany: resolveManyImpl({ "module.HR.enabled": false }),
    });
    const items = await svc.getAllModules(actor);
    const hr = items.find((i) => i.module_code === "HR")!;
    const att = items.find((i) => i.module_code === "ATT")!;
    expect(hr.enabled).toBe(false); // vẫn hiện dù disabled (admin catalog)
    expect(att.enabled).toBe(true); // default=true (chưa seed)
  });

  it("map metadata MODULE_APP_METADATA (route/icon/required_permissions) cho module có meta", async () => {
    const { svc } = makeService({ all: [mod("HR", 2)] });
    const [hr] = await svc.getAllModules(actor);
    expect(hr.route).toBe("/hr");
    expect(hr.icon).toBe("users");
    expect(hr.required_permissions).toContain("HR.EMPLOYEE.VIEW");
  });

  it("module thiếu metadata (vd PAYROLL) → vẫn hiện, route/icon rỗng, required_permissions=[] (KHÔNG bịa)", async () => {
    const { svc } = makeService({
      all: [mod("PAYROLL", 8, { isActive: false, moduleGroup: "Extension" })],
    });
    const [p] = await svc.getAllModules(actor);
    expect(p.module_code).toBe("PAYROLL");
    expect(p.route).toBe("");
    expect(p.icon).toBe("");
    expect(p.required_permissions).toEqual([]);
  });

  it("2-tenant: resolveMany keyed actor.companyId", async () => {
    const { svc, settings } = makeService({ all: [mod("HR", 2)] });
    await svc.getAllModules(actor);
    expect(settings.resolveMany).toHaveBeenCalledWith(COMPANY_A, expect.any(Array));
  });

  it("không có module → []", async () => {
    const { svc } = makeService({ all: [] });
    expect(await svc.getAllModules(actor)).toEqual([]);
  });
});

describe("ModuleCatalogService.getModuleDetail — admin detail", () => {
  it("trả detail (metadata + enabled) khi code tồn tại", async () => {
    const { svc } = makeService({ byCode: [mod("HR", 2)] });
    const detail = await svc.getModuleDetail(actor, "HR");
    expect(detail.module_code).toBe("HR");
    expect(detail.route).toBe("/hr");
    expect(detail.enabled).toBe(true);
  });

  it("code lạ → NotFoundException (404)", async () => {
    const { svc } = makeService({ byCode: [] });
    await expect(svc.getModuleDetail(actor, "NOPE")).rejects.toBeInstanceOf(NotFoundException);
  });
});
