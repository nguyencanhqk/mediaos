import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CallSignallingGateway } from "./call-signalling.gateway";

/**
 * S7-CALL-RT-1 — ba tính chất của gateway `/ws-call` mà int-spec KHÔNG đo được, vì chúng nói về thứ
 * KHÔNG XẢY RA (cờ tắt ⇒ không có kết nối nào để quan sát; `setServer` ⇒ hỏng ở một module khác).
 *
 * Colocated trong `src/` để LUÔN chạy — int-spec `skipIf(!LANE_DB)` sẽ cho chúng ngủ đúng lúc cần.
 */

interface Deps {
  tokens: { verifyAccessToken: ReturnType<typeof vi.fn> };
  permissions: { can: ReturnType<typeof vi.fn> };
  signal: { resolveSignalAccess: ReturnType<typeof vi.fn> };
  cooldown: { allow: ReturnType<typeof vi.fn> };
  securityEvents: { record: ReturnType<typeof vi.fn> };
  db: { withTenant: ReturnType<typeof vi.fn> };
  emitter: { setServer: ReturnType<typeof vi.fn>; setCallServer: ReturnType<typeof vi.fn> };
}

function makeDeps(): Deps {
  return {
    tokens: { verifyAccessToken: vi.fn() },
    permissions: { can: vi.fn(async () => ({ allow: true })) },
    signal: { resolveSignalAccess: vi.fn() },
    cooldown: { allow: vi.fn(async () => true) },
    securityEvents: { record: vi.fn() },
    db: { withTenant: vi.fn() },
    emitter: { setServer: vi.fn(), setCallServer: vi.fn() },
  };
}

const makeGateway = (d: Deps): CallSignallingGateway =>
  new CallSignallingGateway(
    d.tokens as never,
    d.permissions as never,
    d.signal as never,
    d.cooldown as never,
    d.securityEvents as never,
    d.db as never,
    d.emitter as never,
  );

describe("CallSignallingGateway — afterInit", () => {
  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REALTIME_ENABLED;
  });

  it("REALTIME_ENABLED=false ⇒ TỪ CHỐI mọi kết nối `/ws-call` (fail-closed)", () => {
    // Hệ quả phải nói ra cho FE-1: tắt cờ = KHÔNG GỌI ĐƯỢC. Không có fallback REST cho SDP/ICE — bản
    // chất của nó là kênh độ trễ thấp. FE phải hiện lỗi rõ, không treo khung "đang kết nối".
    process.env.REALTIME_ENABLED = "false";
    const deps = makeDeps();
    const gw = makeGateway(deps);

    const middlewares: Array<(c: unknown, n: (e?: Error) => void) => void> = [];
    const server = { use: vi.fn((fn) => middlewares.push(fn)) };
    gw.afterInit(server as never);

    expect(middlewares).toHaveLength(1);
    const next = vi.fn();
    middlewares[0]({}, next);
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toBe("realtime_disabled");
    // Cờ tắt ⇒ cũng KHÔNG treo namespace vào emitter: không có kênh nào để cắt, và không có kênh nào
    // để phát.
    expect(deps.emitter.setCallServer).not.toHaveBeenCalled();
  });

  it("LANDMINE — gateway KHÔNG BAO GIỜ gọi `emitter.setServer` (đó là namespace `/ws`)", () => {
    // ⚠️ `RealtimeEmitterService` giữ đúng MỘT `server` cho `/ws`. Nếu gateway này ghi đè nó bằng
    // namespace `/ws-call`, thì `notification:new` + TOÀN BỘ cụm CHAT sẽ bắn vào một namespace không ai
    // ở trong — hỏng IM LẶNG toàn hệ, và không test nào của CHAT/NOTI bắt được (chúng không dựng
    // gateway thứ hai). Đây là lý do có setter RIÊNG.
    const deps = makeDeps();
    const gw = makeGateway(deps);
    gw.afterInit({ use: vi.fn() } as never);

    expect(deps.emitter.setServer).not.toHaveBeenCalled();
    expect(deps.emitter.setCallServer).toHaveBeenCalledTimes(1);
  });

  it("bật cờ ⇒ đăng ký ĐÚNG MỘT middleware handshake", () => {
    // Positive control cho ca đầu: nếu `afterInit` không đăng ký gì cả thì ca "từ chối mọi kết nối"
    // cũng xanh một cách rỗng.
    const deps = makeDeps();
    const gw = makeGateway(deps);
    const server = { use: vi.fn() };
    gw.afterInit(server as never);

    expect(server.use).toHaveBeenCalledTimes(1);
  });
});
