import { useQuery } from "@tanstack/react-query";
import { getDashboardReport } from "@/lib/dashboard-api";
import { StatCard } from "@/components/dashboard/stat-card";
import { RevenueByChannelChart } from "@/components/dashboard/revenue-by-channel-chart";

function formatVnd(value: number | null): string | number {
  if (value === null) return 0;
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  return value;
}

/**
 * ReportPage — G14-2 role-filtered report.
 * Server handles all permission masking — null sections are simply not rendered.
 */
export function ReportPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dashboard", "report"],
    queryFn: getDashboardReport,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Báo cáo tổng hợp</h1>
        <p className="text-sm text-muted-foreground">Đang tải dữ liệu…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold">Báo cáo tổng hợp</h1>
        <p className="text-sm text-destructive">
          Không tải được dữ liệu:{" "}
          {error instanceof Error ? error.message : "Lỗi không xác định"}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const { report } = data;
  const hasFinance = report.revenueThisMonth !== null;
  const hasEmployee = report.totalEmployees !== null;
  const hasAttendance = report.todayAttendanceRate !== null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-8">
      <h1 className="text-2xl font-semibold">Báo cáo tổng hợp</h1>

      {/* ── Finance section — only rendered when server grants access ─── */}
      {hasFinance && (
        <section>
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">
            Tài chính tháng này
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <StatCard
              label="Doanh thu"
              value={formatVnd(report.revenueThisMonth)}
              accent="green"
              sub="VND"
            />
            <StatCard
              label="Chi phí"
              value={formatVnd(report.costThisMonth)}
              accent="red"
              sub="VND"
            />
            <StatCard
              label="Lợi nhuận"
              value={formatVnd(report.profitThisMonth)}
              accent={
                report.profitThisMonth !== null && report.profitThisMonth >= 0 ? "green" : "red"
              }
              sub="VND"
            />
          </div>

          {report.revenueByChannel !== null && report.revenueByChannel.length > 0 && (
            <div className="mt-4">
              <RevenueByChannelChart data={report.revenueByChannel} />
            </div>
          )}
        </section>
      )}

      {/* ── HR / Employee section ────────────────────────────────────── */}
      {(hasEmployee || hasAttendance) && (
        <section>
          <h2 className="mb-4 text-sm font-medium text-muted-foreground">Nhân sự</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {hasEmployee && (
              <StatCard
                label="Tổng nhân viên"
                value={report.totalEmployees ?? 0}
                accent="blue"
              />
            )}
            {hasAttendance && (
              <StatCard
                label="Tỷ lệ có mặt hôm nay"
                value={`${report.todayAttendanceRate ?? 0}%`}
                accent={
                  report.todayAttendanceRate !== null && report.todayAttendanceRate >= 80
                    ? "green"
                    : "yellow"
                }
              />
            )}
          </div>
        </section>
      )}

      {!hasFinance && !hasEmployee && !hasAttendance && (
        <p className="text-sm text-muted-foreground">
          Bạn không có quyền xem báo cáo tổng hợp.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        Cập nhật lúc:{" "}
        {new Date(data.asOf).toLocaleTimeString("vi-VN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </p>
    </div>
  );
}
