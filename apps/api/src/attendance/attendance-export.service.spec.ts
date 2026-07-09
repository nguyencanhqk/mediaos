/**
 * S3-ATT-EXPORT-1 — AttendanceExportService unit spec (RED-first). Isolates the service logic from the
 * DB: the repo/db/audit/data-scope are mocked so we can prove the cap-and-422 and the audit shape without
 * seeding 10k rows. The real scope/tenant/masking path is covered by attendance-export.int.spec.ts.
 */

import { UnprocessableEntityException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTENDANCE_EXPORT_MAX_ROWS } from "@mediaos/contracts";
import type { AttRecordListRow } from "./attendance-read.repository";
import { AttendanceExportService } from "./attendance-export.service";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
};

function rowStub(over: Partial<AttRecordListRow> = {}): AttRecordListRow {
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
    userId: USER.id,
    employeeCode: "E001",
    fullName: "Nguyen Van A",
    orgUnitId: null,
    orgUnitName: "Engineering",
    ...over,
  } as AttRecordListRow;
}

function build(rows: AttRecordListRow[], scope = "Company") {
  const repo = { listScopedRecordsForExportTx: vi.fn().mockResolvedValue(rows) };
  const tx = {} as never;
  const db = { withTenant: vi.fn(async (_c: string, fn: (t: never) => unknown) => fn(tx)) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const dataScope = {
    resolveAndAssert: vi.fn().mockResolvedValue(scope),
    resolveContext: vi.fn().mockResolvedValue({ userId: USER.id, companyId: USER.companyId }),
    buildEmployeeScopeCondition: vi.fn().mockReturnValue(sql`true`),
  };
  const svc = new AttendanceExportService(
    repo as never,
    db as never,
    dataScope as never,
    audit as never,
  );
  return { svc, repo, db, audit, dataScope };
}

describe("AttendanceExportService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates via resolveAndAssert(export, attendance, isSensitive) BEFORE any read", async () => {
    const { svc, dataScope, repo } = build([rowStub()]);
    await svc.exportRecordsCsv(USER, {});
    expect(dataScope.resolveAndAssert).toHaveBeenCalledWith(
      USER.id,
      USER.companyId,
      "export",
      "attendance",
      { isSensitive: true },
    );
    expect(repo.listScopedRecordsForExportTx).toHaveBeenCalled();
  });

  it("requests cap+1 rows so it can detect over-cap without a truncated file", async () => {
    const { svc, repo } = build([rowStub()]);
    await svc.exportRecordsCsv(USER, {});
    const limitArg = repo.listScopedRecordsForExportTx.mock.calls[0][4];
    expect(limitArg).toBe(ATTENDANCE_EXPORT_MAX_ROWS + 1);
  });

  it("cap: dataset > MAX_EXPORT_ROWS → 422 (no silent truncate) and NO audit written", async () => {
    const over = Array.from({ length: ATTENDANCE_EXPORT_MAX_ROWS + 1 }, () => rowStub());
    const { svc, audit } = build(over);
    await expect(svc.exportRecordsCsv(USER, {})).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("exactly MAX_EXPORT_ROWS rows is allowed (boundary, not over cap)", async () => {
    const exact = Array.from({ length: ATTENDANCE_EXPORT_MAX_ROWS }, () => rowStub());
    const { svc } = build(exact);
    const res = await svc.exportRecordsCsv(USER, {});
    expect(res.count).toBe(ATTENDANCE_EXPORT_MAX_ROWS);
  });

  it("audit: actorUserId=caller, actorType=User, resultStatus=Success, dataScope=resolved scope, count", async () => {
    const { svc, audit } = build([rowStub(), rowStub()], "Team");
    const res = await svc.exportRecordsCsv(USER, { fromDate: "2024-05-01", toDate: "2024-06-01" });
    expect(res.count).toBe(2);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1];
    expect(entry).toMatchObject({
      action: "AttendanceRecordsExported",
      objectType: "attendance_record",
      actorUserId: USER.id,
      actorType: "User",
      resultStatus: "Success",
      dataScope: "Team",
    });
    expect(entry.after).toMatchObject({ count: 2, fromDate: "2024-05-01", toDate: "2024-06-01" });
  });

  it("returns a CSV string with the header row and a filename", async () => {
    const { svc } = build([rowStub()]);
    const res = await svc.exportRecordsCsv(USER, {});
    expect(res.csv).toContain("Ngày công");
    expect(res.filename).toMatch(/attendance-records-.*\.csv/);
  });
});
