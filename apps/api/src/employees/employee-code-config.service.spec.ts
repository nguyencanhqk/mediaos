/**
 * S2-HR-BE-7 — EmployeeCodeConfigService unit RED suite (no DB).
 *
 * Proves (deny/behavioural, no Postgres):
 *  - preview delegates to SequenceService.previewNextCode and NEVER to nextCode/updateCounter (no-mutate);
 *  - a missing/inactive counter maps to 422 (HR-ERR-EMPLOYEE-CODE-CONFIG-INVALID), never a raw 500;
 *  - update writes EXACTLY ONE audit row object_type='employee_code_config', action CONFIG_UPDATE, in the
 *    SAME tx, with a config-ONLY snapshot (never current_value/counter/secret/PII — BẤT BIẾN #3) and
 *    changed_fields populated (old/new supplied);
 *  - the PATCH Zod contract enforces value_type (number_length bounds + status enum).
 */

import { describe, expect, it, vi } from "vitest";
import { UnprocessableEntityException } from "@nestjs/common";
import { updateEmployeeCodeConfigSchema } from "@mediaos/contracts";
import { EmployeeCodeConfigService } from "./employee-code-config.service";
import {
  SequenceInactiveError,
  SequenceNotFoundError,
} from "../foundation/sequences/sequence.types";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const CONFIG_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const actorA = { id: ACTOR_ID, companyId: COMPANY_A };
const FAKE_TX = { __tx: true };

/** Keys that must NEVER appear in an audit before/after payload (BẤT BIẾN #3). */
const FORBIDDEN_AUDIT_KEYS = [
  "currentValue",
  "current_value",
  "counter",
  "lastGeneratedCode",
  "secret",
];

function makeDb() {
  return {
    // withTenant just runs the callback with a fake tx (unit — no real transaction).
    withTenant: vi.fn(async (_companyId: string, fn: (tx: unknown) => Promise<unknown>) =>
      fn(FAKE_TX),
    ),
  };
}

function makeSequence() {
  return {
    previewNextCode: vi
      .fn()
      .mockResolvedValue({ sequenceKey: "EMPLOYEE_CODE", value: 1, code: "EMP0001" }),
    nextCode: vi.fn(),
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

const dbRow = {
  id: CONFIG_ID,
  companyId: COMPANY_A,
  prefix: "EMP",
  pattern: null,
  numberLength: 4,
  allowManualOverride: true,
  status: "active",
  currentValue: 42n, // MUST never leak into audit
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findConfigTx: vi.fn().mockResolvedValue(dbRow),
    insertConfigTx: vi.fn().mockResolvedValue(dbRow),
    updateConfigTx: vi.fn().mockResolvedValue({ ...dbRow, prefix: "STAFF" }),
    ...overrides,
  };
}

function makeService(repo = makeRepo(), db = makeDb(), audit = makeAudit(), seq = makeSequence()) {
  const svc = new EmployeeCodeConfigService(
    db as never,
    repo as never,
    audit as never,
    seq as never,
  );
  return { svc, repo, db, audit, seq };
}

describe("EmployeeCodeConfigService.preview — delegates, never mutates", () => {
  it("calls SequenceService.previewNextCode and NEVER nextCode", async () => {
    const { svc, seq } = makeService();
    const res = await svc.preview(actorA);
    expect(seq.previewNextCode).toHaveBeenCalledOnce();
    expect(seq.nextCode).not.toHaveBeenCalled();
    expect(res).toEqual({ sequenceKey: "EMPLOYEE_CODE", value: 1, code: "EMP0001" });
  });

  it("maps a missing counter to 422 (not 500)", async () => {
    const seq = makeSequence();
    seq.previewNextCode.mockRejectedValue(new SequenceNotFoundError("EMPLOYEE_CODE"));
    const { svc } = makeService(makeRepo(), makeDb(), makeAudit(), seq);
    await expect(svc.preview(actorA)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("maps an inactive counter to 422 (not 500)", async () => {
    const seq = makeSequence();
    seq.previewNextCode.mockRejectedValue(new SequenceInactiveError("EMPLOYEE_CODE"));
    const { svc } = makeService(makeRepo(), makeDb(), makeAudit(), seq);
    await expect(svc.preview(actorA)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe("EmployeeCodeConfigService.updateConfig — audit-in-tx, config-only snapshot", () => {
  it("writes exactly one CONFIG_UPDATE audit row, object_type='employee_code_config'", async () => {
    const { svc, audit } = makeService();
    await svc.updateConfig(actorA, { prefix: "STAFF" });
    expect(audit.record).toHaveBeenCalledOnce();
    const [tx, entry] = audit.record.mock.calls[0];
    expect(tx).toBe(FAKE_TX); // same tx as the write (BẤT BIẾN #2)
    expect(entry.objectType).toBe("employee_code_config");
    expect(entry.action).toBe("CONFIG_UPDATE");
    expect(entry.actorUserId).toBe(ACTOR_ID);
    expect(entry.objectId).toBe(CONFIG_ID);
  });

  it("audit payload carries ONLY config fields — never current_value/counter/secret (BẤT BIẾN #3)", async () => {
    const { svc, audit } = makeService();
    await svc.updateConfig(actorA, { prefix: "STAFF" });
    const [, entry] = audit.record.mock.calls[0];
    const blob = JSON.stringify([entry.before, entry.after, entry.oldValues, entry.newValues]);
    for (const k of FORBIDDEN_AUDIT_KEYS) {
      expect(blob, `audit leaked forbidden key ${k}`).not.toContain(k);
    }
  });

  it("supplies old/new so audit computes changed_fields", async () => {
    const { svc, audit } = makeService();
    await svc.updateConfig(actorA, { prefix: "STAFF" });
    const [, entry] = audit.record.mock.calls[0];
    expect(entry.oldValues).toBeDefined();
    expect(entry.newValues).toBeDefined();
  });

  it("inserts a config row (audit before=null) when none exists yet", async () => {
    const repo = makeRepo({ findConfigTx: vi.fn().mockResolvedValue(undefined) });
    const { svc, audit } = makeService(repo);
    await svc.updateConfig(actorA, { prefix: "NEW" });
    expect(repo.insertConfigTx).toHaveBeenCalledOnce();
    expect(repo.updateConfigTx).not.toHaveBeenCalled();
    const [, entry] = audit.record.mock.calls[0];
    expect(entry.before).toBeNull();
  });
});

describe("updateEmployeeCodeConfigSchema — value_type validation (contract)", () => {
  it("accepts a valid partial patch", () => {
    expect(
      updateEmployeeCodeConfigSchema.safeParse({ numberLength: 6, status: "inactive" }).success,
    ).toBe(true);
  });

  it("rejects number_length below/above bounds", () => {
    expect(updateEmployeeCodeConfigSchema.safeParse({ numberLength: 0 }).success).toBe(false);
    expect(updateEmployeeCodeConfigSchema.safeParse({ numberLength: 99 }).success).toBe(false);
    expect(updateEmployeeCodeConfigSchema.safeParse({ numberLength: 4.5 }).success).toBe(false);
  });

  it("rejects an unknown status enum", () => {
    expect(updateEmployeeCodeConfigSchema.safeParse({ status: "archived" }).success).toBe(false);
  });

  it("rejects an empty patch (at least one field required)", () => {
    expect(updateEmployeeCodeConfigSchema.safeParse({}).success).toBe(false);
  });
});
