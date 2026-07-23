import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventContext } from "../../events/event-bus";
import { LMS_ACCOUNT_SYNC_EVENT } from "./lms-sync-producer.service";
import { LmsUserSyncBridge } from "./lms-user-sync.bridge";

const LMS_CO = "11111111-1111-1111-1111-111111111111";
const OTHER_CO = "22222222-2222-2222-2222-222222222222";

function ctx(companyId: string): EventContext {
  return {
    eventId: "evt-1",
    companyId,
    eventType: LMS_ACCOUNT_SYNC_EVENT,
    payload: { email: "e@x.co", name: "Emp", active: false },
  };
}

describe("LmsUserSyncBridge", () => {
  const saved = process.env.LMS_COMPANY_ID;
  let bus: { register: ReturnType<typeof vi.fn> };
  let http: { isEnabled: ReturnType<typeof vi.fn>; syncUsers: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.LMS_COMPANY_ID = LMS_CO;
    bus = { register: vi.fn() };
    http = { isEnabled: vi.fn().mockReturnValue(true), syncUsers: vi.fn().mockResolvedValue(undefined) };
  });
  afterEach(() => {
    process.env.LMS_COMPANY_ID = saved;
  });

  /** Lấy handler đã register để gọi trực tiếp. */
  function handlerOf(): (c: EventContext) => Promise<void> {
    const b = new LmsUserSyncBridge(bus as never, http as never);
    b.onModuleInit();
    expect(bus.register).toHaveBeenCalledTimes(1);
    const consumer = bus.register.mock.calls[0][0];
    expect(consumer.eventType).toBe(LMS_ACCOUNT_SYNC_EVENT);
    expect(consumer.consumerName).toBe(`lms-sync:${LMS_ACCOUNT_SYNC_EVENT}`);
    return consumer.handle;
  }

  it("enabled + đúng tenant → gọi http.syncUsers với đúng 1 user", async () => {
    await handlerOf()(ctx(LMS_CO));
    expect(http.syncUsers).toHaveBeenCalledWith([{ email: "e@x.co", name: "Emp", active: false }]);
  });

  it("LMS 5xx (syncUsers throw) → bridge RE-THROW (để outbox retry, KHÔNG nuốt lỗi)", async () => {
    http.syncUsers.mockRejectedValue(new Error("LMS sync HTTP 500"));
    await expect(handlerOf()(ctx(LMS_CO))).rejects.toThrow(/HTTP 500/);
  });

  it("thiếu env (disabled) → skip KHÔNG throw + KHÔNG gọi syncUsers (không dead-letter oan)", async () => {
    http.isEnabled.mockReturnValue(false);
    await expect(handlerOf()(ctx(LMS_CO))).resolves.toBeUndefined();
    expect(http.syncUsers).not.toHaveBeenCalled();
  });

  it("ISOLATION lớp-2: ctx.companyId ≠ LMS_COMPANY_ID → skip, KHÔNG gọi syncUsers", async () => {
    await handlerOf()(ctx(OTHER_CO));
    expect(http.syncUsers).not.toHaveBeenCalled();
  });
});
