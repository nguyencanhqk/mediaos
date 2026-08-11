import { randomUUID } from "node:crypto";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatCallCooldownService } from "../chat/chat-call-cooldown.service";
import type { ChatCallSignalAccess } from "../chat/chat-call-signal.service";
import {
  CALL_SIGNAL_FRAMES_PER_WINDOW,
  CALL_SIGNAL_HARD_MULTIPLIER,
  CHAT_CALL_CONNECT_MAX_PER_MIN,
} from "../chat/chat-call-signal-deny";
import { CallSignallingGateway } from "./call-signalling.gateway";
import { callRoomName, callUserRoomName } from "./rooms";

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
  violations: { record: ReturnType<typeof vi.fn> };
  emitter: { setServer: ReturnType<typeof vi.fn>; setCallServer: ReturnType<typeof vi.fn> };
}

function makeDeps(): Deps {
  return {
    tokens: { verifyAccessToken: vi.fn() },
    permissions: { can: vi.fn(async () => ({ allow: true })) },
    signal: { resolveSignalAccess: vi.fn() },
    cooldown: { allow: vi.fn(async () => true) },
    violations: { record: vi.fn() },
    emitter: { setServer: vi.fn(), setCallServer: vi.fn() },
  };
}

const makeGateway = (d: Deps): CallSignallingGateway =>
  new CallSignallingGateway(
    d.tokens as never,
    d.permissions as never,
    d.signal as never,
    d.cooldown as never,
    d.violations as never,
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

// ═══ S7-CALL-QA-1 — nhóm B/C/D: 6 ca int-spec KHÔNG dựng được ═══════════════════════════════════════
//
// Đo 11/08/2026 trước WO: `call-signalling.gateway.ts` branch **68.67%** — thấp nhất cụm CALL, trong khi
// `done_when` #3 đòi "gateway signalling CAO HƠN" mức 80 chung. `% Funcs` 98.85 là cái bẫy: mọi hàm đều
// được gọi ít nhất một lần, nhưng nhánh TỪ CHỐI bên trong chúng thì không (`deny-cases-vacuous-without-allow-case`).
//
// Vì sao từng ca dưới đây phải là UNIT — không phải "tiện tay", mỗi ca một lý do cứng:
//   B4  int cần 31 lần bắt tay (`CHAT_CALL_CONNECT_MAX_PER_MIN = 30`); và `realtime.module.ts:59` đăng ký
//       **`ChatCallCooldownService` thứ hai** ⇒ `app.get()` là mơ hồ, dễ đốt nhầm instance = ca xanh rỗng.
//   B5  `permission.service.ts:272-284` bọc try/catch trả `{allow:false}` — **không bao giờ ném** ⇒ int
//       không chạm nổi nhánh fail-CLOSED 178-184.
//   C2  đường middleware, cần một socket `connected=false` — xem docblock của chính ca đó.
//   D1  int cần 361 khung/10 s (`120 × 3`), 120 khung đầu mỗi khung 2 truy vấn ⇒ ~240 query đồng thời.
//   D2  `state` LUÔN được middleware đặt trước `next()` ⇒ int không dựng nổi socket thiếu state.
//   D3  cần `this.server.emit` ném.
//   D4  `violations.record` là singleton dùng chung ⇒ không mock được ở int.

const CO = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const PEER = "33333333-3333-4333-8333-333333333333";

interface FakeSocket {
  id: string;
  /** Mô phỏng `socket.io`: `disconnect()` là **no-op** khi socket chưa `connected` (xem `severed`). */
  connected: boolean;
  /** Socket có THẬT SỰ bị cắt không — khác "`disconnect` đã được gọi", và khác biệt đó là cả nhóm C2. */
  severed: boolean;
  data: Record<string, unknown>;
  handshake: { auth: Record<string, unknown>; headers: Record<string, unknown> };
  join: ReturnType<typeof vi.fn>;
  leave: ReturnType<typeof vi.fn>;
  onAny: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  to: ReturnType<typeof vi.fn>;
}

/**
 * ⚠️ **QUY ƯỚC DÙNG CHUNG (plan §2):** `connected` mặc định **`true`** cho D1–D4 (đường SAU connect —
 * `disconnect()` chạy thật), và **`false`** riêng cho C2 (đường middleware). Thiếu quy ước này thì D2/D4
 * trở thành đúng loại xanh-giả mà C2 đang cảnh báo: chúng sẽ "xanh" vì `disconnect` được GỌI, trong khi
 * socket vẫn sống.
 *
 * `disconnect` sao chép đúng `socket.io@4.8.3/dist/socket.js:592-594` — `if (!this.connected) return this;`
 */
function makeSocket(opts: { token?: string; connected?: boolean } = {}): FakeSocket {
  const socket: FakeSocket = {
    id: "sock-unit",
    connected: opts.connected ?? true,
    severed: false,
    data: {},
    handshake: { auth: opts.token ? { token: opts.token } : {}, headers: {} },
    join: vi.fn(async () => undefined),
    leave: vi.fn(async () => undefined),
    onAny: vi.fn(),
    disconnect: vi.fn(() => {
      if (!socket.connected) return socket;
      socket.connected = false;
      socket.severed = true;
      return socket;
    }),
    to: vi.fn(() => ({ emit: vi.fn() })),
  };
  return socket;
}

interface CallSocketStateShape {
  budget: { windowStartMs: number; count: number };
  violated: boolean;
  joinedCallIds: Set<string>;
  expiryTimer: ReturnType<typeof setTimeout> | null;
  permissionCheckedAtMs: number;
  tokenExpSec: number;
}

const stateOf = (s: FakeSocket): CallSocketStateShape =>
  (s.data as { state: CallSocketStateShape }).state;

/** Claims như `TokenService.verifyAccessToken` trả — `exp` tính bằng GIÂY epoch. */
const claims = (expSec: number) => ({
  sub: USER,
  companyId: CO,
  email: "u@t.test",
  aud: "tenant" as const,
  exp: expSec,
});

const inFuture = (sec = 900): number => Math.floor(Date.now() / 1000) + sec;

/** Chạy middleware handshake và trả về ĐỐI SỐ mà nó đưa cho `next()`. */
async function runHandshake(
  gw: CallSignallingGateway,
  socket: FakeSocket,
): Promise<Error | undefined> {
  const middlewares: Array<(c: unknown, n: (e?: Error) => void) => void> = [];
  gw.afterInit({ use: vi.fn((fn) => middlewares.push(fn)) } as never);
  expect(
    middlewares,
    "afterInit phải đăng ký middleware — nếu không, mọi ca dưới đây rỗng",
  ).toHaveLength(1);

  return await new Promise<Error | undefined>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("middleware KHÔNG gọi next() — handshake treo")),
      2000,
    );
    middlewares[0](socket, (err?: Error) => {
      clearTimeout(timer);
      resolve(err);
    });
  });
}

