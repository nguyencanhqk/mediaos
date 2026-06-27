import { beforeEach, describe, expect, it, vi } from "vitest";
import { SeedTrackingService } from "./seed-tracking.service";
import type { SeedBatchHandle } from "./seed-tracking.types";

/**
 * FOUNDATION-BE-8 — SeedTrackingService unit (mock DatabaseService.withTenant + tx).
 * Crown-jewel checks (BẤT BIẾN #1/#3, idempotent §8.12/8.13):
 *  - startBatch lần 2 cùng key ⇒ reused=true, KHÔNG INSERT mới (ON CONFLICT DO NOTHING → SELECT-back).
 *  - markItem checksum KHÔNG đổi ⇒ Skipped/Skip, KHÔNG UPDATE payload; đổi ⇒ Update.
 *  - checksum KHÔNG chứa secret (payload có field nhạy cảm ⇒ throw, KHÔNG ghi).
 *  - finishBatch: Failed nếu có >=1 item Failed, else Success.
 *  - MỌI lời gọi đi qua withTenant(companyId) — companyId được truyền đúng.
 */

const COMPANY = "22222222-2222-2222-2222-222222222222";
const BATCH_ID = "33333333-3333-3333-3333-333333333333";

interface ExistingRow {
  id: string;
  status?: string;
  checksum?: string | null;
  operation?: string;
  payload?: unknown;
}

/**
 * Tx giả lập drizzle builder. `existing` = hàng SELECT-back trả về (giả lập DB đã có). Ghi nhận
 * insert/update/select để assert "không INSERT mới" / "không UPDATE khi skip".
 */
function makeTx(opts: {
  insertConflict?: boolean; // ON CONFLICT DO NOTHING → returning() rỗng (đã tồn tại)
  selectBack?: ExistingRow[]; // SELECT-back rows
}) {
  const calls = {
    insertReturning: 0,
    update: 0,
    select: 0,
  };
  const insertedRows: Record<string, unknown>[] = [];
  const updatedSets: Record<string, unknown>[] = [];

  const tx = {
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        insertedRows.push(v);
        return {
          onConflictDoNothing: () => ({
            returning: async () => {
              calls.insertReturning++;
              return opts.insertConflict ? [] : [{ id: BATCH_ID }];
            },
          }),
          returning: async () => {
            calls.insertReturning++;
            return [{ id: BATCH_ID }];
          },
        };
      },
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => {
        updatedSets.push(s);
        return {
          where: () => ({
            returning: async () => {
              calls.update++;
              return [{ id: BATCH_ID }];
            },
          }),
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            calls.select++;
            return opts.selectBack ?? [];
          },
        }),
      }),
    }),
  };
  return { tx, calls, insertedRows, updatedSets };
}

function makeDb(txHarness: ReturnType<typeof makeTx>) {
  const withTenant = vi.fn(async (_cid: string, fn: (tx: unknown) => unknown) =>
    fn(txHarness.tx),
  );
  return { db: { withTenant } as never, withTenant };
}

