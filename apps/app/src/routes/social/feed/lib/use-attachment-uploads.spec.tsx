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
import { FEED_MAX_ATTACHMENTS, FEED_MAX_IMAGES_PER_POST } from "@mediaos/contracts";
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

  it("«Thử lại» thành công ⇒ dọn danh sách từ chối cũ (nó nói về lượt trước, không về ô đang tải)", async () => {
    const tooBig = pdf("lon.pdf");
    Object.defineProperty(tooBig, "size", { value: 21 * 1024 * 1024 });
    upload.mockRejectedValueOnce(new Error("Tải tệp lên storage thất bại (HTTP 500)."));
    upload.mockResolvedValueOnce(done(FA, "a.pdf"));
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));

    await act(async () => {
      result.current.add([pdf("a.pdf"), tooBig]);
      await flush();
    });
    await waitFor(() => expect(result.current.items[0]?.status).toBe("error"));
    expect(result.current.rejections).toEqual([{ name: "lon.pdf", reason: "tooLarge" }]);

    await act(async () => {
      result.current.retry(result.current.items[0]?.id ?? "");
      await flush();
    });
    await waitFor(() => expect(result.current.submitState).toEqual({ ready: true, ids: [FA] }));
    expect(result.current.rejections).toEqual([]);
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

/**
 * FULL gate lượt 1 (typescript-reviewer + security-reviewer cùng nêu — G1): ô LỖI không tính vào trần
 * (`planAttachmentAdds`, cố ý — tính nó là chặn oan), nên trong lúc nó nằm lỗi người dùng thêm được tệp vào
 * chỗ trống. «Thử lại» mà đưa ô lỗi về hàng đợi KHÔNG kiểm lại trần ⇒ 12 tệp (Zod `.max(11)` ⇒ 400 VÔ
 * DANH — đo M10) hoặc 11 ảnh (422 `SOCIAL-ERR-007`), lượt gửi nào cũng hỏng mà không ai nói phải gỡ tệp.
 */
describe("G1 — DENY: «Thử lại» KHÔNG đẩy khay vượt trần", () => {
  const fileIdOf = (n: number) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
  const png = (name: string): File => new File(["abc"], name, { type: "image/png" });

  beforeEach(() => {
    // Ảnh ⇒ xem trước bằng blob URL; jsdom KHÔNG có hai hàm này (đo M16).
    URL.createObjectURL = vi.fn(() => "blob:preview") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  });

  /** Ô #1 lỗi TẠM, các ô còn lại xong — trả `id` ô lỗi. */
  async function trayWithFirstFailed(
    result: { current: ReturnType<typeof useAttachmentUploads> },
    files: File[],
  ): Promise<string> {
    let n = 0;
    upload.mockImplementation((file: File) => {
      n += 1;
      if (n === 1) return Promise.reject(new Error("Tải tệp lên storage thất bại (HTTP 500)."));
      return Promise.resolve(done(fileIdOf(n), file.name));
    });
    await act(async () => {
      result.current.add(files);
      await flush();
    });
    await waitFor(() =>
      expect(result.current.items.filter((i) => i.status === "done")).toHaveLength(
        files.length - 1,
      ),
    );
    const failed = result.current.items[0];
    expect(failed?.status).toBe("error");
    expect(failed?.error).toBe("uploadFailed");
    return failed?.id ?? "";
  }

  it("11 tệp, #1 lỗi · thêm 1 tệp vào chỗ trống · «Thử lại» #1 ⇒ KHÔNG tải, #1 GIỮ lỗi, báo `tooManyFiles`", async () => {
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));
    const failedId = await trayWithFirstFailed(
      result,
      Array.from({ length: FEED_MAX_ATTACHMENTS }, (_, i) => pdf(`d${i}.pdf`)),
    );

    // Ô lỗi KHÔNG tính vào trần ⇒ tệp thay chỗ được nhận (thiết kế — không chặn oan).
    await act(async () => {
      result.current.add([pdf("thay.pdf")]);
      await flush();
    });
    await waitFor(() =>
      expect(result.current.items.filter((i) => i.status === "done")).toHaveLength(
        FEED_MAX_ATTACHMENTS,
      ),
    );
    upload.mockClear();

    await act(async () => {
      result.current.retry(failedId);
      await flush();
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.current.items.find((i) => i.id === failedId)?.status).toBe("error");
    expect(result.current.rejections).toEqual([{ name: "d0.pdf", reason: "tooManyFiles" }]);
    expect(result.current.submitState).toEqual({ ready: false, reason: "hasErrors" });
  });

  it("10 ảnh, #1 lỗi · thêm 1 ảnh · «Thử lại» #1 ⇒ KHÔNG tải, báo `tooManyImages`", async () => {
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));
    const failedId = await trayWithFirstFailed(
      result,
      Array.from({ length: FEED_MAX_IMAGES_PER_POST }, (_, i) => png(`a${i}.png`)),
    );
    await act(async () => {
      result.current.add([png("thay.png")]);
      await flush();
    });
    await waitFor(() =>
      expect(result.current.items.filter((i) => i.status === "done")).toHaveLength(
        FEED_MAX_IMAGES_PER_POST,
      ),
    );
    upload.mockClear();

    await act(async () => {
      result.current.retry(failedId);
      await flush();
    });

    expect(upload).not.toHaveBeenCalled();
    expect(result.current.rejections).toEqual([{ name: "a0.png", reason: "tooManyImages" }]);
  });

  it("đối chứng ALLOW: trần CÒN chỗ (11 tệp, #1 lỗi, không thêm gì) ⇒ «Thử lại» tải lại, đủ 11 id đúng THỨ TỰ CHỌN", async () => {
    const { result } = renderHook(() => useAttachmentUploads({ target: "post" }));
    const failedId = await trayWithFirstFailed(
      result,
      Array.from({ length: FEED_MAX_ATTACHMENTS }, (_, i) => pdf(`d${i}.pdf`)),
    );
    upload.mockClear();
    upload.mockResolvedValueOnce(done(fileIdOf(99), "d0.pdf"));

    await act(async () => {
      result.current.retry(failedId);
      await flush();
    });

    expect(upload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current.submitState.ready).toBe(true));
    const state = result.current.submitState;
    expect(state.ready ? state.ids : []).toEqual([
      fileIdOf(99),
      ...Array.from({ length: FEED_MAX_ATTACHMENTS - 1 }, (_, i) => fileIdOf(i + 2)),
    ]);
  });
});
