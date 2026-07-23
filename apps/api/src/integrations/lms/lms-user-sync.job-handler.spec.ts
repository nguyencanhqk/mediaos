import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LmsSyncSummary, LmsSyncUser } from "./lms-http-client.service";
import { LMS_USER_SYNC_JOB_CODE, LmsUserSyncJobHandler } from "./lms-user-sync.job-handler";

const LMS_CO = "11111111-1111-1111-1111-111111111111";
const OTHER_CO = "22222222-2222-2222-2222-222222222222";

/** Summary đầy đủ 6 counter + cờ — CẤM để test tự chế shape thiếu (sẽ che mất lỗi thật). */
function summary(partial: Partial<LmsSyncSummary> = {}): LmsSyncSummary {
  return {
    created: 0,
    existing: 0,
    reactivated: 0,
    deactivated: 0,
    skipped: 0,
    alreadyDisabled: 0,
    unknown: false,
    ...partial,
  };
}

/** db.withTenant chạy callback với tx giả: query đọc trả `rows`; audit.record dùng chung tx (mock). */
function makeDeps(rows: unknown[]) {
  const fakeTx = {
    select: () => ({
      from: () => ({ innerJoin: () => ({ where: () => Promise.resolve(rows) }) }),
    }),
  };
  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx)) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const http = {
    isEnabled: vi.fn().mockReturnValue(true),
    // Mặc định: mọi user đều "đã có, không đổi" ⇒ changed=0 ⇒ KHÔNG audit (hành vi mới của WO).
    syncUsers: vi.fn(async (batch: LmsSyncUser[]) => summary({ existing: batch.length })),
  };
  return { db, audit, http };
}

function makeHandler(deps: ReturnType<typeof makeDeps>) {
  return new LmsUserSyncJobHandler(deps.db as never, deps.audit as never, deps.http as never);
}

function rowsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({ email: `u${i}@x.co`, name: `U${i}`, active: true }));
}

