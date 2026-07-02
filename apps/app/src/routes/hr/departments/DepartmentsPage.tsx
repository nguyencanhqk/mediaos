import { useTranslation } from "react-i18next";
import { type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { Building2 } from "lucide-react";
import {
  hrMasterDataApi,
  hrKeys,
  hrMasterDataInvalidation,
  type HrDepartment,
} from "@mediaos/web-core";
import {
  MasterDataCrudScreen,
  MasterDataStatusBadge,
  type MasterDataScreenConfig,
} from "./MasterDataCrudScreen";
import { TextField, SelectField, StatusField } from "./master-data-fields";
import {
  departmentFormSchema,
  departmentToCreate,
  departmentToForm,
  departmentToUpdate,
  EMPTY_DEPARTMENT_FORM,
  type DepartmentFormValues,
} from "./department-form";

// Cặp engine SEED THẬT (hr-department.controller): read/create/update/delete:department.
const DEPARTMENT_PERMISSIONS = {
  read: { action: "read", resourceType: "department" },
  create: { action: "create", resourceType: "department" },
  update: { action: "update", resourceType: "department" },
  remove: { action: "delete", resourceType: "department" },
} as const;

function DepartmentFields({ form }: { form: UseFormReturn<DepartmentFormValues> }) {
  const { t } = useTranslation("hr");
  // Đọc từ cache list (đã fetch bởi màn) — không phát sinh request mới.
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrMasterDataApi.listDepartments(),
    staleTime: 30_000,
  });
  const parentOptions = (departments ?? []).map((d) => ({ value: d.id, label: d.name }));

  return (
    <>
      <TextField form={form} name="name" label={t("masterData.common.fields.name")} required />
      <TextField form={form} name="code" label={t("masterData.common.fields.code")} />
      <SelectField
        form={form}
        name="parentId"
        label={t("masterData.common.fields.parent")}
        options={parentOptions}
      />
      <TextField form={form} name="description" label={t("masterData.common.fields.description")} />
      <StatusField form={form} name="status" />
    </>
  );
}

function useColumns(): ColumnDef<HrDepartment>[] {
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
      accessorKey: "status",
      header: t("masterData.common.columns.status"),
      cell: ({ row }) => <MasterDataStatusBadge status={row.original.status} />,
    },
  ];
}

export function DepartmentsPage() {
  const columns = useColumns();
  const config: MasterDataScreenConfig<HrDepartment, DepartmentFormValues> = {
    tKey: "departments",
    icon: Building2,
    permissions: DEPARTMENT_PERMISSIONS,
    listQueryKey: hrKeys.departments.list(),
    fetchList: () => hrMasterDataApi.listDepartments(),
    invalidationKeys: hrMasterDataInvalidation.departments(),
    columns,
    getId: (item) => item.id,
    getLabel: (item) => item.name,
    schema: departmentFormSchema,
    emptyValues: EMPTY_DEPARTMENT_FORM,
    toFormValues: departmentToForm,
    toCreate: departmentToCreate,
    toUpdate: departmentToUpdate,
    renderFields: (form) => <DepartmentFields form={form} />,
    create: hrMasterDataApi.createDepartment as (payload: never) => Promise<HrDepartment>,
    update: hrMasterDataApi.updateDepartment as (
      id: string,
      payload: never,
    ) => Promise<HrDepartment>,
    remove: hrMasterDataApi.deleteDepartment,
  };
  return <MasterDataCrudScreen config={config} />;
}
