/**
 * S3-QA-1 — pure UNIT (mocked repo/db/audit, no Postgres) coverage-gap fill for
 * AttendanceLeaveSyncService. attendance-leave-sync.int.spec.ts (S3-INT-1) already proves the HAPPY
 * paths on a real DB (approve full-day → sync create; cancel/revoke synced day → revert) — it always
 * calls `syncApprovedRequestTx` directly (never the `onLeaveApproved` EventBus wrapper) and always
 * fixtures a Full-Day, no-pre-existing-record, syncable day. That leaves several branches genuinely
 * untested: the EventBus entrypoint itself, the non-syncable/no-owning-user/insert-fails/update-fails
 * error branches, the "record already exists" UPDATE branch, the partial-day (Half Day) patch branch,
 * the shift-not-resolvable branch, and the revert "nothing to revert"/"revert update fails" branches.
 *
 * KHÔNG sửa production code — thuần bổ sung test để lấp khoảng trống coverage (S3-QA-1 plan mục
 * "Lệnh verify" — PLAN-FIX BLOCKING).
 */

import { describe, expect, it, vi } from "vitest";
import { AttendanceLeaveSyncService } from "./attendance-leave-sync.service";
import type { SyncableDayRow } from "./attendance-leave-sync.repository";

const COMPANY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const REQUEST_ID = "rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const EMP_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const TX = {} as never;

function makeDay(overrides: Record<string, unknown> = {}): SyncableDayRow {
  return {
    id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    companyId: COMPANY_ID,
    leaveRequestId: REQUEST_ID,
    employeeId: EMP_ID,
    leaveTypeId: "ltltltlt-ltlt-ltlt-ltlt-ltltltltltlt",
    workDate: "2024-06-03",
    dayType: "Full Day",
    leaveMinutes: 480,
    isWorkingDay: true,
    isPublicHoliday: false,
    attendanceSyncStatus: "Pending",
    attendanceSyncError: null,
    attendanceRecordId: null,
    status: "Active",
    ...overrides,
  } as unknown as SyncableDayRow;
}

function makeExistingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "rrrrrrrr-1111-1111-1111-rrrrrrrrrrrr",
    checkInAt: null,
    checkOutAt: null,
    workingMinutes: null,
    requiredWorkingMinutes: 480,
    lateMinutes: 0,
    earlyLeaveMinutes: 0,
    attendanceStatus: "Checked-in",
    ...overrides,
  };
}

