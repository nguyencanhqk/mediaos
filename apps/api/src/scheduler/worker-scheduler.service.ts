import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from "@nestjs/common";
import { DbExportWorker } from "../db-ops/db-export.worker";
import { OutboxWorker } from "../events/outbox-worker";
import { WORKER_SCHEDULER_CONFIG, type WorkerSchedulerConfig } from "./worker-scheduler.config";

/**
 * WorkerSchedulerService (WAVE 4 OPS) — gọi `processBatch()` của 2 background worker theo chu kỳ cấu hình.
 *
 * Cả OutboxWorker (EventsModule) lẫn DbExportWorker (DbOpsModule) là **one-shot** `processBatch()`; trước đây
 * KHÔNG có gì gọi chúng định kỳ ở prod (job nằm chờ). Service này đăng ký 2 `setInterval` ĐỘC LẬP — mỗi
 * worker một nhịp riêng — lúc app khởi động.
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

  constructor(
    private readonly outbox: OutboxWorker,
    private readonly exportWorker: DbExportWorker,
    @Inject(WORKER_SCHEDULER_CONFIG) private readonly config: WorkerSchedulerConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.isTestEnv) {
      this.logger.debug(
        "NODE_ENV=test — KHÔNG đăng ký worker scheduler (spec gọi processBatch trực tiếp).",
      );
      return;
    }
    if (!this.config.enabled) {
      this.logger.log(
        "WORKERS_SCHEDULER_ENABLED=false — worker scheduler TẮT (job chỉ chạy khi gọi processBatch tay).",
      );
      return;
    }

    this.register("outbox", this.config.outboxPollMs, () => this.outbox.processBatch());
    this.register("db-export", this.config.exportPollMs, () => this.exportWorker.processBatch());
    this.logger.log(
      `Worker scheduler BẬT — outbox mỗi ${this.config.outboxPollMs}ms, db-export mỗi ${this.config.exportPollMs}ms.`,
    );
  }

  onModuleDestroy(): void {
    // Dọn mọi interval để KHÔNG rò timer (graceful shutdown / test / HMR). clearInterval idempotent.
    for (const timer of this.timers) clearInterval(timer);
    this.timers.length = 0;
    this.running.clear();
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
