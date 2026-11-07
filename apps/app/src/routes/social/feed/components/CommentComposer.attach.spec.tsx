/**
 * S16-SOCIAL-FE-2D — đính kèm trên `CommentComposer` (plan §4 A7 · ca **K1c · K2c · K3c**).
 *
 *  - **K1c** target `comment` (054/055 hỏi `create:feed-comment`); có tệp mà body rỗng ⇒ vẫn KHOÁ — server
 *    KHÔNG nhận bình luận chỉ có tệp (đo M11); payload mang `attachmentIds`.
 *  - **K2c** khay KHOÁ suốt lượt gửi (cùng lớp F8 — §10 #1).
 *  - **K3c** bài bị KHOÁ bình luận giữa chừng (D10, owner ký (a)): huỷ lượt tải đang bay + dọn khay, GIỮ
 *    chữ — không tải ngầm cho thứ không gửi được.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { createFeedCommentSchema } from "@mediaos/contracts";
import i18n from "@/i18n";
import { resetCaps, setCaps } from "../social-test-doubles";
import { CommentComposer } from "./CommentComposer";

const upload = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, uploadSocialAttachment: (...a: unknown[]) => upload(...a) };
});

const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const pdf = (name = "d.pdf") => new File(["abc"], name, { type: "application/pdf" });
const doneOf = (fileId: string, name: string) => ({
  fileId,
  kind: "file",
  name,
  sizeBytes: 3,
  mimeType: "application/pdf",
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type Props = React.ComponentProps<typeof CommentComposer>;
const ui = (props: Partial<Props>) => (
  <I18nextProvider i18n={i18n}>
    <CommentComposer onSubmit={vi.fn()} isSubmitting={false} {...props} />
  </I18nextProvider>
);

const attachInput = () => screen.getByTestId("comment-attach-input") as HTMLInputElement;
const pick = (...files: File[]) => fireEvent.change(attachInput(), { target: { files } });
const trayItems = () => screen.queryAllByTestId("comment-attach-item");
const submitBtn = () => screen.getByTestId("comment-submit");

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-comment": true });
  upload.mockReset();
  upload.mockImplementation((file: File) => Promise.resolve(doneOf(F1, file.name)));
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("K1c — bình luận kèm tệp", () => {
  it("target `comment`; có tệp mà body rỗng ⇒ KHOÁ (M11); có body ⇒ payload `attachmentIds` qua schema", async () => {
    const onSubmit = vi.fn((_dto: unknown) => Promise.resolve({ ok: true }));
    render(ui({ onSubmit }));
    pick(pdf("mot.pdf"));

    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));
    expect(upload.mock.calls[0]?.[1]).toBe("comment");
    expect(submitBtn()).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "xem tệp" } });
    expect(submitBtn()).not.toBeDisabled();
    fireEvent.click(submitBtn());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(dto.attachmentIds).toEqual([F1]);
    expect(createFeedCommentSchema.safeParse(dto).success).toBe(true);
  });
});

describe("K2c — DENY: khay KHOÁ suốt lượt gửi bình luận", () => {
  it("đang gửi ⇒ nút + input `disabled`; `change` lén KHÔNG tải thêm; resolve ⇒ khay rỗng", async () => {
    const sending = deferred<unknown>();
    const onSubmit = vi.fn(() => sending.promise);
    render(ui({ onSubmit }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "một tệp" } });
    pick(pdf("mot.pdf"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));

    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("comment-attach-button")).toBeDisabled();
    expect(attachInput()).toBeDisabled();
    upload.mockClear();
    pick(pdf("lan.pdf"));
    expect(upload).not.toHaveBeenCalled();

    await act(async () => sending.resolve({ ok: true }));
    await waitFor(() => expect(trayItems()).toHaveLength(0));
  });
});

describe("K3c — DENY (D10): bài bị KHOÁ bình luận giữa lượt tải", () => {
  it("`locked` lật ⇒ huỷ lượt tải đang bay; mở lại ⇒ khay RỖNG nhưng chữ đã gõ VẪN CÒN", async () => {
    let signal: AbortSignal | undefined;
    upload.mockImplementationOnce((_f: File, _t: string, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => {});
    });
    const { rerender } = render(ui({}));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "đang soạn dở" } });
    pick(pdf());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    rerender(ui({ locked: true }));
    expect(screen.getByTestId("comment-locked")).toBeInTheDocument();
    expect(signal?.aborted).toBe(true);

    rerender(ui({ locked: false }));
    expect(trayItems()).toHaveLength(0);
    expect(screen.getByRole("textbox")).toHaveValue("đang soạn dở");
  });

  it("mất quyền `create:feed-comment` giữa chừng ⇒ cũng huỷ lượt tải đang bay", async () => {
    let signal: AbortSignal | undefined;
    upload.mockImplementationOnce((_f: File, _t: string, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => {});
    });
    render(ui({}));
    pick(pdf());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    act(() => setCaps({ "view:feed": true }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.queryByTestId("comment-composer")).toBeNull();
  });
});

/**
 * Nút gửi khoá vì ô chữ trống trong khi tệp ĐÃ tải xong ⇒ một dòng nói lý do cạnh nút. Mỗi lúc MỘT lý do:
 * còn tệp đang tải / lỗi thì khay nói, dòng này im. Câu kỳ vọng VIẾT TAY (khoá i18n thiếu thì i18next trả
 * chính tên khoá — phải đỏ ở đây).
 */
