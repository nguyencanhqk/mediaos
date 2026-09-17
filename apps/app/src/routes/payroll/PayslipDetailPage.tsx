import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { FileDown } from "lucide-react";
import { payrollApi, payrollKeys, useCanExact } from "@mediaos/web-core";
import { Button, DetailPageHeader, EmptyState } from "@mediaos/ui";
import { PAYROLL_ENGINE_PAIRS } from "./constants";
import { openSignedUrlInNewTab } from "./open-signed-url";
import { parsePayrollError, payrollErrorText } from "./payroll-errors";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { PayslipBreakdown } from "./components/PayslipBreakdown";
import { PayslipStatusBadge } from "./components/StatusBadges";

/**
 * PAY-SCREEN-003 (S13-PAYROLL-FE-1) — phiếu lương chi tiết, đường QUẢN TRỊ
 * (`GET /payslips/:id`, cặp `('view-payslip','payslip')` — SENSITIVE).
 *
 * ⚠️ Đây KHÔNG phải màn «Phiếu lương của tôi». Hai màn dùng chung `PayslipBreakdown` nhưng đi hai
 * đường tải khác cặp quyền (`view-payslip` vs `view-own-payslip`), hai sổ cache khác nhau
 * (`payslips` vs `mePayslips`), và chỉ màn Own mới có nút «Xác nhận đã xem». Gộp lại là hoặc nhân viên
 * đọc trúng cache của quản trị, hoặc quản trị bấm nhầm nút xác nhận thay chủ phiếu.
 *
 * Không có nút sửa/huỷ: `payslips` là **append-only** (không UPDATE, không DELETE, không `deleted_at`).
 * Sai sót sau phát hành vá bằng thưởng/phạt kỳ SAU (PAY-DEC-008) — đó là lý do màn này chỉ ĐỌC.
 *
 * S15-PAYROLL-FE-4: nút «Tải PDF» (083) — BE assert `view-payslip:payslip` **+** `export:payroll` ⇒ chỉ hiện
 * khi giữ CẢ HAI (luật «export đòi cả hai cặp», SPEC-11 §11.1). Signed-URL mở ở tab mới, không lưu.
 */
export function PayslipDetailPage({
  payslipId,
  onBack,
}: {
  payslipId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation("payroll");
  const people = usePayrollPeople();
  const P = PAYROLL_ENGINE_PAIRS;
  // Gọi CẢ HAI hook vô điều kiện (`a && useX()` là gọi hook có điều kiện).
  const canViewPayslip = useCanExact(P.payslipPdf.action, P.payslipPdf.resourceType);
  const canExport = useCanExact(P.periodExport.action, P.periodExport.resourceType);
  const canPdf = canViewPayslip && canExport;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: payrollKeys.payslips.detail(payslipId),
    queryFn: () => payrollApi.getPayslip(payslipId),
  });

  if (query.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t("states.loading")}</div>;
  }
  if (query.isError || !query.data) {
    return (
      <EmptyState
        title={t("states.error")}
        action={
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("states.retry")}
          </Button>
        }
      />
    );
  }

  const payslip = query.data;

  const openPdf = async () => {
    setPdfBusy(true);
    setPdfError(null);
    try {
      await openSignedUrlInNewTab(async () => (await payrollApi.getPayslipPdf(payslipId)).url);
    } catch (err) {
      setPdfError(payrollErrorText(t, parsePayrollError(err)));
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* UI-07 §13.7 — header màn chi tiết. KHÔNG có `⋯`: `payslips` là bảng APPEND-ONLY (không sửa/huỷ/
          xoá), nên menu rỗng ⇒ nút `⋯` tự ẩn. Hành động duy nhất là «Tải PDF» (chỉ đọc). */}
      <DetailPageHeader
        onBack={onBack}
        title={t("payslip.title", { name: displayUserRef(payslip.userId, people) })}
        subtitle={t("payslip.description")}
        status={<PayslipStatusBadge status={payslip.status} />}
        actions={
          canPdf ? (
            <Button variant="outline" size="sm" disabled={pdfBusy} onClick={() => void openPdf()}>
              <FileDown className="mr-2 size-4" aria-hidden />
              {pdfBusy ? t("pdf.opening") : t("pdf.download")}
            </Button>
          ) : undefined
        }
      />
      {pdfError && (
        <p role="alert" className="text-sm text-danger">
          {pdfError}
        </p>
      )}
      <PayslipBreakdown payslip={payslip} />
    </div>
  );
}
