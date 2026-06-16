import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { employeesApi } from "@/lib/employees-api";
import type { ImportEmployeePreviewDto } from "@mediaos/contracts";

type ImportStep = "idle" | "preview" | "done";

export function EmployeesPage() {
  const { t } = useTranslation("org");
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
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
    setImportStep("idle");
    setPreview(null);
    setImportResult(null);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("employees.title")}</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={upload.isPending || importStep === "preview"}
        >
          {upload.isPending ? t("employees.importing") : t("employees.importCsv")}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Import wizard */}
      {upload.isError && (
        <p className="text-sm text-destructive">
          {t("employees.uploadError", { message: upload.error instanceof Error ? upload.error.message : t("employees.unknownError") })}
        </p>
      )}

      {importStep === "preview" && preview && (
        <div className="space-y-3 rounded-xl border border-border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">
              {t("employees.preview.heading", { valid: preview.valid.length })}
              {preview.invalid.length > 0 && (
                <span className="ml-2 text-destructive">
                  {t("employees.preview.invalidCount", { count: preview.invalid.length })}
                </span>
              )}
            </h2>
            <Button variant="ghost" size="sm" onClick={resetImport}>
              {t("employees.preview.cancel")}
            </Button>
          </div>

          {preview.invalid.length > 0 && (
            <ul className="space-y-1 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              {preview.invalid.map((row) => (
                <li key={row.row}>
                  {t("employees.preview.rowError", { row: row.row, errors: row.errors.join("; ") })}
                </li>
              ))}
            </ul>
          )}

          <ul className="divide-y divide-border rounded-lg border border-border text-xs">
            {preview.valid.slice(0, 5).map((row, i) => (
              <li key={i} className="flex gap-4 px-3 py-2">
                <span className="font-medium">{row.fullName}</span>
                <span className="text-muted-foreground">{row.email}</span>
                {row.orgUnitName && <span className="text-muted-foreground">{row.orgUnitName}</span>}
              </li>
            ))}
            {preview.valid.length > 5 && (
              <li className="px-3 py-2 text-muted-foreground">
                {t("employees.preview.moreRows", { count: preview.valid.length - 5 })}
              </li>
            )}
          </ul>

          {confirm.isError && (
            <p className="text-sm text-destructive">
              {t("employees.preview.confirmError", { message: confirm.error instanceof Error ? confirm.error.message : t("employees.unknownError") })}
            </p>
          )}
          {preview.valid.length > 0 && (
            <Button
              size="sm"
              onClick={() => confirm.mutate(preview.sessionId)}
              disabled={confirm.isPending}
            >
              {confirm.isPending
                ? t("employees.preview.confirming")
                : t("employees.preview.confirmButton", { count: preview.valid.length })}
            </Button>
          )}
        </div>
      )}

      {importStep === "done" && importResult && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">
          <span>
            {t("employees.importDone", { count: importResult.inserted })}
          </span>
          <Button variant="ghost" size="sm" onClick={resetImport}>
            {t("common:actions.close")}
          </Button>
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">{t("common:loading")}</p>}
      {isError && <p className="text-sm text-destructive">{t("common:errors.loadFailed")}</p>}
      {employees.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">{t("employees.empty")}</p>
      )}

      <ul className="divide-y divide-border rounded-xl border border-border">
        {employees.map((e) => (
          <li key={e.id} className="flex items-center justify-between px-4 py-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Link
                  to="/org/employees/$employeeId"
                  params={{ employeeId: e.id }}
                  className="text-sm font-medium hover:underline"
                >
                  {e.userFullName ?? e.userEmail ?? e.userId}
                </Link>
                {e.employeeCode && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {e.employeeCode}
                  </span>
                )}
              </div>
              <div className="flex gap-3 text-xs text-muted-foreground">
                {e.orgUnitName && <span>{e.orgUnitName}</span>}
                {e.positionName && <span>· {e.positionName}</span>}
                <span>· {e.employmentType}</span>
                {e.baseSalary != null ? (
                  <span className="text-foreground">
                    {e.baseSalary.toLocaleString("vi-VN")} ₫
                  </span>
                ) : (
                  <span>{t("employees.salaryHidden")}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-xs ${
                  e.status === "active" ? "text-green-600" : "text-muted-foreground"
                }`}
              >
                {e.status}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => remove.mutate(e.id)}
                disabled={remove.isPending}
              >
                {t("employees.deleteButton")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
