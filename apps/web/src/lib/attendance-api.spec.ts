import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceApi } from "./attendance-api";

const UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ISO = "2026-06-13T08:00:00.000Z";
const DATE = "2026-06-13";
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

const TODAY_PAYLOAD = {
  workDate: DATE,
  record: null,
  schedule: null,
  periodLocked: false,
};

const RECORD = {
  id: UUID,
  userId: UUID,
  workDate: DATE,
  workScheduleId: null,
  checkInAt: ISO,
  checkOutAt: null,
  checkInMethod: "web",
  checkOutMethod: null,
  lateMinutes: 0,
  earlyLeaveMinutes: 0,
  status: "present",
  note: null,
};

const ADJUSTMENT = {
  id: UUID,
  userId: UUID,
  attendanceRecordId: null,
  workDate: DATE,
  requestedCheckInAt: ISO,
  requestedCheckOutAt: null,
  reason: "Quên chấm",
  status: "pending",
  taskId: null,
  approvedBy: null,
  approvedAt: null,
  reviewNote: null,
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

describe("attendanceApi.getToday", () => {
  it("GETs /attendance/today", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(TODAY_PAYLOAD));
    const result = await attendanceApi.getToday();
    const [url] = lastCall();
    expect(url).toContain("/attendance/today");
    expect(result.workDate).toBe(DATE);
  });
});

describe("attendanceApi.checkIn", () => {
  it("POSTs /attendance/check-in with method=web", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(TODAY_PAYLOAD));
    await attendanceApi.checkIn({ method: "web" });
    const [url, init] = lastCall();
    expect(url).toContain("/attendance/check-in");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ method: "web" });
  });
});

describe("attendanceApi.checkOut", () => {
  it("POSTs /attendance/check-out", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(TODAY_PAYLOAD));
    await attendanceApi.checkOut({ method: "web" });
    const [url, init] = lastCall();
    expect(url).toContain("/attendance/check-out");
    expect(init?.method).toBe("POST");
  });
});

describe("attendanceApi.listMonthly", () => {
  it("GETs /attendance with month query param", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([RECORD]));
    await attendanceApi.listMonthly({ month: MONTH });
    const [url] = lastCall();
    expect(url).toContain("/attendance");
    expect(url).toContain(`month=${MONTH}`);
  });

  it("includes userId when provided", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await attendanceApi.listMonthly({ month: MONTH, userId: UUID });
    const [url] = lastCall();
    expect(url).toContain(`userId=${UUID}`);
  });
});

describe("attendanceApi.listAdjustments", () => {
  it("GETs /attendance/adjustments without filters", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([ADJUSTMENT]));
    await attendanceApi.listAdjustments();
    const [url] = lastCall();
    expect(url).toContain("/attendance/adjustments");
  });

  it("encodes status and scope as query params", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await attendanceApi.listAdjustments({ status: "pending", scope: "all" });
    const [url] = lastCall();
    expect(url).toContain("status=pending");
    expect(url).toContain("scope=all");
  });
});

describe("attendanceApi.createAdjustment", () => {
  it("POSTs to /attendance/adjustments with the request body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(ADJUSTMENT));
    await attendanceApi.createAdjustment({
      workDate: DATE,
      requestedCheckInAt: ISO,
      reason: "Quên chấm công",
    });
    const [url, init] = lastCall();
    expect(url).toContain("/attendance/adjustments");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.workDate).toBe(DATE);
    expect(body.reason).toBe("Quên chấm công");
  });
});

describe("attendanceApi.approveAdjustment", () => {
  it("POSTs to /attendance/adjustments/:id/approve", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ...ADJUSTMENT, status: "approved" }));
    await attendanceApi.approveAdjustment(UUID, "OK");
    const [url, init] = lastCall();
    expect(url).toContain(`/attendance/adjustments/${UUID}/approve`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ note: "OK" });
  });
});

describe("attendanceApi.cancelAdjustment", () => {
  it("POSTs to /attendance/adjustments/:id/cancel", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(null, 200));
    await attendanceApi.cancelAdjustment(UUID);
    const [url, init] = lastCall();
    expect(url).toContain(`/attendance/adjustments/${UUID}/cancel`);
    expect(init?.method).toBe("POST");
  });
});
