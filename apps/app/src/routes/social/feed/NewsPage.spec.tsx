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
 *
 * ┌─ H7 · H1 (gate 23/09/2026) — hai lỗ thủng ca C9 KHÔNG bắt được ──────────────────────────────┐
 * │ H7 «nhãn chết nói dối»: màn cũ gọi `listPostAcks(postId, { limit: 50 })` — THIẾU `state`, mà   │
 * │     `listPostAcksQuerySchema.state` có `.default("acked")` ⇒ server chỉ trả nửa ĐÃ đọc ⇒ mọi   │
 * │     hàng đều có `ackedAt` ⇒ nhánh `news.readersUnread` KHÔNG BAO GIỜ tới được, và cả lý do của │
 * │     cổng `manage:feed-news` («nửa chưa đọc chiếu danh tính toàn công ty») thành phép đo không  │
 * │     thoả được. Kèm theo: `total`/`page` của trang offset bị bỏ ⇒ công ty >50 người thì danh    │
 * │     sách CẮT IM LẶNG. HR thấy 12 người «Đã đọc» và kết luận đã phổ biến xong, trong khi 200    │
 * │     người chưa đọc và màn hình không có đường nào hiện họ.                                     │
 * │ H1 «ack câm»: mutation 021 thiếu `onError` ⇒ 500 xong nút nhả ra, nhãn về như cũ, KHÔNG một    │
 * │     ký tự nào xuất hiện. Nhân viên đóng tab tin là đã xác nhận; `feed_post_acks` append-only,  │
 * │     không có đường sửa tay ⇒ bảng chấp hành của HR thiếu tên họ VĨNH VIỄN.                     │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@mediaos/web-core";
import type { FeedAckPageDto, FeedAckPersonDto, ListPostAcksQueryDto } from "@mediaos/contracts";
import i18n from "@/i18n";
import { NewsPage } from "./NewsPage";
import { makeNews, page, renderWithProviders, resetCaps, setCaps } from "./social-test-doubles";

const listNews = vi.fn();
const ackPost = vi.fn();
const listPostAcks = vi.fn();

const t = i18n.getFixedT("vi", "social");
/** Id của tin do `makeNews()` sinh ra — dùng để ghim ĐỐI SỐ THẬT của 022, không chỉ "có gọi". */
const NEWS_ID = "11111111-1111-4111-8111-111111111111";
/** Phải khớp `READERS_PAGE_SIZE` của NewsPage: chính con số này tách lời gọi DANH SÁCH khỏi lời gọi ĐẾM. */
const LIST_LIMIT = 50;

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

/** Mỗi người một `employeeId` KHÁC nhau — 022 trả một hàng/người, double dùng chung id là sai hình dạng. */
let personSeq = 0;
const person = (over: Partial<FeedAckPersonDto> = {}): FeedAckPersonDto => {
  personSeq += 1;
  return {
    employeeId: `33333333-3333-4333-8333-${String(personSeq).padStart(12, "0")}`,
    fullName: "An Nguyễn",
    avatarUrl: null,
    ackedAt: "2026-09-23T03:00:00.000Z",
    ...over,
  };
};

const ackPage = (data: FeedAckPersonDto[], over: Partial<FeedAckPageDto> = {}): FeedAckPageDto => ({
  data,
  page: 1,
  limit: LIST_LIMIT,
  total: data.length,
  ...over,
});

/**
 * Double của 022 bắt chước ĐÚNG một hành vi của server: `state` có `.default("acked")`, nên caller
 * KHÔNG gửi `state` thì nhận nửa đã-ack.
 *
 * ⚠️ Đây là điều làm ca H7 có RĂNG. Nếu double trả nửa theo *ý định của test* thay vì theo *tham số
 * thật*, thì bỏ `state: "unacked"` khỏi NewsPage đi test vẫn xanh — đúng cái bẫy đã sinh ra H7.
 */
function mockAcks(
  resolve: (q: Partial<ListPostAcksQueryDto>) => FeedAckPageDto | Promise<FeedAckPageDto>,
): void {
  listPostAcks.mockImplementation((...args: unknown[]) => {
    const q = (args[1] ?? {}) as Partial<ListPostAcksQueryDto>;
    return Promise.resolve(resolve({ ...q, state: q.state ?? "acked" }));
  });
}

