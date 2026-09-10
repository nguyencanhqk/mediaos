/**
 * S17-CHAT-UX2-FE-3 — **dán** và **kéo-thả** tệp vào ô soạn (SPEC-15 §22c CHAT-DEC-027).
 *
 * ⚠️ Bộ handler này gắn ở ROOT của ô soạn, KHÔNG ở `<textarea>`: `paste`/`drop` nổi bọt từ textarea lên
 * root, nên gắn ở root là bắt đủ; gắn ở CẢ HAI thì mỗi tệp đi qua `uploadChatAttachment` **HAI LẦN** —
 * giao diện y hệt, và triệu chứng duy nhất là tin gửi xong có hai bản của cùng một ảnh.
 *
 * Cả hai đường đều gọi ĐÚNG hàm `onFiles` mà nút 📎 đang dùng: luật trần tệp, khoá idempotency và cách
 * gộp lỗi chỉ được viết MỘT chỗ.
 */
import { useMemo, type ClipboardEvent, type DragEvent } from "react";

export interface FileDropHandlers {
  onPaste: (e: ClipboardEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

export function useFileDrop(
  disabled: boolean,
  onFiles: (files: FileList | null) => void,
): FileDropHandlers {
  return useMemo(
    () => ({
      onPaste: (e) => {
        if (disabled) return;
        const files = e.clipboardData?.files;
        // Dán CHỮ: KHÔNG `preventDefault` — để trình duyệt chèn văn bản như thường.
        if (!files || files.length === 0) return;
        e.preventDefault();
        onFiles(files);
      },
      onDragOver: (e) => {
        if (disabled) return;
        // Thiếu `preventDefault` ở đây thì trình duyệt MỞ tệp thay vì thả nó vào ô soạn.
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      },
      onDrop: (e) => {
        if (disabled) return;
        const files = e.dataTransfer?.files;
        if (!files || files.length === 0) return;
        e.preventDefault();
        onFiles(files);
      },
    }),
    [disabled, onFiles],
  );
}
