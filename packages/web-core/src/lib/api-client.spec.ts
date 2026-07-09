import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/** Minimal shape for new ApiError fields — used to avoid `as any` in assertions. */
interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
  kind?: string;
  requestId?: string;
  details?: unknown;
}

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

/**
 * Mock 1 Response nhị phân (export CSV): `.blob()` trả Blob + `.headers.get()` trả Content-Disposition.
 * Dùng cho apiFetchBlob (S3-ATT-EXPORT-1) — client KHÔNG parse JSON, chỉ lấy bytes + filename.
 */
function blobOk(text = "col1,col2\n", filename = "attendance-records.csv") {
  const disposition = `attachment; filename="${filename}"`;
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([text], { type: "text/csv" }),
    headers: {
      get: (k: string) => (k.toLowerCase() === "content-disposition" ? disposition : null),
    },
    text: async () => text,
    json: async () => ({}),
  };
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
    expect(
      (globalThis as unknown as { window: { location: { assign: ReturnType<typeof vi.fn> } } })
        .window.location.assign,
    ).not.toHaveBeenCalled();
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
      code: "AUTH-ERR-UNAUTHENTICATED", // BE code (ERROR_CODES.AUTH_UNAUTHENTICATED) — updated by S0-FE-API-1
    });
    const assign = (
      globalThis as unknown as { window: { location: { assign: ReturnType<typeof vi.fn> } } }
    ).window.location.assign;
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
    fetchMock.mockReturnValueOnce(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );

    const p = api.refreshAccessToken();
    api.invalidateSession(); // logout xảy ra giữa chừng
    resolveFetch(refreshOk("should-be-ignored"));
    const ok = await p;

    expect(ok).toBe(false);
    expect(store.getAccessToken()).toBe("keep-old"); // token mới KHÔNG được commit
  });
});

// ─── apiFetchBlob (S3-ATT-EXPORT-1) ───────────────────────────────────────────
// Tải nhị phân (CSV export) — MIRROR đúng refresh-on-401 single-flight + replay của apiFetch, nhưng KHÔNG
// parse JSON/Zod: trả { blob, filename }. RED-first cho việc nhạy cảm (export dữ liệu chấm công).
describe("apiFetchBlob — refresh-on-401 replay + surface lỗi (KHÔNG silent)", () => {
  it("happy: trả Blob + filename bóc từ Content-Disposition", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok-1");
    fetchMock.mockResolvedValueOnce(blobOk("a,b\n1,2\n", "cham-cong.csv"));

    const { blob, filename } = await api.apiFetchBlob("/attendance/records/export");
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe("a,b\n1,2\n");
    expect(filename).toBe("cham-cong.csv");
    // gắn Bearer + credentials như request nghiệp vụ thường.
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
    expect(init.headers.Authorization).toBe("Bearer tok-1");
  });

  it("[FE RED] 401 → refreshAccessToken 1 lần → REPLAY với Bearer mới (KHÔNG fail thẳng)", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("old-tok");
    let refreshed = false;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        refreshed = true;
        return Promise.resolve(refreshOk("new-tok"));
      }
      return Promise.resolve(refreshed ? blobOk("ok\n") : errRes(401, "UNAUTHENTICATED"));
    });

    const { blob } = await api.apiFetchBlob("/attendance/records/export");
    expect(await blob.text()).toBe("ok\n");
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1); // single-flight, KHÔNG thu hồi family
    const dataCalls = fetchMock.mock.calls.filter((c) => !String(c[0]).includes("/auth/refresh"));
    expect(dataCalls.at(-1)![1].headers.Authorization).toBe("Bearer new-tok"); // replay dùng token mới
  });

  it("refresh fail → redirectToAuth + ném 401 (KHÔNG trả blob rỗng)", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("old-tok");
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(url.includes("/auth/refresh") ? errRes(401, "REUSE") : errRes(401, "UNAUTH")),
    );

    await expect(api.apiFetchBlob("/attendance/records/export")).rejects.toMatchObject({
      status: 401,
      code: "AUTH-ERR-UNAUTHENTICATED",
    });
    const assign = (
      globalThis as unknown as { window: { location: { assign: ReturnType<typeof vi.fn> } } }
    ).window.location.assign;
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("[cap RED] 422 vượt cap → ném ApiError 422 tường minh (KHÔNG CSV cắt im lặng)", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok-1");
    fetchMock.mockResolvedValueOnce(
      errRes(422, "ATT-ERR-EXPORT-TOO-LARGE", "Vui lòng thu hẹp khoảng ngày"),
    );

    await expect(api.apiFetchBlob("/attendance/records/export")).rejects.toMatchObject({
      status: 422,
      code: "ATT-ERR-EXPORT-TOO-LARGE",
      message: "Vui lòng thu hẹp khoảng ngày",
    });
  });

  it("skipAuth + 401 → KHÔNG refresh, ném 401 thẳng", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(errRes(401, "INVALID"));

    await expect(
      api.apiFetchBlob("/public/export", undefined, { skipAuth: true }),
    ).rejects.toMatchObject({ status: 401 });
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(0);
  });

  it("filename null khi vắng Content-Disposition", async () => {
    stubBrowser();
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok-1");
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => new Blob(["x"], { type: "text/csv" }),
      headers: { get: () => null },
      text: async () => "x",
      json: async () => ({}),
    });

    const { filename } = await api.apiFetchBlob("/attendance/records/export");
    expect(filename).toBeNull();
  });
});