/** Socket đã qua handshake THẬT (state do chính gateway dựng, không phải state gõ tay). */
async function connectedSocket(
  gw: CallSignallingGateway,
  socket = makeSocket({ token: "t" }),
): Promise<FakeSocket> {
  const err = await runHandshake(gw, socket);
  expect(err, "harness: handshake phải đi qua để dựng state").toBeUndefined();
  return socket;
}

const liveAccess = (callId: string): ChatCallSignalAccess => ({
  callId,
  roomId: randomUUID(),
  status: "active",
  isLive: true,
  actorIsActive: true,
  actorIsParticipant: true,
  activeUserIds: [USER, PEER],
  participantUserIds: [USER, PEER],
});

describe("CallSignallingGateway — thang TỪ CHỐI handshake (nhóm B)", () => {
  let deps: Deps;
  let gw: CallSignallingGateway;

  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
    deps = makeDeps();
    deps.tokens.verifyAccessToken.mockReturnValue(claims(inFuture()));
    gw = makeGateway(deps);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REALTIME_ENABLED;
  });

  it("B4 — vượt trần bắt tay ⇒ `too_many_connections`, và cổng quyền KHÔNG bị chạm", async () => {
    // Trần này tồn tại vì mỗi lần bắt tay tốn một `permissions.can()` (đọc DB): "ngắt khi vi phạm" một
    // mình không đủ, kẻ dò chỉ cần nối lại vòng lặp. Vế thứ hai của ca — `can()` KHÔNG được gọi — chính
    // là tính chất đó; thiếu nó thì trần vẫn "đạt" kể cả khi ai đó chuyển nó xuống SAU cổng quyền.
    deps.cooldown.allow.mockResolvedValueOnce(false);
    const socket = makeSocket({ token: "t" });

    const err = await runHandshake(gw, socket);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("too_many_connections");
    expect(deps.permissions.can, "trần phải chặn TRƯỚC round-trip DB").not.toHaveBeenCalled();
    expect(socket.join, "bị từ chối ⇒ KHÔNG vào room nào").not.toHaveBeenCalled();

    // Bucket phải là bucket ĐÚNG: theo (scope bắt tay, công ty, người) + trần 30/60 s. Sai khoá thì trần
    // đo bucket của người khác và ca vẫn xanh.
    const [key, limit, window] = deps.cooldown.allow.mock.calls[0];
    expect(key).toContain(CO);
    expect(key).toContain(USER);
    expect(limit).toBe(CHAT_CALL_CONNECT_MAX_PER_MIN);
    expect(window).toBe(60);
  });

  it("B4b — ĐỐI CHỨNG: cùng token, chỉ khác `cooldown.allow` ⇒ nối được", async () => {
    // Cặp tối thiểu (plan §2 nhóm B): khác ĐÚNG một bit so với B4. Không có ca này thì B4 xanh kể cả khi
    // handshake từ chối vì một lý do hoàn toàn khác (token dựng sai, thiếu `email`, …).
    const socket = makeSocket({ token: "t" });
    const err = await runHandshake(gw, socket);

    expect(err).toBeUndefined();
    expect(socket.join).toHaveBeenCalledWith(callUserRoomName(CO, USER));
  });

  it("B5 — `permissions.can` NÉM ⇒ fail-CLOSED `unauthorized` (không phải cho qua)", async () => {
    // ⚠️ Vì sao ca này bắt buộc là unit: `permission.service.ts:272-284` bọc try/catch và trả
    // `{allow:false}` — nó KHÔNG BAO GIỜ ném, nên nhánh `.catch()` của `afterInit` (178-184) không có
    // đường nào chạm tới từ int-spec. Nhưng nhánh đó là hàng rào thật: Valkey/DB sập ở cổng vào KHÔNG
    // được biến thành "cho qua".
    deps.permissions.can.mockRejectedValueOnce(new Error("valkey sập"));
    const socket = makeSocket({ token: "t" });

    const err = await runHandshake(gw, socket);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("unauthorized");
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.data.state, "không được dựng phiên khi cổng vào lỗi").toBeUndefined();
  });

  it("B — thông điệp từ chối KHÔNG phân biệt được nấc nào (`unauthorized` cho cả 3 nấc token)", async () => {
    // Tính chất này là chủ đích: một chuỗi lỗi riêng cho từng nấc là oracle miễn phí cho người dò cửa.
    // Ghim nó ở đây để không ai "cải thiện DX" bằng cách tách thông điệp ra.
    const noToken = await runHandshake(gw, makeSocket());
    deps.tokens.verifyAccessToken.mockImplementationOnce(() => {
      throw new Error("jwt expired");
    });
    const badToken = await runHandshake(gw, makeSocket({ token: "t" }));
    deps.tokens.verifyAccessToken.mockReturnValueOnce({ ...claims(inFuture()), exp: undefined });
    const noExp = await runHandshake(gw, makeSocket({ token: "t" }));

    for (const err of [noToken, badToken, noExp]) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("unauthorized");
    }
  });

  it("B — token KHÔNG có `exp` ⇒ TỪ CHỐI (fail-closed: `jwt.verify` cho qua token vô hạn)", async () => {
    // `signAccessToken` LUÔN đặt `expiresIn`, nên ca này chỉ xảy ra với token dựng tay — và đó chính là
    // lý do phải chặn: "vô hạn" ở kênh này nghĩa là một phiên signalling không bao giờ xác thực lại.
    deps.tokens.verifyAccessToken.mockReturnValueOnce({ ...claims(inFuture()), exp: undefined });
    const socket = makeSocket({ token: "t" });

    const err = await runHandshake(gw, socket);

    expect((err as Error).message).toBe("unauthorized");
    expect(socket.data.state).toBeUndefined();
  });

  it("B6 — token rút được từ header `Authorization: Bearer` (đường thứ hai), rỗng thì KHÔNG", async () => {
    const viaHeader = makeSocket();
    viaHeader.handshake.headers["authorization"] = "Bearer abc.def.ghi";
    expect(await runHandshake(gw, viaHeader)).toBeUndefined();
    expect(deps.tokens.verifyAccessToken).toHaveBeenCalledWith("abc.def.ghi");

    // `auth.token` rỗng KHÔNG được coi là có token (nếu không, `verifyAccessToken("")` mới là thứ quyết
    // định, và thông điệp lỗi đổi nghĩa).
    const emptyAuth = makeSocket();
    emptyAuth.handshake.auth = { token: "" };
    expect((await runHandshake(gw, emptyAuth)) as Error).toBeInstanceOf(Error);

    // Header sai tiền tố ⇒ coi như KHÔNG có token.
    const wrongScheme = makeSocket();
    wrongScheme.handshake.headers["authorization"] = "Basic abc";
    expect((await runHandshake(gw, wrongScheme)) as Error).toBeInstanceOf(Error);
  });
});

