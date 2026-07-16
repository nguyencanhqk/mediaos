/**
 * ImportPreviewStep — Bước 2/3 của màn import nhân viên (S5-HR-IMPORT-FE-1).
 *
 * Hiển thị kết quả dryRun (HrImportReport, CHƯA ghi vào hệ thống): đếm hợp lệ/lỗi + bảng lỗi từng dòng
 * (chỉ những dòng KHÔNG hợp lệ — server không liệt kê từng dòng hợp lệ, chỉ trả counts.ok). "Áp dụng" gọi
 * lại đúng file này với dryRun=false — vô hiệu khi không có dòng hợp lệ nào (counts.ok === 0).
 */
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import { Loader2 } from "lucide-react";
import type { HrImportReport, HrImportRowError } from "@mediaos/contracts";
import { Badge, Button, DataTable, EmptyState } from "@mediaos/ui";

export interface ImportPreviewStepProps {
  report: HrImportReport;
  onBack: () => void;
  onApply: () => void;
  isApplying: boolean;
  error: string | null;
}

export function ImportPreviewStep({
  report,
  onBack,
  onApply,
  isApplying,
  error,
}: ImportPreviewStepProps) {
  const { t } = useTranslation("hr");

  const columns: ColumnDef<HrImportRowError>[] = [
    {
      accessorKey: "row",
      header: t("import.preview.columns.row"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-foreground">{row.original.row}</span>
      ),
    },
    {
      accessorKey: "errors",
      header: t("import.preview.columns.errors"),
      cell: ({ row }) => (
        <span className="text-sm text-destructive">{row.original.errors.join("; ")}</span>
      ),
    },
  ];

  const noValidRows = report.counts.ok === 0;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("import.preview.stepLabel")}</p>
        <p className="text-sm text-muted-foreground">{t("import.preview.description")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{t("import.preview.countsOk", { count: report.counts.ok })}</Badge>
        <Badge variant={report.counts.fail > 0 ? "danger" : "muted"}>
          {t("import.preview.countsFail", { count: report.counts.fail })}
        </Badge>
      </div>

      <DataTable
        columns={columns}
        data={report.errors}
        emptyState={<EmptyState title={t("import.preview.empty")} />}
        pageSize={10}
      />

      {noValidRows && (
        <p role="alert" className="text-sm text-destructive">
          {t("import.preview.noValidRows")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onBack} disabled={isApplying}>
          {t("import.preview.back")}
        </Button>
        <Button
          type="button"
          onClick={onApply}
          disabled={isApplying || noValidRows}
          data-testid="hr-import-apply-button"
        >
          {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />}
          {isApplying ? t("import.preview.applying") : t("import.preview.apply")}
        </Button>
      </div>
    </div>
  );
}
