/**
 * attendance-api — contract/URL boundary tests (S3-FE-REGISTRY-1 + S3-FE-ATT-5).
 *
 * KHÔNG mock attendanceApi; chỉ mock apiFetch tại ranh giới `./api-client` (đúng pattern
 * users-api.spec.ts) để kiểm chứng mỗi method gọi ĐÚNG path controller + truyền schema Zod làm validator
 * (arg 2), KHÔNG tự forward company_id.
 *
 * ANTI GREEN-FAKE (S3-FE-ATT-5-FIX): shift/rule/assignment KHÔNG chỉ kiểm URL — mà CHẠY THẬT
 * `schema.parse(fixture)` với fixture SHAPE ĐÚNG S3-ATT-BE-3 (`{ items: [...] }`) đã merge (PR #69).
 * Test khẳng định validator LÀ envelope `{items}` (parse OK) VÀ TỪ CHỐI mảng trần `[...]` (defect cũ:
 * client validate bằng z.array(schema) → schema.parse ném với API thật). Nếu ai đó đổi lại về mảng trần,
 * test sẽ ĐỎ.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceApi } from "./attendance-api";
import * as apiClient from "./api-client";

vi.mock("./api-client", async (importOriginal) => {
  const mod = await importOriginal<typeof apiClient>();
  return { ...mod, apiFetch: vi.fn(), apiFetchBlob: vi.fn() };
});

function lastCall(): [
  string,
  { parse: (v: unknown) => unknown },
  { method?: string; body?: string }?,
] {
  const calls = vi.mocked(apiClient.apiFetch).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1] as never;
}

// ── BE-3-shaped fixtures (contract packages/contracts/src/attendance.ts §7.1/7.2/7.3) ──
const ISO = "2026-07-01T08:00:00.000Z";
const UUID = "11111111-1111-4111-8111-111111111111";

const SHIFT_ITEM = {
  id: UUID,
  shiftCode: "OFFICE_8H",
  name: "Ca hành chính",
  description: null,
  shiftType: "Fixed",
  startTime: "08:00:00",
  endTime: "17:30:00",
  breakStartTime: null,
  breakEndTime: null,
  breakMinutes: 60,
  requiredWorkingMinutes: 480,
  flexibleCheckInFrom: null,
  flexibleCheckInTo: null,
  graceLateMinutes: 5,
  graceEarlyLeaveMinutes: 5,
  allowEarlyCheckIn: true,
  allowLateCheckOut: true,
  crossDay: false,
  workDays: [1, 2, 3, 4, 5],
  status: "Active",
  isDefault: true,
  createdAt: ISO,
  updatedAt: ISO,
};

const ASSIGNMENT_ITEM = {
  id: UUID,
  shiftId: UUID,
  assignmentScope: "Company",
  departmentId: null,
  employeeId: null,
  effectiveFrom: "2026-07-01",
  effectiveTo: null,
  priority: 0,
  status: "Active",
  note: null,
  createdAt: ISO,
  updatedAt: ISO,
};

const RULE_ITEM = {
  id: UUID,
  ruleCode: "DEFAULT",
  name: "Rule mặc định",
  description: null,
  ruleScope: "Company",
  departmentId: null,
  employeeId: null,
  priority: 0,
  effectiveFrom: "2026-07-01",
  effectiveTo: null,
  requireCheckIn: true,
  requireCheckOut: true,
  allowWebCheckIn: true,
  allowMobileCheckIn: true,
  allowRemoteCheckIn: false,
  allowAdjustmentRequest: true,
  requireGps: false,
  requireNote: false,
  requirePhoto: false,
  allowHolidayAttendance: false,
  allowWeekendAttendance: false,
  autoAttendanceEnabled: false,
  autoCheckOutEnabled: false,
  autoAttendanceWorkingMinutes: null,
  status: "Active",
  createdAt: ISO,
  updatedAt: ISO,
};

describe("attendanceApi — scoped record endpoints (URL + Zod validator)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({} as never);
  });

  it("getToday → GET /attendance/today + schema validator", async () => {
    await attendanceApi.getToday();
    const [url, schema] = lastCall();
    expect(url).toBe("/attendance/today");
    expect(typeof schema.parse).toBe("function");
  });

  it("listMyRecords → path bắt đầu /attendance/my-records", async () => {
    await attendanceApi.listMyRecords({ page: 2 });
    const [url] = lastCall();
    expect(url.startsWith("/attendance/my-records")).toBe(true);
    expect(new URLSearchParams(url.split("?")[1]).get("page")).toBe("2");
  });

  it("listTeamRecords → path bắt đầu /attendance/team-records", async () => {
    await attendanceApi.listTeamRecords();
    const [url] = lastCall();
    expect(url.startsWith("/attendance/team-records")).toBe(true);
  });

  it("listRecords (company) → path bắt đầu /attendance/records", async () => {
    await attendanceApi.listRecords();
    const [url] = lastCall();
    expect(url.startsWith("/attendance/records")).toBe(true);
  });

  it("getRecord(id) → GET /attendance/records/:id", async () => {
    await attendanceApi.getRecord("rec-1");
    const [url] = lastCall();
    expect(url).toBe("/attendance/records/rec-1");
  });

  it("checkIn → POST /attendance/check-in với body JSON (KHÔNG company_id)", async () => {
    await attendanceApi.checkIn({ method: "web" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/attendance/check-in");
    expect(opts?.method).toBe("POST");
    expect(opts?.body ?? "").not.toContain("company");
  });

  it("checkOut → POST /attendance/check-out", async () => {
    await attendanceApi.checkOut({ method: "web" });
    const [url, , opts] = lastCall();
    expect(url).toBe("/attendance/check-out");
    expect(opts?.method).toBe("POST");
  });
});

// ── Export CSV (S3-ATT-EXPORT-1) — ranh giới apiFetchBlob (KHÔNG apiFetch) ───────
describe("attendanceApi — exportCompanyRecords (blob boundary)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetchBlob).mockReset();
    vi.mocked(apiClient.apiFetchBlob).mockResolvedValue({
      blob: new Blob(["x"], { type: "text/csv" }),
      filename: "attendance-records.csv",
    });
  });

  it("gọi apiFetchBlob (KHÔNG apiFetch) tới GET /attendance/records/export", async () => {
    vi.mocked(apiClient.apiFetch).mockClear();
    await attendanceApi.exportCompanyRecords({ fromDate: "2026-07-01", toDate: "2026-08-01" });

    expect(apiClient.apiFetchBlob).toHaveBeenCalledTimes(1);
    expect(apiClient.apiFetch).not.toHaveBeenCalled(); // nhị phân → KHÔNG đi qua Zod-parse apiFetch
    const [url] = vi.mocked(apiClient.apiFetchBlob).mock.calls[0];
    expect(url.startsWith("/attendance/records/export")).toBe(true);
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("fromDate")).toBe("2026-07-01");
    expect(qs.get("toDate")).toBe("2026-08-01");
  });

  it("KHÔNG forward company_id trong query (SERVER resolve từ auth context)", async () => {
    await attendanceApi.exportCompanyRecords({
      departmentId: "11111111-1111-4111-8111-111111111111",
    });
    const [url] = vi.mocked(apiClient.apiFetchBlob).mock.calls[0];
    expect(url).not.toContain("company");
  });

  it("không filter → path không có query string thừa", async () => {
    await attendanceApi.exportCompanyRecords();
    const [url] = vi.mocked(apiClient.apiFetchBlob).mock.calls[0];
    expect(url).toBe("/attendance/records/export");
  });
});

describe("attendanceApi — shift/rule/assignment vs REAL S3-ATT-BE-3 shape", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue({ items: [] } as never);
  });

  // ── LIST: URL + validator LÀ envelope {items} (parse OK) + TỪ CHỐI mảng trần ──

  it("listShifts → GET /attendance/shifts, validator = envelope {items}", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({ items: [SHIFT_ITEM] } as never);
    const result = await attendanceApi.listShifts();
    const [url, schema] = lastCall();
    expect(url).toBe("/attendance/shifts");
    // Envelope parse OK với shape BE-3 thật.
    expect(() => schema.parse({ items: [SHIFT_ITEM] })).not.toThrow();
    // Defect cũ: mảng trần → PHẢI ném (chứng minh KHÔNG còn z.array(schema)).
    expect(() => schema.parse([SHIFT_ITEM])).toThrow();
    // Client unwrap .items → trả mảng.
    expect(result).toEqual([SHIFT_ITEM]);
  });

  it("listShiftAssignments → GET /attendance/shift-assignments, envelope validator", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({ items: [ASSIGNMENT_ITEM] } as never);
    const result = await attendanceApi.listShiftAssignments();
    const [url, schema] = lastCall();
    expect(url).toBe("/attendance/shift-assignments");
    expect(() => schema.parse({ items: [ASSIGNMENT_ITEM] })).not.toThrow();
    expect(() => schema.parse([ASSIGNMENT_ITEM])).toThrow();
    expect(result).toEqual([ASSIGNMENT_ITEM]);
  });

  it("listRules → GET /attendance/rules (KHÔNG /rules/effective), envelope validator", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({ items: [RULE_ITEM] } as never);
    const result = await attendanceApi.listRules();
    const [url, schema] = lastCall();
    expect(url).toBe("/attendance/rules");
    expect(() => schema.parse({ items: [RULE_ITEM] })).not.toThrow();
    expect(() => schema.parse([RULE_ITEM])).toThrow();
    expect(result).toEqual([RULE_ITEM]);
  });

  // ── CREATE / UPDATE: URL + method + item-schema validator (parse item thật OK) ──

  it("createShift → POST /attendance/shifts, validator = shiftSchema (item)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SHIFT_ITEM as never);
    await attendanceApi.createShift({
      shiftCode: "X",
      name: "X",
      shiftType: "Fixed",
      requiredWorkingMinutes: 480,
      breakMinutes: 0,
      graceLateMinutes: 0,
      graceEarlyLeaveMinutes: 0,
      allowEarlyCheckIn: true,
      allowLateCheckOut: true,
      crossDay: false,
      isDefault: false,
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/attendance/shifts");
    expect(opts?.method).toBe("POST");
    expect(() => schema.parse(SHIFT_ITEM)).not.toThrow();
  });

  it("updateShift → PATCH /attendance/shifts/:id", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(SHIFT_ITEM as never);
    await attendanceApi.updateShift(UUID, { name: "Y" });
    const [url, , opts] = lastCall();
    expect(url).toBe(`/attendance/shifts/${UUID}`);
    expect(opts?.method).toBe("PATCH");
  });

  it("createShiftAssignment → POST /attendance/shift-assignments", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(ASSIGNMENT_ITEM as never);
    await attendanceApi.createShiftAssignment({
      shiftId: UUID,
      assignmentScope: "Company",
      effectiveFrom: "2026-07-01",
      priority: 0,
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/attendance/shift-assignments");
    expect(opts?.method).toBe("POST");
    expect(() => schema.parse(ASSIGNMENT_ITEM)).not.toThrow();
  });

  it("createRule → POST /attendance/rules, validator = attendanceRuleSchema (item)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(RULE_ITEM as never);
    await attendanceApi.createRule({
      ruleCode: "R",
      name: "R",
      ruleScope: "Company",
      priority: 0,
      effectiveFrom: "2026-07-01",
      requireCheckIn: true,
      requireCheckOut: true,
      allowWebCheckIn: true,
      allowMobileCheckIn: true,
      allowRemoteCheckIn: false,
      allowAdjustmentRequest: true,
      requireGps: false,
      requireNote: false,
      requirePhoto: false,
      allowHolidayAttendance: false,
      allowWeekendAttendance: false,
      autoAttendanceEnabled: false,
      autoCheckOutEnabled: false,
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/attendance/rules");
    expect(opts?.method).toBe("POST");
    expect(() => schema.parse(RULE_ITEM)).not.toThrow();
  });

  it("updateRule → PATCH /attendance/rules/:id", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue(RULE_ITEM as never);
    await attendanceApi.updateRule(UUID, { name: "Z" });
    const [url, , opts] = lastCall();
    expect(url).toBe(`/attendance/rules/${UUID}`);
    expect(opts?.method).toBe("PATCH");
  });
});

// ── Adjustment requests (S3-FE-ATT-3 · S3-ATT-BE-4) ─────────────────────────────

const ADJUSTMENT_DETAIL = {
  id: UUID,
  requestCode: "ADJ-0001",
  employeeId: UUID,
  employeeCode: "EMP001",
  fullName: "Nguyen Van A",
  attendanceRecordId: null,
  workDate: "2026-07-01",
  requestType: "MISSING_CHECK_IN",
  requestedCheckInAt: ISO,
  requestedCheckOutAt: null,
  reason: "Quen check-in",
  status: "Pending",
  submittedAt: ISO,
  requestedBy: UUID,
  currentApproverUserId: null,
  reviewedBy: null,
  reviewedAt: null,
  reviewNote: null,
  attachmentFileId: null,
  items: [],
  createdAt: ISO,
  updatedAt: ISO,
};

describe("attendanceApi — adjustment requests (S3-ATT-BE-4 canonical DTOs)", () => {
  beforeEach(() => {
    vi.mocked(apiClient.apiFetch).mockReset();
    vi.mocked(apiClient.apiFetch).mockResolvedValue(ADJUSTMENT_DETAIL as never);
  });

  it("createAdjustmentRequest → POST /attendance/adjustment-requests, validator = detail schema", async () => {
    await attendanceApi.createAdjustmentRequest({
      workDate: "2026-07-01",
      requestType: "MISSING_CHECK_IN",
      requestedCheckInAt: ISO,
      reason: "Quen check-in",
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe("/attendance/adjustment-requests");
    expect(opts?.method).toBe("POST");
    expect(opts?.body ?? "").not.toContain("company");
    expect(() => schema.parse(ADJUSTMENT_DETAIL)).not.toThrow();
  });

  it("listMyAdjustmentRequests → path bắt đầu /attendance/adjustment-requests/my", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      items: [ADJUSTMENT_DETAIL],
      meta: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrev: false },
    } as never);
    await attendanceApi.listMyAdjustmentRequests({ page: 1 });
    const [url] = lastCall();
    expect(url.startsWith("/attendance/adjustment-requests/my")).toBe(true);
    expect(new URLSearchParams(url.split("?")[1]).get("page")).toBe("1");
  });

  it("listTeamAdjustmentRequests → path bắt đầu /attendance/adjustment-requests/team", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    } as never);
    await attendanceApi.listTeamAdjustmentRequests();
    const [url] = lastCall();
    expect(url.startsWith("/attendance/adjustment-requests/team")).toBe(true);
  });

  it("listCompanyAdjustmentRequests → GET /attendance/adjustment-requests (KHÔNG /team, KHÔNG /my)", async () => {
    vi.mocked(apiClient.apiFetch).mockResolvedValue({
      items: [],
      meta: { page: 1, pageSize: 20, total: 0, totalPages: 0, hasNext: false, hasPrev: false },
    } as never);
    await attendanceApi.listCompanyAdjustmentRequests();
    const [url] = lastCall();
    expect(url.startsWith("/attendance/adjustment-requests")).toBe(true);
    expect(url.startsWith("/attendance/adjustment-requests/team")).toBe(false);
    expect(url.startsWith("/attendance/adjustment-requests/my")).toBe(false);
  });

  it("getAdjustmentRequest(id) → GET /attendance/adjustment-requests/:id", async () => {
    await attendanceApi.getAdjustmentRequest(UUID);
    const [url] = lastCall();
    expect(url).toBe(`/attendance/adjustment-requests/${UUID}`);
  });

  it("approveAdjustmentRequest → POST .../approve", async () => {
    await attendanceApi.approveAdjustmentRequest(UUID, { note: "OK" });
    const [url, , opts] = lastCall();
    expect(url).toBe(`/attendance/adjustment-requests/${UUID}/approve`);
    expect(opts?.method).toBe("POST");
  });

  it("rejectAdjustmentRequest → POST .../reject với reason bắt buộc", async () => {
    await attendanceApi.rejectAdjustmentRequest(UUID, { reason: "Thiếu chứng từ" });
    const [url, , opts] = lastCall();
    expect(url).toBe(`/attendance/adjustment-requests/${UUID}/reject`);
    expect(opts?.method).toBe("POST");
    expect(opts?.body ?? "").toContain("Thiếu chứng từ");
  });

  it("adjustRecordDirect → POST /attendance/records/:id/adjust-direct", async () => {
    await attendanceApi.adjustRecordDirect(UUID, {
      recordId: UUID,
      items: [{ fieldName: "checkInAt", newValue: ISO }],
      reason: "Sửa trực tiếp",
    });
    const [url, schema, opts] = lastCall();
    expect(url).toBe(`/attendance/records/${UUID}/adjust-direct`);
    expect(opts?.method).toBe("POST");
    expect(() => schema.parse(ADJUSTMENT_DETAIL)).not.toThrow();
  });
});
