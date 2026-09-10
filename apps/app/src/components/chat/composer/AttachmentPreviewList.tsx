/**
 * S17-CHAT-UX2-FE-3 — hàng tệp ĐANG CHỜ GỬI của ô soạn (SPEC-15 §22c CHAT-DEC-027).
 *
 * Ảnh hiện **thumbnail xem trước**, tệp khác giữ nguyên tile "tên + cỡ" như bản S7 — cố ý không đổi
 * hình dạng của nhánh không-ảnh, để mắt người dùng nhận ra ngay thứ mình vừa đính kèm là gì.
 *
 * ⚠️ `previewUrl` là blob URL do `MessageComposer` tạo và **cũng do nó thu hồi**. Component này KHÔNG
 * gọi `createObjectURL`/`revokeObjectURL`: tạo URL trong render thì mỗi lần re-render đẻ một URL mới
 * và không ai thu hồi cái cũ — rò bộ nhớ mà jsdom lẫn trình duyệt đều không kêu một tiếng.
 */
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@mediaos/ui";
import { formatFileSize } from "../chat-format";
import type { ChatUploadResult } from "../chat-upload";

export interface PendingAttachment extends ChatUploadResult {
  /** Blob URL xem trước — `null` cho tệp không phải ảnh. */
  previewUrl: string | null;
}

interface AttachmentPreviewListProps {
  items: readonly PendingAttachment[];
  onRemove: (fileId: string) => void;
}

export function AttachmentPreviewList({
  items,
  onRemove,
}: AttachmentPreviewListProps): React.ReactElement {
  const { t } = useTranslation("chat");

  return (
    <ul className="mb-2 flex flex-wrap gap-2" data-testid="chat-composer-attachments">
      {items.map((a) =>
        a.previewUrl !== null ? (
          <li
            key={a.fileId}
            className="relative h-16 w-16 overflow-hidden rounded-md border border-border"
          >
            <img
              src={a.previewUrl}
              alt={t("composer.previewAlt", { name: a.name })}
              className="h-full w-full object-cover"
            />
            <Button
              variant="ghost"
              size="sm"
              className="absolute top-0.5 right-0.5 h-5 w-5 rounded-full bg-background/80 p-0"
              aria-label={t("composer.removeAttachment", { name: a.name })}
              onClick={() => onRemove(a.fileId)}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          </li>
        ) : (
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
              onClick={() => onRemove(a.fileId)}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </Button>
          </li>
        ),
      )}
    </ul>
  );
}
