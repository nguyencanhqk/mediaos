/**
 * triggerBlobDownload — kích hoạt tải file nhị phân trong trình duyệt (HR-PROFILE-UI-2).
 *
 * Tạo object URL tạm cho blob → click thẻ <a download> ẩn → thu hồi URL ngay sau đó. DOM-only: no-op an
 * toàn khi thiếu `document`/`URL.createObjectURL` (SSR / môi trường test node / jsdom chưa hỗ trợ) để KHÔNG
 * ném ở nơi không có DOM — caller vẫn nhận blob và tự xử lý.
 *
 * (Bản sao cục bộ theo feature HR — mirror routes/attendance/download-blob.ts; giữ cô lập feature, KHÔNG
 * để HR phụ thuộc chéo vào module attendance.)
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return;
  }
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
