/**
 * S7-CHAT-FE-2 — một bong bóng tin (SPEC-15 §13.5 · §13.6 · §14).
 *
 * BẤT BIẾN RENDER: `body` là chuỗi NGƯỜI DÙNG GÕ. Nó chỉ được đi vào **text node** của React (React tự
 * escape). Trong file này KHÔNG có `dangerouslySetInnerHTML`, không markdown, không parser HTML. Liên
 * kết nhận diện ở tầng hiển thị qua `splitTextWithLinks` — hàm đó trả DỮ LIỆU (đoạn chữ / đoạn link),
 * và chỉ `http`/`https` mới thành `<a>`; `javascript:`/`data:` ở lại dạng chữ.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CornerUpLeft, Download, FileText, Pin, Undo2 } from "lucide-react";
import { Avatar, Badge, Button, cn } from "@mediaos/ui";
import type { StoredChatAttachment, StoredChatMessage } from "@/stores/chat.store";
import { attachmentUrl } from "@/stores/chat.store";
import { formatClock, formatFileSize, splitTextWithLinks } from "./chat-format";

export interface MessageBubbleActions {
  onReply: (message: StoredChatMessage) => void;
  onPin: (message: StoredChatMessage) => void;
  onUnpin: (message: StoredChatMessage) => void;
  onRecall: (message: StoredChatMessage) => void;
}

interface MessageBubbleProps {
  message: StoredChatMessage;
  isMine: boolean;
  /** Tin liền trước cùng người gửi & cùng phút ⇒ gộp, không lặp lại tên + avatar. */
  isGrouped: boolean;
  /** Trích dẫn tin được trả lời — `undefined` = tin gốc nằm ngoài phần lịch sử đã tải. */
  replyTo: StoredChatMessage | undefined;
  canRecall: boolean;
  canPin: boolean;
  /** Tên những người đã đọc tới tin này (đã trừ chính mình) — dẫn xuất từ `members[].lastReadSeq` (§13.2). */
  seenBy: readonly string[];
  actions: MessageBubbleActions;
}

/** Nội dung văn bản — đoạn chữ thành text node, đoạn link thành `<a>` đã chốt `rel`. */
function MessageBody({ body }: { body: string }): React.ReactElement {
  return (
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
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
  replyTo,
  canRecall,
  canPin,
  seenBy,
  actions,
}: MessageBubbleProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const isRecalled = message.recalledAt !== null;
  const isPinned = message.pinnedAt !== null;

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
      className={cn("group flex gap-2 px-3", isGrouped ? "py-0.5" : "pt-3")}
      data-testid="chat-message"
      data-message-id={message.id}
      data-room-seq={message.roomSeq}
    >
      <div className="w-8 shrink-0">
        {!isGrouped && <Avatar name={message.senderName} size="sm" />}
      </div>

      <div className="min-w-0 flex-1">
        {!isGrouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">
              {message.senderName ?? t("message.unknownSender")}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatClock(message.createdAt)}
            </span>
            {isPinned && (
              <Badge variant="secondary" className="gap-1 text-[10px]">
                <Pin className="h-3 w-3" aria-hidden="true" />
                {t("message.pinnedBadge")}
              </Badge>
            )}
          </div>
        )}

        {replyTo !== undefined && !isRecalled && (
          <div className="mt-1 border-l-2 border-border pl-2 text-xs text-muted-foreground">
            <span className="font-medium">{replyTo.senderName ?? t("message.unknownSender")}</span>
            <span className="ml-1 line-clamp-1 break-words">
              {replyTo.recalledAt !== null ? t("message.recalled") : (replyTo.body ?? "")}
            </span>
          </div>
        )}
        {replyTo === undefined && message.replyToMessageId !== null && !isRecalled && (
          <div className="mt-1 border-l-2 border-dashed border-border pl-2 text-xs italic text-muted-foreground">
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
            {message.body !== null && message.body.length > 0 && (
              <MessageBody body={message.body} />
            )}
            {message.attachments.length > 0 && (
              <div className="mt-1 flex flex-col gap-1">
                {message.attachments.map((a) => (
                  <AttachmentTile key={a.id} attachment={a} />
                ))}
              </div>
            )}
          </>
        )}

        {seenBy.length > 0 && isMine && !isRecalled && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {seenBy.length <= 3
              ? t("message.seenBy", { names: seenBy.join(", ") })
              : t("message.seenByCount", { count: seenBy.length })}
          </p>
        )}
      </div>

      {/* Tác vụ: hiện khi hover/focus. Mỗi nút gate RIÊNG — cổng thật vẫn ở server. */}
      {!isRecalled && (
        <div className="flex shrink-0 items-start gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            aria-label={t("message.reply")}
            onClick={() => actions.onReply(message)}
          >
            <CornerUpLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          {canPin && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={isPinned ? t("message.unpin") : t("message.pin")}
              onClick={() => (isPinned ? actions.onUnpin(message) : actions.onPin(message))}
            >
              <Pin className={cn("h-3.5 w-3.5", isPinned && "fill-current")} aria-hidden="true" />
            </Button>
          )}
          {canRecall && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label={t("message.recall")}
              onClick={() => actions.onRecall(message)}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
