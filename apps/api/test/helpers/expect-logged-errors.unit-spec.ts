import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withExpectedLoggerErrors } from "./expect-logged-errors";

/**
 * S10-QA-LOGNOISE-1-FIX-A — đai cho chính helper dập-nhiễu-có-bằng-chứng.
 *
 * Không cần DB ⇒ chạy trong lượt unit mặc định (`pnpm test`), không nấp sau `skipIf(!hasDb)`.
 *
 * Mọi ca đều tự cài một "sink thật" giả LÀ HÀM THUẦN (KHÔNG `vi.fn()`) làm `Logger.prototype.error`
 * TRƯỚC khi gọi helper — đây chính là thứ mà dòng KHÔNG khớp phải được FORWARD tới, và dòng KHỚP thì
 * TUYỆT ĐỐI KHÔNG được chạm.
 *
 * ⚠️ BẪY ĐO ĐƯỢC KHI VIẾT BỘ NÀY: nếu "sink thật" giả lại LÀ một `vi.fn()` (mock chồng mock), thì
 * `vi.spyOn(...).mockRestore()` của Vitest KHÔNG khôi phục về đúng tham chiếu đó — nó khôi phục về
 * stub nội bộ RỖNG (`function(){}`) của chính `vi.fn()` kia (đã đo thực nghiệm, không suy đoán). Trong
 * sản xuất `Logger.prototype.error` VỐN LÀ hàm thật (không phải mock) nên bẫy này không xảy ra — nhưng
 * unit-spec PHẢI mô phỏng đúng hình dạng đó (hàm thuần) để không tự tạo ra một bài kiểm giả-đỏ/giả-xanh.
 */
function makeSink(): { sink: (...args: unknown[]) => void; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return { sink: (...args: unknown[]) => void calls.push(args), calls };
}

describe("withExpectedLoggerErrors — dập nhiễu có bằng chứng, không bịt miệng toàn cục", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("RED — 'expected' rỗng bị chặn NGAY, không cho nuốt vô điều kiện", async () => {
    const { sink, calls } = makeSink();
    Logger.prototype.error = sink;

    await expect(withExpectedLoggerErrors([], () => undefined)).rejects.toThrow(/rỗng/);
    // Chặn TRƯỚC khi patch — sink thật không hề bị đụng tới, vẫn nguyên vẹn.
    expect(Logger.prototype.error).toBe(sink);
    expect(calls).toHaveLength(0);
  });

  it("RED — mẫu kỳ vọng KHÔNG xuất hiện lần nào ⇒ FAIL (không được lặng lẽ coi là 'đã hết ồn')", async () => {
    Logger.prototype.error = makeSink().sink;

    await expect(
      withExpectedLoggerErrors(
        [{ label: "không bao giờ xảy ra", match: /ma-tran-khong-ton-tai/ }],
        () => undefined, // fn không log gì cả
      ),
    ).rejects.toThrow(/kỳ vọng khớp \[1\.\.Infinity\] lần nhưng đo được 0 lần/);
  });

  it("RED — khớp NHIỀU hơn 'max' cho phép ⇒ FAIL", async () => {
    Logger.prototype.error = makeSink().sink;
    const logger = new Logger("Noisy");

    await expect(
      withExpectedLoggerErrors(
        [{ label: "chỉ được 1 lần", match: /lặp lại/, min: 1, max: 1 }],
        () => {
          logger.error("sự kiện lặp lại lần 1");
          logger.error("sự kiện lặp lại lần 2");
        },
      ),
    ).rejects.toThrow(/kỳ vọng khớp \[1\.\.1\] lần nhưng đo được 2 lần/);
  });

  it("GREEN — dòng KHỚP mẫu bị NUỐT (không tới sink thật) và được đếm làm bằng chứng", async () => {
    const { sink, calls } = makeSink();
    Logger.prototype.error = sink;
    const logger = new Logger("OutboxNotificationBridge");

    const { matched } = await withExpectedLoggerErrors(
      [{ label: "intake THẤT BẠI", match: /intake THẤT BẠI/, min: 3, max: 3 }],
      () => {
        for (let i = 0; i < 3; i += 1) {
          logger.error(
            `OutboxNotificationBridge[chat.message.direct_sent] intake THẤT BẠI (lần ${i})`,
          );
        }
      },
    );

    expect(calls).toHaveLength(0); // KHÔNG in ra — đã biến thành assert thay vì nhiễu console.
    const hits = matched.get("intake THẤT BẠI")!;
    expect(hits).toHaveLength(3);
    expect(hits[0].context).toBe("OutboxNotificationBridge");
    expect(hits[0].message).toContain("intake THẤT BẠI (lần 0)");
  });

  it("GREEN — dòng KHÔNG khớp mẫu nào được FORWARD NGUYÊN VẸN ra sink thật (lỗi thật vẫn kêu to)", async () => {
    const { sink, calls } = makeSink();
    Logger.prototype.error = sink;
    const bridgeLogger = new Logger("OutboxNotificationBridge");
    const otherLogger = new Logger("SomeUnrelatedService");
    const stack = "Error: đây là lỗi THẬT không nằm trong kịch bản gieo\n  at somewhere.ts:1:1";

    await withExpectedLoggerErrors([{ label: "intake THẤT BẠI", match: /intake THẤT BẠI/ }], () => {
      bridgeLogger.error("OutboxNotificationBridge[x] intake THẤT BẠI (event 1)"); // khớp ⇒ nuốt
      otherLogger.error("lỗi KHÔNG liên quan gì tới ca đang gieo", stack); // không khớp ⇒ forward
    });

    expect(calls).toEqual([["lỗi KHÔNG liên quan gì tới ca đang gieo", stack]]);
  });

  it("GREEN — `fn()` ném lỗi: spy vẫn được khôi phục, nhưng lỗi GỐC nổi lên nguyên vẹn (không bị đè)", async () => {
    const { sink, calls } = makeSink();
    Logger.prototype.error = sink;

    await expect(
      withExpectedLoggerErrors([{ label: "không quan trọng", match: /x/ }], () => {
        throw new Error("lỗi gốc của chính test");
      }),
    ).rejects.toThrow("lỗi gốc của chính test");

    // finally{} vẫn chạy dù fn() ném ⇒ implementation TRƯỚC KHI patch được khôi phục nguyên vẹn — cùng
    // tham chiếu HÀM, không phải một stub rỗng khác (kiểm cả identity lẫn hành vi để chặn hồi quy).
    expect(Logger.prototype.error).toBe(sink);
    new Logger("Probe").error("gọi thử sau khi khôi phục");
    expect(calls).toEqual([["gọi thử sau khi khôi phục"]]);
  });

  it("GREEN — sau khi chạy xong, `Logger.prototype.error` được khôi phục về implementation trước đó", async () => {
    const { sink, calls } = makeSink();
    Logger.prototype.error = sink;
    const logger = new Logger("X");

    await withExpectedLoggerErrors([{ label: "a", match: /a/ }], () => {
      logger.error("aaa");
    });

    expect(Logger.prototype.error).toBe(sink);
    logger.error("gọi thử sau khi khôi phục");
    expect(calls).toEqual([["gọi thử sau khi khôi phục"]]);
  });
});
