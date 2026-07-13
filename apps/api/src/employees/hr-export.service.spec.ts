/**
 * HR-PROFILE-UI-2 — HrExportService unit spec (RED-first). Isolates the service logic from the DB:
 * repo/db/audit/permission/data-scope are mocked so we can prove — without seeding 10k rows — that:
 *   - the export gate is resolveAndAssert(export, employee, {isSensitive:true}) (fail-closed, wildcard-safe);
 *   - the repo is asked for MAX+1 rows and a dataset over MAX throws 422 with NO audit written;
 *   - PII columns are BLANKED per-row when the caller lacks view-sensitive (server-side mask);
 *   - the append-only audit carries actor + exact count + resolved scope label.
 * The real scope/tenant/RLS/masking path is covered by hr-export.int.spec.ts.
 */

import { UnprocessableEntityException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HR_EMPLOYEE_EXPORT_MAX_ROWS } from "@mediaos/contracts";
import type { HrListRow } from "./hr-read.repository";
import { HrExportService } from "./hr-export.service";

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
};

function rowStub(over: Partial<HrListRow> = {}): HrListRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: USER.id,
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
    baseSalary: "1000",
    // HR-IDENTITY-READ-1: raw CCCD on the shared list row — the export forces these null (never a CSV column).
    identityNumber: "079123456789",
    identityIssueDate: "2020-01-15",
    identityIssuePlace: "HN",
    ...over,
  };
}

function build(rows: HrListRow[], scope = "Company", revealPii = true) {
  const repo = { listScopedForExportTx: vi.fn().mockResolvedValue(rows) };
  const tx = {} as never;
  const db = { withTenant: vi.fn(async (_c: string, fn: (t: never) => unknown) => fn(tx)) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const permission = { can: vi.fn().mockResolvedValue({ allow: revealPii, auditRequired: false }) };
  const dataScope = {
    resolveAndAssert: vi.fn().mockResolvedValue(scope),
    resolveContext: vi.fn().mockResolvedValue({ userId: USER.id, companyId: USER.companyId }),
    buildEmployeeScopeCondition: vi.fn().mockReturnValue(sql`true`),
  };
  const svc = new HrExportService(
    repo as never,
    db as never,
    permission as never,
    dataScope as never,
    audit as never,
  );
  return { svc, repo, db, audit, permission, dataScope };
}

describe("HrExportService", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gates via resolveAndAssert(export, employee, {isSensitive:true}) BEFORE any read", async () => {
    const { svc, dataScope, repo } = build([rowStub()]);
    await svc.exportEmployeesCsv(USER, {});
    expect(dataScope.resolveAndAssert).toHaveBeenCalledWith(
      USER.id,
      USER.companyId,
      "export",
      "employee",
      { isSensitive: true },
    );
    expect(repo.listScopedForExportTx).toHaveBeenCalled();
  });

  it("requests MAX+1 rows so it can detect over-cap without a truncated file", async () => {
    const { svc, repo } = build([rowStub()]);
    await svc.exportEmployeesCsv(USER, {});
    const limitArg = repo.listScopedForExportTx.mock.calls[0][4];
    expect(limitArg).toBe(HR_EMPLOYEE_EXPORT_MAX_ROWS + 1);
  });

  it("cap: dataset > MAX_ROWS → 422 (no silent truncate) and NO audit written", async () => {
    const over = Array.from({ length: HR_EMPLOYEE_EXPORT_MAX_ROWS + 1 }, () => rowStub());
    const { svc, audit } = build(over);
    await expect(svc.exportEmployeesCsv(USER, {})).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("exactly MAX_ROWS rows is allowed (boundary, not over cap)", async () => {
    const exact = Array.from({ length: HR_EMPLOYEE_EXPORT_MAX_ROWS }, () => rowStub());
    const { svc } = build(exact);
    const res = await svc.exportEmployeesCsv(USER, {});
    expect(res.count).toBe(HR_EMPLOYEE_EXPORT_MAX_ROWS);
  });

  it("caller WITH view-sensitive → PII cells carry values in the CSV", async () => {
    const { svc } = build([rowStub({ phone: "0912345678", gender: "Female" })], "Company", true);
    const res = await svc.exportEmployeesCsv(USER, {});
    expect(res.csv).toContain("0912345678");
    expect(res.csv).toContain("Female");
  });

  it("caller WITHOUT view-sensitive → PII cells BLANK (server-side mask, per-row)", async () => {
    const { svc, permission } = build(
      [rowStub({ phone: "0912345678", gender: "Female", dateOfBirth: "1991-02-03" })],
      "Company",
      false,
    );
    const res = await svc.exportEmployeesCsv(USER, {});
    // The PII values must NOT appear anywhere in the file.
    expect(res.csv).not.toContain("0912345678");
    expect(res.csv).not.toContain("Female");
    expect(res.csv).not.toContain("1991-02-03");
    // Masking is decided by the per-row view-sensitive check (isSensitive → wildcard cannot satisfy).
    expect(permission.can).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "view-sensitive",
        resourceType: "employee",
        isSensitive: true,
      }),
    );
  });

  it("baseSalary is NEVER emitted (salary-class excluded from HR_EMPLOYEE_EXPORT_COLUMNS)", async () => {
    const { svc } = build([rowStub({ baseSalary: "987654321" })], "Company", true);
    const res = await svc.exportEmployeesCsv(USER, {});
    expect(res.csv).not.toContain("987654321");
  });

  it("audit: append-only EmployeesExported with actor + resolved scope + exact count", async () => {
    const { svc, audit } = build([rowStub(), rowStub({ id: "id-2" })], "Team");
    const res = await svc.exportEmployeesCsv(USER, { status: "active" });
    expect(res.count).toBe(2);
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0][1];
    expect(entry).toMatchObject({
      action: "EmployeesExported",
      objectType: "employee",
      actorUserId: USER.id,
      actorType: "User",
      resultStatus: "Success",
      dataScope: "Team",
    });
    expect(entry.after).toMatchObject({ count: 2, scope: "Team" });
  });

  it("returns a CSV string with the header row and a filename", async () => {
    const { svc } = build([rowStub()]);
    const res = await svc.exportEmployeesCsv(USER, {});
    expect(res.csv).toContain("Mã nhân viên");
    expect(res.filename).toMatch(/employees-.*\.csv/);
  });
});
