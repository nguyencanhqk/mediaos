import { Injectable, Logger } from "@nestjs/common";
import {
  SystemJobHandler,
  type JobHandler,
  type JobRunContext,
  type JobRunResult,
} from "../scheduler/job-handler";
import { DashboardRefreshService } from "./dashboard-refresh.service";

/** jobCode DUY NHẤT toàn hệ — khoá `system_job_locks` + `system_job_runs.job_code`. */
export const DASHBOARD_MV_REFRESH_JOB_CODE = "DASHBOARD_MV_REFRESH";

/**
 * Chu kỳ TỐI THIỂU (ms) giữa 2 lần refresh THẬT. REFRESH MATERIALIZED VIEW quét lại toàn bảng nguồn
 * (tasks) — không cần chạy dày hơn nhịp system-jobs mặc định (60s, `DEFAULT_SYSTEM_JOBS_POLL_MS`).
 * Mặc định 5 phút. Override qua env `DASHBOARD_MV_REFRESH_INTERVAL_MS`.
 */
export const DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS = 5 * 60_000;
const MIN_DASHBOARD_MV_REFRESH_INTERVAL_MS = 30_000;
const MAX_DASHBOARD_MV_REFRESH_INTERVAL_MS = 3_600_000;

/**
 * Parse-an-toàn + clamp biên [30s, 1h] — mirror `resolveSystemJobsPollMs` (`worker-scheduler.config.ts`).
 * Biến `DASHBOARD_MV_REFRESH_INTERVAL_MS` NGOÀI `env.schema.ts` (paths lane này chỉ `apps/api/src/dashboard/**`
 * — thêm vào env.schema là việc của lane khác); rác/NaN/ngoài biên → mặc định, KHÔNG ném.
 */
export function resolveDashboardMvRefreshIntervalMs(
  raw: string | undefined = process.env.DASHBOARD_MV_REFRESH_INTERVAL_MS,
): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS;
  }
  if (
    parsed < MIN_DASHBOARD_MV_REFRESH_INTERVAL_MS ||
    parsed > MAX_DASHBOARD_MV_REFRESH_INTERVAL_MS
  ) {
    return DEFAULT_DASHBOARD_MV_REFRESH_INTERVAL_MS;
  }
  return parsed;
}

/**
 * DashboardMvRefreshJobHandler (S10-DASH-MVREFRESH-1) — đóng nửa "lịch chạy" của KI-017. Nửa "must be
 * owner" (privilege) đã đóng ở mig 0534 (`S6-SEC-MV-1`): `refresh_dashboard_mvs()` SECURITY DEFINER,
 * worker chỉ cần EXECUTE. Trước WO này KHÔNG có gì gọi `DashboardRefreshService.refresh()` định kỳ —
 * đường DUY NHẤT là người bấm tay `POST /dashboard/refresh` (`dashboard.controller.ts`, giữ nguyên,
 * KHÔNG thay thế — job này chỉ THÊM lịch chạy tự động).
 *
 * `refresh_dashboard_mvs()` làm mới CẢ HAI matview cho MỌI tenant TRONG MỘT LẦN GỌI (không nhận tham số
 * company_id — khác các job khác trong hệ vốn xử lý dữ liệu CỦA RIÊNG company_id truyền vào). JobRunner
 * vẫn enumerate + gọi `run({companyId})` cho TỪNG tenant (khuôn chung, KHÔNG đổi JobRunner/scheduler —
 * ngoài paths lane này) ⇒ handler tự throttle (in-memory, field cấp instance) để chỉ refresh THẬT tối
 * đa 1 lần mỗi `DASHBOARD_MV_REFRESH_INTERVAL_MS`: tenant thứ 2..N trong CÙNG một tick thấy "vừa refresh
 * xong" và SKIP (không gọi lại REFRESH cho cùng dữ liệu N lần). Ở N=1 tenant hiện tại (CLAUDE.md §1)
 * throttle không tạo khác biệt quan sát được (mỗi tick chỉ 1 tenant); đúng khi mở rộng đa-tenant.
 *
 * In-memory (KHÔNG bền qua restart) — CHẤP NHẬN ĐƯỢC: tick đầu sau boot luôn refresh (an toàn hơn bỏ
 * sót), throttle chỉ giảm tải khi process sống lâu.
 *
 * KHÔNG catch lỗi refresh (mirror `DashboardRefreshService.refresh()` — docblock KI-034): lỗi propagate
 * để `JobRunner` finalize run-row 'Failed' + log ERROR. Nuốt lỗi ở đây là đúng cái bẫy đã giữ KI-017
 * "ngủ" suốt từ G14 (không ai biết đường refresh chết) — im lặng thêm lần nữa là lặp lại lỗi cũ.
 *
 * Đăng ký: `@SystemJobHandler()` + khai trong `providers` của `DashboardModule`; `SchedulerModule`
 * (DiscoveryService) tự gom qua metadata `SYSTEM_JOB_HANDLER` — `DashboardModule` KHÔNG import
 * `SchedulerModule` (phụ thuộc MỘT HƯỚNG, mirror `GoalReconciliationJobHandler`).
 */
@Injectable()
@SystemJobHandler()
export class DashboardMvRefreshJobHandler implements JobHandler {
  readonly jobCode = DASHBOARD_MV_REFRESH_JOB_CODE;
  private readonly logger = new Logger(DashboardMvRefreshJobHandler.name);
  /** Mốc lần refresh THẬT gần nhất (in-memory) — chống refresh trùng trong CÙNG 1 tick đa-tenant. */
  private lastRefreshedAtMs: number | null = null;

  constructor(private readonly refreshService: DashboardRefreshService) {}

  async run(_ctx: JobRunContext): Promise<JobRunResult> {
    const intervalMs = resolveDashboardMvRefreshIntervalMs();
    const now = Date.now();
    if (this.lastRefreshedAtMs !== null && now - this.lastRefreshedAtMs < intervalMs) {
      return {
        total: 0,
        success: 1,
        failed: 0,
        metadata: { skipped: true, reason: "not-due", intervalMs },
      };
    }

    // KHÔNG try/catch: lỗi phải propagate cho JobRunner finalize 'Failed' (KI-034).
    const { refreshedAt } = await this.refreshService.refresh();
    this.lastRefreshedAtMs = now;
    this.logger.debug(`DASHBOARD_MV_REFRESH: refreshed at ${refreshedAt}`);
    return {
      total: 1,
      success: 1,
      failed: 0,
      metadata: { skipped: false, refreshedAt },
    };
  }
}
