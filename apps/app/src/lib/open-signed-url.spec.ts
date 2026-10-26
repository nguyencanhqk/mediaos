/**
 * S16-SOCIAL-FILEOPENUX-1 (H-1…H-10) — helper chung `openSignedUrlInNewTab`.
 *
 * N9: tệp mà SERVER ký dạng `attachment` (tham số `response-content-disposition` trong URL) làm tab mở trước
 * đứng lại ở `about:blank`. Hành vi đích: tab trắng vẫn mở ĐỒNG BỘ trong click (để tệp `inline` không bị chặn
 * popup); khi URL về mà là `attachment` ⇒ đóng tab đó và tải trên tab app (trình duyệt tải xuống, trang đứng
 * yên). `inline`/không rõ ⇒ như cũ. F1 của S19-FE-SIGNEDTAB-1: popup bị chặn + `inline`/không rõ ⇒ chỉ điều
 * hướng tab app khi lượt bấm còn hiện hành (`isCurrent`).
 *
 * URL thử ghép từ `URLSearchParams` — không host thật, không chữ ký thật.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { openSignedUrlInNewTab } from "./open-signed-url";

const PARAM = "response-content-disposition";

function signedUrl(disposition: string | null): string {
  const query = new URLSearchParams({ "X-Amz-Expires": "300" });
  if (disposition !== null) query.set(PARAM, disposition);
  return `https://storage.example.test/co/obj?${query.toString()}`;
}

const ATTACHMENT = signedUrl(`attachment; filename="phieu-luong.pdf"`);
const INLINE = signedUrl("inline");
const PLAIN = signedUrl(null);

interface FakeTab {
  opener: unknown;
  location: { href: string };
  close: ReturnType<typeof vi.fn>;
}

let tab: FakeTab;
let open: MockInstance<typeof window.open>;
let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  tab = { opener: {}, location: { href: "" }, close: vi.fn() };
  open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  assign = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({ assign } as unknown as Location);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function popupBlocked(): void {
  open.mockReturnValue(null);
}

/** Giữ kết quả lời gọi (giá trị hoặc lỗi) để khẳng định SAU — ca đỏ thì đỏ ở khẳng định, không ở `await`. */
async function settle(p: Promise<boolean>): Promise<boolean | Error> {
  return p.then(
    (v) => v,
    (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
  );
}

describe("openSignedUrlInNewTab — server ký `attachment` ⇒ không để lại tab trắng (N9)", () => {
  it("H-1 [RED] URL `attachment`, có tab ⇒ đóng tab 1 lần, KHÔNG gán href cho tab, tải trên tab app, trả true", async () => {
    const outcome = await settle(openSignedUrlInNewTab(async () => ATTACHMENT));

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(tab.location.href).toBe("");
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(new URL(ATTACHMENT).href);
    expect(outcome).toBe(true);
  });

  it("H-2 [allow ⇄ H-1] URL `inline` ⇒ gán href cho tab mới, không đóng, không đụng tab app", async () => {
    const outcome = await settle(openSignedUrlInNewTab(async () => INLINE));

    expect(tab.location.href).toBe(new URL(INLINE).href);
    expect(tab.close).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(outcome).toBe(true);
  });

  it("H-3 [allow, D3] URL KHÔNG có tham số ⇒ như `inline` (không coi là attachment)", async () => {
    const outcome = await settle(openSignedUrlInNewTab(async () => PLAIN));

    expect(tab.location.href).toBe(new URL(PLAIN).href);
    expect(tab.close).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(outcome).toBe(true);
  });

  it("H-4 [nhịp click] `window.open` chạy NGAY khi gọi, trước khi resolver xong", async () => {
    let release!: (url: string) => void;
    const pending = openSignedUrlInNewTab(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();

    release(INLINE);
    await pending;
  });

  it("H-5 [allow] popup bị chặn + `attachment` ⇒ tải trên tab app 1 lần", async () => {
    popupBlocked();
    const outcome = await settle(openSignedUrlInNewTab(async () => ATTACHMENT));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(new URL(ATTACHMENT).href);
    expect(outcome).toBe(true);
  });
});

describe("openSignedUrlInNewTab — lượt bấm còn hiện hành (F1, `isCurrent`)", () => {
  it("H-6 [RED] popup bị chặn + `inline` + isCurrent → false ⇒ KHÔNG điều hướng tab app, trả false", async () => {
    popupBlocked();
    const outcome = await settle(
      openSignedUrlInNewTab(async () => INLINE, { isCurrent: () => false }),
    );

    expect(assign).not.toHaveBeenCalled();
    expect(outcome).toBe(false);
  });

  it("H-6b [RED] popup bị chặn + URL không tham số + isCurrent → false ⇒ KHÔNG điều hướng tab app", async () => {
    popupBlocked();
    const outcome = await settle(
      openSignedUrlInNewTab(async () => PLAIN, { isCurrent: () => false }),
    );

    expect(assign).not.toHaveBeenCalled();
    expect(outcome).toBe(false);
  });

  it("H-7 [allow ⇄ H-6] popup bị chặn + `inline` + isCurrent → true ⇒ điều hướng tab app 1 lần", async () => {
    popupBlocked();
    const outcome = await settle(
      openSignedUrlInNewTab(async () => INLINE, { isCurrent: () => true }),
    );

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(new URL(INLINE).href);
    expect(outcome).toBe(true);
  });

  it("H-8 [RED, D5] `attachment` + isCurrent → false (có tab) ⇒ vẫn đóng tab + tải (tải không rời trang)", async () => {
    const outcome = await settle(
      openSignedUrlInNewTab(async () => ATTACHMENT, { isCurrent: () => false }),
    );

    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(outcome).toBe(true);
  });

  it("H-8b [allow, D5] popup bị chặn + `attachment` + isCurrent → false ⇒ vẫn tải", async () => {
    popupBlocked();
    const outcome = await settle(
      openSignedUrlInNewTab(async () => ATTACHMENT, { isCurrent: () => false }),
    );

    expect(assign).toHaveBeenCalledTimes(1);
    expect(outcome).toBe(true);
  });
});

describe("openSignedUrlInNewTab — lỗi và scheme lạ (H-9, H-10)", () => {
  it.each(["javascript:alert(1)", "data:text/html,x"])(
    "H-9 [allow] scheme lạ `%s` ⇒ ném, đóng tab, không gán href, không điều hướng tab app",
    async (unsafe) => {
      const outcome = await settle(openSignedUrlInNewTab(async () => unsafe));

      expect(outcome).toBeInstanceOf(Error);
      expect((outcome as Error).message).toBe("unsafe-url");
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(tab.location.href).toBe("");
      expect(assign).not.toHaveBeenCalled();
    },
  );

  it("H-9 [allow] resolver trả null ⇒ trả false + đóng tab, không điều hướng", async () => {
    const outcome = await settle(openSignedUrlInNewTab(async () => null));

    expect(outcome).toBe(false);
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it("H-9 [allow] resolver ném ⇒ ném lại + đóng tab, không điều hướng", async () => {
    const outcome = await settle(
      openSignedUrlInNewTab(async () => {
        throw new Error("boom");
      }),
    );

    expect((outcome as Error).message).toBe("boom");
    expect(tab.close).toHaveBeenCalledTimes(1);
    expect(assign).not.toHaveBeenCalled();
  });

  // Scheme không đặc biệt vẫn có phần query đọc được (`new URL(...).searchParams`) ⇒ bộ đọc disposition chỉ
  // được chạy SAU guard scheme. Mỗi URL chạy cả khi có tab lẫn khi popup bị chặn.
  const DISGUISED = [
    `javascript:alert(1)//?${PARAM}=attachment`,
    `data:text/html,x?${PARAM}=attachment`,
  ];

  it.each(DISGUISED)(
    "H-10 [allow] `%s` (có tab) ⇒ ném, đóng tab 1 lần, KHÔNG điều hướng tab app",
    async (unsafe) => {
      const outcome = await settle(openSignedUrlInNewTab(async () => unsafe));

      expect(outcome).toBeInstanceOf(Error);
      expect(tab.close).toHaveBeenCalledTimes(1);
      expect(assign).not.toHaveBeenCalled();
      expect(tab.location.href).toBe("");
    },
  );

  it.each(DISGUISED)(
    "H-10 [allow] `%s` (popup bị chặn) ⇒ ném, KHÔNG điều hướng tab app",
    async (unsafe) => {
      popupBlocked();
      const outcome = await settle(openSignedUrlInNewTab(async () => unsafe));

      expect(outcome).toBeInstanceOf(Error);
      expect(assign).not.toHaveBeenCalled();
    },
  );
});
