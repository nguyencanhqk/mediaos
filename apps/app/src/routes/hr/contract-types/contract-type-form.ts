import { z } from "zod";
import type {
  CreateContractTypeRequest,
  UpdateContractTypeRequest,
  ContractTypeDto,
} from "@mediaos/contracts";

/**
 * Schema + mappers form Loại hợp đồng — S2-FE-HR-5 (lane HR5-SCREENS).
 * Endpoint /hr/master-data/contract-types (cặp DUY NHẤT manage:master-data). company_id do server resolve.
 */
export const contractTypeFormSchema = z.object({
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
  requiresEndDate: z.boolean(),
  status: z.enum(["active", "inactive"]),
});

export type ContractTypeFormValues = z.infer<typeof contractTypeFormSchema>;

export const EMPTY_CONTRACT_TYPE_FORM: ContractTypeFormValues = {
  code: "",
  name: "",
  requiresEndDate: false,
  status: "active",
};

export function contractTypeToForm(item: ContractTypeDto): ContractTypeFormValues {
  return {
    code: item.code ?? "",
    name: item.name,
    requiresEndDate: item.requiresEndDate,
    status: item.status,
  };
}

export function contractTypeToCreate(values: ContractTypeFormValues): CreateContractTypeRequest {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    requiresEndDate: values.requiresEndDate,
  };
}

export function contractTypeToUpdate(values: ContractTypeFormValues): UpdateContractTypeRequest {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    requiresEndDate: values.requiresEndDate,
    status: values.status,
  };
}
