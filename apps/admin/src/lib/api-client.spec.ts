import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, apiFetch, unwrapEnvelope } from "./api-client";
import { useAuthStore } from "@/stores/auth";

interface MockRes {
  ok: boolean;
  status: number;
  body?: unknown;
  text?: string;
}

function stubFetch(res: MockRes) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: async () => res.body,
    text: async () => res.text ?? JSON.stringify(res.body ?? ""),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** Đọc headers của lần gọi fetch đầu tiên (plain object literal trong apiFetch). */
function headersOf(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  return (fetchMock.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
}

const schema = z.object({ id: z.string() });

afterEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.getState().logout();
});

describe("apiFetch — Bearer auto-attach (FIX port từ apps/web)", () => {
  it("gắn Authorization: Bearer từ auth store khi đã đăng nhập", async () => {
    useAuthStore.getState().setTokens("tok-123", "refresh-xyz");
    const fetchMock = stubFetch({ ok: true, status: 200, body: { id: "a" } });
    await apiFetch("/x", schema);
    expect(headersOf(fetchMock).Authorization).toBe("Bearer tok-123");
  });

  it("KHÔNG gắn Authorization khi chưa có token", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { id: "a" } });
    await apiFetch("/x", schema);
    expect(headersOf(fetchMock).Authorization).toBeUndefined();
  });

  it("caller override được Authorization qua init.headers (step-up)", async () => {
    useAuthStore.getState().setTokens("tok-123", "refresh-xyz");
    const fetchMock = stubFetch({ ok: true, status: 200, body: { id: "a" } });
    await apiFetch("/x", schema, { headers: { Authorization: "Bearer step-up" } });
    expect(headersOf(fetchMock).Authorization).toBe("Bearer step-up");
  });

  it("luôn gửi Content-Type application/json", async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: { id: "a" } });
    await apiFetch("/x", schema);
    expect(headersOf(fetchMock)["Content-Type"]).toBe("application/json");
  });
});

describe("apiFetch — envelope + errors", () => {
  it("gỡ envelope { success, data, error }", async () => {
    stubFetch({ ok: true, status: 200, body: { success: true, data: { id: "z" }, error: null } });
    await expect(apiFetch("/x", schema)).resolves.toEqual({ id: "z" });
  });

  it("trả undefined cho 204 No Content", async () => {
    stubFetch({ ok: true, status: 204 });
    await expect(apiFetch("/x", z.undefined())).resolves.toBeUndefined();
  });

  it("ném ApiError mang status + code từ body lỗi", async () => {
    stubFetch({
      ok: false,
      status: 403,
      text: JSON.stringify({ error: { code: "FORBIDDEN", message: "no access" } }),
    });
    const err = await apiFetch("/x", schema).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "FORBIDDEN" });
  });
});

describe("unwrapEnvelope", () => {
  it("trả nguyên body khi không phải envelope", () => {
    expect(unwrapEnvelope({ id: "x" })).toEqual({ id: "x" });
  });
});
