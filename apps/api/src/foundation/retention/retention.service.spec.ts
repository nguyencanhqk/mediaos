import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetentionService } from "./retention.service";
import type { RetentionPolicyRow } from "./retention.types";

/**
 * FOUNDATION-BE-8 — RetentionService unit (mock DatabaseService.withTenant + tx).
 * Crown-jewel checks (§17.3/§17.4, BẤT BIẾN #1/#2):
 *  - simulate: đếm eligible (read-only), KHÔNG gọi delete/update mutate.
 *  - runCleanup mặc định dryRun=true ⇒ deletedRecords=0, KHÔNG mutate.
 *  - runCleanup khi !isEnabled ⇒ skippedDisabled=true, deletedRecords=0 KỂ CẢ dryRun=false (§17.4.1).
 *  - create/update policy đi qua withTenant(companyId), companyId KHÔNG NULL.
 *  - KHÔNG có code path DELETE trên audit_logs.
 */

const COMPANY = "22222222-2222-2222-2222-222222222222";
const POLICY_ID = "44444444-4444-4444-4444-444444444444";

function makePolicy(over: Partial<RetentionPolicyRow> = {}): RetentionPolicyRow {
  return {
    id: POLICY_ID,
    companyId: COMPANY,
    moduleCode: "AUTH",
    entityType: "audit_logs",
    retentionDays: 365,
    cleanupAction: "Delete",
    archiveAfterDays: null,
    deleteAfterDays: null,
    isLegalHoldSupported: false,
    isEnabled: true,
    description: null,
    deletedAt: null,
    ...over,
  };
}

/** Tx giả lập: ghi nhận mutate (delete/update.set) + cho phép select COUNT. */
function makeTx(opts: { policy?: RetentionPolicyRow; eligibleCount?: number }) {
  const calls = { delete: 0, updateMutate: 0, select: 0, insert: 0 };
  const insertedValues: Record<string, unknown>[] = [];

  const selectChain = {
    from: () => ({
      where: () => ({
        limit: async () => {
          calls.select++;
          return opts.policy ? [opts.policy] : [];
        },
        // COUNT path: where().then(...)
        then: (resolve: (rows: { count: number }[]) => unknown) => {
          calls.select++;
          return Promise.resolve(resolve([{ count: opts.eligibleCount ?? 0 }]));
        },
      }),
    }),
  };

  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedValues.push(v);
        calls.insert++;
        return {
          returning: async () => [opts.policy ?? makePolicy()],
        };
      },
    }),
    update: () => ({
      set: (_s: Record<string, unknown>) => {
        calls.updateMutate++;
        return {
          where: () => ({
            returning: async () => [opts.policy ?? makePolicy()],
          }),
        };
      },
    }),
    delete: () => {
      calls.delete++;
      return { where: async () => ({ rowCount: 0 }) };
    },
    select: () => selectChain,
    execute: async () => ({ rows: [{ count: opts.eligibleCount ?? 0 }] }),
  };
  return { tx, calls, insertedValues };
}

function makeDb(harness: ReturnType<typeof makeTx>) {
  const withTenant = vi.fn(async (_cid: string, fn: (tx: unknown) => unknown) =>
    fn(harness.tx),
  );
  return { db: { withTenant } as never, withTenant };
}

describe("RetentionService", () => {
  let harness: ReturnType<typeof makeTx>;

  beforeEach(() => {
    harness = makeTx({});
  });

  describe("createPolicy", () => {
    it("đi qua withTenant(companyId) và ghi company_id = companyId (KHÔNG NULL)", async () => {
      harness = makeTx({ policy: makePolicy() });
      const { db, withTenant } = makeDb(harness);
      const svc = new RetentionService(db);

      await svc.createPolicy({
        companyId: COMPANY,
        moduleCode: "AUTH",
        entityType: "audit_logs",
        retentionDays: 365,
        cleanupAction: "Delete",
      });

      expect(withTenant).toHaveBeenCalledWith(COMPANY, expect.any(Function));
      expect(harness.insertedValues[0].companyId).toBe(COMPANY);
      expect(harness.insertedValues[0].companyId).not.toBeNull();
    });
  });

  describe("updatePolicy", () => {
    it("đi qua withTenant(companyId), KHÔNG xoá", async () => {
      harness = makeTx({ policy: makePolicy() });
      const { db, withTenant } = makeDb(harness);
      const svc = new RetentionService(db);
      await svc.updatePolicy(COMPANY, POLICY_ID, { retentionDays: 90 });
      expect(withTenant).toHaveBeenCalledWith(COMPANY, expect.any(Function));
      expect(harness.calls.delete).toBe(0);
    });
  });

  describe("simulate", () => {
    it("đếm eligible (read-only) — KHÔNG gọi delete/update mutate", async () => {
      harness = makeTx({ policy: makePolicy(), eligibleCount: 42 });
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);

      const res = await svc.simulate(COMPANY, POLICY_ID);

      expect(res.eligibleRecords).toBe(42);
      expect(res.isEnabled).toBe(true);
      expect(harness.calls.delete).toBe(0);
      expect(harness.calls.updateMutate).toBe(0);
    });

    it("cutoffTime = now - retentionDays (xấp xỉ)", async () => {
      harness = makeTx({ policy: makePolicy({ retentionDays: 10 }), eligibleCount: 0 });
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);
      const before = Date.now() - 10 * 24 * 3600 * 1000;
      const res = await svc.simulate(COMPANY, POLICY_ID);
      const drift = Math.abs(res.cutoffTime.getTime() - before);
      expect(drift).toBeLessThan(60_000); // < 1 phút sai lệch
    });
  });

  describe("runCleanup", () => {
    it("mặc định dryRun=true ⇒ deletedRecords=0, dryRun=true, KHÔNG mutate", async () => {
      harness = makeTx({ policy: makePolicy({ isEnabled: true }), eligibleCount: 7 });
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);

      const res = await svc.runCleanup(COMPANY, POLICY_ID);

      expect(res.dryRun).toBe(true);
      expect(res.deletedRecords).toBe(0);
      expect(res.eligibleRecords).toBe(7);
      expect(harness.calls.delete).toBe(0);
    });

    it("§17.4.1: !isEnabled ⇒ skippedDisabled=true, deletedRecords=0 KỂ CẢ dryRun=false", async () => {
      harness = makeTx({ policy: makePolicy({ isEnabled: false }), eligibleCount: 99 });
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);

      const res = await svc.runCleanup(COMPANY, POLICY_ID, { dryRun: false });

      expect(res.skippedDisabled).toBe(true);
      expect(res.deletedRecords).toBe(0);
      expect(harness.calls.delete).toBe(0);
      expect(harness.calls.updateMutate).toBe(0);
    });

    it("KHÔNG có đường xoá audit_logs: policy entity audit_logs + enabled + !dryRun ⇒ KHÔNG DELETE", async () => {
      harness = makeTx({
        policy: makePolicy({ entityType: "audit_logs", isEnabled: true, cleanupAction: "Delete" }),
        eligibleCount: 5,
      });
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);

      const res = await svc.runCleanup(COMPANY, POLICY_ID, { dryRun: false });

      // audit_logs append-only — runCleanup phải từ chối xoá (skip/no-op), tuyệt đối KHÔNG DELETE.
      expect(harness.calls.delete).toBe(0);
      expect(res.deletedRecords).toBe(0);
    });
  });
});
