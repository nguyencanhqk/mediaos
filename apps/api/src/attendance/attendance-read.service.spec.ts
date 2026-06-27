/**
 * S3-ATT-BE-2 — AttendanceReadService deny-path RED suite (FULL gate, BẤT BIẾN #1/#3).
 *
 * Mocked unit (no DB). Proves, before any DB exists, that the scope/mask logic is correct:
 *  - GATE: team/company/detail call resolveAndAssert with the route's EXACT pair (sensitive); my-records
 *    does NOT (it is self-locked, view-own is the controller gate).
 *  - SCOPE = filter: the RESOLVED scope flows into buildEmployeeScopeCondition, predicate handed to the
 *    repo untouched (never a hard-coded role check).
 *  - DETAIL/LOGS: out-of-scope (isEmployeeInScope=false) OR missing row → NotFound (404, no leak).
 *  - MASK: view-sensitive reveal true → location_json / gps / ip / device KEPT; false → all null, but a
 *    log's isValid is ALWAYS present (no own-record bypass).
 *  - LIST never carries location/gps/ip/device keys at all.
 */

import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { AttendanceReadService } from "./attendance-read.service";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const REC_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const REC_USER_ID = "22222222-2222-2222-2222-222222222222";
const OU_ID = "33333333-3333-3333-3333-333333333333";

const actorA = { id: ACTOR_ID, companyId: COMPANY_A };
const baseQuery = {
  page: 1,
  pageSize: 20,
  sort: "workDate" as const,
  order: "desc" as const,
};

/** A scope predicate sentinel — the service must AND this into the list query untouched. */
const SCOPE_COND = Symbol("scope-cond");
const FAKE_TX = { __tx: true };

function makeListRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REC_ID,
    userId: REC_USER_ID,
    workDate: "2024-06-03",
    employeeId: null,
    shiftId: null,
    checkInAt: null,
    checkOutAt: null,
    checkInMethod: null,
    checkOutMethod: null,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    workingMinutes: null,
    requiredWorkingMinutes: null,
    missingMinutes: null,
    breakMinutes: null,
    status: "present",
    attendanceStatus: "Present",
    isLate: null,
    isEarlyLeave: null,
    isMissingCheckOut: null,
    employeeCode: "E-001",
    fullName: "Nguyen Van A",
    orgUnitId: OU_ID,
    orgUnitName: "Engineering",
    ...overrides,
  };
}

function makeDetailRow(overrides: Record<string, unknown> = {}) {
  return {
    ...makeListRow(),
    companyId: COMPANY_A,
    directManagerUserId: null,
    locationJson: { lat: 10.77, lng: 106.7, label: "HQ" },
    workScheduleId: null,
    checkInStatus: "On Time",
    checkOutStatus: null,
    attendanceSource: "WEB",
    workMode: "Office",
    createdAt: new Date("2024-06-03T01:00:00Z"),
    updatedAt: new Date("2024-06-03T10:00:00Z"),
    ...overrides,
  };
}

function makeLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "99999999-9999-9999-9999-999999999999",
    logType: "Check-in",
    logTime: new Date("2024-06-03T01:00:00Z"),
    source: "WEB",
    platform: "web",
    clientTime: null,
    clientTimezone: null,
    isValid: true,
    invalidReason: null,
    note: null,
    workDate: "2024-06-03",
    gpsLatitude: "10.7700000",
    gpsLongitude: "106.7000000",
    gpsAccuracyMeters: "5.00",
    locationLabel: "HQ",
    ipAddress: "1.2.3.4",
    deviceId: "dev-1",
    deviceName: "iPhone",
    userAgent: "UA/1.0",
    rawPayload: { a: 1 },
    ...overrides,
  };
}

function makeDb() {
  return {
    withTenant: vi.fn((_companyId: string, fn: (tx: unknown) => Promise<unknown>) => fn(FAKE_TX)),
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    listMyRecordsTx: vi.fn().mockResolvedValue({ rows: [makeListRow()], total: 1 }),
    listScopedRecordsTx: vi.fn().mockResolvedValue({ rows: [makeListRow()], total: 1 }),
    findRecordDetailTx: vi.fn().mockResolvedValue(makeDetailRow()),
    findLogsByRecordTx: vi.fn().mockResolvedValue([makeLogRow()]),
    ...overrides,
  };
}

function makePermission(viewSensitiveAllow: boolean) {
  return {
    can: vi.fn(async () => ({ allow: viewSensitiveAllow, reason: "x", auditRequired: true })),
  };
}

