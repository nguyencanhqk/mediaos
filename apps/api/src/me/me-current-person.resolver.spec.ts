import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { MeCurrentPersonResolver } from "./me-current-person.resolver";
import type { MeActiveEmployeeRow } from "./me.repository";

/**
 * S5-ME-BE-1 — MeCurrentPersonResolver UNIT. ĐẾM active employee → 0/1/>1 (SPEC-09 §12.1/§12.2/§12.4).
 * >1 dùng mock repo (partial-unique DB chặn 2 non-deleted ⇒ không dựng được ở int-spec) — chứng minh
 * resolver KHÔNG tự chọn: ném 409 ME-ERR-DATA-INCONSISTENT + ghi audit object_type='user'.
 */

const ACTOR = { id: "u1", companyId: "c1" };

function emp(id: string): MeActiveEmployeeRow {
  return {
    employeeId: id,
    employeeCode: id,
    fullName: "A",
    departmentName: null,
    positionName: null,
  };
}

function build(rows: MeActiveEmployeeRow[]) {
  const db = { withTenant: (_c: string, fn: (tx: unknown) => unknown) => fn({}) };
  const repo = { findActiveEmployeesByUserIdTx: vi.fn(async () => rows) };
  const audit = {
    record: vi.fn<(tx: unknown, entry: Record<string, unknown>) => Promise<void>>(
      async () => undefined,
    ),
  };
  const resolver = new MeCurrentPersonResolver(db as never, repo as never, audit as never);
  return { resolver, audit };
}

describe("MeCurrentPersonResolver", () => {
  it("0 active → unlinked (KHÔNG throw, KHÔNG audit)", async () => {
    const { resolver, audit } = build([]);
    const r = await resolver.resolve(ACTOR);
    expect(r).toEqual({ linkStatus: "unlinked", employee: null });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("1 active → linked + employee link tối thiểu", async () => {
    const { resolver } = build([emp("e1")]);
    const r = await resolver.resolve(ACTOR);
    expect(r.linkStatus).toBe("linked");
    expect(r.employee?.employeeId).toBe("e1");
  });

  it(">1 active → 409 ME-ERR-DATA-INCONSISTENT + audit object_type='user' action MeDataInconsistent (KHÔNG tự chọn)", async () => {
    const { resolver, audit } = build([emp("e1"), emp("e2")]);
    await expect(resolver.resolve(ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [, entry] = audit.record.mock.calls[0];
    expect(entry).toMatchObject({
      objectType: "user",
      action: "MeDataInconsistent",
      objectId: "u1",
    });
  });
});
