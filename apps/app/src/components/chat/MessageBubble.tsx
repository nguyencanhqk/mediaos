/**
 * S7-CHAT-FE-2 · nâng lên **v2 hai phía** ở S17-CHAT-UX2-FE-2 (SPEC-15 §13.5 · §13.6 · §14 · CHAT-DEC-024).
 *
 * BẤT BIẾN RENDER (KHÔNG đổi ở v2): `body` là chuỗi NGƯỜI DÙNG GÕ. Nó chỉ được đi vào **text node** của
 * React (React tự escape). Trong file này KHÔNG có `dangerouslySetInnerHTML`, không markdown, không
 * parser HTML. Liên kết nhận diện ở tầng hiển thị qua `splitTextWithLinks` — hàm đó trả DỮ LIỆU (đoạn
 * chữ / đoạn link), và chỉ `http`/`https` mới thành `<a>`; `javascript:`/`data:` ở lại dạng chữ.
 *
 * ══ v2 — bố cục hai phía (CHAT-DEC-024) ══
 * Tin của tôi áp lề PHẢI trên nền `--bubble-mine`; tin người khác áp lề TRÁI trên nền `--surface-2`.
 * Hai màu là TOKEN phẳng trong `packages/ui/src/styles/theme.css`, không phải `primary/12%` lúc chạy —
 * xem docblock ở đó (màu trong suốt cho tỉ số tương phản khác nhau trên mỗi nền ⇒ không đo được).
 *
 * **Avatar chỉ ở bên TRÁI.** Tin của tôi không cần ảnh của chính tôi: vị trí đã nói ai gửi, và một cột
 * avatar thứ hai bên phải ăn 32px của mọi dòng để lặp lại một thông tin người dùng đã biết. Hệ quả cho
 * test: bài đếm `chat-sender-avatar` phải gieo người gửi KHÁC `myUserId` mới đo được luật gộp.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, Pin } from "lucide-react";
import { Avatar, Badge, cn } from "@mediaos/ui";
import type { ChatReactionEmoji } from "@mediaos/contracts";
import type { StoredChatAttachment, StoredChatMessage } from "@/stores/chat.store";
import { attachmentUrl } from "@/stores/chat.store";
import { formatClock, formatFileSize, splitTextWithLinks } from "./chat-format";
import { MessageActions } from "./MessageActions";
import { ReactionBar } from "./ReactionBar";
import { SeenByAvatars, type SeenByViewer } from "./SeenByAvatars";

export interface MessageBubbleActions {
  onReply: (message: StoredChatMessage) => void;
  onPin: (message: StoredChatMessage) => void;
  onUnpin: (message: StoredChatMessage) => void;
  onRecall: (message: StoredChatMessage) => void;
  /**
   * S8-CHAT-UX-FE-3 — bật/tắt một cảm xúc. `currentlyMine` do bong bóng đọc từ tổng hợp ĐANG HIỂN THỊ và
   * truyền lên, chứ caller KHÔNG tự tra lại state trong `mutationFn`: đọc state trong `mutationFn` là
   * đúng cái bẫy closure cũ của react-query v5 (memory `react-query-v5-stale-mutationfn-closure`).
   */
  onToggleReaction: (
    message: StoredChatMessage,
    emoji: ChatReactionEmoji,
    currentlyMine: boolean,
  ) => void;
  /**
   * S17 — chép nội dung tin (mục `⋯`). Việc ghi clipboard nằm ở `ConversationPanel` chứ không ở đây:
   * `navigator.clipboard` có thể bị từ chối (ngữ cảnh không bảo mật, người dùng chặn quyền) và nơi duy
   * nhất trong cây này biết cách BÁO lỗi cho người dùng là panel (`setActionError`). Nuốt lỗi tại chỗ
   * cho ra một nút bấm im lặng không làm gì.
   */
  onCopy: (message: StoredChatMessage) => void;
}

