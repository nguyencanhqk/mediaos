/**
 * S16-SOCIAL-FE-3C (L6) — «dải ô liên kết nhanh» VẼ RA MÀN (plan §4 hàng Q1 · Q2 · Q3 · Q4 + vế vẽ của Q5).
 * Vế thuần (hằng · thứ tự · lọc `active`) ở `lib/quick-links.spec.ts`.
 *
 * Thứ file này giữ:
 *  · cổng của từng ô đi qua store THẬT + checker THẬT của web-core (khớp ĐÚNG-BẰNG): chỉ wildcard ⇒ 0 ô;
 *  · mỗi ca DENY mang fixture «gần đúng» (có cặp của ô KHÁC) nên dải vẫn sống trong chính ca đó — ca không
 *    xanh được với một dải không bao giờ vẽ gì;
 *  · ô nội bộ là LINK tới `defaultRoute`; ô ứng dụng ngoài (LMS · Đăng bài Facebook) là NÚT gọi opener của
 *    `cross-domain-apps.ts` THẬT — chỉ hai hàm cầu SSO bên dưới nó bị thay bằng spy.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Quyền là chuỗi cặp engine viết tay — fixture, không phải mã sản phẩm.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_REGISTRY } from "@mediaos/web-core";
import i18n from "@/i18n";
import { DynamicIcon } from "@/layouts/workspace/DynamicIcon";
import { openLms } from "@/routes/lms/open-lms";
import { openSocial } from "@/routes/social/open-social";
import { FEED_QUICK_LINK_APP_KEYS } from "../lib/quick-links";
import { resetCaps, setCaps } from "../social-test-doubles";
import { QuickLinkStrip } from "./QuickLinkStrip";

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    // `to` thành `href` để ca đọc được ĐÍCH; các thuộc tính còn lại (class · aria) giữ nguyên trên thẻ `<a>`.
    Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string }) => (
      <a href={to} {...rest}>
        {children}
      </a>
    ),
    useNavigate: () => navigateSpy,
  };
});

vi.mock("@/routes/lms/open-lms", () => ({ openLms: vi.fn() }));
vi.mock("@/routes/social/open-social", () => ({ openSocial: vi.fn() }));

const STRIP = "Liên kết nhanh";
const EXTERNAL_SUFFIX = " (mở ứng dụng ngoài)";
const EXTERNAL_MARK = "quick-link-external-mark";
const FALLBACK_ICON_CLASS = "lucide-circle";

/** Đủ quyền cho CẢ 7 ô — mỗi ô đúng (các) cặp registry đòi; «Phòng họp» cần HAI. */
const EVERY_CAP: Record<string, boolean> = {
  "view:feed": true,
  "read:task": true,
  "view-own:leave": true,
  "view-own:attendance": true,
  "access:room": true,
  "view:room": true,
  "access:goal": true,
  "access:lms": true,
  "view:social-post": true,
};

const renderStrip = () =>
  render(
    <I18nextProvider i18n={i18n}>
      <QuickLinkStrip />
    </I18nextProvider>,
  );

const queryStrip = (): HTMLElement | null => screen.queryByRole("navigation", { name: STRIP });

/** Chữ NHÌN THẤY của từng ô, theo thứ tự vẽ. Ném nếu dải không có mặt. */
const visibleNames = (): string[] =>
  within(screen.getByRole("navigation", { name: STRIP }))
    .getAllByRole("listitem")
    .map((item) => item.textContent ?? "");

beforeEach(() => {
  navigateSpy.mockReset();
  // Hợp đồng của opener: trả Promise, KHÔNG ném (`cross-domain-apps.ts`).
  vi.mocked(openLms).mockReset().mockResolvedValue(undefined);
  vi.mocked(openSocial).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  resetCaps();
});

