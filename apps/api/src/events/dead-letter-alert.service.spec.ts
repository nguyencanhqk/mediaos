import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LoggerAlertSink } from "./alert.service";

/**
 * G2-4 alerting — unit cho ThresholdAlertSink (mirror LoggerAlertSink): khi số dead-letter unresolved
 * của 1 company vượt ngưỡng, alert thresholdBreached() log ở mức ERROR CHỈ chứa {companyId,count,window}
 * — KHÔNG payload (tránh lộ dữ liệu nhạy cảm / rò chéo tenant, bất biến #3).
 */
describe("LoggerAlertSink.thresholdBreached", () => {
  it("log threshold-breach ở mức ERROR, có companyId/count/window nhưng KHÔNG payload", async () => {
    const spy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const sink = new LoggerAlertSink();

    await sink.thresholdBreached({
      companyId: "co-threshold-1",
      count: 7,
      windowStart: new Date("2026-06-15T03:00:00.000Z"),
      threshold: 5,
    });

    expect(spy).toHaveBeenCalledOnce();
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("co-threshold-1");
    expect(msg).toContain("7");
    // window mốc giờ (truncate) PHẢI có để định danh cửa sổ.
    expect(msg).toContain("2026-06-15");
    // KHÔNG được kèm payload event (chỉ thống kê). Không có khoá payload nào trong message.
    expect(msg.toLowerCase()).not.toContain("payload");
    spy.mockRestore();
  });
});
