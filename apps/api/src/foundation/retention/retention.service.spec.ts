import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditService } from "../../events/audit.service";
import { RetentionService } from "./retention.service";
import type { RetentionPolicyRow } from "./retention.types";

/**
 * FOUNDATION-BE-8 + S2-FND-BE-3 (L3) — RetentionService unit (mock DatabaseService.withTenant + tx).
 * Crown-jewel checks (§17.3/§17.4, BẤT BIẾN #1/#2):
 *  - simulate: đếm eligible (read-only), KHÔNG gọi delete/update mutate.
 *  - runCleanup mặc định dryRun=true ⇒ deletedRecords=0, KHÔNG mutate.
 *  - runCleanup khi !isEnabled ⇒ skippedDisabled=true, deletedRecords=0 KỂ CẢ dryRun=false (§17.4.1).
 *  - create/update policy đi qua withTenant(companyId), companyId KHÔNG NULL.
 *  - KHÔNG có code path DELETE trên bảng append-only (audit_logs + tập PROTECTED_TABLES mở rộng).
 *  - updatePolicy: 0 row ⇒ NotFoundException (fail-closed, KHÔNG NPE/500); ghi audit-in-tx
 *    object_type='retention_policy' (old/new = snapshot config).
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
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    deletedAt: null,
    ...over,
  };
}

/** Fake AuditService — ghi nhận record() calls (KHÔNG chạm DB). */
function makeAudit() {
  const record = vi.fn(async () => {});
  return { audit: { record } as unknown as AuditService, record };
}

/** Tx giả lập: ghi nhận mutate (delete/update.set) + cho phép select COUNT. */
function makeTx(opts: { policy?: RetentionPolicyRow; eligibleCount?: number }) {
  const calls = { delete: 0, updateMutate: 0, select: 0, insert: 0, execute: 0 };
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
    // _countEligible + _deleteEligible cùng đi qua execute() → đếm để suy ra CÓ đường DELETE hay không:
    //   protected/disabled/dryRun ⇒ chỉ 1 execute (count). unprotected+enabled+Delete+!dryRun ⇒ 2 (count+DELETE).
    execute: async () => {
      calls.execute++;
      return { rows: [{ count: opts.eligibleCount ?? 0 }] };
    },
  };
  return { tx, calls, insertedValues };
}

