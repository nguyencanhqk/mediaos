/**
 * OutboxNotificationBridge (unit, KHÔNG cần DB) — S10-QA-LOGNOISE-1 (KI-015) chống-hồi-quy.
 *
 * Nhiễu log "intake THẤT BẠI" khi chạy test suite đã truy tới GỐC (xem docblock của service): nguồn DUY
 * NHẤT hôm nay là 1 test CỐ Ý gieo payload lỗi (`chat-noti-e2e.int-spec.ts` ca 14) — hành vi ĐÚNG, đã tự
 * assert dead-letter. File này KHÔNG dập log đó (không chạm `chat-noti-e2e`, ngoài phạm vi WO) — nó khoá
 * lại chiều NGƯỢC LẠI: bridge PHẢI VẪN KÊU TO (log rồi re-throw, KHÔNG nuốt) khi
 * `NotificationEngineService.intake()` / `resolveRecipients()` ném lỗi THẬT (đường chạy production), để
 * không ai sau này "vá" nốt nhiễu bằng cách hạ log level hay bọc `catch {}` rồi để lỗi thật trôi qua im
 * lặng.
 *
 * `Logger.prototype.error` bị `vi.spyOn(...).mockImplementation()` CHỈ để unit test này không tự in
 * nhiễu ra console + để assert được nội dung — KHÔNG đổi một dòng code sản phẩm (service vẫn gọi
 * `this.logger.error` y nguyên).
 */
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus, type EventContext } from "../events/event-bus";
import {
  OutboxNotificationBridge,
  type NotiEventMapping,
} from "./outbox-notification-bridge.service";

const COMPANY_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";
/** NOTI_EVENT_CATALOG isEnabled=true — dùng cho mapping hợp lệ. */
const ENABLED_EVENT_CODE = "TASK_ASSIGNED";
/** NOTI_EVENT_CATALOG isEnabled=false — dùng để khoá boot-guard. */
const DISABLED_EVENT_CODE = "TASK_UPDATED";

function makeMapping(overrides: Partial<NotiEventMapping> = {}): NotiEventMapping {
  return {
    eventType: "task.assigned",
    eventCode: ENABLED_EVENT_CODE,
    sourceModule: "TASK",
    sourceEntityType: "task",
    sourceEntityIdOf: () => "task-1",
    resolveRecipients: async () => ["user-1"],
    ...overrides,
  };
}

function ctxOf(payload: Record<string, unknown> = {}): EventContext {
  return { eventId: EVENT_ID, companyId: COMPANY_ID, eventType: "task.assigned", payload };
}

