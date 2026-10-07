/**
 * S16-SOCIAL-FE-3C (L8, ca CR1 · CR2) — nút «Báo cáo» trên BÌNH LUẬN (`CommentList`) và đường nối tới hộp
 * thoại soạn báo cáo (`SOCIAL-API-027`, đích `comment`). File RIÊNG: `CommentList.spec.tsx` không sửa.
 *
 * Ghim:
 *  · CR1 — bình luận của NGƯỜI KHÁC, gốc LẪN trả lời, có nút; của chính mình thì KHÔNG («Xoá» làm đối
 *    chứng). Nút không nằm trong nhánh của «Trả lời», không đòi `create:feed-comment` (027 gác `view:feed`).
 *  · CR2 — bấm ⇒ hộp thoại «Báo cáo bình luận»; gửi ⇒ đích `comment` + id của CHÍNH hàng đó. Hộp thoại
 *    mount LƯỜI: danh sách vẽ được khi KHÔNG có `QueryClientProvider` (như các ca của `CommentList.spec.tsx`).
 *  · hàng biến mất khi hộp thoại đang mở ⇒ hộp thoại + nháp CÒN; server trả 404 ⇒ `reportTargetGone`.
 *  · đóng ⇒ focus về nút «Báo cáo» của ĐÚNG hàng · mỗi lượt mở một nháp + một `attemptId` (plan D20 · B22).
 * Hộp thoại ĐANG MỞ mà nút «Báo cáo» của một hàng được kích hoạt (hộp thoại là modal ở nơi mount) đo ở file riêng
 * `CommentList.report-modal.spec.tsx`.
 *
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Hàng tìm theo NỘI DUNG bình luận, phần tử truy vấn theo role + tên trợ năng.
 */
import type { ComponentProps, ReactElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFeedReportSchema,
  SOCIAL_ERROR_CODES,
  type FeedCommentDto,
} from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import i18n from "@/i18n";
import { makeComment, renderWithProviders, resetCaps, setCaps } from "../social-test-doubles";
import { CommentList } from "./CommentList";

const createReport = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    socialModerationApi: {
      ...actual.socialModerationApi,
      createReport: (...a: unknown[]) => createReport(...a),
    },
  };
});

const ROOT_ID = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const REPLY_ID = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const OTHER_ID = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const CREATED = { id: "66666666-6666-4666-8666-666666666666" };
const ROOT_BODY = "nội dung bình luận gốc";
const REPLY_BODY = "nội dung phản hồi bên dưới";
const OTHER_BODY = "nội dung bình luận thứ hai";

const REPORT = "Báo cáo";
const REPLY = "Trả lời";
const DELETE = "Xoá";
const DIALOG_TITLE = "Báo cáo bình luận";
const NOTE = "Ghi chú thêm (không bắt buộc)";
const SUBMIT = "Gửi báo cáo";
const CANCEL = "Huỷ";
const CLOSE = "Đóng";
const RETRY = "Thử lại";
const SENT = "Đã gửi báo cáo. Người kiểm duyệt sẽ xem xét nội dung này.";
const TARGET_GONE = "Nội dung bạn muốn báo cáo không còn tồn tại hoặc bạn không còn xem được.";
const SPAM = "Spam hoặc quảng cáo";
const HARASSMENT = "Quấy rối hoặc xúc phạm";
const DRAFT = "lời lẽ xúc phạm đồng nghiệp";

/** Bình luận GỐC · một TRẢ LỜI của nó · một bình luận gốc thứ hai — mặc định đều của NGƯỜI KHÁC. */
const root = (over: Partial<FeedCommentDto> = {}): FeedCommentDto =>
  makeComment({ id: ROOT_ID, body: ROOT_BODY, ...over });
const reply = (over: Partial<FeedCommentDto> = {}): FeedCommentDto =>
  makeComment({ id: REPLY_ID, parentCommentId: ROOT_ID, body: REPLY_BODY, ...over });
const other = (over: Partial<FeedCommentDto> = {}): FeedCommentDto =>
  makeComment({ id: OTHER_ID, body: OTHER_BODY, ...over });

/** 404 của 027 với đích BÌNH LUẬN, đúng hình dạng trên dây (`COMMENT_NOT_FOUND` chung mã `001` với bài). */
const GONE_MESSAGE = "SOCIAL-ERR-001: không tìm thấy bình luận.";
const commentGone = (): ApiError =>
  new ApiError(404, SOCIAL_ERROR_CODES.COMMENT_NOT_FOUND, GONE_MESSAGE);

/** Body 027 kỳ vọng của một báo cáo BÌNH LUẬN; vắng `note` ⇒ KHÔNG có khoá đó. */
const commentReport = (id: string, reason: string, note?: string): Record<string, string> => ({
  targetType: "comment",
  targetId: id,
  reason,
  ...(note === undefined ? {} : { note }),
});

