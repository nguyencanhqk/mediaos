/**
 * S16-SOCIAL-FE-3C (L6) — «dải ô liên kết nhanh» của bảng tin: CHỌN app nào được vẽ (SPEC-16 SC-14 · plan D14).
 *
 * KHUNG của lượt RED (plan §4 «Quy tắc RED — stub-trước»): export đúng tên, giá trị RỖNG đúng kiểu, không gọi
 * gì. Thân thật ở commit GREEN ngay sau.
 */
import type { AppRegistryItem, PermissionChecker, SessionContext } from "@mediaos/web-core";

export const FEED_QUICK_LINK_APP_KEYS: readonly string[] = [];

export function pickQuickLinkApps(
  _apps: readonly AppRegistryItem[],
  _session: SessionContext,
  _checker: PermissionChecker,
): AppRegistryItem[] {
  return [];
}
