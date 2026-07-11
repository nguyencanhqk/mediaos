import { createZodDto } from "nestjs-zod";
import { dashboardConfigListQuerySchema, dashboardConfigPatchSchema } from "@mediaos/contracts";

/**
 * S4-DASH-BE-3 — nestjs-zod DTO cho DashboardConfigController. `@UsePipes(ZodValidationPipe)` ở controller
 * đọc metadata createZodDto để validate ở RANH GIỚI (BẤT BIẾN: không trust input) — mirror
 * dashboard-resolver.dto.ts / attendance-shift.dto.ts.
 *
 *  - Query GET /dashboard/configs: dashboard_type/config_scope (idempotent enum param), role_id/user_id.
 *  - Body PATCH /dashboard/configs/:id: partial update, .refine chặn body rỗng → 400 (DASH-API-203).
 * Schema = nguồn sự thật ở packages/contracts (dual-build ESM/CJS).
 */
export class DashboardConfigListQueryDto extends createZodDto(dashboardConfigListQuerySchema) {}
export class DashboardConfigPatchDto extends createZodDto(dashboardConfigPatchSchema) {}
