/**
 * S16-SOCIAL-FE-3 (L2) — màn Kiểm duyệt `SOC-SCREEN-010`: NHÓM CA TAB — G4 (tab «Bài đang ẩn» ⇔
 * `manage:feed-post`), thanh tab đúng ARIA, đổi tab ghi `tab` lên URL (tab mặc định không ghi).
 * Nội dung của tab «Bài đang ẩn» đo ở `components/HiddenPostsTab.spec.tsx`.
 *
 * Search của route là bản GIẢ CÓ PHẢN ỨNG (`routeSearchDouble`). i18n THẬT, chữ kỳ vọng VIẾT TAY.
 */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import {
  ADMIN_ERR,
  makeHiddenPost,
  makeHiddenPostPage,
  makeReport,
  makeReportPage,
  routeSearchDouble,
} from "../admin/admin-test-doubles";
import { ModerationPage } from "./ModerationPage";

const listReports = vi.fn();
const listFeed = vi.fn();
const moderatePost = vi.fn();
const navigateSpy = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      listReports: (...a: unknown[]) => listReports(...a),
    },
    socialApi: {
      ...actual.socialApi,
      listFeed: (...a: unknown[]) => listFeed(...a),
      moderatePost: (...a: unknown[]) => moderatePost(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const doubles = await import("../admin/admin-test-doubles");
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => (options: { search?: unknown }) => {
      navigateSpy({ ...options, search: doubles.routeSearchDouble.navigate(options) });
    },
    useSearch: () => doubles.useRouteSearchDouble(),
  };
});

const FULL_MODERATOR = {
  "view:feed": true,
  "view:feed-report": true,
  "manage:feed-report": true,
  "manage:feed-post": true,
};
/** Xử lý được báo cáo nhưng KHÔNG kiểm duyệt được bài. */
const REPORT_ONLY = { "view:feed": true, "view:feed-report": true, "manage:feed-report": true };

const TABLIST = "Các mục kiểm duyệt";
const TAB_REPORTS = "Báo cáo";
const TAB_HIDDEN = "Bài đang ẩn";
const REPORT_LIST = "Danh sách báo cáo vi phạm";
const HIDDEN_LIST = "Danh sách bài đang ẩn";

const tab = (name: string): HTMLElement => screen.getByRole("tab", { name });
const reportList = (): Promise<HTMLElement> => screen.findByRole("list", { name: REPORT_LIST });
const hiddenList = (): Promise<HTMLElement> => screen.findByRole("list", { name: HIDDEN_LIST });
const lastNavigation = (): { to?: string; search?: Record<string, unknown> } =>
  navigateSpy.mock.calls.at(-1)?.[0] ?? {};

function renderPage(search: Record<string, unknown> = {}) {
  routeSearchDouble.set(search);
  return renderWithProviders(<ModerationPage />);
}

beforeEach(() => {
  setCaps(FULL_MODERATOR);
  listReports.mockReset();
  listFeed.mockReset();
  moderatePost.mockReset();
  navigateSpy.mockReset();
  listReports.mockImplementation(() => Promise.resolve(makeReportPage([makeReport()])));
  listFeed.mockImplementation(() => Promise.resolve(makeHiddenPostPage([makeHiddenPost()])));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
});

describe("G4 — tab «Bài đang ẩn» ⇔ `manage:feed-post`", () => {
  it("ALLOW + `?tab=hidden`: tab được chọn (`aria-selected`), gọi 001 `{ status: hidden }`, KHÔNG gọi 028", async () => {
    renderPage({ tab: "hidden" });

    expect(within(await hiddenList()).getAllByRole("listitem")).toHaveLength(1);
    expect(tab(TAB_HIDDEN)).toHaveAttribute("aria-selected", "true");
    expect(tab(TAB_REPORTS)).toHaveAttribute("aria-selected", "false");
    expect(listFeed).toHaveBeenCalledTimes(1);
    expect(listFeed.mock.calls[0]?.[0]).toStrictEqual({ status: "hidden", sort: "latest" });
    expect(listReports).not.toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: REPORT_LIST })).toBeNull();
  });

  it("DENY thiếu `manage:feed-post` + `?tab=hidden`: KHÔNG có tab, rơi về hàng đợi báo cáo, 001 0 lần", async () => {
    setCaps(REPORT_ONLY);
    renderPage({ tab: "hidden" });

    // Nhịp chờ: hàng đợi báo cáo (028) đã về ⇒ nếu 001 có được gọi thì cũng đã gọi rồi.
    expect(within(await reportList()).getAllByTestId("report-row")).toHaveLength(1);
    expect(listReports).toHaveBeenCalledTimes(1);
    expect(listFeed).not.toHaveBeenCalled();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText(TAB_HIDDEN)).toBeNull();
    expect(screen.queryByRole("list", { name: HIDDEN_LIST })).toBeNull();
  });

  it("ALLOW, URL không có `tab`: tab «Báo cáo» được chọn, 001 0 lần cho tới khi mở tab kia", async () => {
    renderPage();

    await reportList();
    expect(tab(TAB_REPORTS)).toHaveAttribute("aria-selected", "true");
    expect(tab(TAB_HIDDEN)).toHaveAttribute("aria-selected", "false");
    expect(listFeed).not.toHaveBeenCalled();
  });
});

