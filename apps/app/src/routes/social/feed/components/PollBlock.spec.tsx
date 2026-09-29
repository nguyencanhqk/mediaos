/**
 * S16-SOCIAL-FE-2 — ca P4 · P4b · P4c · P5 · P6 trên `PollBlock` (plan D5 + §8 H2/H4/M6).
 *
 * Quyền đặt bằng store THẬT (`setCaps`), chỉ `socialApi` bị thay — khuôn `PostCard.spec`.
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@mediaos/web-core";
import type { FeedPollResultsDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { renderWithProviders, resetCaps, setCaps } from "../social-test-doubles";
import { PollBlock } from "./PollBlock";

const api = {
  getPollResults: vi.fn(),
  votePoll: vi.fn(),
  withdrawPollVote: vi.fn(),
  closePoll: vi.fn(),
};

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      getPollResults: (...a: unknown[]) => api.getPollResults(...a),
      votePoll: (...a: unknown[]) => api.votePoll(...a),
      withdrawPollVote: (...a: unknown[]) => api.withdrawPollVote(...a),
      closePoll: (...a: unknown[]) => api.closePoll(...a),
    },
  };
});

const POST_ID = "11111111-1111-4111-8111-111111111111";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const t = i18n.getFixedT("vi", "social");

const makeResults = (over: Partial<FeedPollResultsDto> = {}): FeedPollResultsDto => ({
  pollId: "22222222-2222-4222-8222-222222222222",
  postId: POST_ID,
  question: "Ăn trưa ở đâu?",
  status: "open",
  multipleChoice: false,
  isAnonymous: false,
  closesAt: null,
  totalVoters: 0,
  myVote: [],
  options: [
    { id: A, label: "Cơm", voteCount: 0 },
    { id: B, label: "Phở", voteCount: 0 },
  ],
  ...over,
});

const optionInput = (id: string): HTMLInputElement =>
  within(screen.getByTestId(`poll-option-${id}`)).getByRole(
    screen.getByTestId(`poll-option-${id}`).querySelector("input")?.type === "checkbox"
      ? "checkbox"
      : "radio",
  ) as HTMLInputElement;

async function renderBlock(results: FeedPollResultsDto, isMine = false): Promise<void> {
  api.getPollResults.mockResolvedValue(results);
  renderWithProviders(<PollBlock postId={POST_ID} isMine={isMine} />);
  await screen.findByTestId("poll-block");
}

beforeEach(() => {
  setCaps({ "view:feed": true });
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("P4 — kiểu chọn · thanh % · bỏ phiếu", () => {
  it("một-lựa-chọn ⇒ radio; nhiều-lựa-chọn ⇒ checkbox", async () => {
    await renderBlock(makeResults());
    expect(within(screen.getByTestId(`poll-option-${A}`)).getByRole("radio")).toBeInTheDocument();
    cleanup();
    await renderBlock(makeResults({ multipleChoice: true }));
    expect(within(screen.getByTestId(`poll-option-${A}`)).getByRole("checkbox")).toBeInTheDocument();
  });

  it("chưa ai bỏ phiếu ⇒ 0%, KHÔNG «NaN%»", async () => {
    await renderBlock(makeResults());
    expect(screen.getByTestId("poll-block")).not.toHaveTextContent("NaN");
    expect(screen.getByTestId(`poll-option-${A}`)).toHaveTextContent("0%");
  });

  it("chọn một ô rồi bấm «Bỏ phiếu» ⇒ PUT với đúng ô đó", async () => {
    api.votePoll.mockResolvedValue(makeResults({ myVote: [A], totalVoters: 1 }));
    await renderBlock(makeResults());
    fireEvent.click(optionInput(A));
    fireEvent.click(screen.getByTestId("poll-vote"));
    await waitFor(() => expect(api.votePoll).toHaveBeenCalledWith(POST_ID, [A]));
  });

  it("«Bỏ phiếu» KHOÁ khi chưa chọn gì, và khi tập chọn TRÙNG phiếu hiện có", async () => {
    await renderBlock(makeResults({ myVote: [A], totalVoters: 1 }));
    expect(screen.getByTestId("poll-vote")).toBeDisabled();
    fireEvent.click(optionInput(B));
    expect(screen.getByTestId("poll-vote")).not.toBeDisabled();
    expect(screen.getByTestId("poll-vote")).toHaveTextContent(t("poll.changeVote"));
  });

  it("🔴 P4b — nhiều-lựa-chọn: `myVote=[A]`, tích B ⇒ gửi CẢ TẬP [A,B] (không phải [B])", async () => {
    api.votePoll.mockResolvedValue(makeResults({ multipleChoice: true, myVote: [A, B] }));
    await renderBlock(makeResults({ multipleChoice: true, myVote: [A], totalVoters: 1 }));
    fireEvent.click(optionInput(B));
    fireEvent.click(screen.getByTestId("poll-vote"));
    await waitFor(() => expect(api.votePoll).toHaveBeenCalledTimes(1));
    expect(api.votePoll.mock.calls[0]?.[1]).toEqual([A, B]);
  });

  it("kết quả mutation được GHI vào khối (không gọi lại 043)", async () => {
    api.votePoll.mockResolvedValue(
      makeResults({
        myVote: [A],
        totalVoters: 1,
        options: [
          { id: A, label: "Cơm", voteCount: 1 },
          { id: B, label: "Phở", voteCount: 0 },
        ],
      }),
    );
    await renderBlock(makeResults());
    fireEvent.click(optionInput(A));
    fireEvent.click(screen.getByTestId("poll-vote"));
    await waitFor(() => expect(screen.getByTestId(`poll-option-${A}`)).toHaveTextContent("100%"));
    expect(api.getPollResults).toHaveBeenCalledTimes(1);
  });
});

describe("P4c — đã đóng / quá hạn mà job chưa chạy", () => {
  it("`closed` ⇒ input disabled, không nút bỏ/rút phiếu, nhãn «Đã kết thúc»", async () => {
    await renderBlock(makeResults({ status: "closed", myVote: [A] }));
    expect(optionInput(A)).toBeDisabled();
    expect(screen.queryByTestId("poll-vote")).toBeNull();
    expect(screen.queryByTestId("poll-withdraw")).toBeNull();
    expect(screen.getByTestId("poll-status-label")).toHaveTextContent(t("poll.closed"));
  });

  it("🔴 `status:'open'` + `closesAt` QUÁ KHỨ ⇒ khoá như đã đóng, nhãn «Đã hết hạn»", async () => {
    await renderBlock(makeResults({ closesAt: "2020-01-01T00:00:00.000Z", myVote: [A] }));
    expect(optionInput(A)).toBeDisabled();
    expect(screen.queryByTestId("poll-vote")).toBeNull();
    expect(screen.queryByTestId("poll-withdraw")).toBeNull();
    expect(screen.getByTestId("poll-status-label")).toHaveTextContent(t("poll.expired"));
  });
});

describe("rút phiếu (042)", () => {
  it("có phiếu + còn nhận ⇒ nút «Rút phiếu» gọi DELETE", async () => {
    api.withdrawPollVote.mockResolvedValue(makeResults());
    await renderBlock(makeResults({ myVote: [A], totalVoters: 1 }));
    fireEvent.click(screen.getByTestId("poll-withdraw"));
    await waitFor(() => expect(api.withdrawPollVote).toHaveBeenCalledWith(POST_ID));
  });

  it("chưa bỏ phiếu ⇒ không có nút «Rút phiếu»", async () => {
    await renderBlock(makeResults());
    expect(screen.queryByTestId("poll-withdraw")).toBeNull();
  });
});

describe("P5 — «Kết thúc bình chọn»: chủ bài HOẶC `manage:feed-post`", () => {
  it("DENY: người khác, không `manage:feed-post` ⇒ nút VẮNG (khối vẫn render — đối chứng)", async () => {
    await renderBlock(makeResults());
    expect(screen.getByTestId("poll-vote")).toBeInTheDocument();
    expect(screen.queryByTestId("poll-close")).toBeNull();
  });

  it("ALLOW: chủ bài", async () => {
    await renderBlock(makeResults(), true);
    expect(screen.getByTestId("poll-close")).toBeInTheDocument();
  });

  it("ALLOW: `manage:feed-post` dù không phải chủ bài", async () => {
    setCaps({ "view:feed": true, "manage:feed-post": true });
    await renderBlock(makeResults());
    expect(screen.getByTestId("poll-close")).toBeInTheDocument();
  });

  it("đã `closed` ⇒ vắng kể cả với chủ bài", async () => {
    await renderBlock(makeResults({ status: "closed" }), true);
    expect(screen.queryByTestId("poll-close")).toBeNull();
  });

  it("bấm ⇒ POST close, khối chuyển «Đã kết thúc» từ chính phản hồi", async () => {
    api.closePoll.mockResolvedValue(makeResults({ status: "closed" }));
    await renderBlock(makeResults(), true);
    fireEvent.click(screen.getByTestId("poll-close"));
    await waitFor(() =>
      expect(screen.getByTestId("poll-status-label")).toHaveTextContent(t("poll.closed")),
    );
    expect(api.closePoll).toHaveBeenCalledWith(POST_ID);
  });
});

describe("P6 — ghi hỏng KHÔNG im lặng", () => {
  it("vote 409 ⇒ banner kind `vote` + kéo lại 043", async () => {
    api.votePoll.mockRejectedValue(new ApiError(409, "CONFLICT", "SOCIAL-ERR-016"));
    await renderBlock(makeResults());
    fireEvent.click(optionInput(A));
    fireEvent.click(screen.getByTestId("poll-vote"));

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "vote");
    expect(banner).toHaveTextContent(t("actionError.generic.vote"));
    // Chữ đã dịch, không phải khoá thô (khoá i18n thiếu thì i18next in nguyên khoá).
    expect(banner).not.toHaveTextContent("actionError.");
    await waitFor(() => expect(api.getPollResults).toHaveBeenCalledTimes(2));
  });

  it("vote 403 ⇒ nhánh `forbidden`", async () => {
    api.votePoll.mockRejectedValue(new ApiError(403, "FORBIDDEN", "x"));
    await renderBlock(makeResults());
    fireEvent.click(optionInput(A));
    fireEvent.click(screen.getByTestId("poll-vote"));
    expect(await screen.findByTestId("feed-action-error")).toHaveTextContent(
      t("actionError.forbidden.vote"),
    );
  });

  it("close 500 ⇒ banner kind `pollClose`", async () => {
    api.closePoll.mockRejectedValue(new ApiError(500, "SYSTEM", "boom"));
    await renderBlock(makeResults(), true);
    fireEvent.click(screen.getByTestId("poll-close"));
    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "pollClose");
    expect(banner).toHaveTextContent(t("actionError.generic.pollClose"));
  });

  it("tải 043 lỗi ⇒ khối lỗi có nút thử lại (không phải thẻ trống)", async () => {
    api.getPollResults.mockRejectedValue(new ApiError(500, "SYSTEM", "boom"));
    renderWithProviders(<PollBlock postId={POST_ID} isMine={false} />);
    const box = await screen.findByTestId("poll-block-error");
    expect(box).toHaveTextContent(t("poll.errorTitle"));
    api.getPollResults.mockResolvedValue(makeResults());
    fireEvent.click(within(box).getByRole("button"));
    expect(await screen.findByTestId("poll-block")).toBeInTheDocument();
  });
});
