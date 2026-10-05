/**
 * S16-SOCIAL-FE-3 (L2) — màn Kiểm duyệt `SOC-SCREEN-010`, tab «Báo cáo»: NHÓM CA GHI — việc TRANG làm với
 * kết cục của 029 (hộp thoại THẬT, chỉ mock lời gọi): invalidate (R3 · E1 · E6) · dải ở trang (E1 · E6 ·
 * E9) · lỗi «giữ hộp thoại» không chạm trang (E2–E5 · E10 · E11) · bấm đúp (DC1). Nhóm ca ĐỌC ở
 * `ModerationPage.spec.tsx`.
 *
 * Đo invalidate (plan B24): seed khoá CỤ THỂ KHÔNG có observer rồi đọc `isInvalidated` — query đang có
 * observer refetch xong là cờ về `false` (đua), còn `getQueryState(<tiền tố>)` luôn `undefined`. Mỗi ca có
 * khoá ĐỐI CHỨNG phải còn `false`, và spy `listReports` của danh sách đang mở phải được gọi lại.
 *
 * «0 lời gọi lại» (E9 · lỗi giữ hộp thoại) đứng cạnh ca ALLOW cùng khung (E1) — nơi cùng spy đó lên 2.
 */
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { socialKeys } from "@mediaos/web-core";
import { resolveFeedReportSchema, type FeedReportDto } from "@mediaos/contracts";
import {
  makeTestQueryClient,
  renderWithProviders,
  resetCaps,
  setCaps,
} from "../feed/social-test-doubles";
import {
  ADMIN_ERR,
  AUTHOR_EMPLOYEE_ID,
  makeReport,
  makeReportPage,
  REPORTED_POST_ID,
  REPORT_ID,
  routeSearchDouble,
} from "../admin/admin-test-doubles";
import { ModerationPage } from "./ModerationPage";

const listReports = vi.fn();
const resolveReport = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      listReports: (...a: unknown[]) => listReports(...a),
      resolveReport: (...a: unknown[]) => resolveReport(...a),
    },
  };
});

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  const doubles = await import("../admin/admin-test-doubles");
  return {
    ...actual,
    Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
    useNavigate: () => (options: { search?: unknown }) => {
      doubles.routeSearchDouble.navigate(options);
    },
    useSearch: () => doubles.useRouteSearchDouble(),
  };
});

const FULL_MODERATOR = {
  "view:feed": true,
  "view:feed-report": true,
  "manage:feed-report": true,
  "manage:feed-post": true,
};

const COMMENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const LIST = "Danh sách báo cáo vi phạm";
const FILTER_LABEL = "Trạng thái báo cáo";
const RESOLVE = "Xử lý";
const DIALOG = "Xử lý báo cáo";
const RESOLVED = "Giải quyết";
const DISMISSED = "Bỏ qua";
const SUBMIT = "Xác nhận";
const RETRY = "Thử lại";
const DISMISS_NOTICE = "Đóng thông báo";
const EMPTY_OPEN = "Không có báo cáo nào đang chờ xử lý.";
const DONE_RESOLVED = "Đã giải quyết báo cáo.";
const DONE_DISMISSED = "Đã bỏ qua báo cáo.";
const ALREADY_DECIDED_TEXT =
  "Báo cáo này đã được xử lý trước khi yêu cầu của bạn hoàn tất. Danh sách đã được làm mới.";
const FORBIDDEN_TEXT =
  "Bạn không có quyền thực hiện thao tác này. Nếu cần, hãy liên hệ quản trị viên để được cấp quyền.";

// Khoá ĐÃ SEED, không observer (plan B24).
const KEY = {
  otherReportPage: socialKeys.moderation.reports.list({ status: "resolved", page: 9 }),
  hiddenPosts: socialKeys.moderation.hiddenPosts(),
  feedList: socialKeys.feed.list({ sort: "latest" }),
  postDetail: socialKeys.posts.detail(REPORTED_POST_ID),
  postComments: socialKeys.posts.comments(REPORTED_POST_ID),
  commentAsPostDetail: socialKeys.posts.detail(COMMENT_ID),
  // Mọi bề mặt KHÁC đang vẽ bài: rail của khung portal luôn mount tin nổi bật · bình chọn · vinh danh
  // ngay cạnh hàng đợi, và observer đang mount không tự đọc lại (`refetchOnWindowFocus` tắt).
  newsHighlight: socialKeys.news.list({ highlight: true }),
  pollsList: socialKeys.polls.list({ page: 1 }),
  ideasList: socialKeys.ideas.list({ page: 1 }),
  kudosList: socialKeys.kudos.list({ month: "2026-10" }),
  saved: socialKeys.saved(),
  profilePosts: socialKeys.profilePosts(AUTHOR_EMPLOYEE_ID, { sort: "latest" }),
  search: socialKeys.search({ q: "tin" }),
  // Đối chứng: không phải danh sách bài.
  kudosBadges: socialKeys.kudos.badges(),
  birthdays: socialKeys.birthdays({ range: "week" }),
};
type SeededKey = keyof typeof KEY;

