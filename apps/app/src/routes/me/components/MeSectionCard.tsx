/**
 * MeSectionCard — shell dùng chung cho mỗi section của Tổng quan ME (ME-SCREEN-001, SPEC-09 §13).
 *
 * Mirror `WidgetCard` (dashboard): đóng gói loading skeleton + 4 trạng thái lỗi/khoá của envelope
 * `{status, data}` (error/forbidden/module_disabled/unlinked_employee) + "ok nhưng rỗng" (empty) — component
 * gọi component CHỈ cần cung cấp `children` cho nhánh "ok có dữ liệu". 1 section lỗi KHÔNG phá cả trang
 * (§18.2 "Một module nguồn lỗi không được làm toàn bộ ME lỗi") — mỗi card tự khoanh vùng trạng thái của nó.
 */
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Lock, Ban, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, Skeleton, EmptyState } from "@mediaos/ui";
import type { MeSectionStatus } from "@mediaos/contracts";

interface MeSectionEnvelopeLike<T> {
  status: MeSectionStatus;
  data: T | null;
}

interface MeSectionCardProps<T> {
  title: string;
  icon: LucideIcon;
  /** true khi query cha (GET /me/overview) chưa có kết quả (KHÔNG phân biệt theo section). */
  isPageLoading: boolean;
  /** Envelope section — undefined khi page đang loading/lỗi (section chưa tồn tại). */
  section: MeSectionEnvelopeLike<T> | undefined;
  /** status='ok' nhưng data rỗng theo nghĩa nghiệp vụ (vd 0 task, chưa check-in) → render emptyTitle. */
  isEmpty?: (data: T) => boolean;
  emptyTitle: string;
  /** Nội dung khi status='ok' và KHÔNG rỗng. */
  children: (data: T) => React.ReactNode;
  /** Nội dung phụ dưới card (vd link "Xem tất cả") — chỉ hiện khi status='ok'. */
  footer?: React.ReactNode;
  className?: string;
}

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

export function MeSectionCard<T>({
  title,
  icon: Icon,
  isPageLoading,
  section,
  isEmpty,
  emptyTitle,
  children,
  footer,
  className,
}: MeSectionCardProps<T>) {
  const { t } = useTranslation("me");

  const renderBody = () => {
    if (isPageLoading || !section) return <SectionSkeleton />;

    switch (section.status) {
      case "error":
        return (
          <EmptyState
            icon={AlertTriangle}
            title={t("section.error.title")}
            description={t("section.error.description")}
            className="py-4"
          />
        );
      case "forbidden":
        return <EmptyState icon={Lock} title={t("section.forbidden")} className="py-4" />;
      case "module_disabled":
        return <EmptyState icon={Ban} title={t("section.moduleDisabled")} className="py-4" />;
      case "unlinked_employee":
        return <EmptyState icon={UserX} title={t("section.unlinkedEmployee")} className="py-4" />;
      case "ok":
        if (section.data === null || (isEmpty && isEmpty(section.data))) {
          return <EmptyState title={emptyTitle} className="py-4" />;
        }
        return children(section.data);
      default:
        // Union exhaustive theo contract hiện tại — trạng thái lạ (contract drift) coi như lỗi (fail-closed).
        return (
          <EmptyState icon={AlertTriangle} title={t("section.error.title")} className="py-4" />
        );
    }
  };

  return (
    <Card className={className ? `flex h-full flex-col ${className}` : "flex h-full flex-col"}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-brand" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 pt-0">{renderBody()}</CardContent>
      {section?.status === "ok" && section.data !== null && !isPageLoading && footer}
    </Card>
  );
}
