/**
 * S16-SOCIAL-FE-3 (L2) — thẻ báo cáo `ReportRow`: ca G2 · R1 · R2 · R4 · R5 của plan §4.
 *
 * - Quyền đặt trên store THẬT (`setCaps`) TRƯỚC render — đo luật `useCan` thật, không đo mock.
 * - i18n THẬT; vế kỳ vọng là chữ tiếng Việt VIẾT TAY ⇒ thiếu khoá (i18next trả khoá thô) là đỏ (plan B18).
 * - `Link` giả NỘI SUY `params` vào `href` (plan B8): mock bỏ `params` làm link sai id vẫn xanh.
 * - Fixture mặc định mang `avatarUrl` KHÁC rỗng (plan B7) — ca «không `<img>`» tự kiểm điều đó.
 * - Đồng hồ ghim ở 2026-10-03T02:03:04Z: `createdAt` của fixture = đúng 2 ngày trước.
 */
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { feedReportReasonSchema, type FeedReportDto } from "@mediaos/contracts";
import { renderWithProviders, resetCaps, setCaps } from "../../feed/social-test-doubles";
import { makeReport, REPORTED_POST_ID, REPORTER_EMPLOYEE_ID } from "../../admin/admin-test-doubles";
import { ReportRow } from "./ReportRow";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    Link: ({
      children,
      to,
      params,
    }: {
      children: ReactNode;
      to: string;
      params?: Record<string, string>;
    }) => {
      const href = Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      );
      return <a href={href}>{children}</a>;
    },
  };
});

const NOW = new Date("2026-10-03T02:03:04.000Z");
const RESOLVED_AT = "2026-10-02T23:03:04.000Z";
const COMMENT_ID = "99999999-9999-4999-8999-999999999999";
const RESOLVER_EMPLOYEE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

/** Vai manager theo seed: vào được màn (chỉ đọc), KHÔNG xử lý được. */
const MANAGER = { "view:feed": true, "view:feed-report": true };
const REPORT_MANAGER = { ...MANAGER, "manage:feed-report": true };
const POST_MANAGER = { ...MANAGER, "manage:feed-post": true };

const RESOLVE = "Xử lý";
const VIEW_IN_CONTEXT = "Xem trong ngữ cảnh";
const REPORTER_MASKED = "Ẩn theo phạm vi xem của bạn";
const PROFILE_GONE = "(hồ sơ không còn)";

type Snapshot = NonNullable<FeedReportDto["targetSnapshot"]>;
const snapshot = (over: Partial<Snapshot> = {}): Snapshot => ({
  ...(makeReport().targetSnapshot as Snapshot),
  ...over,
});

/** Báo cáo BÌNH LUẬN: `targetId` là bình luận, `targetSnapshot.postId` là BÀI CHA (plan M2b). */
const commentReport = (over: Partial<FeedReportDto> = {}): FeedReportDto =>
  makeReport({ targetType: "comment", targetId: COMMENT_ID, ...over });

const closedReport = (over: Partial<FeedReportDto> = {}): FeedReportDto =>
  makeReport({
    status: "resolved",
    resolvedBy: {
      employeeId: RESOLVER_EMPLOYEE_ID,
      fullName: "Phạm Thị Hoa",
      avatarUrl: "https://cdn.example.test/avatars/resolver.png",
    },
    resolvedAt: RESOLVED_AT,
    resolutionNote: null,
    ...over,
  });

function renderRow(report: FeedReportDto, onResolve = vi.fn()) {
  const view = renderWithProviders(<ReportRow report={report} onResolve={onResolve} />);
  return { ...view, onResolve, card: () => screen.getByTestId("report-row") };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  setCaps(MANAGER);
});
afterEach(() => {
  cleanup();
  resetCaps();
  vi.useRealTimers();
});

