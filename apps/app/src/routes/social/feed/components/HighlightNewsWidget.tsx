/**
 * S16-SOCIAL-FE-1 — widget «Tin nổi bật» ở rail phải (dựng từ SOCIAL-API-020).
 *
 * Không có endpoint riêng cho "tin nổi bật": nó là danh sách tin tức ĐÃ GHIM, lấy từ chính `020`
 * (`sort='active'` cố định, bài ghim lên đầu). Dựng một route mới cho việc này là thêm bề mặt API cho
 * một thứ suy được từ dữ liệu đã có.
 *
 * ⚠️ Widget rỗng ⇒ hiện câu rỗng RIÊNG, không dùng chung chuỗi với bảng tin (SPEC-16 §14 · ca C23):
 * «chưa có tin nổi bật» và «chưa có bài nào» là hai tình huống khác nhau.
 */
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { FeedNewsItemDto } from "@mediaos/contracts";
import { PortalWidgetBlock } from "@/layouts/portal/PortalRightRail";
import { relativeTime } from "../lib/feed-format";

interface HighlightNewsWidgetProps {
  items: readonly FeedNewsItemDto[];
  isLoading: boolean;
  isError: boolean;
  className?: string;
}

export function HighlightNewsWidget({
  items,
  isLoading,
  isError,
  className,
}: HighlightNewsWidgetProps): React.ReactElement {
  const { t } = useTranslation("social");

  return (
    <PortalWidgetBlock
      title={t("highlight.title")}
      isLoading={isLoading}
      errorText={isError ? t("state.errorBody") : null}
      className={className}
      action={
        <Link
          to="/feed/news"
          className="rounded text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("highlight.viewAll")}
        </Link>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="highlight-empty">
          {t("highlight.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="highlight-list">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/feed/posts/$postId"
                params={{ postId: item.id }}
                className="block rounded px-1 py-1 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {/*
                  Tiêu đề = dòng ĐẦU của thân bài. `body` nullable (bài poll/kudos) nên phải chịu
                  được `null`; cắt bằng `line-clamp` chứ không cắt chuỗi, để không cắt giữa một từ
                  tiếng Việt có dấu.
                */}
                <p className="line-clamp-2 text-sm text-foreground">{item.body ?? ""}</p>
                <p className="text-xs text-muted-foreground">{relativeTime(item.publishedAt)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PortalWidgetBlock>
  );
}