const OTHER_POST_SURFACES: readonly SeededKey[] = [
  "newsHighlight",
  "pollsList",
  "ideasList",
  "kudosList",
  "saved",
  "profilePosts",
  "search",
];

/** Một nhịp macrotask: mọi `mutationFn` đã xếp hàng đều đã chạy — dùng trước khi đếm «đúng 1 lời gọi». */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

function seededClient(): QueryClient {
  const client = makeTestQueryClient();
  Object.values(KEY).forEach((key) => client.setQueryData(key, { seeded: true }));
  return client;
}

async function renderPage(report: FeedReportDto = makeReport()) {
  listReports.mockImplementation(() => Promise.resolve(makeReportPage([report])));
  const client = seededClient();
  renderWithProviders(<ModerationPage />, client);
  await screen.findByRole("list", { name: LIST });
  const invalidated = (key: SeededKey): boolean | undefined =>
    client.getQueryState(KEY[key])?.isInvalidated;
  return { client, invalidated };
}

const openDialog = (): void => {
  fireEvent.click(screen.getByRole("button", { name: RESOLVE }));
};
const pick = (name: string): void => {
  fireEvent.click(screen.getByRole("radio", { name }));
};
const clickSubmit = (): void => {
  fireEvent.click(screen.getByRole("button", { name: SUBMIT }));
};
const dialogGone = (): Promise<void> =>
  waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
const sentBody = (): unknown => resolveReport.mock.calls[0]?.[1];

/** Mở hộp thoại → «Bỏ qua» → «Xác nhận». */
function dismissReport(): void {
  openDialog();
  pick(DISMISSED);
  clickSubmit();
}

beforeEach(() => {
  setCaps(FULL_MODERATOR);
  listReports.mockReset();
  resolveReport.mockReset();
  resolveReport.mockImplementation(() =>
    Promise.resolve(makeReport({ status: "dismissed", resolvedAt: "2026-10-05T01:00:00.000Z" })),
  );
});
afterEach(() => {
  cleanup();
  resetCaps();
  routeSearchDouble.reset();
});

