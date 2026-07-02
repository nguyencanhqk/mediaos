import { useTranslation } from "react-i18next";
import { type UseFormReturn } from "react-hook-form";
import { type ColumnDef } from "@tanstack/react-table";
import { CalendarRange } from "lucide-react";
import { leaveApi, leaveKeys, leaveInvalidation } from "@mediaos/web-core";
import type { LeaveTypeAdminView } from "@mediaos/contracts";
import {
  MasterDataCrudScreen,
  MasterDataStatusBadge,
  type MasterDataScreenConfig,
} from "../hr/departments/MasterDataCrudScreen";
import {
  TextField,
  StatusField,
  SelectField,
  CheckboxField,
} from "../hr/departments/master-data-fields";
import { LEAVE_ENGINE_PAIRS } from "./constants";
import {
  leaveTypeFormSchema,
  leaveTypeToCreate,
  leaveTypeToForm,
  leaveTypeToUpdate,
  EMPTY_LEAVE_TYPE_FORM,
  type LeaveTypeFormValues,
} from "./leave-type-form";
import "./leave-master-data-i18n";

/**
 * LEAVE-SCREEN-010 — Quản lý loại nghỉ phép (HR/Admin).
 *
 * Cổng: view:leave-type (đọc, KHÔNG sensitive) · create/update/delete:leave-type (SENSITIVE, Company-scope
 * hr/company-admin — mig 0455). Tái dùng `MasterDataCrudScreen` (packages/ui + web-core DRY, cùng pattern
 * đã dùng cho HR departments/positions/job-levels/contract-types) — permission gate qua PermissionGate/
 * useCan bên trong component dùng chung; cổng THẬT vẫn ở server.
 *
 * BE gap đã biết: GET /leave/types (nguồn list DUY NHẤT hiện có, xem leaveApi.listTypesAdmin) chỉ trả loại
 * ĐANG active — loại đã vô hiệu hoá sẽ không hiện lại trong danh sách này cho tới khi BE bổ sung endpoint
 * list-admin riêng.
 */
const LEAVE_TYPE_PERMISSIONS = {
  read: LEAVE_ENGINE_PAIRS.VIEW_LEAVE_TYPE,
  create: LEAVE_ENGINE_PAIRS.CREATE_LEAVE_TYPE,
  update: LEAVE_ENGINE_PAIRS.UPDATE_LEAVE_TYPE,
  remove: LEAVE_ENGINE_PAIRS.DELETE_LEAVE_TYPE,
} as const;

function LeaveTypeFields({ form }: { form: UseFormReturn<LeaveTypeFormValues> }) {
  const { t } = useTranslation("hr");
  // code là immutable sau khi tạo (BE strip PATCH) — disable field khi form được mở với code có sẵn
  // (chế độ sửa). defaultValues cố định lúc mount (xem MasterDataFormDialog) nên đủ để phân biệt.
  const isEdit = Boolean(form.formState.defaultValues?.code);
  return (
    <>
      <TextField
        form={form}
        name="code"
        label={t("masterData.leaveTypes.fields.code")}
        required
        disabled={isEdit}
      />
      <TextField form={form} name="name" label={t("masterData.leaveTypes.fields.name")} required />
      <TextField
        form={form}
        name="description"
        label={t("masterData.leaveTypes.fields.description")}
      />
      <SelectField
        form={form}
        name="balanceUnit"
        label={t("masterData.leaveTypes.fields.balanceUnit")}
        includeNone={false}
        options={[
          { value: "Day", label: t("masterData.leaveTypes.balanceUnitOptions.Day") },
          { value: "Hour", label: t("masterData.leaveTypes.balanceUnitOptions.Hour") },
        ]}
      />
      <TextField
        form={form}
        name="minNoticeDays"
        label={t("masterData.leaveTypes.fields.minNoticeDays")}
        type="number"
      />
      <TextField
        form={form}
        name="maxDaysPerRequest"
        label={t("masterData.leaveTypes.fields.maxDaysPerRequest")}
        type="number"
      />
      <TextField
        form={form}
        name="maxHoursPerRequest"
        label={t("masterData.leaveTypes.fields.maxHoursPerRequest")}
        type="number"
      />
      <TextField
        form={form}
        name="sortOrder"
        label={t("masterData.leaveTypes.fields.sortOrder")}
        type="number"
      />
      <div className="grid grid-cols-2 gap-2">
        <CheckboxField form={form} name="paid" label={t("masterData.leaveTypes.fields.paid")} />
        <CheckboxField
          form={form}
          name="deductBalance"
          label={t("masterData.leaveTypes.fields.deductBalance")}
        />
        <CheckboxField
          form={form}
          name="allowFullDay"
          label={t("masterData.leaveTypes.fields.allowFullDay")}
        />
        <CheckboxField
          form={form}
          name="allowHalfDay"
          label={t("masterData.leaveTypes.fields.allowHalfDay")}
        />
        <CheckboxField
          form={form}
          name="allowHourly"
          label={t("masterData.leaveTypes.fields.allowHourly")}
        />
        <CheckboxField
          form={form}
          name="allowMultipleDays"
          label={t("masterData.leaveTypes.fields.allowMultipleDays")}
        />
        <CheckboxField
          form={form}
          name="requireReason"
          label={t("masterData.leaveTypes.fields.requireReason")}
        />
        <CheckboxField
          form={form}
          name="requireAttachment"
          label={t("masterData.leaveTypes.fields.requireAttachment")}
        />
        <CheckboxField
          form={form}
          name="allowNegativeBalance"
          label={t("masterData.leaveTypes.fields.allowNegativeBalance")}
        />
      </div>
      <StatusField form={form} name="status" />
    </>
  );
}

function useColumns(): ColumnDef<LeaveTypeAdminView>[] {
  const { t } = useTranslation("hr");
  return [
    {
      accessorKey: "code",
      header: t("masterData.common.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: t("masterData.common.columns.name"),
      cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: "paid",
      header: t("masterData.leaveTypes.fields.paid"),
      cell: ({ row }) => (
        <span className="text-sm">
          {row.original.paid ? t("masterData.common.yes") : t("masterData.common.no")}
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

export function LeaveTypesPage() {
  const columns = useColumns();
  const config: MasterDataScreenConfig<LeaveTypeAdminView, LeaveTypeFormValues> = {
    tKey: "leaveTypes",
    icon: CalendarRange,
    permissions: LEAVE_TYPE_PERMISSIONS,
    listQueryKey: leaveKeys.types.adminList(),
    fetchList: () => leaveApi.listTypesAdmin(),
    invalidationKeys: leaveInvalidation.types(),
    columns,
    getId: (item) => item.id,
    getLabel: (item) => item.name,
    schema: leaveTypeFormSchema,
    emptyValues: EMPTY_LEAVE_TYPE_FORM,
    toFormValues: leaveTypeToForm,
    toCreate: leaveTypeToCreate,
    toUpdate: leaveTypeToUpdate,
    renderFields: (form) => <LeaveTypeFields form={form} />,
    conflictField: "code",
    create: leaveApi.createTypeAdmin as (payload: never) => Promise<LeaveTypeAdminView>,
    update: leaveApi.updateTypeAdmin as (id: string, payload: never) => Promise<LeaveTypeAdminView>,
    remove: leaveApi.deleteTypeAdmin,
  };
  return <MasterDataCrudScreen config={config} />;
}
