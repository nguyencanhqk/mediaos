import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type ColumnDef } from "@tanstack/react-table";
import { Search, Trash2, Upload, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EmployeeListItemDto, ImportEmployeePreviewDto } from "@mediaos/contracts";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { employeesApi } from "@/lib/employees-api";
import {
  EMPLOYEE_STATUS_VARIANT,
  type EmployeeStatus,
  formatSalary,
} from "@/lib/employee-format";
import { EmployeeImportPanel, type ImportStep } from "./employees-import";

export function EmployeesPage() {
  const { t } = useTranslation("org");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [preview, setPreview] = useState<ImportEmployeePreviewDto | null>(null);
  const [importResult, setImportResult] = useState<{ inserted: number; failed: number } | null>(
    null,
  );

  const { data: employees = [], isLoading, isError } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeesApi.listEmployees({ status: "active" }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => employeesApi.deleteEmployee(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["employees"] }),
  });

  const upload = useMutation({
    mutationFn: (file: File) => employeesApi.uploadImport(file),
    onSuccess: (data) => {
      setPreview(data);
      setImportStep("preview");
    },
  });

  const confirm = useMutation({
    mutationFn: (sessionId: string) => employeesApi.confirmImport(sessionId),
    onSuccess: (result) => {
      setImportResult(result);
      setImportStep("done");
      void qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) upload.mutate(file);
    e.target.value = "";
  };

  const resetImport = () => {
    upload.reset();
    setImportStep("idle");
    setPreview(null);
    setImportResult(null);
  };

  const columns = useMemo<ColumnDef<EmployeeListItemDto>[]>(
    () => [
      {
        id: "employee",
        header: t("employees.columns.employee"),
        accessorFn: (row) =>
          `${row.userFullName ?? ""} ${row.userEmail ?? ""} ${row.employeeCode ?? ""}`,
        cell: ({ row }) => {
          const e = row.original;
          const name = e.userFullName ?? e.userEmail ?? e.userId;
          return (
            <div className="flex items-center gap-3">
              <Avatar name={name} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Link
                    to="/org/employees/$employeeId"
                    params={{ employeeId: e.id }}
                    className="truncate font-medium text-foreground hover:text-brand hover:underline"
                  >
                    {name}
                  </Link>
                  {e.employeeCode && (
                    <Badge variant="muted" className="font-normal">
                      {e.employeeCode}
                    </Badge>
                  )}
                </div>
                {e.userEmail && (
                  <p className="truncate text-xs text-muted-foreground">{e.userEmail}</p>
                )}
              </div>
            </div>
          );
        },
      },
      {
        accessorKey: "orgUnitName",
        header: t("employees.columns.department"),
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{(getValue() as string | null) ?? "—"}</span>
        ),
      },
      {
        accessorKey: "positionName",
        header: t("employees.columns.position"),
        cell: ({ getValue }) => (getValue() as string | null) ?? "—",
      },
      {
        accessorKey: "employmentType",
        header: t("employees.columns.employmentType"),
        cell: ({ getValue }) => {
          const v = getValue() as EmployeeListItemDto["employmentType"];
          return (
            <span className="text-muted-foreground">
              {t(`employeeDetail.employmentType.${v}`, { defaultValue: v })}
            </span>
          );
        },
      },
      {
        accessorKey: "baseSalary",
        header: t("employees.columns.salary"),
        cell: ({ row }) => {
          const value = row.original.baseSalary;
          return value == null ? (
            <span className="text-xs text-muted-foreground">{t("employees.salaryHidden")}</span>
          ) : (
            <span className="font-medium tabular-nums">{formatSalary(value, t)}</span>
          );
        },
      },
      {
        accessorKey: "status",
        header: t("employees.columns.status"),
        cell: ({ getValue }) => {
          const status = getValue() as EmployeeStatus;
          return (
            <Badge variant={EMPLOYEE_STATUS_VARIANT[status]}>
              {t(`employeeDetail.statusLabels.${status}`, { defaultValue: status })}
            </Badge>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div className="text-right">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => remove.mutate(row.original.id)}
              disabled={remove.isPending}
              aria-label={t("employees.deleteButton")}
              title={t("employees.deleteButton")}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ),
      },
    ],
    [t, remove],
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6 sm:p-8">
      <PageHeader
        title={t("employees.title")}
        description={t("employees.summary", { count: employees.length })}
        icon={Users}
        actions={
          <Button
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending || importStep === "preview"}
          >
            <Upload className="h-4 w-4" />
            {upload.isPending ? t("employees.importing") : t("employees.importCsv")}
          </Button>
        }
      >
        <div className="relative max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("employees.searchPlaceholder")}
            aria-label={t("employees.searchPlaceholder")}
            className="pl-9"
          />
        </div>
      </PageHeader>

      <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />

      <EmployeeImportPanel
        step={importStep}
        preview={preview}
        result={importResult}
        uploadError={
          upload.isError
            ? upload.error instanceof Error
              ? upload.error.message
              : t("employees.unknownError")
            : null
        }
        confirming={confirm.isPending}
        confirmError={
          confirm.isError
            ? confirm.error instanceof Error
              ? confirm.error.message
              : t("employees.unknownError")
            : null
        }
        onConfirm={() => preview && confirm.mutate(preview.sessionId)}
        onReset={resetImport}
      />

      {isError ? (
        <EmptyState
          icon={Users}
          title={t("common:errors.loadFailed")}
          description={t("employees.loadHint")}
        />
      ) : (
        <DataTable
          columns={columns}
          data={employees}
          isLoading={isLoading}
          globalFilter={query}
          emptyState={
            <EmptyState
              icon={Users}
              title={query ? t("employees.searchEmpty") : t("employees.empty")}
              description={query ? undefined : t("employees.emptyHint")}
            />
          }
        />
      )}
    </div>
  );
}
