/**
 * S16-SOCIAL-FE-1 — `PortalLayout` / `PortalLeftRail` / `PortalTabBar` / `PortalRightRail`.
 *
 * Phủ ca **C1** (3 cột · cột giữa ≤680 · thứ tự DOM · tab ngang thay drawer) và **C13** (loading là
 * skeleton từng khối; lỗi nằm TRONG cột giữa, hai rail còn nguyên).
 *
 * ┌─ 🔴 BREAKPOINT ĐƯỢC ĐO QUA LỚP CSS, KHÔNG QUA LAYOUT THẬT — đọc trước khi tin ca này ─────────┐
 * │ jsdom **không có layout engine**: không có `@media`, `getBoundingClientRect` trả 0, nên KHÔNG   │
 * │ thể assert "ở 1200px thì thấy 3 cột, ở 800px thì thấy 1 cột". Điều ca C1 đo được thật là        │
 * │ **hợp đồng markup**: node nào mang lớp `lg:*` / `hidden` / `lg:hidden` nào, và thứ tự DOM.      │
 * │ Đó vẫn là răng thật cho đúng hai lỗi dễ xảy ra nhất (gõ sai con số grid; đảo thứ tự DOM hoặc    │
 * │ thêm `order-*`), nhưng nó KHÔNG chứng minh giao diện hiển thị đúng ở một bề rộng cụ thể.        │
 * │ Muốn vế đó thì cần E2E trình duyệt thật — ghi nợ, đừng đọc ca này rộng hơn thứ nó đo.           │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type { ReactNode } from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortalLayout } from "./PortalLayout";
import { PortalLeftRail } from "./PortalLeftRail";
import { PortalTabBar } from "./PortalTabBar";
import { PortalRightRail, PortalWidgetBlock } from "./PortalRightRail";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: "/feed" } }),
  };
});

// i18n: trả thẳng KHOÁ để ca đọc được mà không phụ thuộc bản dịch. Nếu một ngày chuỗi vi đổi chữ,
// ca này vẫn đo đúng thứ nó định đo (cấu trúc), không đỏ oan vì một dấu phẩy.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const { SOCIAL_ITEMS } = vi.hoisted(() => ({
  SOCIAL_ITEMS: [
    {
      sidebarKey: "social.feed",
      moduleCode: "SOCIAL",
      label: "Bảng tin",
      path: "/feed",
      icon: "rss",
      group: "overview",
      order: 10,
      requiredAnyPermissions: ["view:feed"],
    },
    {
      sidebarKey: "social.news",
      moduleCode: "SOCIAL",
      label: "Tin tức",
      path: "/feed/news",
      icon: "megaphone",
      group: "overview",
      order: 20,
      requiredAnyPermissions: ["view:feed"],
    },
  ],
}));

vi.mock("@/layouts/workspace/sidebar-registry", () => ({
  getSidebarItems: () => SOCIAL_ITEMS,
}));
vi.mock("@/layouts/workspace/sidebar-extensions", () => ({
  getSidebarExtension: () => undefined,
}));

/**
 * Auth store giả. `capabilities` để **có thể thay giữa chừng** (ca cuối hạ quyền xuống rỗng) — vì
 * vậy nó là object mutable chứ không phải hằng đóng băng trong factory của `vi.mock`.
 */
const STORE_STATE = {
  isAuthenticated: true,
  user: { id: "u1", companyId: "c1", email: "an@acme.vn", fullName: "An Nguyễn", status: "Active" },
  capabilities: { "view:feed": true } as Record<string, boolean>,
};

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  const useAuthStore = Object.assign(
    (selector: (s: typeof STORE_STATE) => unknown) => selector(STORE_STATE),
    { getState: () => STORE_STATE },
  );
  return { ...actual, useAuthStore };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPortal(opts?: { rightRail?: ReactNode; children?: ReactNode }) {
  return render(
    <PortalLayout
      leftRail={<PortalLeftRail moduleCode="SOCIAL" />}
      rightRail={
        opts?.rightRail ?? (
          <PortalRightRail>
            <PortalWidgetBlock title="Sinh nhật">
              <p>ai đó</p>
            </PortalWidgetBlock>
          </PortalRightRail>
        )
      }
    >
      {opts?.children ?? <article data-testid="feed-content">bảng tin</article>}
    </PortalLayout>,
  );
}

