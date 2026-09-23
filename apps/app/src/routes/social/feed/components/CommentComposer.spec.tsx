/**
 * S16-SOCIAL-FE-1 — lỗi **H2** trên `CommentComposer`: ô soạn KHÔNG được dọn nội dung trước khi
 * biết kết quả.
 *
 * ┌─ VÌ SAO LÀ MỘT FILE RIÊNG, KHÔNG THÊM VÀO `CommentList.spec.tsx` ────────────────────────────┐
 * │ `CommentList.spec.tsx` đã giữ vế CỔNG QUYỀN + TRẦN ĐỘ DÀI của ô soạn và đang được sửa ở một   │
 * │ phiên khác. Hai luật khác nhau, hai file — và file này đặt cạnh component nó đo (bắt buộc:     │
 * │ `include` của vitest là `src/**\/*.spec.{ts,tsx}` colocated).                                  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Ca đắt nhất: gõ một bình luận dài → bấm gửi → server hỏng → **chữ phải còn nguyên**. Chuỗi
 * `actionError.generic.comment` hứa đúng câu đó; dọn sớm biến nó thành lời nói dối.
 */
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { useAuthStore } from "@mediaos/web-core";
import i18n from "@/i18n";
import { CommentComposer } from "./CommentComposer";

function setCaps(caps: Record<string, boolean>): void {
  useAuthStore.setState({
    isAuthenticated: true,
    capabilities: caps,
    user: { id: "u1", email: "t@demo.local", fullName: "T", status: "Active", companyId: "co1" },
  });
}

function renderComposer(props: Partial<React.ComponentProps<typeof CommentComposer>> = {}) {
  const onSubmit = props.onSubmit ?? vi.fn();
  return render(
    <I18nextProvider i18n={i18n}>
      <CommentComposer onSubmit={onSubmit} isSubmitting={props.isSubmitting ?? false} {...props} />
    </I18nextProvider>,
  );
}

const send = (draft: string): void => {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: draft } });
  fireEvent.click(screen.getByTestId("comment-submit"));
};

/**
 * Chờ lượt gửi SETTLE rồi mới đo — đo sớm thì ca XANH GIẢ kể cả khi ô soạn bị dọn ở nhánh lỗi.
 *
 * ⚠️ Mốc chờ là **nhãn nút**, KHÔNG phải `not.toBeDisabled()`: nếu ai đó trả lại lỗi dọn-sớm thì ô
 * rỗng ⇒ nút disabled vĩnh viễn ⇒ ca đỏ vì hết giờ chờ NÚT, và thông báo lỗi không hề nói rằng chữ
 * của người dùng đã bay mất (memory `mutant-red-must-match-expected-message`).
 */
const waitForSettled = async (): Promise<void> => {
  const t = i18n.getFixedT("vi", "social");
  await waitFor(() =>
    expect(screen.getByTestId("comment-submit")).not.toHaveTextContent(t("comment.submitting")),
  );
};

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-comment": true });
});

afterEach(() => {
  cleanup();
  useAuthStore.setState({ isAuthenticated: false, capabilities: {}, user: null });
  vi.clearAllMocks();
});

describe("🔴 H2 — ô soạn bình luận giữ chữ tới khi server xác nhận", () => {
  const LONG_DRAFT = "y".repeat(1200);

  it("gửi HỎNG ⇒ nội dung VẪN CÒN nguyên trong ô soạn", async () => {
    const onSubmit = vi.fn(() => Promise.reject(new Error("mạng rớt")));
    renderComposer({ onSubmit });
    send(LONG_DRAFT);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitForSettled();
    expect(screen.getByRole("textbox")).toHaveValue(LONG_DRAFT);
  });

  it("gửi THÀNH CÔNG ⇒ ô soạn rỗng", async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    send("chào bạn");

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  });

  it("🔴 gửi HỎNG ⇒ GIỮ nguyên đích trả lời (không tụt xuống bình luận cấp 1)", async () => {
    /**
     * `onCancelReply` chạy sớm là một lỗi thầm lặng khác: đích trả lời bị gỡ trong khi bình luận
     * chưa gửi được, nên lượt bấm lại gửi đi `parentCommentId: null` — bình luận rơi xuống cấp 1,
     * không ai báo gì, và người viết tưởng mình đã trả lời đúng chỗ.
     */
    // Khai kiểu tham số để đọc được `mock.calls[0][0]` — `vi.fn(() => …)` cho tuple tham số RỖNG.
    const onSubmit = vi.fn((_dto: unknown) => Promise.reject(new Error("500")));
    const onCancelReply = vi.fn();
    renderComposer({
      onSubmit,
      onCancelReply,
      replyTo: { commentId: "c1", authorName: "An" },
    });
    send("trả lời đây");

    await waitForSettled();
    expect(onCancelReply).not.toHaveBeenCalled();
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ parentCommentId: "c1" });
  });

  it("gửi THÀNH CÔNG ⇒ mới gỡ đích trả lời", async () => {
    const onSubmit = vi.fn(() => Promise.resolve({ ok: true }));
    const onCancelReply = vi.fn();
    renderComposer({
      onSubmit,
      onCancelReply,
      replyTo: { commentId: "c1", authorName: "An" },
    });
    send("trả lời đây");

    await waitFor(() => expect(onCancelReply).toHaveBeenCalledTimes(1));
  });

  it("đang bay ⇒ nút KHOÁ, bấm lần hai không gọi thêm", () => {
    const onSubmit = vi.fn(() => new Promise<void>(() => {}));
    renderComposer({ onSubmit });
    send("chào bạn");

    expect(screen.getByTestId("comment-submit")).toBeDisabled();
    fireEvent.click(screen.getByTestId("comment-submit"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("caller trả `void` ⇒ KHÔNG đoán mò: giữ nguyên nội dung", () => {
    const onSubmit = vi.fn();
    renderComposer({ onSubmit });
    send("chào bạn");

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("textbox")).toHaveValue("chào bạn");
  });
});