/** Mở panel «Danh sách đã đọc» (chỉ có với `manage:feed-news`). */
async function openReaders(): Promise<void> {
  await waitFor(() => expect(screen.getByTestId("news-readers-toggle")).toBeInTheDocument());
  fireEvent.click(screen.getByTestId("news-readers-toggle"));
  await waitFor(() => expect(screen.getByTestId("news-readers")).toBeInTheDocument());
}

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
  it("DENY: chỉ `view:feed` ⇒ nút/tab «Danh sách đã đọc» VẮNG và 022 KHÔNG bị gọi lần nào", async () => {
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true })]));
    mockAcks(() => ackPage([person()]));
    renderWithProviders(<NewsPage />);

    await waitFor(() => expect(screen.getByTestId("news-list")).toBeInTheDocument());
    expect(screen.queryByTestId("news-readers-toggle")).toBeNull();
    // Nút vắng chưa đủ: đường ĐẾM (probe) cũng đi qua 022 và cũng chiếu danh tính.
    expect(listPostAcks).not.toHaveBeenCalled();
    // Đối chứng: màn KHÔNG rỗng vì lý do khác — nút ack vẫn ở đó.
    expect(screen.getByTestId("news-ack-button")).toBeInTheDocument();
  });

  it("ALLOW: có `manage:feed-news` ⇒ nút HIỆN, và 022 CHỈ gọi khi thực sự mở", async () => {
    setCaps({ "view:feed": true, "manage:feed-news": true });
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true })]));
    mockAcks(() => ackPage([person()]));
    renderWithProviders(<NewsPage />);

    await waitFor(() => expect(screen.getByTestId("news-readers-toggle")).toBeInTheDocument());
    // Route 022 chiếu danh tính toàn công ty — KHÔNG được gọi sẵn "cho nhanh".
    expect(listPostAcks).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("news-readers-toggle"));
    // Mở ⇒ nửa ĐANG XEM (mặc định `acked`) được hỏi với ĐỐI SỐ THẬT, không phải "có gọi là được".
    await waitFor(() =>
      expect(listPostAcks).toHaveBeenCalledWith(NEWS_ID, {
        state: "acked",
        page: 1,
        limit: LIST_LIMIT,
      }),
    );
  });
});

