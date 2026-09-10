/**
 * S17-CHAT-UX2-FE-4 — phân trang tệp phòng (CHAT-API-017), dùng chung cho HAI cách trình bày.
 *
 * Bảng thông tin phòng v2 (CHAT-DEC-025) tách «Ảnh/Video» (lưới, `kind=image`) khỏi «Tệp» (danh sách,
 * `kind=file`). Hai khối, cùng MỘT hợp đồng phân trang — nên luật con trỏ nằm ở đây, không chép hai bản.
 *
 * ⚠️ HAI điều dễ làm sai, cả hai đều IM LẶNG (chuyển nguyên từ `RoomFilesTab` của S7-CHAT-FE-4):
 *   1. **"Còn trang sau" KHÔNG suy được từ `rows.length === limit`** — server gọi `trimToMessageBoundary`
 *      để không chẻ đôi nhóm tệp của một tin, nên trang có thể ngắn hơn `limit` dù còn dữ liệu (và dài
 *      hơn `limit` khi một tin mang nhiều tệp hơn `limit`). Chỉ một trang RỖNG mới chứng minh đã hết.
 *   2. **Lọc `kind` phải ở SERVER.** Lọc `isImage` ở client trên một trang 30 tệp cho ra lưới "2 ảnh"
 *      rồi "hết" trong khi phòng còn hàng trăm ảnh ở trang sau (memory `ui-promises-backend-never-reads`).
 *
 * ⚠️ Mỗi lời gọi là một lô URL ký hạn ngắn **và** một lô hàng `file_access_logs`. Hook này chỉ được
 * mount khi khối chứa nó ĐANG MỞ — xem `AccordionContent` (đóng ⇒ unmount) và ca test tương ứng.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { chatApi } from "@mediaos/web-core";
import type { ChatRoomFileDto, ChatRoomFileKind } from "@mediaos/contracts";
import { ROOM_FILES_PAGE_SIZE } from "@/routes/chat/constants";

export interface RoomFilesState {
  files: readonly ChatRoomFileDto[];
  /** Lần nạp ĐẦU của khối (khác `isLoadingMore` — hai trạng thái, hai giao diện). */
  isLoading: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

export function useRoomFiles(roomId: string, kind?: ChatRoomFileKind): RoomFilesState {
  const [files, setFiles] = useState<readonly ChatRoomFileDto[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [isLoadingMore, setLoadingMore] = useState(false);
  const [hasError, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  /** Phòng mà lần nạp đang bay THUỘC VỀ — khối keyed theo phòng, nhưng response cũ vẫn có thể về sau. */
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
          ...(kind !== undefined ? { kind } : {}),
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
    [roomId, kind],
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

  const reload = useCallback(() => void load(undefined), [load]);

  return { files, isLoading, isLoadingMore, hasError, hasMore, loadMore, reload };
}
