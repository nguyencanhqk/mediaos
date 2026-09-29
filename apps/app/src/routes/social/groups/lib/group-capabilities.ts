/**
 * S16-SOCIAL-FE-2B — năng lực của CHÍNH actor trên một nhóm (plan D4). MỘT chỗ duy nhất soi gương
 * cổng BE; mọi nút của màn Nhóm đọc từ đây, KHÔNG tự suy từ `myRole` ở chỗ khác.
 *
 * Nguồn: vai trò HÀNG trong nhóm từ DTO (`myRole`/`myStatus` của `032`/`030`) + `manage:feed-group`
 * (`useCan`). Server vẫn là cổng cuối — hàm này để người dùng không thấy một nút chắc chắn 403, và
 * không mất một nút họ có quyền bấm. Mỗi dòng trích cổng tương ứng ở `social-groups.service.ts`.
 *
 * 🔴 `role` CHỈ tính khi `myStatus === 'active'`: hàng `pending` luôn mang `myRole:'member'` (CHECK
 * `status='active' OR role='member'`), nên đọc `myRole` thiếu `myStatus` là coi người CHỜ DUYỆT như
 * thành viên.
 *
 * ⚠️ `canManage` đến từ `useCan` — bỏ qua scope, trong khi BE đòi sàn Company cho `manage:feed-group`.
 * Seed chỉ cấp Company nên hôm nay không lệch (cùng đánh đổi `PostCardMenu.tsx`).
 */
import type { FeedGroupDto } from "@mediaos/contracts";

export type GroupRole = "owner" | "admin" | "member";

export interface GroupCapabilities {
  /** Vai hiệu lực (null khi không phải thành viên `active`). */
  role: GroupRole | null;
  /** 033 — owner/admin hoặc manage (`:144-148`). */
  canEdit: boolean;
  /** 034 — owner MỘT MÌNH hoặc manage; admin 403 (`:190-191`). */
  canDelete: boolean;
  /** 038/039 — duyệt · từ chối · đổi vai · mời ra: owner/admin hoặc manage (`:343-368`, `:444-448`). */
  canModerate: boolean;
  /**
   * 038 `{role:'owner'}` — owner, HOẶC manage mà KHÔNG đang là admin active (`:404-406`).
   * Kẽ BE (nợ `S16-SOCIAL-GROUPERR-1`): admin active kiêm manage ⇒ `assertGroupRoleTx` trả
   * `viaManage:false` vì vai admin đã khớp ⇒ 403. Soi gương để không hiện lựa chọn chắc chắn hỏng.
   */
  canGrantOwner: boolean;
  /** 037 — mọi thành viên active hoặc manage (`:316-317`). */
  canListMembers: boolean;
  /** 001?groupId — public: ai cũng đọc; private: CHỈ active. `manage` KHÔNG nới đọc bài (D9-ii BE-2A). */
  canReadPosts: boolean;
  /** 002 audience='group' — chỉ active; `manage` KHÔNG giúp (`social-access.service.ts:715-731`). */
  canPost: boolean;
  /** 035 nhóm public ⇒ vào ngay. */
  canJoin: boolean;
  /** 035 nhóm private ⇒ thành `pending`. */
  canRequestJoin: boolean;
  /** 036 khi đang `pending` = huỷ yêu cầu. */
  canCancelRequest: boolean;
  /**
   * 036 khi active. Chủ nhóm cuối VẪN bấm được: BE quyết (409 ERR-015), FE hiện lý do. KHÔNG đếm owner
   * phía client — `037` giấu người nghỉ việc còn BE đếm cả họ ⇒ con số client có thể sai.
   */
  canLeave: boolean;
  /** «Sao chép link mời» (owner ký O1) — người có quyền duyệt yêu cầu. */
  canCopyInvite: boolean;
  /** Người manage nhìn nhóm KÍN mình không thuộc: thấy nhóm, KHÔNG đọc/đăng bài. */
  isManageViewer: boolean;
}

export function groupCapabilities(
  group: Pick<FeedGroupDto, "visibility" | "myRole" | "myStatus">,
  canManage: boolean,
): GroupCapabilities {
  const role: GroupRole | null = group.myStatus === "active" ? group.myRole : null;
  const isOwner = role === "owner";
  const isOwnerOrAdmin = role === "owner" || role === "admin";
  const isPublic = group.visibility === "public";
  return {
    role,
    canEdit: isOwnerOrAdmin || canManage,
    canDelete: isOwner || canManage,
    canModerate: isOwnerOrAdmin || canManage,
    canGrantOwner: isOwner || (canManage && role !== "admin"),
    canListMembers: role !== null || canManage,
    canReadPosts: isPublic || role !== null,
    canPost: role !== null,
    canJoin: group.myStatus === null && isPublic,
    canRequestJoin: group.myStatus === null && !isPublic,
    canCancelRequest: group.myStatus === "pending",
    canLeave: role !== null,
    canCopyInvite: isOwnerOrAdmin || canManage,
    isManageViewer: canManage && role === null && !isPublic,
  };
}

/**
 * Hàng danh sách có được LINK sang trang nhóm không. Nhóm kín mà actor chưa active (vd `pending` —
 * `030` vẫn liệt kê) thì `032` trả 404 ⇒ link là đường vào một màn «không tìm thấy». `manage` thấy
 * mọi nhóm qua `032` nên vẫn link.
 */
export function canOpenGroup(
  group: Pick<FeedGroupDto, "visibility" | "myStatus">,
  canManage: boolean,
): boolean {
  return group.visibility === "public" || group.myStatus === "active" || canManage;
}
