/**
 * FOUNDATION-BE-2 — Deny-path + behaviour unit suite cho SequenceService (mock repo/db/audit, KHÔNG Postgres).
 *
 * Pin các bất biến TRƯỚC happy-path:
 *   (a) nextCode GỌI lockCounterForUpdateTx (FOR UPDATE) BÊN TRONG withTenant(companyId); KHÔNG MAX(code)+1.
 *   (b) counter Inactive ⇒ SequenceInactiveError, KHÔNG mutate (updateCounterValueTx 0 lần).
 *   (c) counter không tồn tại ⇒ SequenceNotFoundError.
 *   (d) reset Yearly/Monthly/Daily theo tz công ty: kỳ đổi ⇒ value bắt đầu lại từ incrementBy (KHÔNG cộng dồn);
 *       Never ⇒ cộng dồn.
 *   (e) previewNextCode KHÔNG gọi updateCounterValueTx (spy 0 lần) + trả code của value kế tiếp.
 *   (f) updateSequence ghi audit 'sequence_counter'/SequenceUpdated BÊN TRONG cùng withTenant tx; before/after
 *       KHÔNG chứa current_value/secret.
 */

import { describe, expect, it, vi } from "vitest";
import type { AuditService } from "../../events/audit.service";
import type { DatabaseService } from "../../db/db.service";
import { SequenceService } from "./sequence.service";
import type { SequenceRepository } from "./sequence.repository";
import { SequenceInactiveError, SequenceNotFoundError } from "./sequence.types";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const COUNTER_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

const FAKE_TX = Symbol("tx");

