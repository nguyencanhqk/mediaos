/**
 * S7-CHAT-BE-3 — luật "tệp này có được cấp URL tải không", TÁCH RA làm nguồn duy nhất.
 *
 * VÌ SAO TÁCH: luật này sinh ra ở `FileService.downloadStateDenyReason` (S2-FND-BE-4 · H2) và đứng SAU
 * bước authz — nó trả lời câu hỏi khác hẳn: "kể cả khi được phép, tệp này có ở trạng thái ký được
 * không". Từ WO này có người dùng thứ hai (`ChatAttachmentPresignService` ký đính kèm chat). Chép sang
 * là dựng bản sao thứ hai của luật: hôm nay chỉ `Infected` bị chặn, ngày mai thêm một trạng thái mới ở
 * FOUNDATION và CHAT vẫn ký một tệp mà FOUNDATION đã từ chối — không test nào bắt được vì mỗi đường đi
 * qua một hằng khác nhau.
 *
 * Hàm THUẦN, không truy vấn, không tenant-scope: caller đã đọc `files` row trong `withTenant` của mình.
 */

/** Tập cột TỐI THIỂU cần để ra quyết định — khai structural để cả `FileRecord` lẫn projection hẹp của
 *  CHAT dùng được mà KHÔNG cần `as` (mỗi chỗ ép kiểu là một chỗ TypeScript thôi kiểm tra hộ). */
export interface FileDownloadStateSubject {
  scanStatus: string;
  uploadStatus: string;
}

export type FileDownloadDenyReason = "infected" | "not-uploaded";

/**
 * Lý do KHÔNG được ký URL tải, hoặc `null` nếu ký được.
 *
 * `Infected` xét TRƯỚC (liên quan an ninh) rồi mới tới chưa-upload-xong. AV chưa đấu nối nên mặc định
 * là `NotRequired` ⇒ CHỈ `Infected` chặn; `Pending`/`Failed`/`Clean`/`NotRequired` vẫn tải được.
 * `upload_status` BẮT BUỘC là `'Uploaded'` (Pending/Failed/Deleted ⇒ `not-uploaded`).
 */
export function fileDownloadStateDenyReason(
  row: FileDownloadStateSubject,
): FileDownloadDenyReason | null {
  if (row.scanStatus === "Infected") return "infected";
  if (row.uploadStatus !== "Uploaded") return "not-uploaded";
  return null;
}
