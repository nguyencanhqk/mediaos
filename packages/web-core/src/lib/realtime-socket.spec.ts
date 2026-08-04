/**
 * realtime-socket.spec.ts — singleton `/ws` dùng chung app-shell (S7-CHAT-FE-1 §1.2).
 *
 * Mỗi ca `vi.resetModules()` rồi `await import(...)` LẠI, vì `getAppSocket()` giữ singleton ở biến
 * module-private: dùng chung một lần import cho mọi ca thì ca sau luôn nhận socket ca trước tạo ra và
 * mọi khẳng định "chỉ gọi io() một lần" trở thành vô nghĩa.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ioMock = vi.fn(() => ({ id: "socket-instance" }));
let token: string | null = "access-token";

vi.mock("socket.io-client", () => ({ io: (...args: unknown[]) => ioMock(...(args as [])) }));
vi.mock("../stores/auth", () => ({ getAccessToken: () => token }));

async function loadFresh() {
  vi.resetModules();
  return import("./realtime-socket");
}

/** Đọc URL + options của lần `io()` cuối. */
function lastIoCall(): [string, { auth?: unknown }] {
  expect(ioMock.mock.calls.length).toBeGreaterThan(0);
  return ioMock.mock.calls[ioMock.mock.calls.length - 1] as never;
}

beforeEach(() => {
  ioMock.mockClear();
  ioMock.mockImplementation(() => ({ id: "socket-instance" }));
  token = "access-token";
});

afterEach(() => {
  vi.resetModules();
});

describe("getAppSocket", () => {
  it("gọi nhiều lần trả CÙNG MỘT instance và chỉ `io()` đúng 1 lần", async () => {
    const { getAppSocket } = await loadFresh();
    const first = getAppSocket();
    const second = getAppSocket();
    const third = getAppSocket();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it("CHƯA có phiên (getAccessToken() === null) → trả null và KHÔNG gọi io()", async () => {
    token = null;
    const { getAppSocket } = await loadFresh();
    expect(getAppSocket()).toBeNull();
    expect(ioMock).not.toHaveBeenCalled();
  });

  it("có phiên sau đó → lần gọi kế tiếp mới mở kết nối (không kẹt vĩnh viễn ở null)", async () => {
    token = null;
    const { getAppSocket } = await loadFresh();
    expect(getAppSocket()).toBeNull();
    token = "muộn-nhưng-có";
    expect(getAppSocket()).not.toBeNull();
    expect(ioMock).toHaveBeenCalledTimes(1);
  });

  it("origin WS tách từ base REST: `http://localhost:3100/api/v1` → `http://localhost:3100/ws`", async () => {
    const { getAppSocket } = await loadFresh();
    getAppSocket();
    const [url] = lastIoCall();
    expect(url).toBe("http://localhost:3100/ws");
    expect(url).not.toContain("/api/v1"); // prefix REST KHÔNG được dính sang WS
  });

  it("base REST có host khác → origin đi theo host đó, KHÔNG hard-code localhost", async () => {
    const mod = await loadFresh();
    const { configureApiBaseUrl } = await import("./api-client");
    configureApiBaseUrl("https://api.congty.vn/api/v1");
    mod.getAppSocket();
    expect(lastIoCall()[0]).toBe("https://api.congty.vn/ws");
    configureApiBaseUrl("http://localhost:3100/api/v1"); // trả lại default cho ca sau
  });

  it("`auth` là HÀM đọc token MỖI lần thử — không phải object tĩnh đóng băng token cũ", async () => {
    const { getAppSocket } = await loadFresh();
    getAppSocket();
    const [, opts] = lastIoCall();
    expect(typeof opts.auth).toBe("function");

    const seen: Array<{ token?: string }> = [];
    (opts.auth as (cb: (d: { token?: string }) => void) => void)((d) => seen.push(d));
    expect(seen[0]).toEqual({ token: "access-token" });

    // Token xoay giữa hai lần thử (sau refreshAccessToken) → callback phải trả giá trị MỚI.
    token = "token-đã-xoay";
    (opts.auth as (cb: (d: { token?: string }) => void) => void)((d) => seen.push(d));
    expect(seen[1]).toEqual({ token: "token-đã-xoay" });
  });

  it('token biến mất giữa chừng → gửi `undefined`, KHÔNG gửi chuỗi "null"', async () => {
    const { getAppSocket } = await loadFresh();
    getAppSocket();
    const [, opts] = lastIoCall();
    token = null;
    let received: { token?: string } | undefined;
    (opts.auth as (cb: (d: { token?: string }) => void) => void)((d) => {
      received = d;
    });
    expect(received).toEqual({ token: undefined });
  });

  it("KHÔNG ép `transports` — giữ mặc định thư viện (polling rồi upgrade) để sống qua proxy chặn WS", async () => {
    const { getAppSocket } = await loadFresh();
    getAppSocket();
    const [, opts] = lastIoCall();
    expect(opts).not.toHaveProperty("transports");
  });
});
