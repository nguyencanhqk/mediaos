import { useTranslation } from "react-i18next";
import { type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ShieldCheck } from "lucide-react";
import { leaveApi, leaveKeys, leaveInvalidation, hrApi, hrKeys } from "@mediaos/web-core";
import type { LeavePolicyView } from "@mediaos/contracts";
import {
  MasterDataCrudScreen,
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
  leavePolicyFormSchema,
  leavePolicyToCreate,
  leavePolicyToForm,
  leavePolicyToUpdate,
  EMPTY_LEAVE_POLICY_FORM,
  type LeavePolicyFormValues,
} from "./leave-policy-form";
import "./leave-master-data-i18n";

/**
 * LEAVE-SCREEN-011 — Cấu hình chính sách nghỉ phép (HR/Admin).
 *
 * Cổng: view/create/update/delete:leave-policy — CẢ 4 đều SENSITIVE (Company-scope hr/company-admin,
 * mig 0455). Tái dùng `MasterDataCrudScreen` (DRY, cùng pattern LeaveTypesPage/HR master-data).
 *
 * Target theo `policyScope` (Company/Department/Employee/JobLevel/ContractType) — client refine ĐÚNG 1
 * field khớp scope TRƯỚC khi gửi (khớp `chk_leave_policies_target` + Zod refine phía server, fail-fast).
 * `leaveTypeId`/`policyCode` immutable sau khi tạo (disable trên form sửa).
 */
const LEAVE_POLICY_PERMISSIONS = {
  read: LEAVE_ENGINE_PAIRS.VIEW_LEAVE_POLICY,
  create: LEAVE_ENGINE_PAIRS.CREATE_LEAVE_POLICY,
  update: LEAVE_ENGINE_PAIRS.UPDATE_LEAVE_POLICY,
  remove: LEAVE_ENGINE_PAIRS.DELETE_LEAVE_POLICY,
} as const;

function useLookupOptions() {
  const { data: leaveTypes } = useQuery({
    queryKey: leaveKeys.types.list(),
    queryFn: () => leaveApi.listTypes(),
    staleTime: 5 * 60_000,
  });
  const { data: departments } = useQuery({
    queryKey: hrKeys.departments.list(),
    queryFn: () => hrApi.listDepartments(),
    staleTime: 5 * 60_000,
  });
  const { data: jobLevels } = useQuery({
    queryKey: hrKeys.jobLevels.list(),
    queryFn: () => hrApi.listJobLevels(),
    staleTime: 5 * 60_000,
  });
  const { data: contractTypes } = useQuery({
    queryKey: hrKeys.contractTypes.list(),
    queryFn: () => hrApi.listContractTypes(),
    staleTime: 5 * 60_000,
  });
  return {
    leaveTypes: leaveTypes ?? [],
    departments: departments ?? [],
    jobLevels: jobLevels ?? [],
    contractTypes: contractTypes ?? [],
  };
}

function ScopeTargetField({ form }: { form: UseFormReturn<LeavePolicyFormValues> }) {
  const { t } = useTranslation("hr");
  const { departments, jobLevels, contractTypes } = useLookupOptions();
  const scope = form.watch("policyScope");

  if (scope === "Department") {
    return (
      <SelectField
        form={form}
        name="departmentId"
        label={t("masterData.leavePolicies.fields.departmentId")}
        options={departments.map((d) => ({ value: d.id, label: d.name }))}
      />
    );
  }
  if (scope === "Employee") {
    return (
      <TextField
        form={form}
        name="employeeId"
        label={t("masterData.leavePolicies.fields.employeeId")}
      />
    );
  }
  if (scope === "JobLevel") {
    return (
      <SelectField
        form={form}
        name="jobLevelId"
        label={t("masterData.leavePolicies.fields.jobLevelId")}
        options={jobLevels.map((l) => ({ value: l.id, label: l.name }))}
      />
    );
  }
  if (scope === "ContractType") {
    return (
      <SelectField
        form={form}
        name="contractTypeId"
        label={t("masterData.leavePolicies.fields.contractTypeId")}
        options={contractTypes.map((c) => ({ value: c.id, label: c.name }))}
      />
    );
  }
  return null;
}