describe("Thành công — trang invalidate đúng phạm vi", () => {
  it("«Bỏ qua» (không hành động kèm): hộp thoại đóng, MỌI trang báo cáo bị làm mới, danh sách đang mở gọi lại; feed/bài ẩn KHÔNG bị đụng", async () => {
    const { invalidated } = await renderPage();

    dismissReport();

    await dialogGone();
    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(resolveReport.mock.calls[0]?.[0]).toBe(REPORT_ID);
    expect(sentBody()).toEqual({ status: "dismissed" });
    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
    expect(invalidated("otherReportPage")).toBe(true);
    expect(invalidated("hiddenPosts")).toBe(false);
    expect(invalidated("feedList")).toBe(false);
    expect(invalidated("postDetail")).toBe(false);
    expect(invalidated("postComments")).toBe(false);
    expect(invalidated("birthdays")).toBe(false);
    // Không bài nào đổi ⇒ không bề mặt bài nào bị làm mới (vế DENY của ca «mọi bề mặt» bên dưới).
    expect(OTHER_POST_SURFACES.map((key) => [key, invalidated(key)])).toEqual(
      OTHER_POST_SURFACES.map((key) => [key, false]),
    );
    expect(screen.getByRole("status")).toHaveTextContent(DONE_DISMISSED);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["Ẩn bài", "Xoá bài"])(
    "hành động kèm «%s» ⇒ MỌI bề mặt đang vẽ bài đều `isInvalidated` (tin · bình chọn · sáng kiến · vinh danh · đã lưu · trang cá nhân · tìm kiếm); catalog huy hiệu + sinh nhật thì KHÔNG",
    async (actionLabel) => {
      resolveReport.mockImplementation(() => Promise.resolve(makeReport({ status: "resolved" })));
      const { invalidated } = await renderPage();

      openDialog();
      pick(RESOLVED);
      pick(actionLabel);
      const confirm = screen.queryByRole("checkbox");
      if (confirm !== null) fireEvent.click(confirm);
      clickSubmit();

      await dialogGone();
      expect(invalidated("feedList")).toBe(true);
      expect(OTHER_POST_SURFACES.map((key) => [key, invalidated(key)])).toEqual(
        OTHER_POST_SURFACES.map((key) => [key, true]),
      );
      expect(invalidated("kudosBadges")).toBe(false);
      expect(invalidated("birthdays")).toBe(false);
    },
  );

  it("R3 — sau `delete_target` (bài): báo cáo · bài đang ẩn · feed · chi tiết bài đều `isInvalidated`; sinh nhật thì KHÔNG", async () => {
    resolveReport.mockImplementation(() => Promise.resolve(makeReport({ status: "resolved" })));
    const { invalidated } = await renderPage();

    openDialog();
    pick(RESOLVED);
    pick("Xoá bài");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Tôi hiểu bài sẽ bị xoá; hiện chưa có màn khôi phục" }),
    );
    clickSubmit();

    await dialogGone();
    expect(sentBody()).toEqual({ status: "resolved", action: "delete_target" });
    expect(resolveFeedReportSchema.safeParse(sentBody()).success).toBe(true);
    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
    expect(invalidated("otherReportPage")).toBe(true);
    expect(invalidated("hiddenPosts")).toBe(true);
    expect(invalidated("feedList")).toBe(true);
    expect(invalidated("postDetail")).toBe(true);
    expect(invalidated("postComments")).toBe(true);
    expect(invalidated("birthdays")).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(DONE_RESOLVED);
  });

  it.each(["Ẩn bài", "Khoá bình luận của bài"])(
    "hành động kèm «%s» ⇒ cũng làm mới bài đang ẩn + feed + chi tiết bài",
    async (actionLabel) => {
      resolveReport.mockImplementation(() => Promise.resolve(makeReport({ status: "resolved" })));
      const { invalidated } = await renderPage();

      openDialog();
      pick(RESOLVED);
      pick(actionLabel);
      clickSubmit();

      await dialogGone();
      expect(invalidated("otherReportPage")).toBe(true);
      expect(invalidated("hiddenPosts")).toBe(true);
      expect(invalidated("feedList")).toBe(true);
      expect(invalidated("postDetail")).toBe(true);
      expect(invalidated("birthdays")).toBe(false);
    },
  );

  it("R3 — báo cáo BÌNH LUẬN: làm mới chi tiết + bình luận của BÀI CHA (`snapshot.postId`), không coi `targetId` là id bài", async () => {
    resolveReport.mockImplementation(() => Promise.resolve(makeReport({ status: "resolved" })));
    const { invalidated } = await renderPage(
      makeReport({ targetType: "comment", targetId: COMMENT_ID }),
    );

    openDialog();
    pick(RESOLVED);
    pick("Xoá bình luận này");
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Tôi hiểu bình luận sẽ bị xoá; hiện chưa có màn khôi phục",
      }),
    );
    clickSubmit();

    await dialogGone();
    expect(sentBody()).toEqual({ status: "resolved", action: "delete_target" });
    expect(invalidated("postDetail")).toBe(true);
    expect(invalidated("postComments")).toBe(true);
    expect(invalidated("commentAsPostDetail")).toBe(false);
    expect(invalidated("birthdays")).toBe(false);
  });
});