function makeSyncRepo(overrides: Record<string, unknown> = {}) {
  return {
    findSyncableDaysTx: vi.fn().mockResolvedValue([]),
    findRequestUserIdTx: vi.fn().mockResolvedValue(USER_ID),
    findEmployeeContextTx: vi
      .fn()
      .mockResolvedValue({ id: EMP_ID, orgUnitId: null, positionId: null }),
    findRecordByEmployeeDateTx: vi.fn().mockResolvedValue([]),
    insertRecordTx: vi.fn().mockResolvedValue([{ id: "rec-inserted" }]),
    updateRecordTx: vi.fn().mockResolvedValue([{ id: "rec-updated" }]),
    updateDaySyncStatusTx: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeAttRepo(overrides: Record<string, unknown> = {}) {
  return {
    resolveEffectiveShiftTx: vi.fn().mockResolvedValue(null),
    findDefaultShiftTx: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
}

function makeAudit() {
  return { record: vi.fn().mockResolvedValue(undefined) };
}

function makeDb() {
  return {
    withTenant: vi
      .fn()
      .mockImplementation((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(TX)),
  };
}

function build(
  syncRepo: ReturnType<typeof makeSyncRepo>,
  attRepo: ReturnType<typeof makeAttRepo> = makeAttRepo(),
  audit: ReturnType<typeof makeAudit> = makeAudit(),
) {
  const db = makeDb();
  const service = new AttendanceLeaveSyncService(
    db as never,
    attRepo as never,
    syncRepo as never,
    audit as never,
  );
  return { service, db, audit };
}

function failedCall(syncRepo: ReturnType<typeof makeSyncRepo>) {
  return syncRepo.updateDaySyncStatusTx.mock.calls.find(
    (c) => (c[2] as { attendanceSyncStatus: string }).attendanceSyncStatus === "Failed",
  );
}

// ─── onLeaveApproved (EventBus entrypoint) — CHƯA từng gọi qua trong int-spec ──────────

describe("AttendanceLeaveSyncService — onLeaveApproved (EventBus entrypoint)", () => {
  it("missing requestId trong payload → bỏ qua, KHÔNG mở withTenant", async () => {
    const syncRepo = makeSyncRepo();
    const { service, db } = build(syncRepo);
    await service.onLeaveApproved({
      eventId: "e1",
      companyId: COMPANY_ID,
      eventType: "leave.request.approved",
      payload: {},
    });
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it("có requestId → mở withTenant(companyId, fn) rồi chạy syncApprovedRequestTx thật", async () => {
    const syncRepo = makeSyncRepo({ findSyncableDaysTx: vi.fn().mockResolvedValue([]) });
    const { service, db } = build(syncRepo);
    await service.onLeaveApproved({
      eventId: "e2",
      companyId: COMPANY_ID,
      eventType: "leave.request.approved",
      payload: { requestId: REQUEST_ID, approvedBy: USER_ID },
    });
    expect(db.withTenant).toHaveBeenCalledWith(COMPANY_ID, expect.any(Function));
    expect(syncRepo.findSyncableDaysTx).toHaveBeenCalledWith(COMPANY_ID, REQUEST_ID, TX, [
      "Pending",
    ]);
  });
});

// ─── syncApprovedRequestTx — nhánh non-syncable / no-user / insert / update / partial ──

describe("AttendanceLeaveSyncService — syncApprovedRequestTx", () => {
  it("ngày KHÔNG syncable (isWorkingDay=false) → 'Not Required', KHÔNG chạm syncOneDayTx", async () => {
    const day = makeDay({ isWorkingDay: false });
    const syncRepo = makeSyncRepo({ findSyncableDaysTx: vi.fn().mockResolvedValue([day]) });
    const { service } = build(syncRepo);
    const processed = await service.syncApprovedRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(processed).toBe(0);
    expect(syncRepo.updateDaySyncStatusTx).toHaveBeenCalledWith(
      COMPANY_ID,
      day.id,
      { attendanceSyncStatus: "Not Required", updatedBy: USER_ID },
      TX,
    );
    expect(syncRepo.findEmployeeContextTx).not.toHaveBeenCalled();
  });

  it("request KHÔNG có owning user_id → per-day 'Failed' (bị bắt, KHÔNG throw ra ngoài)", async () => {
    const day = makeDay();
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      findRequestUserIdTx: vi.fn().mockResolvedValue(null),
    });
    const { service } = build(syncRepo);
    const processed = await service.syncApprovedRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(processed).toBe(0);
    const fail = failedCall(syncRepo);
    expect(fail).toBeDefined();
    expect((fail![2] as { attendanceSyncError: string }).attendanceSyncError).toContain(
      "owning user_id",
    );
  });

  it("Full Day + KHÔNG có record sẵn → INSERT + audit create + 'Synced'", async () => {
    const day = makeDay({ dayType: "Full Day" });
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      insertRecordTx: vi.fn().mockResolvedValue([{ id: "rec-new" }]),
    });
    const { service, audit } = build(syncRepo);
    const processed = await service.syncApprovedRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(processed).toBe(1);
    expect(syncRepo.insertRecordTx).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "attendance.leave_sync.create", objectId: "rec-new" }),
    );
    const last = syncRepo.updateDaySyncStatusTx.mock.calls.at(-1)![2] as Record<string, unknown>;
    expect(last).toMatchObject({ attendanceSyncStatus: "Synced", attendanceRecordId: "rec-new" });
  });

  it("Full Day + record ĐÃ có sẵn (đã check-in trước) → UPDATE + audit update (KHÔNG insert)", async () => {
    const day = makeDay({ dayType: "Full Day" });
    const existing = makeExistingRecord({ checkInAt: new Date("2024-06-03T01:00:00Z") });
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      findRecordByEmployeeDateTx: vi.fn().mockResolvedValue([existing]),
      updateRecordTx: vi.fn().mockResolvedValue([{ id: existing.id }]),
    });
    const { service, audit } = build(syncRepo);
    const processed = await service.syncApprovedRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(processed).toBe(1);
    expect(syncRepo.updateRecordTx).toHaveBeenCalledTimes(1);
    expect(syncRepo.insertRecordTx).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: "attendance.leave_sync.update", objectId: existing.id }),
    );
  });

  it("Half Day (partial) không resolve được shift + KHÔNG record sẵn → buildPartialSyncPatch 'Not Checked-in', shiftId null", async () => {
    const day = makeDay({ dayType: "Half Day", leaveMinutes: 240 });
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      insertRecordTx: vi.fn().mockResolvedValue([{ id: "rec-half" }]),
    });
    const attRepo = makeAttRepo(); // resolveEffectiveShiftTx + findDefaultShiftTx đều null
    const { service } = build(syncRepo, attRepo);
    const processed = await service.syncApprovedRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(processed).toBe(1);
    const values = syncRepo.insertRecordTx.mock.calls[0][1] as Record<string, unknown>;
    expect(values.attendanceStatus).toBe("Not Checked-in");
    expect(values.shiftId).toBeNull();
  });

  it("insertRecordTx trả về rỗng (INSERT thất bại) → catch → 'Failed'", async () => {
    const day = makeDay({ dayType: "Full Day" });
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      insertRecordTx: vi.fn().mockResolvedValue([]),
    });
    const { service } = build(syncRepo);
    const processed = await service.syncApprovedRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(processed).toBe(0);
    const fail = failedCall(syncRepo);
    expect((fail![2] as { attendanceSyncError: string }).attendanceSyncError).toContain(
      "Failed to insert",
    );
  });

  it("updateRecordTx trả về rỗng (UPDATE thất bại, record sẵn có) → catch → 'Failed'", async () => {
    const day = makeDay({ dayType: "Full Day" });
    const existing = makeExistingRecord();
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      findRecordByEmployeeDateTx: vi.fn().mockResolvedValue([existing]),
      updateRecordTx: vi.fn().mockResolvedValue([]),
    });
    const { service } = build(syncRepo);
    const processed = await service.syncApprovedRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(processed).toBe(0);
    const fail = failedCall(syncRepo);
    expect((fail![2] as { attendanceSyncError: string }).attendanceSyncError).toContain(
      "Failed to update",
    );
  });
});

