import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bonusPenaltyApi } from "./bonus-penalty-api";
import { ApiError } from "@mediaos/web-core";

const UUID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const TASK_UUID = "11111111-1111-1111-1111-111111111111";
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

/** Full server DTO — amount is ALWAYS a number (server gates the whole row via 403, never masks the field). */
const ROW = {
  id: UUID,
  companyId: UUID,
  userId: UUID,
  kind: "bonus",
  amount: 500000,
  currency: "VND",
  periodMonth: "2026-06",
  reason: "Hoàn thành tốt",
  source: "manual",
  referenceType: "task",
  taskId: TASK_UUID,
  defectId: null,
  kpiResultId: null,
  status: "draft",
  approvedBy: null,
  approvedAt: null,
  payrollPeriodId: null,
  consumedAt: null,
  createdBy: UUID,
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

describe("bonusPenaltyApi.list", () => {
  it("GETs /bonus-penalties without filters and parses amount as a number", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([ROW]));
    const rows = await bonusPenaltyApi.list();
    const [url] = lastCall();
    expect(url).toContain("/bonus-penalties");
    // amount is z.number() — never null, never client-unmasked.
    expect(rows[0].amount).toBe(500000);
    expect(typeof rows[0].amount).toBe("number");
  });

  it("encodes userId, status, periodMonth and kind as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await bonusPenaltyApi.list({
      userId: UUID,
      status: "approved",
      periodMonth: "2026-06",
      kind: "penalty",
    });
    const [url] = lastCall();
    expect(url).toContain(`userId=${UUID}`);
    expect(url).toContain("status=approved");
    expect(url).toContain("periodMonth=2026-06");
    expect(url).toContain("kind=penalty");
  });

  it("rethrows a 403 view error as ApiError (status 403) — never swallowed", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ success: false, error: { code: "FORBIDDEN", message: "no perm" } }, 403),
    );
    await expect(bonusPenaltyApi.list()).rejects.toBeInstanceOf(ApiError);
    await expect(bonusPenaltyApi.list()).rejects.toMatchObject({ status: 403 });
  });
});

describe("bonusPenaltyApi.get", () => {
  it("GETs /bonus-penalties/:id and parses the row", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ROW));
    const row = await bonusPenaltyApi.get(UUID);
    const [url] = lastCall();
    expect(url).toContain(`/bonus-penalties/${UUID}`);
    expect(row.amount).toBe(500000);
  });
});

describe("bonusPenaltyApi.create", () => {
  it("POSTs to /bonus-penalties with kind/amount/periodMonth + exactly-one reference", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ROW));
    await bonusPenaltyApi.create({
      userId: UUID,
      kind: "bonus",
      amount: 500000,
      periodMonth: "2026-06",
      source: "manual",
      referenceType: "task",
      taskId: TASK_UUID,
    });
    const [url, init] = lastCall();
    expect(url).toContain("/bonus-penalties");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.kind).toBe("bonus");
    expect(body.amount).toBe(500000);
    expect(body.periodMonth).toBe("2026-06");
    expect(body.taskId).toBe(TASK_UUID);
    // exactly-one reference: the other id columns are absent/null.
    expect(body.defectId == null).toBe(true);
    expect(body.kpiResultId == null).toBe(true);
  });
});

describe("bonusPenaltyApi.approve", () => {
  it("POSTs /bonus-penalties/:id/approve", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...ROW, status: "approved" }));
    const row = await bonusPenaltyApi.approve(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/bonus-penalties/${UUID}/approve`);
    expect(init?.method).toBe("POST");
    expect(row.status).toBe("approved");
  });
});

describe("bonusPenaltyApi.reject", () => {
  it("POSTs /bonus-penalties/:id/reject with a reason body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...ROW, status: "rejected" }));
    const row = await bonusPenaltyApi.reject(UUID, { reason: "Không hợp lệ" });
    const [url, init] = lastCall();
    expect(url).toContain(`/bonus-penalties/${UUID}/reject`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ reason: "Không hợp lệ" });
    expect(row.status).toBe("rejected");
  });
});

describe("bonusPenaltyApi.remove", () => {
  it("DELETEs /bonus-penalties/:id (204)", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 204));
    await bonusPenaltyApi.remove(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/bonus-penalties/${UUID}`);
    expect(init?.method).toBe("DELETE");
  });
});
