/**
 * S3-QA-1 — pure UNIT (mocked repo/db/audit/permission, no Postgres) coverage-gap fill for
 * AttendanceService's work-schedule + period-list surface (`listSchedules`/`createSchedule`/
 * `updateSchedule`/`listPeriods`). attendance.service.spec.ts (G11-1) already covers check-in/out
 * guards + lockPeriod + listMonthly scope deny — it never exercises these 4 methods (0% before this
 * file). KHÔNG sửa production code, KHÔNG sửa file spec đã có — file mới hẳn, chỉ lấp khoảng trống.
 */

import { describe, expect, it, vi } from "vitest";
import { InternalServerErrorException, NotFoundException } from "@nestjs/common";
import { AttendanceService } from "./attendance.service";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTOR_ID = "11111111-1111-1111-1111-111111111111";
const actor = { id: ACTOR_ID, companyId: COMPANY_ID };

function makeScheduleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sched-1",
    name: "Ca hành chính",
    workType: "fixed",
    startTime: "08:00",
    endTime: "17:00",
    workingDaysJson: [1, 2, 3, 4, 5],
    timezone: "Asia/Ho_Chi_Minh",
    graceMinutes: 5,
    isDefault: false,
    status: "active",
    createdAt: new Date("2024-01-01T00:00:00Z"),
    updatedAt: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeRepo(overrides: Record<string, unknown> = {}) {
  return {
    findSchedules: vi.fn().mockResolvedValue([]),
    createScheduleTx: vi.fn().mockResolvedValue([makeScheduleRow()]),
    findScheduleByIdTx: vi.fn().mockResolvedValue([makeScheduleRow()]),
    updateScheduleTx: vi.fn().mockResolvedValue([makeScheduleRow({ name: "Ca đã sửa" })]),
    findPeriods: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeDb(repo: ReturnType<typeof makeRepo>) {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(repo)),
  };
}

const makePermission = () => ({ can: vi.fn().mockResolvedValue({ allow: true }) });
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });
const makeOutbox = () => ({ enqueue: vi.fn().mockResolvedValue(undefined) });

function build(repo: ReturnType<typeof makeRepo>) {
  const audit = makeAudit();
  const service = new AttendanceService(
    makeDb(repo) as never,
    repo as never,
    makePermission() as never,
    audit as never,
    makeOutbox() as never,
  );
  return { service, audit };
}

const CREATE_DTO = {
  name: "Ca hành chính",
  workType: "fixed" as const,
  startTime: "08:00",
  endTime: "17:00",
  workingDays: [1, 2, 3, 4, 5],
  timezone: "Asia/Ho_Chi_Minh",
  graceMinutes: 5,
  isDefault: false,
};

describe("AttendanceService — listSchedules", () => {
  it("maps repo rows through toScheduleDto", async () => {
    const repo = makeRepo({ findSchedules: vi.fn().mockResolvedValue([makeScheduleRow()]) });
    const { service } = build(repo);
    const out = await service.listSchedules(COMPANY_ID);
    expect(repo.findSchedules).toHaveBeenCalledWith(COMPANY_ID);
    expect(out).toEqual([
      expect.objectContaining({ id: "sched-1", name: "Ca hành chính", isDefault: false }),
    ]);
  });
});

describe("AttendanceService — createSchedule", () => {
  it("creates + audits WorkScheduleCreated + returns the DTO", async () => {
    const repo = makeRepo();
    const { service, audit } = build(repo);
    const out = await service.createSchedule(actor, CREATE_DTO);
    expect(repo.createScheduleTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0][1] as { action: string }).action).toBe(
      "WorkScheduleCreated",
    );
    expect(out).toMatchObject({ id: "sched-1" });
  });

  it("rejects an invalid IANA timezone before touching the repo", async () => {
    const repo = makeRepo();
    const { service } = build(repo);
    await expect(
      service.createSchedule(actor, { ...CREATE_DTO, timezone: "Not/A_Real_Zone" }),
    ).rejects.toThrow(RangeError);
    expect(repo.createScheduleTx).not.toHaveBeenCalled();
  });

  it("repo returning no row → InternalServerErrorException (mapped, not a raw 500 leak)", async () => {
    const repo = makeRepo({ createScheduleTx: vi.fn().mockResolvedValue([]) });
    const { service } = build(repo);
    await expect(service.createSchedule(actor, CREATE_DTO)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("AttendanceService — updateSchedule", () => {
  it("not found → NotFoundException", async () => {
    const repo = makeRepo({ findScheduleByIdTx: vi.fn().mockResolvedValue([]) });
    const { service } = build(repo);
    await expect(service.updateSchedule(actor, "missing-id", { name: "x" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("found → updates + audits WorkScheduleUpdated (before/after) + returns the DTO", async () => {
    const repo = makeRepo();
    const { service, audit } = build(repo);
    const out = await service.updateSchedule(actor, "sched-1", { name: "Ca đã sửa" });
    expect(repo.updateScheduleTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect((audit.record.mock.calls[0][1] as { action: string }).action).toBe(
      "WorkScheduleUpdated",
    );
    expect(out).toMatchObject({ name: "Ca đã sửa" });
  });

  it("rejects an invalid IANA timezone on update before touching the repo", async () => {
    const repo = makeRepo();
    const { service } = build(repo);
    await expect(
      service.updateSchedule(actor, "sched-1", { timezone: "Not/A_Real_Zone" }),
    ).rejects.toThrow(RangeError);
    expect(repo.findScheduleByIdTx).not.toHaveBeenCalled();
  });

  it("repo update returning no row → InternalServerErrorException", async () => {
    const repo = makeRepo({ updateScheduleTx: vi.fn().mockResolvedValue([]) });
    const { service } = build(repo);
    await expect(service.updateSchedule(actor, "sched-1", { name: "x" })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe("AttendanceService — listPeriods", () => {
  it("maps repo rows through toPeriodDto", async () => {
    const repo = makeRepo({
      findPeriods: vi.fn().mockResolvedValue([
        {
          id: "p1",
          periodMonth: "2024-06",
          status: "open",
          lockedBy: null,
          lockedAt: null,
        },
      ]),
    });
    const { service } = build(repo);
    const out = await service.listPeriods(COMPANY_ID, { limit: 50, offset: 0 });
    expect(repo.findPeriods).toHaveBeenCalledWith(COMPANY_ID, { limit: 50, offset: 0 });
    expect(out).toEqual([
      expect.objectContaining({ id: "p1", periodMonth: "2024-06", status: "open" }),
    ]);
  });
});