const handlers = {
  onRetry: vi.fn(),
  onReply: vi.fn(),
  onDelete: vi.fn(),
  onReactionChange: vi.fn(),
};

type ListProps = ComponentProps<typeof CommentList>;
const listNode = (comments: FeedCommentDto[], over: Partial<ListProps> = {}): ReactElement => (
  <CommentList comments={comments} isLoading={false} isError={false} {...handlers} {...over} />
);

/** Hàng (`<li>`) của bình luận mang ĐÚNG nội dung này — mỗi fixture một nội dung riêng. */
function rowOf(body: string): HTMLElement {
  const row = screen.getByText(body).closest("li");
  if (!row) throw new Error(`không tìm thấy hàng của bình luận «${body}»`);
  return row;
}
const rowButton = (body: string, name: string): HTMLElement | null =>
  within(rowOf(body)).queryByRole("button", { name });
const reportButton = (body: string): HTMLElement =>
  within(rowOf(body)).getByRole("button", { name: REPORT });

const dialog = (): HTMLElement => screen.getByRole("dialog", { name: DIALOG_TITLE });
const button = (name: string): HTMLElement => screen.getByRole("button", { name });
const radio = (name: string): HTMLInputElement => screen.getByRole("radio", { name });
const pick = (name: string): boolean => fireEvent.click(radio(name));
const noteBox = (): HTMLTextAreaElement => screen.getByRole("textbox", { name: NOTE });
const typeNote = (value: string): boolean => fireEvent.change(noteBox(), { target: { value } });
const alertReason = (): string | null =>
  within(dialog()).getByRole("alert").getAttribute("data-reason");
const sentBody = (call = 0): unknown => createReport.mock.calls[call]?.[0];
const sentAttemptId = (call = 0): unknown => createReport.mock.calls[call]?.[1];

/** Mở hộp thoại của hàng `body`, soạn (lý do + ghi chú tuỳ chọn) rồi bấm «Gửi báo cáo». */
function reportAndSubmit(body: string, reason: string, note?: string): void {
  fireEvent.click(reportButton(body));
  pick(reason);
  if (note !== undefined) typeNote(note);
  fireEvent.click(button(SUBMIT));
}

function expectDistinctAttemptIds(a: unknown, b: unknown): void {
  for (const id of [a, b]) {
    expect(typeof id).toBe("string");
    expect(String(id).trim().length).toBeGreaterThan(0);
  }
  expect(b).not.toBe(a);
}

/** Cho react-query một nhịp: lời gọi (nếu có) chạy SAU cú bấm, không cùng nhịp. */
const flush = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  // CHỈ `view:feed` — KHÔNG có `create:feed-comment`: người không được bình luận vẫn báo cáo được.
  setCaps({ "view:feed": true });
  for (const spy of Object.values(handlers)) spy.mockReset();
  createReport.mockReset();
  createReport.mockResolvedValue(CREATED);
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("CR1 — nút «Báo cáo» trên bình luận", () => {
  it("ALLOW: bình luận của NGƯỜI KHÁC — gốc LẪN trả lời — đều có nút «Báo cáo», dù người xem không có `create:feed-comment`", () => {
    renderWithProviders(listNode([root(), reply()]));
    expect(reportButton(ROOT_BODY)).toBeInTheDocument();
    expect(reportButton(REPLY_BODY)).toBeInTheDocument();
    // Hệ một cấp: trả lời KHÔNG có «Trả lời» nhưng vẫn có «Báo cáo» ⇒ nút không nằm trong nhánh của «Trả lời».
    expect(rowButton(ROOT_BODY, REPLY)).not.toBeNull();
    expect(rowButton(REPLY_BODY, REPLY)).toBeNull();
  });

  it("DENY: bình luận của CHÍNH MÌNH (gốc lẫn trả lời) ⇒ KHÔNG có «Báo cáo»; đối chứng: nút «Xoá» có", () => {
    renderWithProviders(listNode([root({ isMine: true }), reply({ isMine: true })]));
    for (const body of [ROOT_BODY, REPLY_BODY]) {
      expect(rowButton(body, DELETE)).not.toBeNull();
      expect(rowButton(body, REPORT)).toBeNull();
    }
  });

  it("cùng một danh sách: hàng của người khác có «Báo cáo», hàng của mình có «Xoá» — mỗi hàng đúng MỘT trong hai", () => {
    renderWithProviders(listNode([root(), other({ isMine: true })]));
    expect(screen.getAllByRole("button", { name: REPORT })).toHaveLength(1);
    expect(reportButton(ROOT_BODY)).toBeInTheDocument();
    expect(rowButton(ROOT_BODY, DELETE)).toBeNull();
    expect(rowButton(OTHER_BODY, DELETE)).not.toBeNull();
    expect(rowButton(OTHER_BODY, REPORT)).toBeNull();
  });
});

