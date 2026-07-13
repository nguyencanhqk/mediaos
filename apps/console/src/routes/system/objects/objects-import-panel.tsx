import { CheckCircle2, FileWarning } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ImportEmployeePreviewDto } from "@mediaos/contracts";
import { Button, Card } from "@mediaos/ui";

export type ImportStep = "idle" | "preview" | "done";

interface ObjectsImportPanelProps {
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
 * Panel wizard import CSV nhân viên (presentational). State + mutation do trang sở hữu.
 * Mirror từ apps/people/src/routes/org/employees-import.tsx, namespace "objects".
 */
export function ObjectsImportPanel({
  step,
  preview,
  result,
  uploadError,
  confirming,
  confirmError,
  onConfirm,
  onReset,
}: ObjectsImportPanelProps) {
  const { t } = useTranslation("objects");

  if (uploadError) {
    return (
      <Card className="flex items-start gap-3 border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        <FileWarning className="mt-0.5 h-4.5 w-4.5 shrink-0" />
        <span>{t("import.uploadError", { message: uploadError })}</span>
      </Card>
    );
  }

  if (step === "preview" && preview) {
    return (
      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">
            {t("import.preview.heading", { valid: preview.valid.length })}
            {preview.invalid.length > 0 && (
              <span className="ml-2 text-destructive">
                {t("import.preview.invalidCount", { count: preview.invalid.length })}
              </span>
            )}
          </h2>
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t("import.preview.cancel")}
          </Button>
        </div>

        {preview.invalid.length > 0 && (
          <ul className="space-y-1 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
            {preview.invalid.map((row) => (
              <li key={row.row}>
                {t("import.preview.rowError", { row: row.row, errors: row.errors.join("; ") })}
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
              {t("import.preview.moreRows", { count: preview.valid.length - 5 })}
            </li>
          )}
        </ul>

        {confirmError && (
          <p className="text-sm text-destructive">
            {t("import.preview.confirmError", { message: confirmError })}
          </p>
        )}
        {preview.valid.length > 0 && (
          <Button size="sm" onClick={onConfirm} disabled={confirming}>
            {confirming
              ? t("import.preview.confirming")
              : t("import.preview.confirmButton", { count: preview.valid.length })}
          </Button>
        )}
      </Card>
    );
  }

  if (step === "done" && result) {
    return (
      <Card className="flex items-center justify-between gap-3 border-success/30 bg-success-muted p-4 text-sm text-success">
        <span className="flex items-center gap-2">
          <CheckCircle2 className="h-4.5 w-4.5 shrink-0" />
          {t("import.done", { count: result.inserted })}
        </span>
        <Button variant="ghost" size="sm" onClick={onReset}>
          {t("common:actions.close")}
        </Button>
      </Card>
    );
  }

  return null;
}