// ─── revertRequestTx — nhánh "no-op" + "update thất bại → rethrow" (CHƯA có ở int-spec) ─

describe("AttendanceLeaveSyncService — revertRequestTx", () => {
  it("record đã bị xoá/không tồn tại → revertOneDayTx no-op (return early), vẫn đánh dấu 'Reverted'", async () => {
    const day = makeDay({ attendanceSyncStatus: "Synced" });
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      findRecordByEmployeeDateTx: vi.fn().mockResolvedValue([]),
    });
    const { service, audit } = build(syncRepo);
    await service.revertRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID);
    expect(audit.record).not.toHaveBeenCalled();
    expect(syncRepo.updateDaySyncStatusTx).toHaveBeenCalledWith(
      COMPANY_ID,
      day.id,
      { attendanceSyncStatus: "Reverted", updatedBy: USER_ID },
      TX,
    );
  });

  it("updateRecordTx thất bại (không có row) → 'Failed' + RETHROW (rollback tx của caller)", async () => {
    const day = makeDay({ attendanceSyncStatus: "Synced" });
    const existing = makeExistingRecord({
      checkInAt: new Date("2024-06-03T01:00:00Z"),
      checkOutAt: new Date("2024-06-03T10:00:00Z"),
      workingMinutes: 480,
      attendanceStatus: "Present",
    });
    const syncRepo = makeSyncRepo({
      findSyncableDaysTx: vi.fn().mockResolvedValue([day]),
      findRecordByEmployeeDateTx: vi.fn().mockResolvedValue([existing]),
      updateRecordTx: vi.fn().mockResolvedValue([]),
    });
    const { service, audit } = build(syncRepo);
    await expect(service.revertRequestTx(TX, COMPANY_ID, REQUEST_ID, USER_ID)).rejects.toThrow(
      `Failed to revert attendance_records ${existing.id}`,
    );
    expect(audit.record).not.toHaveBeenCalled();
    const fail = failedCall(syncRepo);
    expect((fail![2] as { attendanceSyncError: string }).attendanceSyncError).toContain(
      "Failed to revert",
    );
  });
});