describe("H7 — nửa «chưa đọc» phải HỎI ĐƯỢC (nhánh từng chết)", () => {
  beforeEach(() => {
    setCaps({ "view:feed": true, "manage:feed-news": true });
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true })]));
  });

  it('bấm tab «Chưa đọc» ⇒ 022 gọi với `state: "unacked"` và danh sách đổi sang nửa kia', async () => {
    mockAcks((q) =>
      q.state === "unacked"
        ? ackPage([person({ fullName: "Chưa đọc Nguyễn", ackedAt: null })], { total: 200 })
        : ackPage([person({ fullName: "Đã đọc Trần" })], { total: 12 }),
    );
    renderWithProviders(<NewsPage />);
    await openReaders();

    await waitFor(() => expect(screen.getByTestId("news-readers-list")).toBeInTheDocument());
    expect(screen.getByTestId("news-readers-list")).toHaveTextContent("Đã đọc Trần");

    fireEvent.click(screen.getByTestId("news-readers-tab-unacked"));

    await waitFor(() =>
      expect(listPostAcks).toHaveBeenCalledWith(NEWS_ID, {
        state: "unacked",
        page: 1,
        limit: LIST_LIMIT,
      }),
    );
    // Không chỉ "có gọi": nửa hiện ra trên màn phải LÀ nửa chưa đọc.
    await waitFor(() =>
      expect(screen.getByTestId("news-readers-list")).toHaveTextContent("Chưa đọc Nguyễn"),
    );
    expect(screen.getByTestId("news-readers-list")).not.toHaveTextContent("Đã đọc Trần");
  });

  it("hàng `ackedAt == null` ⇒ nhãn «Chưa đọc» — chứng minh nhánh kia KHÔNG còn chết", async () => {
    mockAcks((q) =>
      q.state === "unacked"
        ? ackPage([person({ fullName: "Chưa đọc Nguyễn", ackedAt: null })], { total: 200 })
        : ackPage([person({ fullName: "Đã đọc Trần" })], { total: 12 }),
    );
    renderWithProviders(<NewsPage />);
    await openReaders();
    fireEvent.click(screen.getByTestId("news-readers-tab-unacked"));

    // Phạm vi hẹp vào DANH SÁCH: nhãn tab cũng mang đúng hai chữ này, `getByText` toàn màn sẽ
    // khớp nhầm tab và biến ca này thành xanh-rỗng.
    await waitFor(() =>
      expect(screen.getByTestId("news-readers-list")).toHaveTextContent("Chưa đọc Nguyễn"),
    );
    const list = within(screen.getByTestId("news-readers-list"));
    expect(list.getByText(t("news.readersUnread"))).toBeInTheDocument();
    expect(list.queryByText(t("news.readersRead"))).toBeNull();
  });

  it("`total` > số hàng đang hiện ⇒ hiện «{{read}}/{{total}}» + đường xem tiếp (không CẮT IM LẶNG)", async () => {
    mockAcks((q) => {
      if (q.state === "unacked") return ackPage([], { total: 200 });
      return (q.page ?? 1) === 1
        ? ackPage([person({ fullName: "Đã đọc 1" }), person({ fullName: "Đã đọc 2" })], {
            total: 12,
          })
        : ackPage([person({ fullName: "Đã đọc 3" })], { page: 2, total: 12 });
    });
    renderWithProviders(<NewsPage />);
    await openReaders();

    // Mẫu số là TOÀN BỘ audience (12 đã đọc + 200 chưa đọc), không phải số hàng đang hiện.
    await waitFor(() =>
      expect(screen.getByTestId("news-readers-count")).toHaveTextContent(
        t("news.readersCount", { read: 12, total: 212 }),
      ),
    );

    const more = screen.getByTestId("news-readers-more");
    fireEvent.click(more);

    await waitFor(() =>
      expect(listPostAcks).toHaveBeenCalledWith(NEWS_ID, {
        state: "acked",
        page: 2,
        limit: LIST_LIMIT,
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("news-readers-list")).toHaveTextContent("Đã đọc 3"),
    );
  });

  it("tải hết `total` ⇒ KHÔNG còn nút xem tiếp (nút chết còn tệ hơn không có nút)", async () => {
    mockAcks((q) =>
      q.state === "unacked" ? ackPage([], { total: 0 }) : ackPage([person()], { total: 1 }),
    );
    renderWithProviders(<NewsPage />);
    await openReaders();

    await waitFor(() => expect(screen.getByTestId("news-readers-list")).toBeInTheDocument());
    expect(screen.queryByTestId("news-readers-more")).toBeNull();
  });

  it("panel có đủ ba nhánh: lỗi ⇒ khối lỗi, rỗng ⇒ câu rỗng của ĐÚNG nửa đang xem", async () => {
    mockAcks((q) => {
      if (q.state === "acked") return Promise.reject(new Error("boom"));
      return ackPage([], { total: 0 });
    });
    renderWithProviders(<NewsPage />);
    await openReaders();

    await waitFor(() => expect(screen.getByTestId("news-readers-error")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("news-readers-tab-unacked"));
    await waitFor(() => expect(screen.getByTestId("news-readers-empty")).toBeInTheDocument());
    // Nửa «chưa đọc» rỗng KHÔNG được mượn câu "Chưa có ai xác nhận đã đọc" — nghĩa ngược hẳn.
    expect(screen.getByTestId("news-readers-empty")).not.toHaveTextContent(t("news.readersEmpty"));
  });
});

describe("H1 — «Xác nhận đã đọc» hỏng KHÔNG được IM LẶNG", () => {
  beforeEach(() => {
    listNews.mockResolvedValue(page([makeNews({ requiresAck: true, ackedByMe: false })]));
  });

  const clickAck = async (): Promise<void> => {
    renderWithProviders(<NewsPage />);
    await waitFor(() => expect(screen.getByTestId("news-ack-button")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("news-ack-button"));
  };

  it("500 ⇒ dải lỗi chung HIỆN (trước đây: không một ký tự nào)", async () => {
    ackPost.mockRejectedValue(new ApiError(500, "INTERNAL_ERROR", "boom"));
    await clickAck();

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveAttribute("data-kind", "ack");
    expect(banner).toHaveTextContent(t("actionError.generic.ack"));
  });

  it("403 ⇒ câu «không còn quyền» (thử lại là vô ích — phải nói khác 500)", async () => {
    ackPost.mockRejectedValue(new ApiError(403, "FORBIDDEN", "nope"));
    await clickAck();

    const banner = await screen.findByTestId("feed-action-error");
    expect(banner).toHaveTextContent(t("actionError.forbidden.ack"));
    expect(t("actionError.forbidden.ack")).not.toBe(t("actionError.generic.ack"));
  });

  it("thành công ⇒ KHÔNG có dải lỗi (dải luôn-hiện cũng là một lời nói dối)", async () => {
    ackPost.mockResolvedValue({ postId: NEWS_ID, firstTime: true });
    await clickAck();

    await waitFor(() => expect(ackPost).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("feed-action-error")).toBeNull();
  });
});

describe("C9 — trạng thái của màn", () => {
  it("rỗng ⇒ câu rỗng RIÊNG của tin tức", async () => {
    listNews.mockResolvedValue(page([]));
    renderWithProviders(<NewsPage />);

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
