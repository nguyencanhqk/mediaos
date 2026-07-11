import { createZodDto } from "nestjs-zod";
import { widgetDataQuerySchema } from "@mediaos/contracts";

/**
 * S4-DASH-BE-2 — nestjs-zod DTO cho query GET /dashboard/widgets · /widgets/:slug (refresh idempotent,
 * dashboard_type?, include_data?, project_id? uuid). project_id BẮT BUỘC cho slug=project-progress kiểm Ở
 * HANDLER (400 DASH-ERR-VALIDATION) — KHÔNG ở schema dùng-chung. Mirror DashboardWidgetListQueryDto (BE-1).
 */
export class WidgetDataQueryDto extends createZodDto(widgetDataQuerySchema) {}
