import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/index";
import type { DatabaseService } from "../db/db.service";
import { AuditMaskerService } from "../events/audit-masker.service";
import type { JobHandler, JobRunResult } from "./job-handler";
import type { JobLockService } from "./job-lock.service";
import { type FinishRunInput, JobRunLogger } from "./job-run-logger";
import { JobRunner } from "./job-runner";

/**
 * RED (crown) — JobRunner + JobRunLogger:
 *  - finish-once: 1 run-row chỉ chuyển Running→terminal 1 lần (guard kép: Set in-memory + DB WHERE Running).
 *  - company_id ghi TƯỜNG MINH mỗi run-row.
 *  - job fail 1 tenant KHÔNG chặn tenant kế (per-item try/catch, mẫu outbox).
 *  - lock rỗng → skip (KHÔNG chạy handler / KHÔNG ghi run-row).
 *  - materialize tenant TRƯỚC khi gọi handler.run (chống nested-context).
 *  - secret-scrub error_message + mask metadata (JobRunLogger.buildFinishRow).
 */

// Fake worker-db: trả role AN TOÀN cho assertWorkerRoleSafe (pg_roles) + `id` cho INSERT/UPDATE RETURNING.
function makeSafeWorkerDb(): { db: Database; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue({
    rows: [{ role: "mediaos_worker", rolsuper: false, rolbypassrls: false, id: "run-1" }],
  });
  return { db: { execute } as unknown as Database, execute };
}

function result(over: Partial<JobRunResult> = {}): JobRunResult {
  return { total: 1, success: 1, failed: 0, ...over };
}

/** Input hợp lệ cho JobRunLogger.finish (cần `status` terminal — khác JobRunResult). */
function finishInput(): FinishRunInput {
  return { status: "Success", total: 1, success: 1, failed: 0 };
}

describe("JobRunLogger", () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("buildFinishRow: error_message đã scrub secret + metadata đã mask (BẤT BIẾN #3)", () => {
    const { db } = makeSafeWorkerDb();
    const logger = new JobRunLogger(new AuditMaskerService(), db);

    const row = logger.buildFinishRow({
      status: "Failed",
      failed: 1,
      error: new Error("connect failed password=abc123"),
      metadata: { token: "leak-me", processed: 5 },
    });

    expect(row.errorMessage).not.toBeNull();
    expect(row.errorMessage).not.toContain("abc123");
    expect(row.errorMessage).toContain("password=***");
    const meta = row.metadata as Record<string, unknown>;
    expect(meta.token).toBe("***"); // khoá nhạy cảm → che
    expect(meta.processed).toBe(5); // field lành → giữ
  });

  it("finish-once: gọi finish() 2 lần cùng runId → UPDATE chỉ chạy 1 lần (guard in-memory)", async () => {
    const { db, execute } = makeSafeWorkerDb();
    const logger = new JobRunLogger(new AuditMaskerService(), db);

    await logger.finish("run-1", finishInput());
    await logger.finish("run-1", finishInput()); // no-op (đã finalize)
    await logger.finish("run-1", finishInput()); // vẫn no-op

    // 1 lần role-check (pg_roles) + ĐÚNG 1 lần UPDATE (2 finish sau bị Set chặn trước khi chạm DB).
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("fail-closed: workerDb vắng → start/finish NÉM trước khi chạm DB", async () => {
    const logger = new JobRunLogger(new AuditMaskerService(), null);
    await expect(
      logger.start({ companyId: null, jobCode: "X", triggeredBy: "System" }),
    ).rejects.toThrow(/fail-closed/);
    await expect(logger.finish("run-1", finishInput())).rejects.toThrow(/fail-closed/);
  });
});

// ── JobRunner (fake lock/logger/db) ──────────────────────────────────────────────
interface RunnerMocks {
  runner: JobRunner;
  locks: { acquire: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> };
  runLog: { start: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn> };
  order: string[];
  handler: JobHandler & { run: ReturnType<typeof vi.fn> };
}

function makeRunner(opts: {
  acquired?: boolean;
  companyIds?: string[];
  run?: (companyId: string) => Promise<JobRunResult>;
}): RunnerMocks {
  const order: string[] = [];
  const companyIds = opts.companyIds ?? ["comp-A", "comp-B"];

  const locks = {
    acquire: vi.fn().mockResolvedValue(opts.acquired ?? true),
    release: vi.fn().mockResolvedValue(undefined),
  };
  const runLog = {
    start: vi.fn(async (input: { companyId: string }) => `run-${input.companyId}`),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  const dbService = {
    withPlatformContext: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      order.push("enum:start");
      const tx = { execute: async () => ({ rows: companyIds.map((id) => ({ id })) }) };
      const r = await fn(tx);
      order.push("enum:end");
      return r;
    }),
  };
  const run = vi.fn(async (ctx: { companyId: string }): Promise<JobRunResult> => {
    order.push(`run:${ctx.companyId}`);
    return opts.run ? opts.run(ctx.companyId) : result();
  });
  const handler = { jobCode: "TEST_JOB", run } as JobHandler & { run: typeof run };

  const runner = new JobRunner(
    locks as unknown as JobLockService,
    runLog as unknown as JobRunLogger,
    dbService as unknown as DatabaseService,
  );
  return { runner, locks, runLog, order, handler };
}

