/**
 * S17-CHAT-UX2-FE-4 — lưới «Ảnh / Video» của bảng thông tin phòng v2 (SPEC-15 §9 SCREEN-004 · DEC-025).
 *
 * Cùng hợp đồng phân trang với danh sách «Tệp» (`use-room-files.ts`), khác mỗi cách trình bày: lưới 3
 * cột thay vì danh sách dọc. Lọc `kind='image'` đi xuống **SERVER** — lọc `isImage` ở client trên một
 * trang 30 tệp cho ra lưới "2 ảnh" rồi im lặng trong khi phòng còn hàng trăm ảnh ở trang sau
 * (memory `ui-promises-backend-never-reads`).
 *
 * ⚠️ `url === null` là TRẠNG THÁI HỢP LỆ, không phải lỗi tải: server bỏ trắng khi `FilePolicyService`
 * từ chối, khi tệp `Infected`/chưa `Uploaded`, hoặc khi ký lỗi. Ô đó nói thẳng "không tải được" —
 * `<img src={null}>` cho ra một ô vỡ không ai giải thích được.
 *
 * ⚠️ Component này chỉ được mount khi accordion ĐANG MỞ (`AccordionContent` unmount thân khi đóng):
 * mỗi lời gọi `/files` là một lô URL ký hạn ngắn **và** một lô hàng `file_access_logs` — nạp sẵn ở nền
 * là ghi nhật ký truy cập cho thứ người dùng chưa xem (luật của S7-CHAT-FE-4).
 */
import { useTranslation } from "react-i18next";
import { ImageOff } from "lucide-react";
import { Button, Skeleton } from "@mediaos/ui";
import type { ChatRoomFileDto } from "@mediaos/contracts";
import { useRoomFiles } from "./use-room-files";

interface RoomMediaGridProps {
  roomId: string;
}

export function RoomMediaGrid({ roomId }: RoomMediaGridProps): React.ReactElement {
  const { t } = useTranslation("chat");
  const { files, isLoading, isLoadingMore, hasError, hasMore, loadMore, reload } = useRoomFiles(
    roomId,
    "image",
  );

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-3 gap-1.5 p-3"
        aria-busy="true"
        data-testid="chat-media-loading"
      >
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="aspect-square w-full" />
        <Skeleton className="aspect-square w-full" />
      </div>
    );
  }

  if (hasError && files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 p-4">
        <p className="text-xs text-muted-foreground">{t("info.media.loadError")}</p>
        <Button variant="outline" size="sm" onClick={reload}>
          {t("conversation.retry")}
        </Button>
      </div>
    );
  }

  if (files.length === 0) {
    return <p className="p-3 text-xs text-muted-foreground">{t("info.media.empty")}</p>;
  }

  return (
    <>
      <ul className="grid grid-cols-3 gap-1.5 px-3 pb-1">
        {files.map((file) => (
          <li key={file.id} data-testid="chat-media-cell">
            <MediaTile file={file} />
          </li>
        ))}
      </ul>

      {hasError && (
        <p className="px-3 py-2 text-xs text-destructive" role="alert">
          {t("info.media.loadMoreError")}
        </p>
      )}

      {hasMore && (
        <div className="flex justify-center py-2">
          <Button variant="ghost" size="sm" disabled={isLoadingMore} onClick={loadMore}>
            {isLoadingMore ? t("info.media.loadingMore") : t("info.media.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

/** Một ô ảnh. `thumbnailUrl` mới là bản NHẸ; thiếu nó thì dùng `url` gốc chứ không bỏ trống ô. */
function MediaTile({ file }: { file: ChatRoomFileDto }): React.ReactElement {
  const { t } = useTranslation("chat");
  const preview = file.thumbnailUrl ?? file.url;

  if (file.url === null || preview === null) {
    return (
      <div
        className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border p-1 text-center text-[10px] text-muted-foreground"
        data-testid="chat-media-unavailable"
        title={file.name}
      >
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        <span className="line-clamp-2 break-all">{t("attachment.unavailable")}</span>
      </div>
    );
  }

  return (
    <a
      href={file.url}
      target="_blank"
      rel="noreferrer noopener"
      className="block overflow-hidden rounded-md border border-border hover:opacity-90"
      title={file.name}
    >
      <img
        src={preview}
        alt={file.name}
        loading="lazy"
        className="aspect-square w-full object-cover"
      />
    </a>
  );
}