function LeavePolicyFields({ form }: { form: UseFormReturn<LeavePolicyFormValues> }) {
  const { t } = useTranslation("hr");
  const { leaveTypes } = useLookupOptions();
  const isEdit = Boolean(form.formState.defaultValues?.policyCode);

  return (
    <>
      <SelectField
        form={form}
        name="leaveTypeId"
        label={t("masterData.leavePolicies.fields.leaveTypeId")}
        includeNone={!isEdit}
        options={leaveTypes.map((lt) => ({ value: lt.id, label: lt.name }))}
      />
      <TextField
        form={form}
        name="policyCode"
        label={t("masterData.leavePolicies.fields.policyCode")}
        required
        disabled={isEdit}
      />
      <TextField
        form={form}
        name="name"
        label={t("masterData.leavePolicies.fields.name")}
        required
      />
      <TextField
        form={form}
        name="description"
        label={t("masterData.leavePolicies.fields.description")}
      />
      <SelectField
        form={form}
        name="policyScope"
        label={t("masterData.leavePolicies.fields.policyScope")}
        includeNone={false}
        options={(["Company", "Department", "Employee", "JobLevel", "ContractType"] as const).map(
          (s) => ({ value: s, label: t(`masterData.leavePolicies.scopeOptions.${s}`) }),
        )}
      />
      <ScopeTargetField form={form} />
      <TextField
        form={form}
        name="yearlyQuotaDays"
        label={t("masterData.leavePolicies.fields.yearlyQuotaDays")}
        type="number"
      />
      <SelectField
        form={form}
        name="accrualMethod"
        label={t("masterData.leavePolicies.fields.accrualMethod")}
        includeNone={false}
        options={(["None", "Monthly", "Yearly", "Manual", "Prorated"] as const).map((m) => ({
          value: m,
          label: t(`masterData.leavePolicies.accrualOptions.${m}`),
        }))}
      />
      <TextField
        form={form}
        name="maxNegativeDays"
        label={t("masterData.leavePolicies.fields.maxNegativeDays")}
        type="number"
      />
      <TextField
        form={form}
        name="cancelBeforeDays"
        label={t("masterData.leavePolicies.fields.cancelBeforeDays")}
        type="number"
      />
      <TextField
        form={form}
        name="effectiveFrom"
        label={t("masterData.leavePolicies.fields.effectiveFrom")}
        required
      />
      <TextField
        form={form}
        name="effectiveTo"
        label={t("masterData.leavePolicies.fields.effectiveTo")}
      />
      <TextField
        form={form}
        name="priority"
        label={t("masterData.leavePolicies.fields.priority")}
        type="number"
      />
      <div className="grid grid-cols-2 gap-2">
        <CheckboxField
          form={form}
          name="reserveBalanceOnPending"
          label={t("masterData.leavePolicies.fields.reserveBalanceOnPending")}
        />
        <CheckboxField
          form={form}
          name="allowNegativeBalance"
          label={t("masterData.leavePolicies.fields.allowNegativeBalance")}
        />
        <CheckboxField
          form={form}
          name="allowCancelAfterApproved"
          label={t("masterData.leavePolicies.fields.allowCancelAfterApproved")}
        />
        <CheckboxField
          form={form}
          name="requiresManagerApproval"
          label={t("masterData.leavePolicies.fields.requiresManagerApproval")}
        />
        <CheckboxField
          form={form}
          name="requiresHrApproval"
          label={t("masterData.leavePolicies.fields.requiresHrApproval")}
        />
        <CheckboxField
          form={form}
          name="includeWeekends"
          label={t("masterData.leavePolicies.fields.includeWeekends")}
        />
        <CheckboxField
          form={form}
          name="includePublicHolidays"
          label={t("masterData.leavePolicies.fields.includePublicHolidays")}
        />
        <CheckboxField
          form={form}
          name="prorateOnJoinDate"
          label={t("masterData.leavePolicies.fields.prorateOnJoinDate")}
        />
      </div>
      {isEdit && <StatusField form={form} name="status" />}
    </>
  );
}

function useColumns(): ColumnDef<LeavePolicyView>[] {
  const { t } = useTranslation("hr");
  return [
    {
      accessorKey: "policyCode",
      header: t("masterData.common.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">{row.original.policyCode}</span>
      ),
    },
    {
      accessorKey: "name",
      header: t("masterData.common.columns.name"),
      cell: ({ row }) => <span className="font-medium text-foreground">{row.original.name}</span>,
    },
    {
      accessorKey: "leaveTypeName",
      header: t("masterData.leaveTypes.title"),
      cell: ({ row }) => <span className="text-sm">{row.original.leaveTypeName ?? "—"}</span>,
    },
    {
      accessorKey: "policyScope",
      header: t("masterData.leavePolicies.fields.policyScope"),
      cell: ({ row }) => (
        <span className="text-sm">
          {t(`masterData.leavePolicies.scopeOptions.${row.original.policyScope}`)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: t("masterData.common.columns.status"),
      cell: ({ row }) => (
        <span className="text-sm">
          {t(`masterData.leavePolicies.statusOptions.${row.original.status}`)}
        </span>
      ),
    },
  ];
}

export function LeavePoliciesPage() {
  const columns = useColumns();
  const config: MasterDataScreenConfig<LeavePolicyView, LeavePolicyFormValues> = {
    tKey: "leavePolicies",
    icon: ShieldCheck,
    permissions: LEAVE_POLICY_PERMISSIONS,
    listQueryKey: leaveKeys.policies.list(),
    fetchList: () => leaveApi.listPolicies(),
    invalidationKeys: leaveInvalidation.policies(),
    columns,
    getId: (item) => item.id,
    getLabel: (item) => item.name,
    schema: leavePolicyFormSchema,
    emptyValues: EMPTY_LEAVE_POLICY_FORM,
    toFormValues: leavePolicyToForm,
    toCreate: leavePolicyToCreate,
    toUpdate: leavePolicyToUpdate,
    renderFields: (form) => <LeavePolicyFields form={form} />,
    conflictField: "policyCode",
    create: leaveApi.createPolicy as (payload: never) => Promise<LeavePolicyView>,
    update: leaveApi.updatePolicy as (id: string, payload: never) => Promise<LeavePolicyView>,
    remove: leaveApi.deletePolicy,
  };
  return <MasterDataCrudScreen config={config} />;
}
