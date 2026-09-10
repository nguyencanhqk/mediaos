/**
 * S17-CHAT-UX2-FE-4 — khối «Liên kết» của bảng thông tin phòng v2 (CHAT-API-031 · SPEC-15 §15b · DEC-025).
 *
 * ┌─ BA điều của hợp đồng CHAT-API-031 mà đọc lướt là hiểu ngược ────────────────────────────────────┐
 * │ 1. Phản hồi là **OBJECT keyset** `{data, nextCursor, truncated}` — KHÔNG phải mảng trần như       │
 * │    `listRoomFiles`. `.map` thẳng lên nó là `undefined is not a function` lúc chạy.                │
 * │ 2. **`nextCursor === null` mới là "hết", KHÔNG phải `data.length === 0`.** Server quét tối đa một │
 * │    số TIN cố định mỗi request nên một trang RỖNG là chuyện bình thường (50 tin liền không ai gửi  │
 * │    link). Khi đó `truncated: true` và `nextCursor` vẫn khác null ⇒ phải MỜI lật tiếp. Đọc trang   │
 * │    rỗng thành «phòng không có liên kết nào» là đúng lỗi đã bịt ở `018a`.                          │
 * │ 3. Con trỏ **mang vân phòng**: dùng lại con trỏ của phòng khác ⇒ 400 `CHAT-ERR-016`. Component    │
 * │    này keyed theo phòng ở `RoomInfoPanel` (unmount khi đổi phòng) nên con trỏ không đi theo —     │
 * │    đừng nâng state này lên trên panel.                                                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **KHÔNG gộp URL trùng.** Server cố ý không dedupe: một dòng = "một lần ai đó chia sẻ", không phải
 * "một địa chỉ". Gộp ở client là xoá người gửi + mốc thời gian của những lần còn lại — thông tin không
 * dựng lại được từ phía này.
 *
 * ⚠️ Khoá React là `${messageId}:${linkIndex}` — một tin có thể chứa nhiều link, và hai anh em trùng
 * `key` là rò node DOM (memory `duplicate-sibling-key-leaks-dom-node`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "lucide-react";
import { chatApi } from "@mediaos/web-core";
import { Button, Skeleton } from "@mediaos/ui";
import type { ChatRoomLinkDto } from "@mediaos/contracts";
import { ROOM_LINKS_PAGE_SIZE } from "@/routes/chat/constants";
import { formatDateTimeShort } from "./chat-format";

interface RoomLinksListProps {
  roomId: string;
  /** Nhảy tới tin chứa liên kết — cùng đường ngữ cảnh với tệp và tin ghim. */
  onJumpToMessage: (messageId: string, roomSeq: number) => void;
}

