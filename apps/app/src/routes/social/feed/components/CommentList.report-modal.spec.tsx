/**
 * S16-SOCIAL-FE-3C (L8 · gate TypeScript của PR-C, finding TSC-01) — hộp thoại «Báo cáo» của bình luận là MODAL ở
 * nơi mount (`CommentList`): khi nó ĐANG MỞ, kích hoạt nút «Báo cáo» của một hàng — hàng KHÁC hay CHÍNH hàng đó — bị
 * BỎ QUA. Đích không đổi, focus không bị kéo ra.
 *
 * 🔴 Đường tới là có thật: lớp phủ của `Dialog` không làm phần nền `inert`. Chuột bị lớp phủ chặn, nhưng công nghệ hỗ
 * trợ (con trỏ ảo của trình đọc màn hình, điều khiển bằng giọng nói) vẫn kích hoạt được nút của hàng. Bản đầu của L8
 * ĐỔI ĐÍCH ở lượt kích hoạt đó (mount lại theo `key`). Đo trên bản ấy ngày 07/10/2026:
 *  · A đang GỬI ⇒ hộp thoại của A bị gỡ giữa chừng: kết cục (đã gửi / lỗi) không bao giờ lên màn, nháp mất không hỏi —
 *    `ReportDialog` cấm đóng lúc đang gửi, còn mount lại thì đi vòng qua lệnh cấm đó;
 *  · đóng hộp thoại (lúc này của B) ⇒ focus về nút của A: cleanup của `Dialog` cũ ghi đè lệnh tự-đặt-focus của hàng B;
 *  · kích hoạt lại nút của CHÍNH hàng đang mở ⇒ focus bị kéo ra khỏi hộp thoại.
 *
 * Tách khỏi `CommentList.report.spec.tsx` để file đó ở dưới mốc 400 dòng; khung dựng ở đây chỉ gồm thứ ba ca cần.
 * i18n THẬT, chữ kỳ vọng VIẾT TAY. Hàng tìm theo NỘI DUNG bình luận, phần tử truy vấn theo role + tên trợ năng.
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedCommentDto } from "@mediaos/contracts";
import { makeComment, renderWithProviders, resetCaps, setCaps } from "../social-test-doubles";
import { ADMIN_ERR } from "../../admin/admin-test-doubles";
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

const A_ID = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const B_ID = "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3";
const A_BODY = "nội dung bình luận A";
const B_BODY = "nội dung bình luận B";
const CREATED = { id: "66666666-6666-4666-8666-666666666666" };

const REPORT = "Báo cáo";
const DIALOG_TITLE = "Báo cáo bình luận";
const NOTE = "Ghi chú thêm (không bắt buộc)";
const SUBMIT = "Gửi báo cáo";
const CANCEL = "Huỷ";
const CLOSE = "Đóng";
const HARASSMENT = "Quấy rối hoặc xúc phạm";
const SENT = "Đã gửi báo cáo. Người kiểm duyệt sẽ xem xét nội dung này.";
const DRAFT = "lời lẽ xúc phạm đồng nghiệp";

/** Hai bình luận GỐC của NGƯỜI KHÁC: A là bình luận hộp thoại được mở cho, B là hàng «chen vào». */
const comments: FeedCommentDto[] = [
  makeComment({ id: A_ID, body: A_BODY }),
  makeComment({ id: B_ID, body: B_BODY }),
];
const handlers = {
  onRetry: vi.fn(),
  onReply: vi.fn(),
  onDelete: vi.fn(),
  onReactionChange: vi.fn(),
};

const renderList = () =>
  renderWithProviders(
    <CommentList comments={comments} isLoading={false} isError={false} {...handlers} />,
  );

function reportButton(body: string): HTMLElement {
  const row = screen.getByText(body).closest("li");
  if (!row) throw new Error(`không tìm thấy hàng của bình luận «${body}»`);
  return within(row).getByRole("button", { name: REPORT });
}
const dialog = (): HTMLElement => screen.getByRole("dialog", { name: DIALOG_TITLE });
const button = (name: string): HTMLElement => screen.getByRole("button", { name });
const noteBox = (): HTMLTextAreaElement => screen.getByRole("textbox", { name: NOTE });
const alertReason = (): string | null =>
  within(dialog()).getByRole("alert").getAttribute("data-reason");