describe("CR2 — hộp thoại mount LƯỜI", () => {
  it("KHÔNG có `QueryClientProvider` ⇒ danh sách vẫn vẽ, có nút «Báo cáo», chưa có hộp thoại", () => {
    expect(() =>
      render(<I18nextProvider i18n={i18n}>{listNode([root(), reply()])}</I18nextProvider>),
    ).not.toThrow();
    expect(reportButton(ROOT_BODY)).toBeInTheDocument();
    expect(reportButton(REPLY_BODY)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("trước khi bấm KHÔNG có hộp thoại; bấm ⇒ đúng MỘT hộp thoại, tên «Báo cáo bình luận»", () => {
    renderWithProviders(listNode([root(), reply()]));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(reportButton(ROOT_BODY));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(dialog()).toBeInTheDocument();
  });
});

describe("CR2 — gửi báo cáo cho ĐÚNG bình luận", () => {
  it.each([
    { name: "bình luận gốc", body: ROOT_BODY, id: ROOT_ID },
    { name: "trả lời (id của CHÍNH nó, không phải id cha)", body: REPLY_BODY, id: REPLY_ID },
  ])("$name: gửi ⇒ `createReport` nhận đích `comment` + id của hàng đó", async ({ body, id }) => {
    renderWithProviders(listNode([root(), reply()]));

    reportAndSubmit(body, SPAM);
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));

    expect(sentBody()).toEqual({ targetType: "comment", targetId: id, reason: "spam" });
    expect(createFeedReportSchema.safeParse(sentBody()).success).toBe(true);
    expect(await screen.findByRole("status")).toHaveTextContent(SENT);
    // Báo cáo không đi qua callback nào của danh sách (không trả lời, không xoá, không cảm xúc).
    for (const spy of Object.values(handlers)) expect(spy).not.toHaveBeenCalled();
  });

  it("«Huỷ» ⇒ hộp thoại biến mất, 0 lời gọi 027, hàng bình luận còn nguyên", async () => {
    renderWithProviders(listNode([root()]));
    fireEvent.click(reportButton(ROOT_BODY));
    pick("Lý do khác");

    fireEvent.click(button(CANCEL));
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createReport).not.toHaveBeenCalled();
    expect(reportButton(ROOT_BODY)).toBeInTheDocument();
  });
});

// Realtime xoá, tải lại hay lượt đọc hỏng đều gỡ hàng khỏi danh sách trong lúc người dùng còn đang gõ. Hộp
// thoại thuộc về BÌNH LUẬN đã chọn chứ không thuộc về hàng: nó không được biến mất im lặng kèm cả nháp.
describe("hàng bình luận BIẾN MẤT khi hộp thoại đang mở", () => {
  function openWithDraft() {
    const view = renderWithProviders(listNode([root(), other()]));
    fireEvent.click(reportButton(ROOT_BODY));
    pick(HARASSMENT);
    typeNote(DRAFT);
    return view;
  }
  const expectDraftKept = (): void => {
    expect(dialog()).toBeInTheDocument();
    expect(radio(HARASSMENT)).toBeChecked();
    expect(noteBox()).toHaveValue(DRAFT);
  };

  it("hàng bị gỡ (xoá / tải lại) ⇒ hộp thoại + nháp CÒN; gửi vẫn nhắm bình luận đó, 404 ⇒ `reportTargetGone`", async () => {
    createReport.mockRejectedValueOnce(commentGone());
    const { rerender } = openWithDraft();

    rerender(listNode([other()]));
    expect(screen.queryByText(ROOT_BODY)).toBeNull();
    expectDraftKept();

    fireEvent.click(button(SUBMIT));
    await waitFor(() => expect(alertReason()).toBe("reportTargetGone"));
    expect(createReport).toHaveBeenCalledTimes(1);
    expect(sentBody()).toEqual(commentReport(ROOT_ID, "harassment", DRAFT));
    expect(within(dialog()).getByRole("alert")).toHaveTextContent(TARGET_GONE);
    // Chữ của FE: thông điệp của server (mang mã nội bộ) không lên màn; lỗi kết cục không mời «Thử lại».
    expect(dialog()).not.toHaveTextContent("SOCIAL-ERR");
    expect(within(dialog()).queryByRole("button", { name: RETRY })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expectDraftKept();
  });

  it.each([
    { name: "danh sách thành RỖNG", comments: [] as FeedCommentDto[], over: {} },
    { name: "danh sách đang TẢI lại", comments: [] as FeedCommentDto[], over: { isLoading: true } },
    { name: "lượt đọc lại HỎNG", comments: [root(), other()], over: { isError: true } },
  ])("$name ⇒ hộp thoại + nháp CÒN; «Huỷ» vẫn đóng được", async ({ comments, over }) => {
    const { rerender } = openWithDraft();

    rerender(listNode(comments, over));
    expect(screen.queryByText(ROOT_BODY)).toBeNull();
    expectDraftKept();

    fireEvent.click(button(CANCEL));
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createReport).not.toHaveBeenCalled();
  });

  it("đối chứng: danh sách tải lại mà hàng CÒN (object mới, cùng id) ⇒ hộp thoại và nháp còn nguyên", () => {
    const { rerender } = openWithDraft();
    rerender(listNode([root({ likeCount: 3 }), other()]));
    expect(reportButton(ROOT_BODY)).toBeInTheDocument();
    expectDraftKept();
  });
});

