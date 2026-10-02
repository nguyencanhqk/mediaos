/**
 * S16-SOCIAL-FE-2D — hook `useAttachmentUploads` (plan §4 A4 · ca **U1 · U2**).
 *
 * Hàng đợi TUẦN TỰ, mỗi ô một `AbortController`. Hai luật dễ hỏng âm thầm nhất:
 *  - **U1** `clear(ids)` chỉ gỡ ĐÚNG các tệp đã vào DTO — ô khác (vd tệp đang tải) GIỮ NGUYÊN, không bị
 *    huỷ (lưới thứ hai của hợp đồng «không mất dữ liệu người dùng», plan §3 H2-ii);
 *  - **U2** gỡ một ô CÒN XẾP HÀNG ⇒ nó KHÔNG BAO GIỜ được khởi động (vòng tải đọc lại tập ô sống trước
 *    mỗi lượt) — không thì tệp người dùng đã bỏ vẫn lên storage, thành `Pending` mồ côi.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAttachmentUploads } from "./use-attachment-uploads";

const upload = vi.fn();

vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return { ...actual, uploadSocialAttachment: (...a: unknown[]) => upload(...a) };
});

const FA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const pdf = (name: string): File => new File(["abc"], name, { type: "application/pdf" });
const done = (fileId: string, name: string) => ({
  fileId,
  kind: "file" as const,
  name,
  sizeBytes: 3,
  mimeType: "application/pdf",
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Xả microtask + một vòng macrotask — đủ để vòng tải chạy tiếp sau khi một lượt ngã ngũ. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  upload.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("U1 — `clear(ids)` gỡ ĐÚNG các tệp đã gửi, ô khác giữ nguyên", () => {
  it("A xong (chụp [A]) · thêm B đang tải · clear([A]) ⇒ còn [B], lượt tải của B KHÔNG bị huỷ", async () => {
    let signalB: AbortSignal | undefined;
    const dB = deferred<ReturnType<typeof done>>();
    upload.mockResolvedValueOnce(done(FA, "a.pdf"));
    upload.mockImplementationOnce((_f: File, _t: string, opts?: { signal?: AbortSignal }) => {
      signalB = opts?.signal;
      return dB.promise;
    });
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));

    await act(async () => {
      result.current.add([pdf("a.pdf")]);
      await flush();
    });
    expect(result.current.items).toHaveLength(1);
    await waitFor(() => expect(result.current.submitState).toEqual({ ready: true, ids: [FA] }));
    const state = result.current.submitState;
    const ids = state.ready ? [...state.ids] : [];

    await act(async () => {
      result.current.add([pdf("b.pdf")]);
      await flush();
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));

    act(() => result.current.clear(ids));

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]?.name).toBe("b.pdf");
    expect(signalB?.aborted).toBe(false);
  });
});

describe("U2 — DENY: ô đã gỡ khi CÒN XẾP HÀNG không bao giờ được tải", () => {
  it("A treo + B xếp hàng · gỡ B · A xong ⇒ tải ĐÚNG 1 lần, còn [A done]", async () => {
    const dA = deferred<ReturnType<typeof done>>();
    upload.mockImplementationOnce(() => dA.promise);
    upload.mockResolvedValue(done(FB, "b.pdf"));
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));

    await act(async () => {
      result.current.add([pdf("a.pdf"), pdf("b.pdf")]);
      await flush();
    });
    const idB = result.current.items[1]?.id ?? "";
    act(() => result.current.remove(idB));

    await act(async () => {
      dA.resolve(done(FA, "a.pdf"));
      await flush();
      await flush();
    });

    expect(upload).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(result.current.items.map((i) => [i.name, i.status])).toEqual([["a.pdf", "done"]]),
    );
  });
});

describe("vòng đời một ô", () => {
  it("gỡ ô ĐANG tải ⇒ lượt tải bị huỷ (`signal.aborted`), ô biến mất", async () => {
    let signalA: AbortSignal | undefined;
    upload.mockImplementationOnce((_f: File, _t: string, opts?: { signal?: AbortSignal }) => {
      signalA = opts?.signal;
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useAttachmentUploads({ target: "comment" }));

    await act(async () => {
      result.current.add([pdf("a.pdf")]);
      await flush();
    });
    expect(upload.mock.calls[0]?.[1]).toBe("comment");
    act(() => result.current.remove(result.current.items[0]?.id ?? ""));

    expect(signalA?.aborted).toBe(true);
    expect(result.current.items).toEqual([]);
  });

  it("lỗi ⇒ ô `error`; «Thử lại» ⇒ tải lại đúng tệp đó và xong", async () => {
    upload.mockRejectedValueOnce(new Error("Tải tệp lên storage thất bại (HTTP 500)."));
    upload.mockResolvedValueOnce(done(FA, "a.pdf"));
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));

    await act(async () => {
      result.current.add([pdf("a.pdf")]);
      await flush();
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe("error"));
    expect(result.current.items[0]?.error).toBe("uploadFailed");
    expect(result.current.submitState).toEqual({ ready: false, reason: "hasErrors" });

    await act(async () => {
      result.current.retry(result.current.items[0]?.id ?? "");
      await flush();
    });
    await waitFor(() => expect(result.current.submitState).toEqual({ ready: true, ids: [FA] }));
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("`reset()` huỷ MỌI lượt đang bay và dọn sạch khay + danh sách từ chối", async () => {
    let signalA: AbortSignal | undefined;
    upload.mockImplementationOnce((_f: File, _t: string, opts?: { signal?: AbortSignal }) => {
      signalA = opts?.signal;
      return new Promise(() => {});
    });
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));
    const tooBig = pdf("lon.pdf");
    Object.defineProperty(tooBig, "size", { value: 21 * 1024 * 1024 });

    await act(async () => {
      result.current.add([pdf("a.pdf"), tooBig]);
      await flush();
    });
    expect(result.current.rejections).toEqual([{ name: "lon.pdf", reason: "tooLarge" }]);

    act(() => result.current.reset());

    expect(signalA?.aborted).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(result.current.rejections).toEqual([]);
  });
});