function makeDataScope(opts: {
  scope?: string | null;
  inScope?: boolean;
  throwOnAssert?: boolean;
}) {
  const resolveAndAssert = vi.fn(async () => {
    if (opts.throwOnAssert) throw new NotFoundException("should be Forbidden in real impl");
    return opts.scope ?? "Company";
  });
  return {
    resolveAndAssert,
    resolveContext: vi
      .fn()
      .mockResolvedValue({ userId: ACTOR_ID, companyId: COMPANY_A, orgUnitId: null }),
    buildEmployeeScopeCondition: vi.fn().mockReturnValue(SCOPE_COND),
    isEmployeeInScope: vi.fn().mockReturnValue(opts.inScope ?? true),
  };
}

function makeService(
  opts: {
    repo?: ReturnType<typeof makeRepo>;
    dataScope?: ReturnType<typeof makeDataScope>;
    viewSensitive?: boolean;
  } = {},
) {
  const repo = opts.repo ?? makeRepo();
  const db = makeDb();
  const permission = makePermission(opts.viewSensitive ?? false);
  const dataScope = opts.dataScope ?? makeDataScope({ scope: "Company", inScope: true });
  const svc = new AttendanceReadService(
    repo as never,
    db as never,
    permission as never,
    dataScope as never,
  );
  return { svc, repo, db, permission, dataScope };
}

// ─── my-records: self-locked, NOT a scope query ───────────────────────────────────

describe("AttendanceReadService.listMyRecords", () => {
  it("does NOT call resolveAndAssert (view-own is the controller gate) and queries by user.id", async () => {
    const { svc, repo, dataScope } = makeService();
    const res = await svc.listMyRecords(actorA, baseQuery);

    expect(dataScope.resolveAndAssert).not.toHaveBeenCalled();
    expect(repo.listMyRecordsTx).toHaveBeenCalledWith(
      FAKE_TX,
      COMPANY_A,
      ACTOR_ID,
      expect.objectContaining({ page: 1, pageSize: 20 }),
    );
    expect(repo.listScopedRecordsTx).not.toHaveBeenCalled();
    expect(res.items).toHaveLength(1);
  });

  it("list item carries NO location/gps/ip/device keys", async () => {
    const { svc } = makeService();
    const res = await svc.listMyRecords(actorA, baseQuery);
    const item = res.items[0] as Record<string, unknown>;
    for (const k of [
      "locationJson",
      "gpsLatitude",
      "ipAddress",
      "deviceId",
      "deviceName",
      "userAgent",
    ]) {
      expect(k in item).toBe(false);
    }
  });

  it("ignores employeeId/departmentId on my-records (cannot widen past own rows)", async () => {
    const { svc, repo } = makeService();
    await svc.listMyRecords(actorA, {
      ...baseQuery,
      employeeId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      departmentId: OU_ID,
    } as never);
    const filters = repo.listMyRecordsTx.mock.calls[0][3];
    expect(filters.employeeId).toBeUndefined();
    expect(filters.departmentId).toBeUndefined();
  });
});

// ─── team/company: gate + scope filter ─────────────────────────────────────────────

describe("AttendanceReadService scoped lists — gate + filter", () => {
  it("team-records: resolveAndAssert with EXACT pair view-team:attendance (sensitive) → scope predicate", async () => {
    const dataScope = makeDataScope({ scope: "Team", inScope: true });
    const { svc, repo } = makeService({ dataScope });

    await svc.listTeamRecords(actorA, baseQuery);

    expect(dataScope.resolveAndAssert).toHaveBeenCalledWith(
      ACTOR_ID,
      COMPANY_A,
      "view-team",
      "attendance",
      { isSensitive: true },
    );
    expect(dataScope.buildEmployeeScopeCondition).toHaveBeenCalledWith(
      "Team",
      expect.objectContaining({ userId: ACTOR_ID, companyId: COMPANY_A }),
    );
    expect(repo.listScopedRecordsTx).toHaveBeenCalledWith(
      FAKE_TX,
      COMPANY_A,
      SCOPE_COND,
      expect.anything(),
    );
  });

  it("company-records: resolveAndAssert with EXACT pair view-company:attendance (sensitive)", async () => {
    const dataScope = makeDataScope({ scope: "Company", inScope: true });
    const { svc } = makeService({ dataScope });
    await svc.listCompanyRecords(actorA, baseQuery);
    expect(dataScope.resolveAndAssert).toHaveBeenCalledWith(
      ACTOR_ID,
      COMPANY_A,
      "view-company",
      "attendance",
      { isSensitive: true },
    );
  });

  it("DENY: no grant → resolveAndAssert throws BEFORE any repo read", async () => {
    const repo = makeRepo();
    const dataScope = makeDataScope({ throwOnAssert: true });
    const { svc } = makeService({ repo, dataScope });
    await expect(svc.listTeamRecords(actorA, baseQuery)).rejects.toThrow();
    expect(repo.listScopedRecordsTx).not.toHaveBeenCalled();
  });

  it("paginated envelope meta correct (total/totalPages/hasNext/hasPrev)", async () => {
    const repo = makeRepo({
      listScopedRecordsTx: vi.fn().mockResolvedValue({ rows: [makeListRow()], total: 5 }),
    });
    const { svc } = makeService({ repo });
    const res = await svc.listCompanyRecords(actorA, {
      page: 1,
      pageSize: 2,
      sort: "workDate",
      order: "desc",
    } as never);
    expect(res.meta).toEqual({
      page: 1,
      pageSize: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
    });
  });
});

