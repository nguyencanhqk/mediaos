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
 *     007/008 theo loại — plan FE-2 §8 H5; + màn 009/widget vinh danh — FE-2C).
 *
 * `reason`: lỗi vinh danh (`SOCIAL-ERR-KUDOS-*` · `022`) mang lý do CỤ THỂ ở CẢ bảng tin lẫn nhóm
 * (S16-SOCIAL-FE-2C, `kudos-errors.ts` — các mã này chỉ phát ra từ nhánh kudos). Mã khác: chế độ nhóm
 * (`groupId`) đọc lý do nhóm (404 ERR-012 ⇒ `groupGone`) và 403/404/409 kéo lại nhóm — 403
 * `SOCIAL-ERR-002` nghĩa là tư cách thành viên của tôi đã mất; không `groupId` ⇒ `reason:null`.
 */
import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { socialApi, socialKeys } from "@mediaos/web-core";
import type { CreateFeedPostDto, FeedPostCreatedDto } from "@mediaos/contracts";
import type { ActionErrorReason } from "../components/ActionErrorBanner";
import { kudosErrorReason } from "../../kudos/lib/kudos-errors";
import {
  groupErrorReason,
  isForbiddenError,
  isStaleStateError,
} from "../../groups/lib/group-errors";

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

export function useCreatePost({
  groupId,
  onCreated,
}: UseCreatePostOptions = {}): UseCreatePostResult {
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
      } else if (created.type === "kudos") {
        // `lists()` là TIỀN TỐ — khớp cả màn 009 `list({month,page,limit})` lẫn widget `list({month,limit})`.
        void queryClient.invalidateQueries({ queryKey: socialKeys.kudos.lists() });
      }
      onCreated?.(created);
      setDroppedMentionCount(created.droppedMentions.length);
    },
    onError: (err) => {
      const kudosReason = kudosErrorReason(err);
      setPostError({
        forbidden: isForbiddenError(err),
        reason: kudosReason ?? (groupId ? groupErrorReason("post", err) : null),
      });
      // 022 — huy hiệu vừa bị tắt: tải lại catalog để ô chọn thôi mời huy hiệu đó (và nháp bỏ chọn nó).
      if (kudosReason === "kudosBadgeInvalid") {
        void queryClient.invalidateQueries({ queryKey: socialKeys.kudos.badges() });
      }
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