describe("SeedTrackingService", () => {
  let harness: ReturnType<typeof makeTx>;

  beforeEach(() => {
    harness = makeTx({});
  });

  describe("startBatch", () => {
    it("batch mới: INSERT + reused=false; companyId truyền vào withTenant", async () => {
      harness = makeTx({ insertConflict: false });
      const { db, withTenant } = makeDb(harness);
      const svc = new SeedTrackingService(db);

      const res: SeedBatchHandle = await svc.startBatch({
        companyId: COMPANY,
        seedKey: "modules.catalog",
        seedVersion: "v1",
      });

      expect(res.reused).toBe(false);
      expect(res.id).toBe(BATCH_ID);
      expect(withTenant).toHaveBeenCalledWith(COMPANY, expect.any(Function));
    });

    it("batch đã tồn tại (ON CONFLICT DO NOTHING) ⇒ reused=true, SELECT-back, KHÔNG tạo mới", async () => {
      harness = makeTx({
        insertConflict: true,
        selectBack: [{ id: BATCH_ID, status: "Success" }],
      });
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);

      const res = await svc.startBatch({
        companyId: COMPANY,
        seedKey: "modules.catalog",
        seedVersion: "v1",
      });

      expect(res.reused).toBe(true);
      expect(res.id).toBe(BATCH_ID);
      // SELECT-back đã chạy để lấy batch tồn tại.
      expect(harness.calls.select).toBeGreaterThanOrEqual(1);
    });
  });

  describe("markItem", () => {
    it("item mới ⇒ Insert/Upsert, ghi payload+checksum", async () => {
      harness = makeTx({ selectBack: [] }); // chưa có item
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);

      const res = await svc.markItem({
        companyId: COMPANY,
        batchId: BATCH_ID,
        targetTable: "modules",
        targetKey: "AUTH",
        operation: "Upsert",
        payload: { name: "AUTH" },
      });

      expect(res.status).toBe("Success");
      expect(["Insert", "Upsert"]).toContain(res.operation);
      // Đã ghi (insert hoặc update tuỳ chiến lược upsert).
      expect(harness.calls.insertReturning + harness.calls.update).toBeGreaterThanOrEqual(1);
    });

    it("item tồn tại + checksum KHÔNG đổi ⇒ Skipped/Skip, KHÔNG UPDATE payload", async () => {
      // Tính checksum của payload để giả lập "đã có cùng checksum".
      const { computeChecksum } = await import("./seed-checksum.util");
      const payload = { name: "AUTH" };
      const sameChecksum = computeChecksum(payload);
      harness = makeTx({
        selectBack: [{ id: "item-1", checksum: sameChecksum, operation: "Upsert" }],
      });
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);

      const res = await svc.markItem({
        companyId: COMPANY,
        batchId: BATCH_ID,
        targetTable: "modules",
        targetKey: "AUTH",
        operation: "Upsert",
        payload,
      });

      expect(res.status).toBe("Skipped");
      expect(res.operation).toBe("Skip");
      expect(harness.updatedSets).toHaveLength(0); // KHÔNG update payload
    });

    it("item tồn tại + checksum ĐỔI ⇒ Update", async () => {
      harness = makeTx({
        selectBack: [{ id: "item-1", checksum: "deadbeef", operation: "Upsert" }],
      });
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);

      const res = await svc.markItem({
        companyId: COMPANY,
        batchId: BATCH_ID,
        targetTable: "modules",
        targetKey: "AUTH",
        operation: "Upsert",
        payload: { name: "AUTH-renamed" },
      });

      expect(res.operation).toBe("Update");
      expect(res.status).toBe("Success");
      expect(harness.updatedSets.length).toBeGreaterThanOrEqual(1);
    });

    it("BẤT BIẾN #3: payload chứa secret ⇒ throw, KHÔNG ghi", async () => {
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);

      await expect(
        svc.markItem({
          companyId: COMPANY,
          batchId: BATCH_ID,
          targetTable: "platform_accounts",
          targetKey: "X",
          payload: { token: "super-secret" },
        }),
      ).rejects.toThrow();
      expect(harness.insertedRows).toHaveLength(0);
      expect(harness.updatedSets).toHaveLength(0);
    });

    it("companyId được truyền vào withTenant ở markItem", async () => {
      harness = makeTx({ selectBack: [] });
      const { db, withTenant } = makeDb(harness);
      const svc = new SeedTrackingService(db);
      await svc.markItem({
        companyId: COMPANY,
        batchId: BATCH_ID,
        targetTable: "modules",
        targetKey: "HR",
        payload: { name: "HR" },
      });
      expect(withTenant).toHaveBeenCalledWith(COMPANY, expect.any(Function));
    });
  });

  describe("markItemFailed", () => {
    it("ghi status=Failed + errorMessage", async () => {
      harness = makeTx({ selectBack: [] });
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);
      const res = await svc.markItemFailed({
        companyId: COMPANY,
        batchId: BATCH_ID,
        targetTable: "modules",
        targetKey: "BAD",
        errorMessage: "constraint violation",
      });
      expect(res.status).toBe("Failed");
    });
  });

  describe("finishBatch", () => {
    it("có >=1 item Failed ⇒ batch status Failed", async () => {
      harness = makeTx({
        selectBack: [{ id: "i1", status: "Success" }, { id: "i2", status: "Failed" }],
      });
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);
      const res = await svc.finishBatch(COMPANY, BATCH_ID);
      expect(res.status).toBe("Failed");
    });

    it("không item Failed ⇒ batch status Success", async () => {
      harness = makeTx({
        selectBack: [{ id: "i1", status: "Success" }, { id: "i2", status: "Skipped" }],
      });
      const { db } = makeDb(harness);
      const svc = new SeedTrackingService(db);
      const res = await svc.finishBatch(COMPANY, BATCH_ID);
      expect(res.status).toBe("Success");
    });

    it("companyId truyền vào withTenant ở finishBatch", async () => {
      harness = makeTx({ selectBack: [] });
      const { db, withTenant } = makeDb(harness);
      const svc = new SeedTrackingService(db);
      await svc.finishBatch(COMPANY, BATCH_ID);
      expect(withTenant).toHaveBeenCalledWith(COMPANY, expect.any(Function));
    });
  });
});
