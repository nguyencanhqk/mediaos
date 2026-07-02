import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@mediaos/contracts";

/**
 * FS-1b — bootstrapSession (silent-refresh khi load): refresh fail → false (no /me); refresh ok → /me → setUser;
 * /me lỗi → xoá state cục bộ (KHÔNG gọi logout endpoint); StrictMode double-invoke → ĐÚNG 1 refresh + 1 /me.
 */

const ME: MeResponse = {
  id: "u1",
  companyId: "co1",
  email: "a@b.com",
  fullName: "A B",
  status: "active",
  capabilities: { "read:tasks": true },
  mustSetupTwoFactor: false,
};

function refreshOk(accessToken = "tok") {
  const body = { success: true, data: { accessToken, expiresIn: 900 }, error: null };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

let fetchMock: ReturnType<typeof vi.fn>;

function stubBrowser(cookie = "mediaos_csrf=c1") {
  vi.stubGlobal("document", { cookie });
  vi.stubGlobal("window", { location: { href: "https://web.localhost/x", assign: vi.fn() } });
}

async function loadSession(meImpl: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  vi.doMock("./auth-api", () => ({ authApi: { me: meImpl } }));
  const session = await import("./session");
  const store = await import("../stores/auth");
  return { session, store };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("./auth-api");
  vi.restoreAllMocks();
});

describe("bootstrapSession", () => {
  it("refresh fail (vắng CSRF) → false, KHÔNG gọi /me", async () => {
    stubBrowser("");
    const me = vi.fn();
    const { session } = await loadSession(me);

    await expect(session.bootstrapSession()).resolves.toBe(false);
    expect(me).not.toHaveBeenCalled();
  });

  it("refresh ok → /me → setUser → true", async () => {
    stubBrowser();
    fetchMock.mockResolvedValue(refreshOk("tok-1"));
    const me = vi.fn().mockResolvedValue(ME);
    const { session, store } = await loadSession(me);

    await expect(session.bootstrapSession()).resolves.toBe(true);
    expect(me).toHaveBeenCalledTimes(1);
    const state = store.useAuthStore.getState();
    expect(state.isAuthenticated).toBe(true);
    expect(state.user?.email).toBe("a@b.com");
    expect(state.capabilities).toEqual({ "read:tasks": true });
    expect(state.mustSetupTwoFactor).toBe(false);
  });

  it("me.mustSetupTwoFactor=true → store.mustSetupTwoFactor=true (AUTH-003 ép enroll)", async () => {
    stubBrowser();
    fetchMock.mockResolvedValue(refreshOk("tok-2"));
    const me = vi.fn().mockResolvedValue({ ...ME, mustSetupTwoFactor: true });
    const { session, store } = await loadSession(me);

    await expect(session.bootstrapSession()).resolves.toBe(true);
    expect(store.useAuthStore.getState().mustSetupTwoFactor).toBe(true);
  });

  it("/me lỗi sau refresh ok → xoá state cục bộ, KHÔNG gọi /auth/logout, false", async () => {
    stubBrowser();
    fetchMock.mockResolvedValue(refreshOk());
    const me = vi.fn().mockRejectedValue(new Error("boom"));
    const { session, store } = await loadSession(me);

    await expect(session.bootstrapSession()).resolves.toBe(false);
    expect(store.useAuthStore.getState().isAuthenticated).toBe(false);
    expect(store.getAccessToken()).toBeNull();
    const logoutCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/logout"));
    expect(logoutCalls).toHaveLength(0); // KHÔNG phụ thuộc mạng thêm
  });

  it("StrictMode double-invoke → ĐÚNG 1 /auth/refresh + 1 /me", async () => {
    stubBrowser();
    fetchMock.mockResolvedValue(refreshOk());
    const me = vi.fn().mockResolvedValue(ME);
    const { session } = await loadSession(me);

    await Promise.all([session.bootstrapSession(), session.bootstrapSession()]);
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
    expect(me).toHaveBeenCalledTimes(1);
  });
});
