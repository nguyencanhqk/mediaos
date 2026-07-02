import { createZodDto } from "nestjs-zod";
import { attendanceReportQuerySchema } from "@mediaos/contracts";

/** S3-ATT-BE-6 — GET /attendance/reports query (fromDate/toDate half-open, page-based). */
export class AttendanceReportQueryDto extends createZodDto(attendanceReportQuerySchema) {}