describe("CallSignallingGateway — vòng đời phiên (nhóm C)", () => {
  let deps: Deps;
  let gw: CallSignallingGateway;

  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
    deps = makeDeps();
    deps.tokens.verifyAccessToken.mockReturnValue(claims(inFuture()));
    gw = makeGateway(deps);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REALTIME_ENABLED;
  });

  it("C — token còn hạn ⇒ hẹn giờ ngắt ĐƯỢC ĐẶT, và `handleDisconnect` dọn nó", async () => {
    // Positive control của C2 ngay dưới: nếu `scheduleTokenExpiry` không đặt timer trong ca thường thì
    // `expiryTimer === null` của C2 chẳng chứng minh được gì.
    const socket = await connectedSocket(gw);
    expect(stateOf(socket).expiryTimer, "đường thường PHẢI có hẹn giờ").not.toBeNull();

    gw.handleDisconnect(socket as never);
    // Thiếu bước dọn thì mỗi kết nối để lại một timer sống tới hạn token, và một tick sau teardown chạm
    // vào socket đã đóng.
    expect(stateOf(socket).expiryTimer).toBeNull();
  });

  it("TRIPWIRE S7-CALL-RT-FIX-1 — `ttlMs<=0` hiện KHÔNG bị từ chối (LỖ MỞ; ca này PHẢI đỏ khi bản vá land)", async () => {
    // ┌─ ĐỌC TRƯỚC KHI XOÁ CA NÀY ────────────────────────────────────────────────────────────────────┐
    // │ Đây là **characterization test**: nó khẳng định hành vi HIỆN TẠI, và hành vi hiện tại là SAI.  │
    // │ Docblock `scheduleTokenExpiry` hứa "fail-CLOSED nếu đồng hồ lệch". Thực tế NGƯỢC LẠI, và chuỗi │
    // │ đã kiểm chứng trên nguồn (plan `S7-CALL-QA-1.md` §1e, 4 mắt xích):                             │
    // │   socket.io/dist/socket.js:592-594  `disconnect(close)` → `if (!this.connected) return this;`  │
    // │   socket.js:90 / :408              `connected=false` lúc khởi tạo, chỉ `true` trong `_onconnect`│
    // │   namespace.js:221 → :241          middleware `run()` chạy TRƯỚC `_doConnect`→`_onconnect`     │
    // │   gateway:260                      `scheduleTokenExpiry` gọi TRONG middleware, trước `next()`  │
    // │ ⇒ `client.disconnect(true)` ở dòng 296 là **no-op**; `handshake()` chạy tiếp tới `return       │
    // │ undefined` ⇒ kết nối ĐƯỢC CHẤP NHẬN với token đã hết hạn và `expiryTimer = null`. Socket đó    │
    // │ ngồi trong room của chính người đó và NHẬN mọi SDP/ICE bắn tới họ, VÔ THỜI HẠN.                │
    // │                                                                                                │
    // │ **Vì sao KHÔNG dùng `it.fails`:** `it.fails` xanh khi thân bài ném vì BẤT KỲ lý do gì (typo,   │
    // │ import sai, fake socket refactor đẻ `TypeError`) ⇒ ca hỏng vì lý do khác vẫn xanh MÃI MÃI kể cả│
    // │ sau khi bản vá land — tripwire không bao giờ nổ, đúng thứ ta muốn tránh.                       │
    // │ **CẤM** assert "`disconnect()` được gọi" — đó CHÍNH LÀ assert sai đã che lỗ này suốt.          │
    // │                                                                                                │
    // │ Khi `S7-CALL-RT-FIX-1` land: `nextArg` thành `Error` ⇒ ca này ĐỎ ⇒ lật nó thành hành vi đúng   │
    // │ (từ chối handshake) trong CÙNG PR. KI đăng ký ở plan RT-FIX-1.                                 │
    // └────────────────────────────────────────────────────────────────────────────────────────────────┘
    deps.tokens.verifyAccessToken.mockReturnValue(claims(Math.floor(Date.now() / 1000) - 5));
    // `connected: false` = đúng trạng thái socket trong middleware (xem mắt xích 2/3 ở trên).
    const socket = makeSocket({ token: "t", connected: false });

    const nextArg = await runHandshake(gw, socket);

    expect(nextArg, "handshake ĐƯỢC CHẤP NHẬN — hành vi HIỆN TẠI, và là lỗ").toBeUndefined();
    expect(stateOf(socket).expiryTimer, "và không có gì cắt phiên").toBeNull();
    expect(socket.severed, "`disconnect()` trong middleware là no-op — socket KHÔNG bị cắt").toBe(
      false,
    );
    // Vế đắt nhất: socket đã vào room nhận của chính mình ⇒ nó NHẬN relay từ đây.
    expect(socket.join).toHaveBeenCalledWith(callUserRoomName(CO, USER));
  });
});

