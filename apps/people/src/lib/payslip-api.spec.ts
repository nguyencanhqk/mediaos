import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { payslipApi } from "./payslip-api";

const UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PERIOD_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
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

const PAYSLIP_DTO = {
  id: UUID,
  companyId: UUID,
  payrollPeriodId: PERIOD_ID,
  userId: UUID,
  salaryProfileId: UUID,
  baseSalary: 25_000_000,
  totalAllowances: 1_000_000,
  gross: 26_000_000,
  net: 24_500_000,
  currency: "VND",
  workDays: 22,
  presentDays: 22,
  lateMinutes: 0,
  kpiAmount: null,
  bonusAmount: null,
  penaltyAmount: null,
  entryKind: "original",
  replacesPayslipId: null,
  createdBy: UUID,
  createdAt: ISO,
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

describe("payslipApi.list", () => {
  it("GETs /payslips without filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([PAYSLIP_DTO]));
    const rows = await payslipApi.list();
    const [url] = lastCall();
    expect(url).toContain("/payslips");
    expect(rows[0].net).toBe(24_500_000);
  });

  it("encodes payrollPeriodId + userId as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await payslipApi.list({ payrollPeriodId: PERIOD_ID, userId: UUID });
    const [url] = lastCall();
    expect(url).toContain(`payrollPeriodId=${PERIOD_ID}`);
    expect(url).toContain(`userId=${UUID}`);
  });
});

describe("payslipApi.listSummary (money-free projection — BẤT BIẾN #3)", () => {
  it("GETs /payslips and STRIPS all monetary fields at the boundary", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([PAYSLIP_DTO]));
    const items = await payslipApi.listSummary();
    const [url] = lastCall();
    expect(url).toContain("/payslips");

    const item = items[0];
    // Keeps only money-free metadata for the list view.
    expect(item).toMatchObject({
      id: UUID,
      payrollPeriodId: PERIOD_ID,
      entryKind: "original",
    });
    expect(typeof item.createdAt).toBe("string");

    // NO monetary fields may survive — list must never carry money (server-masking gap defended at FE boundary).
    for (const moneyKey of [
      "baseSalary",
      "totalAllowances",
      "gross",
      "net",
      "kpiAmount",
      "bonusAmount",
      "penaltyAmount",
      "currency",
    ]) {
      expect(item).not.toHaveProperty(moneyKey);
    }
  });

  it("forwards userId filter as a query param (self-service scoping)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await payslipApi.listSummary({ userId: UUID });
    const [url] = lastCall();
    expect(url).toContain(`userId=${UUID}`);
  });
});

describe("payslipApi.listAcknowledgements", () => {
  it("GETs /payslips/:id/acknowledgements (money-free)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          id: UUID,
          companyId: UUID,
          payslipId: UUID,
          userId: UUID,
          status: "acknowledged",
          reason: null,
          resolvedBy: null,
          resolvedAt: null,
          resolutionNote: null,
          createdAt: ISO,
          updatedAt: ISO,
        },
      ]),
    );
    const acks = await payslipApi.listAcknowledgements(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/payslips/${UUID}/acknowledgements`);
    expect(init?.method ?? "GET").toBe("GET");
    expect(acks[0].status).toBe("acknowledged");
  });
});

describe("payslipApi.reauth then getOne (no cache)", () => {
  it("reauth POSTs /payslips/:id/reauth with password body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ expiresAt: ISO }));
    await payslipApi.reauth(UUID, "my-secret-pw");
    const [url, init] = lastCall();
    expect(url).toContain(`/payslips/${UUID}/reauth`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ password: "my-secret-pw" });
  });

  it("getOne GETs /payslips/:id directly via apiFetch (not useQuery)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(PAYSLIP_DTO));
    const slip = await payslipApi.getOne(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/payslips/${UUID}`);
    expect(init?.method ?? "GET").toBe("GET");
    expect(slip.net).toBe(24_500_000);
  });

  it("getOne rejects with 403 ApiError if re-auth window expired", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { code: "REAUTH_REQUIRED", message: "Re-auth window expired" } },
        403,
      ),
    );
    await expect(payslipApi.getOne(UUID)).rejects.toMatchObject({ status: 403 });
  });
});

describe("payslipApi.acknowledge", () => {
  it("POSTs /payslips/:id/acknowledge", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: UUID,
        companyId: UUID,
        payslipId: UUID,
        userId: UUID,
        status: "acknowledged",
        reason: null,
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
        createdAt: ISO,
        updatedAt: ISO,
      }),
    );
    await payslipApi.acknowledge(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/payslips/${UUID}/acknowledge`);
    expect(init?.method).toBe("POST");
  });
});

describe("payslipApi.dispute", () => {
  it("POSTs /payslips/:id/dispute with reason", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: UUID,
        companyId: UUID,
        payslipId: UUID,
        userId: UUID,
        status: "disputed",
        reason: "Sai ngày công",
        resolvedBy: null,
        resolvedAt: null,
        resolutionNote: null,
        createdAt: ISO,
        updatedAt: ISO,
      }),
    );
    await payslipApi.dispute(UUID, "Sai ngày công");
    const [url, init] = lastCall();
    expect(url).toContain(`/payslips/${UUID}/dispute`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ reason: "Sai ngày công" });
  });

  it("rejects with ZodError when reason is empty (Zod chặn trước khi gọi mạng)", async () => {
    // disputePayslipSchema.parse rejects empty string
    await expect(payslipApi.dispute(UUID, "")).rejects.toThrow();
    // fetch should NOT have been called
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with ZodError when reason is whitespace only", async () => {
    await expect(payslipApi.dispute(UUID, "   ")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("payslipApi.resolve", () => {
  it("POSTs /payslips/:id/resolve with optional resolutionNote", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: UUID,
        companyId: UUID,
        payslipId: UUID,
        userId: UUID,
        status: "resolved",
        reason: "Sai ngày công",
        resolvedBy: UUID,
        resolvedAt: ISO,
        resolutionNote: "Đã kiểm tra, đúng",
        createdAt: ISO,
        updatedAt: ISO,
      }),
    );
    await payslipApi.resolve(UUID, "Đã kiểm tra, đúng");
    const [url, init] = lastCall();
    expect(url).toContain(`/payslips/${UUID}/resolve`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ resolutionNote: "Đã kiểm tra, đúng" });
  });
});
