/**
 * S16-SOCIAL-FE-3C (L6) — «dải ô liên kết nhanh» ở đầu cột giữa của bảng tin (SPEC-16 SC-14 · UI-07 §34b.2).
 *
 * Một hàng ô đưa người đọc bảng tin sang các app nghiệp vụ họ ĐƯỢC DÙNG. Ô nào hiện là việc của
 * `pickQuickLinkApps` (registry + quyền — xem `lib/quick-links.ts`); file này chỉ lo vẽ và mở.
 *
 * HAI loại ô, phân biệt bằng CHÍNH map `cross-domain-apps.ts` mà AppSwitcher dùng (không có danh sách thứ hai):
 *  · app nội bộ ⇒ `<Link>` tới `defaultRoute`;
 *  · app ở tên miền khác (LMS · Đăng bài Facebook) ⇒ NÚT gọi opener: lấy token SSO ngay lúc bấm rồi rời SPA.
 *    Cầu SSO lỗi ⇒ opener gọi `fallback` ⇒ điều hướng tới trang trung chuyển của app, nơi hiện lý do đọc
 *    được. Ô loại này mang dấu ↗ và tên trợ năng «‹tên› (mở ứng dụng ngoài)» (UI-07 §34b.6).
 *
 * 0 ô ⇒ trả `null`: không khung, không tên — người chỉ có quyền bảng tin thấy màn y như trước khi có dải.
 *
 * Không query, không trạng thái tải / lỗi: registry + `capabilities` đã nằm trong bộ nhớ từ lúc đăng nhập.
 */
import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { APP_REGISTRY, useAuthStore, type AppRegistryItem } from "@mediaos/web-core";
import { cn } from "@mediaos/ui";
import { getCrossDomainOpener } from "@/layouts/home/cross-domain-apps";
import { buildPortalPermissionChecker, buildPortalSession } from "@/layouts/portal/portal-session";
import { DynamicIcon } from "@/layouts/workspace/DynamicIcon";
import { pickQuickLinkApps } from "../lib/quick-links";

/** Link và nút dùng CHUNG một bộ class ⇒ hai loại ô trông y hệt nhau, chỉ khác dấu ↗. */
const TILE_CLASS = cn(
  "relative flex h-full w-full cursor-pointer flex-col items-center gap-1.5 px-2 py-2.5",
  "rounded-lg border border-border bg-card text-center text-xs font-medium text-foreground",
  "transition-colors hover:bg-accent",
  // Vòng focus vẽ VÀO TRONG ô: hàng ô là vùng cuộn ngang, vòng ngoài sẽ bị mép vùng cuộn cắt mất.
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
);

function QuickLinkTile({ app }: { app: AppRegistryItem }): React.ReactElement {
  const { t } = useTranslation("social");
  const navigate = useNavigate();
  const name = t(app.nameKey, { ns: "nav" });
  const openCrossDomain = getCrossDomainOpener(app.appKey);

  const face = (
    <>
      {/* Icon là trang trí: tên ô đã đứng ngay dưới, không để trình đọc màn hình đọc thêm một hình vô danh. */}
      <span
        aria-hidden="true"
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"
      >
        <DynamicIcon name={app.icon} className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <span className="line-clamp-2">{name}</span>
    </>
  );

  if (!openCrossDomain) {
    return (
      <Link to={app.defaultRoute} className={TILE_CLASS}>
        {face}
      </Link>
    );
  }

  return (
    <button
      type="button"
      aria-label={t("admin.quickLinks.external", { name })}
      // Opener là NEVER-THROW (hợp đồng ở `cross-domain-apps.ts`): lỗi đi qua `fallback`, không qua reject.
      onClick={() => void openCrossDomain(() => void navigate({ to: app.defaultRoute }))}
      className={TILE_CLASS}
    >
      {face}
      <ArrowUpRight
        aria-hidden="true"
        data-testid="quick-link-external-mark"
        className="absolute right-1.5 top-1.5 h-3 w-3 text-muted-foreground"
      />
    </button>
  );
}

export function QuickLinkStrip(): React.ReactElement | null {
  const { t } = useTranslation("social");
  /**
   * 🔴 ĐĂNG KÝ vào `capabilities`. Hai hàm dựng bên dưới đọc store bằng `getState()` — không đăng ký gì — nên
   * thiếu dòng này thì dải đứng im với bộ quyền của lượt vẽ đầu: `/auth/me` nạp lại giữa phiên (quyền mới
   * được cấp, hoặc bị thu) không làm ô hiện ra / biến mất. Giá trị trả về cố ý không dùng: thứ cần là lượt
   * vẽ lại, còn luật quyền vẫn ở đúng một chỗ (`buildPortalPermissionChecker` → checker khớp ĐÚNG-BẰNG của
   * web-core, không wildcard — cùng luật với AppSwitcher và lưới Home).
   */
  useAuthStore((state) => state.capabilities);
  const apps = pickQuickLinkApps(
    APP_REGISTRY,
    buildPortalSession(),
    buildPortalPermissionChecker(),
  );

  if (apps.length === 0) return null;

  return (
    <nav aria-label={t("admin.quickLinks.aria")}>
      {/* Một hàng: ô chia đều chỗ khi vừa (5–7rem mỗi ô), không vừa thì cuộn ngang — không xuống dòng. */}
      <ul className="grid grid-flow-col auto-cols-[minmax(5rem,7rem)] gap-2 overflow-x-auto">
        {apps.map((app) => (
          <li key={app.appKey}>
            <QuickLinkTile app={app} />
          </li>
        ))}
      </ul>
    </nav>
  );
}