describe("CallSignallingGateway — trần khung + đường hỏng (nhóm D)", () => {
  let deps: Deps;
  let gw: CallSignallingGateway;
  let callId: string;

  beforeEach(() => {
    process.env.REALTIME_ENABLED = "true";
    deps = makeDeps();
    deps.tokens.verifyAccessToken.mockReturnValue(claims(inFuture()));
    gw = makeGateway(deps);
    callId = randomUUID();
    deps.signal.resolveSignalAccess.mockResolvedValue(liveAccess(callId));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.REALTIME_ENABLED;
  });

  it("D1 ALLOW — trong trần (gieo 119 ⇒ khung thứ 120) khung được XỬ LÝ bình thường", async () => {
    // 🔴 Hạt giống phải đúng: `chargeFrame` tính `next.count = fresh.count + 1` RỒI mới so sánh, nên gieo
    // 119 cho verdict "ok" (không phải "drop"). Sai một đơn vị ở đây là ca DENY bên dưới đo nhầm nấc.
    const socket = await connectedSocket(gw);
    stateOf(socket).budget.count = CALL_SIGNAL_FRAMES_PER_WINDOW - 1;

    const res = await gw.onPing(socket as never, { callId });

    expect(res, "khung hợp lệ ⇒ có pong").toBeTruthy();
    expect(res?.data).toEqual({ callId });
    expect(socket.severed).toBe(false);
    expect(deps.signal.resolveSignalAccess).toHaveBeenCalledTimes(1);
  });

  it("D1 MỀM — vượt trần mềm (gieo 120) ⇒ BỎ khung, socket VẪN SỐNG, và KHÔNG chạm DB", async () => {
    const socket = await connectedSocket(gw);
    stateOf(socket).budget.count = CALL_SIGNAL_FRAMES_PER_WINDOW;

    const res = await gw.onPing(socket as never, { callId });

    expect(res, "khung bị bỏ ⇒ không trả gì").toBeUndefined();
    expect(socket.severed, "trần MỀM là bó băng thông, KHÔNG phải cáo buộc dò cửa").toBe(false);
    // Đây là toàn bộ lý do trần nằm ở bước (1): Nest gửi handler qua `mergeMap` concurrency VÔ HẠN, nên
    // lớp "bỏ im lặng" mà đặt sau truy vấn sẽ thành bộ khuếch đại DoS lên pool PgBouncer dùng chung.
    expect(deps.signal.resolveSignalAccess).not.toHaveBeenCalled();
    expect(stateOf(socket).violated, "bỏ khung KHÔNG ghi sự kiện an ninh").toBe(false);
  });

  it("D1 CỨNG — vượt trần cứng (gieo 360) ⇒ NGẮT, và vẫn KHÔNG chạm DB", async () => {
    const socket = await connectedSocket(gw);
    stateOf(socket).budget.count = CALL_SIGNAL_FRAMES_PER_WINDOW * CALL_SIGNAL_HARD_MULTIPLIER;

    const res = await gw.onPing(socket as never, { callId });

    expect(res).toBeUndefined();
    expect(socket.severed, "vượt trần CỨNG ⇒ ngắt thật").toBe(true);
    expect(deps.signal.resolveSignalAccess).not.toHaveBeenCalled();
  });

  it("D2 — khung tới mà socket KHÔNG có `state` (bug wiring) ⇒ log ERROR + ngắt, KHÔNG im lặng", async () => {
    // Không thể xảy ra qua đường thường (middleware đặt `state` TRƯỚC `next()`), nhưng nếu xảy ra thì nó
    // TUYỆT ĐỐI không được trông giống một khung bị chặn bình thường — đó là bug wiring, phải kêu.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = makeSocket({ token: "t" });

    const res = await gw.onPing(socket as never, { callId });

    expect(res).toBeUndefined();
    expect(socket.severed).toBe(true);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0][0]).toContain("KHÔNG có state");
  });

  it("D3 — `relay()` NÉM ⇒ log ERROR (kèm sự kiện + room), KHÔNG ném lên handler", async () => {
    // `relay()` chỉ đi qua `this.server` khi `from === null` — tức đường `sdp`/`ice` hoặc
    // `handleDisconnect`. Bắn `call:join` sẽ KHÔNG chạm nhánh này (nó dùng `client`).
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = await connectedSocket(gw);
    stateOf(socket).joinedCallIds.add(callId);
    (gw as unknown as { server: unknown }).server = {
      to: () => ({
        emit: () => {
          throw new Error("adapter Valkey rớt");
        },
      }),
    };

    expect(() => gw.handleDisconnect(socket as never)).not.toThrow();

    expect(errors).toHaveBeenCalledTimes(1);
    const line = errors.mock.calls[0][0] as string;
    expect(line).toContain("adapter Valkey rớt");
    // `target` (tên room) là thứ DUY NHẤT tra được "cuộc gọi nào mất khung", và nó an toàn theo R3 —
    // tên room không chứa SDP/candidate. Im lặng ở đây = một cuộc gọi không bao giờ nối, không ai biết vì sao.
    expect(line).toContain(callRoomName(CO, callId));
  });

  it("D6 (unit) — socket ở HAI cuộc gọi rớt ⇒ CẢ HAI phòng nhận `peer-left`", async () => {
    // Bất biến `joinedCallIds` là `Set` hiện chỉ sống trong docblock (`gateway:92-96`): đổi `Set` → biến
    // đơn hôm nay không làm đỏ bài nào. Hỏng IM LẶNG = người ma treo trong cuộc gọi VÀO TRƯỚC.
    // (Vế end-to-end đo ở int-spec — ca D6; ca này giữ bất biến sống cả khi không có LANE_DB.)
    const second = randomUUID();
    const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
    const socket = await connectedSocket(gw);
    stateOf(socket).joinedCallIds.add(callId);
    stateOf(socket).joinedCallIds.add(second);
    (gw as unknown as { server: unknown }).server = {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => emitted.push({ room, event, payload }),
      }),
    };

    gw.handleDisconnect(socket as never);

    expect(emitted.map((e) => e.room).sort()).toEqual(
      [callRoomName(CO, callId), callRoomName(CO, second)].sort(),
    );
    for (const e of emitted) {
      expect(e.event).toBe("call:peer-left");
      expect(e.payload).toEqual({ callId: expect.any(String), userId: USER });
    }
    expect(stateOf(socket).joinedCallIds.size, "dọn sạch, không báo lại lần hai").toBe(0);
  });

  it("D4 — ghi `user_security_events` HỎNG ⇒ vẫn NGẮT, và lỗi ghi được log LOUD", async () => {
    // Vào `punish()` qua đường công khai: `call:ping` với payload sai schema ⇒ `deny` → `punish`.
    // Ngắt là hàng rào, ghi là dấu vết — ghi hỏng không được cản hàng rào. Nhưng "im lặng" ở đây nghĩa là
    // timeline bảo mật thiếu dòng mà không ai biết.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    deps.violations.record.mockRejectedValueOnce(new Error("append-only từ chối"));
    const socket = await connectedSocket(gw);

    const res = await gw.onPing(socket as never, {});

    expect(res).toBeUndefined();
    expect(socket.severed, "ghi hỏng KHÔNG được cản việc ngắt").toBe(true);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("append-only từ chối"))).toBe(true);
    expect(stateOf(socket).violated).toBe(true);
  });

  it("D4b — vượt trần ghi ⇒ CHỈ ngắt, KHÔNG ghi (hàng rào chống bơm không tự thành đường bơm)", async () => {
    // Hai vế phải TÁCH nhau: nếu vượt trần mà cũng thôi ngắt thì hàng rào tự mở cửa cho đúng kẻ đã chạm
    // trần. `user_security_events` là append-only và KHÔNG có job dọn.
    deps.cooldown.allow.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const socket = await connectedSocket(gw);

    await gw.onPing(socket as never, {});

    expect(deps.violations.record, "vượt trần ⇒ không ghi").not.toHaveBeenCalled();
    expect(socket.severed, "…nhưng VẪN ngắt").toBe(true);
  });

  it("D4c — `disconnect()` NÉM trong `finally` ⇒ không sập, không đẻ unhandledRejection", async () => {
    // ⚠️ `punish` có call site KHÔNG-await duy nhất (`screenFrame` qua `onAny`). Một exception ném ra TỪ
    // `finally` làm chính promise đó reject ⇒ `unhandledRejection` ⇒ giết tiến trình
    // (memory `vitest-unhandled-rejection-after-teardown`). Ngắt là hàng rào; nó không được tự thành sự cố.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = await connectedSocket(gw);
    socket.disconnect.mockImplementation(() => {
      throw new Error("socket đã hỏng");
    });

    await expect(gw.onPing(socket as never, {})).resolves.toBeUndefined();

    expect(errors.mock.calls.some((c) => String(c[0]).includes("ngắt kết nối THẤT BẠI"))).toBe(
      true,
    );
    expect(errors.mock.calls.some((c) => String(c[0]).includes("phiên có thể còn sống"))).toBe(
      true,
    );
  });

  it("D4d — `punish()` ném NGOÀI try/catch nội bộ ⇒ `.catch` của `screenFrame` nuốt, KHÔNG unhandledRejection", async () => {
    // ⚠️ `punish()` gọi `ChatCallCooldownService.key(...)` **NGOÀI** khối `try` (`gateway:744-749`), nên
    // đó là đường DUY NHẤT làm chính promise `punish` reject. Call site của nó (`screenFrame` qua `onAny`)
    // **KHÔNG await** ⇒ một reject thoát ra là `unhandledRejection` = giết cả tiến trình vitest
    // (memory `vitest-unhandled-rejection-after-teardown`). Lớp `.catch` bồi ở `:332-337` là hàng rào đó,
    // và trước ca này nó chưa từng chạy.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = await connectedSocket(gw);
    const keySpy = vi.spyOn(ChatCallCooldownService, "key").mockImplementation(() => {
      throw new Error("key() hỏng");
    });

    // `onAny` được đăng ký trong handshake; gọi thẳng listener = mô phỏng một khung NGOÀI allowlist.
    const onAnyListener = socket.onAny.mock.calls[0][0] as (event: string) => void;
    expect(() => onAnyListener("call:evil"), "không được ném đồng bộ").not.toThrow();
    await new Promise((r) => setTimeout(r, 10));

    keySpy.mockRestore();
    expect(errors.mock.calls.some((c) => String(c[0]).includes("punish() ném ngoài dự kiến"))).toBe(
      true,
    );
  });

  it("D — khung của socket ĐÃ vi phạm bị bỏ ngay, không tính trần, không hỏi DB lần nữa", async () => {
    const socket = await connectedSocket(gw);
    stateOf(socket).violated = true;

    const res = await gw.onPing(socket as never, { callId });

    expect(res).toBeUndefined();
    expect(deps.signal.resolveSignalAccess).not.toHaveBeenCalled();
  });
});
