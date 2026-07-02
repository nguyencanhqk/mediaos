import { useTranslation } from "react-i18next";
import { type UseFormReturn } from "react-hook-form";
import { type ColumnDef } from "@tanstack/react-table";
import { FileText } from "lucide-react";
import { hrMasterDataApi, hrKeys, hrMasterDataInvalidation } from "@mediaos/web-core";
import type { ContractTypeDto } from "@mediaos/contracts";
import {
  MasterDataCrudScreen,
  MasterDataStatusBadge,
  type MasterDataScreenConfig,
} from "../departments/MasterDataCrudScreen";
import { TextField, CheckboxField, StatusField } from "../departments/master-data-fields";
import {
  contractTypeFormSchema,
  contractTypeToCreate,
  contractTypeToForm,
  contractTypeToUpdate,
  EMPTY_CONTRACT_TYPE_FORM,
  type ContractTypeFormValues,
} from "./contract-type-form";

// SPEC-03 §13.12c: TOÀN BỘ (đọc lẫn ghi) gate 1 cặp DUY NHẤT manage:master-data — KHÔNG cặp view riêng.
const MASTER_DATA_PAIR = { action: "manage", resourceType: "master-data" } as const;
const CONTRACT_TYPE_PERMISSIONS = {
  read: MASTER_DATA_PAIR,
  create: MASTER_DATA_PAIR,
  update: MASTER_DATA_PAIR,
  remove: MASTER_DATA_PAIR,
} as const;

function ContractTypeFields({ form }: { form: UseFormReturn<ContractTypeFormValues> }) {
  const { t } = useTranslation("hr");
  return (
    <>
      <TextField form={form} name="code" label={t("masterData.common.fields.code")} required />
      <TextField form={form} name="name" label={t("masterData.common.fields.name")} required />
      <CheckboxField
        form={form}
        name="requiresEndDate"
        label={t("masterData.common.fields.requiresEndDate")}
      />
      <StatusField form={form} name="status" />
    </>
  );
}

function useColumns(): ColumnDef<ContractTypeDto>[] {
  const { t } = useTranslation("hr");
  return [
    {
      accessorKey: "code",
      header: t("masterData.common.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.code ?? "—"}</span>
      ),
    },
    {
      accessorKey: "name",
      header: t("masterData.common.columns.name"),
      cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: "requiresEndDate",
      header: t("masterData.common.columns.requiresEndDate"),
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.requiresEndDate ? t("masterData.common.yes") : t("masterData.common.no")}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("masterData.common.columns.status"),
      cell: ({ row }) => <MasterDataStatusBadge status={row.original.status} />,
    },
  ];
}

export function ContractTypesPage() {
  const columns = useColumns();
  const config: MasterDataScreenConfig<ContractTypeDto, ContractTypeFormValues> = {
    tKey: "contractTypes",
    icon: FileText,
    permissions: CONTRACT_TYPE_PERMISSIONS,
    listQueryKey: hrKeys.contractTypes.list(),
    fetchList: () => hrMasterDataApi.listContractTypes(),
    invalidationKeys: hrMasterDataInvalidation.contractTypes(),
    columns,
    getId: (item) => item.id,
    getLabel: (item) => item.name,
    schema: contractTypeFormSchema,
    emptyValues: EMPTY_CONTRACT_TYPE_FORM,
    toFormValues: contractTypeToForm,
    toCreate: contractTypeToCreate,
    toUpdate: contractTypeToUpdate,
    renderFields: (form) => <ContractTypeFields form={form} />,
    create: hrMasterDataApi.createContractType as (payload: never) => Promise<ContractTypeDto>,
    update: hrMasterDataApi.updateContractType as (
      id: string,
      payload: never,
    ) => Promise<ContractTypeDto>,
    remove: hrMasterDataApi.deleteContractType,
  };
  return <MasterDataCrudScreen config={config} />;
}