describe("Kết cục LỖI — hộp thoại đóng, dải ở TRANG", () => {
  // E1 (`021`) KHÁC E6 ở các bề mặt BÀI: báo cáo đã có người kết thúc — người khác, hoặc CHÍNH lượt trước của
  // mình đã ghi mà mất phản hồi (hạn chờ) rồi bấm «Thử lại» — có thể kèm ẩn / xoá bài ⇒ rail và mọi danh
  // sách bài cũng đã cũ. E6 (báo cáo không còn / ra khỏi phạm vi) không nói gì về bài.
  it.each([
    ["E1 `SOCIAL-ERR-021`", ADMIN_ERR.reportAlreadyDecided, "reportAlreadyDecided", true],
    ["E6 `SOCIAL-ERR-001`", ADMIN_ERR.reportGone, "reportGone", false],
  ])(
    "%s: đóng hộp thoại · dải ở trang KHÔNG «Thử lại» · làm mới mọi trang báo cáo · danh sách đang mở gọi lại",
    async (_label, makeError, reason, postsRefreshed) => {
      const error = makeError();
      resolveReport.mockImplementation(() => Promise.reject(error));
      const { invalidated } = await renderPage();

      dismissReport();

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveAttribute("data-reason", reason);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
      expect(document.body).not.toHaveTextContent(error.message);
      await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
      expect(invalidated("otherReportPage")).toBe(true);
      expect(invalidated("hiddenPosts")).toBe(postsRefreshed);
      expect(invalidated("feedList")).toBe(postsRefreshed);
      expect(invalidated("postDetail")).toBe(postsRefreshed);
      expect(invalidated("postComments")).toBe(postsRefreshed);
      expect(OTHER_POST_SURFACES.map((key) => [key, invalidated(key)])).toEqual(
        OTHER_POST_SURFACES.map((key) => [key, postsRefreshed]),
      );
      // Đối chứng: không quét sạch cache.
      expect(invalidated("kudosBadges")).toBe(false);
      expect(invalidated("birthdays")).toBe(false);
      expect(screen.queryByRole("status")).toBeNull();
    },
  );

  it("E9 403 `AUTH-ERR-FORBIDDEN`: đóng hộp thoại · dải `forbidden` ở trang bằng chữ của FE · KHÔNG «Thử lại» · KHÔNG làm mới gì", async () => {
    const error = ADMIN_ERR.forbidden();
    resolveReport.mockImplementation(() => Promise.reject(error));
    const { invalidated } = await renderPage();

    dismissReport();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "forbidden");
    expect(alert).toHaveTextContent(FORBIDDEN_TEXT);
    expect(document.body).not.toHaveTextContent(error.message);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
    expect(invalidated("otherReportPage")).toBe(false);
    expect(invalidated("hiddenPosts")).toBe(false);
    expect(listReports).toHaveBeenCalledTimes(1);
    // Hàng đợi đang thấy vẫn còn — 403 của lượt GHI không xoá cái đang đọc được.
    expect(screen.getAllByTestId("report-row")).toHaveLength(1);
  });

  it("dải kết cục: nút «Đóng thông báo» gỡ dải", async () => {
    resolveReport.mockImplementation(() => Promise.reject(ADMIN_ERR.forbidden()));
    await renderPage();
    dismissReport();

    const alert = await screen.findByRole("alert");
    fireEvent.click(within(alert).getByRole("button", { name: DISMISS_NOTICE }));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dải kết cục cũ KHÔNG sống sang lượt xử lý kế tiếp: mở hộp thoại khác ⇒ dải biến mất", async () => {
    resolveReport.mockImplementation(() => Promise.reject(ADMIN_ERR.forbidden()));
    await renderPage();
    dismissReport();
    await screen.findByRole("alert");

    openDialog();

    expect(screen.getByRole("dialog", { name: DIALOG })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("dải kết cục cũ KHÔNG sống qua lần đổi bộ lọc", async () => {
    resolveReport.mockImplementation(() => Promise.reject(ADMIN_ERR.forbidden()));
    await renderPage();
    dismissReport();
    await screen.findByRole("alert");

    fireEvent.change(screen.getByRole("combobox", { name: FILTER_LABEL }), {
      target: { value: "all" },
    });

    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("E1 mà lượt tải lại HỎNG: chỉ còn MỘT dải (lỗi tải + «Thử lại»), không giữ câu «danh sách đã được làm mới»; thử lại xong thì câu đó mới hiện", async () => {
    resolveReport.mockImplementation(() => Promise.reject(ADMIN_ERR.reportAlreadyDecided()));
    await renderPage();
    listReports.mockImplementationOnce(() => Promise.reject(ADMIN_ERR.server()));

    dismissReport();

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveAttribute("data-reason", "generic"),
    );
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText(ALREADY_DECIDED_TEXT)).toBeNull();
    expect(screen.queryAllByTestId("report-row")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: RETRY }));

    await screen.findByRole("list", { name: LIST });
    expect(listReports).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("alert")).toHaveTextContent(ALREADY_DECIDED_TEXT);
  });
});

