import { z } from "zod";
import type { CreateJobLevelRequest, UpdateJobLevelRequest, JobLevelDto } from "@mediaos/contracts";

/**
 * Schema + mappers form Cấp bậc — S2-FE-HR-5 (lane HR5-SCREENS).
 * Endpoint /hr/master-data/job-levels (cặp DUY NHẤT manage:master-data). company_id do server resolve.
 */
const numberPattern = /^\d+$/;

export const jobLevelFormSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, "masterData.common.validation.codeRequired")
    .max(50, "masterData.common.validation.codeTooLong"),
  name: z
    .string()
    .trim()
    .min(1, "masterData.common.validation.nameRequired")
    .max(200, "masterData.common.validation.nameTooLong"),
  rankOrder: z
    .string()
    .refine((v) => v === "" || numberPattern.test(v), "masterData.common.validation.numberInvalid"),
  status: z.enum(["active", "inactive"]),
});

export type JobLevelFormValues = z.infer<typeof jobLevelFormSchema>;

export const EMPTY_JOB_LEVEL_FORM: JobLevelFormValues = {
  code: "",
  name: "",
  rankOrder: "",
  status: "active",
};

export function jobLevelToForm(item: JobLevelDto): JobLevelFormValues {
  return {
    code: item.code ?? "",
    name: item.name,
    rankOrder: item.rankOrder != null ? String(item.rankOrder) : "",
    status: item.status,
  };
}

export function jobLevelToCreate(values: JobLevelFormValues): CreateJobLevelRequest {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    rankOrder: values.rankOrder ? Number(values.rankOrder) : undefined,
  };
}

export function jobLevelToUpdate(values: JobLevelFormValues): UpdateJobLevelRequest {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    rankOrder: values.rankOrder ? Number(values.rankOrder) : null,
    status: values.status,
  };
}
