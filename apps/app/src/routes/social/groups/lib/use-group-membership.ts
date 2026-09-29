/**
 * S16-SOCIAL-FE-2B — xin vào (`035`) / huỷ yêu cầu + rời nhóm (`036`) của CHÍNH actor. Dùng chung cho
 * hàng danh sách và header trang nhóm để hai chỗ không lệch nhau về lỗi và cache (plan D15).
 *
 * Cache:
 *  - join ⇒ `groups.allOf()` (nút/nhãn/memberCount) + `feed.allOf()` (public: giờ đăng được; feed
 *    nhóm kín giờ đọc được);
 *  - leave ⇒ `socialKeys.all`: quyền ĐỌC bài nhóm đổi ⇒ Saved/News/polls/ideas/feed nhóm đều có thể
 *    đổi. `onLeft` (vd điều hướng khỏi trang nhóm kín) chạy TRƯỚC khi invalidate — nếu không, trang
 *    đang mở refetch `032`, ăn 404 và nháy màn «không tìm thấy» ngay trước khi rời đi (plan §8 M5b);
 *  - lỗi 403/404/409 ⇒ `groups.allOf()`: thứ đang hiện đã CŨ (vai đổi · nhóm mất · đã có hàng).
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { socialGroupsApi, socialKeys } from "@mediaos/web-core";
import type { ActionErrorKind, ActionErrorReason } from "../../feed/components/ActionErrorBanner";
import {
  groupErrorReason,
  isForbiddenError,
  isStaleStateError,
  type GroupAction,
} from "./group-errors";

export interface GroupActionError {
  kind: ActionErrorKind;
  forbidden: boolean;
  reason: ActionErrorReason | null;
}

export interface UseGroupMembershipOptions {
  /** Sau khi rời/huỷ thành công, TRƯỚC khi invalidate. Có thể trả Promise (vd `navigate`). */
  onLeft?: () => void | Promise<unknown>;
}

export function useGroupErrorState(): {
  error: GroupActionError | null;
  setError: React.Dispatch<React.SetStateAction<GroupActionError | null>>;
  fail: (kind: ActionErrorKind, action: GroupAction) => (err: unknown) => void;
} {
  const queryClient = useQueryClient();
  const [error, setError] = React.useState<GroupActionError | null>(null);
  const fail = React.useCallback(
    (kind: ActionErrorKind, action: GroupAction) => (err: unknown) => {
      setError({ kind, forbidden: isForbiddenError(err), reason: groupErrorReason(action, err) });
      if (isStaleStateError(err)) {
        void queryClient.invalidateQueries({ queryKey: socialKeys.groups.allOf() });
      }
    },
    [queryClient],
  );
  return { error, setError, fail };
}

export function useGroupMembership(groupId: string, { onLeft }: UseGroupMembershipOptions = {}) {
  const queryClient = useQueryClient();
  const { error, setError, fail } = useGroupErrorState();

  const join = useMutation({
    mutationFn: () => socialGroupsApi.join(groupId),
    onMutate: () => setError(null),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.groups.allOf() });
      void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
    },
    onError: fail("groupJoin", "join"),
  });

  const leave = useMutation({
    mutationFn: () => socialGroupsApi.leave(groupId),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await onLeft?.();
      await queryClient.invalidateQueries({ queryKey: socialKeys.all });
    },
    onError: fail("groupLeave", "leave"),
  });

  return {
    join: () => join.mutate(),
    leave: () => leave.mutate(),
    isJoining: join.isPending,
    isLeaving: leave.isPending,
    busy: join.isPending || leave.isPending,
    error,
    clearError: () => setError(null),
  };
}
