// @vitest-environment jsdom
/**
 * SocialEngagementWeekWidget + SocialNewsUnackedWidget (S16-SOCIAL-DASH-1, SPEC-16 §17.3 —
 * SOCIAL-WIDGET-001 «Tương tác tuần» · SOCIAL-WIDGET-002 «Tin tức chưa đọc»).
 *
 * Phủ: deny-path theo CẶP, mỗi widget ca deny RIÊNG · **wildcard `*:*` KHÔNG mở được widget** — cổng ngoài
 * khớp ĐÚNG-BẰNG như bộ gác route `/feed*` (hai cặp này KHÔNG nhạy cảm; lý do khác hẳn các widget PAYROLL) ·
 * **KHÔNG mượn chéo cặp của widget anh em** · nút dẫn của 001 chỉ vẽ khi có THÊM `view:feed` (đích
 * `/feed/stats` đòi đủ hai cặp) · rỗng / lỗi nguồn / payload sai hình · `weekStart` lạ ⇒ nhánh lỗi · drill-down.
 *
 * ⚠ Cổng THẬT (cặp + SÀN phạm vi: 001 = Department, 002 = Company) nằm ở BACKEND — xem
 * `apps/api/test/integration/dashboard-social-widgets.int-spec.ts`. Ở FE chỉ chứng được gate PHỤ theo CẶP vì
 * `capabilities` không mang data_scope; đừng đọc các ca dưới đây thành «ai không thấy».
 *
 * ⚠ Spec này mock TRỌN `dashboardApi` (app không có lưới chặn mạng thật) ⇒ nó KHÔNG chạm bản đồ slug. GIÁ TRỊ
 * slug được ghim ở `packages/web-core/src/lib/dashboard-api.spec.ts` (WC1 · WC2); việc «mã nào cũng có slug»
 * và việc Grid có mount hai widget này ở `DashboardWidgetGrid.spec.tsx`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { SocialEngagementWeekWidget } from "./SocialEngagementWeekWidget";
import { SocialNewsUnackedWidget } from "./SocialNewsUnackedWidget";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mockNavigate }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    dashboardApi: { getWidgetData: vi.fn() },
  };
});

import { dashboardApi } from "@mediaos/web-core";
const mockGetWidgetData = dashboardApi.getWidgetData as ReturnType<typeof vi.fn>;

function setCaps(caps: Record<string, boolean>) {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

/** Dựng widget trong đủ provider; trả `client` cho ca cần ép refetch (lỗi SAU khi đã có số). */
function renderWidget(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </QueryClientProvider>,
  );
  return client;
}

const ENGAGEMENT_CODE = "SOCIAL_ENGAGEMENT_WEEK";
const NEWS_CODE = "SOCIAL_NEWS_UNACKED";

/** Phong bì chung của mọi widget. TTL 0 (SOC-DEC-010): `expires_at` trùng `last_updated_at`. */
const envelope = (widget_code: string, over: Record<string, unknown>) => ({
  widget_code,
  widget_type: "Summary",
  status: "Active" as const,
  data: null,
  empty_state: null,
  error_state: null,
  last_updated_at: "2026-10-12T01:00:00.000Z",
  cache: { hit: false, ttl_seconds: 0, expires_at: "2026-10-12T01:00:00.000Z" },
  quick_actions: [],
  ...over,
});

/** Bốn số KHÁC NHAU: một ô vẽ nhầm số của ô khác là đỏ ngay. */
const WEEK = { weekStart: "2026-10-05", posts: 12, comments: 34, reactions: 56, activeMembers: 7 };
const ENGAGEMENT_DTO = envelope(ENGAGEMENT_CODE, { data: WEEK });
const NEWS_DTO = envelope(NEWS_CODE, { data: { total: 3 } });

const degraded = (widget_code: string, message: string) =>
  envelope(widget_code, {
    status: "Degraded",
    data: null,
    error_state: { code: "DASH-ERR-WIDGET", message, source_module: "SOCIAL", retryable: true },
  });

