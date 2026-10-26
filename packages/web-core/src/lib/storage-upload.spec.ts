/**
 * storage-upload.spec.ts — `putBytesToStorage` (S16-SOCIAL-FE-2D, plan §4 A1 · ca **S1**).
 *
 * Tham số `signal` mới là đường DUY NHẤT để huỷ một lượt PUT tới 20 MB khi người dùng gỡ tệp / rời ô
 * soạn. Ba điều ca này giữ:
 *  1. `signal` tới được `fetch` (không thì «huỷ» chỉ là huỷ trên giấy, bytes vẫn chảy);
 *  2. bốn call-site cũ (không truyền `signal`) gửi `init` y hệt trước đây — không khoá `signal` thừa;
 *  3. huỷ ném lỗi RIÊNG, không lẫn vào câu «lỗi mạng» chung (caller phân biệt được gỡ-tệp với hỏng-mạng).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { putBytesToStorage } from "./storage-upload";

const URL_PUT = "https://storage.invalid/bucket/obj-1";
const pngFile = (): File => new File(["abc"], "a.png", { type: "image/png" });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("S1 — `putBytesToStorage(url, file, contentType, signal?)`", () => {
  it("truyền `signal` ⇒ `fetch` nhận ĐÚNG signal đó; `credentials:'omit'` + Content-Type giữ nguyên", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const ctrl = new AbortController();

    await putBytesToStorage(URL_PUT, pngFile(), "image/png", ctrl.signal);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(ctrl.signal);
    expect(url).toBe(URL_PUT);
    expect(init.method).toBe("PUT");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toEqual({ "Content-Type": "image/png" });
  });

  it("KHÔNG truyền `signal` (call-site cũ) ⇒ `init` KHÔNG có khoá `signal`", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));

    await putBytesToStorage(URL_PUT, pngFile(), "image/png");

    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect("signal" in init).toBe(false);
  });

  it("huỷ GIỮA lượt PUT ⇒ ném lỗi «đã huỷ» RIÊNG, không phải câu lỗi mạng chung", async () => {
    const ctrl = new AbortController();
    // Bám vào CHÍNH controller của ca (không vào `init.signal`) ⇒ code chưa nối signal vẫn thấy lượt
    // PUT bị huỷ, và ca đỏ ở THÔNG ĐIỆP lỗi chứ không treo tới hết giờ.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((_resolve, reject) => {
          ctrl.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const pending = putBytesToStorage(URL_PUT, pngFile(), "image/png", ctrl.signal);
    ctrl.abort();
    const settled = await pending.then(
      () => "resolved",
      (e: unknown) => e,
    );

    expect(() => {
      throw settled;
    }).toThrow(/huỷ/);
  });

  it("đối chứng: lỗi mạng KHÔNG do huỷ ⇒ vẫn câu lỗi mạng chung (không bị đọc thành «đã huỷ»)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    const ctrl = new AbortController();

    await expect(putBytesToStorage(URL_PUT, pngFile(), "image/png", ctrl.signal)).rejects.toThrow(
      /lỗi mạng/,
    );
  });

  it("HTTP lỗi ⇒ ném kèm mã HTTP (không nuốt)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 403 }));
    await expect(putBytesToStorage(URL_PUT, pngFile(), "image/png")).rejects.toThrow(/HTTP 403/);
  });
});
