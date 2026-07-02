import { z } from "zod";
import {
  SEQUENCE_RESET_POLICIES,
  SEQUENCE_STATUSES,
  type PatchSequenceDto,
  type SequenceCounterView,
} from "@mediaos/contracts";

/**
 * RHF+Zod schema cho form sửa cấu hình sequence counter — S2-FE-FND-5 (lane FE batch C).
 * Khớp .strict() của patchSequenceSchema (contracts) — CHỈ field cấu hình mutable, KHÔNG id/sequenceKey/
 * currentValue/companyId (BẤT BIẾN chống leo thang — server cũng ép .strict()).
 */
export const sequenceFormSchema = z.object({
  prefix: z.string().max(100).optional(),
  suffix: z.string().max(100).optional(),
  datePattern: z.string().max(255).optional(),
  paddingLength: z.coerce.number().int().min(0).max(50),
  incrementBy: z.coerce.number().int().min(1),
  resetPolicy: z.enum(SEQUENCE_RESET_POLICIES),
  status: z.enum(SEQUENCE_STATUSES),
});
export type SequenceFormValues = z.infer<typeof sequenceFormSchema>;

export function sequenceToFormValues(row: SequenceCounterView): SequenceFormValues {
  return {
    prefix: row.prefix ?? "",
    suffix: row.suffix ?? "",
    datePattern: row.datePattern ?? "",
    paddingLength: row.paddingLength,
    incrementBy: row.incrementBy,
    resetPolicy: row.resetPolicy,
    status: row.status,
  };
}

/** Chuỗi rỗng → null (server/contract dùng null cho "không đặt"). */
export function toPatchSequenceDto(values: SequenceFormValues): PatchSequenceDto {
  return {
    prefix: values.prefix?.trim() ? values.prefix : null,
    suffix: values.suffix?.trim() ? values.suffix : null,
    datePattern: values.datePattern?.trim() ? values.datePattern : null,
    paddingLength: values.paddingLength,
    incrementBy: values.incrementBy,
    resetPolicy: values.resetPolicy,
    status: values.status,
  };
}