const ENGAGEMENT_TITLE = "Tương tác tuần";
const NEWS_TITLE = "Tin tức chưa đọc";
const STATS_CTA = "Xem thống kê tương tác";
const NEWS_CTA = /xem danh sách tin tức/i;
const LOAD_ERROR = /không thể tải dữ liệu/i;

const ENGAGEMENT_TEST_IDS = [
  "social-engagement-posts",
  "social-engagement-comments",
  "social-engagement-reactions",
  "social-engagement-active-members",
] as const;
const NEWS_TOTAL_TEST_ID = "social-news-unacked-total";

const titleOf = (name: string) => screen.queryByRole("heading", { name });

/** NGUYÊN chuỗi của ô số — `toHaveTextContent("7")` khớp chuỗi con nên «17» hay «70» cũng qua. */
const numberAt = (testId: string) => screen.getByTestId(testId).textContent;

/**
 * Một ca DENY phải đo CẢ HAI vế: không có lời gọi dữ liệu nào VÀ thẻ không được vẽ. Vế fetch đo được ngay
 * sau `render`: React Query gọi `queryFn` đồng bộ lúc observer đăng ký (trong effect, `render` đã bọc `act`).
 */
function expectNotMounted(title: string) {
  expect(mockGetWidgetData).not.toHaveBeenCalled();
  expect(titleOf(title)).not.toBeInTheDocument();
}

function expectNoEngagementNumbers() {
  for (const testId of ENGAGEMENT_TEST_IDS) {
    expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
  }
}

beforeEach(() => {
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
describe("SocialEngagementWeekWidget — gate PHỤ (cặp view:feed-report, khớp ĐÚNG-BẰNG)", () => {
  it("F1-D1 — không cặp nào → KHÔNG render, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget(<SocialEngagementWeekWidget />);
    expectNotMounted(ENGAGEMENT_TITLE);
  });

  /**
   * Cặp KHÔNG nhạy cảm (seed 0578) — lý do khớp đúng-bằng ở đây KHÁC các widget PAYROLL: bộ gác route
   * `/feed*` (đích của nút dẫn) chỉ nhận cặp đích danh, nên `useCan` / <PermissionGate> sẽ cho người chỉ cầm
   * wildcard thấy ô rồi bấm vào tường. Ai «sửa cho đồng bộ» sang `useCan` sẽ làm ca này ĐỎ.
   */
  it("F1-D2 — chỉ wildcard `*:*` → VẪN không render (useCanExact, không useCan)", () => {
    setCaps({ "*:*": true });
    renderWidget(<SocialEngagementWeekWidget />);
    expectNotMounted(ENGAGEMENT_TITLE);
  });

  it("F1-D3 — chỉ có cặp của widget ANH EM (view:feed) → KHÔNG mở được", () => {
    setCaps({ "view:feed": true });
    renderWidget(<SocialEngagementWeekWidget />);
    expectNotMounted(ENGAGEMENT_TITLE);
  });

  it("F1-A — có view:feed-report + view:feed → mount, fetch đúng mã, 4 ô mang đúng 4 số", async () => {
    setCaps({ "view:feed-report": true, "view:feed": true });
    mockGetWidgetData.mockResolvedValue(ENGAGEMENT_DTO);
    renderWidget(<SocialEngagementWeekWidget dashboardType="Manager" />);
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        ENGAGEMENT_CODE,
        expect.objectContaining({ dashboard_type: "Manager" }),
      );
    });
    // `waitFor` bọc CẢ phép đo số: lời gọi fetch xong trước, DOM của React Query vẽ ở tick sau.
    await waitFor(() => expect(numberAt("social-engagement-posts")).toBe("12"));
    expect(numberAt("social-engagement-comments")).toBe("34");
    expect(numberAt("social-engagement-reactions")).toBe("56");
    expect(numberAt("social-engagement-active-members")).toBe("7");
    expect(titleOf(ENGAGEMENT_TITLE)).toBeInTheDocument();
  });
});

