/**
 * S7-CHAT-FE-4 — CHAT-SCREEN-005: tìm kiếm tin nhắn (SPEC-15 §9 · §13.7 · §14).
 *
 * Chiếm chỗ cột TRÁI của trang `/chat` thay vì mở cột thứ tư: `ChatPage` đã cố ý không bọc
 * `ModuleWorkspaceLayout` để khỏi có cột thừa, thêm một cột nữa ở đây là đi ngược lại chính lý do đó.
 * Đổi lại cột nới rộng khi ở chế độ tìm kiếm — một dòng kết quả phải chứa tên phòng + người gửi + trích.
 *
 * ⚠️ **Không tô sáng từ khoá trong đoạn trích.** Server khớp bằng `websearch_to_tsquery('simple',
 * f_unaccent(q))` và KHÔNG trả `ts_headline`; tự tô ở client buộc phải dựng lại luật bỏ dấu + tách từ ở
 * FE, tức bản luật THỨ HAI sẽ tô lệch với thứ server thật sự đã khớp ("bao cao" tô 0 chỗ trong "báo
 * cáo"). Trích đoạn để nguyên; thứ được làm nổi là TIN ĐÍCH sau khi nhảy tới.
 */
import { useTranslation } from "react-i18next";
import { ArrowLeft, MessageSquareText, Paperclip, Search } from "lucide-react";
import { Button, Input, Skeleton, cn } from "@mediaos/ui";
import type { ChatSearchResultDto } from "@mediaos/contracts";
import { SEARCH_MIN_CHARS } from "@/routes/chat/constants";
import { formatDateTimeShort } from "./chat-format";
import { useMessageSearch } from "./use-message-search";

export interface MessageSearchScope {
  /** `null` = tìm trong TẤT CẢ phòng của tôi; ngược lại bó theo đúng phòng này. */
  roomId: string | null;
  /** Nhãn phòng đang mở — chỉ để hiện trên nút chọn phạm vi. */
  roomLabel: string | null;
}

/**
 * Nút phạm vi gửi lên Ý ĐỊNH (`"all"`/`"room"`), KHÔNG gửi `scope.roomId` hiện tại.
 *
 * Gửi giá trị hiện tại là một vòng lặp chết: đang ở phạm vi "tất cả" thì `scope.roomId` là `null`, nên
 * bấm "Trong phòng này" gửi lại `null` và không đổi gì cả — nút bấm mãi không có tác dụng.
 */
export type MessageSearchScopeChoice = "all" | "room";

interface MessageSearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  scope: MessageSearchScope;
  onScopeChange: (choice: MessageSearchScopeChoice) => void;
  /** Bấm một kết quả ⇒ mở phòng + nạp ngữ cảnh + làm nổi tin (điều phối ở `ChatPage`). */
  onOpenResult: (result: ChatSearchResultDto) => void;
  onClose: () => void;
  /** Tin đang được làm nổi ở cột giữa — đánh dấu lại trong danh sách để không mất dấu sau khi cuộn. */
  activeMessageId: string | null;
}

export function MessageSearchPanel({
  query,
  onQueryChange,
  scope,
  onScopeChange,
  onOpenResult,
  onClose,
  activeMessageId,
}: MessageSearchPanelProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const search = useMessageSearch(query, scope.roomId);

  return (
    <aside
      className="flex h-full w-96 shrink-0 flex-col border-r border-border"
      aria-label={t("search.heading")}
      data-testid="chat-search-panel"
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={t("search.backToRooms")}
          onClick={onClose}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
        <h2 className="flex-1 text-sm font-semibold">{t("search.heading")}</h2>
      </div>

      <div className="space-y-2 border-b border-border px-3 py-2">
        <div className="relative">
          <Search
            className="absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            className="h-8 pl-7 text-sm"
            data-testid="chat-search-input"
          />
        </div>

        {/* Phạm vi: SPEC-15 §9 CHAT-SCREEN-005 — "tất cả phòng của tôi, hoặc trong 1 phòng". */}
        <div className="flex gap-1" role="group" aria-label={t("search.scopeLabel")}>
          <ScopeButton
            isActive={scope.roomId === null}
            onClick={() => onScopeChange("all")}
            label={t("search.scopeAll")}
          />
          {/* Không có phòng nào đang mở ⇒ KHÔNG vẽ nút này: "trong phòng này" mà không có "phòng này"
              thì hoặc là nút chết, hoặc là âm thầm tìm toàn bộ — cả hai đều nói dối. */}
          {scope.roomLabel !== null && (
            <ScopeButton
              isActive={scope.roomId !== null}
              onClick={() => onScopeChange("room")}
              label={t("search.scopeRoom", { room: scope.roomLabel })}
            />
          )}
        </div>

        <p className="text-[11px] text-muted-foreground">{t("search.accentHint")}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {search.isTooShort ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground" role="status">
            {t("search.tooShort", { count: SEARCH_MIN_CHARS })}
          </p>
        ) : search.isLoading ? (
          <div className="space-y-2 p-3" aria-busy="true" data-testid="chat-search-loading">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : search.hasError ? (
          <div className="flex flex-col items-center gap-2 p-6">
            <p className="text-xs text-muted-foreground">{t("search.loadError")}</p>
            <Button variant="outline" size="sm" onClick={search.retry}>
              {t("conversation.retry")}
            </Button>
          </div>
        ) : search.appliedQuery.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{t("search.idle")}</p>
        ) : search.results.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground" role="status">
            {t("search.empty", { query: search.appliedQuery })}
          </p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {search.results.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => onOpenResult(result)}
                    data-testid="chat-search-result"
                    data-message-id={result.id}
                    aria-current={result.id === activeMessageId ? "true" : undefined}
                    className={cn(
                      "flex w-full flex-col gap-0.5 px-3 py-2 text-left hover:bg-accent",
                      result.id === activeMessageId && "bg-accent",
                    )}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {result.roomName ?? t(`rooms.types.${result.roomType}`)}
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                        {formatDateTimeShort(result.createdAt)}
                      </span>
                    </div>
                    {/* Text node — React escape; `body` là chữ người dùng gõ, KHÔNG render HTML thô. */}
                    <p className="line-clamp-2 break-words text-sm">{result.body}</p>
                    <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="truncate">
                        {result.senderName ?? t("message.unknownSender")}
                      </span>
                      {result.attachmentCount > 0 && (
                        <span className="flex shrink-0 items-center gap-0.5">
                          <Paperclip className="h-3 w-3" aria-hidden="true" />
                          {t("search.attachmentCount", { count: result.attachmentCount })}
                        </span>
                      )}
                    </p>
                  </button>
                </li>
              ))}
            </ul>

            {search.hasMore && (
              <div className="flex justify-center py-3">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={search.isLoadingMore}
                  onClick={search.loadMore}
                >
                  {search.isLoadingMore ? t("search.loadingMore") : t("search.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <p className="flex items-center gap-1.5 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <MessageSquareText className="h-3 w-3 shrink-0" aria-hidden="true" />
        {t("search.membershipNote")}
      </p>
    </aside>
  );
}

function ScopeButton({
  isActive,
  onClick,
  label,
}: {
  isActive: boolean;
  onClick: () => void;
  label: string;
}): React.ReactElement {
  return (
    <Button
      type="button"
      size="sm"
      variant={isActive ? "secondary" : "ghost"}
      aria-pressed={isActive}
      className="h-7 min-w-0 flex-1 justify-center text-xs"
      onClick={onClick}
    >
      <span className="truncate">{label}</span>
    </Button>
  );
}
