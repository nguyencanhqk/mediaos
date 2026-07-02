/**
 * hr-master-data-api — contract validation + error mapping (S2-FE-HR-5, lane HR5-WC / QA-04).
 *
 * Real apiFetch + mock global fetch (KHÔNG mock ./api-client) → chứng minh:
 *  - response validate bằng Zod contract đã có (jobLevelSchema: coerce createdAt → Date);
 *  - response SAI schema → ném ở ranh giới (contract drift, fail-closed);
 *  - 422 ZodValidationException → ApiError.status=422 + details field-level (map lỗi ra form);
 *  - DELETE 204 → resolve undefined (soft-delete server-side).
 * web-core vitest env = node → shim fetch/document/window bằng vi.stubGlobal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const VALID_JOB_LEVEL = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "22222222-2222-2222-2222-222222222222",
  code: "L1",
  name: "Junior",
  rankOrder: 1,
  status: "active",
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

function envelope(data: unknown) {
  const body = { success: true, message: "ok", data, error: null };
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}
function noContent() {
  return { ok: true, status: 204, json: async () => undefined, text: async () => "" };
}
function validationErr() {
  const body = {
    success: false,
    message: "Dữ liệu không hợp lệ",
    data: null,
    error: {
      code: "HR-ERR-422",
      type: "ZodValidationException",
      message: "Dữ liệu không hợp lệ",
      details: [{ field: "name", message: "Tên bắt buộc", rule: "required" }],
    },
    meta: { request_id: "req-1", timestamp: "2026-07-01T00:00:00.000Z" },
  };
  return { ok: false, status: 422, json: async () => body, text: async () => JSON.stringify(body) };
}

async function loadFresh() {
  vi.resetModules();
  const api = await import("./hr-master-data-api");
  const store = await import("../stores/auth");
  return { api, store };
}

let fetchMock: ReturnType<typeof vi.fn>;

describe("hrMasterDataApi — response Zod validation + error mapping (QA-04)", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("document", { cookie: "mediaos_csrf=csrf-1" });
    vi.stubGlobal("window", { location: { href: "https://web.localhost/x", assign: vi.fn() } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("getJobLevel → parse response bằng contract jobLevelSchema (coerce createdAt → Date)", async () => {
    fetchMock.mockResolvedValueOnce(envelope(VALID_JOB_LEVEL));
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok");
    const jl = await api.hrMasterDataApi.getJobLevel(VALID_JOB_LEVEL.id);
    expect(jl.name).toBe("Junior");
    expect(jl.createdAt).toBeInstanceOf(Date);
  });

  it("response SAI schema (thiếu name) → ném lỗi validate ở ranh giới (contract drift, fail-closed)", async () => {
    const bad = { ...VALID_JOB_LEVEL } as Record<string, unknown>;
    delete bad.name;
    fetchMock.mockResolvedValueOnce(envelope(bad));
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok");
    await expect(api.hrMasterDataApi.getJobLevel(VALID_JOB_LEVEL.id)).rejects.toBeTruthy();
  });

  it("422 từ server → ApiError.status=422 + details field-level (map lỗi ra form)", async () => {
    fetchMock.mockResolvedValueOnce(validationErr());
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok");
    try {
      await api.hrMasterDataApi.createJobLevel({ code: "L1", name: "" as never });
      throw new Error("phải ném ApiError");
    } catch (err) {
      const e = err as { status: number; details?: Array<{ field: string; message: string }> };
      expect(e.status).toBe(422);
      expect(Array.isArray(e.details)).toBe(true);
      expect(e.details?.[0]?.field).toBe("name");
    }
  });

  it("deleteContractType → 204 no-content → resolve undefined (soft-delete server-side)", async () => {
    fetchMock.mockResolvedValueOnce(noContent());
    const { api, store } = await loadFresh();
    store.useAuthStore.getState().setAccessToken("tok");
    const res = await api.hrMasterDataApi.deleteContractType("c1");
    expect(res).toBeUndefined();
  });
});