describe("SocialEngagementWeekWidget — số liệu + nút dẫn", () => {
  beforeEach(() => setCaps({ "view:feed-report": true, "view:feed": true }));

  /**
   * Bốn số là bốn cặp `dt`/`dd` — nhãn đi liền con số của chính nó, trình đọc màn hình đọc được từng cặp.
   * `reactions` mang nhãn «Cảm xúc» (cột đếm MỌI loại cảm xúc — cùng chữ với màn Thống kê tương tác và tệp
   * XLSX), không phải «thích» như tiêu đề WO.
   */
  it("F1-K9 — bốn cặp nhãn/số đúng thứ tự; `reactions` là «Cảm xúc»", async () => {
    mockGetWidgetData.mockResolvedValue(ENGAGEMENT_DTO);
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(screen.getAllByRole("term")).toHaveLength(4));
    const pairs = screen
      .getAllByRole("term")
      .map((term) => [term.textContent, term.nextElementSibling?.textContent]);
    expect(pairs).toEqual([
      ["Bài viết", "12"],
      ["Bình luận", "34"],
      ["Cảm xúc", "56"],
      ["Thành viên hoạt động", "7"],
    ]);
    expect(screen.getAllByRole("definition")).toHaveLength(4);
    expect(screen.queryByText(/thích/i)).not.toBeInTheDocument();
  });

  it("F1-W — «Tuần từ dd/MM/yyyy» dựng bằng tách chuỗi weekStart", async () => {
    mockGetWidgetData.mockResolvedValue(ENGAGEMENT_DTO);
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(screen.getByText("Tuần từ 05/10/2026")).toBeInTheDocument());
  });

  /**
   * `weekStart` là `z.string()` ở hợp đồng ⇒ chuỗi lạ vẫn QUA schema. Không tách được thành ngày lịch thì
   * phải rơi về nhánh LỖI — không vẽ «Tuần từ undefined/…» hay nguyên văn chuỗi lạ bên cạnh bốn con số.
   */
  it.each([
    ["dấu thời gian ISO", "2026-10-05T00:00:00.000Z"],
    ["đã ở dạng dd/MM/yyyy", "05/10/2026"],
    ["chuỗi rỗng", ""],
    ["tháng 13", "2026-13-01"],
    ["ngày 32", "2026-10-32"],
    ["ngày không có thật (30/02)", "2026-02-30"],
    ["thiếu số 0 đệm", "2026-1-5"],
    ["chữ thường", "tuần này"],
  ])("F1-W2 — weekStart lạ (%s) ⇒ nhánh LỖI, không vẽ số", async (_name, weekStart) => {
    mockGetWidgetData.mockResolvedValue(
      envelope(ENGAGEMENT_CODE, { data: { ...WEEK, weekStart } }),
    );
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expectNoEngagementNumbers();
    expect(screen.queryByText(/tuần từ/i)).not.toBeInTheDocument();
  });

  it("F1-L (ALLOW) — đủ hai cặp → có nút dẫn; bấm ⇒ điều hướng /feed/stats", async () => {
    mockGetWidgetData.mockResolvedValue(ENGAGEMENT_DTO);
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: STATS_CTA })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: STATS_CTA }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/feed/stats" });
  });

  /**
   * `/feed/stats` đòi ĐỦ `view:feed` + `view:feed-report` (ROUTE_REGISTRY `social.stats`). Người chỉ có cặp
   * của widget vẫn được xem bốn số (server đã cho), nhưng không được mời bấm vào một màn chắc chắn 403.
   */
  it("F1-L (DENY) — chỉ view:feed-report → 4 số VẪN hiện, KHÔNG vẽ nút dẫn", async () => {
    setCaps({ "view:feed-report": true });
    mockGetWidgetData.mockResolvedValue(ENGAGEMENT_DTO);
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(numberAt("social-engagement-posts")).toBe("12"));
    expect(numberAt("social-engagement-comments")).toBe("34");
    expect(numberAt("social-engagement-reactions")).toBe("56");
    expect(numberAt("social-engagement-active-members")).toBe("7");
    expect(screen.queryByRole("button", { name: STATS_CTA })).not.toBeInTheDocument();
  });

  it("F1-L (DENY) — view:feed-report + wildcard `*:*` → vẫn KHÔNG vẽ nút dẫn (vế view:feed cũng khớp đúng-bằng)", async () => {
    setCaps({ "view:feed-report": true, "*:*": true });
    mockGetWidgetData.mockResolvedValue(ENGAGEMENT_DTO);
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(numberAt("social-engagement-posts")).toBe("12"));
    expect(screen.queryByRole("button", { name: STATS_CTA })).not.toBeInTheDocument();
  });

  it("F1-E — Empty: hiện chữ của SERVER, KHÔNG vẽ số", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope(ENGAGEMENT_CODE, {
        status: "Empty",
        data: null,
        empty_state: { message: "Tuần này phòng của bạn chưa có tương tác nào" },
      }),
    );
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() =>
      expect(screen.getByText("Tuần này phòng của bạn chưa có tương tác nào")).toBeInTheDocument(),
    );
    expectNoEngagementNumbers();
    expect(screen.queryByRole("button", { name: STATS_CTA })).not.toBeInTheDocument();
  });

  it("F1-E — Empty mà server không gửi chữ ⇒ chữ dự phòng của FE", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope(ENGAGEMENT_CODE, { status: "Empty", data: null, empty_state: null }),
    );
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() =>
      expect(
        screen.getByText("Tuần này chưa có tương tác nào trong phạm vi của bạn"),
      ).toBeInTheDocument(),
    );
    expectNoEngagementNumbers();
  });

  it.each([
    ["thiếu reactions", { weekStart: WEEK.weekStart, posts: 12, comments: 34, activeMembers: 7 }],
    ["thiếu weekStart", { posts: 12, comments: 34, reactions: 56, activeMembers: 7 }],
    ["posts là chuỗi", { ...WEEK, posts: "12" }],
    ["comments âm", { ...WEEK, comments: -1 }],
    ["activeMembers lẻ", { ...WEEK, activeMembers: 1.5 }],
  ])("F1-X — payload sai hình (%s) ⇒ nhánh LỖI, không vẽ số", async (_name, data) => {
    mockGetWidgetData.mockResolvedValue(envelope(ENGAGEMENT_CODE, { data }));
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expectNoEngagementNumbers();
  });

  it("F1-G — Degraded ⇒ nhánh LỖI với chữ của server, không vẽ số", async () => {
    mockGetWidgetData.mockResolvedValue(
      degraded(ENGAGEMENT_CODE, "Nguồn thống kê tạm thời không sẵn sàng"),
    );
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() =>
      expect(screen.getByText("Nguồn thống kê tạm thời không sẵn sàng")).toBeInTheDocument(),
    );
    expectNoEngagementNumbers();
  });

  it("F1-N — getWidgetData REJECT (mất mạng · 403 · 5xx) ⇒ nhánh LỖI, không vẽ số", async () => {
    mockGetWidgetData.mockRejectedValue(new Error("mất mạng"));
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expectNoEngagementNumbers();
  });

  /**
   * Trạng thái DUY NHẤT mà vế `isError` là chốt một mình: lần tải đầu bị reject thì `bodyMissing` cũng bật
   * (F1-N), còn refetch thất bại khi ĐÃ có số thì TanStack giữ nguyên `data` — mất vế `isError` là số cũ
   * đứng yên không dấu lỗi.
   */
  it("F1-R — refetch THẤT BẠI khi đã có số ⇒ nhánh LỖI, không để số cũ đứng yên", async () => {
    mockGetWidgetData.mockResolvedValueOnce(ENGAGEMENT_DTO);
    const client = renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(numberAt("social-engagement-posts")).toBe("12"));
    mockGetWidgetData.mockRejectedValueOnce(new Error("mất mạng"));
    await client.refetchQueries();
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expectNoEngagementNumbers();
  });

  it("F1-TZ — máy ở múi giờ ÂM vẫn ra đúng ngày (phép kiểm «ngày có thật» chỉ dùng số học UTC)", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "Pacific/Honolulu"; // UTC−10: nửa đêm UTC đọc bằng getter local là lùi một ngày
    try {
      // Tiền đề của ca: môi trường PHẢI đổi được múi giờ — không thì đỏ ở đây thay vì xanh rỗng.
      expect(new Date(Date.UTC(2026, 9, 5)).getDate()).toBe(4);
      mockGetWidgetData.mockResolvedValue(ENGAGEMENT_DTO);
      renderWidget(<SocialEngagementWeekWidget />);
      await waitFor(() => expect(screen.getByText(/tuần từ 05\/10\/2026/i)).toBeInTheDocument());
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("F1-B — `Active` mà KHÔNG có payload (data null) ⇒ nhánh LỖI, không phải thẻ chỉ còn tiêu đề", async () => {
    mockGetWidgetData.mockResolvedValue(envelope(ENGAGEMENT_CODE, {}));
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expectNoEngagementNumbers();
  });

  it("F1-H — `Hidden` ⇒ KHÔNG vẽ thẻ (đối chứng cùng quyền: `Active` thì có thẻ — F1-A)", async () => {
    mockGetWidgetData.mockResolvedValue(envelope(ENGAGEMENT_CODE, { status: "Hidden" }));
    renderWidget(<SocialEngagementWeekWidget />);
    await waitFor(() => expect(mockGetWidgetData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(titleOf(ENGAGEMENT_TITLE)).not.toBeInTheDocument());
    expectNoEngagementNumbers();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════════
describe("SocialNewsUnackedWidget — gate PHỤ (cặp view:feed, khớp ĐÚNG-BẰNG)", () => {
  it("F2-D1 — không cặp nào → KHÔNG render, KHÔNG gọi getWidgetData", () => {
    setCaps({});
    renderWidget(<SocialNewsUnackedWidget />);
    expectNotMounted(NEWS_TITLE);
  });

  it("F2-D2 — chỉ wildcard `*:*` → VẪN không render (khớp đúng-bằng như route /feed*)", () => {
    setCaps({ "*:*": true });
    renderWidget(<SocialNewsUnackedWidget />);
    expectNotMounted(NEWS_TITLE);
  });

  it("F2-D3 — chỉ có cặp của widget ANH EM (view:feed-report) → KHÔNG mở được", () => {
    setCaps({ "view:feed-report": true });
    renderWidget(<SocialNewsUnackedWidget />);
    expectNotMounted(NEWS_TITLE);
  });

  it("F2-A — có view:feed → mount, fetch đúng mã, in con số", async () => {
    setCaps({ "view:feed": true });
    mockGetWidgetData.mockResolvedValue(NEWS_DTO);
    renderWidget(<SocialNewsUnackedWidget dashboardType="Employee" />);
    await waitFor(() => {
      expect(mockGetWidgetData).toHaveBeenCalledWith(
        NEWS_CODE,
        expect.objectContaining({ dashboard_type: "Employee" }),
      );
    });
    await waitFor(() => expect(numberAt(NEWS_TOTAL_TEST_ID)).toBe("3"));
    expect(titleOf(NEWS_TITLE)).toBeInTheDocument();
    expect(screen.getByText("tin chưa xác nhận")).toBeInTheDocument();
  });
});

describe("SocialNewsUnackedWidget — số liệu + nút dẫn", () => {
  beforeEach(() => setCaps({ "view:feed": true }));

  it("F2-L — bấm ⇒ điều hướng /feed/news", async () => {
    mockGetWidgetData.mockResolvedValue(NEWS_DTO);
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() => expect(numberAt(NEWS_TOTAL_TEST_ID)).toBe("3"));
    fireEvent.click(screen.getByRole("button", { name: NEWS_CTA }));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/feed/news" });
  });

  it("F2-E — Empty: hiện chữ của SERVER, KHÔNG in số 0", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope(NEWS_CODE, {
        status: "Empty",
        data: null,
        empty_state: { message: "Không còn tin nào chờ bạn xác nhận" },
      }),
    );
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() =>
      expect(screen.getByText("Không còn tin nào chờ bạn xác nhận")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: NEWS_CTA })).not.toBeInTheDocument();
  });

  it("F2-E — Empty mà server không gửi chữ ⇒ chữ dự phòng của FE", async () => {
    mockGetWidgetData.mockResolvedValue(
      envelope(NEWS_CODE, { status: "Empty", data: null, empty_state: null }),
    );
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() =>
      expect(screen.getByText("Bạn đã xác nhận hết các tin cần đọc")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
  });

  it.each([
    ["total là chuỗi", { total: "3" }],
    ["total âm", { total: -1 }],
    ["total lẻ", { total: 1.5 }],
    ["thiếu total", {}],
  ])("F2-X — payload sai hình (%s) ⇒ nhánh LỖI, không vẽ số", async (_name, data) => {
    mockGetWidgetData.mockResolvedValue(envelope(NEWS_CODE, { data }));
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
  });

  it("F2-G — Degraded ⇒ nhánh LỖI với chữ của server, không vẽ số", async () => {
    mockGetWidgetData.mockResolvedValue(
      degraded(NEWS_CODE, "Nguồn tin tức tạm thời không sẵn sàng"),
    );
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() =>
      expect(screen.getByText("Nguồn tin tức tạm thời không sẵn sàng")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
  });

  it("F2-N — getWidgetData REJECT (mất mạng · 403 · 5xx) ⇒ nhánh LỖI, không in số", async () => {
    mockGetWidgetData.mockRejectedValue(new Error("mất mạng"));
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
  });

  it("F2-R — refetch THẤT BẠI khi đã có số ⇒ nhánh LỖI, không để số cũ đứng yên (vế `isError` — xem F1-R)", async () => {
    mockGetWidgetData.mockResolvedValueOnce(NEWS_DTO);
    const client = renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() => expect(numberAt(NEWS_TOTAL_TEST_ID)).toBe("3"));
    mockGetWidgetData.mockRejectedValueOnce(new Error("mất mạng"));
    await client.refetchQueries();
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
  });

  it("F2-B — `Active` mà KHÔNG có payload (data null) ⇒ nhánh LỖI, không phải thẻ chỉ còn tiêu đề", async () => {
    mockGetWidgetData.mockResolvedValue(envelope(NEWS_CODE, {}));
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() => expect(screen.getByText(LOAD_ERROR)).toBeInTheDocument());
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
  });

  it("F2-H — `Hidden` ⇒ KHÔNG vẽ thẻ", async () => {
    mockGetWidgetData.mockResolvedValue(envelope(NEWS_CODE, { status: "Hidden" }));
    renderWidget(<SocialNewsUnackedWidget />);
    await waitFor(() => expect(mockGetWidgetData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(titleOf(NEWS_TITLE)).not.toBeInTheDocument());
    expect(screen.queryByTestId(NEWS_TOTAL_TEST_ID)).not.toBeInTheDocument();
  });

  it("F2-T — chữ trong nút tách số với nhãn bằng một khoảng trắng THẬT («3 tin…», không phải «3tin…»)", async () => {
    mockGetWidgetData.mockResolvedValue(NEWS_DTO);
    renderWidget(<SocialNewsUnackedWidget />);
    const total = await screen.findByTestId(NEWS_TOTAL_TEST_ID);
    // Giữa hai phần tử INLINE trong cùng một khối, trình duyệt không tự chèn dấu cách ⇒ `textContent` (phép
    // nối THÔ các nút văn bản) là thước đúng cho RANH NÀY. KHÔNG đo bằng tên trợ năng của Testing Library:
    // jsdom không tính `display` nên nó tự chèn dấu cách giữa mọi phần tử con ⇒ ca xanh cả khi thiếu khoảng
    // trắng (đã đo: xanh trên mã chưa vá).
    expect(total.closest("button")?.textContent).toMatch(/^3 tin chưa xác nhận/);
  });
});
