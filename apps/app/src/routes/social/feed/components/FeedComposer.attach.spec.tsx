/**
 * S16-SOCIAL-FE-2D — đính kèm trên `FeedComposer` (plan §4 A5/A6 · ca **F1–F8**).
 *
 * Tách file khỏi `FeedComposer.spec.tsx` (khuôn `MessageComposer.attach.spec.tsx`): ca này mock
 * `uploadSocialAttachment` + `URL.createObjectURL` (jsdom KHÔNG có — đo M16) cho cả file.
 *
 * Ba lời hứa ca này giữ:
 *  1. Trần client chặn TRƯỚC khi tải (F1/F2) — tệp bị từ chối KHÔNG lên storage;
 *  2. Không gửi khi còn tệp đang tải/lỗi (F3/F4); payload `attachmentIds` theo thứ tự CHỌN, VẮNG khi rỗng;
 *  3. Không mất dữ liệu (F5/F8): reject ⇒ khay giữ nguyên; khay KHOÁ suốt lượt gửi — handler `onChange`
 *     tự kiểm `disabled` vì `fireEvent.change` trên input `disabled` VẪN chạy `onChange` (đo M23).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FEED_MAX_ATTACHMENT_BYTES,
  FEED_MAX_IMAGES_PER_POST,
  FOUNDATION_FILE_ERROR_CODES,
  SOCIAL_ERROR_CODES,
  createFeedPostSchema,
  type CreateFeedPostDto,
} from "@mediaos/contracts";
import { ApiError } from "@mediaos/web-core";
import i18n from "@/i18n";
import { renderWithProviders, resetCaps, setCaps } from "../social-test-doubles";
import { FeedComposer } from "./FeedComposer";

const upload = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    uploadSocialAttachment: (...a: unknown[]) => upload(...a),
    socialKudosApi: {
      ...actual.socialKudosApi,
      listBadges: () => Promise.resolve({ data: [], page: 1, limit: 100, total: 0 }),
    },
  };
});

const t = i18n.getFixedT("vi", "social");
const F1 = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const F2 = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const MAX_MB = `${FEED_MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB`;

function fileOf(name: string, type: string, size = 3): File {
  const f = new File(["abc"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}
const image = (name = "a.png", size = 3) => fileOf(name, "image/png", size);
const pdf = (name = "d.pdf") => fileOf(name, "application/pdf");

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const doneOf = (fileId: string, file: File) => ({
  fileId,
  kind: file.type.startsWith("image/") ? "image" : "file",
  name: file.name,
  sizeBytes: file.size,
  mimeType: file.type,
});

let createdUrls: string[] = [];
let revoked: string[] = [];

/** `onSubmit` trả về là spy MẶC ĐỊNH (resolve) — ca tự truyền `onSubmit` thì đọc spy của chính nó. */
function renderComposer(props: Partial<React.ComponentProps<typeof FeedComposer>> = {}) {
  const onSubmit = vi.fn((_dto: CreateFeedPostDto) => Promise.resolve({ ok: true }));
  const view = renderWithProviders(
    <FeedComposer onSubmit={onSubmit} isSubmitting={false} {...props} />,
  );
  return { ...view, onSubmit };
}

const attachInput = () => screen.getByTestId("composer-attach-input") as HTMLInputElement;
const pick = (...files: File[]) => fireEvent.change(attachInput(), { target: { files } });
const trayItems = () => screen.queryAllByTestId("composer-attach-item");
const submitBtn = () => screen.getByTestId("composer-submit");
const typeBody = (text: string) =>
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });

beforeEach(() => {
  setCaps({ "view:feed": true, "create:feed-post": true });
  createdUrls = [];
  revoked = [];
  // jsdom KHÔNG có hai hàm này (M16). Gán mới mỗi ca (không `mockRestore` — xoá luôn `mock.calls`).
  URL.createObjectURL = vi.fn((_blob: Blob) => {
    const url = `blob:preview-${createdUrls.length}`;
    createdUrls.push(url);
    return url;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  }) as unknown as typeof URL.revokeObjectURL;
  upload.mockReset();
  let n = 0;
  upload.mockImplementation((file: File) => {
    n += 1;
    return Promise.resolve(
      doneOf(`${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`, file),
    );
  });
});

