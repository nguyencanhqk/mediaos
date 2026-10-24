/**
 * S20-CHAT-INTERNALLINK-1 (US-X-11) — MỘT link trong thân tin nhắn.
 *
 * Mọi link vẫn là `<a href target="_blank" rel="noopener noreferrer nofollow">` như trước — giữ nguyên
 * cho Ctrl/⌘/Shift+click, chuột giữa, «Mở trong tab mới» và chép địa chỉ. Chỉ khác ở MỘT điểm: link mà
 * `classifyInternalLink` nhận là nội bộ thì lượt bấm THƯỜNG (chuột trái, không phím bổ trợ) do ứng dụng
 * nhận và mở tại chỗ:
 *   `/tasks/<uuid>`  ⇒ `?task=` trên URL đang đứng (drawer việc toàn cục; phòng chat không bị đụng tới;
 *                       quyền xem việc do server quyết khi drawer tải)
 *   `/chat/<uuid>`   ⇒ `useChatRoomLinkOpener` (route con `/chat/$roomId` hoặc drawer chat tại chỗ)
 *   trang khác       ⇒ router điều hướng (không tải lại ứng dụng)
 *
 * Hook router chỉ gọi trong nhánh NỘI BỘ: bong bóng chỉ có link ngoài vẫn dựng được không cần router.
 * Chữ của link luôn là chuỗi người gửi gõ, qua text node của React — không tra tiêu đề đích ở đây.
 */
import { useNavigate } from "@tanstack/react-router";
import { useTaskDrawer } from "@/routes/tasks/task-drawer-nav";
import { useChatRoomLinkOpener } from "@/components/notifications/use-chat-room-link-opener";
import { classifyInternalLink, type InternalLinkTarget } from "./internal-link";

const LINK_CLASS = "text-primary underline underline-offset-2 hover:no-underline";
// `noopener noreferrer` chặn tab đích chạm `window.opener`; `nofollow` vì đây là nội dung do người dùng
// nhập. Ba giá trị này đi cùng nhau, đừng bỏ bớt cái nào.
const LINK_REL = "noopener noreferrer nofollow";

/** Lượt bấm ứng dụng được phép nhận: chuột trái, không phím bổ trợ, chưa ai chặn trước. */
function isPlainPrimaryClick(event: React.MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

function InternalLink({
  href,
  target,
}: {
  href: string;
  target: InternalLinkTarget;
}): React.ReactElement {
  const navigate = useNavigate();
  const { openTask } = useTaskDrawer();
  const openChatRoom = useChatRoomLinkOpener();

  const onClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainPrimaryClick(event)) return;
    event.preventDefault();
    if (target.kind === "task") {
      openTask(target.taskId);
    } else if (target.kind === "chat-room") {
      openChatRoom({ roomId: target.roomId, messageId: target.messageId });
    } else {
      // `href` chỉ là `pathname + search` đã khớp allowlist (bắt đầu bằng đúng một `/`) ⇒ router đi SPA,
      // không bao giờ thành điều hướng ra ngoài.
      void navigate({ href: target.href });
    }
  };

  return (
    <a href={href} target="_blank" rel={LINK_REL} className={LINK_CLASS} onClick={onClick}>
      {href}
    </a>
  );
}

export function MessageBubbleLink({ href }: { href: string }): React.ReactElement {
  const target = classifyInternalLink(href, window.location.origin);
  if (target !== null) return <InternalLink href={href} target={target} />;
  return (
    <a href={href} target="_blank" rel={LINK_REL} className={LINK_CLASS}>
      {href}
    </a>
  );
}
