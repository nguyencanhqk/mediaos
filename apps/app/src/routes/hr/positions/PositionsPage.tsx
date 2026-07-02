import { useTranslation } from "react-i18next";
import { type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Briefcase } from "lucide-react";
import { hrMasterDataApi, hrKeys, hrMasterDataInvalidation } from "@mediaos/web-core";
import type { PositionDto } from "@mediaos/contracts";
import {
  MasterDataCrudScreen,
  MasterDataStatusBadge,
  type MasterDataScreenConfig,
} from "../departments/MasterDataCrudScreen";
import { TextField, SelectField, StatusField } from "../departments/master-data-fields";
import {
  positionFormSchema,
  positionToCreate,
  positionToForm,
  positionToUpdate,
  EMPTY_POSITION_FORM,
  type PositionFormValues,
} from "./position-form";

// Cặp engine SEED THẬT (positions.controller): read/create/update/delete:position.
const POSITION_PERMISSIONS = {
  read: { action: "read", resourceType: "position" },
  create: { action: "create", resourceType: "position" },
  update: { action: "update", resourceType: "position" },
  remove: { action: "delete", resourceType: "position" },
} as const;

function PositionFields({ form }: { form: UseFormReturn<PositionFormValues> }) {
  const { t } = useTranslation("hr");
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrMasterDataApi.listDepartments(),
    staleTime: 30_000,
  });
  const deptOptions = (departments ?? []).map((d) => ({ value: d.id, label: d.name }));

  return (
    <>
      <TextField form={form} name="name" label={t("masterData.common.fields.name")} required />
      <TextField form={form} name="code" label={t("masterData.common.fields.code")} />
      <SelectField
        form={form}
        name="orgUnitId"
        label={t("masterData.common.fields.department")}
        options={deptOptions}
      />
      <TextField
        form={form}
        name="level"
        label={t("masterData.common.fields.level")}
        type="number"
      />
      <TextField form={form} name="description" label={t("masterData.common.fields.description")} />
      <StatusField form={form} name="status" />
    </>
  );
}

function useColumns(): ColumnDef<PositionDto>[] {
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
      accessorKey: "level",
      header: t("masterData.common.columns.level"),
      cell: ({ row }) => <span className="text-sm">{row.original.level ?? "—"}</span>,
    },
    {
      accessorKey: "status",
      header: t("masterData.common.columns.status"),
      cell: ({ row }) => <MasterDataStatusBadge status={row.original.status} />,
    },
  ];
}

export function PositionsPage() {
  const columns = useColumns();
  const config: MasterDataScreenConfig<PositionDto, PositionFormValues> = {
    tKey: "positions",
    icon: Briefcase,
    permissions: POSITION_PERMISSIONS,
    listQueryKey: hrKeys.positions.list(),
    fetchList: () => hrMasterDataApi.listPositions(),
    invalidationKeys: hrMasterDataInvalidation.positions(),
    columns,
    getId: (item) => item.id,
    getLabel: (item) => item.name,
    schema: positionFormSchema,
    emptyValues: EMPTY_POSITION_FORM,
    toFormValues: positionToForm,
    toCreate: positionToCreate,
    toUpdate: positionToUpdate,
    renderFields: (form) => <PositionFields form={form} />,
    create: hrMasterDataApi.createPosition as (payload: never) => Promise<PositionDto>,
    update: hrMasterDataApi.updatePosition as (id: string, payload: never) => Promise<PositionDto>,
    remove: hrMasterDataApi.deletePosition,
  };
  return <MasterDataCrudScreen config={config} />;
}
