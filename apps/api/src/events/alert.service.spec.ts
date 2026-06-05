import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { LoggerAlertSink } from "./alert.service";

describe("LoggerAlertSink", () => {
  it("log dead-letter ở mức ERROR, có id/loại nhưng KHÔNG có payload (tránh lộ dữ liệu)", async () => {
    const spy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const sink = new LoggerAlertSink();
    await sink.deadLetter({
      deadLetterId: "dl-1",
      eventId: "ev-1",
      companyId: "co-1",
      eventType: "user.created",
      consumerName: "welcome-email",
      error: "SMTP down",
    });

    expect(spy).toHaveBeenCalledOnce();
    const msg = spy.mock.calls[0][0] as string;
    expect(msg).toContain("ev-1");
    expect(msg).toContain("user.created");
    expect(msg).toContain("SMTP down");
    spy.mockRestore();
  });
});
