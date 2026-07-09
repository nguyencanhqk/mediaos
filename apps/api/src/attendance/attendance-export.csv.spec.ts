/**
 * S3-ATT-EXPORT-1 — CSV serializer unit spec (RED-first). Proves the two properties a reviewer cares
 * about on a pure function: (1) formula-injection neutralization (=,+,-,@ prefixed with ') and (2)
 * RFC-4180 quoting/escaping (double-quote doubled; field with , " or newline wrapped) + UTF-8 BOM.
 */

import { describe, expect, it } from "vitest";
import type { AttendanceRecordListItem } from "@mediaos/contracts";
import { serializeAttendanceRecordsCsv } from "./attendance-export.csv";

/** Minimal list item — only the exported columns matter; the rest are filled with safe defaults. */
function item(over: Partial<AttendanceRecordListItem>): AttendanceRecordListItem {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    workDate: "2024-05-01",
    employeeId: null,
    shiftId: null,
    checkInAt: null,
    checkOutAt: null,
    checkInMethod: null,
    checkOutMethod: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    workingMinutes: 480,
    requiredWorkingMinutes: 480,
    missingMinutes: 0,
    breakMinutes: 60,
    status: "present",
    attendanceStatus: "Present",
    isLate: false,
    isEarlyLeave: false,
    isMissingCheckOut: false,
    userId: "00000000-0000-0000-0000-0000000000aa",
    employeeCode: "E001",
    fullName: "Nguyen Van A",
    orgUnitId: null,
    orgUnitName: "Engineering",
    ...over,
  } as AttendanceRecordListItem;
}

describe("serializeAttendanceRecordsCsv", () => {
  it("prefixes UTF-8 BOM and uses CRLF line endings (Excel VI)", () => {
    const csv = serializeAttendanceRecordsCsv([item({})]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
  });

  it("emits the header row from ATTENDANCE_EXPORT_COLUMNS in order", () => {
    const csv = serializeAttendanceRecordsCsv([]);
    const firstLine = csv.replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(firstLine.startsWith("Ngày công,Mã nhân viên,Họ tên,Phòng ban")).toBe(true);
  });

  it("neutralizes formula injection: a fullName starting with = gets a leading quote", () => {
    const csv = serializeAttendanceRecordsCsv([item({ fullName: "=cmd|' /C calc'!A1" })]);
    // Neutralized cell has NO comma/quote so it is NOT wrapped — just prefixed with '.
    expect(csv).toContain("'=cmd|' /C calc'!A1");
    // The raw un-neutralized token must NOT appear as a standalone cell start.
    expect(csv).not.toContain(",=cmd|");
  });

  it("neutralizes +, -, @ leading chars too", () => {
    const csv = serializeAttendanceRecordsCsv([
      item({ fullName: "+1", employeeCode: "@SUM(A1)", orgUnitName: "-2+3" }),
    ]);
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'-2+3");
  });

  it("does NOT neutralize legitimate numeric columns (no leading quote on -/+ numbers)", () => {
    const csv = serializeAttendanceRecordsCsv([item({ lateMinutes: 15, workingMinutes: 480 })]);
    expect(csv).toContain(",15,");
    expect(csv).not.toContain("'15");
  });

  it("RFC-4180: wraps a field containing a comma and preserves it", () => {
    const csv = serializeAttendanceRecordsCsv([item({ fullName: "Nguyen, Van A" })]);
    expect(csv).toContain('"Nguyen, Van A"');
  });

  it("RFC-4180: doubles inner double-quotes and wraps", () => {
    const csv = serializeAttendanceRecordsCsv([item({ fullName: 'A "B" C' })]);
    expect(csv).toContain('"A ""B"" C"');
  });

  it("RFC-4180: wraps a field containing a newline", () => {
    const csv = serializeAttendanceRecordsCsv([item({ orgUnitName: "line1\nline2" })]);
    expect(csv).toContain('"line1\nline2"');
  });

  it("injection + comma combined: neutralized AND quoted", () => {
    const csv = serializeAttendanceRecordsCsv([item({ fullName: "=1,2" })]);
    expect(csv).toContain('"\'=1,2"');
  });

  it("renders null cells as empty", () => {
    const csv = serializeAttendanceRecordsCsv([item({ checkInAt: null, checkOutAt: null })]);
    const dataLine = csv.replace(/^\uFEFF/, "").split("\r\n")[1];
    // workDate,employeeCode,fullName,orgUnitName,checkInAt(empty),checkOutAt(empty),...
    expect(dataLine).toContain(",,"); // consecutive empties for the two null timestamps
  });
});
