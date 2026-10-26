/**
 * S20-DASH-QUICKACTION-1 — đích quick action mà FE thật sự điều hướng tới.
 *
 * API phát đích từ `DASH_QUICK_ACTION_TARGET_URLS` (@mediaos/contracts). FE lên Pages TRƯỚC khi API mới
 * được deploy ⇒ trong khoảng đó payload widget vẫn mang đích CŨ (link chết: `/tasks/new` bị route
 * `/tasks/$taskId` nuốt thành việc id «new», `/projects` rơi 404…). Bảng dưới ánh xạ đúng các đích cũ đã
 * biết sang đích mới; đích khác đi nguyên.
 *
 * TODO(gỡ sau khi API có S20-DASH-QUICKACTION-1 lên PROD): xoá `LEGACY_TARGETS` + nhánh `/projects/`.
 */
import { DASH_QUICK_ACTION_TARGET_URLS as TARGETS } from "@mediaos/contracts";

/**
 * Đích cũ (API trước S20-DASH-QUICKACTION-1) → đích API mới phát cho CÙNG mã action ⇒ trước và sau khi deploy
 * API, một nút dẫn tới cùng một màn. Spec kiểm cả hai vế.
 */
export const LEGACY_QUICK_ACTION_TARGETS: Readonly<Record<string, string>> = {
  "/tasks/new": TARGETS.CREATE_TASK,
  "/tasks/my": TARGETS.OPEN_MY_TASKS,
  // Nút cũ OPEN_TASK_ALERTS «Xem task cần chú ý» (đích ghi «due-soon» nhưng chưa từng lọc được gì). Dẫn tới
  // nhóm «Sắp đến hạn» thì chỉ còn phần nhỏ của số widget báo (lượt đo: 1 việc, widget ghi «3 quá hạn · 1 sắp
  // đến hạn») ⇒ đi theo mã action như API mới: màn «Task quá hạn».
  "/tasks?filter=due-soon": TARGETS.OPEN_TASK_ALERTS,
  "/leave/approvals?status=Pending": TARGETS.OPEN_PENDING_LEAVE_APPROVAL,
  "/projects": TARGETS.OPEN_PROJECT,
};

/** API cũ nối `/${projectId}` vào `/projects` (OPEN_PROJECT có ngữ cảnh dự án). */
const LEGACY_PROJECT_PREFIX = "/projects/";

export function resolveQuickActionTarget(targetUrl: string | null): string | null {
  if (targetUrl === null) return null;
  if (Object.hasOwn(LEGACY_QUICK_ACTION_TARGETS, targetUrl)) {
    return LEGACY_QUICK_ACTION_TARGETS[targetUrl] ?? targetUrl;
  }
  if (targetUrl.startsWith(LEGACY_PROJECT_PREFIX)) {
    return `${TARGETS.OPEN_PROJECT}/${targetUrl.slice(LEGACY_PROJECT_PREFIX.length)}`;
  }
  return targetUrl;
}
