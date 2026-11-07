/**
 * S20-X-QUICKCREATE-1 — nhớ «dự án gần nhất» của người dùng để GỢI Ý chip (không bao giờ tự điền).
 * localStorage có thể bị chặn (chế độ riêng tư, quota) ⇒ mọi truy cập trong try/catch, lỗi = không nhớ.
 * Chỉ lưu id; tên/trạng thái/vai trò luôn hỏi lại server trước khi hiện chip.
 */
export const QUICK_CREATE_RECENT_PROJECT_KEY = "mediaos.quickCreate.recentProjectId";

export function readRecentProjectId(): string | null {
  try {
    const value = window.localStorage.getItem(QUICK_CREATE_RECENT_PROJECT_KEY);
    return value && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeRecentProjectId(projectId: string): void {
  try {
    window.localStorage.setItem(QUICK_CREATE_RECENT_PROJECT_KEY, projectId);
  } catch {
    // không nhớ được thì thôi — chỉ mất gợi ý
  }
}
