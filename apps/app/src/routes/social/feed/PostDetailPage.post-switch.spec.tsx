/**
 * S16-SOCIAL-FE-3C (gate TypeScript của PR-C, finding TSC-03) — đổi `$postId` trên ROUTER THẬT (`createRouter` +
 * `createMemoryHistory`): hai hộp thoại gắn với MỘT bình luận không được sống sang bài khác.
 *
 * TanStack Router KHÔNG mount lại component của route khi chỉ tham số đường dẫn đổi (app không khai `remountDeps`), nên
 * `PostDetailPage` và mọi state bên dưới nó sống qua lượt Back / Forward giữa hai bài. Bài đích còn trong cache thì
 * trang vẽ ngay bài đó — không qua khung chờ — và `CommentList` giữ nguyên chỗ: hộp thoại «Báo cáo bình luận» (L8) và
 * hộp xác nhận xoá bình luận (FE-1) mở cho bình luận của bài CŨ nổi trên bài MỚI, không dòng nào cho biết chúng nhắm
 * vào đâu. `PostDetailPage` vì vậy đặt `key={postId}` cho `<CommentList>`.
 *
 * Mỗi ca đếm số lượt MOUNT của component route làm đối chứng: ca chỉ có nghĩa khi trang KHÔNG mount lại (router đổi
 * mặc định thành mount lại thì `key` hết việc và bộ đếm sẽ báo). File RIÊNG: `PostDetailPage.spec.tsx` không sửa.
 *
 * Cây route là bản TỐI GIẢN của `router.tsx` (khuôn `FeedPage.router.spec.tsx`): cùng path, không vỏ, không cổng.
 * THẬT: router · trang · `CommentList` · hai hộp thoại · i18n. GIẢ: bốn lời gọi API. Chữ kỳ vọng VIẾT TAY.
 */
import * as React from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { FeedCommentDto } from "@mediaos/contracts";
import { socialKeys } from "@mediaos/web-core";
import { PostDetailPage } from "./PostDetailPage";
import {
  makeComment,
  makePost,
  page,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "./social-test-doubles";

const getPost = vi.fn();
const listComments = vi.fn();
const deleteComment = vi.fn();
const createReport = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialApi: {
      ...actual.socialApi,
      getPost: (...a: unknown[]) => getPost(...a),
      listComments: (...a: unknown[]) => listComments(...a),
      deleteComment: (...a: unknown[]) => deleteComment(...a),
    },
    socialModerationApi: {
      ...actual.socialModerationApi,
      createReport: (...a: unknown[]) => createReport(...a),
    },
  };
});

const POST_1 = "11111111-1111-4111-8111-111111111111";
const POST_2 = "22222222-2222-4222-8222-222222222222";
const COMMENT_OF_1 = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const COMMENT_OF_2 = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const MY_COMMENT_OF_2 = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const LATE_COMMENT_OF_2 = "d4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4";
const BODY_OF_1 = "bình luận của bài thứ nhất";
const BODY_OF_2 = "bình luận của bài thứ hai";
const MY_BODY_OF_2 = "bình luận của tôi ở bài thứ hai";
const LATE_BODY_OF_2 = "bình luận vừa tới của bài thứ hai";

const REPORT = "Báo cáo";
const REPORT_DIALOG = "Báo cáo bình luận";
const NOTE = "Ghi chú thêm (không bắt buộc)";
const SUBMIT = "Gửi báo cáo";
const SPAM = "Spam hoặc quảng cáo";
const DELETE = "Xoá";
const CONFIRM_DELETE = "Xoá bình luận này?";
const DRAFT = "nháp viết cho bình luận của bài thứ hai";

/** Bình luận server trả cho từng bài — ca «đọc lại» thay mảng của bài thứ hai. */
let commentsByPost: Record<string, FeedCommentDto[]> = {};

/** Số lượt MOUNT của component route. 1 = router giữ nguyên trang khi `$postId` đổi. */
let pageMounts = 0;
function CountingPage(): React.ReactElement {
  React.useEffect(() => {
    pageMounts += 1;
  }, []);
  return <PostDetailPage />;
}

function mountAt(postId: string) {
  const rootRoute = createRootRoute();
  const postRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed/posts/$postId",
    component: CountingPage,
    errorComponent: ({ error }) => <p data-testid="route-error">{error.message}</p>,
  });
  const feedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feed",
    component: () => <p>bảng tin</p>,
  });
  const history = createMemoryHistory({ initialEntries: [`/feed/posts/${postId}`] });
  const router = createRouter({
    routeTree: rootRoute.addChildren([postRoute, feedRoute]),
    history,
  });
  const { client } = renderWithProviders(<RouterProvider router={router} />);
  return { history, client };
}

function rowButton(body: string, name: string): HTMLElement {
  const row = screen.getByText(body).closest("li");
  if (!row) throw new Error(`không tìm thấy hàng của bình luận «${body}»`);
  return within(row).getByRole("button", { name });
}
const noteBox = (): HTMLTextAreaElement => screen.getByRole("textbox", { name: NOTE });

