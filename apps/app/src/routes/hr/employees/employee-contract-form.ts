import { z } from "zod";
import type {
  CreateContractRequest,
  UpdateContractRequest,
  EmployeeContractDto,
} from "@mediaos/contracts";
import { CONTRACT_STATUSES } from "../contracts/constants";

/**
 * Schema + mappers form Hợp đồng lao động của 1 nhân viên — S2-FE-HR-7.
 * Endpoint /hr/contracts (+ employeeId từ route param) — Permission manage:contract (Company-only).
 * KHÔNG có field fileId ở đây — gắn file đi qua LinkContractFileDialog (endpoint riêng, server validate
 * tenant + scan status trước khi set contract.file_id).
 */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "contracts.validation.dateInvalid");

export const employeeContractFormSchema = z
  .object({
    contractTypeId: z.string().trim().min(1, "contracts.validation.contractTypeRequired"),
    contractCode: z.string().trim().max(100).optional().or(z.literal("")),
    title: z.string().trim().max(255).optional().or(z.literal("")),
    startDate: isoDate,
    endDate: z.union([isoDate, z.literal("")]),
    signedDate: z.union([isoDate, z.literal("")]),
    status: z.enum(CONTRACT_STATUSES),
    isPrimary: z.boolean(),
    note: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((v) => v.endDate === "" || v.endDate >= v.startDate, {
    message: "contracts.validation.endBeforeStart",
    path: ["endDate"],
  });

export type EmployeeContractFormValues = z.infer<typeof employeeContractFormSchema>;

export const EMPTY_EMPLOYEE_CONTRACT_FORM: EmployeeContractFormValues = {
  contractTypeId: "",
  contractCode: "",
  title: "",
  startDate: "",
  endDate: "",
  signedDate: "",
  status: "Draft",
  isPrimary: false,
  note: "",
};

function orNull(v: string): string | undefined {
  return v.trim() === "" ? undefined : v.trim();
}

export function employeeContractToForm(item: EmployeeContractDto): EmployeeContractFormValues {
  return {
    contractTypeId: item.contractTypeId,
    contractCode: item.contractCode ?? "",
    title: item.title ?? "",
    startDate: item.startDate,
    endDate: item.endDate ?? "",
    signedDate: item.signedDate ?? "",
    status: item.status,
    isPrimary: item.isPrimary,
    note: item.note ?? "",
  };
}

/** employeeId gắn ở caller (route param) — KHÔNG là field form. */
export function employeeContractToCreate(
  values: EmployeeContractFormValues,
  employeeId: string,
): CreateContractRequest {
  return {
    employeeId,
    contractTypeId: values.contractTypeId,
    contractCode: orNull(values.contractCode ?? ""),
    title: orNull(values.title ?? ""),
    startDate: values.startDate,
    endDate: orNull(values.endDate),
    signedDate: orNull(values.signedDate),
    status: values.status,
    isPrimary: values.isPrimary,
    note: orNull(values.note ?? ""),
  };
}

export function employeeContractToUpdate(
  values: EmployeeContractFormValues,
): UpdateContractRequest {
  return {
    contractTypeId: values.contractTypeId,
    contractCode: orNull(values.contractCode ?? "") ?? null,
    title: orNull(values.title ?? "") ?? null,
    startDate: values.startDate,
    endDate: orNull(values.endDate) ?? null,
    signedDate: orNull(values.signedDate) ?? null,
    status: values.status,
    isPrimary: values.isPrimary,
    note: orNull(values.note ?? "") ?? null,
  };
}
