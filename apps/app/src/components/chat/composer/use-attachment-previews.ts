/**
 * S17-CHAT-UX2-FE-3 — **SỔ THU HỒI** blob URL xem trước của ô soạn (SPEC-15 §22c CHAT-DEC-027).
 *
 * Mọi `URL.createObjectURL` sinh ra cho một tệp đang chờ gửi đều đi qua đây, và đây là nơi DUY NHẤT
 * gọi `URL.revokeObjectURL`. Tách ra thành hook riêng vì đây là một vòng đời trọn vẹn (tạo → gỡ một →
 * gỡ hết → tháo cây), và vì nó là loại lỗi **không ai nhìn thấy**: quên thu hồi thì jsdom im, trình
 * duyệt im, chỉ có tab chat nặng dần sau vài chục lần dán ảnh.
 *
 * ⚠️ KHÔNG tạo URL trong thân render: mỗi lần re-render sẽ đẻ một URL mới và bỏ rơi cái cũ.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

export interface AttachmentPreviews {
  /** Tạo (nếu là ảnh) và ghi sổ. Trả `null` cho tệp không phải ảnh. */
  create: (fileId: string, file: File, isImage: boolean) => string | null;
  /** Thu hồi URL của MỘT tệp — gọi khi người dùng gỡ tệp khỏi nháp. */
  revokeOne: (fileId: string) => void;
  /** Thu hồi TOÀN BỘ — gọi khi tin đã gửi xong. */
  revokeAll: () => void;
}

export function useAttachmentPreviews(): AttachmentPreviews {
  const urlsRef = useRef(new Map<string, string>());

  const revokeOne = useCallback((fileId: string) => {
    const url = urlsRef.current.get(fileId);
    if (url === undefined) return;
    URL.revokeObjectURL(url);
    urlsRef.current.delete(fileId);
  }, []);

  const revokeAll = useCallback(() => {
    for (const url of urlsRef.current.values()) URL.revokeObjectURL(url);
    urlsRef.current.clear();
  }, []);

  const create = useCallback((fileId: string, file: File, isImage: boolean): string | null => {
    if (!isImage) return null;
    const url = URL.createObjectURL(file);
    urlsRef.current.set(fileId, url);
    return url;
  }, []);

  // Tháo cây khi còn tệp đang chờ (đổi phòng, đóng drawer) ⇒ URL không còn ai thu hồi. Deps rỗng nên
  // cleanup chỉ chạy lúc unmount thật; `<StrictMode>` chạy sớm một lần khi sổ còn RỖNG ⇒ vô hại.
  useEffect(() => () => revokeAll(), [revokeAll]);

  // `useMemo` KHÔNG phải trang trí: ba hàm trên đã ổn định, nhưng object bọc ngoài mà mới mỗi render
  // thì mọi `useCallback` ở `MessageComposer` có `previews` trong deps (`handlePickFiles`,
  // `removeAttachment`, `handleSubmit`) đều bị tái tạo mỗi render — memo hoá thành vô nghĩa trong im lặng.
  return useMemo(() => ({ create, revokeOne, revokeAll }), [create, revokeOne, revokeAll]);
}
