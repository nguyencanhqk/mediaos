/**
 * S17-CHAT-UX2-FE-3 — dải thông báo phía trên ô nhập: phòng lưu trữ · đang trả lời · đang tải tệp ·
 * lỗi · quá dài (SPEC-15 §14).
 *
 * Thuần trình bày, KHÔNG state. Tách khỏi `MessageComposer` để file kia còn đọc được như một bản mô tả
 * hành vi (nháp · khoá idempotency · mention · tệp) thay vì một trang JSX dài.
 *
 * ⚠️ Ba thông điệp `role="alert"` giữ nguyên vai trò: spec S7 (§14 gửi lỗi) đứng trên `findByRole("alert")`.
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@mediaos/ui";
import type { StoredChatMessage } from "@/stores/chat.store";
import { MAX_MESSAGE_LENGTH } from "@/routes/chat/constants";

interface ComposerNoticesProps {
  isArchived: boolean;
  replyTo: StoredChatMessage | null;
  onCancelReply: () => void;
  /** Tên tệp đang tải lên, `null` = không có. */
  uploading: string | null;
  error: string | null;
  tooLong: boolean;
}

export function ComposerNotices({
  isArchived,
  replyTo,
  onCancelReply,
  uploading,
  error,
  tooLong,
}: ComposerNoticesProps): React.ReactElement {
  const { t } = useTranslation("chat");

  return (
    <>
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
    </>
  );
}
