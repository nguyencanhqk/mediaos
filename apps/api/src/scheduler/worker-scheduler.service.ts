import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { OutboxWorker } from "../events/outbox-worker";
import { SYSTEM_JOB_HANDLER, type JobHandler } from "./job-handler";
import { JobRunner } from "./job-runner";
import {
  DEFAULT_SYSTEM_JOBS_POLL_MS,
  WORKER_SCHEDULER_CONFIG,
  type WorkerSchedulerConfig,
} from "./worker-scheduler.config";

/**
 * WorkerSchedulerService (WAVE 4 OPS) — gọi `processBatch()` của background worker theo chu kỳ cấu hình.
 *
 * OutboxWorker (EventsModule) là **one-shot** `processBatch()`; trước đây KHÔNG có gì gọi định kỳ ở prod
 * (job nằm chờ). Service này đăng ký 1 `setInterval` lúc app khởi động.
 * (de-media-fy: DbExportWorker/DbOpsModule = out-of-scope đã gỡ — chỉ còn nhịp outbox, audit/outbox bất biến.)
 *
 * Vì sao `setInterval` (KHÔNG `@nestjs/schedule`): tránh thêm dependency + thay đổi lockfile (CI dùng
 * `--frozen-lockfile`); mirror đúng pattern OnApplicationBootstrap sẵn có (operator-bootstrap.service.ts);
 * vòng đời timer tự quản qua OnModuleDestroy. Vẫn testable đầy đủ (tick gọi trực tiếp + fake timers).
 *
 * An toàn:
 *   - Mỗi nhịp BỌC try/catch toàn phần: lỗi 1 nhịp log ERROR (kèm stack) rồi NUỐT — KHÔNG để promise reject
 *     văng ra timer (unhandled rejection có thể giết process). Worker này lỗi KHÔNG chặn worker kia (2 nhịp tách).
 *   - Cờ chống-chồng-nhịp: nếu nhịp trước CÙNG worker chưa xong (processBatch lâu hơn chu kỳ) → bỏ qua nhịp
 *     mới (tránh chất đống processBatch song song trên cùng instance).
 *   - Đa-instance: nếu chạy >1 API instance, mọi instance đều tick — nhưng cả 2 worker claim job bằng
 *     `FOR UPDATE SKIP LOCKED` ⇒ KHÔNG double-process. KHÔNG cần leader-election.
 *   - Tắt được: WORKERS_SCHEDULER_ENABLED='false' HOẶC NODE_ENV='test' → KHÔNG đăng ký interval nào.
 *   - KHÔNG đổi logic worker (chỉ wire). assertWorkerRoleSafe của OutboxWorker giữ nguyên.
 */
