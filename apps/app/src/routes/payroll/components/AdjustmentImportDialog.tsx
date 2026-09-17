import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import type { PayrollWriteResultDto } from "@mediaos/contracts";
import { PAYROLL_ADJUSTMENT_IMPORT_MAX_BYTES } from "@mediaos/contracts";
import { Button, DataTable, Dialog, Input } from "@mediaos/ui";
import { parsePayrollError, payrollErrorI18nKey } from "../payroll-errors";
import { triggerBlobDownload } from "@/lib/download-blob";

const XLSX_RE = /\.xlsx$/i;

interface RowError {
  row: number;
  message: string;
}

/**
 * Dialog import thu nhập/khấu trừ khác (PAYROLL-API-076/077, D11 của plan) — hai pha `dryRun=true` →
 * `dryRun=false`, KHÔNG idempotency key (multipart, cùng khoá sẽ băm body rỗng lúc interceptor chạy
 * TRƯỚC `FileInterceptor`).
 *
 * ⚠️ **Toàn tệp hoặc không dòng nào.** Đường THÀNH CÔNG (`PayrollWriteResultDto`) không mang lỗi dòng —
 * lỗi dòng chỉ về qua **422** với `details[]` gồm `field:"row:<n>"` (tối đa 50) + `field:"errorRows"`
 * (tổng số dòng lỗi, dạng chuỗi). Bóc bằng `parseKindError(...).fields` (alias `parsePayrollError`),
 * KHÔNG đọc `result.errors` — khoá đó không tồn tại ở đường thành công.
 */
