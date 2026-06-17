import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * FS-1b — crown logic: silent-refresh + refresh-on-401 SINGLE-FLIGHT + redirect-on-fail. Chứng minh:
 * (1) N request 401 đồng thời → ĐÚNG 1 lần /auth/refresh; (2) KHÔNG vòng lặp (replay 401 không refresh lại);
 * (3) refresh fail → điều hướng đúng 1 lần; (4) skipAuth bỏ qua refresh; (5) không lộ token.
 *
 * web-core vitest = environment "node" (không jsdom) → shim fetch/document/window bằng vi.stubGlobal. Dùng
 * vi.resetModules() + dynamic import mỗi test để reset state module-level (refreshInFlight/redirecting/epoch).
 */

const testSchema = z.object({ value: z.string() });

function dataOk(value = "ok") {
  const body = { success: true, data: { value }, error: null };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function refreshOk(accessToken = "new-tok", expiresIn = 900) {
  const body = { success: true, data: { accessToken, expiresIn }, error: null };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function errRes(status: number, code = "ERR", message = "boom") {
  const body = { success: false, data: null, error: { code, message } };
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function noContent() {
  return { ok: true, status: 204, json: async () => undefined, text: async () => "" };
}

/** Tải api-client + store TƯƠI (sau resetModules) — cùng đồ thị module để store khớp giữa client và test. */
async function loadFresh() {
  vi.resetModules();
  const api = await import("./api-client");
  const store = await import("../stores/auth");
  return { api, store };
}

function stubBrowser(cookie = "mediaos_csrf=csrf-1") {
  vi.stubGlobal("document", { cookie });
  vi.stubGlobal("window", { location: { href: "https://web.localhost/page", assign: vi.fn() } });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("apiFetch — happy path (giữ nguyên contract cũ)", () => {
  it("gắn Bearer từ store + credentials:'include'", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok-1");
    fetchMock.mockResolvedValueOnce(dataOk());

    await api.apiFetch("/x", testSchema);

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("bỏ Authorization khi skipAuth", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok-1");
    fetchMock.mockResolvedValueOnce(dataOk());

    await api.apiFetch("/pub", testSchema, undefined, { skipAuth: true });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("gỡ envelope { success, data, error }", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(dataOk("hello"));

    const res = await api.apiFetch("/x", testSchema);
    expect(res).toEqual({ value: "hello" });
  });

  it("trả undefined cho 204", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(noContent());

    const res = await api.apiFetch("/x", z.undefined());
    expect(res).toBeUndefined();
  });

  it("ném ApiError status+code từ envelope lỗi (non-401)", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(errRes(409, "CONFLICT", "đụng"));

    await expect(api.apiFetch("/x", testSchema)).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "CONFLICT",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1); // non-401 KHÔNG refresh
  });
});

describe("apiFetch — refresh-on-401 single-flight", () => {
  it("401 → refresh 1 lần → replay với Bearer MỚI", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("old-tok");
    let refreshed = false;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshed = true;
        return Promise.resolve(refreshOk("new-tok"));
      }
      return Promise.resolve(refreshed ? dataOk("done") : errRes(401, "UNAUTHENTICATED"));
    });

    const res = await api.apiFetch("/x", testSchema);
    expect(res).toEqual({ value: "done" });
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
    // replay (lần fetch data cuối) dùng token mới
    const dataCalls = fetchMock.mock.calls.filter((c) => !String(c[0]).includes("/auth/refresh"));
    expect(dataCalls.at(-1)![1].headers.Authorization).toBe("Bearer new-tok");
  });

  it("N request 401 ĐỒNG THỜI → ĐÚNG 1 lần /auth/refresh", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("old-tok");
    let refreshed = false;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshed = true;
        return Promise.resolve(refreshOk());
      }
      return Promise.resolve(refreshed ? dataOk() : errRes(401, "UNAUTHENTICATED"));
    });

    const results = await Promise.all([
      api.apiFetch("/a", testSchema),
      api.apiFetch("/b", testSchema),
      api.apiFetch("/c", testSchema),
    ]);
    expect(results).toHaveLength(3);
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1); // single-flight: KHÔNG 3 refresh → không thu hồi family
  });

  it("skipAuth + 401 → KHÔNG refresh, ném 401 thẳng", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(errRes(401, "INVALID_CREDENTIALS"));

    await expect(
      api.apiFetch("/auth/login", testSchema, { method: "POST" }, { skipAuth: true }),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // không có lần /auth/refresh
  });

  it("KHÔNG vòng lặp: replay vẫn 401 → KHÔNG refresh lần 2, KHÔNG redirect", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("old-tok");
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("/auth/refresh") ? refreshOk() : errRes(401, "FORBIDDEN_RES")),
    );

    await expect(api.apiFetch("/x", testSchema)).rejects.toMatchObject({ status: 401 });
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1); // refresh thành công 1 lần, replay 401 → dừng, KHÔNG refresh lại
    expect((globalThis as unknown as { window: { location: { assign: ReturnType<typeof vi.fn> } } }).window.location.assign).not.toHaveBeenCalled();
  });
});