describe("C1 — PortalLayout: khung 3 cột (UI-07 §34b.3 · plan D4)", () => {
  it("ALLOW: grid khai ĐÚNG ba con số 240/1fr/300 và cột giữa chặn ở 680px", () => {
    const { container } = renderPortal();
    const grid = screen.getByTestId("portal-layout");

    // Ba con số này do UI-07 §34b.3 chốt. Ghim chúng bằng chuỗi lớp: gõ nhầm một số là ĐỎ ngay,
    // chứ không phải "trông hơi lệch" mà không ai nhận ra khi review diff.
    expect(grid.className).toContain("lg:grid-cols-[240px_minmax(0,1fr)_300px]");
    expect(grid.className).toContain("grid-cols-1");

    const middle = container.querySelector('[data-testid="portal-main"] > div');
    expect(middle?.className).toContain("max-w-[680px]");
  });

  it("ALLOW: rail trái ≥1024px rộng đúng 240px (w-60) và ẩn dưới đó", () => {
    const { container } = renderPortal();
    const desktopRail = container.querySelector(".w-60");
    expect(desktopRail).not.toBeNull();
    expect(desktopRail?.className).toContain("hidden");
    expect(desktopRail?.className).toContain("lg:flex");
  });

  it("DENY (đối chứng <1024px): rail trái có bản TAB NGANG dính trên — KHÔNG phải drawer", () => {
    renderPortal();
    const tabBar = screen.getByTestId("portal-tab-bar");

    // UI-07 §34b.3 loại drawer tường minh. Hai điều phải đúng cùng lúc: nó là thanh dính trên có
    // cuộn ngang, và nó CHỈ hiện dưới 1024px.
    expect(tabBar.className).toContain("sticky");
    expect(tabBar.className).toContain("overflow-x-auto");
    expect(tabBar.className).toContain("lg:hidden");
    expect(within(tabBar).getByText("Bảng tin")).toBeInTheDocument();
    expect(within(tabBar).getByText("Tin tức")).toBeInTheDocument();
  });

  it("DENY (đối chứng): rail PHẢI là node CUỐI trong DOM — và KHÔNG có `order-*` ở đâu cả", () => {
    const { container } = renderPortal();
    const grid = screen.getByTestId("portal-layout");
    const main = screen.getByTestId("portal-main");
    const rightRail = screen.getByTestId("portal-right-rail");

    // (a) thứ tự DOM thật: feed đứng TRƯỚC rail phải.
    expect(main.compareDocumentPosition(rightRail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // (b) rail phải là con CUỐI của grid ⇒ trên màn hẹp nó tự rơi xuống dưới, không cần CSS.
    expect(grid.lastElementChild?.contains(rightRail)).toBe(true);

    /**
     * (c) Vế QUAN TRỌNG NHẤT của ca này. Nếu ai đó sắp lại bằng `order-*` thì (a) và (b) vẫn có thể
     * xanh trong khi thứ tự tab-focus đã lệch thứ tự nhìn thấy — đúng lỗi a11y mà D4 dựng ra để
     * tránh. Quét CẢ cây, không chỉ ba node trên.
     */
    const withOrderClass = Array.from(container.querySelectorAll<HTMLElement>("*")).filter((el) =>
      /(^|\s)(lg:|md:|sm:)?order-/.test(el.className || ""),
    );
    expect(withOrderClass.map((el) => el.className)).toEqual([]);
  });

  it("thứ tự tab-focus đi đúng thứ tự DOM: rail trái → cột giữa → rail phải", () => {
    renderPortal({
      children: (
        <article data-testid="feed-content">
          <button type="button">Nút trong feed</button>
        </article>
      ),
    });
    const focusables = Array.from(
      document.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
    );
    const idxProfile = focusables.findIndex((el) => el.textContent === "portal.myProfile");
    const idxFeedBtn = focusables.findIndex((el) => el.textContent === "Nút trong feed");

    expect(idxProfile).toBeGreaterThanOrEqual(0);
    expect(idxFeedBtn).toBeGreaterThan(idxProfile);
  });

  it("KHÔNG có rail phải ⇒ layout vẫn dựng được, không render khung rỗng", () => {
    render(
      <PortalLayout leftRail={<PortalLeftRail moduleCode="SOCIAL" />}>
        <p>chỉ có feed</p>
      </PortalLayout>,
    );
    expect(screen.queryByTestId("portal-right-rail")).toBeNull();
    expect(screen.getByTestId("portal-main")).toBeInTheDocument();
  });
});

describe("C13 — loading / lỗi nằm ĐÚNG chỗ", () => {
  it("loading: skeleton nằm TRONG khối widget (từng khối một), hai rail vẫn còn", () => {
    renderPortal({
      rightRail: (
        <PortalRightRail>
          <PortalWidgetBlock title="Sinh nhật" isLoading>
            <p>không được hiện</p>
          </PortalWidgetBlock>
          <PortalWidgetBlock title="Tin nổi bật">
            <p>tin A</p>
          </PortalWidgetBlock>
        </PortalRightRail>
      ),
    });

    // Một khối đang tải KHÔNG kéo khối kia vào trạng thái chờ — đúng UI-07 §34b.5.
    expect(screen.getAllByTestId("portal-widget-skeleton")).toHaveLength(1);
    expect(screen.queryByText("không được hiện")).toBeNull();
    expect(screen.getByText("tin A")).toBeInTheDocument();
    expect(screen.getByTestId("portal-tab-bar")).toBeInTheDocument();
  });

  it("lỗi của MỘT widget không làm trắng rail phải; widget còn lại vẫn render", () => {
    renderPortal({
      rightRail: (
        <PortalRightRail>
          <PortalWidgetBlock title="Sinh nhật" errorText="social.state.errorBody">
            <p>không được hiện</p>
          </PortalWidgetBlock>
          <PortalWidgetBlock title="Tin nổi bật">
            <p>tin A</p>
          </PortalWidgetBlock>
        </PortalRightRail>
      ),
    });

    expect(screen.getByText("social.state.errorBody")).toBeInTheDocument();
    expect(screen.queryByText("không được hiện")).toBeNull();
    expect(screen.getByText("tin A")).toBeInTheDocument();
    expect(screen.getByTestId("portal-right-rail")).toBeInTheDocument();
  });

  it("khối lỗi do FEED gây ra nằm TRONG cột giữa, hai rail KHÔNG bị ảnh hưởng", () => {
    renderPortal({
      children: (
        <div data-testid="feed-error">
          <p>social.state.errorTitle</p>
          <button type="button">social.state.retry</button>
        </div>
      ),
    });

    const main = screen.getByTestId("portal-main");
    expect(main.contains(screen.getByTestId("feed-error"))).toBe(true);
    expect(screen.getByRole("button", { name: "social.state.retry" })).toBeInTheDocument();
    expect(screen.getByTestId("portal-right-rail")).toBeInTheDocument();
    expect(screen.getByTestId("portal-tab-bar")).toBeInTheDocument();
  });
});

describe("PortalTabBar — cùng MỘT nguồn mục với rail trái", () => {
  it("không mục nào thấy được ⇒ KHÔNG vẽ thanh rỗng (trả null)", () => {
    // Người không có `view:feed`: `filterSidebarItems` cắt sạch ⇒ thanh phải biến mất hoàn toàn,
    // không phải một dải trống cao 48px đẩy nội dung xuống. Đây là vế DENY của C2 ở tầng khung:
    // «forbidden = ẨN mục», không phải «hiện rồi báo lỗi» (SPEC-16 §14).
    const prev = STORE_STATE.capabilities;
    STORE_STATE.capabilities = {};
    try {
      render(<PortalTabBar moduleCode="SOCIAL" />);
      expect(screen.queryByTestId("portal-tab-bar")).toBeNull();
    } finally {
      STORE_STATE.capabilities = prev;
    }
  });
});
