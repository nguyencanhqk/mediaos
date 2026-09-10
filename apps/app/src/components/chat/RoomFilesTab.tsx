/**
 * S7-CHAT-FE-4 — danh sách "Tệp" của bảng thông tin phòng (SPEC-15 §9 CHAT-SCREEN-004 · §13.5 ·
 * CHAT-API-017). **v2 (S17-CHAT-UX2-FE-4):** là thân của accordion «Tệp», lọc `kind='file'` ở SERVER.
 *
 * Tách khỏi `RoomInfoPanel` vì panel đó đã lo nhiều nhóm trạng thái và khối này còn mang con trỏ phân
 * trang riêng — gộp vào là một file phình quá ngưỡng đọc được (CLAUDE.md §5). Luật con trỏ chuyển sang
 * `room-info/use-room-files.ts` vì lưới «Ảnh/Video» dùng CHUNG hợp đồng đó.
 *
 * ⚠️ `url`/`thumbnailUrl` **`.nullable()` có chủ đích** — server bỏ trắng khi `FilePolicyService` từ
 * chối, khi tệp `Infected`/chưa `Uploaded`, hoặc khi ký lỗi. Render `<img src={null}>` hay
 * `<a href={undefined}>` cho ra một dòng bấm-không-làm-gì; phải nói thẳng "không tải được tệp này".
 */
import { useTranslation } from "react-i18next";
import { Download, FileText, ImageOff } from "lucide-react";
import { Button, Skeleton } from "@mediaos/ui";
import type { ChatRoomFileDto, ChatRoomFileKind } from "@mediaos/contracts";
import { formatDateTimeShort, formatFileSize } from "./chat-format";
import { useRoomFiles } from "./room-info/use-room-files";

interface RoomFilesTabProps {
  roomId: string;
  /** Lọc loại tệp Ở SERVER (CHAT-API-017 `kind`). Vắng ⇒ mọi tệp — giữ hành vi cũ của S7. */
  kind?: ChatRoomFileKind;
  /** Nhảy tới tin chứa tệp — cùng đường ngữ cảnh với kết quả tìm kiếm và tin ghim. */
  onJumpToMessage: (messageId: string, roomSeq: number) => void;
}

export function RoomFilesTab({
  roomId,
  kind,
  onJumpToMessage,
}: RoomFilesTabProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const { files, isLoading, isLoadingMore, hasError, hasMore, loadMore, reload } = useRoomFiles(
    roomId,
    kind,
  );

  if (isLoading) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" data-testid="chat-files-loading">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (hasError && files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-4">
        <p className="text-xs text-muted-foreground">{t("info.files.loadError")}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          {t("conversation.retry")}
        </Button>
      </div>
    );
  }

  if (files.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">{t("info.files.empty")}</p>;
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {files.map((file) => (
          <li key={file.id} className="px-3 py-2" data-testid="chat-file-row">
            <FilePreview file={file} />
            <p className="mt-1 flex items-baseline gap-2 text-[11px] text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {file.senderName ?? t("message.unknownSender")}
              </span>
              <span className="shrink-0 tabular-nums">{formatDateTimeShort(file.createdAt)}</span>
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => onJumpToMessage(file.messageId, file.roomSeq)}
            >
              {t("info.files.jump")}
            </Button>
          </li>
        ))}
      </ul>

      {hasError && (
        <p className="px-3 py-2 text-xs text-destructive" role="alert">
          {t("info.files.loadMoreError")}
        </p>
      )}

      {hasMore && (
        <div className="flex justify-center py-2">
          <Button variant="ghost" size="sm" disabled={isLoadingMore} onClick={loadMore}>
            {isLoadingMore ? t("info.files.loadingMore") : t("info.files.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

/**
 * Một dòng tệp. Ảnh có xem trước; tệp khác hiện tên + cỡ.
 *
 * `isImage` do SERVER quyết (`mimeType` bắt đầu `image/`) — client KHÔNG tự đoán theo phần mở rộng: một
 * tệp `.jpg` thật ra là HTML sẽ được đoán nhầm thành ảnh và mở trong tab mới bằng chính origin của app.
 */
function FilePreview({ file }: { file: ChatRoomFileDto }): React.ReactElement {
  const { t } = useTranslation("chat");

  if (file.url === null) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground"
        data-testid="chat-file-unavailable"
      >
        <ImageOff className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <span className="shrink-0">{t("attachment.unavailable")}</span>
      </div>
    );
  }

  if (file.isImage && file.thumbnailUrl !== null) {
    return (
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer noopener"
        className="block overflow-hidden rounded-md border border-border"
      >
        <img
          src={file.thumbnailUrl}
          alt={file.name}
          loading="lazy"
          className="max-h-40 w-full object-cover"
        />
      </a>
    );
  }

  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer noopener"
      download={file.name}
      className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent"
    >
      <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="shrink-0 text-muted-foreground">{formatFileSize(file.sizeBytes)}</span>
      <Download className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}
