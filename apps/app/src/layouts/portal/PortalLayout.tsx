/**
 * S16-SOCIAL-FE-1 — `PortalLayout`: khung cổng thông tin 3 cột (UI-07 §34b.3, plan D4).
 *
 * KHÔNG phải bản sao của `ModuleWorkspaceLayout`. Khác ở đúng ba điểm, và cả ba đều do UI-07 §34b
 * chốt bằng con số:
 *   1. **Ba cột** `240px / ≤680px / 300px` thay vì hai cột sidebar+main.
 *   2. **<1024px: rail trái thành tab ngang** (`PortalLeftRail` tự đổi hình dạng), KHÔNG drawer.
 *   3. **Rail phải rơi xuống CUỐI** trên màn hẹp — bằng thứ tự DOM tự nhiên, không bằng CSS.
 *
 * ┌─ VÌ SAO KHÔNG CÓ MỘT DÒNG `order-*` NÀO ─────────────────────────────────────────────────────┐
 * │ Thứ tự DOM được đặt thẳng là `leftRail → children → rightRail`, đúng thứ tự muốn đọc trên màn │
 * │ hẹp. Nếu thay bằng `order-*` để sắp lại trên desktop thì thứ tự **tab-focus** (đi theo DOM) sẽ │
 * │ lệch thứ tự **nhìn thấy** (đi theo `order`) — người dùng bàn phím nhảy lung tung giữa ba cột.  │
 * │ Đây là ràng buộc a11y, không phải sở thích: đừng "dọn" nó đi.                                 │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Ô tìm kiếm đặt ở ĐÂY, không phải `GlobalTopbar`** (plan finding #8): nhét nó vào topbar toàn
 * cục là thêm một thay đổi cho 13 module không liên quan, đổi lấy đúng một tính năng của SOCIAL.
 * `searchSlot` giữ hồi quy ở mức 0.
 */
import * as React from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@mediaos/ui";

interface PortalLayoutProps {
  /** Rail trái — tự đổi giữa sidebar dọc (≥1024px) và tab ngang (<1024px). */
  leftRail: React.ReactNode;
  /** Rail phải — các khối widget. Vắng ⇒ cột phải không render (grid vẫn đúng ở hai cột còn lại). */
  rightRail?: React.ReactNode;
  /** Ô tìm kiếm / hành động ở đầu cột giữa. */
  searchSlot?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function PortalLayout({
  leftRail,
  rightRail,
  searchSlot,
  children,
  className,
}: PortalLayoutProps): React.ReactElement {
  const { t } = useTranslation("social");

  // Cuộn nằm TRONG <main> (không phải document) ⇒ router không tự đưa về đầu khi đổi route. Giữ đúng
  // hành vi của `ModuleWorkspaceLayout`. typeof-guard vì jsdom không có `Element.scrollTo`.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const mainRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (typeof mainRef.current?.scrollTo === "function") {
      mainRef.current.scrollTo({ top: 0 });
    }
  }, [pathname]);

  return (
    <div
      data-testid="portal-layout"
      className={cn(
        "grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-[240px_minmax(0,1fr)_300px] lg:gap-6 lg:overflow-hidden lg:px-6",
        className,
      )}
    >
      {/* 1/3 — rail trái. Trên màn hẹp chính node này render ra thanh tab ngang dính trên. */}
      {leftRail}

      {/* 2/3 — cột giữa: vùng cuộn DUY NHẤT ở desktop; đổi route ⇒ về đầu. */}
      <main
        ref={mainRef}
        aria-label={t("portal.mainAria")}
        data-testid="portal-main"
        className="min-w-0 py-4 lg:overflow-y-auto lg:[scrollbar-gutter:stable]"
      >
        <div className="mx-auto w-full max-w-[680px] px-3 lg:px-0">
          {searchSlot ? <div className="mb-4">{searchSlot}</div> : null}
          {children}
        </div>
      </main>

      {/*
        3/3 — rail phải. Đứng CUỐI trong DOM nên trên <1024px nó tự rơi xuống dưới cột giữa: đúng thứ
        tự muốn đọc, và không cần `order-*` (xem docblock đầu file).
      */}
      {rightRail ? <div className="px-3 lg:overflow-y-auto lg:px-0">{rightRail}</div> : null}
    </div>
  );
}
