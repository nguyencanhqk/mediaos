import { Logger } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WS_EVENTS, type WsChatCallEvent } from "@mediaos/contracts";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { chatUserRoomName } from "./rooms";

/**
 * S10-CHAT-EMITGUARD-1 (KI-075) — **ghim bất biến biên**: `emitChatCall` KHÔNG BAO GIỜ ném ra caller.
 *
 * ┌─ VÌ SAO FILE NÀY TỒN TẠI ───────────────────────────────────────────────────────────────────────┐
 * │ HAI job CHAT (`ChatCallRingingTimeoutJobHandler` :68 `emitExpired` · `ChatCallStaleActiveSweep`  │
 * │ :72 `emitAutoEnded`) gọi đường phát này **SAU COMMIT**, và cả hai **idempotent theo thiết kế**   │
 * │ — hàng vừa đổi trạng thái không còn khớp vị từ `status` của nhịp kế. Nếu `emitChatCall` ném:     │
 * │   1. `run()` reject ⇒ `JobRunner` finalize run-row `'Failed'` cho một tx ĐÃ commit;              │
 * │   2. nhịp scheduler kế khớp **0 hàng** ⇒ sự kiện mất **VĨNH VIỄN**, chạy lại job KHÔNG sửa được; │
 * │   3. CALL **không có đường REST bù** (`chat-calls.controller.ts` chỉ có 4 route `@Post` vòng     │
 * │      đời, 0 route ĐỌC để poll) ⇒ người dùng giữ chuông/khung gọi của một cuộc gọi đã chết.       │
 * │                                                                                                  │
 * │ Trước WO này, bất biến đó là một **lời hứa không ai ghim**: `grep emitChatCall *.spec.ts` ⇒ 0    │
 * │ kết quả. Ai chuyển `.parse()` ra ngoài `try`, hay cắm một emitter rethrow, đổi hành vi của hai   │
 * │ job cách đó HAI thư mục mà typecheck vẫn xanh (họ [[ui-promises-backend-never-reads]]).          │
 * └──────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Đây là nợ **ĐỘ BỀN**, không phải lỗ đang chảy máu: hôm nay `emitChatCall` đã tự bọc try/catch.
 * File này không sửa gì — nó **giữ** thứ đang đúng, và làm việc gỡ nó ra trở nên ĐỎ chứ không im lặng.
 *
 * ⚠️ Ca ALLOW ở cuối là BẮT BUỘC: thiếu nó thì đột biến "`emitChatCall` return ngay dòng đầu" vẫn xanh
 * trọn 4 ca DENY ([[deny-cases-vacuous-without-allow-case]]).
 */

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const ROOM = "11111111-1111-4111-8111-111111111111";
const CALL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const PAYLOAD: WsChatCallEvent = {
  callId: CALL,
  roomId: ROOM,
  kind: "audio",
  status: "missed",
  initiatorUserId: USER_A,
  startedAt: "2026-08-24T09:00:00.000Z",
  action: "missed",
};

/** `emit` ném ⇒ mô phỏng adapter Valkey/socket.io hỏng giữa chừng (nhánh KHÓ dựng nhất trên đời thật). */
function makeEmitter(opts: { emitThrows?: boolean; withServer?: boolean } = {}) {
  const { emitThrows = false, withServer = true } = opts;
  const emit = vi.fn(() => {
    if (emitThrows) throw new Error("adapter Valkey rớt giữa emit");
  });
  const toTargets: unknown[] = [];
  const to = vi.fn((t: unknown) => {
    toTargets.push(t);
    return { emit };
  });
  const svc = new RealtimeEmitterService();
  if (withServer) svc.setServer({ to } as never);
  const error = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  return { svc, to, emit, toTargets, error };
}

describe("emitChatCall — hợp đồng biên `realtime/`: KHÔNG BAO GIỜ ném ra caller (KI-075)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("DENY-1 gateway /ws CHƯA sẵn sàng ⇒ không ném, ghi `error` (KHÔNG no-op câm), 0 emit", () => {
    const t = makeEmitter({ withServer: false });

    expect(() => t.svc.emitChatCall(COMPANY, [USER_A], PAYLOAD)).not.toThrow();

    // ⚠️ Đọc `mock.calls` TRƯỚC mọi `restore` ([[mockrestore-wipes-mock-calls]]).
    expect(t.error).toHaveBeenCalledTimes(1);
    // `error` chứ không `warn`/`debug`: mất chuông phải để lại dấu đủ trả lời khiếu nại "tôi không nhận
    // được cuộc gọi nào" — CALL không có đường REST để poll bù.
    expect(String((t.error.mock.calls[0] as unknown[])[0])).toContain(CALL);
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("DENY-2 payload SAI schema (`startedAt` không phải ISO) ⇒ không ném, ghi `error`, KHÔNG emit", () => {
    const t = makeEmitter();
    const bad = { ...PAYLOAD, startedAt: "hôm-qua" } as WsChatCallEvent;

    expect(() => t.svc.emitChatCall(COMPANY, [USER_A], bad)).not.toThrow();

    expect(t.error).toHaveBeenCalledTimes(1);
    // `.parse()` chặn TRƯỚC `to().emit()` — bất biến masking (CLAUDE.md §5) không được đi vòng.
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("DENY-3 `to().emit()` TỰ ném (adapter rớt) ⇒ nuốt tại biên, không ném ra caller", () => {
    const t = makeEmitter({ emitThrows: true });

    expect(() => t.svc.emitChatCall(COMPANY, [USER_A, USER_B], PAYLOAD)).not.toThrow();

    expect(t.emit).toHaveBeenCalledTimes(1);
    expect(t.error).toHaveBeenCalledTimes(1);
  });

  it("DENY-4 danh sách người nhận RỖNG ⇒ không ném và KHÔNG `to()` (bẫy phát cả namespace)", () => {
    const t = makeEmitter();

    expect(() => t.svc.emitChatCall(COMPANY, [], PAYLOAD)).not.toThrow();

    // Socket.IO coi `.to([])` là phát cho TOÀN namespace — tức mọi socket của MỌI công ty.
    expect(t.to).not.toHaveBeenCalled();
    expect(t.emit).not.toHaveBeenCalled();
  });

  it("ALLOW đường xanh ⇒ ĐÚNG 1 emit tới `chatUserRoomName` của TỪNG người, 0 `error`", () => {
    const t = makeEmitter();

    t.svc.emitChatCall(COMPANY, [USER_A, USER_B], PAYLOAD);

    expect(t.emit).toHaveBeenCalledTimes(1);
    expect((t.emit.mock.calls[0] as unknown[])[0]).toBe(WS_EVENTS.CHAT_CALL);
    expect(t.toTargets).toEqual([
      [chatUserRoomName(COMPANY, USER_A), chatUserRoomName(COMPANY, USER_B)],
    ]);
    expect(t.error).not.toHaveBeenCalled();
  });
});