export function RoomLinksList({ roomId, onJumpToMessage }: RoomLinksListProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const [links, setLinks] = useState<readonly ChatRoomLinkDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  /** Trang gần nhất dừng vì CHẠM TRẦN QUÉT (không phải vì hết dữ liệu) — quyết định câu chữ khi rỗng. */
  const [wasTruncated, setTruncated] = useState(false);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasError, setError] = useState(false);

  const activeRoomRef = useRef(roomId);

  const load = useCallback(
    async (cursor: string | null) => {
      activeRoomRef.current = roomId;
      if (cursor === null) setLoading(true);
      else setLoadingMore(true);
      setError(false);
      try {
        const page = await chatApi.listRoomLinks(roomId, {
          limit: ROOM_LINKS_PAGE_SIZE,
          ...(cursor !== null ? { cursor } : {}),
        });
        if (activeRoomRef.current !== roomId) return;
        setLinks((prev) => (cursor === null ? page.data : [...prev, ...page.data]));
        setNextCursor(page.nextCursor);
        setTruncated(page.truncated);
      } catch (err: unknown) {
        if (activeRoomRef.current !== roomId) return;
        setError(true);
        console.error(`[chat] không tải được danh sách liên kết của phòng ${roomId}:`, err);
      } finally {
        if (activeRoomRef.current === roomId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [roomId],
  );

  useEffect(() => {
    void load(null);
  }, [load]);

  if (isLoading) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" data-testid="chat-links-loading">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (hasError && links.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-4">
        <p className="text-xs text-muted-foreground">{t("info.links.loadError")}</p>
        <Button variant="outline" size="sm" onClick={() => void load(null)}>
          {t("conversation.retry")}
        </Button>
      </div>
    );
  }

  // RỖNG + còn con trỏ ⇒ server mới quét tới đó thôi, CHƯA phải "phòng không có liên kết".
  if (links.length === 0) {
    return (
      <div className="space-y-2 p-3">
        <p className="text-xs text-muted-foreground" data-testid="chat-links-empty">
          {nextCursor === null ? t("info.links.empty") : t("info.links.scanTruncated")}
        </p>
        {nextCursor !== null && (
          <Button
            variant="outline"
            size="sm"
            disabled={isLoadingMore}
            onClick={() => void load(nextCursor)}
            data-testid="chat-links-scan-more"
          >
            {isLoadingMore ? t("info.links.loadingMore") : t("info.links.scanMore")}
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {links.map((link) => (
          <li
            key={`${link.messageId}:${link.linkIndex}`}
            className="px-3 py-2"
            data-testid="chat-link-row"
          >
            <LinkAnchor url={link.url} />
            <p className="mt-1 flex items-baseline gap-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {link.senderName ?? t("message.unknownSender")}
              </span>
              <span className="shrink-0 tabular-nums">{formatDateTimeShort(link.createdAt)}</span>
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => onJumpToMessage(link.messageId, link.roomSeq)}
            >
              {t("info.links.jump")}
            </Button>
          </li>
        ))}
      </ul>

      {hasError && (
        <p className="px-3 py-2 text-xs text-destructive" role="alert">
          {t("info.links.loadMoreError")}
        </p>
      )}

      {nextCursor !== null && (
        <div className="flex flex-col items-center gap-1 py-2">
          {wasTruncated && (
            <p className="px-3 text-center text-[11px] text-muted-foreground">
              {t("info.links.scanTruncated")}
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={isLoadingMore}
            onClick={() => void load(nextCursor)}
            data-testid="chat-links-load-more"
          >
            {isLoadingMore ? t("info.links.loadingMore") : t("info.links.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Một địa chỉ. `rel="noopener noreferrer nofollow"` đi CẢ BA giá trị cùng nhau (khuôn `MessageBubble`):
 * chặn tab đích chạm `window.opener`, không rò referrer, và không truyền uy tín SEO cho nội dung do
 * người dùng nhập.
 *
 * ⚠️ Vế `http(s)` kiểm LẠI ở đây dù server đã chỉ trích `https?://`: đây là allowlist, và một địa chỉ
 * không khớp thì hiện dưới dạng CHỮ chứ không bao giờ thành `href` (cùng luật `splitTextWithLinks`).
 *
 * ⚠️ `dir="ltr"` không phải trang trí: URL chứa ký tự đảo chiều (bidi) hiện ra có thể đọc thành một tên
 * miền KHÁC hẳn cái sẽ mở. Cô lập chiều viết ở tầng hiển thị là phần FE làm được của nợ đã ghi ở
 * `docs/plans/S17-CHAT-UX2-BE-2.md` (bidi/homograph) — nó KHÔNG thay lớp kiểm ở server.
 */
function LinkAnchor({ url }: { url: string }): React.ReactElement {
  const isHttp = /^https?:\/\//i.test(url);
  if (!isHttp) {
    return (
      <p
        dir="ltr"
        className="break-all text-xs text-muted-foreground"
        data-testid="chat-link-not-http"
      >
        {url}
      </p>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      dir="ltr"
      className="flex items-start gap-1 text-xs text-primary underline underline-offset-2 hover:no-underline"
    >
      <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-all">{url}</span>
    </a>
  );
}
