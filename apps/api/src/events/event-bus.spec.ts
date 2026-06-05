import { describe, expect, it, vi } from "vitest";
import { EventBus } from "./event-bus";

describe("EventBus — sổ đăng ký consumer", () => {
  it("trả mọi consumer nghe cùng eventType (nhiều consumer khác tên là hợp lệ)", () => {
    const bus = new EventBus();
    const h = vi.fn();
    bus.register({ consumerName: "notify", eventType: "user.created", handle: h });
    bus.register({ consumerName: "welcome-email", eventType: "user.created", handle: h });
    bus.register({ consumerName: "audit-mirror", eventType: "user.deleted", handle: h });

    expect(bus.consumersFor("user.created").map((c) => c.consumerName)).toEqual([
      "notify",
      "welcome-email",
    ]);
    expect(bus.consumersFor("user.deleted")).toHaveLength(1);
    expect(bus.consumersFor("unknown.event")).toHaveLength(0);
  });

  it("từ chối consumerName trùng (idempotency key phải duy nhất toàn hệ)", () => {
    const bus = new EventBus();
    bus.register({ consumerName: "dup", eventType: "a", handle: vi.fn() });
    expect(() => bus.register({ consumerName: "dup", eventType: "b", handle: vi.fn() })).toThrow(
      /trùng/,
    );
  });
});