/** Lời gọi 027 thứ `call`: body + `attemptId` (đối số thứ hai của `createReport`). */
const sent = (call: number): { body: unknown; attemptId: unknown } => ({
  body: createReport.mock.calls[call]?.[0],
  attemptId: createReport.mock.calls[call]?.[1],
});

/** Mở hộp thoại của A, soạn (lý do + ghi chú) rồi bấm «Gửi báo cáo». */
function openForAAndSubmit(): void {
  fireEvent.click(reportButton(A_BODY));
  fireEvent.click(screen.getByRole("radio", { name: HARASSMENT }));
  fireEvent.change(noteBox(), { target: { value: DRAFT } });
  fireEvent.click(button(SUBMIT));
}
/** Body 027 của báo cáo mà `openForAAndSubmit` soạn — đích là A. */
const A_REPORT = { targetType: "comment", targetId: A_ID, reason: "harassment", note: DRAFT };

beforeEach(() => {
  setCaps({ "view:feed": true });
  for (const spy of Object.values(handlers)) spy.mockReset();
  createReport.mockReset();
  createReport.mockResolvedValue(CREATED);
});
afterEach(() => {
  cleanup();
  resetCaps();
});

describe("hộp thoại đang mở là MODAL — kích hoạt nút «Báo cáo» của một hàng KHÔNG đổi đích", () => {
  it.each([
    { name: "hàng KHÁC", body: B_BODY },
    { name: "CHÍNH hàng đó", body: A_BODY },
  ])(
    "đang mở cho A (đã gửi hỏng một lần), nút của $name được kích hoạt ⇒ VẪN hộp thoại của A: focus không rời hộp thoại, nháp + dải lỗi còn; gửi lại ⇒ đích A, CÙNG `attemptId`; đóng ⇒ focus về nút của A",
    async ({ body }) => {
      createReport.mockRejectedValueOnce(ADMIN_ERR.server());
      renderList();
      openForAAndSubmit();
      await waitFor(() => expect(alertReason()).toBe("generic"));

      fireEvent.click(reportButton(body));
      expect(dialog()).toContainElement(document.activeElement as HTMLElement);
      expect(noteBox()).toHaveValue(DRAFT);
      expect(alertReason()).toBe("generic");

      fireEvent.click(button(SUBMIT));
      await waitFor(() => expect(createReport).toHaveBeenCalledTimes(2));
      expect(sent(1).body).toEqual(A_REPORT);
      // Cùng lượt mount ⇒ cùng khoá idempotency: gửi lại không tạo báo cáo thứ hai.
      expect(typeof sent(0).attemptId).toBe("string");
      expect(sent(1).attemptId).toBe(sent(0).attemptId);

      fireEvent.click(await screen.findByRole("button", { name: CLOSE }));
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(reportButton(A_BODY)).toHaveFocus();
    },
  );

  it("A đang GỬI (lời gọi còn treo), nút của B được kích hoạt ⇒ kết cục của A vẫn lên màn; đúng MỘT lời gọi, đích A", async () => {
    let finishSend: (value: unknown) => void = () => undefined;
    createReport.mockImplementationOnce(() => new Promise((resolve) => (finishSend = resolve)));
    renderList();
    openForAAndSubmit();
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));

    fireEvent.click(reportButton(B_BODY));
    act(() => finishSend(CREATED));

    expect(await screen.findByRole("status")).toHaveTextContent(SENT);
    expect(createReport).toHaveBeenCalledTimes(1);
    expect(sent(0).body).toEqual(A_REPORT);
  });

  it("ALLOW (cùng khung): hộp thoại của A đã ĐÓNG rồi nút của B mới được kích hoạt ⇒ hộp thoại mở cho B, nháp TRẮNG; gửi ⇒ đích B", async () => {
    renderList();
    fireEvent.click(reportButton(A_BODY));
    fireEvent.change(noteBox(), { target: { value: DRAFT } });
    fireEvent.click(button(CANCEL));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(reportButton(B_BODY));
    expect(noteBox()).toHaveValue("");
    fireEvent.click(screen.getByRole("radio", { name: HARASSMENT }));
    fireEvent.click(button(SUBMIT));
    await waitFor(() => expect(createReport).toHaveBeenCalledTimes(1));

    expect(sent(0).body).toEqual({ targetType: "comment", targetId: B_ID, reason: "harassment" });
    expect(await screen.findByRole("status")).toHaveTextContent(SENT);
  });
});
