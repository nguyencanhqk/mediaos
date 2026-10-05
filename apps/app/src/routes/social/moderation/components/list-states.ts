/**
 * S16-SOCIAL-FE-3 — hằng trình bày dùng chung của HAI danh sách của màn Kiểm duyệt (`ReportQueue` — hàng
 * đợi báo cáo; `HiddenPostsTab` — bài đang ẩn): khung chờ và ô «không có gì để hiện» phải giống nhau giữa
 * hai tab của cùng một màn.
 */

/** Số dòng khung chờ (skeleton) vẽ trong lúc tải lượt đầu. */
export const SKELETON_ROWS = [0, 1, 2] as const;

/** Ô nét đứt cho trạng thái rỗng / trang vượt quá số trang. */
export const PLACEHOLDER_CLASS =
  "rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground";
