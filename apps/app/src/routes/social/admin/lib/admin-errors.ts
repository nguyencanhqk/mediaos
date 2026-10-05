/**
 * S16-SOCIAL-FE-3 (L1) — KHUNG bảng lý do lỗi của cụm quản trị bảng tin. Tập reason + thân hàm ở commit
 * GREEN kế tiếp (plan §4 — quy tắc stub-trước).
 */
export const ADMIN_ERROR_REASONS: readonly string[] = ["generic"];
export type AdminErrorReason = string;

/** Bảng `mã lỗi trên dây → reason` của MỘT lời gọi. */
export type AdminErrorTable = Readonly<Record<string, AdminErrorReason>>;

export function adminErrorReason(_err: unknown, _table: AdminErrorTable): AdminErrorReason {
  return "generic";
}
