import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileArchive, Loader2 } from "lucide-react";
import type { PayslipPdfBatchDto } from "@mediaos/contracts";
import { formatDateTime, payrollApi } from "@mediaos/web-core";
import { Button } from "@mediaos/ui";
import { parsePayrollError, payrollErrorText } from "../payroll-errors";
import { openSignedUrlInNewTab } from "../open-signed-url";

/** Nhịp hỏi lại lô đang sinh: 3 s rồi giãn dần tới 15 s (server tự báo `stale` sau 15′). */
export const PDF_BATCH_POLL_START_MS = 3_000;
export const PDF_BATCH_POLL_MAX_MS = 15_000;

export function nextPollDelay(attempt: number): number {
  return Math.min(PDF_BATCH_POLL_MAX_MS, Math.round(PDF_BATCH_POLL_START_MS * 1.5 ** attempt));
}

/**
 * PDF phiếu lương HÀNG LOẠT của một kỳ (PAYROLL-API-085) — nằm trong khối phiếu của PAY-SCREEN-002.
 *
 * 085 là LẤY-HOẶC-TẠO lô của CHÍNH người gọi (owner O-4, không `@Idempotent` — O-8): gọi lại = hỏi trạng thái.
 * - `Pending` ⇒ hỏi lại theo nhịp giãn dần cho tới khi xong (hẹn giờ huỷ khi rời màn).
 * - `Uploaded` ⇒ nút «Tải tệp ZIP»: mỗi lần bấm GỌI LẠI 085 để lấy signed-URL còn hạn (URL không giữ lâu).
 *   Tệp đã hết hạn thì server tạo lô mới ⇒ quay về `Pending`.
 * - `Failed` ⇒ lý do theo mã máy + «Tạo lại» (`retry: true` — CHỈ gửi ở lượt bấm đó, không gửi khi hỏi lại).
 *
 * Caller gác cặp: `export:payroll` + `view-payslip:payslip` (BE assert cả hai).
 */
export function PayslipPdfBatchControl({ periodId }: { periodId: string }) {
  const { t } = useTranslation("payroll");
  const [batch, setBatch] = useState<PayslipPdfBatchDto | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = batch?.status ?? null;

  useEffect(() => {
    if (status !== "Pending") return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      payrollApi
        .requestPayslipPdfBatch(periodId)
        .then((next) => {
          if (cancelled) return;
          setBatch(next);
          setAttempt((n) => n + 1);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setBatch(null);
          setError(payrollErrorText(t, parsePayrollError(err)));
        });
    }, nextPollDelay(attempt));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [status, attempt, periodId, t]);

  const request = async (retry: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const next = await payrollApi.requestPayslipPdfBatch(periodId, retry ? { retry: true } : {});
      setAttempt(0);
      setBatch(next);
    } catch (err) {
      setError(payrollErrorText(t, parsePayrollError(err)));
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      // Hộp chứa: biến gán trong closure bị TS thu hẹp về `null` ở ngoài.
      const seen: { batch: PayslipPdfBatchDto | null } = { batch: null };
      await openSignedUrlInNewTab(async () => {
        const next = await payrollApi.requestPayslipPdfBatch(periodId);
        seen.batch = next;
        return next.status === "Uploaded" && next.url ? next.url : null;
      });
      if (seen.batch) {
        setAttempt(0);
        setBatch(seen.batch);
      }
    } catch (err) {
      setError(payrollErrorText(t, parsePayrollError(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="payslip-pdf-batch">
      {status === null && (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void request(false)}>
          <FileArchive className="mr-2 size-4" aria-hidden />
          {t("pdf.batch.start")}
        </Button>
      )}
      {status === "Pending" && batch && (
        <span role="status" className="inline-flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {t("pdf.batch.pending", { count: batch.payslipCount })}
        </span>
      )}
      {status === "Uploaded" && batch && (
        <>
          <span className="text-muted-foreground">
            {t("pdf.batch.ready", {
              count: batch.payslipCount,
              time: formatDateTime(batch.fileExpiresAt),
            })}
          </span>
          <Button size="sm" disabled={busy} onClick={() => void download()}>
            <FileArchive className="mr-2 size-4" aria-hidden />
            {t("pdf.batch.download")}
          </Button>
        </>
      )}
      {status === "Failed" && batch && (
        <>
          <span role="alert" className="text-danger">
            {t(`pdf.batch.failure.${batch.failure ?? "generation-failed"}`)}
          </span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void request(true)}>
            {t("pdf.batch.retry")}
          </Button>
        </>
      )}
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