// Chuột trên Safari (macOS) không đưa focus vào nút vừa bấm, và `fireEvent.click` của jsdom cũng không: nơi
// mount không tự đặt focus trước khi mở thì `Dialog` ghi nhầm «phần tử kích hoạt» và lúc đóng trả focus về
// phần tử giữ focus TRƯỚC cú bấm. Mỗi ca đặt sẵn focus ở nút của hàng KHÁC để hai trường hợp phân biệt được.
describe("đóng hộp thoại ⇒ focus về nút «Báo cáo» của ĐÚNG bình luận", () => {
  it.each([
    { name: "«Huỷ»", close: () => fireEvent.click(button(CANCEL)) },
    { name: "Esc", close: () => fireEvent.keyDown(document, { key: "Escape" }) },
  ])("báo cáo từ hàng THỨ HAI, đóng bằng $name ⇒ focus về nút của hàng thứ hai", ({ close }) => {
    renderWithProviders(listNode([root(), other()]));
    const first = reportButton(ROOT_BODY);
    const second = reportButton(OTHER_BODY);
    first.focus();

    fireEvent.click(second);
    // Đang mở: focus nằm TRONG hộp thoại.
    expect(dialog()).toContainElement(document.activeElement as HTMLElement);
    close();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(second).toHaveFocus();
    expect(first).not.toHaveFocus();
  });

  it("gửi xong rồi «Đóng» ⇒ focus về nút «Báo cáo» của hàng đã báo cáo (hộp thoại đã mount lại sang câu xác nhận)", async () => {
    renderWithProviders(listNode([root(), other()]));
    const trigger = reportButton(OTHER_BODY);
    reportButton(ROOT_BODY).focus();

    reportAndSubmit(OTHER_BODY, SPAM);
    const closeButton = await screen.findByRole("button", { name: CLOSE });
    expect(closeButton).toHaveFocus();
    fireEvent.click(closeButton);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe("mỗi lượt mở một nháp + một `attemptId` (plan D20 · B22)", () => {
  it("báo cáo A (gửi xong, đóng) rồi mở cho B ⇒ nháp TRẮNG, đích là B, `attemptId` MỚI dù nội dung y hệt", async () => {
    renderWithProviders(listNode([root(), other()]));
    reportAndSubmit(ROOT_BODY, SPAM, DRAFT);
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: CLOSE }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(reportButton(OTHER_BODY));
    expect(radio(SPAM)).not.toBeChecked();
    expect(noteBox()).toHaveValue("");
    pick(SPAM);
    typeNote(DRAFT);
    fireEvent.click(button(SUBMIT));
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(2));

    expect(sentBody(0)).toEqual(commentReport(ROOT_ID, "spam", DRAFT));
    expect(sentBody(1)).toEqual(commentReport(OTHER_ID, "spam", DRAFT));
    expectDistinctAttemptIds(sentAttemptId(0), sentAttemptId(1));
    await screen.findByRole("status");
  });

  it("CÙNG bình luận: gửi xong, đóng, mở lại và gửi y hệt ⇒ `attemptId` MỚI (không phát lại phản hồi cũ)", async () => {
    renderWithProviders(listNode([root()]));
    for (const round of [1, 2]) {
      reportAndSubmit(ROOT_BODY, SPAM);
      await waitFor(() => expect(createReport).toHaveBeenCalledTimes(round));
      fireEvent.click(await screen.findByRole("button", { name: CLOSE }));
      expect(screen.queryByRole("dialog")).toBeNull();
    }
    expect(sentBody(1)).toEqual(sentBody(0));
    expectDistinctAttemptIds(sentAttemptId(0), sentAttemptId(1));
  });

  // Nút «Báo cáo» của một hàng được kích hoạt khi hộp thoại ĐANG MỞ (lớp phủ không làm nền `inert`) ⇒ bị bỏ qua, đích
  // không đổi: đo ở `CommentList.report-modal.spec.tsx`. Ca «báo cáo A (gửi xong, đóng) rồi mở cho B» là vế ALLOW ở đây.
});
