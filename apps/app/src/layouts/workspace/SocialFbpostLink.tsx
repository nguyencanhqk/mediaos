import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { useCan } from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import { openSocial } from "@/routes/social/open-social";

/**
 * SocialFbpostLink — mục CUỐI của rail SOCIAL: «Đăng bài Facebook» (S16-SOCIAL-FBPOST-1 · SOC-DEC-002).
 *
 * Vì sao là component trong khe `sidebar-extensions.ts` chứ không phải một `SidebarItemMeta`:
 * `ModuleSidebar` render mọi mục tĩnh bằng `<Link to={item.path}>` — không có khái niệm "liên kết
 * NGOÀI"/onClick. Đây là app CROSS-DOMAIN: đường thường là lấy token SSO NGAY lúc bấm rồi `assign`
 * sang fbpost (`openSocial`), KHÔNG điều hướng nội bộ. Thêm trường vào `SidebarItemMeta` sẽ chạm cả
 * 13 module + hai snapshot `sidebar-tree.*.txt` đang ghim cây, nên dùng khe có sẵn.
 *
 * Gate = `view:social-post` HOẶC `manage:social-account` — 2 trong 3 cặp `social-*` CŨ (S9), KHÔNG
 * phải cặp `feed-*` nào: fbpost là tiện ích con, quyền của nó độc lập với quyền bảng tin.
 *
 * Fallback giữ Y HỆT hành vi cũ của ô Home: lỗi (mạng · 503 cầu SSO chưa cấu hình · 403 công ty chưa
 * bật · 401 hết phiên) → điều hướng `/social`, nơi `SocialRedirectPage` hiện lý do ĐỌC ĐƯỢC và cho thử
 * lại. Không có nhánh nào nuốt lỗi im lặng — module SOCIAL vốn không có hệ toast (đo ở FE-1).
 *
 * ⚠️ Mục này KHÔNG hiện khi sidebar thu gọn: `ModuleSidebar` render khe extension dưới điều kiện
 * `!collapsed`. Đường vào luôn-có cho cả ca đó (và cho người chỉ có `view:social-post`, không vào được
 * `/feed`) là entry `fbpost` trong AppSwitcher — xem `switcherOnly` ở `registry.ts`. ĐỪNG gỡ entry đó.
 */
export function SocialFbpostLink() {
  const { t } = useTranslation("nav");
  const navigate = useNavigate();
  const canViewPost = useCan("view", "social-post");
  const canManageAccount = useCan("manage", "social-account");

  if (!canViewPost && !canManageAccount) return null;

  return (
    <button
      type="button"
      onClick={() => void openSocial(() => void navigate({ to: "/social" }))}
      className={cn(
        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
        "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <ExternalLink className="size-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{t("app.fbpost")}</span>
    </button>
  );
}