describe("LmsUserSyncJobHandler", () => {
  const saved = process.env.LMS_COMPANY_ID;
  beforeEach(() => {
    process.env.LMS_COMPANY_ID = LMS_CO;
  });
  afterEach(() => {
    process.env.LMS_COMPANY_ID = saved;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("jobCode = LMS_USER_SYNC", () => {
    expect(makeHandler(makeDeps([])).jobCode).toBe(LMS_USER_SYNC_JOB_CODE);
  });

  it("ISOLATION: tenant ≠ LMS_COMPANY_ID → total:0, KHÔNG query/POST/audit", async () => {
    const deps = makeDeps([{ email: "e@x.co", name: "E", active: true }]);
    const res = await makeHandler(deps).run({ companyId: OTHER_CO });
    // Shape early-return GIỮ NGUYÊN (toEqual, KHÔNG nới toMatchObject) — đây là assert isolation mạnh nhất.
    expect(res).toEqual({ total: 0, success: 0, failed: 0 });
    expect(deps.db.withTenant).not.toHaveBeenCalled();
    expect(deps.http.syncUsers).not.toHaveBeenCalled();
    expect(deps.audit.record).not.toHaveBeenCalled();
  });

  it("disabled (thiếu env) → total:0, KHÔNG query/POST", async () => {
    const deps = makeDeps([{ email: "e@x.co", name: "E", active: true }]);
    deps.http.isEnabled.mockReturnValue(false);
    const res = await makeHandler(deps).run({ companyId: LMS_CO });
    expect(res).toEqual({ total: 0, success: 0, failed: 0 });
    expect(deps.http.syncUsers).not.toHaveBeenCalled();
  });

  it("enabled: quét users, POST mang name (đường tạo account), audit lms_sync actorType Job ĐẾM (không email)", async () => {
    const rows = [
      { email: "a@x.co", name: "A", active: true },
      { email: "b@x.co", name: null, active: false },
    ];
    const deps = makeDeps(rows);
    deps.http.syncUsers.mockResolvedValue(summary({ created: 1, deactivated: 1 }));
    const res = await makeHandler(deps).run({ companyId: LMS_CO });

    expect(deps.http.syncUsers).toHaveBeenCalledWith([
      { email: "a@x.co", name: "A", active: true },
      { email: "b@x.co", name: undefined, active: false },
    ]);
    expect(res).toMatchObject({ total: 2, success: 2, failed: 0 });

    const entry = deps.audit.record.mock.calls[0][1];
    expect(entry.objectType).toBe("lms_sync");
    expect(entry.actorType).toBe("Job");
    // SIẾT (không nới sang toMatchObject): toEqual ở đây chính là thứ chứng minh metadata KHÔNG có
    // field lạ và KHÔNG có email.
    expect(entry.metadata).toEqual({
      total: 2,
      ok: 2,
      fail: 0,
      created: 1,
      reactivated: 0,
      deactivated: 1,
      unknown: false,
      auditPhase: "changed",
    });
    expect(JSON.stringify(entry)).not.toContain("a@x.co");
  });

  it("LMS lỗi (syncUsers throw) → đếm failed, audit resultStatus Failure, KHÔNG throw (giữ audit)", async () => {
    const deps = makeDeps([{ email: "a@x.co", name: "A", active: true }]);
    deps.http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 503"));
    const res = await makeHandler(deps).run({ companyId: LMS_CO });
    expect(res).toMatchObject({ total: 1, success: 0, failed: 1 });
    expect(deps.audit.record.mock.calls[0][1].resultStatus).toBe("Failure");
  });

  // ══════════ S5-LMS-BE-4 — chỉ audit khi CÓ THAY ĐỔI THẬT ══════════

  it("10) toàn existing/skipped/alreadyDisabled → KHÔNG gọi audit.record (test RED chính)", async () => {
    const deps = makeDeps(rowsOf(3));
    deps.http.syncUsers.mockResolvedValue(summary({ existing: 1, skipped: 1, alreadyDisabled: 1 }));
    const res = await makeHandler(deps).run({ companyId: LMS_CO });

    expect(deps.audit.record).not.toHaveBeenCalled();
    expect(res).toMatchObject({ total: 3, success: 3, failed: 0 });
  });

  it.each([
    ["created", { created: 1, existing: 2 }],
    ["deactivated", { deactivated: 1, existing: 2 }],
    ["reactivated", { reactivated: 1, existing: 2 }],
  ])("11/12/12b) %s > 0 → CÓ audit (đều là sự kiện tài khoản)", async (key, partial) => {
    const deps = makeDeps(rowsOf(3));
    deps.http.syncUsers.mockResolvedValue(summary(partial));
    await makeHandler(deps).run({ companyId: LMS_CO });

    expect(deps.audit.record).toHaveBeenCalledTimes(1);
    expect(deps.audit.record.mock.calls[0][1].metadata).toMatchObject({ [key]: 1 });
  });

  it("13) đa lô (150 user = 2 lô) → cộng dồn đúng, ĐÚNG 1 dòng audit", async () => {
    const deps = makeDeps(rowsOf(150));
    deps.http.syncUsers
      .mockResolvedValueOnce(summary({ created: 1, existing: 99 }))
      .mockResolvedValueOnce(summary({ existing: 50 }));
    const res = await makeHandler(deps).run({ companyId: LMS_CO });

    expect(deps.http.syncUsers).toHaveBeenCalledTimes(2);
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
    expect(res).toMatchObject({ total: 150, success: 150, failed: 0 });
    expect(deps.audit.record.mock.calls[0][1].metadata).toMatchObject({ created: 1, fail: 0 });
  });

  it("14) lô hỗn hợp (lô1 ok created:1, lô2 throw) → 1 audit Failure, KHÔNG nuốt mất thay đổi", async () => {
    const deps = makeDeps(rowsOf(150));
    deps.http.syncUsers
      .mockResolvedValueOnce(summary({ created: 1, existing: 99 }))
      .mockRejectedValueOnce(new Error("LMS sync HTTP 503"));
    const res = await makeHandler(deps).run({ companyId: LMS_CO });

    expect(deps.audit.record).toHaveBeenCalledTimes(1);
    const entry = deps.audit.record.mock.calls[0][1];
    expect(entry.resultStatus).toBe("Failure");
    expect(entry.metadata).toMatchObject({ created: 1, ok: 100, fail: 50 });
    expect(res).toMatchObject({ success: 100, failed: 50 });
  });

  it("15) summary unknown → CÓ audit + metadata.unknown === true", async () => {
    const deps = makeDeps(rowsOf(2));
    deps.http.syncUsers.mockResolvedValue(summary({ unknown: true }));
    await makeHandler(deps).run({ companyId: LMS_CO });

    expect(deps.audit.record).toHaveBeenCalledTimes(1);
    expect(deps.audit.record.mock.calls[0][1].metadata).toMatchObject({ unknown: true });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
  ])(
    "16) syncUsers trả %s → coi là unknown, KHÔNG đếm failed (chống nguỵ trang TypeError thành lỗi mạng)",
    async (_label, ret) => {
      const deps = makeDeps(rowsOf(2));
      deps.http.syncUsers.mockResolvedValue(ret as never);
      const res = await makeHandler(deps).run({ companyId: LMS_CO });

      expect(res).toMatchObject({ total: 2, success: 2, failed: 0 });
      expect(deps.audit.record.mock.calls[0][1].metadata).toMatchObject({ unknown: true });
    },
  );

  it("17) JobRunResult.metadata mang created/reactivated/deactivated/unknown", async () => {
    const deps = makeDeps(rowsOf(2));
    deps.http.syncUsers.mockResolvedValue(summary({ created: 1, reactivated: 1 }));
    const res = await makeHandler(deps).run({ companyId: LMS_CO });

    expect(res.metadata).toMatchObject({
      created: 1,
      reactivated: 1,
      deactivated: 0,
      unknown: false,
    });
  });

  it("18) WARN unknown chỉ log 1 LẦN dù chạy nhiều nhịp", async () => {
    const warn = vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const deps = makeDeps(rowsOf(1));
    deps.http.syncUsers.mockResolvedValue(summary({ unknown: true }));
    const handler = makeHandler(deps);

    await handler.run({ companyId: LMS_CO });
    await handler.run({ companyId: LMS_CO });
    await handler.run({ companyId: LMS_CO });

    expect(warn.mock.calls.filter((c) => String(c[0]).includes("unknown")).length).toBe(1);
  });

  it("19) metadata KHÔNG chứa '@' (không rò email)", async () => {
    const deps = makeDeps(rowsOf(2));
    deps.http.syncUsers.mockResolvedValue(summary({ created: 2 }));
    await makeHandler(deps).run({ companyId: LMS_CO });

    expect(JSON.stringify(deps.audit.record.mock.calls[0][1].metadata)).not.toContain("@");
  });

  // ── Trần fail-safe: bất thường là TRẠNG THÁI BỀN, không phải sự kiện ──

  it("20) 5 nhịp liên tiếp unknown (cùng instance) → ĐÚNG 1 audit", async () => {
    const deps = makeDeps(rowsOf(1));
    deps.http.syncUsers.mockResolvedValue(summary({ unknown: true }));
    const handler = makeHandler(deps);

    for (let i = 0; i < 5; i += 1) await handler.run({ companyId: LMS_CO });
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
  });

  // Ca CHỐT: test 20 dùng fixture counter=0 nên KHÔNG phân biệt được `changed` có lọc lô unknown hay
  // không. Nếu `changed` cộng vô điều kiện → auditPhase 'changed' MỖI NHỊP ⇒ bom 1-dòng/60s quay lại.
  it("20b) unknown KÈM deactivated:1, 5 nhịp → VẪN ĐÚNG 1 audit (changed chỉ tính lô parse được)", async () => {
    const deps = makeDeps(rowsOf(1));
    deps.http.syncUsers.mockResolvedValue(summary({ deactivated: 1, unknown: true }));
    const handler = makeHandler(deps);

    for (let i = 0; i < 5; i += 1) await handler.run({ companyId: LMS_CO });
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
  });

  it("20c) audit.record ném ở nhịp 1 → nhịp 2 VẪN gọi audit.record (state chỉ đổi sau khi ghi XONG)", async () => {
    const deps = makeDeps(rowsOf(1));
    deps.http.syncUsers.mockResolvedValue(summary({ unknown: true }));
    deps.audit.record.mockRejectedValueOnce(new Error("audit write failed"));
    const handler = makeHandler(deps);

    await expect(handler.run({ companyId: LMS_CO })).rejects.toThrow(/audit write failed/);
    await handler.run({ companyId: LMS_CO });

    expect(deps.audit.record).toHaveBeenCalledTimes(2);
  });

  it("21) 5 nhịp liên tiếp failed → ĐÚNG 1 audit", async () => {
    const deps = makeDeps(rowsOf(1));
    deps.http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 503"));
    const handler = makeHandler(deps);

    for (let i = 0; i < 5; i += 1) await handler.run({ companyId: LMS_CO });
    expect(deps.audit.record).toHaveBeenCalledTimes(1);
  });

  it("22) lỗi → hồi phục: 2 nhịp failed + 1 nhịp sạch → 2 audit, dòng 2 auditPhase 'recovered'; nhịp sạch tiếp KHÔNG thêm", async () => {
    const deps = makeDeps(rowsOf(1));
    const handler = makeHandler(deps);

    deps.http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 503"));
    await handler.run({ companyId: LMS_CO });
    await handler.run({ companyId: LMS_CO });

    deps.http.syncUsers.mockResolvedValue(summary({ existing: 1 }));
    await handler.run({ companyId: LMS_CO });

    expect(deps.audit.record).toHaveBeenCalledTimes(2);
    expect(deps.audit.record.mock.calls[1][1].metadata).toMatchObject({
      auditPhase: "recovered",
      fail: 0,
    });

    await handler.run({ companyId: LMS_CO });
    expect(deps.audit.record).toHaveBeenCalledTimes(2);
  });

  it("23) hồi phục rồi lỗi lại → audit NGAY (state đã xoá, không bị trần chặn oan)", async () => {
    const deps = makeDeps(rowsOf(1));
    const handler = makeHandler(deps);

    deps.http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 503"));
    await handler.run({ companyId: LMS_CO }); // 1: abnormal
    deps.http.syncUsers.mockResolvedValue(summary({ existing: 1 }));
    await handler.run({ companyId: LMS_CO }); // 2: recovered
    deps.http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 503"));
    await handler.run({ companyId: LMS_CO }); // 3: abnormal LẠI

    expect(deps.audit.record).toHaveBeenCalledTimes(3);
    expect(deps.audit.record.mock.calls[2][1].metadata).toMatchObject({ auditPhase: "abnormal" });
  });

  it("24) trần thời gian: vượt 1 giờ mà vẫn failed → thêm ĐÚNG 1 dòng nữa", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-23T00:00:00Z"));
    const deps = makeDeps(rowsOf(1));
    deps.http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 503"));
    const handler = makeHandler(deps);

    await handler.run({ companyId: LMS_CO });
    await handler.run({ companyId: LMS_CO });
    expect(deps.audit.record).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-07-23T01:00:01Z")); // > ABNORMAL_REAUDIT_MS
    await handler.run({ companyId: LMS_CO });
    expect(deps.audit.record).toHaveBeenCalledTimes(2);
  });

  it("25) changed > 0 KHÔNG bị trần chặn: 3 nhịp đều created:1 → 3 audit", async () => {
    const deps = makeDeps(rowsOf(1));
    deps.http.syncUsers.mockResolvedValue(summary({ created: 1 }));
    const handler = makeHandler(deps);

    for (let i = 0; i < 3; i += 1) await handler.run({ companyId: LMS_CO });
    expect(deps.audit.record).toHaveBeenCalledTimes(3);
  });
});
