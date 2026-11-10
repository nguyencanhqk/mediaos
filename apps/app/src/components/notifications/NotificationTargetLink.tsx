import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { chatRoomTargetFromUrl } from "@/routes/chat/chat-room-link";
import { taskTargetFromUrl, useTaskDrawer } from "@/routes/tasks/task-drawer-nav";
import { useChatRoomLinkOpener } from "./use-chat-room-link-opener";

/**
 * NotificationTargetLink — S4-FE-NOTI-1. Deep link AN TOÀN từ 1 thông báo tới nội dung liên quan
 * (`target_url` do server trả — HR/ATT/LEAVE/TASK route thật, ví dụ "/leave/me/requests/:id").
 *
 * AN TOÀN (KHÔNG bỏ route guard):
 *  - CHỈ điều hướng qua TanStack Router `navigate()` (client-side) — route đích VẪN chạy `beforeLoad`
 *    (authGuard) + `<ProtectedRoute meta>` như mọi route khác (module gốc TỰ kiểm quyền lại — WO acceptance
 *    bullet 3). KHÔNG dùng `window.location.href` (sẽ bay qua guard SPA, và có thể full-page-navigate ra
 *    ngoài app).
 *  - CHỈ chấp nhận `target_url` bắt đầu bằng "/" (đường dẫn NỘI BỘ, tương đối tới gốc app). URL tuyệt đối
 *    ("http://…", "//…" protocol-relative) hoặc rỗng/null ⇒ KHÔNG render link (tránh open-redirect nếu
 *    server/nguồn dữ liệu bị thao túng — defense-in-depth, dù server hiện tại luôn generate nội bộ).
 *
 * S20-TASK-DRAWER-1: đích `/tasks/<uuid>` KHÔNG rời trang — thêm `?task=<uuid>` vào URL hiện tại để
 * drawer việc toàn cục mở tại chỗ (đứng ở /goals/G ⇒ /goals/G?task=T). Quyền xem việc vẫn do server
 * quyết khi drawer tải; đích khác giữ nguyên điều hướng cũ.
 *
 * S20-NOTI-TARGETURL-1: `/tasks/<uuid>?comment_id=<uuid>` ⇒ cùng drawer, kèm yêu cầu làm nổi bình luận (không thêm
 * `comment_id` vào URL). `comment_id` rác ⇒ vẫn mở drawer, không làm nổi.
 *
 * S20-CHAT-DEEPLINK-1: đích `/chat/<uuid>` ⇒ drawer chat mở phòng tại chỗ (hoặc `/chat/R` khi đang ở
 * trang chat) — luật đầy đủ ở `use-chat-room-link-opener.ts`.
 */
export function isSafeInternalTarget(url: string | null | undefined): url is string {
  if (!url) return false;
  // "/" hợp lệ; "//host/..." (protocol-relative) KHÔNG hợp lệ — bắt đầu bằng đúng 1 dấu "/".
  return url.startsWith("/") && !url.startsWith("//");
}

/**
 * Mở đích AN TOÀN của một thông báo (cùng luật với bấm dòng): việc ⇒ drawer việc, phòng chat ⇒ drawer chat,
 * còn lại điều hướng router. Tách ra để toast realtime (S20-NOTI-LIVETOAST-1) dùng CHUNG, không chép luật.
 * Caller PHẢI đã kiểm `isSafeInternalTarget`.
 */
export function useOpenNotificationTarget(): (targetUrl: string) => void {
  const navigate = useNavigate();
  const { openTask } = useTaskDrawer();
  const openChatRoom = useChatRoomLinkOpener();
  return useCallback(
    (targetUrl: string) => {
      const taskTarget = taskTargetFromUrl(targetUrl);
      if (taskTarget) {
        openTask(
          taskTarget.taskId,
          taskTarget.commentId ? { commentId: taskTarget.commentId } : undefined,
        );
        return;
      }
      const chatTarget = chatRoomTargetFromUrl(targetUrl);
      if (chatTarget) {
        openChatRoom(chatTarget);
        return;
      }
      // `to` KHÔNG tách `?…`/`#…` ⇒ đích có query đi bằng `href`; đích trần giữ `to` (target_url là chuỗi động).
      if (/[?#]/.test(targetUrl)) {
        void navigate({ href: targetUrl });
        return;
      }
      void navigate({ to: targetUrl as "/" });
    },
    [navigate, openTask, openChatRoom],
  );
}

interface NotificationTargetLinkProps {
  targetUrl: string | null | undefined;
  /** Gọi TRƯỚC khi điều hướng (vd mark-read) — không chặn navigate nếu lỗi. */
  onBeforeNavigate?: () => void;
  /**
   * S20-NOTI-LISTNAV-1 — đích rỗng/không an toàn: có callback ⇒ vẫn là nút bấm được, nhưng KHÔNG điều
   * hướng tới `targetUrl` mà giao lượt bấm cho caller (vd trang Thông báo mở trang chi tiết như cũ).
   * Không có ⇒ span trần như trước. Việc kiểm an toàn vẫn CHỈ nằm ở `isSafeInternalTarget`.
   */
  onUnsafeTarget?: () => void;
  children: React.ReactNode;
  className?: string;
}

export function NotificationTargetLink({
  targetUrl,
  onBeforeNavigate,
  onUnsafeTarget,
  children,
  className,
}: NotificationTargetLinkProps) {
  const openTarget = useOpenNotificationTarget();
  const safe = isSafeInternalTarget(targetUrl);

  if (!safe) {
    return onUnsafeTarget ? (
      <button type="button" className={className} onClick={onUnsafeTarget}>
        {children}
      </button>
    ) : (
      <span className={className}>{children}</span>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        onBeforeNavigate?.();
        openTarget(targetUrl);
      }}
    >
      {children}
    </button>
  );
}
