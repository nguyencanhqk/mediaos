import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { payrollPeriodApi } from "./payroll-period-api";

const UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ISO = "2026-06-15T08:00:00.000Z";

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const PERIOD_DTO = {
  id: UUID,
  companyId: UUID,
  periodMonth: "2026-06",
  status: "draft",
  attendancePeriodId: null,
  kpiLocked: false,
  createdBy: UUID,
  approvedBy: null,
  approvedAt: null,
  publishedBy: null,
  publishedAt: null,
  createdAt: ISO,
  updatedAt: ISO,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function lastCall(): FetchCall {
  return fetchMock.mock.calls.at(-1) as FetchCall;
}

describe("payrollPeriodApi.list", () => {
  it("GETs /payroll-periods without filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([PERIOD_DTO]));
    const rows = await payrollPeriodApi.list();
    const [url, init] = lastCall();
    expect(url).toContain("/payroll-periods");
    expect(init?.method ?? "GET").toBe("GET");
    expect(rows[0].status).toBe("draft");
    expect(rows[0].periodMonth).toBe("2026-06");
  });

  it("encodes status filter as query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await payrollPeriodApi.list({ status: "approved" });
    const [url] = lastCall();
    expect(url).toContain("status=approved");
  });

  it("parses response through payrollPeriodSchema (all fields present)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([PERIOD_DTO]));
    const rows = await payrollPeriodApi.list();
    expect(rows[0]).toMatchObject({ id: UUID, companyId: UUID, kpiLocked: false });
  });
});

describe("payrollPeriodApi.create", () => {
  it("POSTs to /payroll-periods with periodMonth body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(PERIOD_DTO));
    await payrollPeriodApi.create({ periodMonth: "2026-06" });
    const [url, init] = lastCall();
    expect(url).toContain("/payroll-periods");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ periodMonth: "2026-06" });
  });
});

describe("payrollPeriodApi.approve", () => {
  it("POSTs to /payroll-periods/:id/approve WITHOUT a body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...PERIOD_DTO, status: "approved" }));
    await payrollPeriodApi.approve(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/payroll-periods/${UUID}/approve`);
    expect(init?.method).toBe("POST");
    // approve KHÔNG gửi body tiền — body undefined hoặc rỗng
    const bodyStr = String(init?.body ?? "");
    expect(bodyStr === "undefined" || bodyStr === "" || bodyStr === "{}").toBe(true);
  });

  it("server 403 maps out as ApiError with status 403", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { code: "FORBIDDEN", message: "Người duyệt không được là người chạy lương" } },
        403,
      ),
    );
    await expect(payrollPeriodApi.approve(UUID)).rejects.toMatchObject({ status: 403 });
  });
});

describe("payrollPeriodApi.publish", () => {
  it("POSTs to /payroll-periods/:id/publish WITHOUT a body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...PERIOD_DTO, status: "published" }));
    await payrollPeriodApi.publish(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/payroll-periods/${UUID}/publish`);
    expect(init?.method).toBe("POST");
    const bodyStr = String(init?.body ?? "");
    expect(bodyStr === "undefined" || bodyStr === "" || bodyStr === "{}").toBe(true);
  });
});
