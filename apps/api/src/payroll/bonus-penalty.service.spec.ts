/**
 * G12-3 deny/FSM RED suite for BonusPenaltyService (CROWN JEWEL — money logic). Mocked repo/db/permission/audit.
 *  (a) permission DENY → create/approve/reject/list/getOne throw Forbidden, 0 write, 0 audit.
 *  (b) self-approve blocked: creator cannot approve/reject own (before service touches the repo update).
 *  (c) FSM: approve/reject/remove only on draft → Conflict otherwise.
 *  (d) reference validated same-tenant → BadRequest when missing.
 *  (e) mapError: check_violation → 409; infra → 500 generic (no leak). amount → number in DTO.
 */
import { describe, expect, it, vi } from "vitest";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { BonusPenaltyService } from "./bonus-penalty.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";
const EMP_ID = "33333333-3333-3333-3333-333333333333";
const BP_ID = "44444444-4444-4444-4444-444444444444";

const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

type Decision = { allow: boolean; reason: string; auditRequired: boolean };
const ALLOW: Decision = { allow: true, reason: "allow", auditRequired: true };
const DENY: Decision = { allow: false, reason: "deny", auditRequired: true };

const FAKE_TX = { __tx: true };
function makeDb() {
  return {
    withTenant: vi.fn((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
}

const draftRow = (over: Record<string, unknown> = {}) => ({
  id: BP_ID,
  companyId: COMPANY_ID,
  userId: EMP_ID,
  kind: "bonus",
  amount: "500.00",
  currency: "VND",
  periodMonth: "2026-05",
  reason: null,
  source: "manual",
  referenceType: null,
  taskId: null,
  defectId: null,
  kpiResultId: null,
  status: "draft",
  approvedBy: null,
  approvedAt: null,
  payrollPeriodId: null,
  consumedAt: null,
  createdBy: OTHER_ID,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function makeRepo(over: Record<string, unknown> = {}) {
  return {
    createTx: vi.fn().mockResolvedValue([draftRow()]),
    listTx: vi.fn().mockResolvedValue([draftRow()]),
    findByIdTx: vi.fn().mockResolvedValue(draftRow()),
    approveTx: vi.fn().mockResolvedValue([draftRow({ status: "approved", approvedBy: ACTOR_ID })]),
    rejectTx: vi.fn().mockResolvedValue([draftRow({ status: "rejected", approvedBy: ACTOR_ID })]),
    softDeleteTx: vi.fn().mockResolvedValue([{ id: BP_ID }]),
    referenceExistsTx: vi.fn().mockResolvedValue(true),
    ...over,
  };
}

function make(decision: Decision, repoOver: Record<string, unknown> = {}) {
  const repo = makeRepo(repoOver);
  const db = makeDb();
  const permission = { can: vi.fn().mockResolvedValue(decision) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const svc = new BonusPenaltyService(
    repo as never,
    db as never,
    permission as never,
    audit as never,
  );
  return { svc, repo, audit, permission };
}

const createDto = (over: Record<string, unknown> = {}) => ({
  userId: EMP_ID,
  kind: "bonus" as const,
  amount: 500,
  periodMonth: "2026-05",
  source: "manual" as const,
  ...over,
});

describe("BonusPenaltyService — permission deny (fail-closed)", () => {
  it("(a) create DENY → Forbidden, 0 insert, 0 audit", async () => {
    const { svc, repo, audit } = make(DENY);
    await expect(svc.create(actor, createDto())).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.createTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("(a) approve/reject/list/getOne DENY → Forbidden", async () => {
    const { svc } = make(DENY);
    await expect(svc.approve(actor, BP_ID)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.reject(actor, BP_ID, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.list(actor, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.getOne(actor, BP_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("BonusPenaltyService — create", () => {
  it("ALLOW → createTx + audit 'bonus_penalty_created'; amount is a number in DTO", async () => {
    const { svc, repo, audit } = make(ALLOW);
    const out = await svc.create(actor, createDto());
    expect(repo.createTx).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ objectType: "bonus_penalty", action: "bonus_penalty_created" }),
    );
    expect(out.amount).toBe(500);
    expect(typeof out.amount).toBe("number");
  });

  it("(d) reference not found in tenant → BadRequest, 0 insert", async () => {
    const { svc, repo } = make(ALLOW, { referenceExistsTx: vi.fn().mockResolvedValue(false) });
    await expect(
      svc.create(actor, createDto({ referenceType: "task", taskId: OTHER_ID })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.createTx).not.toHaveBeenCalled();
  });
});

describe("BonusPenaltyService — approval FSM + self-approve", () => {
  it("(b) self-approve blocked → Forbidden, no approveTx", async () => {
    const { svc, repo, audit } = make(ALLOW, {
      findByIdTx: vi.fn().mockResolvedValue(draftRow({ createdBy: ACTOR_ID })),
    });
    await expect(svc.approve(actor, BP_ID)).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.approveTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("ALLOW non-self → approveTx + audit 'bonus_penalty_approved'", async () => {
    const { svc, repo, audit } = make(ALLOW);
    const out = await svc.approve(actor, BP_ID);
    expect(repo.approveTx).toHaveBeenCalled();
    expect(out.status).toBe("approved");
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "bonus_penalty_approved" }),
    );
  });

  it("(c) approve on non-draft → Conflict", async () => {
    const { svc, repo } = make(ALLOW, {
      findByIdTx: vi.fn().mockResolvedValue(draftRow({ status: "approved" })),
    });
    await expect(svc.approve(actor, BP_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.approveTx).not.toHaveBeenCalled();
  });

  it("(c) remove on non-draft → Conflict", async () => {
    const { svc, repo } = make(ALLOW, {
      findByIdTx: vi.fn().mockResolvedValue(draftRow({ status: "approved" })),
    });
    await expect(svc.remove(actor, BP_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(repo.softDeleteTx).not.toHaveBeenCalled();
  });

  it("reject ALLOW non-self → rejectTx + audit 'bonus_penalty_rejected'", async () => {
    const { svc, repo, audit } = make(ALLOW);
    await svc.reject(actor, BP_ID, { reason: "không hợp lệ" });
    expect(repo.rejectTx).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      FAKE_TX,
      expect.objectContaining({ action: "bonus_penalty_rejected" }),
    );
  });
});

describe("BonusPenaltyService — mapError no-leak", () => {
  it("(e) check_violation (trigger) → 409 Conflict", async () => {
    const { svc } = make(ALLOW, {
      createTx: vi.fn().mockRejectedValue(Object.assign(new Error("trigger"), { code: "23514" })),
    });
    await expect(svc.create(actor, createDto())).rejects.toBeInstanceOf(ConflictException);
  });

  it("(e) infra error → 500 generic (no schema/constraint leak)", async () => {
    const { svc } = make(ALLOW, {
      createTx: vi
        .fn()
        .mockRejectedValue(
          Object.assign(new Error('relation "bonus_penalties" does not exist'), { code: "42P01" }),
        ),
    });
    await expect(svc.create(actor, createDto())).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