interface MessageBubbleProps {
  message: StoredChatMessage;
  isMine: boolean;
  /** Tin liền trước cùng người gửi & trong cửa sổ gộp ⇒ không lặp lại tên + avatar. */
  isGrouped: boolean;
  /**
   * S17 — tin CUỐI của cụm. Giờ hiện thường trực ở đây; các tin giữa cụm chỉ hiện giờ khi trỏ vào.
   * Một cụm 8 tin gửi trong 2 phút mà tin nào cũng đeo `HH:mm` là 8 lần lặp cùng một con số.
   */
  isLastOfGroup: boolean;
  /** Trích dẫn tin được trả lời — `undefined` = tin gốc nằm ngoài phần lịch sử đã tải. */
  replyTo: StoredChatMessage | undefined;
  canRecall: boolean;
  canPin: boolean;
  /**
   * S17 — những người đã đọc tới tin này (đã trừ chính mình), KÈM ảnh từ roster để vẽ dãy avatar.
   * Dẫn xuất từ `members[].lastReadSeq` (§13.2) — không có bảng riêng.
   */
  seenBy: readonly SeenByViewer[];
  /**
   * S8-CHAT-UX-FE-3 — URL ảnh người gửi, tra từ **ROSTER phòng** (CHAT-DEC-019), KHÔNG từ tin.
   * `null` = chưa có ảnh / roster chưa về ⇒ `<Avatar>` rơi về chữ cái đầu (hành vi cũ, không hồi quy).
   */
  senderAvatarUrl: string | null;
  /** Tên dự phòng từ roster khi `message.senderName` rỗng (tin cũ của người đã rời phòng). */
  senderNameFallback: string | null;
  /** Phòng đã lưu trữ ⇒ chỉ đọc: hiện tổng hợp cảm xúc nhưng không cho thả. */
  isArchived: boolean;
  actions: MessageBubbleActions;
}

/** Nội dung văn bản — đoạn chữ thành text node, đoạn link thành `<a>` đã chốt `rel`. */
function MessageBody({ body }: { body: string }): React.ReactElement {
  return (
    <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
      {splitTextWithLinks(body).map((segment, index) =>
        segment.kind === "link" ? (
          <a
            key={`${index}-${segment.value}`}
            href={segment.value}
            target="_blank"
            // `noopener noreferrer` chặn tab đích chạm `window.opener`; `nofollow` vì đây là nội dung
            // do người dùng nhập. Ba giá trị này đi cùng nhau, đừng bỏ bớt cái nào.
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2 hover:no-underline"
          >
            {segment.value}
          </a>
        ) : (
          // Text node — React escape. `<img src=x onerror=alert(1)>` hiện ra thành CHỮ, đúng chủ đích.
          <span key={`${index}-text`}>{segment.value}</span>
        ),
      )}
    </p>
  );
}

/** Một đính kèm. `attachmentUrl` trả BA trạng thái — mỗi trạng thái một giao diện KHÁC nhau (FE-1). */
function AttachmentTile({ attachment }: { attachment: StoredChatAttachment }): React.ReactElement {
  const { t } = useTranslation("chat");
  const [imageBroken, setImageBroken] = useState(false);
  const url = attachmentUrl(attachment);
  const isImage = "isImage" in attachment ? attachment.isImage : false;

  if (url === undefined) {
    // Tin đến từ WS: payload CỐ Ý không mang URL ký (quyết định ký là per-recipient). Chưa biết ≠ không
    // được phép — nói "đang lấy liên kết", KHÔNG nói "không tải được".
    return (
      <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{attachment.name}</span>
        <span className="shrink-0">· {t("attachment.resolving")}</span>
      </div>
    );
  }

  if (url === null) {
    // Server TỪ CHỐI ký (tệp còn link module khác / Infected / chưa Uploaded). Hiện trạng thái, KHÔNG
    // hiện nút tải chết.
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{attachment.name}</span>
        <span className="shrink-0">· {t("attachment.unavailable")}</span>
      </div>
    );
  }

  if (isImage && !imageBroken) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt={t("attachment.imageAlt", { name: attachment.name })}
          // v1 KHÔNG có biến thể thumbnail (repo chưa có pipeline resize) — `thumbnailUrl` là chính bản
          // gốc, co bằng CSS. Ghi ở `chatAttachmentSchema`.
          className="max-h-64 max-w-full rounded-md border border-border object-contain"
          loading="lazy"
          // URL ký TTL 300s: hết hạn giữa lúc đang xem thì ảnh vỡ. Rơi về khối tên + cỡ tệp bên dưới
          // (state, KHÔNG phải thao tác DOM tay) thay vì để lại một ô trống không giải thích được.
          onError={() => setImageBroken(true)}
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-xs hover:bg-accent"
    >
      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(attachment.sizeBytes)}</span>
      <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