// Đường CHÍNH ngoài thực tế với bộ lọc mặc định «Đang chờ xử lý»: xử lý xong ⇒ lượt đọc lại KHÔNG còn
// hàng đó. Dải kết cục là state của trang nên phải còn cạnh câu rỗng (plan B6) — các ca phía trên cho
// lượt đọc lại trả chính hàng cũ nên không đo được vế này.
describe("Dải kết cục CÒN khi hàng vừa xử lý biến mất khỏi hàng đợi (plan B6)", () => {
  it("thành công: lượt đọc lại trả trang RỖNG ⇒ câu rỗng của «Đang chờ xử lý» VÀ dải «Đã bỏ qua báo cáo.» cùng hiện", async () => {
    await renderPage();
    listReports.mockImplementation(() => Promise.resolve(makeReportPage([])));

    dismissReport();

    expect(await screen.findByText(EMPTY_OPEN)).toBeInTheDocument();
    expect(listReports).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByTestId("report-row")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent(DONE_DISMISSED);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("E1: lượt đọc lại trả trang RỖNG ⇒ dải `reportAlreadyDecided` còn cạnh câu rỗng", async () => {
    resolveReport.mockImplementation(() => Promise.reject(ADMIN_ERR.reportAlreadyDecided()));
    await renderPage();
    listReports.mockImplementation(() => Promise.resolve(makeReportPage([])));

    dismissReport();

    expect(await screen.findByText(EMPTY_OPEN)).toBeInTheDocument();
    expect(listReports).toHaveBeenCalledTimes(2);
    expect(screen.queryAllByTestId("report-row")).toHaveLength(0);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-reason", "reportAlreadyDecided");
    expect(alert).toHaveTextContent(ALREADY_DECIDED_TEXT);
    expect(screen.queryByRole("button", { name: RETRY })).toBeNull();
  });
});

describe("Lỗi GIỮ hộp thoại — trang không vẽ dải; chỉ E5 làm mới hàng đợi", () => {
  it.each([
    ["E2 `REPORT-BUSY`", ADMIN_ERR.reportBusy, "reportBusy"],
    ["E3 `REPORT-ACTION-DENIED`", ADMIN_ERR.reportActionDenied, "reportActionDenied"],
    ["E4 `REPORT-ACTION-INVALID-FOR-TARGET`", ADMIN_ERR.reportActionInvalid, "reportActionInvalid"],
    ["E10 400", ADMIN_ERR.badRequest, "invalidRequest"],
    ["E11 500", ADMIN_ERR.server, "generic"],
  ])(
    "%s: hộp thoại CÒN, dải duy nhất nằm TRONG hộp thoại, `listReports` không gọi lại",
    async (_label, makeError, reason) => {
      resolveReport.mockImplementation(() => Promise.reject(makeError()));
      const { invalidated } = await renderPage();

      dismissReport();

      const dialog = screen.getByRole("dialog", { name: DIALOG });
      await waitFor(() =>
        expect(within(dialog).getByRole("alert")).toHaveAttribute("data-reason", reason),
      );
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByRole("dialog", { name: DIALOG })).toBeInTheDocument();
      expect(invalidated("otherReportPage")).toBe(false);
      expect(listReports).toHaveBeenCalledTimes(1);
    },
  );

  // E5 tự chứng minh hàng đang thấy đã cũ: đích không còn thao tác được, mà hàng vẫn vẽ nó như còn sống và
  // «Xem trong ngữ cảnh» dẫn tới 404. Hàng đợi được đọc lại NGAY (kể cả khi người dùng bấm «Huỷ» sau đó);
  // hộp thoại giữ bản báo cáo riêng nên nháp không mất.
  it("E5 `REPORT-ACTION-TARGET-UNAVAILABLE`: hộp thoại CÒN + nháp còn, hàng đợi ĐƯỢC đọc lại; bề mặt bài không bị đụng", async () => {
    resolveReport.mockImplementation(() => Promise.reject(ADMIN_ERR.reportTargetUnavailable()));
    const { invalidated } = await renderPage();

    openDialog();
    pick(RESOLVED);
    pick("Ẩn bài");
    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú xử lý (không bắt buộc)" }), {
      target: { value: "đã kiểm tra" },
    });
    clickSubmit();

    const dialog = screen.getByRole("dialog", { name: DIALOG });
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveAttribute(
        "data-reason",
        "reportTargetUnavailable",
      ),
    );
    await waitFor(() => expect(listReports).toHaveBeenCalledTimes(2));
    expect(invalidated("otherReportPage")).toBe(true);
    expect(invalidated("feedList")).toBe(false);
    expect(invalidated("hiddenPosts")).toBe(false);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: DIALOG })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Ghi chú xử lý (không bắt buộc)" })).toHaveValue(
      "đã kiểm tra",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("DC1 — bấm đúp 029 từ màn", () => {
  it("promise treo: bấm «Xác nhận» 2 lần LIỀN NHAU (màn chưa kịp vẽ lại) rồi 1 lần sau khi nút khoá ⇒ `resolveReport` 1 lần, nút khoá, hộp thoại còn", async () => {
    resolveReport.mockImplementation(() => new Promise(() => undefined));
    await renderPage();

    openDialog();
    pick(DISMISSED);
    // Hai kích hoạt TRƯỚC khi `isPending` tới màn (react-query báo sau một nhịp): nút chưa `disabled`, chỉ
    // cờ đồng bộ trong handler chặn được lượt hai. Lọt ⇒ lượt hai nhận 409 `021` cho chính mình (plan B23).
    clickSubmit();
    clickSubmit();
    await waitFor(() => expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled());
    clickSubmit();
    await settle();

    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: DIALOG })).toBeInTheDocument();
    expect(listReports).toHaveBeenCalledTimes(1);
  });
});

