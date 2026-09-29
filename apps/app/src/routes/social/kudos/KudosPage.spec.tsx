/**
 * S16-SOCIAL-FE-2C — ca **KP** (màn 009) + **KW** (widget) — plan §4 + §8 H2/M-a/M-c.
 *
 * - Đồng hồ ghim `2026-09-30T17:30:00Z` = 00:30 ngày 1/10 giờ VN (fake CHỈ `Date` — react-query vẫn
 *   chạy timer thật): «tháng hiện tại» phải là literal `2026-10`. Máy/CI chạy UTC mà code đọc đồng hồ
 *   máy thì ra `2026-09` ⇒ đỏ.
 * - Mock `Link` NỘI SUY params: link «Xem bài» phải mang `postId`, không `kudosId`.
 * - Fixture mang `avatarUrl` thật ⇒ ca «không `<img>`» có nghĩa.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedKudosListItemDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import { KudosPage } from "./KudosPage";
import { KudosThisMonthWidget } from "./components/KudosThisMonthWidget";

const list = vi.fn();
const navigateSpy = vi.fn();
let routeSearch: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
      "data-testid": testId,
    }: {
      children: ReactNode;
      to: string;
      params?: Record<string, string>;
      "data-testid"?: string;
    }) => (
      <a
        data-testid={testId}
        href={Object.entries(params ?? {}).reduce((h, [k, v]) => h.replace(`$${k}`, v), to)}
      >
        {children}
      </a>
    ),
    useNavigate: () => navigateSpy,
    useSearch: () => routeSearch,
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialKudosApi: { ...actual.socialKudosApi, list: (...a: unknown[]) => list(...a) },
  };
});

const t = i18n.getFixedT("vi", "social");
const POST_ID = "11111111-1111-4111-8111-111111111111";
const KUDOS_ID = "44444444-4444-4444-8444-444444444444";

const item = (over: Partial<FeedKudosListItemDto> = {}): FeedKudosListItemDto => ({
  kudosId: KUDOS_ID,
  postId: POST_ID,
  createdAt: "2026-09-29T01:15:53.496Z",
  message: "Cảm ơn!",
  isOfficial: false,
  badge: null,
  recipients: [
    {
      employeeId: "33333333-3333-4333-8333-333333333333",
      fullName: "Bình Trần",
      avatarUrl: "https://x.invalid/p.png",
      isFormerEmployee: false,
    },
  ],
  ...over,
});
const pageOf = (data: FeedKudosListItemDto[], total = data.length, page = 1) => ({
  data,
  page,
  limit: 20,
  total,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-30T17:30:00Z"));
  setCaps({ "view:feed": true });
  routeSearch = {};
  list.mockResolvedValue(pageOf([item()]));
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("KP — màn 009 theo tháng", () => {
  it("mặc định gửi `month` = tháng HIỆN TẠI giờ công ty (literal 2026-10), trang 1", async () => {
    renderWithProviders(<KudosPage />);
    await screen.findByTestId("kudos-list");
    expect(list).toHaveBeenCalledWith({ month: "2026-10", page: 1, limit: 20 });
    expect(screen.getByTestId("kudos-month-label")).toHaveTextContent(
      t("kudos.page.monthLabel", { month: 10, year: 2026 }),
    );
  });

  it("dòng: link «Xem bài» mang `postId` (KHÔNG `kudosId`); không `<img>`", async () => {
    const { container } = renderWithProviders(<KudosPage />);
    const link = await screen.findByTestId("kudos-view-post");
    expect(link.getAttribute("href")).toBe(`/feed/posts/${POST_ID}`);
    expect(link.getAttribute("href")).not.toContain(KUDOS_ID);
    expect(container.querySelector("img")).toBeNull();
  });

  it("tháng từ URL + ‹ ⇒ tháng trước, BỎ `page`; › ⇒ tháng sau (về tháng hiện tại ⇒ bỏ `month`)", async () => {
    routeSearch = { month: "2026-09", page: 3 };
    renderWithProviders(<KudosPage />);
    await screen.findByTestId("kudos-list");
    expect(list).toHaveBeenCalledWith({ month: "2026-09", page: 3, limit: 20 });
    fireEvent.click(screen.getByTestId("kudos-prev-month"));
    expect(navigateSpy).toHaveBeenLastCalledWith({
      to: "/feed/kudos",
      search: { month: "2026-08" },
    });
    fireEvent.click(screen.getByTestId("kudos-next-month"));
    expect(navigateSpy).toHaveBeenLastCalledWith({ to: "/feed/kudos", search: {} });
  });

  it("DENY: › khoá ở tháng hiện tại (không lật sang tương lai)", async () => {
    renderWithProviders(<KudosPage />);
    await screen.findByTestId("kudos-list");
    expect(screen.getByTestId("kudos-next-month")).toBeDisabled();
    expect(screen.getByTestId("kudos-prev-month")).not.toBeDisabled();
  });

  it("rỗng ⇒ câu rỗng; quá trang cuối (total>0) ⇒ KHÔNG nói «chưa có», có nút về trang đầu", async () => {
    list.mockResolvedValueOnce(pageOf([], 0));
    renderWithProviders(<KudosPage />);
    expect(await screen.findByTestId("kudos-empty")).toHaveTextContent(t("kudos.page.empty"));
    cleanup();

    routeSearch = { page: 3 };
    list.mockResolvedValueOnce(pageOf([], 25, 3));
    renderWithProviders(<KudosPage />);
    expect(await screen.findByTestId("kudos-past-last-page")).toBeInTheDocument();
    expect(screen.queryByTestId("kudos-empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("kudos.page.backToFirstPage") }));
    expect(navigateSpy).toHaveBeenLastCalledWith({ to: "/feed/kudos", search: {} });
  });

  it("lỗi ⇒ khối lỗi + «Thử lại» gọi lại API", async () => {
    list.mockRejectedValueOnce(new Error("boom"));
    renderWithProviders(<KudosPage />);
    expect(await screen.findByTestId("kudos-error")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("state.retry") }));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("KW — widget «Vinh danh tháng này» (trình bày)", () => {
  const people = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      employeeId: `${String(i + 1).padStart(8, "0")}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,
      fullName: i === 1 ? null : `Người ${i + 1}`,
      avatarUrl: "https://x.invalid/p.png",
      isFormerEmployee: false,
    }));

  it("5 người nhận ⇒ 3 tên (tên rỗng ⇒ «Đồng nghiệp») + «+2»; link bài theo `postId`; không `<img>`", () => {
    const { container } = renderWithProviders(
      <KudosThisMonthWidget
        items={[item({ recipients: people(5) })]}
        isLoading={false}
        isError={false}
      />,
    );
    const row = screen.getByTestId("kudos-widget-item");
    expect(row).toHaveTextContent(`Người 1, ${t("kudos.unknownRecipient")}, Người 3 +2`);
    expect(row.getAttribute("href")).toBe(`/feed/posts/${POST_ID}`);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("link", { name: t("kudos.widget.viewAll") }).getAttribute("href")).toBe(
      "/feed/kudos",
    );
  });

  it("rỗng ⇒ câu rỗng", () => {
    renderWithProviders(<KudosThisMonthWidget items={[]} isLoading={false} isError={false} />);
    expect(screen.getByTestId("kudos-widget-empty")).toHaveTextContent(t("kudos.widget.empty"));
  });
});