describe("lý do nút gửi khoá khi đã có tệp mà CHƯA có chữ", () => {
  const NEEDS_BODY = "Hãy nhập nội dung — bình luận chỉ có tệp thì chưa gửi được.";
  const TRAY_UPLOADING = "Đang tải tệp lên — chờ xong rồi gửi.";
  const TRAY_HAS_ERRORS = "Có tệp tải lỗi — gỡ hoặc thử lại trước khi gửi.";
  const composer = () => screen.getByTestId("comment-composer");

  it("tệp tải xong + chữ trống ⇒ thấy câu lý do (vùng `status`, không phải `alert`); gõ chữ ⇒ câu mất", async () => {
    render(ui({}));
    pick(pdf("mot.pdf"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));

    expect(composer()).toHaveTextContent(NEEDS_BODY);
    expect(screen.getByText(NEEDS_BODY)).toHaveAttribute("role", "status");
    expect(within(composer()).queryByRole("alert")).toBeNull();
    expect(submitBtn()).toBeDisabled();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "xem tệp" } });
    expect(composer()).not.toHaveTextContent(NEEDS_BODY);
    expect(submitBtn()).not.toBeDisabled();

    // Chỉ khoảng trắng vẫn là «chưa có chữ».
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    expect(composer()).toHaveTextContent(NEEDS_BODY);
  });

  it("DENY: tệp CÒN đang tải + chữ trống ⇒ khay nói lý do, câu «nhập nội dung» KHÔNG hiện", async () => {
    upload.mockImplementationOnce(() => new Promise(() => {}));
    render(ui({}));
    pick(pdf("mot.pdf"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("uploading"));

    expect(composer()).toHaveTextContent(TRAY_UPLOADING);
    expect(composer()).not.toHaveTextContent(NEEDS_BODY);
  });

  it("DENY: tệp tải LỖI + chữ trống ⇒ khay nói lý do, câu «nhập nội dung» KHÔNG hiện", async () => {
    upload.mockRejectedValueOnce(new Error("Tải tệp lên storage thất bại (HTTP 500)."));
    render(ui({}));
    pick(pdf("mot.pdf"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("error"));

    expect(composer()).toHaveTextContent(TRAY_HAS_ERRORS);
    expect(composer()).not.toHaveTextContent(NEEDS_BODY);
  });

  it("DENY: KHÔNG có tệp + chữ trống + chưa chạm ⇒ không có câu nào (như trước)", () => {
    render(ui({}));

    expect(trayItems()).toHaveLength(0);
    expect(composer()).not.toHaveTextContent(NEEDS_BODY);
    expect(submitBtn()).toBeDisabled();
  });
});

/** FULL gate lượt 1 (typescript-reviewer LOW — G5a): tên khay theo ĐÚNG ô soạn. */
describe("G5a — khay của ô BÌNH LUẬN không tự xưng là «bài đang soạn»", () => {
  it("danh sách tệp của ô bình luận có tên nói «bình luận»", async () => {
    render(ui({}));
    pick(pdf("mot.pdf"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));

    const list = within(screen.getByTestId("comment-attach-tray")).getByRole("list");
    expect(list.getAttribute("aria-label")).toMatch(/bình luận/);
  });
});