function makeDb(harness: ReturnType<typeof makeTx>) {
  const withTenant = vi.fn(async (_cid: string, fn: (tx: unknown) => unknown) => fn(harness.tx));
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

    // S2-FND-BE-8: create HIỆN THIẾU audit → PHẢI ghi audit-in-tx RetentionPolicyCreated (append-only,
    // CÙNG tx nghiệp vụ ⇒ rollback tx ⇒ 0 audit). object_type='retention_policy' (CHECK mig 0456).
    it("ghi audit-in-tx object_type='retention_policy' action='RetentionPolicyCreated' CÙNG tx (rollback ⇒ 0 audit)", async () => {
      harness = makeTx({ policy: makePolicy() });
      const { db } = makeDb(harness);
      const { audit, record } = makeAudit();
      const svc = new RetentionService(db, audit);

      await svc.createPolicy(
        {
          companyId: COMPANY,
          moduleCode: "AUTH",
          entityType: "audit_logs",
          retentionDays: 365,
          cleanupAction: "Delete",
        },
        { id: "actor-create-1" },
      );

      expect(record).toHaveBeenCalledTimes(1);
      const [txArg, entry] = record.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      // CÙNG tx nghiệp vụ (chèn policy) ⇒ audit và policy cùng commit/rollback (chứng minh cùng tx).
      expect(txArg).toBe(harness.tx);
      expect(entry.action).toBe("RetentionPolicyCreated");
      expect(entry.actionGroup).toBe("CONFIG_UPDATE");
      expect(entry.objectType).toBe("retention_policy");
      expect(entry.objectId).toBe(POLICY_ID);
      expect(entry.actorUserId).toBe("actor-create-1");
      expect(entry.permissionCode).toBe("FOUNDATION.RETENTION.MANAGE");
      // newValues = snapshot CẤU HÌNH (KHÔNG secret/PII/companyId/createdBy).
      const newSnap = entry.newValues as Record<string, unknown>;
      expect(newSnap).toHaveProperty("retentionDays");
      expect(newSnap).toHaveProperty("cleanupAction");
      expect(newSnap).not.toHaveProperty("companyId");
      expect(newSnap).not.toHaveProperty("createdBy");
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toMatch(/password|secret|token|identity_number|bank_account/i);
    });
  });

  describe("updatePolicy", () => {
    it("đi qua withTenant(companyId), KHÔNG xoá", async () => {
      harness = makeTx({ policy: makePolicy() });
      const { db, withTenant } = makeDb(harness);
      const { audit } = makeAudit();
      const svc = new RetentionService(db, audit);
      await svc.updatePolicy(COMPANY, POLICY_ID, { retentionDays: 90 }, { id: "actor-1" });
      expect(withTenant).toHaveBeenCalledWith(COMPANY, expect.any(Function));
      expect(harness.calls.delete).toBe(0);
    });

    it("0 row (policy không tồn tại/tenant khác/đã xoá) ⇒ NotFoundException (fail-closed, KHÔNG NPE/500)", async () => {
      harness = makeTx({}); // KHÔNG policy → select trả []
      const { db } = makeDb(harness);
      const { audit, record } = makeAudit();
      const svc = new RetentionService(db, audit);

      await expect(
        svc.updatePolicy(COMPANY, POLICY_ID, { retentionDays: 30 }, { id: "actor-1" }),
      ).rejects.toBeInstanceOf(NotFoundException);
      // KHÔNG mutate + KHÔNG ghi audit khi target không tồn tại.
      expect(harness.calls.updateMutate).toBe(0);
      expect(record).not.toHaveBeenCalled();
    });

    it("ghi audit-in-tx object_type='retention_policy' với old/new snapshot (permissionCode MANAGE)", async () => {
      harness = makeTx({ policy: makePolicy({ isEnabled: false }) });
      const { db } = makeDb(harness);
      const { audit, record } = makeAudit();
      const svc = new RetentionService(db, audit);

      await svc.updatePolicy(COMPANY, POLICY_ID, { isEnabled: true }, { id: "actor-9" });

      expect(record).toHaveBeenCalledTimes(1);
      const [txArg, entry] = record.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
      expect(txArg).toBe(harness.tx); // CÙNG tx nghiệp vụ (append-only, cùng commit)
      expect(entry.objectType).toBe("retention_policy");
      expect(entry.objectId).toBe(POLICY_ID);
      expect(entry.actorUserId).toBe("actor-9");
      expect(entry.permissionCode).toBe("FOUNDATION.RETENTION.MANAGE");
      // old/new = snapshot config (KHÔNG secret/PII) — chỉ field cấu hình.
      const oldSnap = entry.oldValues as Record<string, unknown>;
      const newSnap = entry.newValues as Record<string, unknown>;
      expect(oldSnap).toHaveProperty("retentionDays");
      expect(oldSnap).toHaveProperty("cleanupAction");
      expect(newSnap).toHaveProperty("isEnabled");
      const serialized = JSON.stringify(entry);
      expect(serialized).not.toMatch(/password|secret|token|identity_number|bank_account/i);
    });
  });

  describe("listPolicies", () => {
    it("đi qua withTenant(companyId) + trả policy của tenant (gồm cả disabled)", async () => {
      const rows = [
        makePolicy({ id: "p1", isEnabled: true }),
        makePolicy({ id: "p2", isEnabled: false, entityType: "tasks" }),
      ];
      const listHarness = {
        ...makeTx({}),
        tx: {
          select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }),
        },
      };
      const withTenant = vi.fn(async (_cid: string, fn: (tx: unknown) => unknown) =>
        fn(listHarness.tx),
      );
      const svc = new RetentionService({ withTenant } as never, makeAudit().audit);

      const res = await svc.listPolicies(COMPANY);
      expect(withTenant).toHaveBeenCalledWith(COMPANY, expect.any(Function));
      expect(res.map((p) => p.id)).toEqual(["p1", "p2"]);
      // gồm cả policy disabled (p2 isEnabled=false)
      expect(res.some((p) => p.isEnabled === false)).toBe(true);
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

    // S2-FND-BE-8: policy KHÔNG tồn tại/tenant khác (RLS che) ⇒ NotFoundException (404), TUYỆT ĐỐI KHÔNG
    // 500 do cast 'as RetentionPolicyRow' rồi đọc .retentionDays trên undefined (NPE).
    it("0 row ⇒ NotFoundException (fail-closed, KHÔNG 500/NPE)", async () => {
      harness = makeTx({}); // KHÔNG policy → select().limit() trả []
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);
      await expect(svc.simulate(COMPANY, POLICY_ID)).rejects.toBeInstanceOf(NotFoundException);
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

    // S2-FND-BE-3 (L3) — BẤT BIẾN #2: PROTECTED_TABLES mở rộng phủ ĐỦ tập append-only/ledger. Với MỌI
    // bảng append-only, runCleanup(dryRun=false) KHÔNG xoá kể cả isEnabled=true + action=Delete.
    const APPEND_ONLY_TABLES = [
      "audit_logs",
      "file_access_logs",
      "login_logs",
      "user_security_events",
      "api_key_usages",
      "security_alerts",
      "attendance_logs",
      "leave_balance_transactions",
      "task_activity_logs",
      "notification_delivery_logs",
      "employee_status_histories",
      "payslips",
      "seed_batches",
    ];
    it.each(APPEND_ONLY_TABLES)(
      "PROTECTED: entity='%s' trong tập bảo vệ (set-membership) — BẤT BIẾN #2",
      (entityType) => {
        expect(RetentionService.isProtectedTable(entityType)).toBe(true);
      },
    );

    it.each(APPEND_ONLY_TABLES)(
      "PROTECTED: entity='%s' + isEnabled=true + action=Delete + !dryRun ⇒ deletedRecords=0 + KHÔNG phát lệnh DELETE",
      async (entityType) => {
        harness = makeTx({
          policy: makePolicy({ entityType, isEnabled: true, cleanupAction: "Delete" }),
          eligibleCount: 12,
        });
        const { db } = makeDb(harness);
        const svc = new RetentionService(db);

        const res = await svc.runCleanup(COMPANY, POLICY_ID, { dryRun: false });

        expect(res.deletedRecords).toBe(0);
        expect(res.skippedDisabled).toBe(false); // enabled — bị chặn bởi PROTECTED_TABLES, KHÔNG bởi disabled
        // Chỉ 1 execute (COUNT); KHÔNG có execute thứ hai (DELETE) ⇒ đường xoá KHÔNG được đi.
        expect(harness.calls.execute).toBe(1);
      },
    );

    it("unprotected + enabled + Delete + !dryRun ⇒ ĐI đường DELETE (execute lần 2) — chốt độ nhạy của test PROTECTED", async () => {
      harness = makeTx({
        policy: makePolicy({ entityType: "tasks", isEnabled: true, cleanupAction: "Delete" }),
        eligibleCount: 3,
      });
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);
      await svc.runCleanup(COMPANY, POLICY_ID, { dryRun: false });
      // tasks KHÔNG trong PROTECTED_TABLES ⇒ _deleteEligible chạy ⇒ execute gọi 2 lần (count + DELETE).
      expect(harness.calls.execute).toBe(2);
      expect(RetentionService.isProtectedTable("tasks")).toBe(false);
    });

    // S2-FND-BE-8: policy KHÔNG tồn tại/tenant khác ⇒ NotFoundException (404), KHÔNG 500 (cast NPE).
    it("0 row ⇒ NotFoundException (fail-closed, KHÔNG 500/NPE) — KHÔNG phát lệnh nào", async () => {
      harness = makeTx({}); // KHÔNG policy
      const { db } = makeDb(harness);
      const svc = new RetentionService(db);
      await expect(svc.runCleanup(COMPANY, POLICY_ID)).rejects.toBeInstanceOf(NotFoundException);
      expect(harness.calls.execute).toBe(0);
      expect(harness.calls.delete).toBe(0);
    });
  });
});