describe("G2 — nút «Xử lý» gác `manage:feed-report` + chỉ với báo cáo đang mở", () => {
  it("DENY: caps manager (`view:feed-report`) ⇒ thẻ hiện, KHÔNG có nút", () => {
    const { card } = renderRow(makeReport());
    expect(card()).toHaveTextContent("Nội dung bài viết bị báo cáo");
    expect(screen.queryByRole("button", { name: RESOLVE })).toBeNull();
  });

  it("ALLOW: thêm `manage:feed-report` ⇒ có nút; bấm gọi `onResolve` với CHÍNH báo cáo đó", () => {
    setCaps(REPORT_MANAGER);
    const report = makeReport();
    const { onResolve } = renderRow(report);
    fireEvent.click(screen.getByRole("button", { name: RESOLVE }));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith(report);
  });

  it("DENY: có `manage:feed-post` nhưng thiếu `manage:feed-report` ⇒ KHÔNG có nút", () => {
    setCaps(POST_MANAGER);
    const { card } = renderRow(makeReport());
    expect(card()).toHaveTextContent("Nội dung bài viết bị báo cáo");
    expect(screen.queryByRole("button", { name: RESOLVE })).toBeNull();
  });

  it.each(["resolved", "dismissed"] as const)(
    "báo cáo đã `%s` ⇒ KHÔNG có nút, kể cả với người có `manage:feed-report`",
    (status) => {
      setCaps(REPORT_MANAGER);
      const { card } = renderRow(closedReport({ status }));
      expect(card()).toHaveTextContent("Phạm Thị Hoa");
      expect(screen.queryByRole("button", { name: RESOLVE })).toBeNull();
    },
  );
});

