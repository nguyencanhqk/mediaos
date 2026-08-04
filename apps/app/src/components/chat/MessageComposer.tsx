/**
 * S7-CHAT-FE-2 — ô soạn tin (SPEC-15 §14: đang gửi / gửi lỗi / phòng lưu trữ / không có quyền).
 *
 * HAI BẤT BIẾN của file này:
 *
 * 1. `clientMessageId` sinh **MỘT LẦN** khi bắt đầu soạn (nháp từ rỗng → có chữ hoặc có tệp) và giữ
 *    nguyên qua mọi lần bấm "Gửi lại". Sinh mới trong hàm gửi = khoá ngẫu nhiên mỗi lần = **không chống
 *    trùng gì cả** (memory `idempotency-key-must-be-content-derived`).
 * 2. Gửi lỗi **KHÔNG được xoá chữ người dùng đã gõ** (§14). Nháp chỉ bị dọn khi server đã nhận.
 */
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Paperclip, SendHorizontal, X } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { Button, cn } from "@mediaos/ui";
import type { StoredChatMessage } from "@/stores/chat.store";
import { createClientMessageId } from "@/stores/chat.store";
import {
  CHAT_PAIRS,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_LENGTH,
} from "@/routes/chat/constants";
import { formatFileSize } from "./chat-format";
import { uploadChatAttachment, type ChatUploadResult } from "./chat-upload";

export interface ComposerSubmitPayload {
  clientMessageId: string;
  body: string;
  fileIds: string[];
  replyToMessageId?: string;
}

interface MessageComposerProps {
  /** Phòng đang mở — đổi phòng ⇒ nháp reset (nháp thuộc về phòng, không theo người dùng). */
  roomId: string;
  isArchived: boolean;
  replyTo: StoredChatMessage | null;
  onCancelReply: () => void;
  /** Trả `true` khi server đã nhận; `false` ⇒ GIỮ NGUYÊN nháp để bấm "Gửi lại". */
  onSubmit: (payload: ComposerSubmitPayload) => Promise<boolean>;
}