afterEach(() => {
  cleanup();
  resetCaps();
  vi.clearAllMocks();
});

describe("F1/F2 — trần client chặn TRƯỚC khi tải", () => {
  it("F1 DENY: tệp `20MB + 1` ⇒ KHÔNG tải, alert nói rõ tên + trần", () => {
    renderComposer();
    pick(image("lon.png", FEED_MAX_ATTACHMENT_BYTES + 1));

    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByTestId("composer-attach-error")).toHaveTextContent(
      t("attachment.reject.tooLarge", { name: "lon.png", max: MAX_MB }),
    );
    expect(trayItems()).toHaveLength(0);
  });

  it("F2: chọn 11 ảnh ⇒ tải ĐÚNG 10 (target `post`), 1 dòng từ chối `tooManyImages`", async () => {
    renderComposer();
    pick(...Array.from({ length: 11 }, (_, i) => image(`a${i}.png`)));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(FEED_MAX_IMAGES_PER_POST));
    expect(upload.mock.calls.every((c) => c[1] === "post")).toBe(true);
    const alert = screen.getByTestId("composer-attach-error");
    expect(within(alert).getAllByRole("listitem")).toHaveLength(1);
    expect(alert).toHaveTextContent(
      t("attachment.reject.tooManyImages", { name: "a10.png", max: FEED_MAX_IMAGES_PER_POST }),
    );
  });
});

