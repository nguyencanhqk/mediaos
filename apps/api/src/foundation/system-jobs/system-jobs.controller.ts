import { Controller, Get, Param, Query, Req, UseGuards, UsePipes } from "@nestjs/common";
import type { Request } from "express";
import { ZodValidationPipe } from "nestjs-zod";
import { PermissionGuard } from "../../permission/guards/permission.guard";
import { RequirePermission } from "../../permission/require-permission.decorator";
import { paginated, toPagination } from "../../common/pagination";
import { SystemJobRunsQueryDto } from "./system-jobs.dto";
import { SystemJobsService } from "./system-jobs.service";

interface AuthenticatedRequest extends Request {
  user: { id: string; companyId: string };
}

/**
 * S5-FND-JOBS-OBS-1 — System Jobs observability HTTP surface (READ-ONLY), nối hạ tầng JobRunner/
 * WorkerScheduler đã ship ở S2-FND-JOBS-1. Global JwtAuthGuard + CompanyGuard (app.module) đã set
 * req.user; class-level PermissionGuard opt-in (fail-closed — mọi route @RequirePermission). Resource =
 * 'foundation-job' (seed mig 0435:365-366).
 *
 *  GET /foundation/system-jobs               (view) — 1 hàng/jobCode = lần chạy MỚI NHẤT.
 *  GET /foundation/system-jobs/:jobName/runs  (view) — lịch sử chạy của 1 job (phân trang page-based).
 *
 * CỐ Ý KHÔNG có route trigger/run (`run:foundation-job`, is_sensitive=true, đã seed mig 0435 nhưng CHƯA
 * có consumer — out-of-scope WO này, để lane sau nếu cần chạy job thủ công qua HTTP).
 *
 * Đọc ĐÚNG phạm vi (BẤT BIẾN #1): `system_job_runs.company_id` NULLABLE (NULL=global, NOT NULL=tenant) —
 * `withTenant` (service) + RLS (mig 0475: `company_id = GUC OR company_id IS NULL`) ⇒ tenant CHỈ thấy job
 * của MÌNH + job cấp system/global, KHÔNG rò lịch sử job công ty khác. Envelope + pagination do
 * ResponseEnvelopeInterceptor TOÀN CỤC dựng — controller trả DATA THÔ / `paginated(...)` (KHÔNG tự bọc).
 */
@Controller("foundation/system-jobs")
@UseGuards(PermissionGuard)
@UsePipes(ZodValidationPipe)
export class SystemJobsController {
  constructor(private readonly jobs: SystemJobsService) {}

  /** GET /foundation/system-jobs — tổng quan mọi job (mới nhất/job). KHÔNG phân trang (tập nhỏ, bounded). */
  @Get()
  @RequirePermission("view", "foundation-job")
  async listSummary(@Req() req: AuthenticatedRequest) {
    return this.jobs.listSummary(req.user.companyId);
  }

  /** GET /foundation/system-jobs/:jobName/runs — lịch sử 1 job. jobName lạ → mảng rỗng (KHÔNG 404). */
  @Get(":jobName/runs")
  @RequirePermission("view", "foundation-job")
  async listRuns(
    @Req() req: AuthenticatedRequest,
    @Param("jobName") jobName: string,
    @Query() query: SystemJobRunsQueryDto,
  ) {
    const { data, meta } = await this.jobs.listRuns(req.user.companyId, jobName, query);
    return paginated(data, toPagination(meta.total, meta.page, meta.limit));
  }
}
