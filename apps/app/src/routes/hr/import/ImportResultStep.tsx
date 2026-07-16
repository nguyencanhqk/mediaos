/**
 * ImportResultStep — Bước 3/3 của màn import nhân viên (S5-HR-IMPORT-FE-1).
 *
 * Hiển thị kết quả ÁP DỤNG THẬT (HrImportResult, dryRun=false): dòng đã tạo (created, kèm mã nhân viên)
 * và dòng bị bỏ qua do lỗi (skipped, kèm lý do) — partial-success, KHÔNG rollback dòng thành công khi có
 * dòng lỗi. `sessionAuditId` (audit append-only) không hiển thị — chỉ phục vụ truy vết nội bộ.
 */
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import type { HrImportCreatedRow, HrImportResult, HrImportRowError } from "@mediaos/contracts";
import { Badge, Button, DataTable, EmptyState } from "@mediaos/ui";

export interface ImportResultStepProps {
  result: HrImportResult;
  onImportAnother: () => void;
  onBackToList: () => void;
}

export function ImportResultStep({ result, onImportAnother, onBackToList }: ImportResultStepProps) {
  const { t } = useTranslation("hr");

  const createdColumns: ColumnDef<HrImportCreatedRow>[] = [
    {
      accessorKey: "row",
      header: t("import.result.createdColumns.row"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-foreground">{row.original.row}</span>
      ),
    },
    {
      accessorKey: "employeeCode",
      header: t("import.result.createdColumns.employeeCode"),
      cell: ({ row }) => (
        <span className="text-sm text-foreground">{row.original.employeeCode ?? "—"}</span>
      ),
    },
  ];

  const skippedColumns: ColumnDef<HrImportRowError>[] = [
    {
      accessorKey: "row",
      header: t("import.result.skippedColumns.row"),
      cell: ({ row }) => (
        <span className="text-sm tabular-nums text-foreground">{row.original.row}</span>
      ),
    },
    {
      accessorKey: "errors",
      header: t("import.result.skippedColumns.errors"),
      cell: ({ row }) => (
        <span className="text-sm text-destructive">{row.original.errors.join("; ")}</span>
      ),
    },
  ];

  return (
    <div className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{t("import.result.stepLabel")}</p>
        <p className="text-sm text-muted-foreground">
          {t("import.result.summary", { ok: result.counts.ok, fail: result.counts.fail })}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="success">{t("import.preview.countsOk", { count: result.counts.ok })}</Badge>
        <Badge variant={result.counts.fail > 0 ? "danger" : "muted"}>
          {t("import.preview.countsFail", { count: result.counts.fail })}
        </Badge>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t("import.result.createdTitle")}</p>
        <DataTable
          columns={createdColumns}
          data={result.created}
          emptyState={<EmptyState title={t("import.result.createdEmpty")} />}
          pageSize={10}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-foreground">{t("import.result.skippedTitle")}</p>
        <DataTable
          columns={skippedColumns}
          data={result.skipped}
          emptyState={<EmptyState title={t("import.result.skippedEmpty")} />}
          pageSize={10}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onImportAnother}>
          {t("import.result.importAnother")}
        </Button>
        <Button type="button" onClick={onBackToList} data-testid="hr-import-back-to-list">
          {t("import.backToList")}
        </Button>
      </div>
    </div>
  );
}
