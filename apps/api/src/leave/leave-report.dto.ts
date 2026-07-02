import { createZodDto } from "nestjs-zod";
import { leaveReportQuerySchema } from "@mediaos/contracts";

/** S3-LEAVE-BE-6 — GET /leave/reports query (fromDate/toDate inclusive, page-based). */
export class LeaveReportQueryDto extends createZodDto(leaveReportQuerySchema) {}
