/**
 * S16-SOCIAL-FE-1 — render nội dung bài/bình luận từ token của `parseFeedBody` (plan D5).
 *
 * 🔴 **KHÔNG có `dangerouslySetInnerHTML` ở đây, và không được thêm.** Mọi node đều do React dựng từ
 * token; chuỗi người dùng gõ chỉ bao giờ đi vào vị trí *text*. Ca **C14** assert điều đó.
 *
 * «Xem thêm» khi nội dung dài: cắt theo **số dòng** bằng CSS (`line-clamp`) chứ không cắt chuỗi.
 * Cắt chuỗi sẽ (a) cắt giữa một `#thẻ` hoặc URL làm hỏng token, (b) khiến «Thu gọn» phải parse lại.
 */
import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";
import { parseFeedBody, type FeedBodyToken } from "../lib/parse-feed-body";

/** UI-07 §34b.4 — quá 6 dòng thì gập lại. */
const CLAMP_LINES = 6;

interface PostBodyProps {
  body: string | null | undefined;
  /** Bình luận không gập (chúng vốn ngắn); bài thì có. */
  collapsible?: boolean;
  className?: string;
}

function renderToken(token: FeedBodyToken, index: number): React.ReactNode {
  switch (token.kind) {
    case "text":
      return <React.Fragment key={index}>{token.value}</React.Fragment>;

    case "url":
      return (
        <a
          key={index}
          href={token.href}
          target="_blank"
          // `noopener` chặn tab mới đọc `window.opener`; `noreferrer` kèm theo vì một số trình duyệt
          // cũ chỉ tôn trọng vế sau. Đây là link tới nội dung do NGƯỜI DÙNG dán — không tin được.
          rel="noopener noreferrer"
          className="rounded text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {token.value}
        </a>
      );

    case "tag":
      return (
        <Link
          key={index}
          to="/feed"
          search={{ tag: token.tag }}
          className="rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {token.value}
        </Link>
      );

    case "mention":
      /**
       * SPAN, KHÔNG PHẢI LINK — có lý do, xem docblock `parse-feed-body.ts`: hợp đồng không trả
       * danh sách mention nên FE không có `employeeId` để trỏ tới, và tra theo TÊN vừa sai (trùng
       * tên) vừa mở lại đúng oracle dò danh bạ mà SPEC-16 §12 `ERR-009` đóng.
       */
      return (
        <span key={index} className="font-medium text-primary">
          {token.value}
        </span>
      );
  }
}

export function PostBody({
  body,
  collapsible = false,
  className,
}: PostBodyProps): React.ReactElement | null {
  const { t } = useTranslation("social");
  const [expanded, setExpanded] = React.useState(false);

  const tokens = React.useMemo(() => parseFeedBody(body), [body]);

  /**
   * Mảng rỗng ⇒ KHÔNG render gì (kể cả khung). `body` được phép NULL với bài `poll`/`kudos`
   * (`chk_feed_posts_body_required`) — xem **R16/C27**. Một `<p>` rỗng ở đây sẽ vẽ ra khoảng trắng
   * mà không ai giải thích được, và tệ hơn là có thể in ra chữ "null" nếu ai đó nội suy thẳng.
   */
  if (tokens.length === 0) return null;

  // Ước lượng cần gập: đếm ký tự xuống dòng. Không chính xác bằng đo DOM, nhưng đủ để không hiện nút
  // «Xem thêm» trên một bài hai dòng — và không cần layout engine nên test được trong jsdom.
  const lineCount = (body ?? "").split("\n").length;
  const needsClamp = collapsible && lineCount > CLAMP_LINES;

  return (
    <div className={cn("text-sm text-foreground", className)}>
      <p
        data-testid="post-body"
        className={cn("whitespace-pre-wrap break-words", needsClamp && !expanded && "line-clamp-6")}
      >
        {tokens.map(renderToken)}
      </p>

      {needsClamp && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? t("post.showLess") : t("post.showMore")}
        </button>
      )}
    </div>
  );
}