describe("F3/F4 — không gửi khi còn tệp lỗi / đang tải", () => {
  it("F3 DENY: 054 403 FILE-TARGET-POST-DENIED ⇒ ô nói `attachDenied`, nút Đăng KHOÁ; gỡ ô ⇒ mở", async () => {
    upload.mockRejectedValueOnce(
      new ApiError(403, SOCIAL_ERROR_CODES.FILE_TARGET_POST_DENIED, "không có quyền đính kèm"),
    );
    renderComposer();
    typeBody("bài có ảnh");
    pick(image());

    const item = await screen.findByText(t("attachment.error.attachDenied"));
    expect(submitBtn()).toBeDisabled();

    fireEvent.click(
      within(item.closest('[data-testid="composer-attach-item"]') as HTMLElement).getByTestId(
        "composer-attach-remove",
      ),
    );
    expect(trayItems()).toHaveLength(0);
    expect(submitBtn()).not.toBeDisabled();
  });

  it("lỗi TẠM (PUT/mạng) ⇒ ô có «Thử lại»; bấm ⇒ tải lại đúng tệp đó, xong thì mở nút Đăng", async () => {
    upload.mockRejectedValueOnce(new Error("Tải tệp lên storage thất bại (HTTP 500)."));
    renderComposer();
    typeBody("thử lại");
    pick(pdf("tam.pdf"));

    expect(await screen.findByText(t("attachment.error.uploadFailed"))).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
    expect(screen.getByTestId("composer-attach-blocked")).toHaveTextContent(
      t("attachment.blocked.hasErrors"),
    );

    fireEvent.click(screen.getByTestId("composer-attach-retry"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[1]?.[0]).toBe(upload.mock.calls[0]?.[0]);
    expect(submitBtn()).not.toBeDisabled();
  });

  it("lỗi CỐ ĐỊNH (415/403) ⇒ KHÔNG mời «Thử lại» (thử lại vẫn hỏng)", async () => {
    upload.mockRejectedValueOnce(new ApiError(415, FOUNDATION_FILE_ERROR_CODES.MIME, "x"));
    renderComposer();
    pick(pdf());

    await screen.findByText(t("attachment.error.unsupportedType"));
    expect(screen.queryByTestId("composer-attach-retry")).toBeNull();
  });

  it("nút «Đính kèm» mở hộp chọn tệp (bấm input ẩn)", () => {
    renderComposer();
    const clickSpy = vi.spyOn(attachInput(), "click").mockImplementation(() => undefined);
    fireEvent.click(screen.getByTestId("composer-attach-button"));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("F3: 054 415 MIME ⇒ ô nói `unsupportedType` (lý do đọc từ `ApiError.code`)", async () => {
    upload.mockRejectedValueOnce(new ApiError(415, FOUNDATION_FILE_ERROR_CODES.MIME, "x"));
    renderComposer();
    pick(pdf());

    expect(await screen.findByText(t("attachment.error.unsupportedType"))).toBeInTheDocument();
  });

  it("F4: đang tải ⇒ nút Đăng KHOÁ; xong ⇒ payload `attachmentIds` đúng THỨ TỰ CHỌN, qua schema", async () => {
    const d1 = deferred<ReturnType<typeof doneOf>>();
    const d2 = deferred<ReturnType<typeof doneOf>>();
    upload.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise);
    const { onSubmit } = renderComposer();
    typeBody("hai tệp");
    pick(pdf("mot.pdf"), pdf("hai.pdf"));

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(submitBtn()).toBeDisabled();
    await act(async () => d1.resolve(doneOf(F1, pdf("mot.pdf"))));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(submitBtn()).toBeDisabled();
    await act(async () => d2.resolve(doneOf(F2, pdf("hai.pdf"))));
    await waitFor(() => expect(submitBtn()).not.toBeDisabled());

    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(dto.attachmentIds).toEqual([F1, F2]);
    expect(createFeedPostSchema.safeParse(dto).success).toBe(true);
  });

  it("F4: KHÔNG tệp ⇒ payload KHÔNG có khoá `attachmentIds` (khoá idempotency như hôm nay)", async () => {
    const { onSubmit } = renderComposer();
    typeBody("không tệp");
    fireEvent.click(submitBtn());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const dto = (onSubmit.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect("attachmentIds" in dto).toBe(false);
  });
});

describe("F5/F6 — không mất dữ liệu, không rò blob URL, không tải ngầm", () => {
  it("F5: gửi REJECT ⇒ khay giữ nguyên; gửi RESOLVE ⇒ khay rỗng + thu hồi ĐÚNG blob URL", async () => {
    const onSubmit = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error("mạng rớt")))
      .mockImplementationOnce(() => Promise.resolve({ ok: true }));
    renderComposer({ onSubmit });
    typeBody("ảnh đẹp");
    pick(image("dep.png"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));
    expect(createdUrls).toEqual(["blob:preview-0"]);

    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(submitBtn()).not.toBeDisabled());
    expect(trayItems()).toHaveLength(1);
    expect(revoked).toEqual([]);

    fireEvent.click(submitBtn());
    await waitFor(() => expect(trayItems()).toHaveLength(0));
    expect(revoked).toEqual(["blob:preview-0"]);
  });

  it("F6: tháo ô soạn khi đang tải ⇒ lượt tải bị huỷ (`signal.aborted`)", async () => {
    let signal: AbortSignal | undefined;
    upload.mockImplementationOnce((_f: File, _t: string, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => {});
    });
    const { unmount } = renderComposer();
    pick(pdf());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it("D10: mất `create:feed-post` giữa lượt tải ⇒ huỷ lượt đang bay (ô soạn ẩn, không tải ngầm)", async () => {
    let signal: AbortSignal | undefined;
    upload.mockImplementationOnce((_f: File, _t: string, opts?: { signal?: AbortSignal }) => {
      signal = opts?.signal;
      return new Promise(() => {});
    });
    renderComposer();
    pick(pdf());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));

    act(() => setCaps({ "view:feed": true }));

    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.queryByTestId("feed-composer")).toBeNull();
  });
});

