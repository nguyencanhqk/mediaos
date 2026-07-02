import { z } from "zod";
import type { CreatePositionRequest, UpdatePositionRequest, PositionDto } from "@mediaos/contracts";

/**
 * Schema + mappers form Chức vụ — S2-FE-HR-5 (lane HR5-SCREENS).
 * Endpoint /org/positions (cặp read/create/update/delete:position). company_id do server resolve.
 */
const levelPattern = /^\d+$/;

export const positionFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "masterData.common.validation.nameRequired")
    .max(200, "masterData.common.validation.nameTooLong"),
  code: z.string().trim().max(50, "masterData.common.validation.codeTooLong"),
  orgUnitId: z.string(),
  level: z
    .string()
    .refine(
      (v) => v === "" || (levelPattern.test(v) && Number(v) >= 1 && Number(v) <= 99),
      "masterData.common.validation.numberInvalid",
    ),
  description: z.string(),
  status: z.enum(["active", "inactive"]),
});

export type PositionFormValues = z.infer<typeof positionFormSchema>;

export const EMPTY_POSITION_FORM: PositionFormValues = {
  name: "",
  code: "",
  orgUnitId: "",
  level: "",
  description: "",
  status: "active",
};

export function positionToForm(item: PositionDto): PositionFormValues {
  return {
    name: item.name,
    code: item.code ?? "",
    orgUnitId: item.orgUnitId ?? "",
    level: item.level != null ? String(item.level) : "",
    description: item.description ?? "",
    status: item.status,
  };
}

export function positionToCreate(values: PositionFormValues): CreatePositionRequest {
  return {
    name: values.name.trim(),
    code: values.code.trim() || undefined,
    orgUnitId: values.orgUnitId || undefined,
    level: values.level ? Number(values.level) : undefined,
    description: values.description.trim() || undefined,
  };
}

export function positionToUpdate(values: PositionFormValues): UpdatePositionRequest {
  return {
    name: values.name.trim(),
    code: values.code.trim() || null,
    orgUnitId: values.orgUnitId || null,
    level: values.level ? Number(values.level) : null,
    description: values.description.trim() || null,
    status: values.status,
  };
}
