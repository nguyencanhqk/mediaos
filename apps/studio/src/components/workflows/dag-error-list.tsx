import { useTranslation } from "react-i18next";
import type { DagValidationResultDto } from "@/lib/workflow-builder/contract";
import { DAG_ERROR_LABELS } from "./constants";

interface DagErrorListProps {
  result: DagValidationResultDto | null;
}

/** Hiển thị kết quả validate DAG inline (nút Validate / trước Publish). */
export function DagErrorList({ result }: DagErrorListProps) {
  const { t } = useTranslation("workflows");
  if (!result) return null;

  if (result.valid) {
    return (
      <div
        role="status"
        className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800"
      >
        {t("dag.valid")}
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3"
    >
      <p className="text-sm font-medium text-destructive">
        {t("dag.invalidHeading", { count: result.errors.length })}
      </p>
      <ul className="space-y-1">
        {result.errors.map((err, i) => (
          <li key={`${err.code}-${i}`} className="flex gap-2 text-sm text-destructive">
            <span className="font-medium">{DAG_ERROR_LABELS[err.code]}:</span>
            <span>{err.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
