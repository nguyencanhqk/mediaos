/**
 * S16-SOCIAL-FE-3 (L2) — hàng đợi `ReportQueue` (thuần trình bày): ca ST1 + vế hàng đợi của G2 (plan §4).
 *
 * Component KHÔNG tự gọi API ⇒ mọi trạng thái dựng bằng props; `ReportRow` dùng bản THẬT (không mock) để
 * vế cổng quyền đo đúng thứ người dùng thấy. i18n THẬT, vế kỳ vọng viết tay.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedReportDto, FeedReportPageDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { ADMIN_ERR, makeReport } from "../../admin/admin-test-doubles";
import {
  MODERATION_STATUS_FILTERS,
  type ModerationStatusFilter,
} from "../lib/moderation-route-search";
import { ReportQueue, type ReportQueueProps } from "./ReportQueue";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
    }: {
      children: ReactNode;
      to: string;
      params?: Record<string, string>;
    }) => {
      const href = Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      );
      return <a href={href}>{children}</a>;
    },
  };
});

const MANAGER = { "view:feed": true, "view:feed-report": true };
const REPORT_MANAGER = { ...MANAGER, "manage:feed-report": true };

const SECOND_ID = "66666666-6666-4666-8666-666666666667";
const LIST_NAME = "Danh sách báo cáo vi phạm";
const RESOLVE = "Xử lý";
const RETRY = "Thử lại";
const BACK_TO_FIRST = "Về trang 1";

const EMPTY_TEXT: Record<ModerationStatusFilter, string> = {
  open: "Không có báo cáo nào đang chờ xử lý.",
  resolved: "Chưa có báo cáo nào được giải quyết.",
  dismissed: "Chưa có báo cáo nào bị bỏ qua.",
  all: "Chưa có báo cáo vi phạm nào trong phạm vi xem của bạn.",
};

const pageOf = (
  data: FeedReportDto[],
  over: Partial<Omit<FeedReportPageDto, "data">> = {},
): FeedReportPageDto => ({ data, page: 1, limit: 20, total: data.length, ...over });

const openReport = makeReport({ note: "báo cáo đang mở" });
const closedReport = makeReport({
  id: SECOND_ID,
  status: "resolved",
  note: "báo cáo đã xong",
  resolvedBy: { employeeId: null, fullName: "Phạm Thị Hoa", avatarUrl: null },
  resolvedAt: "2026-10-02T00:00:00.000Z",
});

function renderQueue(over: Partial<ReportQueueProps> = {}) {
  const props: ReportQueueProps = {
    page: pageOf([openReport, closedReport]),
    isLoading: false,
    isFetching: false,
    error: null,
    statusFilter: "open",
    onRetry: vi.fn(),
    onPageChange: vi.fn(),
    onResolve: vi.fn(),
    ...over,
  };
  return { ...renderWithProviders(<ReportQueue {...props} />), props };
}

beforeEach(() => setCaps(MANAGER));
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("ST1 — trạng thái của hàng đợi", () => {
  it("đang tải lượt đầu ⇒ skeleton có tên trợ năng, KHÔNG có danh sách", () => {
    renderQueue({ page: undefined, isLoading: true });
    expect(screen.getByRole("status", { name: "Đang tải hàng đợi báo cáo" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: LIST_NAME })).toBeNull();
  });

  it("lỗi 500 ⇒ dải `loadFailed` + «Thử lại» gọi `onRetry` đúng 1 lần; KHÔNG vẽ danh sách cũ", () => {
    const { props } = renderQueue({ error: ADMIN_ERR.server() });
    expect(screen.getByRole("alert").getAttribute("data-reason")).toBe("loadFailed");
    fireEvent.click(screen.getByRole("button", { name: RETRY }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list", { name: LIST_NAME })).toBeNull();
  });

  // Lỗi tải khi cache ĐÃ có dữ liệu: react-query giữ `status: "error"` suốt lượt đọc lại ⇒ dải lỗi đứng
  // nguyên. Nút không khoá thì «đang thử» trông y hệt «nút không ăn», bấm lần nữa là huỷ lượt đang bay
  // (gate SF, SF-04). Ca ngay trên là đối chứng: không đang tải ⇒ nút bấm được.
  it("lỗi + ĐANG đọc lại (`isFetching`) ⇒ «Thử lại» khoá, dải mang `aria-busy`, bấm không gọi `onRetry`", () => {
    const { props } = renderQueue({ error: ADMIN_ERR.server(), isFetching: true });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("aria-busy", "true");
    const retry = screen.getByRole("button", { name: RETRY });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    expect(props.onRetry).not.toHaveBeenCalled();
  });

  it("lỗi 403 ⇒ dải `forbidden`, KHÔNG nút «Thử lại», KHÔNG hiện `message` của server", () => {
    const err = ADMIN_ERR.forbidden();
    renderQueue({ page: undefined, error: err });
    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-reason")).toBe("forbidden");
    expect(alert).toHaveTextContent("Bạn không có quyền thực hiện thao tác này");
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(document.body.textContent ?? "").not.toContain(err.message);
  });

  it.each(MODERATION_STATUS_FILTERS)("rỗng với bộ lọc `%s` ⇒ câu RIÊNG của bộ lọc đó", (filter) => {
    renderQueue({ page: pageOf([]), statusFilter: filter });
    const empty = screen.getByTestId("report-queue-empty");
    expect(empty.textContent).toBe(EMPTY_TEXT[filter]);
    expect(screen.queryByRole("button", { name: BACK_TO_FIRST })).toBeNull();
    expect(screen.queryByRole("list", { name: LIST_NAME })).toBeNull();
  });

  it("4 câu rỗng (viết tay) phủ đủ bộ lọc và khác nhau từng đôi trên MÀN", () => {
    const seen = MODERATION_STATUS_FILTERS.map((filter) => {
      const view = renderQueue({ page: pageOf([]), statusFilter: filter });
      const text = screen.getByTestId("report-queue-empty").textContent ?? "";
      view.unmount();
      return text;
    });
    expect(new Set(seen).size).toBe(4);
    expect(seen.every((text) => !text.includes("admin."))).toBe(true);
  });

  it("`page` quá trang cuối (trang rỗng, `total > 0`) ⇒ «Về trang 1» gọi `onPageChange(1)`, KHÔNG dùng câu rỗng", () => {
    const { props } = renderQueue({ page: pageOf([], { page: 5, total: 41 }) });
    expect(screen.queryByTestId("report-queue-empty")).toBeNull();
    expect(screen.getByTestId("report-queue-out-of-range")).toHaveTextContent(
      "Trang này không còn báo cáo nào.",
    );
    fireEvent.click(screen.getByRole("button", { name: BACK_TO_FIRST }));
    expect(props.onPageChange).toHaveBeenCalledTimes(1);
    expect(props.onPageChange).toHaveBeenCalledWith(1);
  });

  it("có dữ liệu ⇒ danh sách có tên trợ năng, mỗi báo cáo một `listitem`", () => {
    renderQueue();
    const list = screen.getByRole("list", { name: LIST_NAME });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("báo cáo đang mở");
    expect(items[1]).toHaveTextContent("báo cáo đã xong");
  });

  it("`total > limit` ⇒ có bộ chuyển trang, «Trang sau» gọi `onPageChange(2)`", () => {
    const { props } = renderQueue({ page: pageOf([openReport], { total: 41 }) });
    expect(screen.getByText("Trang 1/3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trang sau" }));
    expect(props.onPageChange).toHaveBeenCalledWith(2);
  });

  it("`total ≤ limit` ⇒ KHÔNG có bộ chuyển trang (danh sách vẫn hiện — đối chứng)", () => {
    renderQueue({ page: pageOf([openReport], { total: 20 }) });
    expect(screen.getByRole("list", { name: LIST_NAME })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trang sau" })).toBeNull();
  });

  it("đang tải nền (`isFetching`) ⇒ nút chuyển trang bị khoá", () => {
    renderQueue({ page: pageOf([openReport], { total: 41 }), isFetching: true });
    expect(screen.getByRole("button", { name: "Trang sau" })).toBeDisabled();
  });
});

describe("G2 (vế hàng đợi) — nút «Xử lý» theo quyền và theo trạng thái từng hàng", () => {
  it("DENY: caps manager ⇒ đủ 2 hàng, 0 nút", () => {
    renderQueue();
    expect(
      within(screen.getByRole("list", { name: LIST_NAME })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: RESOLVE })).toBeNull();
  });

  it("ALLOW: thêm `manage:feed-report` ⇒ ĐÚNG 1 nút (hàng đang mở); bấm gọi `onResolve` với hàng đó", () => {
    setCaps(REPORT_MANAGER);
    const { props } = renderQueue();
    const items = within(screen.getByRole("list", { name: LIST_NAME })).getAllByRole("listitem");
    expect(screen.getAllByRole("button", { name: RESOLVE })).toHaveLength(1);
    expect(within(items[1] as HTMLElement).queryByRole("button", { name: RESOLVE })).toBeNull();
    fireEvent.click(within(items[0] as HTMLElement).getByRole("button", { name: RESOLVE }));
    expect(props.onResolve).toHaveBeenCalledTimes(1);
    expect(props.onResolve).toHaveBeenCalledWith(openReport);
  });
});