describe("Thanh tab — ARIA + URL", () => {
  it("`tablist` có tên, đúng 2 tab theo thứ tự; tấm đang mở là `tabpanel` mang tên của tab được chọn", async () => {
    renderPage();
    await reportList();

    const tablist = screen.getByRole("tablist", { name: TABLIST });
    expect(
      within(tablist)
        .getAllByRole("tab")
        .map((el) => el.textContent),
    ).toEqual([TAB_REPORTS, TAB_HIDDEN]);
    const panel = screen.getByRole("tabpanel", { name: TAB_REPORTS });
    expect(tab(TAB_REPORTS)).toHaveAttribute("aria-controls", panel.id);
    expect(panel.id.length).toBeGreaterThan(0);
    expect(within(panel).getByRole("list", { name: REPORT_LIST })).toBeInTheDocument();
    // Roving tabindex: chỉ tab đang chọn nằm trong thứ tự Tab của bàn phím.
    expect(tab(TAB_REPORTS)).toHaveAttribute("tabindex", "0");
    expect(tab(TAB_HIDDEN)).toHaveAttribute("tabindex", "-1");
  });

  it("bấm «Bài đang ẩn» ⇒ URL nhận `tab: hidden` (GIỮ bộ lọc + trang), tấm đổi và 001 được gọi", async () => {
    listReports.mockImplementation(() =>
      Promise.resolve(makeReportPage([makeReport()], { page: 2, total: 45 })),
    );
    renderPage({ status: "resolved", page: 2 });
    await reportList();

    fireEvent.click(tab(TAB_HIDDEN));

    expect(within(await hiddenList()).getAllByRole("listitem")).toHaveLength(1);
    expect(lastNavigation().to).toBe(".");
    expect(lastNavigation().search).toEqual({ tab: "hidden", status: "resolved", page: 2 });
    expect(tab(TAB_HIDDEN)).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: TAB_HIDDEN })).toBeInTheDocument();
    expect(listFeed).toHaveBeenCalledTimes(1);
  });

  it("bấm lại «Báo cáo» ⇒ URL BỎ khoá `tab` (mặc định không ghi), hàng đợi quay lại đúng bộ lọc", async () => {
    renderPage({ tab: "hidden", status: "dismissed" });
    await hiddenList();

    fireEvent.click(tab(TAB_REPORTS));

    await reportList();
    expect(lastNavigation().search?.tab).toBeUndefined();
    expect(lastNavigation().search?.status).toBe("dismissed");
    expect(listReports.mock.calls.at(-1)?.[0]).toStrictEqual({
      status: "dismissed",
      page: 1,
      limit: 20,
    });
    expect(tab(TAB_REPORTS)).toHaveAttribute("aria-selected", "true");
  });

  it("bấm tab ĐANG chọn ⇒ không điều hướng", async () => {
    renderPage();
    await reportList();

    fireEvent.click(tab(TAB_REPORTS));

    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("bàn phím: → trên «Báo cáo» chuyển sang «Bài đang ẩn» và đưa tiêu điểm theo; ← quay lại", async () => {
    renderPage();
    await reportList();

    fireEvent.keyDown(tab(TAB_REPORTS), { key: "ArrowRight" });

    await waitFor(() => expect(tab(TAB_HIDDEN)).toHaveAttribute("aria-selected", "true"));
    expect(lastNavigation().search?.tab).toBe("hidden");
    expect(tab(TAB_HIDDEN)).toHaveFocus();

    fireEvent.keyDown(tab(TAB_HIDDEN), { key: "ArrowLeft" });

    await waitFor(() => expect(tab(TAB_REPORTS)).toHaveAttribute("aria-selected", "true"));
    expect(lastNavigation().search?.tab).toBeUndefined();
    expect(tab(TAB_REPORTS)).toHaveFocus();
  });

  it("bàn phím: End tới tab CUỐI, Home về tab ĐẦU; → ở tab cuối và ← ở tab đầu VÒNG lại; phím khác không điều hướng", async () => {
    renderPage();
    await reportList();

    fireEvent.keyDown(tab(TAB_REPORTS), { key: "End" });
    await waitFor(() => expect(tab(TAB_HIDDEN)).toHaveAttribute("aria-selected", "true"));
    expect(tab(TAB_HIDDEN)).toHaveFocus();

    fireEvent.keyDown(tab(TAB_HIDDEN), { key: "Home" });
    await waitFor(() => expect(tab(TAB_REPORTS)).toHaveAttribute("aria-selected", "true"));
    expect(tab(TAB_REPORTS)).toHaveFocus();

    fireEvent.keyDown(tab(TAB_REPORTS), { key: "ArrowLeft" });
    await waitFor(() => expect(tab(TAB_HIDDEN)).toHaveAttribute("aria-selected", "true"));
    expect(tab(TAB_HIDDEN)).toHaveFocus();

    fireEvent.keyDown(tab(TAB_HIDDEN), { key: "ArrowRight" });
    await waitFor(() => expect(tab(TAB_REPORTS)).toHaveAttribute("aria-selected", "true"));

    const navigations = navigateSpy.mock.calls.length;
    fireEvent.keyDown(tab(TAB_REPORTS), { key: "a" });
    fireEvent.keyDown(tab(TAB_REPORTS), { key: "Home" });
    expect(navigateSpy).toHaveBeenCalledTimes(navigations);
    expect(tab(TAB_REPORTS)).toHaveAttribute("aria-selected", "true");
  });
});