describe("Q1 — dải chỉ vẽ khi có ít nhất một ô", () => {
  it("DENY: chỉ `view:feed` ⇒ dải KHÔNG render gì (không khung, không tên, không danh sách)", () => {
    setCaps({ "view:feed": true });
    const { container } = renderStrip();
    expect(queryStrip()).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("ALLOW: thêm `access:goal` ⇒ dải có tên trợ năng + đúng 1 ô «Mục tiêu» nằm trong danh sách", () => {
    setCaps({ "view:feed": true, "access:goal": true });
    renderStrip();
    expect(visibleNames()).toEqual(["Mục tiêu"]);
    const list = within(screen.getByRole("navigation", { name: STRIP })).getByRole("list");
    expect(within(list).getByRole("link", { name: "Mục tiêu" })).toHaveAttribute("href", "/goals");
  });

  it("quyền nạp SAU khi mount ⇒ dải tự hiện; thu quyền ⇒ dải tự biến mất (không cần mount lại)", () => {
    setCaps({ "view:feed": true });
    renderStrip();
    expect(queryStrip()).toBeNull();

    act(() => setCaps({ "view:feed": true, "access:goal": true }));
    expect(visibleNames()).toEqual(["Mục tiêu"]);

    act(() => setCaps({ "view:feed": true }));
    expect(queryStrip()).toBeNull();
  });
});

describe("Q2 — ô «Đăng bài Facebook» gác đúng MỘT cặp `view:social-post`", () => {
  const NEAR_MISS: Record<string, boolean> = {
    "view:feed": true,
    "access:goal": true,
    "create:social-post": true,
    "manage:social-account": true,
  };
  const FBPOST_TILE = `Đăng bài Facebook${EXTERNAL_SUFFIX}`;

  it("DENY: có hai cặp `social-*` KHÁC, thiếu `view:social-post` ⇒ KHÔNG ô (ô «Mục tiêu» vẫn có)", () => {
    setCaps(NEAR_MISS);
    renderStrip();
    expect(visibleNames()).toEqual(["Mục tiêu"]);
    expect(screen.queryByRole("button", { name: FBPOST_TILE })).toBeNull();
  });

  it("ALLOW: thêm `view:social-post` ⇒ CÓ ô, dù registry đánh dấu ô này `switcherOnly`", () => {
    setCaps({ ...NEAR_MISS, "view:social-post": true });
    renderStrip();
    expect(visibleNames()).toEqual(["Mục tiêu", "Đăng bài Facebook"]);
    expect(screen.getByRole("button", { name: FBPOST_TILE })).toBeInTheDocument();
  });
});

describe("Q3 — ô «Phòng họp» cần ĐỦ hai cặp; wildcard KHÔNG mở ô nào", () => {
  it.each([
    ["chỉ `access:room`", "access:room"],
    ["chỉ `view:room`", "view:room"],
  ])("DENY: %s ⇒ KHÔNG ô «Phòng họp» (ô «Mục tiêu» vẫn có)", (_label, onlyPair) => {
    setCaps({ "view:feed": true, "access:goal": true, [onlyPair]: true });
    renderStrip();
    expect(visibleNames()).toEqual(["Mục tiêu"]);
  });

  it("ALLOW: đủ `access:room` + `view:room` ⇒ CÓ ô «Phòng họp» trỏ `/rooms`", () => {
    setCaps({ "view:feed": true, "access:goal": true, "access:room": true, "view:room": true });
    renderStrip();
    expect(visibleNames()).toEqual(["Phòng họp", "Mục tiêu"]);
    expect(screen.getByRole("link", { name: "Phòng họp" })).toHaveAttribute("href", "/rooms");
  });

  it.each<[string, Record<string, boolean>]>([
    ["chỉ `*:*`", { "*:*": true }],
    [
      "mọi dạng wildcard, không cặp đích danh nào",
      {
        "*:*": true,
        "access:*": true,
        "view:*": true,
        "read:*": true,
        "view-own:*": true,
        "*:room": true,
        "*:goal": true,
        "*:lms": true,
        "*:task": true,
        "*:social-post": true,
      },
    ],
  ])("DENY: %s ⇒ 0 ô, dải không render", (_label, caps) => {
    setCaps(caps);
    const { container } = renderStrip();
    expect(queryStrip()).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("ALLOW (cùng khung): `*:*` + cặp ĐÍCH DANH `access:goal` ⇒ đúng 1 ô «Mục tiêu»", () => {
    setCaps({ "*:*": true, "access:goal": true });
    renderStrip();
    expect(visibleNames()).toEqual(["Mục tiêu"]);
  });
});

describe("Q4 — ô nội bộ là liên kết; ô ứng dụng ngoài mở qua cầu SSO", () => {
  beforeEach(() => setCaps(EVERY_CAP));

  it.each([
    ["Công việc", "/tasks/my-tasks"],
    ["Nghỉ phép", "/leave/me/requests"],
    ["Chấm công", "/attendance/today"],
    ["Phòng họp", "/rooms"],
    ["Mục tiêu", "/goals"],
  ])("ô nội bộ «%s» là link tới `%s`, không mang dấu ↗", (name, href) => {
    renderStrip();
    const tile = screen.getByRole("link", { name });
    expect(tile).toHaveAttribute("href", href);
    expect(within(tile).queryByTestId(EXTERNAL_MARK)).toBeNull();
  });

  it.each([
    ["Đào tạo", openLms, openSocial],
    ["Đăng bài Facebook", openSocial, openLms],
  ])(
    "ô ngoài «%s»: NÚT tên «… (mở ứng dụng ngoài)» + dấu ↗; bấm ⇒ opener 1 lần, KHÔNG điều hướng nội bộ",
    async (name, opener, otherOpener) => {
      renderStrip();
      const tile = screen.getByRole("button", { name: `${name}${EXTERNAL_SUFFIX}` });
      expect(within(tile).getByTestId(EXTERNAL_MARK)).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: new RegExp(name) })).toBeNull();

      fireEvent.click(tile);
      await waitFor(() => expect(opener).toHaveBeenCalledTimes(1));
      expect(otherOpener).not.toHaveBeenCalled();
      expect(navigateSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["Đào tạo", openLms, "/lms"],
    ["Đăng bài Facebook", openSocial, "/social"],
  ])(
    "ô ngoài «%s»: cầu SSO lỗi (opener gọi fallback) ⇒ điều hướng về trang trung chuyển của app",
    async (name, opener, transitRoute) => {
      // Đúng hợp đồng NEVER-THROW của opener: lỗi ⇒ gọi fallback, không ném ra ngoài.
      vi.mocked(opener).mockImplementation(async (onFallback: () => void) => {
        onFallback();
      });
      renderStrip();
      fireEvent.click(screen.getByRole("button", { name: `${name}${EXTERNAL_SUFFIX}` }));
      await waitFor(() => expect(navigateSpy).toHaveBeenCalledTimes(1));
      expect(navigateSpy).toHaveBeenCalledWith({ to: transitRoute });
    },
  );

  it("đủ quyền ⇒ đúng 5 link nội bộ + 2 nút ứng dụng ngoài; chỉ hai nút đó mang dấu ↗", () => {
    renderStrip();
    const strip = within(screen.getByRole("navigation", { name: STRIP }));
    expect(strip.getAllByRole("link")).toHaveLength(5);
    expect(strip.getAllByRole("button")).toHaveLength(2);
    expect(strip.getAllByTestId(EXTERNAL_MARK)).toHaveLength(2);
  });
});

describe("Q5 — thứ tự vẽ = thứ tự SC-14, tên lấy từ i18n thật", () => {
  it("đủ quyền ⇒ 7 ô đúng thứ tự viết tay (không theo `order` của registry)", () => {
    setCaps(EVERY_CAP);
    renderStrip();
    expect(visibleNames()).toEqual([
      "Công việc",
      "Nghỉ phép",
      "Chấm công",
      "Phòng họp",
      "Mục tiêu",
      "Đào tạo",
      "Đăng bài Facebook",
    ]);
  });
});

describe("icon của từng ô", () => {
  /** Lớp `lucide-<tên>` của một `<svg>` — danh tính của HÌNH, không phụ thuộc kích thước hay màu. */
  const iconTokenIn = (svg: Element | null): string | undefined =>
    Array.from(svg?.classList ?? []).find((cls) => cls.startsWith("lucide-"));

  /** Hình mà `DynamicIcon` vẽ cho một tên icon của registry. */
  const iconTokenOf = (name: string): string | undefined => {
    const { container, unmount } = render(<DynamicIcon name={name} />);
    const token = iconTokenIn(container.querySelector("svg"));
    unmount();
    return token;
  };

  /** App của dải, đúng thứ tự hằng — nguồn icon kỳ vọng là registry, không phải bảng viết tay. */
  const stripApps = () =>
    FEED_QUICK_LINK_APP_KEYS.flatMap((key) => APP_REGISTRY.filter((app) => app.appKey === key));

  it("mọi app của dải có `icon` KHAI trong ICON_MAP (thiếu ⇒ vòng tròn mặc định, không cổng nào bắt)", () => {
    // Đối chứng cho phép đo: tên không tồn tại ⇒ vòng tròn mặc định; tên có thật ⇒ không phải.
    expect(iconTokenOf("khong-co-icon-nay")).toBe(FALLBACK_ICON_CLASS);
    expect(iconTokenOf("target")).not.toBe(FALLBACK_ICON_CLASS);

    const apps = stripApps();
    expect(apps).toHaveLength(7);
    const unmapped = apps
      .filter((app) => iconTokenOf(app.icon) === FALLBACK_ICON_CLASS)
      .map((app) => `${app.appKey} → ${app.icon}`);
    expect(unmapped).toEqual([]);
  });

  it("mỗi ô VẼ đúng icon registry khai cho app ĐÓ, và icon ẩn với trình đọc màn hình", () => {
    setCaps(EVERY_CAP);
    renderStrip();
    const items = within(screen.getByRole("navigation", { name: STRIP })).getAllByRole("listitem");
    expect(items).toHaveLength(7);

    const expected = stripApps().map((app) => iconTokenOf(app.icon));
    // Bảy app, bảy HÌNH khác nhau — không thì một icon cố định cho mọi ô cũng qua được phép so dưới.
    expect(new Set(expected).size).toBe(7);

    // Icon của app là `<svg>` ĐẦU TIÊN trong ô (dấu ↗ của ô ngoài đứng sau nó).
    expect(items.map((item) => iconTokenIn(item.querySelector("svg")))).toEqual(expected);
    for (const item of items) {
      expect(item.querySelector("svg")?.closest("[aria-hidden='true']")).not.toBeNull();
    }
  });
});