export function MessageBubble({
  message,
  isMine,
  isGrouped,
  isLastOfGroup,
  replyTo,
  canRecall,
  canPin,
  seenBy,
  senderAvatarUrl,
  senderNameFallback,
  isArchived,
  actions,
}: MessageBubbleProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const isRecalled = message.recalledAt !== null;
  const isPinned = message.pinnedAt !== null;
  // Roster là nguồn DỰ PHÒNG, không phải nguồn chính: `senderName` đi cùng chính tin nên nó đúng với thời
  // điểm gửi, còn roster là ảnh chụp hiện tại (người đổi tên thì tin cũ vẫn nên mang tên lúc gửi).
  const senderName = message.senderName ?? senderNameFallback;
  const hasBody = message.body !== null && message.body.length > 0;
  const isLiked = (message.reactions ?? []).some((r) => r.emoji === "like" && r.mine);

  if (message.messageType === "system") {
    // Tin do SERVER sinh (thêm/bớt thành viên, đổi tên phòng) — canh giữa, không avatar, không tác vụ.
    return (
      <div className="flex justify-center py-1" data-testid="chat-system-message">
        <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
          {message.body ?? ""}
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        // `relative` là chỗ neo của thanh tác vụ nổi; `group` là công tắc hover của nó.
        "group relative flex gap-2 px-3",
        isGrouped ? "py-0.5" : "pt-3",
        isMine && "flex-row-reverse",
      )}
      data-testid="chat-message"
      data-mine={isMine ? "true" : "false"}
      data-message-id={message.id}
      data-room-seq={message.roomSeq}
    >
      {/*
       * Cột avatar CHỈ tồn tại ở phía TRÁI (tin người khác). Ô bọc `w-8` luôn được vẽ để mọi tin trong
       * một cụm thẳng lề, nhưng `<Avatar>` chỉ có ở tin ĐẦU cụm — `done_when #1` đo bằng cách ĐẾM node
       * đó, nên `data-testid` phải nằm trên `<Avatar>` chứ không trên ô bọc.
       */}
      {!isMine && (
        <div className="w-8 shrink-0">
          {!isGrouped && (
            <Avatar
              name={senderName}
              src={senderAvatarUrl}
              size="sm"
              data-testid="chat-sender-avatar"
            />
          )}
        </div>
      )}

      <div className={cn("flex min-w-0 flex-col", isMine ? "items-end" : "items-start")}>
        {/* Tên người gửi: chỉ ở tin đầu cụm và chỉ với tin NGƯỜI KHÁC — vị trí đã nói tin nào của tôi. */}
        {!isMine && !isGrouped && (
          <div className="mb-0.5 flex items-baseline gap-2 px-1">
            <span className="text-xs font-medium">{senderName ?? t("message.unknownSender")}</span>
            {isPinned && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Pin className="h-3 w-3" aria-hidden="true" />
                {t("message.pinnedBadge")}
              </Badge>
            )}
          </div>
        )}

        <div
          className={cn(
            // `max-w-[min(42rem,78%)]`: bong bóng không được kéo dài hết chiều ngang cột — mắt mất neo
            // khi phải quét cả màn để đọc một dòng, và vế "hai phía" biến mất vì mọi tin đều chạm cả
            // hai mép.
            "max-w-[min(42rem,78%)] min-w-0 rounded-2xl px-3 py-2",
            isMine
              ? "rounded-br-sm bg-bubble-mine text-foreground"
              : "rounded-bl-sm bg-surface-2 text-foreground",
          )}
          data-testid="chat-message-body-shell"
        >
          {/*
           * Nhãn "Đã ghim" bám vào hàng TÊN. Hàng đó chỉ tồn tại ở tin đầu cụm của NGƯỜI KHÁC, nên mọi
           * trường hợp còn lại (tin của tôi · tin giữa cụm) phải mang nhãn TRONG bong bóng — nếu không
           * thì ghim một tin gộp là ghim xong mà không thấy dấu vết nào.
           */}
          {(isMine || isGrouped) && isPinned && (
            <Badge variant="secondary" className="mb-1 gap-1 text-[10px]">
              <Pin className="h-3 w-3" aria-hidden="true" />
              {t("message.pinnedBadge")}
            </Badge>
          )}

          {replyTo !== undefined && !isRecalled && (
            <div className="mb-1 border-l-2 border-border pl-2 text-xs text-muted-foreground">
              <span className="font-medium">
                {replyTo.senderName ?? t("message.unknownSender")}
              </span>
              <span className="ml-1 line-clamp-1 break-words">
                {replyTo.recalledAt !== null ? t("message.recalled") : (replyTo.body ?? "")}
              </span>
            </div>
          )}
          {replyTo === undefined && message.replyToMessageId !== null && !isRecalled && (
            <div className="mb-1 border-l-2 border-dashed border-border pl-2 text-xs italic text-muted-foreground">
              {t("message.replyPreviewUnavailable")}
            </div>
          )}

          {isRecalled ? (
            // §14: "chữ xám, KHÔNG phải khoảng trắng" — tin biến mất không dấu vết đọc như mất dữ liệu.
            <p className="text-sm italic text-muted-foreground" data-testid="chat-message-recalled">
              {t("message.recalled")}
            </p>
          ) : (
            <>
              {hasBody && <MessageBody body={message.body as string} />}
              {message.attachments.length > 0 && (
                <div className="mt-1 flex flex-col gap-1">
                  {message.attachments.map((a) => (
                    <AttachmentTile key={a.id} attachment={a} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/*
         * Thanh cảm xúc — dưới bong bóng, TRÊN hàng giờ + đã-xem.
         *
         * Tin ĐÃ THU HỒI: không vẽ gì cả. Server trả `reactions: []` cho tin thu hồi (cùng lớp che với
         * `body`/`attachments`, SPEC-15 §13.6); vẽ ngược lại từ một bản cache cũ là hiện đúng thứ người
         * gửi vừa gỡ đi.
         */}
        {!isRecalled && (
          <ReactionBar
            reactions={message.reactions ?? []}
            readOnly={isArchived}
            onToggle={(emoji, currentlyMine) =>
              actions.onToggleReaction(message, emoji, currentlyMine)
            }
          />
        )}

        <div className={cn("flex items-center gap-2 px-1", isMine && "flex-row-reverse")}>
          <time
            dateTime={message.createdAt}
            data-testid="chat-message-clock"
            className={cn(
              "mt-0.5 text-[11px] text-muted-foreground tabular-nums transition-opacity",
              // Tin cuối cụm: giờ thường trực. Tin giữa cụm: chỉ khi trỏ vào — vẫn tra được, không lặp.
              isLastOfGroup ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            {formatClock(message.createdAt)}
          </time>

          {isMine && !isRecalled && <SeenByAvatars viewers={seenBy} />}
        </div>
      </div>

      {/* Tác vụ nổi. Mỗi nút gate RIÊNG — cổng thật vẫn ở server. Tin thu hồi không còn gì để làm. */}
      {!isRecalled && (
        <MessageActions
          isMine={isMine}
          isPinned={isPinned}
          isLiked={isLiked}
          canPin={canPin}
          canRecall={canRecall}
          isArchived={isArchived}
          hasBody={hasBody}
          onQuickLike={() => actions.onToggleReaction(message, "like", isLiked)}
          onReply={() => actions.onReply(message)}
          onTogglePin={() => (isPinned ? actions.onUnpin(message) : actions.onPin(message))}
          onRecall={() => actions.onRecall(message)}
          onCopy={() => actions.onCopy(message)}
        />
      )}
    </div>
  );
}
