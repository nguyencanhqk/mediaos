/**
 * S16-SOCIAL-FE-1 — rail PHẢI của cổng thông tin: khung xếp chồng các khối widget (UI-07 §34b.5).
 *
 * Rail này KHÔNG biết widget nào đang nằm trong nó — nó chỉ cho các khối một cái khung nhất quán và
 * một chỗ đứng. Widget thật (Sinh nhật, Tin nổi bật) tự nạp dữ liệu của mình.
 *
 * ⚠️ **SKELETON THEO TỪNG KHỐI, không phải một spinner cho cả rail** (UI-07 §34b.5): hai widget tải
 * độc lập nhau, nên một spinner chung sẽ giữ cả rail ở trạng thái chờ cho tới widget chậm nhất — và
 * khi một widget lỗi thì cả rail trắng. `PortalWidgetBlock` vì vậy nhận `isLoading`/`error` RIÊNG.
 */
import { useTranslation } from "react-i18next";
import { Skeleton, cn } from "@mediaos/ui";

interface PortalRightRailProps {
  children: React.ReactNode;
  className?: string;
}

export function PortalRightRail({ children, className }: PortalRightRailProps): React.ReactElement {
  const { t } = useTranslation("social");
  return (
    <aside
      aria-label={t("portal.rightRailAria")}
      data-testid="portal-right-rail"
      className={cn("flex w-full flex-col gap-4 py-4 lg:w-[300px] lg:shrink-0", className)}
    >
      {children}
    </aside>
  );
}

interface PortalWidgetBlockProps {
  title: string;
  /** Đang tải ⇒ hiện skeleton THAY nội dung; tiêu đề vẫn giữ để rail không nhảy chiều cao. */
  isLoading?: boolean;
  /**
   * Lỗi của RIÊNG khối này.
   *
   * ⚠️ Lỗi một widget **không được** làm hỏng widget còn lại — đó là lý do cờ này ở cấp KHỐI. Khối
   * lỗi hiện một dòng ngắn và biến mất khỏi luồng chú ý, KHÔNG ném lên để bắt ở rail.
   */
  errorText?: string | null;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function PortalWidgetBlock({
  title,
  isLoading = false,
  errorText = null,
  action,
  children,
  className,
}: PortalWidgetBlockProps): React.ReactElement {
  return (
    <section
      aria-label={title}
      data-testid="portal-widget-block"
      className={cn("rounded-lg border border-border bg-card p-3", className)}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </header>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true" data-testid="portal-widget-skeleton">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : errorText ? (
        <p className="text-sm text-muted-foreground" role="status">
          {errorText}
        </p>
      ) : (
        children
      )}
    </section>
  );
}
