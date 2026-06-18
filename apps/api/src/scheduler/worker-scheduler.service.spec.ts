import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbExportWorker } from "../db-ops/db-export.worker";
import type { OutboxWorker } from "../events/outbox-worker";
import type { WorkerSchedulerConfig } from "./worker-scheduler.config";
import { WorkerSchedulerService } from "./worker-scheduler.service";

let warnSpy: ReturnType<typeof vi.spyOn>;

function makeConfig(over: Partial<WorkerSchedulerConfig> = {}): WorkerSchedulerConfig {
  return { enabled: true, isTestEnv: false, outboxPollMs: 5000, exportPollMs: 10000, ...over };
}

function makeWorkers() {
  return {
    outbox: { processBatch: vi.fn().mockResolvedValue({ claimed: 0, deadLettered: 0 }) },
    exportWorker: { processBatch: vi.fn().mockResolvedValue({ claimed: 0, done: 0, failed: 0 }) },
  };
}

function makeService(config: WorkerSchedulerConfig, workers: ReturnType<typeof makeWorkers>) {
  return new WorkerSchedulerService(
    workers.outbox as unknown as OutboxWorker,
    workers.exportWorker as unknown as DbExportWorker,
    config,
  );
}

describe("WorkerSchedulerService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Im lặng log để không nhiễu output test; spy riêng cho assertion error path.
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gọi processBatch của mỗi worker theo đúng chu kỳ độc lập", async () => {
    const workers = makeWorkers();
    const svc = makeService(makeConfig(), workers);
    svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(5000);
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(1);
    expect(workers.exportWorker.processBatch).toHaveBeenCalledTimes(0); // 10s chưa tới

    await vi.advanceTimersByTimeAsync(5000); // tổng 10s
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(2);
    expect(workers.exportWorker.processBatch).toHaveBeenCalledTimes(1);

    svc.onModuleDestroy();
  });

  it("nuốt lỗi 1 nhịp (log ERROR, KHÔNG throw) và vẫn tick tiếp; worker kia KHÔNG bị ảnh hưởng", async () => {
    const workers = makeWorkers();
    workers.outbox.processBatch
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ claimed: 0, deadLettered: 0 });
    const errSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const svc = makeService(makeConfig(), workers);
    svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(5000); // outbox nhịp 1 → reject (đã bị nuốt + log)
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000); // tổng 10s: outbox nhịp 2 (ok) + export nhịp 1 (ok)
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(2);
    expect(workers.exportWorker.processBatch).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1); // không lỗi thêm

    svc.onModuleDestroy();
  });

  it("KHÔNG đăng ký interval khi WORKERS_SCHEDULER_ENABLED=false", async () => {
    const workers = makeWorkers();
    const svc = makeService(makeConfig({ enabled: false }), workers);
    svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(workers.outbox.processBatch).not.toHaveBeenCalled();
    expect(workers.exportWorker.processBatch).not.toHaveBeenCalled();
  });

  it("KHÔNG đăng ký interval khi NODE_ENV=test (dù enabled=true)", async () => {
    const workers = makeWorkers();
    const svc = makeService(makeConfig({ enabled: true, isTestEnv: true }), workers);
    svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(workers.outbox.processBatch).not.toHaveBeenCalled();
    expect(workers.exportWorker.processBatch).not.toHaveBeenCalled();
  });

  it("dừng tick sau onModuleDestroy (KHÔNG rò timer)", async () => {
    const workers = makeWorkers();
    const svc = makeService(makeConfig(), workers);
    svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(5000);
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(1);

    svc.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(1); // không tick thêm
  });

  it("bỏ qua nhịp chồng khi nhịp trước CÙNG worker chưa xong", async () => {
    const workers = makeWorkers();
    let resolveFirst: (v: unknown) => void = () => undefined;
    workers.outbox.processBatch
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            resolveFirst = res;
          }),
      )
      .mockResolvedValue({ claimed: 0, deadLettered: 0 });
    const svc = makeService(makeConfig({ outboxPollMs: 1000 }), workers);
    svc.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(1000); // nhịp 1 → pending (chưa resolve)
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000); // nhịp 2 → bỏ qua (nhịp 1 chưa xong)
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1); // nhịp bị bỏ qua PHẢI log warn

    resolveFirst({ claimed: 0, deadLettered: 0 });
    await vi.advanceTimersByTimeAsync(1000); // nhịp 3 → chạy lại (nhịp 1 đã xong → running=false)
    expect(workers.outbox.processBatch).toHaveBeenCalledTimes(2);

    svc.onModuleDestroy();
  });
});