describe("redirectToAuth", () => {
  it("điều hướng ĐÚNG 1 lần dù gọi nhiều lần", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    api.redirectToAuth();
    api.redirectToAuth();
    const assign = (
      globalThis as unknown as { window: { location: { assign: ReturnType<typeof vi.fn> } } }
    ).window.location.assign;
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it("no-op khi không có window (CJS/SSR)", async () => {
    vi.stubGlobal("window", undefined);
    const { api } = await loadFresh();
    expect(() => api.redirectToAuth()).not.toThrow();
  });
});

// ─── NEW CASES (S0-FE-API-1) ──────────────────────────────────────────────────
// errResFull: body lỗi CÓ meta.request_id + error.type (errRes cũ thiếu meta/type)
function errResFull(
  status: number,
  {
    code = "ERR",
    type = "GenericError",
    details,
    requestId,
    message = "boom",
  }: {
    code?: string;
    type?: string;
    details?: unknown;
    requestId?: string;
    message?: string;
  } = {},
) {
  const body = {
    success: false,
    data: null,
    message,
    error: { code, type, message, details },
    meta: { request_id: requestId ?? "req_test-id", timestamp: new Date().toISOString() },
  };
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}

describe("apiFetch — kind + request-id (S0-FE-API-1)", () => {
  it("403 → kind='FORBIDDEN', KHÔNG refresh, KHÔNG redirect", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(errResFull(403, { code: "AUTH-ERR-FORBIDDEN" }));

    await expect(api.apiFetch("/admin", testSchema)).rejects.toMatchObject({
      name: "ApiError",
      status: 403,
      kind: "FORBIDDEN",
    });
    // KHÔNG có lần /auth/refresh
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(0);
    // KHÔNG redirect
    const win = (
      globalThis as unknown as { window?: { location?: { assign?: ReturnType<typeof vi.fn> } } }
    ).window;
    if (win?.location?.assign) expect(win.location.assign).not.toHaveBeenCalled();
  });

  it("422 code='VALIDATION-ERR-001' → kind='VALIDATION', details[] surface", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    const details = [{ field: "name", message: "required" }];
    fetchMock.mockResolvedValueOnce(errResFull(422, { code: "VALIDATION-ERR-001", details }));

    let caught: unknown;
    try {
      await api.apiFetch("/hr/employees", testSchema);
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ status: 422, kind: "VALIDATION" });
    expect((caught as ApiErrorShape).details).toEqual(details);
  });

  it("500 → kind='SERVER'", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(errResFull(500, { code: "SYSTEM-ERR-001" }));

    await expect(api.apiFetch("/x", testSchema)).rejects.toMatchObject({
      status: 500,
      kind: "SERVER",
    });
  });

  it("request có header X-Request-Id + X-Client-Type", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(dataOk());

    await api.apiFetch("/x", testSchema);

    const [, init] = fetchMock.mock.calls[0];
    expect(typeof init.headers["X-Request-Id"]).toBe("string");
    expect(init.headers["X-Request-Id"]).toMatch(/^req_/);
    expect(init.headers["X-Client-Type"]).toBe("web");
  });

  it("opts.idempotencyKey → header Idempotency-Key xuất hiện", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(dataOk());

    await api.apiFetch("/x", testSchema, { method: "POST" }, { idempotencyKey: "idem-key-123" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Idempotency-Key"]).toBe("idem-key-123");
  });

  it("GET KHÔNG có Idempotency-Key dù không truyền", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(dataOk());

    await api.apiFetch("/x", testSchema, { method: "GET" });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("ApiError.requestId = meta.request_id từ errResFull", async () => {
    stubBrowser();
    const { api } = await loadFresh();
    fetchMock.mockResolvedValueOnce(errResFull(500, { requestId: "req_xyz-999" }));

    let caught: unknown;
    try {
      await api.apiFetch("/x", testSchema);
    } catch (e) {
      caught = e;
    }
    expect((caught as ApiErrorShape).requestId).toBe("req_xyz-999");
  });

  it("positional construct new ApiError(status,code,message) vẫn compile + hoạt động", async () => {
    const { ApiError: ApiErrorClass } = await import("./api-client");
    const err = new ApiErrorClass(404, "NOT_FOUND", "not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("not found");
    expect(err.name).toBe("ApiError");
  });
});
