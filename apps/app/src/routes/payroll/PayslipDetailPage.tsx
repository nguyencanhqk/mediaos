import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import { Button, EmptyState, PageHeader } from "@mediaos/ui";
import { displayUserRef, usePayrollPeople } from "./use-payroll-people";
import { PayslipBreakdown } from "./components/PayslipBreakdown";

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("payslip.title", { name: displayUserRef(payslip.userId, people) })}
        description={t("payslip.description")}
        actions={
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 size-4" />
            {t("actions.back")}
          </Button>
        }
      />
      <PayslipBreakdown payslip={payslip} />
    </div>
  );
}
