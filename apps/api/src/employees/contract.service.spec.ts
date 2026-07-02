import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { EmployeeContract } from "../db/schema";
import { ContractService } from "./contract.service";

/**
 * S2-HR-BE-6 — ContractService unit specs (pure logic, no DB). Verifies the business-rule guards and the
 * DTO/expiry mapping through a lightweight service instance with mocked collaborators. The full crown-jewel
 * behaviour (permission gating, audit-in-tx, RLS, append-only) is proven in hr-contract.int-spec.ts.
 */

const USER = { id: "u1", companyId: "co-a" };

/** Build a service whose `db.withTenant(fn)` runs `fn(tx)` immediately with the supplied fake tx. */
function makeService(opts: {
  tx?: unknown;
  repo?: Partial<Record<string, unknown>>;
  contractType?: { requiresEndDate: boolean } | null;
  employeeExists?: boolean;
}) {
  const tx = opts.tx ?? {};
  const db = {
    withTenant: (_companyId: string, fn: (tx: unknown) => unknown) => fn(tx),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const files = { link: vi.fn().mockResolvedValue(undefined) };
  const repo = opts.repo ?? {};

  const svc = new ContractService(db as never, repo as never, audit as never, files as never);

  // Stub the tenant-scoped SELECTs that assertEmployeeInTenant / assertContractTypeInTenant issue.
  // Both use tx.select().from().where().limit() → return the controlled row.
  const selectResult = (rows: unknown[]) => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  });
  (tx as Record<string, unknown>)["select"] = vi.fn((shape?: Record<string, unknown>) => {
    // employee assertion selects { id }; contract_type assertion selects { requiresEndDate }.
    if (shape && "requiresEndDate" in shape) {
      return selectResult(opts.contractType ? [opts.contractType] : []);
    }
    return selectResult(opts.employeeExists === false ? [] : [{ id: "emp-1" }]);
  });

  return { svc, audit, files, repo };
}

function contractRow(over: Partial<EmployeeContract> = {}): EmployeeContract {
  return {
    id: "ct-1",
    companyId: "co-a",
    employeeId: "emp-1",
    contractTypeId: "type-1",
    contractCode: null,
    title: null,
    startDate: "2025-01-01",
    endDate: null,
    signedDate: null,
    status: "Active",
    isPrimary: false,
    fileId: null,
    note: null,
    metadata: null,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    createdBy: null,
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    ...over,
  };
}

describe("ContractService business rules (unit)", () => {
  it("rejects create when contract_type belongs to another tenant (assertContractTypeInTenant → 400)", async () => {
    const { svc } = makeService({ contractType: null });
    await expect(
      svc.create(USER, {
        employeeId: "emp-1",
        contractTypeId: "type-x",
        startDate: "2025-01-01",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects create when the contract_type requires an end_date but none is given (400)", async () => {
    const { svc } = makeService({ contractType: { requiresEndDate: true } });
    await expect(
      svc.create(USER, {
        employeeId: "emp-1",
        contractTypeId: "type-1",
        startDate: "2025-01-01",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects create when end_date < start_date (400)", async () => {
    const { svc } = makeService({ contractType: { requiresEndDate: false } });
    await expect(
      svc.create(USER, {
        employeeId: "emp-1",
        contractTypeId: "type-1",
        startDate: "2025-06-01",
        endDate: "2025-01-01",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("create writes exactly one audit row in the tenant tx on success", async () => {
    const created = contractRow({ id: "new-ct" });
    const { svc, audit } = makeService({
      contractType: { requiresEndDate: false },
      repo: { insertTx: vi.fn().mockResolvedValue(created) },
    });
    const dto = await svc.create(USER, {
      employeeId: "emp-1",
      contractTypeId: "type-1",
      startDate: "2025-01-01",
      status: "Active",
    });
    expect(dto.id).toBe("new-ct");
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ objectType: "employee_contract", action: "create" }),
    );
  });

  it("delete throws NotFound when the contract row is absent (no audit written)", async () => {
    const { svc, audit } = makeService({
      repo: { findByIdTx: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(svc.delete(USER, "missing")).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("delete is soft (repo.softDeleteTx) + one audit row when the row exists", async () => {
    const existing = contractRow();
    const softDeleteTx = vi.fn().mockResolvedValue(1);
    const { svc, audit } = makeService({
      repo: { findByIdTx: vi.fn().mockResolvedValue(existing), softDeleteTx },
    });
    await svc.delete(USER, "ct-1");
    expect(softDeleteTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ objectType: "employee_contract", action: "delete" }),
    );
  });

  it("expiringSoon is true for an Active contract ending within 30 days, false otherwise", async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 5);
    const far = new Date();
    far.setUTCDate(far.getUTCDate() + 90);

    const rows = [
      contractRow({ id: "soon", status: "Active", endDate: soon.toISOString().slice(0, 10) }),
      contractRow({ id: "far", status: "Active", endDate: far.toISOString().slice(0, 10) }),
      contractRow({ id: "draft", status: "Draft", endDate: soon.toISOString().slice(0, 10) }),
    ];
    const { svc } = makeService({
      repo: {
        listTx: vi.fn().mockResolvedValue(rows),
        countTx: vi.fn().mockResolvedValue(rows.length),
      },
    });
    const res = await svc.list(USER, { page: 1, limit: 50 });
    const byId = new Map(res.data.map((c) => [c.id, c.expiringSoon]));
    expect(byId.get("soon")).toBe(true);
    expect(byId.get("far")).toBe(false);
    expect(byId.get("draft")).toBe(false); // not Active → never expiringSoon
  });
});