/**
 * Focus nằm ở (vỏ của) `element`. Vế «không phải body» là BẮT BUỘC: `body` chứa mọi phần tử, nên
 * `toContainElement` một mình vẫn xanh khi focus đã rơi về đầu trang.
 */
const expectFocusAround = (element: HTMLElement): void => {
  expect(document.activeElement).not.toBe(document.body);
  expect(document.activeElement).toContainElement(element);
};

// Hộp thoại đóng ⇒ `Dialog` trả focus về nút «Xử lý» của hàng vừa xử lý; refetch gỡ hàng đó (hoặc gỡ
// nút) ⇒ focus rơi về `body`: người dùng bàn phím / trình đọc màn hình mất chỗ sau MỖI báo cáo (gate TS,
// TS-02). Sau kết cục, focus phải nằm ở dải kết cục — thứ còn lại trên màn sau khi làm mới.
describe("Focus sau kết cục của 029 — không rơi về đầu trang", () => {
  /** Như người dùng bàn phím: nút «Xử lý» ĐANG giữ focus lúc mở hộp thoại. */
  const openDialogByKeyboard = (): void => {
    const button = screen.getByRole("button", { name: RESOLVE });
    button.focus();
    fireEvent.click(button);
  };

  it("thành công: focus nằm ở dải kết cục, và CÒN ở đó sau khi hàng vừa xử lý rời danh sách", async () => {
    await renderPage();
    listReports.mockImplementation(() => Promise.resolve(makeReportPage([])));

    openDialogByKeyboard();
    pick(DISMISSED);
    clickSubmit();
    await dialogGone();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(DONE_DISMISSED);
    expectFocusAround(status);

    expect(await screen.findByText(EMPTY_OPEN)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: RESOLVE })).toBeNull();
    expectFocusAround(screen.getByRole("status"));
  });

  it("E1 (kết cục lỗi, hộp thoại đóng): focus nằm ở dải lỗi của trang", async () => {
    resolveReport.mockRejectedValueOnce(ADMIN_ERR.reportAlreadyDecided());
    await renderPage();
    listReports.mockImplementation(() => Promise.resolve(makeReportPage([])));

    openDialogByKeyboard();
    pick(DISMISSED);
    clickSubmit();
    await dialogGone();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(ALREADY_DECIDED_TEXT);
    expectFocusAround(alert);

    expect(await screen.findByText(EMPTY_OPEN)).toBeInTheDocument();
    expectFocusAround(screen.getByRole("alert"));
  });

  it("đối chứng: người dùng TỰ đóng hộp thoại (Esc) ⇒ focus về lại nút «Xử lý», không bị kéo đi", async () => {
    await renderPage();

    openDialogByKeyboard();
    fireEvent.keyDown(document, { key: "Escape" });
    await dialogGone();

    expect(screen.getByRole("button", { name: RESOLVE })).toHaveFocus();
  });
});
