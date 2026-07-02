import { useTranslation } from "react-i18next";
import { type UseFormReturn } from "react-hook-form";
import { type ColumnDef } from "@tanstack/react-table";
import { Layers } from "lucide-react";
import { hrMasterDataApi, hrKeys, hrMasterDataInvalidation } from "@mediaos/web-core";
import type { JobLevelDto } from "@mediaos/contracts";
import {
  MasterDataCrudScreen,
  MasterDataStatusBadge,
  type MasterDataScreenConfig,
} from "../departments/MasterDataCrudScreen";
import { TextField, StatusField } from "../departments/master-data-fields";
import {
  jobLevelFormSchema,
  jobLevelToCreate,
  jobLevelToForm,
  jobLevelToUpdate,
  EMPTY_JOB_LEVEL_FORM,
  type JobLevelFormValues,
} from "./job-level-form";

// SPEC-03 §13.12b: TOÀN BỘ (đọc lẫn ghi) gate 1 cặp DUY NHẤT manage:master-data — KHÔNG cặp view riêng.
const MASTER_DATA_PAIR = { action: "manage", resourceType: "master-data" } as const;
const JOB_LEVEL_PERMISSIONS = {
  read: MASTER_DATA_PAIR,
  create: MASTER_DATA_PAIR,
  update: MASTER_DATA_PAIR,
  remove: MASTER_DATA_PAIR,
} as const;

function JobLevelFields({ form }: { form: UseFormReturn<JobLevelFormValues> }) {
  const { t } = useTranslation("hr");
  return (
    <>
      <TextField form={form} name="code" label={t("masterData.common.fields.code")} required />
      <TextField form={form} name="name" label={t("masterData.common.fields.name")} required />
      <TextField
        form={form}
        name="rankOrder"
        label={t("masterData.common.fields.rankOrder")}
        type="number"
      />
      <StatusField form={form} name="status" />
    </>
  );
}

function useColumns(): ColumnDef<JobLevelDto>[] {
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
      accessorKey: "rankOrder",
      header: t("masterData.common.columns.rankOrder"),
      cell: ({ row }) => <span className="text-sm">{row.original.rankOrder ?? "—"}</span>,
    },
    {
      accessorKey: "status",
      header: t("masterData.common.columns.status"),
      cell: ({ row }) => <MasterDataStatusBadge status={row.original.status} />,
    },
  ];
}

export function JobLevelsPage() {
  const columns = useColumns();
  const config: MasterDataScreenConfig<JobLevelDto, JobLevelFormValues> = {
    tKey: "jobLevels",
    icon: Layers,
    permissions: JOB_LEVEL_PERMISSIONS,
    listQueryKey: hrKeys.jobLevels.list(),
    fetchList: () => hrMasterDataApi.listJobLevels(),
    invalidationKeys: hrMasterDataInvalidation.jobLevels(),
    columns,
    getId: (item) => item.id,
    getLabel: (item) => item.name,
    schema: jobLevelFormSchema,
    emptyValues: EMPTY_JOB_LEVEL_FORM,
    toFormValues: jobLevelToForm,
    toCreate: jobLevelToCreate,
    toUpdate: jobLevelToUpdate,
    renderFields: (form) => <JobLevelFields form={form} />,
    create: hrMasterDataApi.createJobLevel as (payload: never) => Promise<JobLevelDto>,
    update: hrMasterDataApi.updateJobLevel as (id: string, payload: never) => Promise<JobLevelDto>,
    remove: hrMasterDataApi.deleteJobLevel,
  };
  return <MasterDataCrudScreen config={config} />;
}