function makeCounter(overrides: Record<string, unknown> = {}) {
  return {
    id: COUNTER_ID,
    companyId: COMPANY_ID,
    moduleCode: "HR",
    sequenceKey: "EMPLOYEE_CODE",
    scopeType: "Company",
    scopeReferenceId: null,
    prefix: "EMP",
    suffix: null,
    currentValue: 5n,
    incrementBy: 1,
    paddingLength: 4,
    resetPolicy: "Never",
    resetFormat: null,
    lastResetAt: null,
    lastGeneratedCode: "EMP0005",
    formatPattern: null,
    lockVersion: 0,
    status: "Active",
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    lockCounterForUpdateTx: vi.fn().mockResolvedValue(makeCounter()),
    findCounterTx: vi.fn().mockResolvedValue(makeCounter()),
    updateCounterValueTx: vi.fn().mockResolvedValue(undefined),
    updateConfigTx: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

/** withTenant mock: chạy fn với FAKE_TX và ghi lại companyId được dùng. */
function makeDb() {
  const withTenant = vi
    .fn()
    .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX));
  return { withTenant };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

type Repo = ReturnType<typeof makeRepo>;
type Db = ReturnType<typeof makeDb>;
type Audit = ReturnType<typeof makeAudit>;

function makeService(repo: Repo = makeRepo(), audit: Audit = makeAudit(), db: Db = makeDb()) {
  // Mock DI qua unknown: chỉ shape các method dùng trong test cần khớp — KHÔNG cast `any`.
  const svc = new SequenceService(
    db as unknown as DatabaseService,
    repo as unknown as SequenceRepository,
    audit as unknown as AuditService,
  );
  return { svc, repo, audit, db };
}

describe("SequenceService.nextCode", () => {
  it("(a) lock FOR UPDATE bên trong withTenant(companyId) — KHÔNG MAX(code)+1", async () => {
    const { svc, repo, db } = makeService();
    await svc.nextCode(COMPANY_ID, { sequenceKey: "EMPLOYEE_CODE" });

    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
    expect(repo.lockCounterForUpdateTx).toHaveBeenCalledTimes(1);
    // tx truyền cho repo PHẢI là tx của withTenant (FAKE_TX) — không đọc thẳng db/pool.
    expect(repo.lockCounterForUpdateTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ sequenceKey: "EMPLOYEE_CODE" }),
      FAKE_TX,
    );
  });

  it("cấp mã = prefix + pad(current_value+increment_by) và UPDATE current_value mới", async () => {
    const repo = makeRepo({
      lockCounterForUpdateTx: vi.fn().mockResolvedValue(makeCounter({ currentValue: 5n, incrementBy: 1 })),
    });
    const { svc } = makeService(repo);
    const res = await svc.nextCode(COMPANY_ID, { sequenceKey: "EMPLOYEE_CODE" });

    expect(res).toEqual({ sequenceKey: "EMPLOYEE_CODE", value: 6, code: "EMP0006" });
    expect(repo.updateCounterValueTx).toHaveBeenCalledTimes(1);
    expect(repo.updateCounterValueTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.any(Object),
      expect.objectContaining({ currentValue: 6n, lastGeneratedCode: "EMP0006" }),
      FAKE_TX,
    );
  });

  it("(b) counter Inactive ⇒ SequenceInactiveError, KHÔNG mutate", async () => {
    const repo = makeRepo({
      lockCounterForUpdateTx: vi.fn().mockResolvedValue(makeCounter({ status: "Inactive" })),
    });
    const { svc } = makeService(repo);
    await expect(svc.nextCode(COMPANY_ID, { sequenceKey: "EMPLOYEE_CODE" })).rejects.toBeInstanceOf(
      SequenceInactiveError,
    );
    expect(repo.updateCounterValueTx).not.toHaveBeenCalled();
  });

  it("(c) counter không tồn tại ⇒ SequenceNotFoundError", async () => {
    const repo = makeRepo({ lockCounterForUpdateTx: vi.fn().mockResolvedValue(undefined) });
    const { svc } = makeService(repo);
    await expect(svc.nextCode(COMPANY_ID, { sequenceKey: "MISSING" })).rejects.toBeInstanceOf(
      SequenceNotFoundError,
    );
    expect(repo.updateCounterValueTx).not.toHaveBeenCalled();
  });

  it("(d) reset Never ⇒ cộng dồn (qua biên tháng vẫn tiếp tục)", async () => {
    const repo = makeRepo({
      lockCounterForUpdateTx: vi
        .fn()
        .mockResolvedValue(
          makeCounter({
            resetPolicy: "Never",
            currentValue: 41n,
            lastResetAt: new Date("2026-01-31T00:00:00Z"),
          }),
        ),
    });
    const { svc } = makeService(repo);
    const res = await svc.nextCode(COMPANY_ID, {
      sequenceKey: "EMPLOYEE_CODE",
      now: new Date("2026-02-01T03:00:00Z"),
    });
    expect(res.value).toBe(42); // cộng dồn, KHÔNG reset
  });

  it("(d) reset Monthly: sang tháng (theo tz VN) ⇒ value bắt đầu lại từ increment_by + set last_reset_at", async () => {
    const repo = makeRepo({
      lockCounterForUpdateTx: vi.fn().mockResolvedValue(
        makeCounter({
          resetPolicy: "Monthly",
          paddingLength: 4,
          prefix: "INV",
          formatPattern: "yyyyMM",
          currentValue: 99n,
          incrementBy: 1,
          lastResetAt: new Date("2026-01-15T00:00:00Z"), // kỳ 2026-01
        }),
      ),
    });
    const { svc } = makeService(repo);
    const now = new Date("2026-02-10T05:00:00Z"); // 2026-02 ở VN
    const res = await svc.nextCode(COMPANY_ID, { sequenceKey: "INV", now });

    expect(res.value).toBe(1); // reset về increment_by, KHÔNG 100
    expect(res.code).toBe("INV2026020001");
    expect(repo.updateCounterValueTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.any(Object),
      expect.objectContaining({ currentValue: 1n, lastResetAt: now }),
      FAKE_TX,
    );
  });

  it("(d) reset Monthly: cùng tháng ⇒ cộng dồn, KHÔNG set last_reset_at", async () => {
    const repo = makeRepo({
      lockCounterForUpdateTx: vi.fn().mockResolvedValue(
        makeCounter({
          resetPolicy: "Monthly",
          currentValue: 7n,
          incrementBy: 1,
          lastResetAt: new Date("2026-02-02T00:00:00Z"),
        }),
      ),
    });
    const { svc } = makeService(repo);
    const res = await svc.nextCode(COMPANY_ID, {
      sequenceKey: "INV",
      now: new Date("2026-02-20T05:00:00Z"),
    });
    expect(res.value).toBe(8);
    const call = repo.updateCounterValueTx.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(call).not.toHaveProperty("lastResetAt");
  });

  it("(d) reset Daily: biên ngày theo tz VN — instant UTC cuối ngày đã sang ngày kế ở VN ⇒ reset", async () => {
    const repo = makeRepo({
      lockCounterForUpdateTx: vi.fn().mockResolvedValue(
        makeCounter({
          resetPolicy: "Daily",
          currentValue: 30n,
          incrementBy: 1,
          // last reset 2026-03-09 (VN). now = 2026-03-09T18:00Z = 2026-03-10 01:00 VN ⇒ ngày kế.
          lastResetAt: new Date("2026-03-09T05:00:00Z"),
        }),
      ),
    });
    const { svc } = makeService(repo);
    const res = await svc.nextCode(COMPANY_ID, {
      sequenceKey: "DAILY",
      now: new Date("2026-03-09T18:00:00Z"),
    });
    expect(res.value).toBe(1); // sang ngày VN ⇒ reset
  });

  it("increment_by > 1 cộng đúng bước", async () => {
    const repo = makeRepo({
      lockCounterForUpdateTx: vi.fn().mockResolvedValue(makeCounter({ currentValue: 10n, incrementBy: 5 })),
    });
    const { svc } = makeService(repo);
    const res = await svc.nextCode(COMPANY_ID, { sequenceKey: "EMPLOYEE_CODE" });
    expect(res.value).toBe(15);
  });
});

