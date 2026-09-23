/**
 * S16-SOCIAL-FE-1 — menu ⋯ của thẻ bài (UI-07 §34b.4). Tách khỏi `PostCard` vì đây là nơi TẬP TRUNG
 * mọi quyết định phân quyền của thẻ, và nó cần đọc được một mình.
 *
 * ┌─ BẢNG GATE — ba cặp KHÁC NHAU, đừng gộp (plan §5.2) ──────────────────────────────────────────┐
 * │ «Sao chép liên kết»          → KHÔNG cặp nào. Ai xem được bài thì sao chép được link.          │
 * │ «Chỉnh sửa» / «Xoá bài»      → `post.isMine` (SỞ HỮU HÀNG, không phải quyền) **hoặc**          │
 * │                                `manage:feed-post` cho bài NGƯỜI KHÁC.                          │
 * │ «Ẩn/bỏ ẩn», «Khoá bình luận» → `manage:feed-post`.                                             │
 * │ «Ghim / bỏ ghim»             → 🔴 `manage:feed-news`, **KHÔNG** `manage:feed-post`.            │
 * │                                `SOCIAL_MODERATION_FIELD_PAIRS` của BE ánh xạ `pinned` →        │
 * │                                `manage:feed-news` ở TẦNG 2; gate nhầm ⇒ mục hiện ra, bấm 403.  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **«Báo cáo» CỐ Ý VẮNG.** Owner ký 23/09/2026 (plan §5.2 · N8): nút + hộp thoại soạn + cảnh báo
 * tự-lộ-danh-tính của SOC-DEC-011 đi **cùng một lượt** ở `S16-SOCIAL-FE-3`. Ship nút mà thiếu cảnh
 * báo là đúng cái hại mà spec đã lường trước — đừng "tiện tay thêm".
 *
 * ⚠️ **Bẫy «nút ⋯ vắng ≠ mục vắng»** (đã dính ở S15-PAYROLL-FE-7): ca deny phải mở menu ra rồi assert
 * MỤC không có. Vì vậy nút ⋯ ở đây **luôn render** (luôn có ít nhất «Sao chép liên kết»), và ca C6
 * dùng chính mục đó làm đối chứng "menu không rỗng vì lý do khác".
 */
import * as React from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@mediaos/ui";
import { useCan } from "@mediaos/web-core";
import type { FeedPostDto } from "@mediaos/contracts";

export interface PostCardMenuActions {
  onCopyLink: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleHidden: () => void;
  onToggleComments: () => void;
  onTogglePinned: () => void;
}

interface PostCardMenuProps {
  post: FeedPostDto;
  actions: PostCardMenuActions;
  className?: string;
}

export function PostCardMenu({ post, actions, className }: PostCardMenuProps): React.ReactElement {
  const { t } = useTranslation("social");
  const [open, setOpen] = React.useState(false);

  // `useCan` (có fallback wildcard), KHÔNG `useCanExact`: cả 14 cặp `feed-*` đều `is_sensitive=false`
  // trong seed `0578`, nên hành vi đúng — khớp BE — là có wildcard.
  const canManagePost = useCan("manage", "feed-post");
  const canManageNews = useCan("manage", "feed-news");

  /**
   * `status` là **OPTIONAL** trong `feedPostSchema`: server chỉ gửi nó cho tác giả hoặc người có
   * `manage:feed-post`. Vắng mặt ⇒ người đọc thường ⇒ coi như đang hiển thị. TUYỆT ĐỐI không khai
   * `status` là bắt buộc ở bất kỳ schema phái sinh nào — server bỏ khoá mà FE đòi là ZodError dù HTTP
   * 200, tức **trắng trang cho đúng nhóm vừa được bảo vệ**.
   */
  const isHidden = post.status === "hidden";

  const canEditOwn = post.isMine;
  const canModerate = canManagePost;

  const item = (key: string, label: string, onClick: () => void) => (
    <button
      key={key}
      type="button"
      role="menuitem"
      data-testid={`post-menu-${key}`}
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className="w-full rounded px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {label}
    </button>
  );

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("post.menu.trigger")}
        data-testid="post-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="post-menu"
          className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-md"
        >
          {/* Không cần quyền — đối chứng "menu không rỗng" của ca C6. */}
          {item("copy-link", t("post.menu.copyLink"), actions.onCopyLink)}

          {(canEditOwn || canModerate) && item("edit", t("post.menu.edit"), actions.onEdit)}
          {(canEditOwn || canModerate) && item("delete", t("post.menu.delete"), actions.onDelete)}

          {canModerate &&
            item(
              "toggle-hidden",
              isHidden ? t("post.menu.unhide") : t("post.menu.hide"),
              actions.onToggleHidden,
            )}
          {canModerate &&
            item(
              "toggle-comments",
              post.commentsLocked ? t("post.menu.unlockComments") : t("post.menu.lockComments"),
              actions.onToggleComments,
            )}

          {/* 🔴 `manage:feed-news` — KHÔNG phải `manage:feed-post`. Xem bảng gate ở đầu file. */}
          {canManageNews &&
            item(
              "toggle-pinned",
              post.pinned ? t("post.menu.unpin") : t("post.menu.pin"),
              actions.onTogglePinned,
            )}
        </div>
      )}
    </div>
  );
}