describe("apiFetch — refresh fail → redirect, không loop", () => {
  it("refresh trả false → redirectToAuth + ném 401", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("old-tok");
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("/auth/refresh") ? errRes(401, "REUSE") : errRes(401, "UNAUTH")),
    );

    await expect(api.apiFetch("/x", testSchema)).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHENTICATED",
    });
    const assign = (globalThis as unknown as { window: { location: { assign: ReturnType<typeof vi.fn> } } })
      .window.location.assign;
    expect(assign).toHaveBeenCalledTimes(1);
    const target = String(assign.mock.calls[0][0]);
    expect(target).toContain("/login?redirect=");
    expect(target).toContain(encodeURIComponent("https://web.localhost/page"));
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1); // KHÔNG retry refresh
  });
});

describe("refreshAccessToken — single-flight internals", () => {
  it("vắng cookie CSRF → false KHÔNG fetch", async () => {
    stubBrowser("");
    const { api } = await loadFresh();
    const ok = await api.refreshAccessToken();
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gửi header x-csrf-token = cookie + credentials, KHÔNG Authorization", async () => {
    stubBrowser("mediaos_csrf=csrf-XYZ");
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(refreshOk());

    await api.refreshAccessToken();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/auth/refresh");
    expect(init.headers["x-csrf-token"]).toBe("csrf-XYZ");
    expect(init.credentials).toBe("include");
    expect(init.headers.Authorization).toBeUndefined();
  });

  it("thành công → parse + setAccessToken", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    fetchMock.mockResolvedValueOnce(refreshOk("fresh-123"));

    const ok = await api.refreshAccessToken();
    expect(ok).toBe(true);
    expect(store.getAccessToken()).toBe("fresh-123");
  });

  it("401/403/schema-sai/network → false KHÔNG ném", async () => {
    for (const scenario of ["401", "403", "schema", "network"] as const) {
      stubBrowser();
      const { api } = await loadFresh();
      if (scenario === "401") fetchMock.mockResolvedValueOnce(errRes(401));
      else if (scenario === "403") fetchMock.mockResolvedValueOnce(errRes(403));
      else if (scenario === "schema")
        fetchMock.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true, data: { nope: 1 }, error: null }),
          text: async () => "",
        });
      else fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      await expect(api.refreshAccessToken()).resolves.toBe(false);
    }
  });

  it("xoá inFlight sau settle → chu kỳ refresh kế chạy lại được", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValue(refreshOk());

    await api.refreshAccessToken();
    await api.refreshAccessToken();
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(2); // 2 chu kỳ tuần tự = 2 lần (không bị kẹt 1)
  });

  it("epoch guard: invalidateSession trong lúc refresh bay → KHÔNG commit token", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("keep-old");
    let resolveFetch: (v: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((r) => { resolveFetch = r; }));

    const p = api.refreshAccessToken();
    api.invalidateSession(); // logout xảy ra giữa chừng
    resolveFetch(refreshOk("should-be-ignored"));
    const ok = await p;

    expect(ok).toBe(false);
    expect(store.getAccessToken()).toBe("keep-old"); // token mới KHÔNG được commit
  });
});

describe("redirectToAuth", () => {
  it("điều hướng ĐÚNG 1 lần dù gọi nhiều lần", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    api.redirectToAuth();
    api.redirectToAuth();
    const assign = (globalThis as unknown as { window: { location: { assign: ReturnType<typeof vi.fn> } } })
      .window.location.assign;
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("no-op khi không có window (CJS/SSR)", async () => {
    vi.stubGlobal("window", undefined);
    const { api } = await loadFresh();
    expect(() => api.redirectToAuth()).not.toThrow();
  });
});
