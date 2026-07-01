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
  return { ...mod, apiFetch: vi.fn() };
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