describe("SequenceService.previewNextCode", () => {
  it("(e) KHÔNG gọi updateCounterValueTx (0 lần) + trả mã của value kế tiếp", async () => {
    const repo = makeRepo({
      findCounterTx: vi.fn().mockResolvedValue(makeCounter({ currentValue: 5n, incrementBy: 1 })),
    });
    const { svc } = makeService(repo);
    const res = await svc.previewNextCode(COMPANY_ID, { sequenceKey: "EMPLOYEE_CODE" });

    expect(res).toEqual({ sequenceKey: "EMPLOYEE_CODE", value: 6, code: "EMP0006" });
    expect(repo.updateCounterValueTx).toHaveBeenCalledTimes(0);
    // preview đọc KHÔNG lock.
    expect(repo.lockCounterForUpdateTx).toHaveBeenCalledTimes(0);
    expect(repo.findCounterTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ sequenceKey: "EMPLOYEE_CODE" }),
      FAKE_TX,
    );
  });

  it("preview Inactive ⇒ SequenceInactiveError, KHÔNG mutate", async () => {
    const repo = makeRepo({
      findCounterTx: vi.fn().mockResolvedValue(makeCounter({ status: "Inactive" })),
    });
    const { svc } = makeService(repo);
    await expect(
      svc.previewNextCode(COMPANY_ID, { sequenceKey: "EMPLOYEE_CODE" }),
    ).rejects.toBeInstanceOf(SequenceInactiveError);
    expect(repo.updateCounterValueTx).not.toHaveBeenCalled();
  });

  it("preview không tồn tại ⇒ SequenceNotFoundError", async () => {
    const repo = makeRepo({ findCounterTx: vi.fn().mockResolvedValue(undefined) });
    const { svc } = makeService(repo);
    await expect(svc.previewNextCode(COMPANY_ID, { sequenceKey: "X" })).rejects.toBeInstanceOf(
      SequenceNotFoundError,
    );
  });
});

describe("SequenceService.updateSequence", () => {
  it("(f) ghi audit 'sequence_counter'/SequenceUpdated trong cùng withTenant tx; before/after KHÔNG có current_value", async () => {
    const before = makeCounter({ prefix: "EMP", paddingLength: 4, currentValue: 123n });
    const after = makeCounter({ prefix: "NV", paddingLength: 6, currentValue: 123n });
    const repo = makeRepo({
      findCounterTx: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
    });
    const { svc, audit, db } = makeService(repo);

    const result = await svc.updateSequence(
      actor,
      { sequenceKey: "EMPLOYEE_CODE" },
      { prefix: "NV", paddingLength: 6 },
    );

    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
    expect(repo.updateConfigTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);

    const [txArg, entry] = audit.record.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(txArg).toBe(FAKE_TX); // audit CÙNG tx nghiệp vụ
    expect(entry["objectType"]).toBe("sequence_counter");
    expect(entry["action"]).toBe("SequenceUpdated");
    expect(entry["actorUserId"]).toBe(ACTOR_ID);
    // before/after = cấu hình, KHÔNG current_value/secret.
    expect(entry["before"]).not.toHaveProperty("currentValue");
    expect(entry["after"]).not.toHaveProperty("currentValue");
    expect(entry["before"]).toMatchObject({ prefix: "EMP", paddingLength: 4 });
    expect(entry["after"]).toMatchObject({ prefix: "NV", paddingLength: 6 });
    expect(result).toMatchObject({ prefix: "NV", paddingLength: 6 });
  });

  it("updateSequence counter không tồn tại ⇒ SequenceNotFoundError, KHÔNG update/audit", async () => {
    const repo = makeRepo({ findCounterTx: vi.fn().mockResolvedValue(undefined) });
    const { svc, audit } = makeService(repo);
    await expect(
      svc.updateSequence(actor, { sequenceKey: "MISSING" }, { prefix: "X" }),
    ).rejects.toBeInstanceOf(SequenceNotFoundError);
    expect(repo.updateConfigTx).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("updateConfigTx nhận actorUserId (truy vết updated_by)", async () => {
    const repo = makeRepo();
    const { svc } = makeService(repo);
    await svc.updateSequence(actor, { sequenceKey: "EMPLOYEE_CODE" }, { status: "Inactive" });
    expect(repo.updateConfigTx).toHaveBeenCalledWith(
      COMPANY_ID,
      expect.objectContaining({ sequenceKey: "EMPLOYEE_CODE" }),
      expect.objectContaining({ status: "Inactive", actorUserId: ACTOR_ID }),
      FAKE_TX,
    );
  });
});