export function MessageComposer({
  roomId,
  isArchived,
  replyTo,
  onCancelReply,
  onSubmit,
}: MessageComposerProps): React.ReactElement {
  const { t } = useTranslation("chat");
  /**
   * MỘT cổng quyền duy nhất cho cả gõ chữ lẫn đính kèm — `S7-CHAT-BE-8`.
   *
   * Trước BE-8, nút đính kèm phải hỏi RIÊNG cặp FOUNDATION `upload:foundation-file` vì đường upload đi
   * qua `/foundation/files/*`; cặp đó chỉ có ở company-admin nên nút biến mất với gần hết công ty. BE-8
   * chuyển đường upload sang `/chat/files/*` gate `send:chat-message` ⇒ ai gửi được tin thì tải được
   * tệp, và hỏi thêm một cặp thứ hai ở FE giờ chỉ ẩn nút của người server sẵn sàng phục vụ.
   */
  const canSend = useCan(CHAT_PAIRS.SEND_MESSAGE.action, CHAT_PAIRS.SEND_MESSAGE.resourceType);

  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<ChatUploadResult[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Khoá idempotency của NHÁP hiện tại. `null` = chưa bắt đầu soạn.
   *
   * Ở ref chứ không ở state: nó không được kích hoạt render, và quan trọng hơn — nó phải sống sót qua
   * mọi lần re-render giữa lúc `onSubmit` đang bay. Cấp lại khoá giữa chừng là mất tác dụng dedupe.
   */
  const clientMessageIdRef = useRef<string | null>(null);
  const ensureClientMessageId = (): string => {
    clientMessageIdRef.current ??= createClientMessageId();
    return clientMessageIdRef.current;
  };

  const disabled = isArchived || !canSend;
  const hasContent = draft.trim().length > 0 || attachments.length > 0;
  const tooLong = draft.length > MAX_MESSAGE_LENGTH;

  const handlePickFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setError(null);
      const picked = Array.from(files);
      if (attachments.length + picked.length > MAX_ATTACHMENTS_PER_MESSAGE) {
        setError(t("composer.tooManyFiles", { count: MAX_ATTACHMENTS_PER_MESSAGE }));
        return;
      }
      ensureClientMessageId(); // soạn đã bắt đầu ngay khi có tệp, dù chưa gõ chữ nào
      for (const file of picked) {
        setUploading(file.name);
        try {
          const uploaded = await uploadChatAttachment(file);
          setAttachments((prev) => [...prev, uploaded]);
        } catch (err: unknown) {
          // Dừng ở tệp lỗi, GIỮ những tệp đã lên. Bỏ hết là bắt người dùng làm lại từ đầu vì một tệp hỏng.
          setError(t("composer.uploadFailed", { name: file.name }));
          console.error("[chat] tải tệp đính kèm thất bại:", err);
          break;
        } finally {
          setUploading(null);
        }
      }
    },
    [attachments.length, t],
  );

  const handleSubmit = useCallback(async () => {
    if (disabled || !hasContent || tooLong || isSending) return;
    const clientMessageId = ensureClientMessageId();
    setSending(true);
    setError(null);
    const ok = await onSubmit({
      clientMessageId,
      body: draft,
      fileIds: attachments.map((a) => a.fileId),
      ...(replyTo ? { replyToMessageId: replyTo.id } : {}),
    });
    setSending(false);

    if (!ok) {
      // §14: KHÔNG mất nội dung đang soạn. Nháp + tệp + khoá idempotency đều giữ nguyên; bong bóng
      // "gửi lỗi" ở danh sách tin là nơi bấm "Gửi lại".
      setError(t("composer.sendFailed"));
      return;
    }
    setDraft("");
    setAttachments([]);
    clientMessageIdRef.current = null; // tin kế tiếp là tin KHÁC ⇒ khoá mới
    onCancelReply();
  }, [
    attachments,
    disabled,
    draft,
    hasContent,
    isSending,
    onCancelReply,
    onSubmit,
    replyTo,
    t,
    tooLong,
  ]);

  const placeholder = isArchived
    ? t("composer.placeholderArchived")
    : !canSend
      ? t("composer.placeholderNoPermission")
      : t("composer.placeholder");

  return (
    <div className="border-t border-border bg-background p-3" data-testid="chat-composer">
      {isArchived && (
        <p className="mb-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t("composer.archivedNotice")}
        </p>
      )}

      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-primary bg-muted/50 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {t("message.replyingTo", { name: replyTo.senderName ?? "" })}
            </p>
            <p className="line-clamp-1 break-words text-muted-foreground">{replyTo.body ?? ""}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0"
            aria-label={t("composer.cancelReply")}
            onClick={onCancelReply}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      )}

      {attachments.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {attachments.map((a) => (
            <li
              key={a.fileId}
              className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs"
            >
              <span className="max-w-[12rem] truncate">{a.name}</span>
              <span className="text-muted-foreground">{formatFileSize(a.sizeBytes)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-5 w-5 p-0"
                aria-label={t("composer.removeAttachment", { name: a.name })}
                onClick={() => setAttachments((prev) => prev.filter((x) => x.fileId !== a.fileId))}
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {uploading !== null && (
        <p className="mb-2 text-xs text-muted-foreground">
          {t("composer.uploading", { name: uploading, percent: 0 })}
        </p>
      )}
      {error !== null && (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      {tooLong && (
        <p className="mb-2 text-xs text-destructive" role="alert">
          {t("composer.tooLong", { count: MAX_MESSAGE_LENGTH })}
        </p>
      )}

      <div className="flex items-end gap-2">
        {/* Nút đính kèm CHỈ hiện khi thực sự upload được — hiện nút rồi để server 403 là "UI hứa,
            backend không đọc". Từ `S7-CHAT-BE-8`, điều kiện đó CHÍNH LÀ `!disabled` (phòng chưa lưu trữ
            + có `send:chat-message`), vì `/chat/files/*` gate đúng cặp ấy. */}
        {!disabled && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              data-testid="chat-attach-input"
              onChange={(e) => {
                void handlePickFiles(e.target.files);
                e.target.value = ""; // chọn LẠI cùng tệp phải bắn `change` lần nữa
              }}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("composer.attachAria")}
              disabled={uploading !== null}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}

        <textarea
          key={roomId}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.length > 0) ensureClientMessageId();
          }}
          onKeyDown={(e) => {
            // Enter gửi, Shift+Enter xuống dòng — quy ước quen thuộc của mọi công cụ chat nội bộ.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          disabled={disabled}
          placeholder={placeholder}
          rows={1}
          aria-label={t("composer.placeholder")}
          className={cn(
            "max-h-32 min-h-10 flex-1 resize-y rounded-md border border-input bg-background px-3 py-2 text-sm",
            "placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-60",
          )}
        />

        <Button
          size="icon-sm"
          aria-label={t("composer.sendAria")}
          disabled={disabled || !hasContent || tooLong || isSending}
          onClick={() => void handleSubmit()}
        >
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