// ─── detail: gate + scope + mask ────────────────────────────────────────────────────

describe("AttendanceReadService.getRecordDetail", () => {
  it("resolveAndAssert with EXACT pair view-detail:attendance (sensitive)", async () => {
    const dataScope = makeDataScope({ scope: "Company", inScope: true });
    const { svc } = makeService({ dataScope });
    await svc.getRecordDetail(actorA, REC_ID);
    expect(dataScope.resolveAndAssert).toHaveBeenCalledWith(
      ACTOR_ID,
      COMPANY_A,
      "view-detail",
      "attendance",
      { isSensitive: true },
    );
  });

  it("out-of-scope (isEmployeeInScope=false) → NotFound (404, no existence leak)", async () => {
    const dataScope = makeDataScope({ scope: "Own", inScope: false });
    const { svc } = makeService({ dataScope });
    await expect(svc.getRecordDetail(actorA, REC_ID)).rejects.toThrow(NotFoundException);
  });

  it("cross-tenant row (different companyId) → NotFound", async () => {
    const repo = makeRepo({
      findRecordDetailTx: vi.fn().mockResolvedValue(makeDetailRow({ companyId: COMPANY_B })),
    });
    // isEmployeeInScope is the REAL guard for cross-tenant; emulate it returning false.
    const dataScope = makeDataScope({ scope: "Company", inScope: false });
    const { svc } = makeService({ repo, dataScope });
    await expect(svc.getRecordDetail(actorA, REC_ID)).rejects.toThrow(NotFoundException);
  });

  it("missing row → NotFound", async () => {
    const repo = makeRepo({ findRecordDetailTx: vi.fn().mockResolvedValue(undefined) });
    const { svc } = makeService({ repo });
    await expect(svc.getRecordDetail(actorA, REC_ID)).rejects.toThrow(NotFoundException);
  });

  it("WITHOUT view-sensitive → locationJson null", async () => {
    const { svc } = makeService({ viewSensitive: false });
    const res = await svc.getRecordDetail(actorA, REC_ID);
    expect(res.locationJson).toBeNull();
  });

  it("WITH view-sensitive → locationJson revealed (real object)", async () => {
    const { svc } = makeService({ viewSensitive: true });
    const res = await svc.getRecordDetail(actorA, REC_ID);
    expect(res.locationJson).toEqual({ lat: 10.77, lng: 106.7, label: "HQ" });
  });
});

// ─── logs: gate + scope + per-field mask ────────────────────────────────────────────

describe("AttendanceReadService.getRecordLogs", () => {
  it("out-of-scope parent record → NotFound (logs never reached)", async () => {
    const repo = makeRepo();
    const dataScope = makeDataScope({ scope: "Own", inScope: false });
    const { svc } = makeService({ repo, dataScope });
    await expect(svc.getRecordLogs(actorA, REC_ID)).rejects.toThrow(NotFoundException);
    expect(repo.findLogsByRecordTx).not.toHaveBeenCalled();
  });

  it("WITHOUT view-sensitive → every sensitive field null, isValid still present (no own bypass)", async () => {
    const { svc } = makeService({ viewSensitive: false });
    const res = await svc.getRecordLogs(actorA, REC_ID);
    const log = res.items[0];
    expect(log.isValid).toBe(true);
    expect(log.logType).toBe("Check-in");
    for (const k of [
      "gpsLatitude",
      "gpsLongitude",
      "gpsAccuracyMeters",
      "locationLabel",
      "ipAddress",
      "deviceId",
      "deviceName",
      "userAgent",
      "rawPayload",
    ] as const) {
      expect(log[k]).toBeNull();
    }
  });

  it("WITH view-sensitive → real gps/ip/device kept", async () => {
    const { svc } = makeService({ viewSensitive: true });
    const res = await svc.getRecordLogs(actorA, REC_ID);
    const log = res.items[0];
    expect(log.gpsLatitude).toBe("10.7700000");
    expect(log.ipAddress).toBe("1.2.3.4");
    expect(log.deviceId).toBe("dev-1");
    expect(log.rawPayload).toEqual({ a: 1 });
  });
});
