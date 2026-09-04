import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw } from "lucide-react";
import { payrollApi, payrollKeys } from "@mediaos/web-core";
import { Button, EmptyState, PageHeader, PaginationFooter } from "@mediaos/ui";
import { PAYROLL_PAGE_SIZE } from "./constants";
import { formatPayrollMoney } from "./payroll-format";
import { parsePayrollError, payrollErrorI18nKey } from "./payroll-errors";
import { PayslipBreakdown } from "./components/PayslipBreakdown";
import { PayslipStatusBadge } from "./components/StatusBadges";

/**
 * PAY-SCREEN-006 (S13-PAYROLL-FE-1) — «Phiếu lương của tôi». Scope **Own tuyệt đối**.
 *
 * ── VÌ SAO MÀN NÀY KHÔNG NẰM SAU CỔNG QUYỀN PAYROLL ───────────────────────────────────────────────
 * Route đăng ký dưới `moduleCode: "ME"` với `access:me`, KHÔNG phải `access:payroll`. Phiếu lương của
 * chính mình là thứ MỌI nhân viên phải xem được; nhét nó sau cổng module quản trị tiền lương là đúng
 * kiểu lỗi `personal-prefs-must-not-sit-behind-permission-gate` — người ít quyền nhất mất luôn đường
 * xem dữ liệu của chính họ. Cổng THẬT là cặp `('view-own-payslip','payslip')` ở BE (sàn scope Company
 * **TẮT** cho 3 route `/me/payslips*`, `objectGrantRequired: false` — nếu không nhân viên 403 trên
 * phiếu của chính mình).
 *
 * ⚠️ Danh sách chỉ có phiếu của kỳ **ĐÃ phát hành** (`Paid`/`Locked`) — SERVER lọc, FE không tự suy.
 * Đừng thêm bộ lọc trạng thái ở đây: trạng thái phiếu là DẪN XUẤT, không có cột để lọc.
 *
 * ⚠️ Xác nhận lần hai ⇒ 409 `PAYROLL-ERR-015`. Nút ẩn khi `acknowledgedAt !== null` — bảng
 * `payslip_acknowledgements` chỉ-INSERT, không có đường gỡ xác nhận.
 */
export function MePayslipsPage() {
  const { t } = useTranslation("payroll");
  const queryClient = useQueryClient();

  // KHÔNG có prop `initialPayslipId`: `target_url` của NOTI-EVENT-023 là **TĨNH** `/me/payslips`
  // (template mig 0566) — không có id phiếu trong deep-link. Nhận một prop mà không ai truyền là
  // code chết đội lốt "đã lo deep-link" (`ui-promises-backend-never-reads` chiều ngược lại).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const listParams = { page, per_page: PAYROLL_PAGE_SIZE };
  const listQuery = useQuery({
    queryKey: payrollKeys.mePayslips.list(listParams),
    queryFn: () => payrollApi.listMyPayslips(listParams),
  });

  const detailQuery = useQuery({
    queryKey: payrollKeys.mePayslips.detail(selectedId ?? ""),
    queryFn: () => payrollApi.getMyPayslip(selectedId as string),
    enabled: selectedId !== null,
  });

  const ackMutation = useMutation({
    mutationFn: (id: string) => payrollApi.acknowledgeMyPayslip(id),
    onSuccess: () => {
      setErrorKey(null);
      // Prefix: xác nhận đổi trạng thái DẪN XUẤT của phiếu ⇒ cả danh sách lẫn chi tiết phải đọc lại.
      void queryClient.invalidateQueries({ queryKey: payrollKeys.mePayslips.allOf() });
    },
    onError: (error) => setErrorKey(payrollErrorI18nKey(parsePayrollError(error))),
  });

  const rows = listQuery.data?.data ?? [];
  const total = listQuery.data?.pagination?.total ?? rows.length;
  const lastPage = Math.max(1, Math.ceil(total / PAYROLL_PAGE_SIZE));
  const detail = detailQuery.data ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("mePayslips.title")}
        description={t("mePayslips.description")}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void listQuery.refetch()}
            disabled={listQuery.isFetching}
          >
            <RefreshCw className="mr-2 size-4" />
            {t("states.retry")}
          </Button>
        }
      />

      {listQuery.isError ? (
        <EmptyState
          title={t("states.error")}
          action={
            <Button variant="outline" onClick={() => void listQuery.refetch()}>
              {t("states.retry")}
            </Button>
          }
        />
      ) : listQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">{t("states.loading")}</div>
      ) : rows.length === 0 ? (
        <EmptyState title={t("mePayslips.empty")} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
          <div className="space-y-2">
            <ul className="space-y-2">
              {rows.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(p.id);
                      setErrorKey(null);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                      selectedId === p.id
                        ? "border-brand bg-brand-muted/40"
                        : "border-border hover:bg-accent"
                    }`}
                  >
                    <span className="flex flex-col">
                      <span className="font-medium tabular-nums">{formatPayrollMoney(p.net)}</span>
                      <PayslipStatusBadge status={p.status} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {lastPage > 1 && (
              <PaginationFooter
                page={page}
                totalPages={lastPage}
                disabled={listQuery.isFetching}
                onPageChange={setPage}
              />
            )}
          </div>

          <div className="space-y-4">
            {selectedId === null ? (
              <EmptyState title={t("mePayslips.selectHint")} />
            ) : detailQuery.isLoading ? (
              <div className="text-sm text-muted-foreground">{t("states.loading")}</div>
            ) : detailQuery.isError || detail === null ? (
              <EmptyState
                title={t("states.error")}
                action={
                  <Button variant="outline" onClick={() => void detailQuery.refetch()}>
                    {t("states.retry")}
                  </Button>
                }
              />
            ) : (
              <>
                <PayslipBreakdown payslip={detail} />
                {detail.acknowledgedAt === null && (
                  <Button
                    onClick={() => ackMutation.mutate(detail.id)}
                    disabled={ackMutation.isPending}
                  >
                    <CheckCircle2 className="mr-2 size-4" />
                    {t("mePayslips.acknowledge")}
                  </Button>
                )}
                {errorKey && <p className="text-sm text-danger">{t(errorKey)}</p>}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
