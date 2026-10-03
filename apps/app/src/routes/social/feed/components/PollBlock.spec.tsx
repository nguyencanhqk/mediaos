/**
 * S16-SOCIAL-FE-2 — ca P4 · P4b · P4c · P5 · P6 trên `PollBlock` (plan D5 + §8 H2/H4/M6).
 * S16-SOCIAL-FEBLOCKSEED-1 — ca S1–S4: seed cache `043` từ khối `post.poll` của thẻ (plan §1).
 *
 * Quyền đặt bằng store THẬT (`setCaps`), chỉ `socialApi` bị thay — khuôn `PostCard.spec`.
 * Client test KHÔNG có `staleTime` (= 0) — cố ý: S1–S3 chứng minh khối TỰ khai `staleTime`.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, socialKeys } from "@mediaos/web-core";
import type { FeedPollResultsDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import {
  POLL_OPTION_A,
  POLL_OPTION_B,
  makePollResults,
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../social-test-doubles";
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
const A = POLL_OPTION_A;
const B = POLL_OPTION_B;
const t = i18n.getFixedT("vi", "social");

/** Fixture CHUNG (`postId` = `POST_ID`) — cùng hình dạng cho `043`, `041..044` và khối `post.poll`. */
const makeResults = makePollResults;

/** Kết quả với số phiếu cho từng ô — `totalVoters` truyền riêng (số NGƯỜI, không phải tổng phiếu). */
const tally = (a: number, b: number, totalVoters: number, myVote: string[] = []) =>
  makeResults({
    totalVoters,
    myVote,
    options: [
      { id: A, label: "Cơm", voteCount: a },
      { id: B, label: "Phở", voteCount: b },
    ],
  });

/**
 * Cho mọi fetch-lúc-mount (nếu có) kịp bắn VÀ về rồi mới khẳng định «không gọi 043» — khẳng định ngay
 * sau `render` là xanh-rỗng vì refetch chạy trong effect của observer.
 */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
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
    expect(
      within(screen.getByTestId(`poll-option-${A}`)).getByRole("checkbox"),
    ).toBeInTheDocument();
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

/**
 * S16-SOCIAL-FEBLOCKSEED-1 — seed `results(postId)` từ khối `post.poll` (plan §1).
 *
 * Mọi ca ĐẶT `getPollResults` tường minh với số KHÁC seed (hoặc promise không bao giờ về): `clearAllMocks`
 * giữ implementation của ca trước, và một 043 trùng số với seed sẽ làm ca «vẽ từ seed» xanh-rỗng.
 */
describe("FEBLOCKSEED — seed cache `043` từ `post.poll`", () => {
  it("S1 — có seed ⇒ vẽ NGAY lượt render đầu từ khối thẻ, 0 lần gọi 043 (client `staleTime` 0)", async () => {
    api.getPollResults.mockResolvedValue(tally(9, 0, 9));
    renderWithProviders(<PollBlock postId={POST_ID} isMine={false} seed={tally(2, 1, 3, [A])} />);

    // Lượt render ĐẦU — không skeleton, không chờ mạng.
    expect(screen.queryByTestId("poll-block-loading")).toBeNull();
    expect(screen.getByTestId("poll-total-voters")).toHaveTextContent(
      t("poll.totalVoters", { count: 3 }),
    );
    expect(screen.getByTestId(`poll-option-${A}`)).toHaveTextContent("67%");
    expect(screen.getByTestId(`poll-option-${A}`)).toHaveTextContent(t("poll.myChoice"));
    expect(screen.getByTestId(`poll-option-${B}`)).toHaveTextContent("33%");

    await settle();
    expect(api.getPollResults).not.toHaveBeenCalled();
    // Số không bị một 043 về muộn thay mất.
    expect(screen.getByTestId("poll-total-voters")).toHaveTextContent(
      t("poll.totalVoters", { count: 3 }),
    );
  });

  it("S2 — entry ĐÃ có data (mới hơn) THẮNG seed cũ hơn — không vẽ số của seed, 0 lần gọi 043", async () => {
    const client = makeTestQueryClient();
    client.setQueryData(socialKeys.polls.results(POST_ID), tally(5, 0, 5, [A]));
    api.getPollResults.mockReturnValue(new Promise(() => {}));

    renderWithProviders(
      <PollBlock postId={POST_ID} isMine={false} seed={tally(1, 0, 1)} />,
      client,
    );
    expect(screen.getByTestId("poll-total-voters")).toHaveTextContent(
      t("poll.totalVoters", { count: 5 }),
    );

    await settle();
    expect(screen.getByTestId("poll-total-voters")).toHaveTextContent(
      t("poll.totalVoters", { count: 5 }),
    );
    expect(client.getQueryData(socialKeys.polls.results(POST_ID))).toEqual(tally(5, 0, 5, [A]));
    expect(api.getPollResults).not.toHaveBeenCalled();
  });

  it("S3 — kết quả bỏ phiếu SỐNG qua re-render với seed CŨ (object mới, nội dung trước-bỏ-phiếu)", async () => {
    api.getPollResults.mockReturnValue(new Promise(() => {}));
    api.votePoll.mockResolvedValue(tally(1, 0, 1, [A]));
    const { rerender } = renderWithProviders(
      <PollBlock postId={POST_ID} isMine={false} seed={makeResults()} />,
    );

    fireEvent.click(optionInput(A));
    fireEvent.click(screen.getByTestId("poll-vote"));
    await waitFor(() => expect(screen.getByTestId(`poll-option-${A}`)).toHaveTextContent("100%"));

    // Danh sách cha render lại với ảnh chụp CŨ của thẻ (vd GET gửi trước lượt bỏ phiếu, về sau — plan §0 E6).
    rerender(<PollBlock postId={POST_ID} isMine={false} seed={makeResults()} />);
    await settle();
    expect(screen.getByTestId(`poll-option-${A}`)).toHaveTextContent("100%");
    expect(screen.getByTestId("poll-total-voters")).toHaveTextContent(
      t("poll.totalVoters", { count: 1 }),
    );
    expect(api.getPollResults).not.toHaveBeenCalled();
  });

  it("S4 — có seed + bỏ phiếu 409 ⇒ banner VÀ đúng 1 lần tải lại 043 (khối không bị tắt fetch)", async () => {
    api.votePoll.mockRejectedValue(new ApiError(409, "CONFLICT", "SOCIAL-ERR-016"));
    api.getPollResults.mockResolvedValue(makeResults({ status: "closed" }));
    renderWithProviders(<PollBlock postId={POST_ID} isMine={false} seed={makeResults()} />);

    fireEvent.click(optionInput(A));
    fireEvent.click(screen.getByTestId("poll-vote"));

    expect(await screen.findByTestId("feed-action-error")).toHaveAttribute("data-kind", "vote");
    await waitFor(() =>
      expect(screen.getByTestId("poll-status-label")).toHaveTextContent(t("poll.closed")),
    );
    expect(api.getPollResults).toHaveBeenCalledTimes(1);
  });
});
