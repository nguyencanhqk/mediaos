import { CheckCircle2, FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ImportEmployeePreviewDto } from "@mediaos/contracts";
import { Button } from "@mediaos/ui";
import { Card } from "@mediaos/ui";

export type ImportStep = "idle" | "preview" | "done";

interface EmployeeImportPanelProps {
  step: ImportStep;
  preview: ImportEmployeePreviewDto | null;
  result: { inserted: number; failed: number } | null;
  /** Thông báo lỗi upload (đã rút message) — null nếu không lỗi. */
  uploadError: string | null;
  confirming: boolean;
  confirmError: string | null;
  onConfirm: () => void;
  onReset: () => void;
}

/**
 * Panel wizard import CSV nhân sự (presentational). State + mutation do trang sở hữu;
 * ở đây chỉ render: lỗi upload · xem trước (valid/invalid) · kết quả nhập.
 */
export function EmployeeImportPanel({
  step,
  preview,
  result,
  uploadError,
  confirming,
  confirmError,
  onConfirm,
  onReset,
}: EmployeeImportPanelProps) {
  const { t } = useTranslation("org");

  if (uploadError) {
    return (
      <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <FileWarning className="mt-0.5 h-4.5 w-4.5 shrink-0" />
        <span>{t("employees.uploadError", { message: uploadError })}</span>
      </Card>
    );
  }

  if (step === "preview" && preview) {
    return (
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">
            {t("employees.preview.heading", { valid: preview.valid.length })}
            {preview.invalid.length > 0 && (
              <span className="ml-2 text-destructive">
                {t("employees.preview.invalidCount", { count: preview.invalid.length })}
              </span>
            )}
          </h2>
          <Button variant="ghost" size="sm" onClick={onReset}>
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
            <li key={i} className="flex flex-wrap gap-x-4 gap-y-0.5 px-3 py-2">
              <span className="font-medium text-foreground">{row.fullName}</span>
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

        {confirmError && (
          <p className="text-sm text-destructive">
            {t("employees.preview.confirmError", { message: confirmError })}
          </p>
        )}
        {preview.valid.length > 0 && (
          <Button size="sm" onClick={onConfirm} disabled={confirming}>
            {confirming
              ? t("employees.preview.confirming")
              : t("employees.preview.confirmButton", { count: preview.valid.length })}
          </Button>
        )}
      </Card>
    );
  }

  if (step === "done" && result) {
    return (
      <Card className="flex items-center justify-between gap-3 border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
          {t("employees.importDone", { count: result.inserted })}
        </span>
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t("common:actions.close")}
        </Button>
      </Card>
    );
  }

  return null;
}
