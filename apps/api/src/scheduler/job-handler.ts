import { SetMetadata } from "@nestjs/common";

/**
 * job-handler.ts (S2-FND-JOBS-1) — hợp đồng system-job DÙNG CHUNG, file STANDALONE (KHÔNG import bất kỳ
 * thứ gì trong `scheduler/` ngoài `@nestjs/common`). Feature module (RetentionModule/FilesModule) import
 * ĐÚNG file này để đánh dấu handler của mình; SchedulerModule dùng DiscoveryService gom mọi provider mang
 * metadata `SYSTEM_JOB_HANDLER` thành `SYSTEM_JOB_HANDLER[]`. Chiều phụ thuộc MỘT HƯỚNG: Scheduler→feature
 * (feature KHÔNG import SchedulerModule) ⇒ KHÔNG import cycle.
 */

/**
 * Token metadata/DI cho system job handler (multi-provider). Dùng làm KEY của `SetMetadata` (đánh dấu class
 * handler) — DiscoveryService lọc theo key này. Là string const (KHÔNG Symbol) để `Reflect.getMetadata`
 * đọc ổn định qua ranh giới module.
 */
export const SYSTEM_JOB_HANDLER = "SYSTEM_JOB_HANDLER";

/**
 * Ngữ cảnh trao cho handler khi chạy cho MỘT tenant. KHÔNG có tham số `tx` (chốt round4): handler TỰ mở
 * `withTenant(companyId, …)` (BẤT BIẾN #1) bên trong `run()`. JobRunner enumerate tenant qua
 * withPlatformContext RỒI đóng tx TRƯỚC khi gọi `run()` ⇒ handler KHÔNG chạy trong nested-context.
 */
export interface JobRunContext {
  companyId: string;
  /**
   * S13-LEAVE-JOBDATE-1 — ngày nghiệp vụ (`YYYY-MM-DD`) mà handler phải coi là "hôm nay". TUỲ CHỌN và
   * CHỈ để test ghim được mốc thời gian: JobRunner PROD (job-runner.ts:117) gọi `run({ companyId })` —
   * KHÔNG set field này ⇒ handler rơi về ngày THẬT của đồng hồ máy, hành vi chạy thật KHÔNG đổi.
   * Handler nào không quan tâm ngày thì bỏ qua; hợp đồng của các handler khác KHÔNG đổi (field optional).
   */
  today?: string;
}

/**
 * Kết quả 1 lần chạy handler cho 1 tenant. `metadata` (jsonb) đi qua `AuditMaskerService.mask` TRƯỚC khi
 * ghi `system_job_runs.metadata` (BẤT BIẾN #3 — che field nhạy cảm theo tên khoá).
 */
export interface JobRunResult {
  total: number;
  success: number;
  failed: number;
  metadata?: Record<string, unknown>;
}

/**
 * JobHandler — hợp đồng cho mọi system job nền. `jobCode` DUY NHẤT toàn hệ (khoá `system_job_locks` +
 * `system_job_runs.job_code`). `run()` nhận CHỈ `companyId`, trả `{total,success,failed,metadata?}`.
 * Handler PHẢI tự-cô-lập tenant (withTenant) + idempotent (có thể chạy lại mỗi nhịp scheduler).
 */
export interface JobHandler {
  readonly jobCode: string;
  run(ctx: JobRunContext): Promise<JobRunResult>;
}

/**
 * `@SystemJobHandler()` — đánh dấu 1 provider (implements JobHandler) để SchedulerModule (DiscoveryService)
 * gom vào `SYSTEM_JOB_HANDLER[]`. Feature module chỉ cần: (1) `@SystemJobHandler()` trên class,
 * (2) khai báo class trong `providers` của module mình. KHÔNG cần biết SchedulerModule.
 */
export const SystemJobHandler = (): ClassDecorator => SetMetadata(SYSTEM_JOB_HANDLER, true);
