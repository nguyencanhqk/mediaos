/**
 * S16-SOCIAL-FE-2B (owner ký O1) — lượt «Gửi yêu cầu tham gia» từ màn 404 của link mời.
 *
 * Giữ ở `GroupPageBody` (KHÔNG trong `GroupNotFound`) để state sống qua lượt refetch `032` — xem
 * docblock `GroupNotFound.tsx` (gate LIGHT HIGH-1).
 *
 * Cache: thành công ⇒ CHỈ `groups.lists()` (hàng `pending` giờ hiện ở `030`); lỗi ⇒ KHÔNG invalidate
 * chi tiết: `032` đã là một 404 đã biết, kéo lại không nói thêm gì mà còn làm trang nháy skeleton.
 * DTO 201 của `035` (tên/mô tả nhóm kín) CỐ Ý bỏ qua — không hiện, không ghi cache chi tiết.
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { socialGroupsApi, socialKeys } from "@mediaos/web-core";
import { groupErrorReason, isForbiddenError } from "./group-errors";
import type { GroupActionError } from "./use-group-membership";

export interface UseInviteRequestResult {
  request: () => void;
  isPending: boolean;
  sent: boolean;
  error: GroupActionError | null;
  clearError: () => void;
}

export function useInviteRequest(groupId: string): UseInviteRequestResult {
  const queryClient = useQueryClient();
  const [sent, setSent] = React.useState(false);
  const [error, setError] = React.useState<GroupActionError | null>(null);

  const mutation = useMutation({
    mutationFn: () => socialGroupsApi.join(groupId),
    onMutate: () => setError(null),
    onSuccess: () => {
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: socialKeys.groups.lists() });
    },
    onError: (err) => {
      setError({
        kind: "groupJoin",
        forbidden: isForbiddenError(err),
        reason: groupErrorReason("join", err),
      });
    },
  });

  return {
    request: () => mutation.mutate(),
    isPending: mutation.isPending,
    sent,
    error,
    clearError: () => setError(null),
  };
}