describe("F7 + D5 — nút đính kèm ở MỌI loại bài, cả composer nhóm", () => {
  it("F7: composer NHÓM (`groupId`) có nút đính kèm, target `post`", async () => {
    renderComposer({ groupId: "11111111-1111-4111-8111-111111111111" });
    expect(screen.getByTestId("composer-attach-button")).toBeInTheDocument();
    pick(pdf());
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(upload.mock.calls[0]?.[1]).toBe("post");
  });

  it("D5: cả 5 loại bài (share · news · poll · idea · kudos) đều có nút đính kèm", () => {
    setCaps({
      "view:feed": true,
      "create:feed-post": true,
      "manage:feed-news": true,
      "create:feed-poll": true,
      "create:feed-idea": true,
      "create:feed-kudos": true,
    });
    renderComposer();
    for (const type of ["share", "news", "poll", "idea", "kudos"]) {
      fireEvent.click(screen.getByTestId(`composer-type-${type}`));
      expect(screen.getByTestId("composer-attach-button")).toBeInTheDocument();
    }
  });
});

describe("F8 — DENY (plan §10 #1): khay KHOÁ suốt lượt gửi", () => {
  it("đang gửi ⇒ nút + input đính kèm `disabled`; `change` lén vẫn KHÔNG tải thêm; resolve ⇒ khay rỗng", async () => {
    const sending = deferred<unknown>();
    const onSubmit = vi.fn(() => sending.promise);
    renderComposer({ onSubmit });
    typeBody("một tệp");
    pick(pdf("mot.pdf"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));

    fireEvent.click(submitBtn());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("composer-attach-button")).toBeDisabled();
    expect(attachInput()).toBeDisabled();
    upload.mockClear();
    pick(pdf("lan.pdf"));
    expect(upload).not.toHaveBeenCalled();

    await act(async () => sending.resolve({ ok: true }));
    await waitFor(() => expect(trayItems()).toHaveLength(0));
  });
});

/** FULL gate lượt 1 (typescript-reviewer LOW — G5): khay đọc được bằng trình đọc màn hình. */
describe("G5 — a11y khay đính kèm (ô soạn bài)", () => {
  it("G5a đối chứng: danh sách tệp của ô soạn BÀI có tên nói «bài»", async () => {
    renderComposer();
    pick(pdf("mot.pdf"));
    await waitFor(() => expect(trayItems()[0]?.getAttribute("data-status")).toBe("done"));

    const list = within(screen.getByTestId("composer-attach-tray")).getByRole("list");
    expect(list.getAttribute("aria-label")).toMatch(/bài/);
  });

  it("G5b: nút «Thử lại» mang TÊN TỆP trong tên truy cập (ba ô lỗi ≠ ba nút giống hệt)", async () => {
    upload.mockRejectedValueOnce(new Error("Tải tệp lên storage thất bại (HTTP 500)."));
    renderComposer();
    pick(pdf("tam.pdf"));
    await screen.findByText(t("attachment.error.uploadFailed"));

    const retry = screen.getByTestId("composer-attach-retry");
    expect(retry).toHaveAccessibleName(/tam\.pdf/);
    expect(retry).toHaveTextContent(t("attachment.retry"));
  });

  it("G5d: vùng `role=status` có SẴN trước lượt tải đầu — lần đổi chữ ĐẦU được đọc, cùng một node", async () => {
    const d1 = deferred<ReturnType<typeof doneOf>>();
    upload.mockImplementationOnce(() => d1.promise);
    renderComposer();
    const tray = () => screen.getByTestId("composer-attach-tray");
    const status = within(tray()).getByRole("status");
    expect(status).toBeEmptyDOMElement();

    pick(pdf("mot.pdf"));
    await waitFor(() => expect(status).toHaveTextContent(t("attachment.blocked.uploading")));
    expect(within(tray()).getByRole("status")).toBe(status);

    await act(async () => d1.resolve(doneOf(F1, pdf("mot.pdf"))));
    await waitFor(() => expect(status).toBeEmptyDOMElement());
  });
});
