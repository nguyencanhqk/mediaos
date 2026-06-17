import { Skeleton } from "@mediaos/ui";

interface DashboardSkeletonProps {
  /** Số nhóm section giả lập khi đang tải. */
  sections?: number;
}

/**
 * Skeleton loading cho trang dashboard/report: vài section, mỗi section
 * có hàng stat-card + một khối biểu đồ. Thuần trình bày, không có data.
 */
export function DashboardSkeleton({ sections = 2 }: DashboardSkeletonProps) {
  return (
    <div className="space-y-6" aria-hidden="true">
      {Array.from({ length: sections }).map((_, sectionIndex) => (
        <div
          key={sectionIndex}
          className="rounded-2xl border border-border bg-card/60 p-5 shadow-sm sm:p-6"
        >
          <Skeleton className="mb-4 h-4 w-40" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, cardIndex) => (
              <div key={cardIndex} className="rounded-xl border border-border bg-card p-5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="mt-3 h-8 w-16" />
              </div>
            ))}
          </div>
          {sectionIndex === 0 && <Skeleton className="mt-4 h-44 w-full rounded-xl" />}
        </div>
      ))}
    </div>
  );
}
