import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LMS_ACCOUNT_SYNC_EVENT, LmsSyncProducer } from "./lms-sync-producer.service";

const LMS_CO = "11111111-1111-1111-1111-111111111111";
const OTHER_CO = "22222222-2222-2222-2222-222222222222";
const USER = "33333333-3333-3333-3333-333333333333";

/** tx giả: builder chuỗi drizzle, `.limit()` resolve về `rows`. */
function fakeTx(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.innerJoin = () => builder;
  builder.where = () => builder;
  builder.limit = () => Promise.resolve(rows);
  return { select: () => builder } as never;
}

describe("LmsSyncProducer — company gate + enqueue", () => {
  const saved = process.env.LMS_COMPANY_ID;
  let outbox: { enqueue: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    process.env.LMS_COMPANY_ID = LMS_CO;
    outbox = { enqueue: vi.fn().mockResolvedValue("evt-id") };
  });
  afterEach(() => {
    process.env.LMS_COMPANY_ID = saved;
  });

  const make = () => new LmsSyncProducer(outbox as never);

  it("companyId === LMS_COMPANY_ID + có hồ sơ → enqueue eventType riêng + payload {email,name,active}", async () => {
    const tx = fakeTx([{ email: "e@x.co", name: "Emp", active: true }]);
    await make().enqueueSync(tx, LMS_CO, USER);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const [, event] = outbox.enqueue.mock.calls[0];
    expect(event.eventType).toBe(LMS_ACCOUNT_SYNC_EVENT);
    expect(event.eventType).not.toBe("auth.user_locked"); // né consumer notification (trap #1)
    expect(event.payload).toEqual({ email: "e@x.co", name: "Emp", active: true });
  });

  it("name null → payload KHÔNG có field name", async () => {
    const tx = fakeTx([{ email: "e@x.co", name: null, active: false }]);
    await make().enqueueSync(tx, LMS_CO, USER);
    expect(outbox.enqueue.mock.calls[0][1].payload).toEqual({ email: "e@x.co", active: false });
  });

  it("ISOLATION: companyId ≠ LMS_COMPANY_ID → KHÔNG enqueue (không rò tenant khác sang LMS)", async () => {
    const tx = fakeTx([{ email: "e@x.co", name: "Emp", active: true }]);
    await make().enqueueSync(tx, OTHER_CO, USER);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("LMS_COMPANY_ID unset → auto-sync tắt → KHÔNG enqueue", async () => {
    delete process.env.LMS_COMPANY_ID;
    const tx = fakeTx([{ email: "e@x.co", name: "Emp", active: true }]);
    await new LmsSyncProducer(outbox as never).enqueueSync(tx, LMS_CO, USER);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("userId null → KHÔNG enqueue", async () => {
    const tx = fakeTx([{ email: "e@x.co", name: "Emp", active: true }]);
    await make().enqueueSync(tx, LMS_CO, null);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("user không hồ sơ (query rỗng) → KHÔNG enqueue", async () => {
    const tx = fakeTx([]);
    await make().enqueueSync(tx, LMS_CO, USER);
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
