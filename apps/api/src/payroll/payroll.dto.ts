import { createZodDto } from "nestjs-zod";
import { createPayrollPeriodSchema, runPayrollRequestSchema } from "@mediaos/contracts";

export class CreatePayrollPeriodDto extends createZodDto(createPayrollPeriodSchema) {}
export class RunPayrollDto extends createZodDto(runPayrollRequestSchema) {}
