import { createZodDto } from "nestjs-zod";
import {
  createBonusPenaltySchema,
  createPayrollPeriodSchema,
  decideBonusPenaltySchema,
  runPayrollRequestSchema,
} from "@mediaos/contracts";

export class CreatePayrollPeriodDto extends createZodDto(createPayrollPeriodSchema) {}
export class RunPayrollDto extends createZodDto(runPayrollRequestSchema) {}
export class CreateBonusPenaltyDto extends createZodDto(createBonusPenaltySchema) {}
export class DecideBonusPenaltyDto extends createZodDto(decideBonusPenaltySchema) {}
