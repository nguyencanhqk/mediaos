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
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  "Báo cáo này đã được xử lý bởi người khác trước khi bạn xác nhận. Danh sách đã được làm mới.";
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
  birthdays: socialKeys.birthdays({ range: "week" }),
};
type SeededKey = keyof typeof KEY;

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
    expect(screen.getByRole("status")).toHaveTextContent(DONE_DISMISSED);
    expect(screen.queryByRole("alert")).toBeNull();
  });

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
  it.each([
    ["E1 `SOCIAL-ERR-021`", ADMIN_ERR.reportAlreadyDecided, "reportAlreadyDecided"],
    ["E6 `SOCIAL-ERR-001`", ADMIN_ERR.reportGone, "reportGone"],
  ])(
    "%s: đóng hộp thoại · dải ở trang KHÔNG «Thử lại» · làm mới mọi trang báo cáo · danh sách đang mở gọi lại",
    async (_label, makeError, reason) => {
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
      // Chưa có hành động nào được thực hiện ⇒ không có lý do làm mới feed / bài đang ẩn.
      expect(invalidated("hiddenPosts")).toBe(false);
      expect(invalidated("feedList")).toBe(false);
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

describe("Lỗi GIỮ hộp thoại — trang không vẽ dải, không làm mới", () => {
  it.each([
    ["E2 `REPORT-BUSY`", ADMIN_ERR.reportBusy, "reportBusy"],
    ["E3 `REPORT-ACTION-DENIED`", ADMIN_ERR.reportActionDenied, "reportActionDenied"],
    ["E4 `REPORT-ACTION-INVALID-FOR-TARGET`", ADMIN_ERR.reportActionInvalid, "reportActionInvalid"],
    [
      "E5 `REPORT-ACTION-TARGET-UNAVAILABLE`",
      ADMIN_ERR.reportTargetUnavailable,
      "reportTargetUnavailable",
    ],
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
});

describe("DC1 — bấm đúp 029 từ màn", () => {
  it("promise treo: bấm «Xác nhận» 2 lần ⇒ `resolveReport` 1 lần, nút khoá, hộp thoại còn", async () => {
    resolveReport.mockImplementation(() => new Promise(() => undefined));
    await renderPage();

    openDialog();
    pick(DISMISSED);
    clickSubmit();
    // Cùng khuôn ca DC1 của hộp thoại: `isPending` tới màn sau một nhịp thông báo của react-query — chờ nút
    // khoá rồi mới bấm lần hai (hai sự kiện click THẬT của một cú bấm đúp cách nhau hàng chục ms).
    await waitFor(() => expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled());
    clickSubmit();

    expect(resolveReport).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: SUBMIT })).toBeDisabled();
    expect(screen.getByRole("dialog", { name: DIALOG })).toBeInTheDocument();
    expect(listReports).toHaveBeenCalledTimes(1);
  });
});
