/**
 * S16-SOCIAL-FE-1 — `SocialPortalShell`: vỏ cổng thông tin dùng chung cho cả 5 màn `/feed*`.
 *
 * 🔴 Ca quan trọng nhất ở đây là ca **ném**: vỏ này chở rail phải với widget Sinh nhật — dữ liệu chỉ
 * gác bằng `view:feed`, không cặp HR nào. Một module `MODULE_PORTAL` thứ hai mượn nhầm vỏ này sẽ
 * chiếu sinh nhật của cả công ty vào một ngữ cảnh chưa ai cân nhắc. Fail-LOUD là lựa chọn đúng, và
 * ca dưới đây giữ nó khỏi bị "dọn" thành fail-soft.
 */
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialPortalShell } from "./SocialPortalShell";
import { page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const navigateSpy = vi.fn();
const listBirthdays = vi.fn();
const listNews = vi.fn();
/** Tham số URL mà `useSearch` trả về. Đặt trong từng ca để giả lập `/feed?q=...`. */
let routeSearch: Record<string, unknown> = {};

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => navigateSpy,
    useSearch: () => routeSearch,
    useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
      select({ location: { pathname: "/feed" } }),
  };
});

vi.mock("@/layouts/workspace/sidebar-extensions", () => ({ getSidebarExtension: () => undefined }));

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      listBirthdays: (...a: unknown[]) => listBirthdays(...a),
      listNews: (...a: unknown[]) => listNews(...a),
    },
  };
});

beforeEach(() => {
  setCaps({ "view:feed": true });
  navigateSpy.mockReset();
  listBirthdays.mockReset().mockResolvedValue({ data: [] });
  listNews.mockReset().mockResolvedValue(page([]));
  routeSearch = {};
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("SocialPortalShell — khung", () => {
  it("dựng PortalLayout với cả hai rail và nội dung ở cột giữa", async () => {
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p data-testid="page-content">nội dung màn</p>
      </SocialPortalShell>,
    );

    expect(screen.getByTestId("portal-layout")).toBeInTheDocument();
    expect(screen.getByTestId("portal-right-rail")).toBeInTheDocument();
    expect(screen.getByTestId("portal-main")).toContainElement(screen.getByTestId("page-content"));
  });

  it("ô tìm kiếm nằm trong cột giữa, KHÔNG phải topbar toàn cục (plan finding #8)", async () => {
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p>x</p>
      </SocialPortalShell>,
    );
    const box = screen.getByTestId("feed-search-box");
    // Nhét vào `GlobalTopbar` là thêm một thay đổi cho 13 module không liên quan.
    expect(screen.getByTestId("portal-main")).toContainElement(box);
  });

  it("tải widget sinh nhật + tin nổi bật khi có `view:feed`", async () => {
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p>x</p>
      </SocialPortalShell>,
    );
    await waitFor(() => expect(listBirthdays).toHaveBeenCalled());
    expect(listNews).toHaveBeenCalled();
  });

  it("KHÔNG có `view:feed` ⇒ KHÔNG gọi hai query nào (đừng hỏi câu đã biết bị 403)", async () => {
    setCaps({});
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p>x</p>
      </SocialPortalShell>,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(listBirthdays).not.toHaveBeenCalled();
    expect(listNews).not.toHaveBeenCalled();
  });

  it("«Tin nổi bật» CHỈ lấy tin ĐÃ GHIM (lọc tại chỗ, không đẻ thêm endpoint)", async () => {
    const { makeNews } = await import("./social-test-doubles");
    listNews.mockResolvedValue(
      page([
        makeNews({ id: "a", pinned: true, body: "tin ghim" }),
        makeNews({ id: "b", pinned: false, body: "tin thường" }),
      ]),
    );
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p>x</p>
      </SocialPortalShell>,
    );

    await waitFor(() => expect(screen.getByTestId("highlight-list")).toBeInTheDocument());
    const list = screen.getByTestId("highlight-list");
    expect(list).toHaveTextContent("tin ghim");
    expect(list).not.toHaveTextContent("tin thường");
  });
});

describe("🔴 fail-LOUD khi module khác mượn vỏ của SOCIAL", () => {
  it("moduleCode ≠ SOCIAL ⇒ NÉM, không render im lặng", () => {
    /**
     * Rail phải của vỏ này chở sinh nhật — dữ liệu chỉ gác `view:feed`, không cặp HR nào
     * (SOC-DEC-007). Một module portal thứ hai render nhờ vào đây sẽ chiếu PII đó vào ngữ cảnh chưa
     * ai cân nhắc, và nó sẽ trông "hoạt động bình thường" nên không ai phát hiện. Ném là đúng.
     */
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() =>
      renderWithProviders(
        <SocialPortalShell moduleCode="PAYROLL">
          <p>x</p>
        </SocialPortalShell>,
      ),
    ).toThrow(/SocialPortalShell/);
    spy.mockRestore();
  });
});

