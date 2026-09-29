/**
 * S16-SOCIAL-FE-2 — widget «Bình chọn đang mở» ở rail phải (SOCIAL-API-040 `status=open`, plan D9).
 *
 * `040 status=open` vẫn trả poll QUÁ HẠN mà job chưa đóng (`status` còn `open`). Widget lọc chúng
 * ra bằng `isPollAcceptingVotes` — «đang mở» ở đây nghĩa là «còn bỏ phiếu được», không phải cột
 * `status` (plan §8 H4).
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { FeedPollListItemDto } from "@mediaos/contracts";
import { PortalWidgetBlock } from "@/layouts/portal/PortalRightRail";
import { relativeTime } from "../lib/feed-format";
import { isPollAcceptingVotes } from "../lib/poll-format";

interface OpenPollsWidgetProps {
  items: readonly FeedPollListItemDto[];
  isLoading: boolean;
  isError: boolean;
  className?: string;
}

export function OpenPollsWidget({
  items,
  isLoading,
  isError,
  className,
}: OpenPollsWidgetProps): React.ReactElement {
  const { t } = useTranslation("social");
  const open = items.filter((poll) => isPollAcceptingVotes(poll));

  return (
    <PortalWidgetBlock
      title={t("openPolls.title")}
      isLoading={isLoading}
      errorText={isError ? t("state.errorBody") : null}
      className={className}
      action={
        <Link
          to="/feed/polls"
          className="rounded text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("openPolls.viewAll")}
        </Link>
      }
    >
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="open-polls-empty">
          {t("openPolls.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="open-polls-list">
          {open.map((poll) => (
            <li key={poll.pollId}>
              <Link
                to="/feed/posts/$postId"
                params={{ postId: poll.postId }}
                className="block rounded px-1 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p className="line-clamp-2 text-sm text-foreground">{poll.question}</p>
                {poll.closesAt && (
                  <p className="text-xs text-muted-foreground">
                    {t("poll.closesIn", { when: relativeTime(poll.closesAt) })}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalWidgetBlock>
  );
}