describe("OutboxNotificationBridge", () => {
  let bus: EventBus;
  let engine: { intake: ReturnType<typeof vi.fn> };
  let bridge: OutboxNotificationBridge;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    bus = new EventBus();
    engine = { intake: vi.fn() };
    bridge = new OutboxNotificationBridge(bus, engine as never);
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  describe("registerSource — boot-guard (fail-loud TẠI BOOT)", () => {
    it("eventCode KHÔNG có trong NOTI_EVENT_CATALOG (is_enabled=true) → ném NGAY, KHÔNG đăng ký vào bus", () => {
      expect(() => bridge.registerSource(makeMapping({ eventCode: DISABLED_EVENT_CODE }))).toThrow(
        /KHÔNG có trong/,
      );
      expect(bus.consumersFor("task.assigned")).toHaveLength(0);
    });

    it("eventCode ĐÃ enable → đăng ký thành công, consumerName = noti-bridge:<eventType>", () => {
      bridge.registerSource(makeMapping());
      const consumers = bus.consumersFor("task.assigned");
      expect(consumers).toHaveLength(1);
      expect(consumers[0].consumerName).toBe("noti-bridge:task.assigned");
    });
  });

  describe("handle — đường THÀNH CÔNG", () => {
    it("intake() OK → KHÔNG log error, KHÔNG throw", async () => {
      engine.intake.mockResolvedValue({ createdCount: 1, skippedCount: 0, dedupedCount: 0 });
      bridge.registerSource(makeMapping());
      const [consumer] = bus.consumersFor("task.assigned");

      await expect(consumer.handle(ctxOf())).resolves.toBeUndefined();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(engine.intake).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ eventCode: ENABLED_EVENT_CODE, sourceModule: "TASK" }),
      );
    });
  });

  describe("handle — CHỐNG HỒI QUY: lỗi THẬT (đường production) phải VẪN KÊU TO", () => {
    it("intake() reject → logger.error kèm eventType/eventId/companyId/message, RỒI re-throw NGUYÊN error (KHÔNG nuốt)", async () => {
      const dbErr = new Error("connection terminated unexpectedly");
      engine.intake.mockRejectedValue(dbErr);
      bridge.registerSource(makeMapping());
      const [consumer] = bus.consumersFor("task.assigned");

      await expect(consumer.handle(ctxOf())).rejects.toBe(dbErr);

      // OutboxWorker.processEvent bắt lỗi RE-THROW này để retry/dead-letter — nuốt ở đây = event
      // "thành công" giả, dữ liệu mất tích im lặng (đúng loại lỗi mà bridge được thiết kế để KHÔNG mắc).
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, stack] = errorSpy.mock.calls[0] as [string, string | undefined];
      expect(message).toContain("OutboxNotificationBridge[task.assigned] intake THẤT BẠI");
      expect(message).toContain(EVENT_ID);
      expect(message).toContain(COMPANY_ID);
      expect(message).toContain(dbErr.message);
      expect(stack).toBe(dbErr.stack);
    });

    it("resolveRecipients() ném (mirror chat ca 14 — hợp đồng payload lệch) → cũng log + re-throw, KHÔNG lặng lẽ rơi vào no_recipient", async () => {
      const contractErr = new Error("payload THIẾU trường bắt buộc 'recipientUserId'");
      bridge.registerSource(
        makeMapping({
          resolveRecipients: async () => {
            throw contractErr;
          },
        }),
      );
      const [consumer] = bus.consumersFor("task.assigned");

      await expect(consumer.handle(ctxOf())).rejects.toBe(contractErr);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(engine.intake).not.toHaveBeenCalled(); // chặn TRƯỚC khi tới engine — không thể lẫn với no_recipient
    });
  });

  describe("handle — payloadOf whitelist (S4-INT-5, defense-in-depth cho payload nhạy cảm)", () => {
    it("KHÔNG khai payloadOf → forward NGUYÊN ctx.payload (backward-compat TASK/LEAVE/ATT)", async () => {
      engine.intake.mockResolvedValue({ createdCount: 1, skippedCount: 0, dedupedCount: 0 });
      bridge.registerSource(makeMapping());
      const [consumer] = bus.consumersFor("task.assigned");
      const payload = { taskId: "t-1", secretField: "leak-me" };

      await consumer.handle(ctxOf(payload));

      expect(engine.intake).toHaveBeenCalledWith(COMPANY_ID, expect.objectContaining({ payload }));
    });

    it("CÓ khai payloadOf → strip khoá KHÔNG whitelist TRƯỚC khi tới engine (vd token envelope KHÔNG lọt)", async () => {
      engine.intake.mockResolvedValue({ createdCount: 1, skippedCount: 0, dedupedCount: 0 });
      bridge.registerSource(makeMapping({ payloadOf: (ctx) => ({ taskId: ctx.payload.taskId }) }));
      const [consumer] = bus.consumersFor("task.assigned");

      await consumer.handle(ctxOf({ taskId: "t-1", resetTokenEnc: "should-not-leak" }));

      expect(engine.intake).toHaveBeenCalledWith(
        COMPANY_ID,
        expect.objectContaining({ payload: { taskId: "t-1" } }),
      );
    });
  });
});
