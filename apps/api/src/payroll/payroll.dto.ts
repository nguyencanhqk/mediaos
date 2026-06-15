import { createZodDto } from "nestjs-zod";
import {
  acknowledgePayslipSchema,
  createBonusPenaltySchema,
  createPayrollPeriodSchema,
  decideBonusPenaltySchema,
  disputePayslipSchema,
  payslipReauthSchema,
  resolvePayslipDisputeSchema,
  runPayrollRequestSchema,
} from "@mediaos/contracts";

export class CreatePayrollPeriodDto extends createZodDto(createPayrollPeriodSchema) {}
export class RunPayrollDto extends createZodDto(runPayrollRequestSchema) {}
export class CreateBonusPenaltyDto extends createZodDto(createBonusPenaltySchema) {}
export class DecideBonusPenaltyDto extends createZodDto(decideBonusPenaltySchema) {}

// G12-4 — duyệt bảng lương + xác nhận/khiếu nại + re-auth payslip.
export class AcknowledgePayslipDto extends createZodDto(acknowledgePayslipSchema) {}
export class DisputePayslipDto extends createZodDto(disputePayslipSchema) {}
export class ResolvePayslipDisputeDto extends createZodDto(resolvePayslipDisputeSchema) {}
export class PayslipReauthDto extends createZodDto(payslipReauthSchema) {}