export function AdjustmentImportDialog({
  open,
  onClose,
  periodId,
  periodMonth,
}: {
  open: boolean;
  onClose: () => void;
  periodId: string;
  periodMonth: string;
}) {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  const [file, setFile] = useState<File | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [result, setResult] = useState<PayrollWriteResultDto | null>(null);
  const [resultPhase, setResultPhase] = useState<"preview" | "applied" | null>(null);
  // KHÔNG `readonly`: mảng này dựng cục bộ từ `parsePayrollError(...).fields` và đi thẳng vào `data` của
  // `DataTable` (kiểu MUTABLE `TData[]`). Khai `readonly` rồi `[...rowErrors]` ở chỗ render là dựng mảng
  // mới mỗi lần vẽ — đắt hơn và vẫn không phải bất biến thật, vì không ai khác giữ tham chiếu này.
  const [rowErrors, setRowErrors] = useState<RowError[] | null>(null);
  const [errorRowsTotal, setErrorRowsTotal] = useState<number | null>(null);
  const [generalErrorKey, setGeneralErrorKey] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setClientError(null);
      setResult(null);
      setResultPhase(null);
      setRowErrors(null);
      setErrorRowsTotal(null);
      setGeneralErrorKey(null);
    }
  }, [open]);

  const resetOutcome = () => {
    setResult(null);
    setResultPhase(null);
    setRowErrors(null);
    setErrorRowsTotal(null);
    setGeneralErrorKey(null);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0] ?? null;
    resetOutcome();
    if (picked === null) {
      setFile(null);
      setClientError(null);
      return;
    }
    if (!XLSX_RE.test(picked.name) || picked.size > PAYROLL_ADJUSTMENT_IMPORT_MAX_BYTES) {
      setFile(null);
      setClientError(t("adjustmentImport.fileHint"));
      return;
    }
    setClientError(null);
    setFile(picked);
  };

  const templateMutation = useMutation({
    mutationFn: () => payrollApi.downloadAdjustmentImportTemplate(),
    onSuccess: (res) => triggerBlobDownload(res.blob, res.filename ?? "payroll-adjustments.xlsx"),
  });

  const importMutation = useMutation({
    mutationFn: (vars: { dryRun: boolean }) => {
      if (file === null) throw new Error("no file");
      return payrollApi.importPeriodAdjustments(periodId, file, vars.dryRun);
    },
    onSuccess: (data, vars) => {
      setRowErrors(null);
      setErrorRowsTotal(null);
      setGeneralErrorKey(null);
      setResult(data);
      setResultPhase(vars.dryRun ? "preview" : "applied");
      if (!vars.dryRun) {
        // 076 ghi vào `bonus_penalties` (đích ghi thật) — danh sách thưởng/phạt phải đọc lại.
        void queryClient.invalidateQueries({ queryKey: payrollKeys.bonusPenalties.allOf() });
      }
    },
    onError: (error) => {
      setResult(null);
      setResultPhase(null);
      const info = parsePayrollError(error);
      const rows: RowError[] = [];
      for (const [key, message] of info.fields) {
        const m = /^row:(\d+)$/.exec(key);
        if (m) rows.push({ row: Number(m[1]), message });
      }
      if (rows.length > 0) {
        rows.sort((a, b) => a.row - b.row);
        setRowErrors(rows);
        setErrorRowsTotal(Number(info.fields.get("errorRows") ?? rows.length));
        setGeneralErrorKey(null);
      } else {
        setRowErrors(null);
        setErrorRowsTotal(null);
        setGeneralErrorKey(payrollErrorI18nKey(info));
      }
    },
  });

  /** `possible-duplicate:<n>` là số ĐẾM, không phải tiền — `dry-run` chỉ là cờ, không hiện riêng. */
  const duplicateCount = useMemo(() => {
    if (result === null) return null;
    for (const w of result.warnings) {
      const m = /^possible-duplicate:(\d+)$/.exec(w);
      if (m) return Number(m[1]);
    }
    return null;
  }, [result]);

  const rowErrorColumns = useMemo<ColumnDef<RowError>[]>(
    () => [
      {
        id: "row",
        header: t("adjustmentImport.columns.row"),
        cell: ({ row }) => <span className="tabular-nums">{row.original.row}</span>,
      },
      {
        id: "message",
        header: t("adjustmentImport.columns.message"),
        cell: ({ row }) => row.original.message,
      },
    ],
    [t],
  );

  const canPreview = file !== null && !importMutation.isPending;
  const canApply = file !== null && resultPhase === "preview" && !importMutation.isPending;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("adjustmentImport.title")}
      description={t("adjustmentImport.description")}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={importMutation.isPending}>
            {t("adjustmentImport.close")}
          </Button>
          <Button
            variant="outline"
            onClick={() => importMutation.mutate({ dryRun: true })}
            disabled={!canPreview}
          >
            {t("adjustmentImport.preview")}
          </Button>
          <Button onClick={() => importMutation.mutate({ dryRun: false })} disabled={!canApply}>
            {t("adjustmentImport.apply")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">{periodMonth}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => templateMutation.mutate()}
            disabled={templateMutation.isPending}
          >
            {t("adjustmentImport.downloadTemplate")}
          </Button>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">{t("adjustmentImport.chooseFile")}</span>
          <Input
            type="file"
            accept=".xlsx"
            onChange={handleFileChange}
            disabled={importMutation.isPending}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {t("adjustmentImport.fileHint")}
          </span>
          {clientError && <span className="mt-1 block text-xs text-danger">{clientError}</span>}
        </label>

        {generalErrorKey && <p className="text-sm text-danger">{t(generalErrorKey)}</p>}

        {rowErrors && rowErrors.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">
              {t("adjustmentImport.rowErrorsTitle")}
            </p>
            <p className="text-sm text-danger">{t("adjustmentImport.allOrNothing")}</p>
            <DataTable columns={rowErrorColumns} data={rowErrors} pageSize={rowErrors.length} />
            {errorRowsTotal !== null && errorRowsTotal > rowErrors.length && (
              <p className="text-xs text-muted-foreground">
                {t("adjustmentImport.rowErrorsTruncated", { count: errorRowsTotal })}
              </p>
            )}
          </div>
        )}

        {result && resultPhase === "preview" && (
          <div className="space-y-1 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
            <p>{t("adjustmentImport.previewOk", { count: result.affectedLines })}</p>
            {duplicateCount !== null && (
              <p className="text-warning">
                {t("adjustmentImport.duplicateWarning", { count: duplicateCount })}
              </p>
            )}
          </div>
        )}

        {result && resultPhase === "applied" && (
          <div className="rounded-md border border-success/40 bg-success-muted/40 px-4 py-3 text-sm">
            {t("adjustmentImport.applied", { count: result.affectedLines })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
