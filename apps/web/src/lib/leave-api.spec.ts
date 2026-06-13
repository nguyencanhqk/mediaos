import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { leaveApi } from "./leave-api";

const UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const UUID2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ISO = "2026-06-13T08:00:00.000Z";
const DATE = "2026-06-13";
const DATE2 = "2026-06-14";
const MONTH = "2026-06";

type FetchCall = [input: string, init?: RequestInit];

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const LEAVE_TYPE = {
  id: UUID,
  name: "Nghỉ phép năm",
  code: "annual",
  paid: true,
  annualQuota: 12,
  status: "active",
};

const LEAVE_REQUEST = {
  id: UUID,
  userId: UUID,
  leaveTypeId: UUID,
  startDate: DATE,
  endDate: DATE2,
  totalDays: 2,
  reason: null,
  status: "pending",
  taskId: null,
  approvedBy: null,
  approvedAt: null,
  reviewNote: null,
  createdAt: ISO,
};

const LEAVE_BALANCE = {
  id: UUID,
  userId: UUID,
  leaveTypeId: UUID,
  year: 2026,
  totalDays: 12,
  usedDays: 2,
  remainingDays: 10,
};

const CALENDAR_ENTRY = {
  userId: UUID,
  userFullName: "Nguyễn Văn A",
  leaveTypeCode: "annual",
  leaveTypeName: "Nghỉ phép năm",
  startDate: DATE,
  endDate: DATE,
  totalDays: 1,
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

describe("leaveApi.listTypes", () => {
  it("GETs /leave/types", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([LEAVE_TYPE]));
    const types = await leaveApi.listTypes();
    const [url] = lastCall();
    expect(url).toContain("/leave/types");
    expect(types[0].code).toBe("annual");
  });
});

describe("leaveApi.listRequests", () => {
  it("GETs /leave/requests without filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([LEAVE_REQUEST]));
    await leaveApi.listRequests();
    const [url] = lastCall();
    expect(url).toContain("/leave/requests");
  });

  it("encodes status, scope and year as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await leaveApi.listRequests({ status: "approved", scope: "all", year: 2026 });
    const [url] = lastCall();
    expect(url).toContain("status=approved");
    expect(url).toContain("scope=all");
    expect(url).toContain("year=2026");
  });
});

describe("leaveApi.createRequest", () => {
  it("POSTs to /leave/requests with payload", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(LEAVE_REQUEST));
    await leaveApi.createRequest({
      leaveTypeId: UUID,
      startDate: DATE,
      endDate: DATE2,
    });
    const [url, init] = lastCall();
    expect(url).toContain("/leave/requests");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.leaveTypeId).toBe(UUID);
    expect(body.startDate).toBe(DATE);
    expect(body.endDate).toBe(DATE2);
  });
});

describe("leaveApi.approveRequest", () => {
  it("POSTs to /leave/requests/:id/approve with note", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...LEAVE_REQUEST, status: "approved" }),
    );
    await leaveApi.approveRequest(UUID, "Chấp thuận");
    const [url, init] = lastCall();
    expect(url).toContain(`/leave/requests/${UUID}/approve`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ note: "Chấp thuận" });
  });
});

describe("leaveApi.rejectRequest", () => {
  it("POSTs to /leave/requests/:id/reject", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...LEAVE_REQUEST, status: "rejected" }),
    );
    await leaveApi.rejectRequest(UUID, "Không hợp lý");
    const [url, init] = lastCall();
    expect(url).toContain(`/leave/requests/${UUID}/reject`);
    expect(init?.method).toBe("POST");
  });
});

describe("leaveApi.cancelRequest", () => {
  it("POSTs to /leave/requests/:id/cancel", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 200));
    await leaveApi.cancelRequest(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/leave/requests/${UUID}/cancel`);
    expect(init?.method).toBe("POST");
  });
});

describe("leaveApi.listBalances", () => {
  it("GETs /leave/balances", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([LEAVE_BALANCE]));
    await leaveApi.listBalances();
    const [url] = lastCall();
    expect(url).toContain("/leave/balances");
  });

  it("encodes scope and year when provided", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await leaveApi.listBalances({ scope: "me", year: 2026 });
    const [url] = lastCall();
    expect(url).toContain("scope=me");
    expect(url).toContain("year=2026");
  });
});

describe("leaveApi.listCalendar", () => {
  it("GETs /leave/calendar with month param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([CALENDAR_ENTRY]));
    const entries = await leaveApi.listCalendar(MONTH);
    const [url] = lastCall();
    expect(url).toContain("/leave/calendar");
    expect(url).toContain(`month=${encodeURIComponent(MONTH)}`);
    expect(entries[0].userFullName).toBe("Nguyễn Văn A");
  });
});

describe("leaveApi.upsertBalance", () => {
  it("POSTs to /leave/balances", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(LEAVE_BALANCE));
    await leaveApi.upsertBalance({
      userId: UUID,
      leaveTypeId: UUID2,
      year: 2026,
      totalDays: 14,
    });
    const [url, init] = lastCall();
    expect(url).toContain("/leave/balances");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ totalDays: 14 });
  });
});
