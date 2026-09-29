/**
 * S16-SOCIAL-FE-2B — nhãn + tone MỘT chỗ cho vai / trạng thái thành viên / chế độ nhóm (plan D18).
 *
 * SPEC-01 §17 KHÔNG có nhóm trạng thái cho `feed_group_members` hay `feed_groups.visibility`, nên
 * khai ở đây thay vì rải literal trong JSX (CLAUDE.md §5). `Record` vét cạn theo enum contracts: thêm
 * giá trị mới mà quên bảng này là TS đỏ lúc build.
 */
import type { StatusToneMap } from "@mediaos/ui";

export type GroupRoleValue = "owner" | "admin" | "member";
export type GroupVisibilityValue = "public" | "private";

/** Khoá i18n (namespace `social`) của từng vai. */
export const GROUP_ROLE_LABEL_KEY: Readonly<Record<GroupRoleValue, string>> = {
  owner: "groups.role.owner",
  admin: "groups.role.admin",
  member: "groups.role.member",
};

export const GROUP_ROLE_TONE: StatusToneMap<GroupRoleValue> = {
  owner: "brand",
  admin: "success",
  member: "muted",
};

export const GROUP_VISIBILITY_LABEL_KEY: Readonly<Record<GroupVisibilityValue, string>> = {
  public: "groups.visibility.public",
  private: "groups.visibility.private",
};

/** Thứ tự option của ô chọn vai (cao → thấp). */
export const GROUP_ROLE_OPTIONS: readonly GroupRoleValue[] = ["owner", "admin", "member"];
