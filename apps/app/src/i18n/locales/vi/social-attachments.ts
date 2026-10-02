/**
 * S16-SOCIAL-FE-2D — chuỗi ĐÍNH KÈM của bảng tin (khay của ô soạn bài/bình luận + khối vẽ tệp trên thẻ
 * bài/bình luận/tin), gắn vào namespace `social` dưới khoá `attachment` (xem `social.ts`). Tách file như
 * `social-kudos.ts` để `social.ts` không phình quá trần (CLAUDE.md §5).
 *
 * Lý do lỗi khi ĐĂNG (`SOCIAL-ERR-007` · `FILE-TARGET-*-DENIED`) ở `actionError.reason.*` của `social.ts`
 * (cùng dải `ActionErrorBanner`); lý do lỗi của TỪNG Ô khi tải nằm ở `error.*` dưới đây.
 */
export default {
  add: "Đính kèm tệp",
  addLabel: "Đính kèm",
  uploading: "Đang tải lên…",
  remove: "Gỡ tệp {{name}}",
  retry: "Thử lại",
  /** Tên truy cập được của nút «Thử lại» — chứa chữ hiển thị + tên tệp (nhiều ô lỗi ≠ nhiều nút giống hệt). */
  retryNamed: "Thử lại tải lên «{{name}}»",
  previewAlt: "Ảnh sắp đính kèm: {{name}}",
  /** Tên danh sách tệp theo ĐÚNG ô soạn (`testIdPrefix` của khay). */
  trayAria: {
    composer: "Tệp đính kèm của bài đang soạn",
    comment: "Tệp đính kèm của bình luận đang soạn",
  },
  /** Tệp KHÔNG có tên từ server (`fileName: null`). */
  unnamed: "Tệp đính kèm",
  filesAria: "Tệp đính kèm",
  /** Tệp bị từ chối TRƯỚC khi tải (trần client = trần server). */
  reject: {
    tooLarge: "«{{name}}» lớn hơn {{max}} — mỗi tệp tối đa {{max}}.",
    tooManyImages: "«{{name}}» không được thêm: tối đa {{max}} ảnh mỗi lần đăng.",
    tooManyVideos: "«{{name}}» không được thêm: tối đa {{max}} video mỗi lần đăng.",
    tooManyFiles: "«{{name}}» không được thêm: tối đa {{max}} tệp mỗi lần đăng.",
  },
  /** Một ô tải HỎNG — lý do đọc từ `ApiError.code`. */
  error: {
    unsupportedType: "Định dạng tệp này chưa được hỗ trợ.",
    tooLargeServer: "Tệp vượt dung lượng hệ thống cho phép.",
    attachDenied: "Bạn không có quyền đính kèm tệp ở đây.",
    uploadFailed: "Tải lên không thành công.",
  },
  /** Vì sao nút gửi đang khoá. */
  blocked: {
    uploading: "Đang tải tệp lên — chờ xong rồi gửi.",
    hasErrors: "Có tệp tải lỗi — gỡ hoặc thử lại trước khi gửi.",
  },
  /** URL ký GET sống 300 s — ảnh/video cuộn tới (hoặc tua) sau đó thì hết hạn. */
  imageUnavailable: "Ảnh không còn hiển thị được — tải lại trang để xem.",
  videoUnavailable: "Video không còn phát được — tải lại trang để xem.",
} as const;
