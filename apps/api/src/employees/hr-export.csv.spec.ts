/**
 * HR-PROFILE-UI-2 — CSV serializer unit spec (RED-first). Proves the two properties a reviewer cares
 * about on a pure function: (1) formula-injection neutralization (=,+,-,@ prefixed with ') and (2)
 * RFC-4180 quoting/escaping (double-quote doubled; field with , " or newline wrapped) + UTF-8 BOM/CRLF.
 * Mirrors attendance-export.csv.spec.ts (S3-ATT-EXPORT-1) but over the HR_EMPLOYEE_EXPORT_COLUMNS set.
 */

import { describe, expect, it } from "vitest";
import type { HrEmployeeListItem } from "@mediaos/contracts";
import { serializeHrEmployeesCsv } from "./hr-export.csv";

/** Minimal list item — only the exported columns matter; the rest carry safe defaults. */
function item(over: Partial<HrEmployeeListItem>): HrEmployeeListItem {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-0000000000aa",
    employeeCode: "E001",
    fullName: "Nguyen Van A",
    email: "a@corp.test",
    orgUnitId: null,
    orgUnitName: "Engineering",
    positionId: null,
    positionName: "Engineer",
    workType: "fulltime",
    employmentType: "official",
    status: "active",
    avatarUrl: null,
    startDate: "2024-01-01",
    officialDate: "2024-03-01",
    workLocation: "HN",
    gender: "Male",
    dateOfBirth: "1990-01-01",
    phone: "0900000000",
    contractType: "permanent",
    baseSalary: null,
    ...over,
  } as HrEmployeeListItem;
}

describe("serializeHrEmployeesCsv", () => {
  it("prefixes UTF-8 BOM and uses CRLF line endings (Excel VI)", () => {
    const csv = serializeHrEmployeesCsv([item({})]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
  });

  it("emits the header row from HR_EMPLOYEE_EXPORT_COLUMNS in order", () => {
    const csv = serializeHrEmployeesCsv([]);
    const firstLine = csv.replace(/^\uFEFF/, "").split("\r\n")[0];
    expect(firstLine.startsWith("Mã nhân viên,Họ tên,Email,Đơn vị,Chức danh")).toBe(true);
  });

  it("neutralizes formula injection: a fullName starting with = gets a leading quote", () => {
    const csv = serializeHrEmployeesCsv([item({ fullName: "=cmd|' /C calc'!A1" })]);
    expect(csv).toContain("'=cmd|' /C calc'!A1");
    expect(csv).not.toContain(",=cmd|");
  });

  it("neutralizes +, -, @ leading chars too", () => {
    const csv = serializeHrEmployeesCsv([
      item({ fullName: "+1", employeeCode: "@SUM(A1)", orgUnitName: "-2+3" }),
    ]);
    expect(csv).toContain("'+1");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).toContain("'-2+3");
  });

  it("RFC-4180: wraps a field containing a comma and preserves it", () => {
    const csv = serializeHrEmployeesCsv([item({ fullName: "Nguyen, Van A" })]);
    expect(csv).toContain('"Nguyen, Van A"');
  });

  it("RFC-4180: doubles inner double-quotes and wraps", () => {
    const csv = serializeHrEmployeesCsv([item({ fullName: 'A "B" C' })]);
    expect(csv).toContain('"A ""B"" C"');
  });

  it("RFC-4180: wraps a field containing a newline", () => {
    const csv = serializeHrEmployeesCsv([item({ orgUnitName: "line1\nline2" })]);
    expect(csv).toContain('"line1\nline2"');
  });

  it("injection + comma combined: neutralized AND quoted", () => {
    const csv = serializeHrEmployeesCsv([item({ fullName: "=1,2" })]);
    expect(csv).toContain('"\'=1,2"');
  });

  it("renders null PII cells as empty (masked employee)", () => {
    const csv = serializeHrEmployeesCsv([
      item({ gender: null, dateOfBirth: null, phone: null, contractType: null }),
    ]);
    const dataLine = csv.replace(/^\uFEFF/, "").split("\r\n")[1];
    // trailing PII columns all blank → the row ends with several consecutive commas.
    expect(dataLine).toContain(",,");
    expect(dataLine.endsWith(",")).toBe(true);
  });
});