/** Mở bài thứ nhất (vào cache), sang bài thứ hai bằng một lượt điều hướng — như bấm một tin ở rail. */
async function openFirstThenSecond() {
  const mounted = mountAt(POST_1);
  await screen.findByText(BODY_OF_1);
  act(() => mounted.history.push(`/feed/posts/${POST_2}`));
  await screen.findByText(BODY_OF_2);
  return mounted;
}

/** Back của trình duyệt về bài thứ nhất — bài còn trong cache nên trang vẽ ngay, không qua khung chờ. */
async function backToFirst(history: ReturnType<typeof createMemoryHistory>): Promise<void> {
  act(() => history.back());
  await screen.findByText(BODY_OF_1);
  expect(screen.queryByText(BODY_OF_2)).toBeNull();
}

beforeEach(() => {
  setCaps({ "view:feed": true });
  pageMounts = 0;
  commentsByPost = {
    [POST_1]: [makeComment({ id: COMMENT_OF_1, postId: POST_1, body: BODY_OF_1 })],
    [POST_2]: [
      makeComment({ id: COMMENT_OF_2, postId: POST_2, body: BODY_OF_2 }),
      makeComment({ id: MY_COMMENT_OF_2, postId: POST_2, body: MY_BODY_OF_2, isMine: true }),
    ],
  };
  getPost.mockReset().mockImplementation((id: string) => Promise.resolve(makePost({ id })));
  listComments
    .mockReset()
    .mockImplementation((postId: string) => Promise.resolve(page(commentsByPost[postId] ?? [])));
  deleteComment.mockReset().mockResolvedValue({ id: MY_COMMENT_OF_2, deleted: true });
  createReport.mockReset().mockResolvedValue({ id: "66666666-6666-4666-8666-666666666666" });
  // jsdom không cài `window.scrollTo`; router gọi nó sau mỗi lượt điều hướng và jsdom in lỗi ra stderr.
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.mocked(window.scrollTo).mockRestore();
});

describe("đổi `$postId` (router THẬT, trang KHÔNG mount lại) — hộp thoại của bình luận bài cũ không sống sang bài mới", () => {
  it("đang mở «Báo cáo» cho một bình luận của bài thứ hai, Back về bài thứ nhất ⇒ hộp thoại ĐÓNG, 0 lời gọi 027; mở lại trên bài thứ nhất ⇒ nháp TRẮNG, đích là bình luận của bài thứ nhất", async () => {
    const { history } = await openFirstThenSecond();
    fireEvent.click(rowButton(BODY_OF_2, REPORT));
    fireEvent.change(noteBox(), { target: { value: DRAFT } });
    expect(screen.getByRole("dialog", { name: REPORT_DIALOG })).toBeInTheDocument();

    await backToFirst(history);
    // Đối chứng: vẫn là MỘT lượt mount của trang — hộp thoại không biến mất vì cả trang bị dựng lại.
    expect(pageMounts).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createReport).not.toHaveBeenCalled();

    fireEvent.click(rowButton(BODY_OF_1, REPORT));
    expect(noteBox()).toHaveValue("");
    fireEvent.click(screen.getByRole("radio", { name: SPAM }));
    fireEvent.click(screen.getByRole("button", { name: SUBMIT }));
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));
    expect(createReport.mock.calls[0]?.[0]).toEqual({
      targetType: "comment",
      targetId: COMMENT_OF_1,
      reason: "spam",
    });
  });

  it("đang hỏi xoá một bình luận của bài thứ hai, Back về bài thứ nhất ⇒ hộp xác nhận ĐÓNG, 0 lời gọi 017", async () => {
    const { history } = await openFirstThenSecond();
    fireEvent.click(rowButton(MY_BODY_OF_2, DELETE));
    expect(screen.getByRole("dialog", { name: CONFIRM_DELETE })).toBeInTheDocument();

    await backToFirst(history);
    expect(pageMounts).toBe(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteComment).not.toHaveBeenCalled();
  });

  it("ALLOW (cùng khung): Ở NGUYÊN bài thứ hai, danh sách bình luận được đọc lại ⇒ hộp thoại «Báo cáo» + nháp CÒN", async () => {
    const { client } = await openFirstThenSecond();
    fireEvent.click(rowButton(BODY_OF_2, REPORT));
    fireEvent.change(noteBox(), { target: { value: DRAFT } });

    // Lượt đọc lại trả object MỚI cho hàng đang báo cáo và THÊM một hàng (số hàng đổi 2 → 3).
    commentsByPost[POST_2] = [
      makeComment({ id: COMMENT_OF_2, postId: POST_2, body: BODY_OF_2, likeCount: 3 }),
      makeComment({ id: MY_COMMENT_OF_2, postId: POST_2, body: MY_BODY_OF_2, isMine: true }),
      makeComment({ id: LATE_COMMENT_OF_2, postId: POST_2, body: LATE_BODY_OF_2 }),
    ];
    await act(() => client.invalidateQueries({ queryKey: socialKeys.posts.comments(POST_2) }));
    await screen.findByText(LATE_BODY_OF_2);

    expect(pageMounts).toBe(1);
    expect(screen.getByRole("dialog", { name: REPORT_DIALOG })).toBeInTheDocument();
    expect(noteBox()).toHaveValue(DRAFT);
    expect(createReport).not.toHaveBeenCalled();
  });
});