// Trang chỉ mount tấm đang mở. Dải kết quả của 006 mà là state của tấm thì lượt «Hiện lại» hỏng SAU khi
// người dùng đã sang tab khác rơi vào một component đã unmount: không dải nào, quay lại chỉ thấy bài vẫn
// nằm đó (gate silent-failure, SF-03).
describe("Kết quả của «Hiện lại» sống qua lần đổi tab (gate SF, SF-03)", () => {
  const UNHIDE = "Hiện lại";
  const UNHIDDEN = "Đã hiện lại bài viết.";

  it("bấm «Hiện lại» → sang «Báo cáo» khi yêu cầu CÒN BAY → 006 hỏng 403 → quay lại: dải `forbidden` hiện ở tab «Bài đang ẩn»", async () => {
    let rejectUnhide: (error: unknown) => void = () => undefined;
    moderatePost.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUnhide = reject;
        }),
    );
    renderPage({ tab: "hidden" });
    await hiddenList();
    fireEvent.click(screen.getByRole("button", { name: UNHIDE }));
    await waitFor(() => expect(moderatePost).toHaveBeenCalledTimes(1));

    fireEvent.click(tab(TAB_REPORTS));
    await reportList();
    await act(async () => {
      rejectUnhide(ADMIN_ERR.forbidden());
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(tab(TAB_HIDDEN));

    await hiddenList();
    expect(screen.getByRole("alert")).toHaveAttribute("data-reason", "forbidden");
  });

  it("đối chứng: dải ĐANG THẤY lúc rời tab không theo về — «Đã hiện lại bài viết.» không hiện lại ở lần mở sau", async () => {
    moderatePost.mockImplementation(() => Promise.resolve(makeHiddenPost()));
    renderPage({ tab: "hidden" });
    await hiddenList();
    fireEvent.click(screen.getByRole("button", { name: UNHIDE }));
    expect(await screen.findByText(UNHIDDEN)).toBeInTheDocument();

    fireEvent.click(tab(TAB_REPORTS));
    await reportList();
    fireEvent.click(tab(TAB_HIDDEN));

    await hiddenList();
    expect(screen.queryByText(UNHIDDEN)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
