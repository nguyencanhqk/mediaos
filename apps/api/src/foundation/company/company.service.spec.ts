/**
 * S1-FND-MODULE-1 — CompanyService unit tests (repo/db/audit mocked, no Postgres). Colocated src/** ⇒ chạy.
 *
 * Crown-jewel deny-path (RED viết-TRƯỚC — DoD #6):
 *  (a') suspended → 403 TRƯỚC mọi write/audit (0 audit); existing=null → 4xx sạch (KHÔNG 500), 0 write/audit.
 *  (d)  body company_id lạ → bỏ qua (pickEditable allow-list); tenant + audit theo actor.companyId.
 *  (c)  2-tenant: getCurrent của actor A chỉ chạm companyId A (withTenant + findCurrentTx).
 * Green: PATCH active → upsert + audit COMPANY_UPDATED object_type='company' CÙNG tx (1 lần); patch rỗng → no-op no-audit.
 */

import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { CompanyService } from "./company.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const actorA = { id: ACTOR_ID, companyId: COMPANY_A };

function companyRow(over: Record<string, unknown> = {}) {
  return {
    id: COMPANY_A,
    name: "Funtime",
    slug: "funtime",
    status: "active",
    shortName: null,
    companyCode: "FT-001",
    logoUrl: null,
    timezone: "Asia/Ho_Chi_Minh",
    currency: "VND",
    language: "vi",
    taxCode: null,
    businessType: null,
    regNumber: null,
    regDate: null,
    regPlace: null,
    legalRepName: null,
    legalRepTitle: null,
    establishedDate: null,
    address: null,
    phone: null,
    fax: null,
    email: null,
    website: null,
    workingDaysJson: { days: [1, 2, 3, 4, 5] },
    payrollConfigJson: { cutoffDay: 25, payDay: 5 },
    schemaVersion: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...over,
  };
}

function makeRepo(over: Record<string, ReturnType<typeof vi.fn>> = {}) {
  return {
    findCurrentTx: vi.fn().mockResolvedValue(companyRow()),
    updateTx: vi.fn().mockResolvedValue(companyRow({ name: "Funtime Media Corp" })),
    ...over,
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeService(
  opts: {
    repo?: ReturnType<typeof makeRepo>;
    audit?: ReturnType<typeof makeAudit>;
  } = {},
) {
  const repo = opts.repo ?? makeRepo();
  const audit = opts.audit ?? makeAudit();
  const tx = {};
  const db = {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
  const svc = new CompanyService(db as never, repo as never, audit as never);
  return { svc, repo, audit, db };
}

describe("CompanyService.getCurrent", () => {
  it("đọc company của tenant TỪ AuthContext (withTenant + findCurrentTx = actor.companyId)", async () => {
    const { svc, repo, db } = makeService();
    const view = await svc.getCurrent(actorA);
    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_A, expect.any(Function));
    expect(repo.findCurrentTx).toHaveBeenCalledWith(COMPANY_A, expect.anything());
    expect(view.id).toBe(COMPANY_A);
    expect(view.slug).toBe("funtime");
  });

  it("2-tenant: actor công ty A KHÔNG bao giờ chạm companyId B", async () => {
    const { svc, repo, db } = makeService();
    await svc.getCurrent(actorA);
    expect(db.withTenant).not.toHaveBeenCalledWith(COMPANY_B, expect.anything());
    expect(repo.findCurrentTx).not.toHaveBeenCalledWith(COMPANY_B, expect.anything());
  });

  it("không thấy company → NotFound (KHÔNG 500)", async () => {
    const repo = makeRepo({ findCurrentTx: vi.fn().mockResolvedValue(undefined) });
    const { svc } = makeService({ repo });
    await expect(svc.getCurrent(actorA)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("CompanyService.updateCompany — deny-path (RED)", () => {
  it("(a') suspended → 403 TRƯỚC write/audit (0 audit, 0 update)", async () => {
    const repo = makeRepo({
      findCurrentTx: vi.fn().mockResolvedValue(companyRow({ status: "suspended" })),
    });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(svc.updateCompany(actorA, { name: "X" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repo.updateTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("existing=null → NotFound sạch (KHÔNG 500), 0 update/audit", async () => {
    const repo = makeRepo({ findCurrentTx: vi.fn().mockResolvedValue(undefined) });
    const audit = makeAudit();
    const { svc } = makeService({ repo, audit });
    await expect(svc.updateCompany(actorA, { name: "X" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repo.updateTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("CompanyService.updateCompany — green + isolation", () => {
  it("active → upsert allow-list + audit COMPANY_UPDATED object_type='company' CÙNG tx (1 lần)", async () => {
    const { svc, repo, audit } = makeService();
    const view = await svc.updateCompany(actorA, { name: "Funtime Media Corp" });

    expect(repo.updateTx).toHaveBeenCalledTimes(1);
    const [companyIdArg, patchArg] = repo.updateTx.mock.calls[0];
    expect(companyIdArg).toBe(COMPANY_A);
    expect(patchArg).toEqual({ name: "Funtime Media Corp" });

    expect(audit.record).toHaveBeenCalledTimes(1);
    const [, entry] = audit.record.mock.calls[0];
    expect(entry.action).toBe("COMPANY_UPDATED");
    expect(entry.objectType).toBe("company");
    expect(entry.objectId).toBe(COMPANY_A);
    expect(entry.permissionCode).toBe("FOUNDATION.COMPANY.UPDATE");
    expect(entry.dataScope).toBe("Company");
    expect(entry.oldValues.name).toBe("Funtime");
    expect(entry.newValues.name).toBe("Funtime Media Corp");
    expect(view.name).toBe("Funtime Media Corp");
  });

  it("(d) body company_id/id/status lạ → bỏ qua; patch chỉ field allow-list; tenant=actor.companyId", async () => {
    const { svc, repo, db } = makeService();
    // Mô phỏng input runtime CÒN sót key lạ (dù Zod strip) — service PHẢI tự bỏ qua.
    const dirty = { name: "Y", company_id: COMPANY_B, id: COMPANY_B, status: "suspended" } as never;
    await svc.updateCompany(actorA, dirty);
    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_A, expect.any(Function));
    const [companyIdArg, patchArg] = repo.updateTx.mock.calls[0];
    expect(companyIdArg).toBe(COMPANY_A);
    expect(patchArg).toEqual({ name: "Y" });
    expect(patchArg).not.toHaveProperty("company_id");
    expect(patchArg).not.toHaveProperty("status");
    expect(patchArg).not.toHaveProperty("id");
  });

  it("patch rỗng (không field hợp lệ) → no-op: KHÔNG update, KHÔNG audit, trả current", async () => {
    const { svc, repo, audit } = makeService();
    const view = await svc.updateCompany(actorA, {});
    expect(repo.updateTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(view.id).toBe(COMPANY_A);
  });
});
