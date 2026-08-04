/**
 * S7-CHAT-FE-4 — tab "Tệp" của bảng thông tin phòng (SPEC-15 §9 CHAT-SCREEN-004 · §13.5 · CHAT-API-017).
 *
 * Tách khỏi `RoomInfoPanel` vì panel đó đã lo 3 nhóm trạng thái (sửa phòng · thành viên · ghim) và tab
 * này còn mang con trỏ phân trang riêng — gộp vào là một file phình quá ngưỡng đọc được (CLAUDE.md §5).
 *
 * ⚠️ HAI điều dễ làm sai, cả hai đều IM LẶNG:
 *   1. `url`/`thumbnailUrl` **`.nullable()` có chủ đích** — server bỏ trắng khi `FilePolicyService` từ
 *      chối, khi tệp `Infected`/chưa `Uploaded`, hoặc khi ký lỗi. Render `<img src={null}>` hay `<a
 *      href={undefined}>` cho ra một dòng bấm-không-làm-gì; phải nói thẳng "không tải được tệp này".
 *   2. "Còn trang sau" KHÔNG suy được từ `rows.length === limit`: server gọi `trimToMessageBoundary` để
 *      không chẻ đôi nhóm tệp của một tin, nên trang có thể ngắn hơn `limit` dù còn dữ liệu. Chỉ một
 *      trang RỖNG mới chứng minh đã hết (xem docblock `chatApi.listRoomFiles`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, ImageOff } from "lucide-react";
import { chatApi } from "@mediaos/web-core";
import { Button, Skeleton } from "@mediaos/ui";
import type { ChatRoomFileDto } from "@mediaos/contracts";
import { ROOM_FILES_PAGE_SIZE } from "@/routes/chat/constants";
import { formatDateTimeShort, formatFileSize } from "./chat-format";

interface RoomFilesTabProps {
  roomId: string;
  /** Nhảy tới tin chứa tệp — cùng đường ngữ cảnh với kết quả tìm kiếm và tin ghim. */
  onJumpToMessage: (messageId: string, roomSeq: number) => void;
}

export function RoomFilesTab({ roomId, onJumpToMessage }: RoomFilesTabProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const [files, setFiles] = useState<readonly ChatRoomFileDto[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasError, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  /** Phòng mà lần nạp đang bay THUỘC VỀ — panel keyed theo phòng, nhưng response cũ vẫn có thể về sau. */
  const activeRoomRef = useRef(roomId);

  const load = useCallback(
    async (beforeSeq: number | undefined) => {
      activeRoomRef.current = roomId;
      if (beforeSeq === undefined) setLoading(true);
      else setLoadingMore(true);
      setError(false);
      try {
        const page = await chatApi.listRoomFiles(roomId, {
          limit: ROOM_FILES_PAGE_SIZE,
          ...(beforeSeq !== undefined ? { beforeSeq } : {}),
        });
        if (activeRoomRef.current !== roomId) return;
        setFiles((prev) => (beforeSeq === undefined ? page : [...prev, ...page]));
        setHasMore(page.length > 0);
      } catch (err: unknown) {
        if (activeRoomRef.current !== roomId) return;
        setError(true);
        console.error(`[chat] không tải được danh sách tệp của phòng ${roomId}:`, err);
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
    void load(undefined);
  }, [load]);

  const loadMore = useCallback(() => {
    if (files.length === 0) return;
    // Con trỏ = `roomSeq` NHỎ NHẤT của trang hiện tại (`beforeSeq` LOẠI TRỪ, server sắp giảm dần).
    const oldest = files.reduce((min, f) => Math.min(min, f.roomSeq), files[0].roomSeq);
    void load(oldest);
  }, [files, load]);

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
        <Button variant="outline" size="sm" onClick={() => void load(undefined)}>
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
