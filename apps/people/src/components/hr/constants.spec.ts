import { describe, expect, it } from "vitest";
import {
  ATTENDANCE_STATUS_LABELS,
  HR_REQUEST_STATUS_LABELS,
  formatTime,
  formatDate,
  formatDateFull,
  formatDateTime,
  currentMonth,
  currentYear,
} from "./constants";

describe("ATTENDANCE_STATUS_LABELS", () => {
  it("covers all statuses with Vietnamese labels", () => {
    expect(ATTENDANCE_STATUS_LABELS.present).toBe("Đúng giờ");
    expect(ATTENDANCE_STATUS_LABELS.late).toBe("Đi trễ");
    expect(ATTENDANCE_STATUS_LABELS.early_leave).toBe("Về sớm");
    expect(ATTENDANCE_STATUS_LABELS.absent).toBe("Vắng mặt");
    expect(ATTENDANCE_STATUS_LABELS.missing_checkin).toBe("Thiếu chấm công");
    expect(ATTENDANCE_STATUS_LABELS.pending_adjustment).toBe("Chờ bổ sung");
    expect(ATTENDANCE_STATUS_LABELS.approved_adjustment).toBe("Đã bổ sung");
  });
});

describe("HR_REQUEST_STATUS_LABELS", () => {
  it("covers all request statuses", () => {
    expect(HR_REQUEST_STATUS_LABELS.pending).toBe("Chờ duyệt");
    expect(HR_REQUEST_STATUS_LABELS.approved).toBe("Đã duyệt");
    expect(HR_REQUEST_STATUS_LABELS.rejected).toBe("Từ chối");
    expect(HR_REQUEST_STATUS_LABELS.cancelled).toBe("Đã huỷ");
  });
});

describe("formatTime", () => {
  it("returns — for null", () => {
    expect(formatTime(null)).toBe("—");
  });

  it("returns — for undefined", () => {
    expect(formatTime(undefined)).toBe("—");
  });

  it("returns HH:mm for a valid ISO string", () => {
    // Use a fixed UTC time; local tz may shift the display hour,
    // so we just assert the output looks like HH:mm.
    const result = formatTime("2026-06-13T08:30:00.000Z");
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe("formatDate", () => {
  it("returns — for null", () => {
    expect(formatDate(null)).toBe("—");
  });

  it("formats YYYY-MM-DD as dd/MM", () => {
    expect(formatDate("2026-06-13")).toBe("13/06");
  });
});

describe("formatDateFull", () => {
  it("returns — for undefined", () => {
    expect(formatDateFull(undefined)).toBe("—");
  });

  it("formats YYYY-MM-DD as dd/MM/YYYY", () => {
    expect(formatDateFull("2026-06-13")).toBe("13/06/2026");
  });
});

describe("formatDateTime", () => {
  it("returns — for null", () => {
    expect(formatDateTime(null)).toBe("—");
  });

  it("returns a non-empty string for a valid ISO datetime", () => {
    const result = formatDateTime("2026-06-13T08:30:00.000Z");
    expect(result.length).toBeGreaterThan(0);
    expect(result).not.toBe("—");
  });
});

describe("currentMonth", () => {
  it("returns a string matching YYYY-MM pattern", () => {
    expect(currentMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

describe("currentYear", () => {
  it("returns the current year as a number", () => {
    const year = currentYear();
    expect(typeof year).toBe("number");
    expect(year).toBeGreaterThanOrEqual(2026);
  });
});
