import { createZodDto } from "nestjs-zod";
import { systemJobRunsQuerySchema } from "@mediaos/contracts";

/**
 * S5-FND-JOBS-OBS-1 — DTO ranh giới HTTP cho SystemJobsController. Nguồn sự thật = packages/contracts
 * (system-jobs.ts, L2). Query GET /system-jobs/:jobName/runs — page-based, clamp ở contract (KHÔNG 400
 * khi rác — list đọc chỉ fallback default).
 */
export class SystemJobRunsQueryDto extends createZodDto(systemJobRunsQuerySchema) {}
