/**
 * S16-SOCIAL-FE-2 — ca I2 · I3 · I4 · L1 trên `SOC-SCREEN-008` + hộp thoại xét duyệt (plan D8).
 *
 * Quyền đặt bằng store THẬT (`setCaps`) — `PermissionGate`/`useCan` đo luật thật, không đo mock.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { ApiError, socialKeys } from "@mediaos/web-core";
import type { FeedIdeaItemDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import {
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../feed/social-test-doubles";
import { IdeasPage } from "./IdeasPage";

const listIdeas = vi.fn();
const reviewIdea = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      listIdeas: (...a: unknown[]) => listIdeas(...a),
      reviewIdea: (...a: unknown[]) => reviewIdea(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

const t = i18n.getFixedT("vi", "social");
const POST_ID = "11111111-1111-4111-8111-111111111111";
const IDEA_ID = "22222222-2222-4222-8222-222222222222";

const idea = (over: Partial<FeedIdeaItemDto> = {}): FeedIdeaItemDto => ({
  ideaId: IDEA_ID,
  postId: POST_ID,
  status: "submitted",
  body: "Lắp thêm máy lọc nước",
  reviewNote: null,
  reviewer: null,
  reviewedAt: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});
const pageOf = (data: FeedIdeaItemDto[]) => ({ data, page: 1, limit: 20, total: data.length });
const APPROVER = { "view:feed": true, "approve:feed-idea": true };

async function renderWith(items: FeedIdeaItemDto[]): Promise<void> {
  listIdeas.mockResolvedValue(pageOf(items));
  renderWithProviders(<IdeasPage />);
  await screen.findByTestId("ideas-list");
}

beforeEach(() => setCaps({ "view:feed": true }));
afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("I2 — nút «Xét duyệt» gác `approve:feed-idea`", () => {
  it("DENY: chỉ `view:feed` ⇒ nút VẮNG (dòng + pill vẫn render — đối chứng)", async () => {
    await renderWith([idea()]);
    expect(screen.getByTestId("idea-status-pill")).toHaveTextContent(t("idea.status.submitted"));
    expect(screen.queryByTestId("idea-review-open")).toBeNull();
  });

  it("ALLOW: `approve:feed-idea` ⇒ nút hiện", async () => {
    setCaps(APPROVER);
    await renderWith([idea()]);
    expect(screen.getByTestId("idea-review-open")).toBeInTheDocument();
  });

  it("trạng thái terminal (`accepted`/`rejected`) ⇒ không nút, kể cả với người duyệt", async () => {
    setCaps(APPROVER);
    await renderWith([
      idea({ status: "accepted" }),
      idea({ ideaId: "33333333-3333-4333-8333-333333333333", status: "rejected" }),
    ]);
    expect(screen.queryByTestId("idea-review-open")).toBeNull();
  });
});

describe("I3 — hộp thoại xét duyệt", () => {
  it("`submitted` ⇒ CHỈ một đích `under_review`, chọn sẵn; gửi KHÔNG kèm `reviewNote` rỗng", async () => {
    setCaps(APPROVER);
    reviewIdea.mockResolvedValue({
      postId: POST_ID,
      ideaId: IDEA_ID,
      status: "under_review",
      reviewedAt: "2026-09-29T00:00:00.000Z",
    });
    await renderWith([idea()]);
    fireEvent.click(screen.getByTestId("idea-review-open"));

    const dialog = screen.getByTestId("idea-review-dialog");
    expect(within(dialog).getAllByRole("radio")).toHaveLength(1);
    expect(screen.getByTestId("idea-review-target-under_review")).toBeChecked();
    fireEvent.click(screen.getByTestId("idea-review-submit"));

    await waitFor(() =>
      expect(reviewIdea).toHaveBeenCalledWith(POST_ID, { status: "under_review" }),
    );
    // Thành công ⇒ đóng hộp thoại + tải lại danh sách.
    await waitFor(() => expect(screen.queryByTestId("idea-review-dialog")).toBeNull());
    await waitFor(() => expect(listIdeas).toHaveBeenCalledTimes(2));
  });

  it("`under_review` ⇒ hai đích; chọn «từ chối» mà không ghi lý do ⇒ KHÔNG gửi được", async () => {
    setCaps(APPROVER);
    await renderWith([idea({ status: "under_review" })]);
    fireEvent.click(screen.getByTestId("idea-review-open"));

    expect(screen.getByTestId("idea-review-target-accepted")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("idea-review-target-rejected"));
    expect(screen.getByTestId("idea-review-note-required")).toHaveTextContent(
      t("idea.noteRequired"),
    );
    fireEvent.change(screen.getByTestId("idea-review-note"), { target: { value: "   " } });
    expect(screen.getByTestId("idea-review-submit")).toBeDisabled();

    fireEvent.change(screen.getByTestId("idea-review-note"), {
      target: { value: " trùng ý tưởng cũ " },
    });
    fireEvent.click(screen.getByTestId("idea-review-submit"));
    await waitFor(() =>
      expect(reviewIdea).toHaveBeenCalledWith(POST_ID, {
        status: "rejected",
        reviewNote: "trùng ý tưởng cũ",
      }),
    );
  });

  it("409 (người khác duyệt trước) ⇒ banner `ideaReview` + tải lại danh sách, hộp thoại ở lại", async () => {
    setCaps(APPROVER);
    reviewIdea.mockRejectedValue(new ApiError(409, "CONFLICT", "SOCIAL-ERR-019"));
    await renderWith([idea()]);
    fireEvent.click(screen.getByTestId("idea-review-open"));
    fireEvent.click(screen.getByTestId("idea-review-submit"));

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "ideaReview");
    expect(banner).toHaveTextContent(t("actionError.generic.ideaReview"));
    expect(screen.getByTestId("idea-review-dialog")).toBeInTheDocument();
    await waitFor(() => expect(listIdeas).toHaveBeenCalledTimes(2));
  });

  it("đã có ghi chú ⇒ báo «ghi chú mới thay ghi chú cũ»", async () => {
    setCaps(APPROVER);
    await renderWith([idea({ status: "under_review", reviewNote: "cần thêm số liệu" })]);
    fireEvent.click(screen.getByTestId("idea-review-open"));
    expect(screen.getByTestId("idea-review-replaces")).toHaveTextContent(t("idea.noteReplaces"));
  });
});

describe("I4 — `reviewNote` vẽ ĐÚNG giá trị server trả (server đã mask)", () => {
  it("`null` ⇒ không khối ghi chú, không chữ «null»", async () => {
    await renderWith([idea({ status: "rejected", reviewer: { fullName: "Hà" } })]);
    expect(screen.queryByTestId("idea-review-note-view")).toBeNull();
    expect(screen.getByTestId("ideas-list")).not.toHaveTextContent("null");
    expect(screen.getByTestId("ideas-list")).toHaveTextContent(
      t("idea.reviewedBy", { name: "Hà" }),
    );
  });

  it("có chữ ⇒ hiện", async () => {
    await renderWith([idea({ status: "rejected", reviewNote: "trùng ý tưởng cũ" })]);
    expect(screen.getByTestId("idea-review-note-view")).toHaveTextContent("trùng ý tưởng cũ");
  });
});

describe("L1 — lọc · rỗng · lỗi", () => {
  it("lọc «Đang xem xét» ⇒ gửi `status=under_review`; rỗng ⇒ câu RIÊNG của bộ lọc", async () => {
    listIdeas.mockResolvedValue(pageOf([]));
    renderWithProviders(<IdeasPage />);
    expect(await screen.findByTestId("ideas-empty")).toHaveTextContent(t("ideas.empty"));
    fireEvent.click(screen.getByTestId("ideas-filter-under_review"));
    await waitFor(() =>
      expect(listIdeas.mock.calls.at(-1)?.[0]).toMatchObject({ status: "under_review" }),
    );
    expect(await screen.findByTestId("ideas-empty")).toHaveTextContent(t("ideas.emptyFiltered"));
  });

  it("lỗi tải ⇒ khối lỗi có «Thử lại»", async () => {
    listIdeas.mockRejectedValue(new Error("500"));
    renderWithProviders(<IdeasPage />);
    expect(await screen.findByTestId("ideas-error")).toHaveTextContent(t("state.retry"));
  });
});

/**
 * S16-SOCIAL-FEBLOCKSEED-1 — pill trạng thái giờ có trên THẺ BÀI (đọc `post.idea` từ cache danh sách/chi
 * tiết bài) ⇒ xét duyệt phải làm tươi cả các cache đó, không chỉ `ideas.allOf()`. Đổi dòng H5 của plan
 * FE-2 §8 (viết trước khi thẻ có pill). Đo bằng trạng thái THẬT của cache (`isInvalidated`), không spy.
 */
