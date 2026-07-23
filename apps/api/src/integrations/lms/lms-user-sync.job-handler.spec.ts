import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LMS_USER_SYNC_JOB_CODE, LmsUserSyncJobHandler } from "./lms-user-sync.job-handler";

const LMS_CO = "11111111-1111-1111-1111-111111111111";
const OTHER_CO = "22222222-2222-2222-2222-222222222222";

/** db.withTenant chạy callback với tx giả: query đọc trả `rows`; audit.record dùng chung tx (mock). */
function makeDeps(rows: unknown[]) {
  const fakeTx = {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }),
    }),
  };
  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx)) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const http = { isEnabled: vi.fn().mockReturnValue(true), syncUsers: vi.fn().mockResolvedValue(undefined) };
  return { db, audit, http };
}

describe("LmsUserSyncJobHandler", () => {
  const saved = process.env.LMS_COMPANY_ID;
  beforeEach(() => {
    process.env.LMS_COMPANY_ID = LMS_CO;
  });
  afterEach(() => {
    process.env.LMS_COMPANY_ID = saved;
  });

  it("jobCode = LMS_USER_SYNC", () => {
    const { db, audit, http } = makeDeps([]);
    expect(new LmsUserSyncJobHandler(db as never, audit as never, http as never).jobCode).toBe(
      LMS_USER_SYNC_JOB_CODE,
    );
  });

  it("ISOLATION: tenant ≠ LMS_COMPANY_ID → total:0, KHÔNG query/POST/audit", async () => {
    const { db, audit, http } = makeDeps([{ email: "e@x.co", name: "E", active: true }]);
    const res = await new LmsUserSyncJobHandler(db as never, audit as never, http as never).run({
      companyId: OTHER_CO,
    });
    expect(res).toEqual({ total: 0, success: 0, failed: 0 });
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(http.syncUsers).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("disabled (thiếu env) → total:0, KHÔNG query/POST", async () => {
    const { db, audit, http } = makeDeps([{ email: "e@x.co", name: "E", active: true }]);
    http.isEnabled.mockReturnValue(false);
    const res = await new LmsUserSyncJobHandler(db as never, audit as never, http as never).run({
      companyId: LMS_CO,
    });
    expect(res.total).toBe(0);
    expect(http.syncUsers).not.toHaveBeenCalled();
  });

  it("enabled: quét users, POST mang name (đường tạo account), audit lms_sync actorType Job ĐẾM (không email)", async () => {
    const rows = [
      { email: "a@x.co", name: "A", active: true },
      { email: "b@x.co", name: null, active: false },
    ];
    const { db, audit, http } = makeDeps(rows);
    const res = await new LmsUserSyncJobHandler(db as never, audit as never, http as never).run({
      companyId: LMS_CO,
    });

    expect(http.syncUsers).toHaveBeenCalledWith([
      { email: "a@x.co", name: "A", active: true },
      { email: "b@x.co", name: undefined, active: false },
    ]);
    expect(res).toMatchObject({ total: 2, success: 2, failed: 0 });

    const entry = audit.record.mock.calls[0][1];
    expect(entry.objectType).toBe("lms_sync");
    expect(entry.actorType).toBe("Job");
    expect(entry.metadata).toEqual({ total: 2, ok: 2, fail: 0 });
    // ĐẾM, KHÔNG dump email list.
    expect(JSON.stringify(entry)).not.toContain("a@x.co");
  });

  it("LMS lỗi (syncUsers throw) → đếm failed, audit resultStatus Failure, KHÔNG throw (giữ audit)", async () => {
    const { db, audit, http } = makeDeps([{ email: "a@x.co", name: "A", active: true }]);
    http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 503"));
    const res = await new LmsUserSyncJobHandler(db as never, audit as never, http as never).run({
      companyId: LMS_CO,
    });
    expect(res).toMatchObject({ total: 1, success: 0, failed: 1 });
    expect(audit.record.mock.calls[0][1].resultStatus).toBe("Failure");
  });
});
