/**
 * S16-SOCIAL-FE-2C — widget «Vinh danh tháng này» ở rail phải (plan D12, owner ký O1): 5 lượt MỚI NHẤT
 * của tháng hiện tại theo giờ công ty (`047?month=&limit=5`) — KHÔNG gộp theo người (047 không có tổng
 * hợp). Trình bày thuần: `SocialPortalShell` nạp dữ liệu (khuôn `OpenPollsWidget`).
 *
 * Mỗi dòng: icon huy hiệu + tối đa 3 tên người nhận + «+N» ⇒ link bài (`postId`). Không avatar — CHỦ Ý
 * thiết kế (widget chưa từng có `Avatar`; owner D4 của S16-SOCIAL-AVATARPRESIGN-1 giữ CHỈ tên dù
 * `avatarUrl` đã là URL ký). Tên rỗng ⇒ «Đồng nghiệp», cùng luật với khối.
 */
import type * as React from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { FeedKudosListItemDto } from "@mediaos/contracts";
import { PortalWidgetBlock } from "@/layouts/portal/PortalRightRail";
import { KudosBadgeIcon } from "./KudosBadgeIcon";

/** Số tên người nhận hiện trên một dòng rail — rail hẹp. */
const NAMES_SHOWN = 3;

interface KudosThisMonthWidgetProps {
  items: readonly FeedKudosListItemDto[];
  isLoading: boolean;
  isError: boolean;
  className?: string;
}

export function KudosThisMonthWidget({
  items,
  isLoading,
  isError,
  className,
}: KudosThisMonthWidgetProps): React.ReactElement {
  const { t } = useTranslation("social");

  return (
    <PortalWidgetBlock
      title={t("kudos.widget.title")}
      isLoading={isLoading}
      errorText={isError ? t("state.errorBody") : null}
      className={className}
      action={
        <Link
          to="/feed/kudos"
          className="rounded text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("kudos.widget.viewAll")}
        </Link>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="kudos-widget-empty">
          {t("kudos.widget.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="kudos-widget-list">
          {items.map((item) => {
            const names = item.recipients
              .slice(0, NAMES_SHOWN)
              .map((r) => r.fullName ?? t("kudos.unknownRecipient"))
              .join(", ");
            const more = item.recipients.length - NAMES_SHOWN;
            return (
              <li key={item.kudosId}>
                <Link
                  to="/feed/posts/$postId"
                  params={{ postId: item.postId }}
                  data-testid="kudos-widget-item"
                  className="flex items-start gap-2 rounded px-1 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <KudosBadgeIcon icon={item.badge?.icon ?? null} className="mt-0.5 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-2 text-sm text-foreground">
                      {names}
                      {more > 0 ? ` ${t("kudos.moreRecipients", { count: more })}` : ""}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {item.badge?.name ?? t("kudos.label")}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PortalWidgetBlock>
  );
}
