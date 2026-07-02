/**
 * EmployeeContractsPage — /hr/employees/:id/contracts (S2-FE-HR-7). Hợp đồng lao động của 1 nhân viên:
 * list + CRUD (create/update/delete) nếu có quyền `manage:contract` + gắn/tải file hợp đồng qua backend
 * (KHÔNG lộ storage_path — download-url TTL-ngắn).
 *
 * Tái dùng MasterDataCrudScreen (../departments) cho list+form CRUD (danh mục nhỏ theo 1 nhân viên —
 * KHÔNG cần phân trang server). Nối GET/POST/PATCH/DELETE /hr/contracts(/:id) + /hr/employees/:id/contracts.
 * Permission: view:contract (đọc) · manage:contract (create/update/delete — Company-only, employee/manager
 * KHÔNG có grant). fileId KHÔNG có trong form create/update — gắn qua LinkContractFileDialog (endpoint
 * riêng POST /hr/contracts/:id/file, server validate tenant + scan status).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ColumnDef } from "@tanstack/react-table";
import { ArrowLeft, Download, FileText, Link as LinkIcon } from "lucide-react";
import type { EmployeeContractDto } from "@mediaos/contracts";
import {
  contractsApi,
  filesApi,
  hrApi,
  hrKeys,
  useCan,
  PermissionGate,
  ApiError,
} from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import {
  MasterDataCrudScreen,
  type MasterDataScreenConfig,
} from "../departments/MasterDataCrudScreen";
import { SelectField, CheckboxField } from "../departments/master-data-fields";
import { DateField, TextAreaField } from "./contract-fields";
import {
  employeeContractFormSchema,
  employeeContractToCreate,
  employeeContractToUpdate,
  employeeContractToForm,
  EMPTY_EMPLOYEE_CONTRACT_FORM,
  type EmployeeContractFormValues,
} from "./employee-contract-form";
import { LinkContractFileDialog } from "./LinkContractFileDialog";
import { ContractStatusBadge } from "../contracts/ContractStatusBadge";
import {
  CONTRACT_ENGINE_PAIRS,
  FILE_DOWNLOAD_PAIR,
  CONTRACT_STATUSES,
} from "../contracts/constants";
import "../contracts/contracts-i18n";

// ---------------------------------------------------------------------------
// Download button — GET download-url (TTL-ngắn) rồi mở tab mới. KHÔNG bao giờ lộ storage_path.
// ---------------------------------------------------------------------------
function DownloadContractFileButton({ fileId }: { fileId: string }) {
  const { t } = useTranslation("hr");
  const canDownload = useCan(FILE_DOWNLOAD_PAIR.action, FILE_DOWNLOAD_PAIR.resourceType);

  const mutation = useMutation({
    mutationFn: () => filesApi.getDownloadUrl(fileId),
    onSuccess: (dto) => {
      window.open(dto.url, "_blank", "noopener,noreferrer");
    },
  });

  if (!canDownload) return null;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        aria-label={t("contracts.download")}
      >
        <Download className="mr-1 h-3.5 w-3.5" />
        {mutation.isPending ? t("contracts.downloading") : t("contracts.download")}
      </Button>
      {mutation.isError && (
        <span className="text-xs text-destructive">{t("contracts.downloadError")}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field renderer — dùng chung cho create + edit
// ---------------------------------------------------------------------------
function ContractFormFields({
  form,
  contractTypeOptions,
}: {
  form: import("react-hook-form").UseFormReturn<EmployeeContractFormValues>;
  contractTypeOptions: readonly { value: string; label: string }[];
}) {
  const { t } = useTranslation("hr");
  return (
    <>
      <SelectField
        form={form}
        name="contractTypeId"
        label={t("contracts.fields.contractType")}
        options={contractTypeOptions}
        includeNone
      />
      <DateField form={form} name="startDate" label={t("contracts.fields.startDate")} required />
      <DateField form={form} name="endDate" label={t("contracts.fields.endDate")} />
      <DateField form={form} name="signedDate" label={t("contracts.fields.signedDate")} />
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">
          {t("contracts.fields.contractCode")}
        </label>
        <input
          {...form.register("contractCode")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground">{t("contracts.fields.title")}</label>
        <input
          {...form.register("title")}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <SelectField
        form={form}
        name="status"
        label={t("contracts.fields.status")}
        includeNone={false}
        options={CONTRACT_STATUSES.map((s) => ({
          value: s,
          label: t(`contracts.status.${s}`, { defaultValue: s }),
        }))}
      />
      <CheckboxField form={form} name="isPrimary" label={t("contracts.fields.isPrimary")} />
      <TextAreaField form={form} name="note" label={t("contracts.fields.note")} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export interface EmployeeContractsPageProps {
  employeeId: string;
  onBack?: () => void;
}

export function EmployeeContractsPage({ employeeId, onBack }: EmployeeContractsPageProps) {
  const { t } = useTranslation("hr");
  const canManage = useCan(
    CONTRACT_ENGINE_PAIRS.MANAGE.action,
    CONTRACT_ENGINE_PAIRS.MANAGE.resourceType,
  );
  const [linkFileTarget, setLinkFileTarget] = useState<EmployeeContractDto | null>(null);

  const employeeQuery = useQuery({
    queryKey: hrKeys.employees.detail(employeeId),
    queryFn: () => hrApi.getEmployee(employeeId),
    staleTime: 30_000,
    retry: (count, err) => !(err instanceof ApiError && err.status === 404) && count < 2,
  });

  const contractTypesQuery = useQuery({
    queryKey: hrKeys.contractTypes.list(),
    queryFn: () => hrApi.listContractTypes(),
    enabled: canManage,
    staleTime: 5 * 60 * 1000,
  });
  const contractTypeOptions = (contractTypesQuery.data ?? []).map((ct) => ({
    value: ct.id,
    label: ct.name,
  }));
  const contractTypeNameById = new Map(
    (contractTypesQuery.data ?? []).map((ct) => [ct.id, ct.name] as const),
  );

  const columns: ColumnDef<EmployeeContractDto>[] = [
    {
      accessorKey: "contractCode",
      header: t("contracts.columns.code"),
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.contractCode ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: t("contracts.columns.title"),
      cell: ({ row }) => <span className="text-sm font-medium">{row.original.title ?? "—"}</span>,
    },
    {
      id: "contractType",
      header: t("contracts.columns.contractType"),
      cell: ({ row }) => (
        <span className="text-sm">
          {contractTypeNameById.get(row.original.contractTypeId) ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "startDate",
      header: t("contracts.columns.startDate"),
      cell: ({ row }) => <span className="text-sm tabular-nums">{row.original.startDate}</span>,
    },
    {
      accessorKey: "endDate",
      header: t("contracts.columns.endDate"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums">{row.original.endDate ?? "—"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: t("contracts.columns.status"),
      cell: ({ row }) => <ContractStatusBadge status={row.original.status} />,
    },
    {
      id: "file",
      header: t("contracts.columns.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          {row.original.fileId && <DownloadContractFileButton fileId={row.original.fileId} />}
          <PermissionGate
            action={CONTRACT_ENGINE_PAIRS.MANAGE.action}
            resourceType={CONTRACT_ENGINE_PAIRS.MANAGE.resourceType}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLinkFileTarget(row.original)}
              aria-label={t("contracts.linkFile.button")}
            >
              <LinkIcon className="mr-1 h-3.5 w-3.5" />
              {t("contracts.linkFile.button")}
            </Button>
          </PermissionGate>
        </div>
      ),
    },
  ];

  const config: MasterDataScreenConfig<EmployeeContractDto, EmployeeContractFormValues> = {
    tKey: "employeeContracts",
    icon: FileText,
    permissions: {
      read: CONTRACT_ENGINE_PAIRS.VIEW,
      create: CONTRACT_ENGINE_PAIRS.MANAGE,
      update: CONTRACT_ENGINE_PAIRS.MANAGE,
      remove: CONTRACT_ENGINE_PAIRS.MANAGE,
    },
    listQueryKey: hrKeys.contracts.byEmployee(employeeId),
    fetchList: () => contractsApi.listEmployeeContracts(employeeId),
    invalidationKeys: [hrKeys.contracts.byEmployee(employeeId), hrKeys.contracts.list()],
    columns,
    getId: (item) => item.id,
    getLabel: (item) => item.contractCode ?? item.title ?? item.id,
    schema: employeeContractFormSchema,
    emptyValues: EMPTY_EMPLOYEE_CONTRACT_FORM,
    toFormValues: employeeContractToForm,
    toCreate: (values) => employeeContractToCreate(values, employeeId),
    toUpdate: employeeContractToUpdate,
    renderFields: (form) => (
      <ContractFormFields form={form} contractTypeOptions={contractTypeOptions} />
    ),
    create: contractsApi.createContract as (payload: never) => Promise<EmployeeContractDto>,
    update: contractsApi.updateContract as (
      id: string,
      payload: never,
    ) => Promise<EmployeeContractDto>,
    remove: contractsApi.deleteContract,
  };

  const employeeName = employeeQuery.data?.fullName ?? employeeId;

  return (
    <div className="space-y-4 p-6">
      {onBack && (
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("contracts.backToEmployee")}
        </Button>
      )}
      <p className="text-sm text-muted-foreground">
        {t("contracts.title")} — <span className="font-medium text-foreground">{employeeName}</span>
      </p>
      <MasterDataCrudScreen config={config} />

      {linkFileTarget && (
        <LinkContractFileDialog
          contract={linkFileTarget}
          employeeId={employeeId}
          onClose={() => setLinkFileTarget(null)}
        />
      )}
    </div>
  );
}
