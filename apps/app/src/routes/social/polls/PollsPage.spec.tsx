/**
 * S16-SOCIAL-FE-2 — ca L1 trên `SOC-SCREEN-007` (plan D7): loading · error + thử lại · empty · tab.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { renderWithProviders, resetCaps, setCaps } from "../feed/social-test-doubles";
import { PollsPage } from "./PollsPage";

const listPolls = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: { ...actual.socialApi, listPolls: (...a: unknown[]) => listPolls(...a) },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to, params }: { children: ReactNode; to: string; params?: object }) => (
      <a href={params ? to.replace("$postId", (params as { postId: string }).postId) : to}>
        {children}
      </a>
    ),
  };
});

const t = i18n.getFixedT("vi", "social");
const row = (over: Record<string, unknown> = {}) => ({
  pollId: "22222222-2222-4222-8222-222222222222",
  postId: "11111111-1111-4111-8111-111111111111",
  question: "Ăn trưa ở đâu?",
  status: "open",
  isAnonymous: true,
  closesAt: null,
  closedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});
const pageOf = (data: unknown[], total = data.length) => ({ data, page: 1, limit: 20, total });

beforeEach(() => setCaps({ "view:feed": true }));
afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("L1 — màn Bình chọn", () => {
  it("mặc định tab «Đang mở» ⇒ gọi 040 với `status=open`, dòng trỏ tới bài", async () => {
    listPolls.mockResolvedValue(pageOf([row()]));
    renderWithProviders(<PollsPage />);

    const list = await screen.findByTestId("polls-list");
    expect(list).toHaveTextContent("Ăn trưa ở đâu?");
    expect(list).toHaveTextContent(t("poll.anonymous"));
    expect(listPolls.mock.calls[0]?.[0]).toMatchObject({ status: "open", page: 1 });
    expect(list.querySelector("a")).toHaveAttribute(
      "href",
      "/feed/posts/11111111-1111-4111-8111-111111111111",
    );
  });

  it("tab «Tất cả» ⇒ KHÔNG gửi `status`", async () => {
    listPolls.mockResolvedValue(pageOf([]));
    renderWithProviders(<PollsPage />);
    await screen.findByTestId("polls-empty");
    fireEvent.click(screen.getByTestId("polls-tab-all"));
    await waitFor(() => expect(listPolls).toHaveBeenCalledTimes(2));
    expect(listPolls.mock.calls[1]?.[0]).not.toHaveProperty("status");
  });

  it("rỗng ở tab «Đang mở» ⇒ câu RIÊNG «không có bình chọn nào đang mở»", async () => {
    listPolls.mockResolvedValue(pageOf([]));
    renderWithProviders(<PollsPage />);
    expect(await screen.findByTestId("polls-empty")).toHaveTextContent(t("polls.emptyOpen"));
  });

  it("poll `open` QUÁ HẠN ⇒ nhãn «Đã hết hạn», không «Kết thúc …»", async () => {
    listPolls.mockResolvedValue(pageOf([row({ closesAt: "2020-01-01T00:00:00.000Z" })]));
    renderWithProviders(<PollsPage />);
    expect(await screen.findByTestId("polls-list")).toHaveTextContent(t("poll.expired"));
  });

  it("lỗi tải ⇒ khối lỗi + «Thử lại» gọi lại 040", async () => {
    listPolls.mockRejectedValueOnce(new Error("500")).mockResolvedValue(pageOf([row()]));
    renderWithProviders(<PollsPage />);
    const box = await screen.findByTestId("polls-error");
    fireEvent.click(box.querySelector("button")!);
    expect(await screen.findByTestId("polls-list")).toBeInTheDocument();
  });

  it("nhiều trang ⇒ «Trang sau» gọi trang 2", async () => {
    listPolls.mockResolvedValue(pageOf([row()], 45));
    renderWithProviders(<PollsPage />);
    await screen.findByTestId("polls-list");
    fireEvent.click(screen.getByTestId("offset-pager-next"));
    await waitFor(() =>
      expect(listPolls.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2, status: "open" }),
    );
  });
});