describe("FEBLOCKSEED — xét duyệt làm tươi pill trên thẻ bài", () => {
  const OTHER_POST = "33333333-3333-4333-8333-333333333333";

  /** Gieo các cache mà pill trên thẻ đọc + một khoá ĐỐI CHỨNG (bài khác) không được chạm. */
  function renderSeeded(): QueryClient {
    const client = makeTestQueryClient();
    client.setQueryData(socialKeys.feed.list({}), { pages: [], pageParams: [] });
    client.setQueryData(socialKeys.saved(), { pages: [], pageParams: [] });
    client.setQueryData(socialKeys.posts.detail(POST_ID), { id: POST_ID });
    client.setQueryData(socialKeys.posts.detail(OTHER_POST), { id: OTHER_POST });
    listIdeas.mockResolvedValue(pageOf([idea()]));
    renderWithProviders(<IdeasPage />, client);
    return client;
  }

  const isInvalidated = (client: QueryClient, key: readonly unknown[]): boolean =>
    client.getQueryState(key)?.isInvalidated === true;

  function expectCardCachesInvalidated(client: QueryClient): void {
    expect(isInvalidated(client, socialKeys.feed.list({}))).toBe(true);
    expect(isInvalidated(client, socialKeys.saved())).toBe(true);
    expect(isInvalidated(client, socialKeys.posts.detail(POST_ID))).toBe(true);
    // Chính xác, không rộng: chi tiết của bài KHÁC giữ nguyên.
    expect(isInvalidated(client, socialKeys.posts.detail(OTHER_POST))).toBe(false);
  }

  it("S9 — 046 thành công ⇒ invalidate `feed.allOf()` · `saved()` · `posts.detail(postId)`", async () => {
    setCaps(APPROVER);
    reviewIdea.mockResolvedValue({
      postId: POST_ID,
      ideaId: IDEA_ID,
      status: "under_review",
      reviewedAt: "2026-09-29T00:00:00.000Z",
    });
    const client = renderSeeded();
    await screen.findByTestId("ideas-list");
    // Đối chứng: trước khi duyệt, không cache thẻ nào bị đánh dấu.
    expect(isInvalidated(client, socialKeys.feed.list({}))).toBe(false);

    fireEvent.click(screen.getByTestId("idea-review-open"));
    fireEvent.click(screen.getByTestId("idea-review-submit"));
    await waitFor(() => expect(screen.queryByTestId("idea-review-dialog")).toBeNull());

    expectCardCachesInvalidated(client);
  });

  it("S10 — 409 (người khác vừa đổi trạng thái) ⇒ cùng tập cache thẻ bị invalidate, banner vẫn hiện", async () => {
    setCaps(APPROVER);
    reviewIdea.mockRejectedValue(new ApiError(409, "CONFLICT", "SOCIAL-ERR-019"));
    const client = renderSeeded();
    await screen.findByTestId("ideas-list");

    fireEvent.click(screen.getByTestId("idea-review-open"));
    fireEvent.click(screen.getByTestId("idea-review-submit"));

    expect(await screen.findByTestId("feed-action-error")).toHaveAttribute(
      "data-kind",
      "ideaReview",
    );
    await waitFor(() => expectCardCachesInvalidated(client));
  });
});
