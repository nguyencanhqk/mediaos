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
 *
 * S16-SOCIAL-FE-2D (plan §13.3 V1) — cùng lớp, state của Ô SOẠN bình luận: khay tệp đã tải + nháp đang gõ thuộc về
 * MỘT bài. `PostDetailPage` đặt `key` theo bài cho `<CommentComposer>` — `composer:${postId}`, CÓ tiền tố vì
 * `<CommentList>` anh em đã mang `key={postId}` — nên đổi bài là ô soạn về trắng. Hai khối cuối file bật thêm quyền
 * `create:feed-comment` (ô soạn chỉ vẽ khi có quyền) và thay thêm hai lời gọi: vòng tải tệp (`uploadSocialAttachment`)
 * + `015`. Tệp dùng `application/pdf`: jsdom không có `URL.createObjectURL` cho ảnh.
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
import { onlineManager } from "@tanstack/react-query";
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
const createComment = vi.fn();
/** Thế chỗ TRỌN vòng tải một tệp đính kèm (054 → ghi bytes → 055). */
const upload = vi.fn();
/** Thế chỗ `fetch` trong MỌI ca: luôn từ chối, và `afterEach` đòi 0 lời gọi — xem 🔴 ở `beforeEach`. */
const fetchMock = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    uploadSocialAttachment: (...a: unknown[]) => upload(...a),
    socialApi: {
      ...actual.socialApi,
      getPost: (...a: unknown[]) => getPost(...a),
      listComments: (...a: unknown[]) => listComments(...a),
      createComment: (...a: unknown[]) => createComment(...a),
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

const SENT_COMMENT = "e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5";
const UPLOADED_FILE = "f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6";
const COMMENT_BOX = "Viết bình luận…";
const COMMENT_DRAFT = "bình luận đang gõ dở ở bài thứ hai";
const COMMENT_FOR_1 = "bình luận gửi ở bài thứ nhất";

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

const commentBox = (): HTMLTextAreaElement => screen.getByRole("textbox", { name: COMMENT_BOX });
const trayItems = (): HTMLElement[] => screen.queryAllByTestId("comment-attach-item");
const pdf = (): File => new File(["abc"], "bien-ban.pdf", { type: "application/pdf" });

/** Gõ nháp + chọn một tệp vào ô soạn bình luận đang hiện, rồi chờ tệp TẢI XONG (`fileId` đã nằm trong khay). */
async function draftCommentWithUploadedFile(): Promise<void> {
  fireEvent.change(commentBox(), { target: { value: COMMENT_DRAFT } });
  fireEvent.change(screen.getByTestId("comment-attach-input"), { target: { files: [pdf()] } });
  await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));
}

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
  createComment.mockReset().mockImplementation((postId: string, dto: { body: string }) =>
    Promise.resolve({
      ...makeComment({ id: SENT_COMMENT, postId, body: dto.body, isMine: true }),
      droppedMentions: [],
    }),
  );
  upload.mockReset().mockImplementation((file: File) =>
    Promise.resolve({
      fileId: UPLOADED_FILE,
      kind: "file",
      name: file.name,
      sizeBytes: file.size,
      mimeType: file.type,
    }),
  );
  // jsdom không cài `window.scrollTo`; router gọi nó sau mỗi lượt điều hướng và jsdom in lỗi ra stderr.
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  // 🔴 Lưới chặn mạng (gate bảo mật của PR-C, SEC-02 — khuôn của `SocialPortalShell.spec.tsx`). File này dựng
  // `PostDetailPage` THẬT và chỉ thay bốn lời gọi API: trang hay một component con thêm một lời gọi lúc mount (đếm lượt
  // xem…) mà ở đây chưa mock thì `apiFetch` THẬT đi tới địa chỉ API mặc định (`localhost:3100`) — trên máy có API đang
  // chạy đó là một request thật, còn ca vẫn xanh. `fetch` vì vậy luôn từ chối, và `afterEach` đòi 0 lời gọi.
  fetchMock.mockReset().mockRejectedValue(new TypeError("mạng bị chặn trong test"));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  // Đếm TRƯỚC khi dọn; so SAU khi dọn để ca đỏ không để lại cây đang mount hay `fetch` giả cho ca kế tiếp.
  const requestsLeavingTheTest = fetchMock.mock.calls.map((call) => String(call[0]));
  cleanup();
  resetCaps();
  vi.mocked(window.scrollTo).mockRestore();
  vi.unstubAllGlobals();
  expect(requestsLeavingTheTest).toEqual([]);
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

