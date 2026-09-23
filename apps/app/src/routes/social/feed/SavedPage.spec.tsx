/**
 * S16-SOCIAL-FE-1 — ca **C10**: `SOC-SCREEN-004` Đã lưu.
 *
 * Điều ca này thật sự giữ không phải "có render danh sách" mà là **câu rỗng RIÊNG**: màn này dùng
 * chung `FeedPostList` với Bảng tin và Trang cá nhân, nên một lần truyền nhầm `emptyText` sẽ cho
 * người dùng đọc «chưa có bài nào trên bảng tin» trong khi thật ra là "bạn chưa lưu gì" — hai tình
 * huống khác hẳn, hai hành động tiếp theo khác hẳn.
 */
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { SavedPage } from "./SavedPage";
import { makePost, page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listSaved = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
  };
});

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: { ...actual.socialApi, listSaved: (...a: unknown[]) => listSaved(...a) },
  };
});

beforeEach(() => {
  setCaps({ "view:feed": true });
  listSaved.mockReset();
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("C10 — SOC-SCREEN-004 Đã lưu", () => {
  it("ALLOW: có bài ⇒ danh sách render", async () => {
    listSaved.mockResolvedValue(page([makePost({ savedByMe: true })]));
    renderWithProviders(<SavedPage />);

    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());
    expect(screen.getAllByTestId("post-card")).toHaveLength(1);
  });

  it("DENY: rỗng ⇒ câu rỗng RIÊNG «chưa lưu bài nào», KHÔNG phải câu của bảng tin", async () => {
    listSaved.mockResolvedValue(page([]));
    renderWithProviders(<SavedPage />);

    const t = i18n.getFixedT("vi", "social");
    await waitFor(() => expect(screen.getByTestId("feed-empty")).toBeInTheDocument());
    expect(screen.getByTestId("feed-empty")).toHaveTextContent(t("empty.saved"));
    // Vế đối chứng: nếu ai đó truyền nhầm `empty.feed` thì ca trên vẫn xanh, ca này thì không.
    expect(screen.getByTestId("feed-empty")).not.toHaveTextContent(t("empty.feed"));
  });

  it("lỗi tải ⇒ khối lỗi trong cột giữa (không màn trắng)", async () => {
    listSaved.mockRejectedValue(new Error("boom"));
    renderWithProviders(<SavedPage />);
    await waitFor(() => expect(screen.getByTestId("feed-error")).toBeInTheDocument());
  });

  it("KHÔNG gửi bộ lọc nào lên `010` (route đó không nhận bộ lọc ngoài phân trang)", async () => {
    listSaved.mockResolvedValue(page([]));
    renderWithProviders(<SavedPage />);

    await waitFor(() => expect(listSaved).toHaveBeenCalled());
    const arg = listSaved.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(arg).sort()).toEqual(["cursor", "limit"]);
  });
});

describe("tương tác của màn (callback nối vào query)", () => {
  it("«Thử lại» thực sự gọi lại API", async () => {
    listSaved.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(page([makePost()]));
    renderWithProviders(<SavedPage />);

    await waitFor(() => expect(screen.getByTestId("feed-error")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /thử lại/i }));
    // Nút thử lại không nối vào `refetch` là một nút trang trí — người dùng bấm mãi không có gì xảy ra.
    await waitFor(() => expect(screen.getByTestId("feed-post-list")).toBeInTheDocument());
  });

  it("«Xem thêm» tải trang kế bằng con trỏ keyset của trang trước", async () => {
    listSaved
      .mockResolvedValueOnce({ data: [makePost({ id: "p1" })], nextCursor: "CUR-1" })
      .mockResolvedValueOnce({ data: [makePost({ id: "p2" })], nextCursor: null });
    renderWithProviders(<SavedPage />);

    await waitFor(() => expect(screen.getByTestId("feed-load-more")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("feed-load-more"));

    await waitFor(() => expect(listSaved).toHaveBeenCalledTimes(2));
    // Con trỏ phải đi từ phản hồi TRƯỚC, không phải một số trang tự đếm — keyset không có số trang.
    expect((listSaved.mock.calls[1][0] as Record<string, unknown>).cursor).toBe("CUR-1");
    await waitFor(() => expect(screen.queryByTestId("feed-load-more")).toBeNull());
  });
});
