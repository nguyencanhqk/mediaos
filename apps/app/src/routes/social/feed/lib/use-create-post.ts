/**
 * S16-SOCIAL-FE-2B — lượt ĐĂNG BÀI dùng chung cho bảng tin (`FeedPage`) và trang nhóm (`GroupPostsTab`).
 *
 * Tách từ `FeedPage` (plan FE-2B D10 + §8 M3) để trang nhóm KHÔNG chép lại — và không mất — ba thứ
 * lượt đăng phải có:
 *  1. `onError` (thiếu = hỏng IM LẶNG TUYỆT ĐỐI: app không có hệ toast, `QueryClient` không khai
 *     `MutationCache.onError`);
 *  2. số lượt nhắc bị BỎ (`droppedMentions`, SPEC-16 §12 `ERR-009`) — càng cần trong nhóm: server bỏ
 *     im lặng mọi mention người NGOÀI nhóm rồi vẫn trả 201;
 *  3. invalidate đúng danh sách (`feed.allOf()` gồm cả feed nhóm `feed.list({groupId,…})`, + màn
 *     007/008 theo loại — plan FE-2 §8 H5).
 *
 * Chế độ nhóm (`groupId`): lỗi còn mang `reason` (404 ERR-012 ⇒ `groupGone`) và 403/404/409 kéo lại
 * nhóm — 403 `SOCIAL-ERR-002` nghĩa là tư cách thành viên của tôi đã mất, header phải hiện lại đúng.
 * Không `groupId` ⇒ hành vi y hệt trước FE-2B (không `reason`).
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { socialApi, socialKeys } from "@mediaos/web-core";
import type { CreateFeedPostDto, FeedPostCreatedDto } from "@mediaos/contracts";
import type { ActionErrorReason } from "../components/ActionErrorBanner";
import { groupErrorReason, isForbiddenError, isStaleStateError } from "../../groups/lib/group-errors";

export interface CreatePostError {
  forbidden: boolean;
  reason: ActionErrorReason | null;
}

export interface UseCreatePostOptions {
  /** Trang nhóm — bật `reason` + kéo lại nhóm khi lỗi cho thấy trạng thái đã cũ. */
  groupId?: string;
  /** Sau khi server nhận bài (vd FeedPage reset badge «N bài mới»). */
  onCreated?: (created: FeedPostCreatedDto) => void;
}

export interface UseCreatePostResult {
  /** Trả Promise ⇒ ô soạn chỉ dọn khi RESOLVE (hợp đồng `FeedComposer.onSubmit`, lỗi H2 FE-1). */
  submit: (dto: CreateFeedPostDto) => Promise<FeedPostCreatedDto>;
  isPending: boolean;
  postError: CreatePostError | null;
  clearPostError: () => void;
  droppedMentionCount: number;
  clearDroppedMentions: () => void;
}

export function useCreatePost({ groupId, onCreated }: UseCreatePostOptions = {}): UseCreatePostResult {
  const queryClient = useQueryClient();
  const [postError, setPostError] = React.useState<CreatePostError | null>(null);
  const [droppedMentionCount, setDroppedMentionCount] = React.useState(0);

  const mutation = useMutation({
    mutationFn: (dto: CreateFeedPostDto) => socialApi.createPost(dto),
    // Lượt gửi MỚI dọn dấu vết lượt trước: một dải lỗi cũ treo cạnh bài vừa đăng xong là thông tin sai.
    onMutate: () => {
      setPostError(null);
      setDroppedMentionCount(0);
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: socialKeys.feed.allOf() });
      // S16-SOCIAL-FE-2 (plan §8 H5): bài poll/idea mới phải hiện ngay ở màn 007/008 + widget rail.
      if (created.type === "poll") {
        void queryClient.invalidateQueries({ queryKey: socialKeys.polls.allOf() });
      } else if (created.type === "idea") {
        void queryClient.invalidateQueries({ queryKey: socialKeys.ideas.allOf() });
      }
      onCreated?.(created);
      setDroppedMentionCount(created.droppedMentions.length);
    },
    onError: (err) => {
      setPostError({
        forbidden: isForbiddenError(err),
        reason: groupId ? groupErrorReason("post", err) : null,
      });
      if (groupId && isStaleStateError(err)) {
        void queryClient.invalidateQueries({ queryKey: socialKeys.groups.detail(groupId) });
      }
    },
  });

  return {
    submit: (dto) => mutation.mutateAsync(dto),
    isPending: mutation.isPending,
    postError,
    clearPostError: () => setPostError(null),
    droppedMentionCount,
    clearDroppedMentions: () => setDroppedMentionCount(0),
  };
}
