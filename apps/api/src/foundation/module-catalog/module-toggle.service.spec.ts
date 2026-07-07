/**
 * S2-FND-BE-8 — ModuleToggleService unit tests (repo/db/audit/catalog mocked, no Postgres).
 *
 * Crown-jewel (audit CONFIG_UPDATE + core-lock). Phủ (RED-trước → GREEN):
 *   - core-lock: 7 module MVP (AUTH/HR/ATT/LEAVE/TASK/DASH/NOTI) → BadRequestException (400),
 *     0 upsert company_settings, 0 audit (BẤT BIẾN #2 — deny KHÔNG ghi audit).
 *   - not-found: code lạ / soft-deleted → NotFoundException (404), 0 write, 0 audit.
 *   - happy: non-core module → upsert company_settings + đúng 1 audit CÙNG tx (record gọi 1 lần) với
 *     object_type='module', action_group='CONFIG_UPDATE', permission_code='FOUNDATION.MODULE.UPDATE',
 *     action=ModuleEnabled/ModuleDisabled theo cờ. KHÔNG secret vào old/new (chỉ code/enabled).
 */

import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CORE_MODULE_CODES, ModuleToggleService } from "./module-toggle.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const actor = { id: ACTOR_ID, companyId: COMPANY_A };

function mod(moduleCode: string, over: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-0000-0000-0000000000${moduleCode.length.toString().padStart(2, "0")}`,
    moduleCode,
    name: moduleCode,
    description: null,
    moduleGroup: "Extension",
    version: null,
    isCore: false,
    isMvp: false,
    isActive: false,
    sortOrder: 8,
    dependencies: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    deletedBy: null,
    ...over,
  };
}

/** withTenant chạy callback với tx giả (mọi repo method mock). */
function makeService(opts: {
  byCode?: ReturnType<typeof mod>[];
  existingSetting?: { id: string; settingValue: unknown }[];
}) {
  const findModuleSettingTx = vi.fn().mockResolvedValue(opts.existingSetting ?? []);
  const insertModuleSettingTx = vi.fn().mockResolvedValue([{ id: "set-1" }]);
  const updateModuleSettingTx = vi.fn().mockResolvedValue([{ id: "set-1" }]);
  const repo = {
    findByCode: vi.fn().mockResolvedValue(opts.byCode ?? []),
    findModuleSettingTx,
    insertModuleSettingTx,
    updateModuleSettingTx,
  };
  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record };
  const db = {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({} as unknown)),
  };
  const catalog = {
    getModuleDetail: vi.fn().mockResolvedValue({ module_code: "X", enabled: false }),
  };
  const svc = new ModuleToggleService(db as never, repo as never, audit as never, catalog as never);
  return { svc, repo, audit, db, catalog };
}

describe("ModuleToggleService.toggleModule — core-lock (7 MVP KHÓA CỨNG)", () => {
  it("CORE_MODULE_CODES = đúng 7 module MVP", () => {
    expect([...CORE_MODULE_CODES].sort()).toEqual(
      ["ATT", "AUTH", "DASH", "HR", "LEAVE", "NOTI", "TASK"].sort(),
    );
  });

  for (const code of ["AUTH", "HR", "ATT", "LEAVE", "TASK", "DASH", "NOTI"]) {
    it(`${code} → BadRequestException (400), 0 upsert, 0 audit`, async () => {
      const { svc, repo, audit, db } = makeService({ byCode: [mod(code, { isCore: true })] });
      await expect(svc.toggleModule(actor, code, false)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      // Core-lock deny TRƯỚC withTenant/upsert/audit — không chạm ghi.
      expect(db.withTenant).not.toHaveBeenCalled();
      expect(repo.insertModuleSettingTx).not.toHaveBeenCalled();
      expect(repo.updateModuleSettingTx).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  }
});

describe("ModuleToggleService.toggleModule — not-found guard", () => {
  it("code lạ (findByCode rỗng) → NotFoundException (404), 0 write, 0 audit", async () => {
    const { svc, repo, audit } = makeService({ byCode: [] });
    await expect(svc.toggleModule(actor, "NOPE", false)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.insertModuleSettingTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("ModuleToggleService.toggleModule — happy (non-core)", () => {
  it("disable non-core → INSERT setting (chưa có) + đúng 1 audit ModuleDisabled/CONFIG_UPDATE/module", async () => {
    const { svc, repo, audit } = makeService({ byCode: [mod("PAYROLL")], existingSetting: [] });
    await svc.toggleModule(actor, "PAYROLL", false);
    expect(repo.insertModuleSettingTx).toHaveBeenCalledTimes(1);
    expect(repo.updateModuleSettingTx).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1];
    expect(entry.objectType).toBe("module");
    expect(entry.action).toBe("ModuleDisabled");
    expect(entry.actionGroup).toBe("CONFIG_UPDATE");
    expect(entry.permissionCode).toBe("FOUNDATION.MODULE.UPDATE");
    expect(entry.dataScope).toBe("Company");
    // KHÔNG secret/PII — chỉ code/enabled.
    expect(entry.newValues).toEqual({ code: "PAYROLL", enabled: false });
    expect(entry.oldValues).toEqual({ code: "PAYROLL", enabled: true }); // default true khi chưa seed
  });

  it("enable non-core khi ĐÃ có override → UPDATE setting + audit ModuleEnabled", async () => {
    const { svc, repo, audit } = makeService({
      byCode: [mod("PAYROLL")],
      existingSetting: [{ id: "set-9", settingValue: false }],
    });
    await svc.toggleModule(actor, "PAYROLL", true);
    expect(repo.updateModuleSettingTx).toHaveBeenCalledTimes(1);
    expect(repo.insertModuleSettingTx).not.toHaveBeenCalled();
    const entry = audit.record.mock.calls[0][1];
    expect(entry.action).toBe("ModuleEnabled");
    expect(entry.oldValues).toEqual({ code: "PAYROLL", enabled: false });
    expect(entry.newValues).toEqual({ code: "PAYROLL", enabled: true });
  });
});