@Injectable()
export class WorkerSchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WorkerSchedulerService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  /** Cờ "nhịp đang chạy" theo nhãn worker — chống chồng nhịp khi processBatch lâu hơn chu kỳ. */
  private readonly running = new Map<string, boolean>();

  /**
   * `discovery` + `jobRunner` OPTIONAL để KHÔNG phá call-site cũ dựng `new WorkerSchedulerService(outbox,
   * config)` (spec 2-tham-số). DI prod luôn cấp cả hai (SchedulerModule import DiscoveryModule + JobRunner).
   * Vắng → tick 'system-jobs' KHÔNG đăng ký (chỉ còn nhịp outbox).
   */
  constructor(
    private readonly outbox: OutboxWorker,
    @Inject(WORKER_SCHEDULER_CONFIG) private readonly config: WorkerSchedulerConfig,
    @Optional() private readonly discovery?: DiscoveryService,
    @Optional() private readonly jobRunner?: JobRunner,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.isTestEnv) {
      this.logger.debug(
        "NODE_ENV=test — KHÔNG đăng ký worker scheduler (spec gọi processBatch/JobRunner trực tiếp).",
      );
      return;
    }
    if (!this.config.enabled) {
      this.logger.log(
        "WORKERS_SCHEDULER_ENABLED=false — worker scheduler TẮT (job chỉ chạy khi gọi tay).",
      );
      return;
    }

    this.register("outbox", this.config.outboxPollMs, () => this.outbox.processBatch());
    this.logger.log(`Worker scheduler BẬT — outbox mỗi ${this.config.outboxPollMs}ms.`);

    // Tick 'system-jobs': gom mọi @SystemJobHandler qua DiscoveryService → JobRunner chạy TUẦN TỰ từng handler.
    const handlers = this.discoverJobHandlers();
    if (this.jobRunner && handlers.length > 0) {
      const interval = this.config.systemJobsPollMs ?? DEFAULT_SYSTEM_JOBS_POLL_MS;
      const runner = this.jobRunner;
      this.register("system-jobs", interval, () => this.runSystemJobs(runner, handlers));
      this.logger.log(
        `Worker scheduler — system-jobs mỗi ${interval}ms (${handlers.length} handler: ${handlers.map((h) => h.jobCode).join(", ")}).`,
      );
    }
  }

  onModuleDestroy(): void {
    // Dọn mọi interval để KHÔNG rò timer (graceful shutdown / test / HMR). clearInterval idempotent.
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    this.running.clear();
  }

  /**
   * Gom mọi provider mang metadata `SYSTEM_JOB_HANDLER` (đánh dấu bởi `@SystemJobHandler()`) thành mảng
   * JobHandler. DiscoveryService quét container app (Retention/FilesModule đã init trước — SchedulerModule
   * import chúng MỘT HƯỚNG). Chỉ instance đã dựng + có metadata. Dedup theo jobCode phòng đăng ký trùng.
   */
  private discoverJobHandlers(): JobHandler[] {
    if (!this.discovery) return [];
    const seen = new Set<string>();
    const handlers: JobHandler[] = [];
    for (const wrapper of this.discovery.getProviders()) {
      const { metatype, instance } = wrapper;
      if (!metatype || instance == null) continue;
      if (Reflect.getMetadata(SYSTEM_JOB_HANDLER, metatype) !== true) continue;
      const handler = instance as JobHandler;
      if (typeof handler.jobCode !== "string" || typeof handler.run !== "function") continue;
      if (seen.has(handler.jobCode)) continue;
      seen.add(handler.jobCode);
      handlers.push(handler);
    }
    return handlers;
  }

  /**
   * 1 nhịp system-jobs: chạy TUẦN TỰ từng handler qua JobRunner. Lỗi 1 handler (vd lock/db) KHÔNG chặn
   * handler kế — bọc try/catch per-handler (JobRunner đã tự cô lập lỗi per-tenant). Trả về khi mọi handler xong.
   */
  private async runSystemJobs(runner: JobRunner, handlers: readonly JobHandler[]): Promise<void> {
    for (const handler of handlers) {
      try {
        await runner.runJob(handler.jobCode, handler);
      } catch (err) {
        this.logger.error(
          `system-job '${handler.jobCode}' THẤT BẠI (nhịp): ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      }
    }
  }

  /** Đăng ký 1 interval gọi `task` mỗi `intervalMs`. Nhịp đầu sau `intervalMs` (KHÔNG chạy ngay lúc boot). */
  private register(label: string, intervalMs: number, task: () => Promise<unknown>): void {
    this.running.set(label, false);
    this.timers.push(setInterval(() => this.tick(label, task), intervalMs));
  }

  /**
   * Một nhịp: chạy `task` (processBatch). KHÔNG `await` trong callback timer — đính `.catch`/`.finally` để
   * lỗi LUÔN bị bắt (log ERROR + stack) và NUỐT, không có promise reject nào thoát ra timer.
   *
   * `Promise.resolve().then(() => task())` bọc cả throw ĐỒNG BỘ (phòng khi task không phải async) thành
   * rejection ⇒ `.catch` luôn bắt được và `.finally` LUÔN chạy ⇒ cờ `running` KHÔNG bao giờ kẹt `true`
   * (nếu task() ném thẳng thì `.finally` sẽ không gắn được → worker chết câm). Stack LUÔN là chuỗi non-empty
   * kể cả rejection không phải Error (giữ đủ ngữ cảnh chẩn đoán — đúng mục tiêu lane này).
   */
  private tick(label: string, task: () => Promise<unknown>): void {
    if (this.running.get(label) === true) {
      this.logger.warn(
        `Nhịp '${label}' trước CHƯA xong — bỏ qua nhịp này (tránh chồng processBatch trên cùng instance).`,
      );
      return;
    }
    this.running.set(label, true);
    void Promise.resolve()
      .then(() => task())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : `(rejection không phải Error) ${message}`;
        this.logger.error(`Nhịp worker '${label}' THẤT BẠI: ${message}`, stack);
      })
      .finally(() => {
        this.running.set(label, false);
      });
  }
}
