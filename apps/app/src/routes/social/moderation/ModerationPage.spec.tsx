/**
 * S16-SOCIAL-FE-3 (L2) — màn Kiểm duyệt `SOC-SCREEN-010`, tab «Báo cáo»: NHÓM CA ĐỌC — khung · FL1 (lọc
 * trạng thái) · ST1 (trạng thái của màn) · E8/E10/E11 trên đường đọc 028 · cổng nút «Xử lý» nhìn từ màn.
 * Nhóm ca GHI (kết cục 029 · invalidate · dải ở trang) ở `ModerationPage.errors.spec.tsx`.
 *
 * Search của route là bản GIẢ CÓ PHẢN ỨNG (`routeSearchDouble`): `navigate({ search })` làm màn vẽ lại với
 * search mới ⇒ ca «đổi bộ lọc» đo tới tận THAM SỐ gửi 028, không dừng ở «navigate được gọi với gì».
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Quyền đặt bằng store thật (`setCaps`) TRƯỚC khi render.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedReportPageSchema, type FeedReportPageDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import {
  ADMIN_ERR,
  makeReport,
  makeReportPage,
  REPORT_ID,
  routeSearchDouble,
} from "../admin/admin-test-doubles";
import { ModerationPage } from "./ModerationPage";

const listReports = vi.fn();
const resolveReport = vi.fn();
const navigateSpy = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      listReports: (...a: unknown[]) => listReports(...a),
      resolveReport: (...a: unknown[]) => resolveReport(...a),
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
      navigateSpy(options);
      doubles.routeSearchDouble.navigate(options);
    },
    useSearch: () => doubles.useRouteSearchDouble(),
  };
});

const MANAGER = { "view:feed": true, "view:feed-report": true };
const FULL_MODERATOR = { ...MANAGER, "manage:feed-report": true, "manage:feed-post": true };

const SECOND_REPORT_ID = "99999999-9999-4999-8999-999999999999";

const TITLE = "Kiểm duyệt";
const FILTER_LABEL = "Trạng thái báo cáo";
const FILTER_OPTIONS = ["Đang chờ xử lý", "Đã giải quyết", "Đã bỏ qua", "Tất cả"];
const LIST = "Danh sách báo cáo vi phạm";
const LOADING = "Đang tải hàng đợi báo cáo";
const RESOLVE = "Xử lý";
const DIALOG = "Xử lý báo cáo";
const RETRY = "Thử lại";
const NEXT_PAGE = "Trang sau";
const BACK_TO_FIRST = "Về trang 1";
const FORBIDDEN_TEXT =
  "Bạn không có quyền thực hiện thao tác này. Nếu cần, hãy liên hệ quản trị viên để được cấp quyền.";
const EMPTY = {
  open: "Không có báo cáo nào đang chờ xử lý.",
  resolved: "Chưa có báo cáo nào được giải quyết.",
  dismissed: "Chưa có báo cáo nào bị bỏ qua.",
  all: "Chưa có báo cáo vi phạm nào trong phạm vi xem của bạn.",
};

const onePage = (): FeedReportPageDto => makeReportPage([makeReport()]);
const filterSelect = (): HTMLSelectElement => screen.getByRole("combobox", { name: FILTER_LABEL });
const chooseFilter = (value: string): void => {
  fireEvent.change(filterSelect(), { target: { value } });
};
const list = (): Promise<HTMLElement> => screen.findByRole("list", { name: LIST });
const lastListArg = (): unknown => listReports.mock.calls.at(-1)?.[0];
const lastNavigation = (): { to?: string; search?: Record<string, unknown> } =>
  navigateSpy.mock.calls.at(-1)?.[0] ?? {};
const pending = <T,>(): Promise<T> => new Promise<T>(() => undefined);

function renderPage(search: Record<string, unknown> = {}) {
  routeSearchDouble.set(search);
  return renderWithProviders(<ModerationPage />);
}

beforeEach(() => {
  setCaps(FULL_MODERATOR);
  listReports.mockReset();
  resolveReport.mockReset();
  navigateSpy.mockReset();
  listReports.mockImplementation(() => Promise.resolve(onePage()));
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
});

describe("Khung của màn", () => {
  it("fixture trang 028 đúng hợp đồng (lưới cho mọi ca bên dưới)", () => {
    expect(feedReportPageSchema.safeParse(onePage()).success).toBe(true);
  });

  it("có tiêu đề, ô lọc CÓ NHÃN với 4 lựa chọn đúng thứ tự, và hàng đợi", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: TITLE })).toBeInTheDocument();
    expect(
      within(filterSelect())
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(FILTER_OPTIONS);
    expect(within(await list()).getAllByTestId("report-row")).toHaveLength(1);
  });
});

describe("FL1 — lọc trạng thái", () => {
  it("mặc định ⇒ 028 nhận `status: open`, trang 1, 20 dòng; KHÔNG ghi gì lên URL", async () => {
    renderPage();
    await list();

    expect(filterSelect().value).toBe("open");
    expect(listReports).toHaveBeenCalledTimes(1);
    expect(lastListArg()).toStrictEqual({ status: "open", page: 1, limit: 20 });
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it("«Tất cả» ⇒ đối số gửi 028 KHÔNG có khoá `status` (không phải `status: all`)", async () => {
    renderPage();
    await list();

    chooseFilter("all");

    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
    expect(Object.keys(lastListArg() as object).sort()).toEqual(["limit", "page"]);
    expect(lastListArg()).toStrictEqual({ page: 1, limit: 20 });
    expect(lastNavigation().to).toBe("/feed/moderation");
    expect(lastNavigation().search?.status).toBe("all");
    expect(filterSelect().value).toBe("all");
  });

  it("URL đang ở trang 3 ⇒ gọi `page: 3`; đổi bộ lọc ⇒ gọi lại với `page: 1`", async () => {
    listReports.mockImplementation(() =>
      Promise.resolve(makeReportPage([makeReport()], { page: 3, total: 45 })),
    );
    renderPage({ page: 3 });
    await list();
    expect(lastListArg()).toStrictEqual({ status: "open", page: 3, limit: 20 });

    chooseFilter("resolved");

    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
    expect(lastListArg()).toStrictEqual({ status: "resolved", page: 1, limit: 20 });
    expect(lastNavigation().search?.page).toBeUndefined();
  });

  it("chọn lại «Đang chờ xử lý» ⇒ URL bỏ khoá `status` (mặc định không ghi)", async () => {
    renderPage({ status: "dismissed" });
    await list();
    expect(lastListArg()).toStrictEqual({ status: "dismissed", page: 1, limit: 20 });

    chooseFilter("open");

    await waitFor(() =>
      expect(lastListArg()).toStrictEqual({ status: "open", page: 1, limit: 20 }),
    );
    expect(lastNavigation().search?.status).toBeUndefined();
  });

  it("«Trang sau» ⇒ gọi `page: 2` GIỮ bộ lọc, và giữ hàng cũ trong lúc tải (cùng bộ lọc)", async () => {
    listReports.mockImplementationOnce(() =>
      Promise.resolve(makeReportPage([makeReport()], { total: 45 })),
    );
    listReports.mockImplementationOnce(() => pending());
    renderPage({ status: "resolved" });
    await list();

    fireEvent.click(screen.getByRole("button", { name: NEXT_PAGE }));

    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
    expect(lastListArg()).toStrictEqual({ status: "resolved", page: 2, limit: 20 });
    expect(lastNavigation().search).toMatchObject({ status: "resolved", page: 2 });
    expect(screen.getAllByTestId("report-row")).toHaveLength(1);
  });

  it("đổi BỘ LỌC trong lúc tải ⇒ skeleton; KHÔNG giữ hàng của bộ lọc cũ, KHÔNG hiện câu rỗng sớm", async () => {
    listReports.mockImplementationOnce(() => Promise.resolve(onePage()));
    listReports.mockImplementationOnce(() => pending());
    renderPage();
    await list();

    chooseFilter("resolved");

    expect(await screen.findByRole("status", { name: LOADING })).toBeInTheDocument();
    expect(screen.queryAllByTestId("report-row")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: RESOLVE })).toBeNull();
  });

  it("trang giữ lại RỖNG: đổi bộ lọc ⇒ skeleton, câu rỗng của bộ lọc MỚI chỉ hiện khi dữ liệu của nó về", async () => {
    let release: (page: FeedReportPageDto) => void = () => undefined;
    listReports.mockImplementationOnce(() => Promise.resolve(makeReportPage([])));
    listReports.mockImplementationOnce(
      () =>
        new Promise<FeedReportPageDto>((resolve) => {
          release = resolve;
        }),
    );
    renderPage();
    expect(await screen.findByText(EMPTY.open)).toBeInTheDocument();

    chooseFilter("resolved");

    expect(await screen.findByRole("status", { name: LOADING })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY.resolved)).toBeNull();
    expect(screen.queryByText(EMPTY.open)).toBeNull();

    release(makeReportPage([]));
    expect(await screen.findByText(EMPTY.resolved)).toBeInTheDocument();
  });
});

describe("ST1 — trạng thái của màn", () => {
  it.each(["open", "resolved", "dismissed", "all"] as const)(
    "hàng đợi rỗng với bộ lọc `%s` ⇒ câu rỗng RIÊNG của bộ lọc đó",
    async (filter) => {
      listReports.mockImplementation(() => Promise.resolve(makeReportPage([])));
      renderPage(filter === "open" ? {} : { status: filter });

      expect(await screen.findByText(EMPTY[filter])).toBeInTheDocument();
      const others = Object.values(EMPTY).filter((text) => text !== EMPTY[filter]);
      expect(others).toHaveLength(3);
      others.forEach((text) => expect(screen.queryByText(text)).toBeNull());
    },
  );

  it("đang tải lượt đầu ⇒ skeleton có tên trợ năng", async () => {
    listReports.mockImplementation(() => pending());
    renderPage();

    expect(await screen.findByRole("status", { name: LOADING })).toBeInTheDocument();
  });

  it("`page` quá trang cuối ⇒ «Về trang 1» gọi lại với `page: 1` và bỏ `page` khỏi URL", async () => {
    listReports.mockImplementationOnce(() =>
      Promise.resolve(makeReportPage([], { page: 5, total: 3 })),
    );
    renderPage({ page: 5 });

    fireEvent.click(await screen.findByRole("button", { name: BACK_TO_FIRST }));

    await waitFor(() =>
      expect(lastListArg()).toStrictEqual({ status: "open", page: 1, limit: 20 }),
    );
    expect(lastNavigation().search?.page).toBeUndefined();
    expect(within(await list()).getAllByTestId("report-row")).toHaveLength(1);
  });
});

describe("Lỗi trên đường ĐỌC 028", () => {
  it("E11: 500 ⇒ `generic` + «Thử lại» GỌI LẠI và hàng đợi hiện ra", async () => {
    listReports.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "generic");
    expect(screen.queryAllByTestId("report-row")).toHaveLength(0);

    fireEvent.click(within(alert).getByRole("button", { name: RETRY }));

    expect(within(await list()).getAllByTestId("report-row")).toHaveLength(1);
    expect(listReports).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["403 tầng 1/2 (`AUTH-ERR-FORBIDDEN`)", ADMIN_ERR.forbidden],
    ["403 mang mã SOCIAL (`SOCIAL-ERR-010`)", ADMIN_ERR.moderationDenied],
  ])(
    "E8: %s ⇒ `forbidden` bằng chữ của FE, KHÔNG hiện `message` server, KHÔNG «Thử lại»",
    async (_label, makeError) => {
      const error = makeError();
      listReports.mockImplementation(() => Promise.reject(error));
      renderPage();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveAttribute("data-reason", "forbidden");
      expect(alert).toHaveTextContent(FORBIDDEN_TEXT);
      expect(error.message.length).toBeGreaterThan(0);
      expect(document.body).not.toHaveTextContent(error.message);
      expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
      // Ô lọc vẫn còn: 403 của hàng đợi không làm mất khung màn.
      expect(filterSelect()).toBeInTheDocument();
    },
  );

  it("E10: 400 ⇒ `invalidRequest`, KHÔNG «Thử lại»", async () => {
    listReports.mockImplementation(() => Promise.reject(ADMIN_ERR.badRequest()));
    renderPage();

    expect(await screen.findByRole("alert")).toHaveAttribute("data-reason", "invalidRequest");
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });
});

describe("G2 nhìn từ màn — nút «Xử lý» mở hộp thoại", () => {
  it("ALLOW `manage:feed-report`: bấm «Xử lý» ⇒ hộp thoại mở; «Huỷ» ⇒ đóng, không ghi, không tải lại", async () => {
    renderPage();
    await list();

    fireEvent.click(screen.getByRole("button", { name: RESOLVE }));
    const dialog = screen.getByRole("dialog", { name: DIALOG });
    fireEvent.click(within(dialog).getByRole("button", { name: "Huỷ" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(resolveReport).not.toHaveBeenCalled();
    expect(listReports).toHaveBeenCalledTimes(1);
  });

  it("DENY chỉ `view:feed-report`: hàng VẪN hiện (đọc được), 0 nút «Xử lý», không hộp thoại", async () => {
    setCaps(MANAGER);
    renderPage();

    expect(within(await list()).getAllByTestId("report-row")).toHaveLength(1);
    expect(listReports).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: RESOLVE })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("hộp thoại mở cho ĐÚNG báo cáo được bấm (hàng thứ hai)", async () => {
    resolveReport.mockImplementation(() => pending());
    listReports.mockImplementation(() =>
      Promise.resolve(
        makeReportPage([makeReport(), makeReport({ id: SECOND_REPORT_ID, reason: "harassment" })]),
      ),
    );
    renderPage();
    const rows = within(await list()).getAllByTestId("report-row");

    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: RESOLVE }));
    fireEvent.click(screen.getByRole("radio", { name: "Bỏ qua" }));
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận" }));

    await waitFor(() => expect(resolveReport).toHaveBeenCalledTimes(1));
    expect(resolveReport.mock.calls[0]?.[0]).toBe(SECOND_REPORT_ID);
    expect(resolveReport.mock.calls[0]?.[0]).not.toBe(REPORT_ID);
  });
});