describe("JobRunner.runJob", () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("lock rỗng (acquire=false) → skip: KHÔNG enumerate, KHÔNG start run-row, KHÔNG chạy handler", async () => {
    const m = makeRunner({ acquired: false });
    const summary = await m.runner.runJob("TEST_JOB", m.handler);

    expect(summary.skipped).toBe(true);
    expect(m.handler.run).not.toHaveBeenCalled();
    expect(m.runLog.start).not.toHaveBeenCalled();
    expect(m.locks.release).not.toHaveBeenCalled(); // chưa acquire → không release
  });

  it("company_id ghi TƯỜNG MINH mỗi run-row + handler.run nhận đúng companyId từng tenant", async () => {
    const m = makeRunner({ companyIds: ["comp-A", "comp-B"] });
    await m.runner.runJob("TEST_JOB", m.handler);

    expect(m.runLog.start).toHaveBeenCalledTimes(2);
    expect(m.runLog.start).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ companyId: "comp-A" }),
    );
    expect(m.runLog.start).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ companyId: "comp-B" }),
    );
    expect(m.handler.run).toHaveBeenNthCalledWith(1, { companyId: "comp-A" });
    expect(m.handler.run).toHaveBeenNthCalledWith(2, { companyId: "comp-B" });
    expect(m.locks.release).toHaveBeenCalledTimes(1); // release đúng 1 lần quanh toàn vòng
  });

  it("materialize tenant TRƯỚC khi gọi handler.run (không nested-context)", async () => {
    const m = makeRunner({ companyIds: ["comp-A", "comp-B"] });
    await m.runner.runJob("TEST_JOB", m.handler);
    // enumerate đóng (enum:end) TRƯỚC mọi lần run:* — handler chạy NGOÀI tx enumerate.
    expect(m.order).toEqual(["enum:start", "enum:end", "run:comp-A", "run:comp-B"]);
  });

  it("job fail 1 tenant KHÔNG chặn tenant kế + finish gọi ĐÚNG 1 lần/run-row", async () => {
    const m = makeRunner({
      companyIds: ["comp-A", "comp-B"],
      run: async (companyId) => {
        if (companyId === "comp-A") throw new Error("tenant A boom");
        return result();
      },
    });
    const summary = await m.runner.runJob("TEST_JOB", m.handler);

    // B vẫn chạy dù A ném.
    expect(m.handler.run).toHaveBeenCalledTimes(2);
    expect(summary.failedTenants).toBe(1);
    expect(summary.tenants).toBe(2);
    // finish ĐÚNG 2 lần (1/run-row), KHÔNG gọi lại.
    expect(m.runLog.finish).toHaveBeenCalledTimes(2);
    expect(m.runLog.finish).toHaveBeenCalledWith(
      "run-comp-A",
      expect.objectContaining({ status: "Failed" }),
    );
    expect(m.runLog.finish).toHaveBeenCalledWith(
      "run-comp-B",
      expect.objectContaining({ status: "Success" }),
    );
  });

  it("counts → status: failed>0 & success>0 → Partial", async () => {
    const m = makeRunner({
      companyIds: ["comp-A"],
      run: async () => result({ total: 10, success: 7, failed: 3 }),
    });
    await m.runner.runJob("TEST_JOB", m.handler);
    expect(m.runLog.finish).toHaveBeenCalledWith(
      "run-comp-A",
      expect.objectContaining({ status: "Partial" }),
    );
  });
});