describe("điều hướng từ rail phải và ô tìm kiếm", () => {
  it("«Gửi lời chúc» điều hướng về `/feed` kèm `?wish=<tên>` (KHÔNG tự đăng bài)", async () => {
    const { makeBirthday } = await import("./social-test-doubles");
    listBirthdays.mockResolvedValue({ data: [makeBirthday({ fullName: "An Nguyễn" })] });

    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p>x</p>
      </SocialPortalShell>,
    );

    await waitFor(() => expect(screen.getByTestId("birthday-wish")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("birthday-wish"));

    expect(navigateSpy).toHaveBeenCalled();
    const arg = navigateSpy.mock.calls.at(-1)?.[0] as { to: string; search: unknown };
    expect(arg.to).toBe("/feed");
    // `search` là HÀM cập nhật (giữ nguyên bộ lọc đang có) chứ không phải object ghi đè — ghi đè sẽ
    // xoá mất `sort`/`tag` người dùng đang đặt.
    expect(typeof arg.search).toBe("function");
    expect((arg.search as (p: Record<string, unknown>) => Record<string, unknown>)({ sort: "latest" })).toEqual({
      sort: "latest",
      wish: "An Nguyễn",
    });
  });

  it("tìm kiếm ⇒ điều hướng `/feed` kèm `?q=`; xoá ⇒ GỠ `q` mà giữ bộ lọc khác", async () => {
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <p>x</p>
      </SocialPortalShell>,
    );

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "nghỉ lễ" } });
    fireEvent.submit(screen.getByTestId("feed-search-box"));

    const submitArg = navigateSpy.mock.calls.at(-1)?.[0] as {
      search: (p: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(submitArg.search({ sort: "latest" })).toEqual({ sort: "latest", q: "nghỉ lễ" });

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    fireEvent.submit(screen.getByTestId("feed-search-box"));

    const clearArg = navigateSpy.mock.calls.at(-1)?.[0] as {
      search: (p: Record<string, unknown>) => Record<string, unknown>;
    };
    // GỠ đúng `q`, KHÔNG xoá sạch: người dùng bỏ từ khoá chứ không bỏ bộ lọc đang đặt.
    expect(clearArg.search({ sort: "latest", q: "cũ" })).toEqual({ sort: "latest" });
  });
});

/**
 * S16-SOCIAL-FE-1 · vá FULL gate 23/09/2026 — ô tìm kiếm phải ĐỌC TỪ URL.
 *
 * Trước bản vá, shell truyền hằng `value=""`. Cái giá không phải "ô trông hơi trống": nút ✕ chỉ
 * render khi `draft.length > 0`, nên mở một link chia sẻ `/feed?q=…` cho ra một bảng tin ĐÃ LỌC mà
 * **không còn đường nào trên UI để xoá bộ lọc** — `onClearSearch` thành code không tới được.
 */
describe("SocialPortalShell — ô tìm kiếm đồng bộ từ URL", () => {
  it("URL có ?q= ⇒ ô tìm kiếm hiện đúng từ khoá (không phải rỗng)", async () => {
    routeSearch = { q: "quy chế" };
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <div>nội dung</div>
      </SocialPortalShell>,
    );

    const box = await screen.findByTestId("feed-search-box");
    const input = box.querySelector("input");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("quy chế"));
  });

  it("URL có ?q= ⇒ CÓ nút xoá bộ lọc, và bấm nó thì điều hướng bỏ q", async () => {
    routeSearch = { q: "quy chế" };
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <div>nội dung</div>
      </SocialPortalShell>,
    );

    // Đây là ca đắt nhất: nút này VẮNG MẶT hoàn toàn trước bản vá.
    const clearBtn = await waitFor(() => {
      const el = screen.getByTestId("feed-search-box").querySelector('button[aria-label]');
      expect(el).not.toBeNull();
      return el as HTMLButtonElement;
    });
    fireEvent.click(clearBtn);
    expect(navigateSpy).toHaveBeenCalled();
  });

  it("URL KHÔNG có q ⇒ ô rỗng (không bịa từ khoá)", async () => {
    routeSearch = {};
    renderWithProviders(
      <SocialPortalShell moduleCode="SOCIAL">
        <div>nội dung</div>
      </SocialPortalShell>,
    );

    const box = await screen.findByTestId("feed-search-box");
    expect((box.querySelector("input") as HTMLInputElement).value).toBe("");
  });
});