describe("đổi `$postId` (router THẬT, trang KHÔNG mount lại) — khay tệp + nháp của ô bình luận ở lại với bài của chúng", () => {
  beforeEach(() => {
    setCaps({ "view:feed": true, "create:feed-comment": true });
  });

  it("DENY: ở bài thứ hai đã gõ nháp + tải XONG một tệp, Back về bài thứ nhất ⇒ khay RỖNG, ô soạn TRẮNG; bình luận gửi ở bài thứ nhất KHÔNG mang `attachmentIds`", async () => {
    const { history } = await openFirstThenSecond();
    await draftCommentWithUploadedFile();

    await backToFirst(history);
    // Đối chứng: vẫn là MỘT lượt mount của trang — ô soạn không trắng vì cả trang bị dựng lại.
    expect(pageMounts).toBe(1);
    expect(trayItems()).toHaveLength(0);
    expect(commentBox()).toHaveValue("");

    fireEvent.change(commentBox(), { target: { value: COMMENT_FOR_1 } });
    fireEvent.click(screen.getByTestId("comment-submit"));
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    const [sentTo, sent] = createComment.mock.calls[0] as [string, Record<string, unknown>];
    expect(sentTo).toBe(POST_1);
    expect(sent).toEqual({ body: COMMENT_FOR_1, parentCommentId: null });
    expect(sent).not.toHaveProperty("attachmentIds");
    // Chờ lượt gửi khép lại (ô soạn tự dọn) để ca không kết thúc giữa một lượt cập nhật state.
    await waitFor(() => expect(commentBox()).toHaveValue(""));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("ALLOW (cùng khung): Ở NGUYÊN bài thứ hai, danh sách bình luận được đọc lại ⇒ khay + nháp CÒN; gửi ⇒ `015` của bài đó mang đúng tệp đã tải", async () => {
    const { client } = await openFirstThenSecond();
    await draftCommentWithUploadedFile();

    // Lượt đọc lại THÊM một hàng (số hàng đổi 2 → 3) — cây bên dưới ô soạn vẽ lại, ô soạn giữ nguyên chỗ.
    commentsByPost[POST_2] = [
      makeComment({ id: COMMENT_OF_2, postId: POST_2, body: BODY_OF_2 }),
      makeComment({ id: MY_COMMENT_OF_2, postId: POST_2, body: MY_BODY_OF_2, isMine: true }),
      makeComment({ id: LATE_COMMENT_OF_2, postId: POST_2, body: LATE_BODY_OF_2 }),
    ];
    await act(() => client.invalidateQueries({ queryKey: socialKeys.posts.comments(POST_2) }));
    await screen.findByText(LATE_BODY_OF_2);

    expect(pageMounts).toBe(1);
    expect(trayItems()).toHaveLength(1);
    expect(trayItems()[0]?.getAttribute("data-status")).toBe("done");
    expect(commentBox()).toHaveValue(COMMENT_DRAFT);
    expect(upload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("comment-submit"));
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    expect(createComment.mock.calls[0]).toEqual([
      POST_2,
      { body: COMMENT_DRAFT, parentCommentId: null, attachmentIds: [UPLOADED_FILE] },
    ]);
    await waitFor(() => expect(trayItems()).toHaveLength(0));
  });
});

/**
 * Lượt GỬI bình luận mang ĐÍCH (bài) từ lúc bấm. Khi trình duyệt báo mất mạng, lượt gửi đứng chờ; người dùng sang
 * bài khác trong lúc đó (trang không mount lại) thì lượt gửi, khi chạy, vẫn tới bài nơi nó được bấm — cùng chữ và tệp
 * của bài đó — và gửi xong thì làm mới dữ liệu của chính bài ấy.
 */
describe("đổi `$postId` khi lượt GỬI bình luận còn đang chờ — lượt gửi mang đích từ lúc bấm", () => {
  beforeEach(() => {
    setCaps({ "view:feed": true, "create:feed-comment": true });
  });

  afterEach(() => {
    act(() => onlineManager.setOnline(true));
  });

  const targetsOf015 = (): unknown[] => createComment.mock.calls.map((call) => call[0]);

  it("DENY: mất mạng · ở bài thứ hai gõ chữ + tệp tải xong rồi bấm gửi · Back về bài thứ nhất · có mạng lại ⇒ MỌI lượt gọi `015` tới bài THỨ HAI", async () => {
    const { history, client } = await openFirstThenSecond();
    act(() => onlineManager.setOnline(false));
    await draftCommentWithUploadedFile();
    fireEvent.click(screen.getByTestId("comment-submit"));

    // Tiền đề của ca: lượt gửi ĐỨNG CHỜ (thư viện giữ nó ở trạng thái tạm dừng) — `015` chưa được gọi.
    await waitFor(() =>
      expect(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state.isPaused),
      ).toEqual([true]),
    );
    expect(createComment).not.toHaveBeenCalled();

    await backToFirst(history);
    expect(pageMounts).toBe(1);
    expect(createComment).not.toHaveBeenCalled();

    act(() => onlineManager.setOnline(true));
    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));

    expect(targetsOf015()).toEqual([POST_2]);
    expect(createComment.mock.calls[0]?.[1]).toEqual({
      body: COMMENT_DRAFT,
      parentCommentId: null,
      attachmentIds: [UPLOADED_FILE],
    });
    // Gửi xong ⇒ hai nhánh query của bài THỨ HAI (bài nhận bình luận) được đánh dấu cần đọc lại, dù trang đang mở
    // bài thứ nhất.
    await waitFor(() => expect(client.isMutating()).toBe(0));
    expect(client.getQueryState(socialKeys.posts.comments(POST_2))?.isInvalidated).toBe(true);
    expect(client.getQueryState(socialKeys.posts.detail(POST_2))?.isInvalidated).toBe(true);
  });

  it("ALLOW (đối chứng có mạng): ở bài thứ hai gõ chữ + tệp tải xong rồi bấm gửi ⇒ `015` đi NGAY, đích là bài thứ hai", async () => {
    await openFirstThenSecond();
    await draftCommentWithUploadedFile();
    fireEvent.click(screen.getByTestId("comment-submit"));

    await waitFor(() => expect(createComment).toHaveBeenCalledTimes(1));
    expect(targetsOf015()).toEqual([POST_2]);
    await waitFor(() => expect(trayItems()).toHaveLength(0));
  });
});
