import { createZodDto } from "nestjs-zod";
import { dashboardWidgetListQuerySchema } from "@mediaos/contracts";

/**
 * S4-DASH-BE-1 — nestjs-zod DTO cho query `limit` của dashboard resolver. `@UsePipes(ZodValidationPipe)` ở
 * controller đọc metadata createZodDto để validate (limit ≥1 ≤MAX, mặc định DEFAULT) — mirror leave.dto.ts.
 */
export class DashboardWidgetListQueryDto extends createZodDto(dashboardWidgetListQuerySchema) {}
