/**
 * S16-SOCIAL-FE-1 — ca **C9**: `SOC-SCREEN-003` Tin tức.
 *
 * ┌─ 🔴 HAI CỔNG KHÁC NHAU TRÊN CÙNG MỘT MÀN — đây là thứ ca này giữ ────────────────────────────┐
 * │ • Nút «Xác nhận đã đọc» (021) → `view:feed`. Server luôn dùng `actor.id`, body không nhận      │
 * │   `userId` ⇒ không có đường ack hộ ai, nên KHÔNG được gác bằng cặp quản trị.                   │
 * │ • Tab «Danh sách đã đọc» (022) → **`manage:feed-news`**. Nửa "chưa đọc" chiếu tên/avatar của   │
 * │   MỌI người trong audience — một đường chiếu danh tính toàn công ty.                           │
 * │ Gộp hai cổng (theo chiều nào cũng vậy) là hoặc khoá mất tính năng của nhân viên thường, hoặc   │
 * │ mở danh bạ cho họ.                                                                             │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { NewsPage } from "./NewsPage";
import { makeNews, page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listNews = vi.fn();
const ackPost = vi.fn();
const listPostAcks = vi.fn();

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
    socialApi: {
      ...actual.socialApi,
      listNews: (...a: unknown[]) => listNews(...a),
      ackPost: (...a: unknown[]) => ackPost(...a),
      listPostAcks: (...a: unknown[]) => listPostAcks(...a),
    },
  };
});

beforeEach(() => {
  setCaps({ "view:feed": true });
  listNews.mockReset();
  ackPost.mockReset();
  listPostAcks.mockReset();
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("C9 — nút «Xác nhận đã đọc» gác bằng `view:feed` (không cặp quản trị)", () => {
  it("ALLOW: chỉ `view:feed` + tin `requiresAck` chưa ack ⇒ nút HIỆN và gọi 021", async () => {
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true, ackedByMe: false })]));
    ackPost.mockResolvedValue({ postId: "p", firstTime: true });
    renderWithProviders(<NewsPage />);

    await waitFor(() => expect(screen.getByTestId("news-ack-button")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("news-ack-button"));
    await waitFor(() => expect(ackPost).toHaveBeenCalledTimes(1));
  });

  it("đã ack ⇒ hiện trạng thái, KHÔNG còn nút (không mời bấm lại)", async () => {
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true, ackedByMe: true })]));
    renderWithProviders(<NewsPage />);

    await waitFor(() => expect(screen.getByTestId("news-acked")).toBeInTheDocument());
    expect(screen.queryByTestId("news-ack-button")).toBeNull();
  });

  it("tin KHÔNG yêu cầu xác nhận ⇒ không có nút ack nào", async () => {
    // `ackedByMe` LUÔN có mặt (contracts cố ý) — nên nhánh này phải rẽ theo `requiresAck`, không
    // theo sự vắng mặt của khoá.
    listNews.mockResolvedValue(page([makeNews({ requiresAck: false, ackedByMe: false })]));
    renderWithProviders(<NewsPage />);

    await waitFor(() => expect(screen.getByTestId("news-list")).toBeInTheDocument());
    expect(screen.queryByTestId("news-ack-button")).toBeNull();
    expect(screen.queryByTestId("news-acked")).toBeNull();
  });
});

describe("C9 — «Danh sách đã đọc» gác bằng `manage:feed-news`", () => {
  it("DENY: chỉ `view:feed` ⇒ nút/tab «Danh sách đã đọc» VẮNG", async () => {
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true })]));
    renderWithProviders(<NewsPage />);

    await waitFor(() => expect(screen.getByTestId("news-list")).toBeInTheDocument());
    expect(screen.queryByTestId("news-readers-toggle")).toBeNull();
    // Đối chứng: màn KHÔNG rỗng vì lý do khác — nút ack vẫn ở đó.
    expect(screen.getByTestId("news-ack-button")).toBeInTheDocument();
  });

  it("ALLOW: có `manage:feed-news` ⇒ nút HIỆN, và 022 CHỈ gọi khi thực sự mở", async () => {
    setCaps({ "view:feed": true, "manage:feed-news": true });
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true })]));
    listPostAcks.mockResolvedValue({ data: [], nextCursor: null });
    renderWithProviders(<NewsPage />);

    await waitFor(() => expect(screen.getByTestId("news-readers-toggle")).toBeInTheDocument());
    // Route 022 chiếu danh tính toàn công ty — KHÔNG được gọi sẵn "cho nhanh".
    expect(listPostAcks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("news-readers-toggle"));
    await waitFor(() => expect(listPostAcks).toHaveBeenCalledTimes(1));
  });
});

describe("C9 — trạng thái của màn", () => {
  it("rỗng ⇒ câu rỗng RIÊNG của tin tức", async () => {
    listNews.mockResolvedValue(page([]));
    renderWithProviders(<NewsPage />);

    const t = i18n.getFixedT("vi", "social");
    await waitFor(() => expect(screen.getByTestId("news-empty")).toBeInTheDocument());
    expect(screen.getByTestId("news-empty")).toHaveTextContent(t("empty.news"));
    expect(t("empty.news")).not.toBe(t("empty.feed"));
  });

  it("lỗi ⇒ khối lỗi có nút thử lại", async () => {
    listNews.mockRejectedValue(new Error("boom"));
    renderWithProviders(<NewsPage />);
    await waitFor(() => expect(screen.getByTestId("news-error")).toBeInTheDocument());
  });
});