describe("R1 — danh tính người báo cáo: BỊ CHE ≠ HỒ SƠ KHÔNG CÒN", () => {
  it("`reporter: null` ⇒ «Ẩn theo phạm vi xem của bạn», KHÔNG có «(hồ sơ không còn)»", () => {
    renderRow(makeReport({ reporter: null }));
    const reporter = screen.getByTestId("report-reporter");
    expect(reporter).toHaveTextContent(REPORTER_MASKED);
    expect(reporter).not.toHaveTextContent(PROFILE_GONE);
  });

  it("object có `employeeId: null` ⇒ tên + «(hồ sơ không còn)», KHÔNG có câu che theo phạm vi", () => {
    renderRow(
      makeReport({
        reporter: {
          employeeId: null,
          fullName: "Lê Văn Xuân",
          avatarUrl: "https://cdn.example.test/avatars/gone.png",
        },
      }),
    );
    const reporter = screen.getByTestId("report-reporter");
    expect(reporter).toHaveTextContent("Lê Văn Xuân");
    expect(reporter).toHaveTextContent(PROFILE_GONE);
    expect(reporter).not.toHaveTextContent(REPORTER_MASKED);
  });

  it("người báo cáo còn hồ sơ ⇒ chỉ có tên, KHÔNG nhãn nào trong hai nhãn", () => {
    const report = makeReport();
    expect(report.reporter?.employeeId).toBe(REPORTER_EMPLOYEE_ID);
    renderRow(report);
    const reporter = screen.getByTestId("report-reporter");
    expect(reporter).toHaveTextContent("Nguyễn Văn An");
    expect(reporter).not.toHaveTextContent(PROFILE_GONE);
    expect(reporter).not.toHaveTextContent(REPORTER_MASKED);
  });

  it("fixture mang `avatarUrl` KHÁC rỗng ở cả tác giả lẫn người báo cáo ⇒ thẻ vẫn KHÔNG có `<img>`", () => {
    const report = makeReport();
    expect(report.reporter?.avatarUrl).toMatch(/^https:\/\//);
    expect(report.targetSnapshot?.avatarUrl).toMatch(/^https:\/\//);
    const { card, container } = renderRow(report);
    expect(card()).toHaveTextContent("Nguyễn Văn An");
    expect(card()).toHaveTextContent("Trần Thị Bình");
    expect(container.querySelector("img")).toBeNull();
  });

  it("`note` là CHỮ THUẦN giữ xuống dòng: thẻ HTML trong ghi chú không thành phần tử", () => {
    const { container } = renderRow(makeReport({ note: "<b>dòng một</b>\ndòng hai" }));
    const note = screen.getByTestId("report-note");
    expect(note.textContent).toContain("<b>dòng một</b>\ndòng hai");
    expect(note.outerHTML).toContain("whitespace-pre-line");
    expect(container.querySelector("b")).toBeNull();
  });

  it("`note: null` ⇒ không vẽ khối ghi chú (thẻ vẫn hiện — đối chứng)", () => {
    const { card } = renderRow(makeReport({ note: null }));
    expect(card()).toHaveTextContent("Nguyễn Văn An");
    expect(screen.queryByTestId("report-note")).toBeNull();
  });
});

describe("R2 — «Xem trong ngữ cảnh» trỏ về BÀI (`targetSnapshot.postId`)", () => {
  it("nội dung còn ⇒ `href` = `/feed/posts/<postId>` — KHÔNG phải `targetId` của bình luận", () => {
    const report = commentReport();
    expect(report.targetId).not.toBe(report.targetSnapshot?.postId);
    renderRow(report);
    const link = screen.getByRole("link", { name: VIEW_IN_CONTEXT });
    expect(link.getAttribute("href")).toBe(`/feed/posts/${REPORTED_POST_ID}`);
    expect(screen.queryByTestId("report-target-state")).toBeNull();
  });

  it("`deletedAt ≠ null` ⇒ KHÔNG có link + nhãn «[đã xoá]»", () => {
    setCaps({ ...POST_MANAGER, "manage:feed-report": true });
    renderRow(
      makeReport({
        targetSnapshot: snapshot({ status: "deleted", deletedAt: "2026-10-02T00:00:00.000Z" }),
      }),
    );
    expect(screen.getByTestId("report-target-state").textContent).toBe("[đã xoá]");
    expect(screen.queryByRole("link", { name: VIEW_IN_CONTEXT })).toBeNull();
  });

  it("DENY: bài `hidden` + thiếu `manage:feed-post` ⇒ KHÔNG có link, có nhãn «[đã ẩn]»", () => {
    setCaps(REPORT_MANAGER);
    renderRow(makeReport({ targetSnapshot: snapshot({ status: "hidden" }) }));
    expect(screen.getByTestId("report-target-state").textContent).toBe("[đã ẩn]");
    expect(screen.queryByRole("link", { name: VIEW_IN_CONTEXT })).toBeNull();
  });

  it("ALLOW: bài `hidden` + có `manage:feed-post` ⇒ CÓ link, vẫn kèm nhãn «[đã ẩn]»", () => {
    setCaps(POST_MANAGER);
    renderRow(makeReport({ targetSnapshot: snapshot({ status: "hidden" }) }));
    const link = screen.getByRole("link", { name: VIEW_IN_CONTEXT });
    expect(link.getAttribute("href")).toBe(`/feed/posts/${REPORTED_POST_ID}`);
    expect(screen.getByTestId("report-target-state").textContent).toBe("[đã ẩn]");
  });

  // Hai vế của «đã xoá» đo RIÊNG: DB không có CHECK buộc `status = deleted` ⇔ `deleted_at` (hàng xoá mềm
  // bằng SQL tay có thật) ⇒ fixture mang cả hai cùng lúc không cho biết vế nào đang gác. Caps có
  // `manage:feed-post` để link chỉ có thể mất vì «đã xoá», không phải vì cổng bài ẩn.
  it.each([
    { name: "`deletedAt ≠ null` dù `status` còn `published`", status: "published" as const },
    { name: "`deletedAt ≠ null` dù `status` là `hidden`", status: "hidden" as const },
  ])("CHỈ vế thời điểm — $name ⇒ KHÔNG có link + «[đã xoá]»", ({ status }) => {
    setCaps({ ...POST_MANAGER, "manage:feed-report": true });
    renderRow(
      makeReport({ targetSnapshot: snapshot({ status, deletedAt: "2026-10-02T00:00:00.000Z" }) }),
    );
    expect(screen.getByTestId("report-target-state").textContent).toBe("[đã xoá]");
    expect(screen.queryByRole("link", { name: VIEW_IN_CONTEXT })).toBeNull();
    // Thẻ vẫn là thẻ đang mở, xử lý được — chỉ link ngữ cảnh mất.
    expect(screen.getByRole("button", { name: RESOLVE })).toBeInTheDocument();
  });

  it("CHỈ vế trạng thái — `status: deleted` + `deletedAt: null` ⇒ KHÔNG có link + «[đã xoá]»", () => {
    setCaps({ ...POST_MANAGER, "manage:feed-report": true });
    renderRow(makeReport({ targetSnapshot: snapshot({ status: "deleted", deletedAt: null }) }));
    expect(screen.getByTestId("report-target-state").textContent).toBe("[đã xoá]");
    expect(screen.queryByRole("link", { name: VIEW_IN_CONTEXT })).toBeNull();
    expect(screen.getByRole("button", { name: RESOLVE })).toBeInTheDocument();
  });

  it("đối chứng cùng caps — bài `published`, `deletedAt: null` ⇒ CÓ link, không nhãn trạng thái", () => {
    setCaps({ ...POST_MANAGER, "manage:feed-report": true });
    renderRow(makeReport({ targetSnapshot: snapshot({ status: "published", deletedAt: null }) }));
    expect(screen.getByRole("link", { name: VIEW_IN_CONTEXT }).getAttribute("href")).toBe(
      `/feed/posts/${REPORTED_POST_ID}`,
    );
    expect(screen.queryByTestId("report-target-state")).toBeNull();
  });

  it("`targetSnapshot: null` ⇒ «Nội dung không còn», KHÔNG có link", () => {
    setCaps(POST_MANAGER);
    const { card } = renderRow(makeReport({ targetSnapshot: null }));
    expect(card()).toHaveTextContent("Nội dung không còn");
    expect(screen.queryByRole("link", { name: VIEW_IN_CONTEXT })).toBeNull();
  });
});

describe("R4 — đích BÌNH LUẬN: tác giả/trạng thái là của BÀI CHA", () => {
  it("bình luận thường ⇒ «Bình luận trong bài của X»; KHÔNG có «tác giả bình luận», KHÔNG nhãn trạng thái", () => {
    const { card } = renderRow(commentReport());
    expect(screen.getByTestId("report-target-identity").textContent).toBe(
      "Bình luận trong bài của Trần Thị Bình",
    );
    expect((card().textContent ?? "").toLowerCase()).not.toContain("tác giả bình luận");
    expect(screen.queryByTestId("report-target-state")).toBeNull();
  });

  it("bài cha đã XOÁ ⇒ «[bài chứa bình luận đã xoá]» — không có «[đã xoá]» trần", () => {
    const { card } = renderRow(
      commentReport({
        targetSnapshot: snapshot({ status: "deleted", deletedAt: "2026-10-02T00:00:00.000Z" }),
      }),
    );
    expect(screen.getByTestId("report-target-state").textContent).toBe(
      "[bài chứa bình luận đã xoá]",
    );
    expect(card().textContent ?? "").not.toContain("[đã xoá]");
  });

  it.each([
    {
      name: "CHỈ vế thời điểm (`published` + `deletedAt ≠ null`)",
      over: { status: "published" as const, deletedAt: "2026-10-02T00:00:00.000Z" },
    },
    {
      name: "CHỈ vế trạng thái (`deleted` + `deletedAt: null`)",
      over: { status: "deleted" as const, deletedAt: null },
    },
  ])("bài cha đã xoá — $name ⇒ «[bài chứa bình luận đã xoá]», KHÔNG có link", ({ over }) => {
    setCaps(POST_MANAGER);
    renderRow(commentReport({ targetSnapshot: snapshot(over) }));
    expect(screen.getByTestId("report-target-state").textContent).toBe(
      "[bài chứa bình luận đã xoá]",
    );
    expect(screen.queryByRole("link", { name: VIEW_IN_CONTEXT })).toBeNull();
  });

  it("bài cha đang ẨN ⇒ «[bài chứa bình luận đã ẩn]» — không có «[đã ẩn]» trần", () => {
    const { card } = renderRow(commentReport({ targetSnapshot: snapshot({ status: "hidden" }) }));
    expect(screen.getByTestId("report-target-state").textContent).toBe(
      "[bài chứa bình luận đã ẩn]",
    );
    expect(card().textContent ?? "").not.toContain("[đã ẩn]");
  });

  it("đối chứng — đích BÀI ⇒ «Bài của X», không dùng câu của bình luận", () => {
    const { card } = renderRow(makeReport());
    expect(screen.getByTestId("report-target-identity").textContent).toBe("Bài của Trần Thị Bình");
    expect(card().textContent ?? "").not.toContain("Bình luận trong bài");
  });

  it("loại đích có nhãn riêng: «Bài viết» ↔ «Bình luận»", () => {
    const first = renderRow(makeReport());
    expect(screen.getByTestId("report-target-type").textContent).toBe("Bài viết");
    first.unmount();
    renderRow(commentReport());
    expect(screen.getByTestId("report-target-type").textContent).toBe("Bình luận");
  });

  it("trích đoạn là chữ thuần: thẻ HTML trong `bodyExcerpt` không thành phần tử", () => {
    const { container } = renderRow(
      commentReport({ targetSnapshot: snapshot({ bodyExcerpt: "<i>trích đoạn</i> bình luận" }) }),
    );
    expect(screen.getByTestId("report-excerpt").textContent).toBe("<i>trích đoạn</i> bình luận");
    expect(container.querySelector("i")).toBeNull();
  });
});

describe("Trường `null` có thật trên dây — tên · trích đoạn · người xử lý", () => {
  const NAME_UNKNOWN = "người không rõ tên";

  it("người báo cáo `fullName: null` + `employeeId: null` ⇒ «người không rõ tên» + «(hồ sơ không còn)»", () => {
    renderRow(makeReport({ reporter: { employeeId: null, fullName: null, avatarUrl: null } }));
    const reporter = screen.getByTestId("report-reporter");
    expect(reporter).toHaveTextContent(`${NAME_UNKNOWN}${PROFILE_GONE}`);
    expect(reporter).not.toHaveTextContent(REPORTER_MASKED);
  });

  it("tên toàn khoảng trắng coi như không có tên (người báo cáo còn hồ sơ ⇒ không nhãn hồ sơ)", () => {
    renderRow(
      makeReport({
        reporter: { employeeId: REPORTER_EMPLOYEE_ID, fullName: "   ", avatarUrl: null },
      }),
    );
    const reporter = screen.getByTestId("report-reporter");
    expect(reporter).toHaveTextContent(NAME_UNKNOWN);
    expect(reporter).not.toHaveTextContent(PROFILE_GONE);
  });

  it("`authorFullName: null` ⇒ «Bài của người không rõ tên» / «Bình luận trong bài của người không rõ tên»", () => {
    const first = renderRow(makeReport({ targetSnapshot: snapshot({ authorFullName: null }) }));
    expect(screen.getByTestId("report-target-identity").textContent).toBe(
      `Bài của ${NAME_UNKNOWN}`,
    );
    first.unmount();

    renderRow(commentReport({ targetSnapshot: snapshot({ authorFullName: null }) }));
    expect(screen.getByTestId("report-target-identity").textContent).toBe(
      `Bình luận trong bài của ${NAME_UNKNOWN}`,
    );
  });

  it("tên TÁC GIẢ toàn khoảng trắng coi như không có tên ⇒ «Bài của người không rõ tên», không phải «Bài của »", () => {
    renderRow(makeReport({ targetSnapshot: snapshot({ authorFullName: "   " }) }));
    expect(screen.getByTestId("report-target-identity").textContent).toBe(
      `Bài của ${NAME_UNKNOWN}`,
    );
  });

  it("người xử lý `fullName: null` ⇒ «người không rõ tên» ở dòng người xử lý, KHÔNG lan sang người báo cáo", () => {
    renderRow(
      closedReport({
        resolvedBy: { employeeId: RESOLVER_EMPLOYEE_ID, fullName: null, avatarUrl: null },
      }),
    );
    expect(screen.getByTestId("report-resolved-by")).toHaveTextContent(NAME_UNKNOWN);
    expect(screen.getByTestId("report-reporter")).not.toHaveTextContent(NAME_UNKNOWN);
  });

  it("`bodyExcerpt: null` ⇒ KHÔNG vẽ trích đoạn; dòng danh tính vẫn hiện (đối chứng: có trích đoạn ⇒ vẽ)", () => {
    const first = renderRow(makeReport({ targetSnapshot: snapshot({ bodyExcerpt: null }) }));
    expect(screen.getByTestId("report-target-identity").textContent).toBe("Bài của Trần Thị Bình");
    expect(screen.queryByTestId("report-excerpt")).toBeNull();
    first.unmount();

    renderRow(makeReport());
    expect(screen.getByTestId("report-excerpt").textContent).toBe("Nội dung bài viết bị báo cáo");
  });

  it("`resolvedBy: null` + có `resolvedAt` ⇒ chỉ vẽ thời điểm, KHÔNG có nhãn «Người xử lý:»", () => {
    renderRow(closedReport({ resolvedBy: null }));
    const resolvedBy = screen.getByTestId("report-resolved-by");
    expect(resolvedBy.textContent).toBe("3 giờ trước");
    expect(screen.getByTestId("report-status-pill").textContent).toBe("Đã giải quyết");
  });

  it("có `resolvedBy`, `resolvedAt: null` ⇒ nhãn + tên, không thời điểm", () => {
    renderRow(closedReport({ resolvedAt: null }));
    const resolvedBy = screen.getByTestId("report-resolved-by");
    expect(resolvedBy).toHaveTextContent("Người xử lý:");
    expect(resolvedBy).toHaveTextContent("Phạm Thị Hoa");
    expect(resolvedBy.querySelector("time")).toBeNull();
  });

  it("`resolvedBy: null` + `resolvedAt: null` ⇒ KHÔNG vẽ dòng người xử lý; pill trạng thái vẫn có", () => {
    renderRow(closedReport({ resolvedBy: null, resolvedAt: null }));
    expect(screen.getByTestId("report-status-pill").textContent).toBe("Đã giải quyết");
    expect(screen.queryByTestId("report-resolved-by")).toBeNull();
  });
});

describe("R5 — hàng đã xử lý + nhãn lý do", () => {
  it("`resolved` + `resolutionNote: null` ⇒ có người xử lý + thời điểm + pill, KHÔNG vẽ khối ghi chú xử lý", () => {
    renderRow(closedReport());
    const resolvedBy = screen.getByTestId("report-resolved-by");
    expect(resolvedBy).toHaveTextContent("Phạm Thị Hoa");
    expect(resolvedBy).toHaveTextContent("3 giờ trước");
    expect(resolvedBy).not.toHaveTextContent(PROFILE_GONE);
    expect(screen.getByTestId("report-status-pill").textContent).toBe("Đã giải quyết");
    expect(screen.queryByTestId("report-resolution-note")).toBeNull();
  });

  it("có `resolutionNote` ⇒ vẽ khối, chữ thuần giữ xuống dòng", () => {
    const { container } = renderRow(closedReport({ resolutionNote: "Đã nhắc nhở\n<u>ẩn bài</u>" }));
    const note = screen.getByTestId("report-resolution-note");
    expect(note.textContent).toContain("Đã nhắc nhở\n<u>ẩn bài</u>");
    expect(note.outerHTML).toContain("whitespace-pre-line");
    expect(container.querySelector("u")).toBeNull();
  });

  it("`resolvedBy.employeeId: null` ⇒ tên + «(hồ sơ không còn)» (cùng luật với người báo cáo)", () => {
    renderRow(
      closedReport({
        resolvedBy: { employeeId: null, fullName: "Đỗ Minh Quân", avatarUrl: null },
      }),
    );
    const resolvedBy = screen.getByTestId("report-resolved-by");
    expect(resolvedBy).toHaveTextContent("Đỗ Minh Quân");
    expect(resolvedBy).toHaveTextContent(PROFILE_GONE);
    // Người BÁO CÁO còn hồ sơ ⇒ nhãn không được lan sang dòng của họ.
    expect(screen.getByTestId("report-reporter")).not.toHaveTextContent(PROFILE_GONE);
  });

  it("`dismissed` ⇒ pill «Đã bỏ qua»; báo cáo đang mở ⇒ KHÔNG pill, KHÔNG dòng người xử lý", () => {
    const first = renderRow(closedReport({ status: "dismissed" }));
    expect(screen.getByTestId("report-status-pill").textContent).toBe("Đã bỏ qua");
    first.unmount();

    const { card } = renderRow(makeReport());
    expect(card()).toHaveTextContent("2 ngày trước");
    expect(screen.queryByTestId("report-status-pill")).toBeNull();
    expect(screen.queryByTestId("report-resolved-by")).toBeNull();
  });

  const REASON_LABELS: Record<(typeof feedReportReasonSchema.options)[number], string> = {
    spam: "Spam hoặc quảng cáo",
    harassment: "Quấy rối hoặc xúc phạm",
    inappropriate: "Nội dung không phù hợp",
    misinformation: "Thông tin sai lệch",
    other: "Lý do khác",
  };

  it.each(feedReportReasonSchema.options)(
    "lý do `%s` ⇒ chữ tiếng Việt, không phải khoá",
    (reason) => {
      renderRow(makeReport({ reason }));
      const text = screen.getByTestId("report-reason").textContent ?? "";
      expect(text).toBe(REASON_LABELS[reason]);
      expect(text).not.toContain("admin.");
    },
  );
});
