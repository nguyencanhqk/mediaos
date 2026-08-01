import { describe, expect, it, vi } from "vitest";
import { LeaveCarryoverJobHandler } from "./leave-carryover.job-handler";
import type { CarryoverRunResult } from "./leave-carryover.service";
import type { LeaveCarryoverService } from "./leave-carryover.service";

/**
 * S6-LEAVE-CARRYOVER-1 — hành vi CẢNH BÁO của job, tách khỏi DB.
 *
 * Handler chạy mỗi 60 giây. Tình trạng bị bỏ qua ở đây là BỀN (chưa tới mốc chốt sổ thì còn chưa tới
 * suốt tháng 1) ⇒ in mỗi nhịp = 1440 dòng/ngày cho một việc không đổi. Đó chính là alert-fatigue vừa
 * phải đi dọn ở S6-OPS-LOGWINDOW-1, nên chống-lặp phải có test neo chứ không chỉ có comment.
 */

type Skip = { reason: string; leaveTypeId?: string; employeeId?: string; year?: number };

function result(
  skipped: Skip[],
  over: Partial<CarryoverRunResult> = {},
  preview: { policiesTotal?: number; policiesWithCarryForward?: number; stranded?: number } = {},
) {
  return {
    preview: {
      today: "2027-02-01",
      policies: [],
      sourceYear: 2026,
      targetYear: 2027,
      balancesScanned: skipped.length,
      strandedBalances: preview.stranded ?? 0,
      policiesTotal: preview.policiesTotal ?? 1,
      policiesWithCarryForward: preview.policiesWithCarryForward ?? 1,
      pending: [],
      carryDays: 0,
      expireDays: 0,
      employeesAffected: 0,
      skipped,
    },
    carried: 0,
    carriedDays: 0,
    expired: 0,
    expiredDays: 0,
    failed: 0,
    ...over,
  } as unknown as CarryoverRunResult;
}

function makeHandler(results: CarryoverRunResult[]) {
  let i = 0;
  const service = {
    runCompany: vi.fn(async () => results[Math.min(i++, results.length - 1)]),
  } as unknown as LeaveCarryoverService;
  const handler = new LeaveCarryoverJobHandler(service);
  const warn = vi.spyOn(
    (handler as unknown as { logger: { warn: (m: string) => void } }).logger,
    "warn",
  );
  warn.mockImplementation(() => undefined);
  return { handler, warn };
}

describe("LeaveCarryoverJobHandler", () => {
  it("cảnh báo ĐÚNG MỘT LẦN khi tình trạng bỏ qua không đổi qua nhiều nhịp", async () => {
    const r = result([{ reason: "EMPLOYEE_LEFT" }, { reason: "EMPLOYEE_LEFT" }]);
    const { handler, warn } = makeHandler([r]);

    for (let n = 0; n < 5; n += 1) await handler.run({ companyId: "co1" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("EMPLOYEE_LEFT");
  });

  it("tình trạng ĐỔI ⇒ cảnh báo lại (im lặng luôn cũng là một dạng lỗi)", async () => {
    const { handler, warn } = makeHandler([
      result([{ reason: "EMPLOYEE_LEFT" }]),
      result([{ reason: "MISSING_EMPLOYEE" }]),
    ]);

    await handler.run({ companyId: "co1" });
    await handler.run({ companyId: "co1" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("#M1 ĐỔI NGƯỜI mà giữ nguyên lý do + số đếm ⇒ VẪN cảnh báo (chữ ký theo danh tính, không theo đếm)", async () => {
    // Chữ ký chỉ đếm-theo-lý-do sẽ nuốt ca này: hôm nay anh A `EMPLOYEE_LEFT`, tuần sau A xong nhưng chị B
    // bị gắn nhầm `end_date` ⇒ vẫn `{"EMPLOYEE_LEFT":1}` ⇒ không ai được báo về B.
    const { handler, warn } = makeHandler([
      result([{ reason: "EMPLOYEE_LEFT", leaveTypeId: "t1", employeeId: "A", year: 2026 }]),
      result([{ reason: "EMPLOYEE_LEFT", leaveTypeId: "t1", employeeId: "B", year: 2026 }]),
    ]);

    await handler.run({ companyId: "co1" });
    await handler.run({ companyId: "co1" });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("#H1 dòng số dư ngoài cửa sổ quét ⇒ cảnh báo kèm số lượng (không để nó vô hình)", async () => {
    const { handler, warn } = makeHandler([result([], {}, { stranded: 4 })]);

    await handler.run({ companyId: "co1" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("4 dòng số dư");
  });

  it("#H3b 0 chính sách bật chuyển tiếp ⇒ nói MỘT lần (phân biệt cấu hình sai với nghỉ đúng thiết kế)", async () => {
    const { handler } = makeHandler([result([], {}, { policiesWithCarryForward: 0 })]);
    const log = vi.spyOn(
      (handler as unknown as { logger: { log: (m: string) => void } }).logger,
      "log",
    );
    log.mockImplementation(() => undefined);

    for (let n = 0; n < 3; n += 1) await handler.run({ companyId: "co1" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain("0/1 chính sách");
  });

  it("BEFORE_SETTLEMENT KHÔNG cảnh báo — đúng thiết kế, không phải việc cần ai làm", async () => {
    const { handler, warn } = makeHandler([
      result([{ reason: "BEFORE_SETTLEMENT" }, { reason: "BEFORE_SETTLEMENT" }]),
    ]);

    await handler.run({ companyId: "co1" });
    expect(warn).not.toHaveBeenCalled();
  });

  it("metadata đếm được theo từng lý do; total = việc ĐÃ làm + việc HỎNG", async () => {
    const { handler } = makeHandler([
      result([{ reason: "EMPLOYEE_LEFT" }, { reason: "NOTHING_TO_CARRY" }], {
        carried: 2,
        carriedDays: 9,
        expired: 1,
        expiredDays: 3,
        failed: 1,
      }),
    ]);

    const res = await handler.run({ companyId: "co1" });
    expect(res.total).toBe(4);
    expect(res.success).toBe(3);
    expect(res.failed).toBe(1);
    expect(res.metadata?.skippedByReason).toEqual({ EMPLOYEE_LEFT: 1, NOTHING_TO_CARRY: 1 });
    // Ba con số phân biệt "nghỉ đúng thiết kế" với "cấu hình sai" và "có dữ liệu không với tới được".
    expect(res.metadata?.policies).toBe(1);
    expect(res.metadata?.policiesWithCarryForward).toBe(1);
    expect(res.metadata?.strandedBalances).toBe(0);
    expect(res.metadata?.carriedDays).toBe(9);
    expect(res.metadata?.expiredDays).toBe(3);
  });

  it("mỗi tenant có bộ nhớ cảnh báo RIÊNG (tenant B không bị tenant A làm câm)", async () => {
    const { handler, warn } = makeHandler([result([{ reason: "EMPLOYEE_LEFT" }])]);

    await handler.run({ companyId: "co1" });
    await handler.run({ companyId: "co2" });
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
