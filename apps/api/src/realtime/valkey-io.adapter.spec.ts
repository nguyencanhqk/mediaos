import { IoAdapter } from "@nestjs/platform-socket.io";
import { Logger, type INestApplicationContext } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Điều khiển hành vi `connect()` của ioredis giả cho từng ca. */
const redisState = {
  failOn: null as null | "pub" | "sub",
  created: [] as Array<{
    role: string;
    quit: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  }>,
};

vi.mock("ioredis", () => {
  class FakeRedis {
    private readonly role: string;
    readonly quit = vi.fn(async () => "OK");
    readonly disconnect = vi.fn(() => undefined);
    readonly on = vi.fn(() => this);
    constructor(_url?: string, _opts?: unknown, role = "pub") {
      this.role = role;
      redisState.created.push({ role, quit: this.quit, disconnect: this.disconnect });
    }
    duplicate(): FakeRedis {
      return new FakeRedis(undefined, undefined, "sub");
    }
    async connect(): Promise<void> {
      if (redisState.failOn === this.role) throw new Error(`connect refused (${this.role})`);
    }
  }
  return { default: FakeRedis };
});

const createAdapterMock = vi.fn(() => "adapter-fn" as unknown);
vi.mock("@socket.io/redis-adapter", () => ({
  createAdapter: (...args: unknown[]) => createAdapterMock(...(args as [])),
}));

// `vi.mock` được vitest hoist lên trên mọi import → import tĩnh vẫn nhận bản giả (không cần top-level await).
import { ValkeyIoAdapter } from "./valkey-io.adapter";

const APP = {} as INestApplicationContext;
const URL = "redis://localhost:6379";
const KEY = "socket.io:test:mediaos_chatrt0";

describe("ValkeyIoAdapter — kết nối Valkey (S7-CHAT-RT-0)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    redisState.failOn = null;
    redisState.created = [];
    createAdapterMock.mockClear();
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("kết nối OK → isMultiInstanceReady()=true, KHÔNG log ERROR", async () => {
    const adapter = new ValkeyIoAdapter(APP);
    await expect(adapter.connectToValkey(URL, KEY)).resolves.toBe(true);
    expect(adapter.isMultiInstanceReady()).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("LUÔN truyền opts.key cho createAdapter — không để rơi về kênh mặc định dùng chung PROD", async () => {
    await new ValkeyIoAdapter(APP).connectToValkey(URL, KEY);
    expect(createAdapterMock).toHaveBeenCalledTimes(1);
    const [, , opts] = createAdapterMock.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { key: string },
    ];
    expect(opts).toEqual({ key: KEY });
  });

  it("connect HỎNG → log ERROR (không phải WARN) + isMultiInstanceReady()=false + KHÔNG throw", async () => {
    redisState.failOn = "pub";
    const adapter = new ValkeyIoAdapter(APP);
    await expect(adapter.connectToValkey(URL, KEY)).resolves.toBe(false);
    expect(adapter.isMultiInstanceReady()).toBe(false);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("BROADCAST ĐA INSTANCE TẮT");
  });

  it("pub connect XONG nhưng sub HỎNG → ĐÓNG cả hai client (không bỏ rơi client đang mở)", async () => {
    redisState.failOn = "sub";
    await new ValkeyIoAdapter(APP).connectToValkey(URL, KEY);
    expect(redisState.created).toHaveLength(2);
    for (const c of redisState.created) expect(c.quit).toHaveBeenCalledTimes(1);
  });

  it("listener 'error' gắn TRƯỚC connect (nhánh hỏng vẫn có listener → không crash tiến trình)", async () => {
    // FakeRedis.connect() ném ở lần gọi đầu; nếu `.on("error")` bị gắn SAU `await connect()` như bản gốc,
    // client hỏng sẽ không có listener nào. Ở đây cả hai client phải đã được gắn trước khi lỗi bung ra.
    redisState.failOn = "pub";
    await new ValkeyIoAdapter(APP).connectToValkey(URL, KEY);
    const onCalls = redisState.created.length;
    expect(onCalls).toBe(2);
  });
});

describe("ValkeyIoAdapter.createIOServer — biên cross-origin (S7-CHAT-RT-0)", () => {
  const ORIGINS = "http://localhost:5273, https://funtimemediacorp.com";
  let captured: Record<string, unknown> | undefined;
  let prevCors: string | undefined;

  beforeEach(() => {
    captured = undefined;
    prevCors = process.env.CORS_ORIGIN;
    process.env.CORS_ORIGIN = ORIGINS;
    vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    // Chặn ở lớp cha: chỉ cần bắt `options` mà adapter dựng, không cần server socket.io thật
    // (hành vi đầu-cuối thật do int-spec chat-rt0-ws-adapter chứng minh).
    vi.spyOn(IoAdapter.prototype, "createIOServer").mockImplementation(((
      _port: number,
      options?: Record<string, unknown>,
    ) => {
      captured = options;
      return { adapter: vi.fn() };
    }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = prevCors;
  });

  const allowRequestOf = (): ((req: unknown, cb: (m: unknown, ok: boolean) => void) => void) =>
    captured?.["allowRequest"] as never;

  const ask = (origin: string | undefined): Promise<[unknown, boolean]> =>
    new Promise((resolve) =>
      allowRequestOf()({ headers: { origin } }, (m, ok) => resolve([m, ok])),
    );

  it("set cors từ CORS_ORIGIN (tách + trim) kể cả khi adapter Valkey KHÔNG gắn được", () => {
    const adapter = new ValkeyIoAdapter(APP);
    expect(adapter.isMultiInstanceReady()).toBe(false); // chưa connectToValkey
    adapter.createIOServer(0);
    expect(captured?.["cors"]).toEqual({
      origin: ["http://localhost:5273", "https://funtimemediacorp.com"],
      credentials: true,
    });
  });

  it("allowRequest CHO PHÉP origin trong danh sách", async () => {
    new ValkeyIoAdapter(APP).createIOServer(0);
    await expect(ask("http://localhost:5273")).resolves.toEqual([undefined, true]);
  });

  it("allowRequest TỪ CHỐI origin ngoài danh sách (cưỡng chế thật, không chỉ thiếu header)", async () => {
    new ValkeyIoAdapter(APP).createIOServer(0);
    await expect(ask("http://evil.test")).resolves.toEqual(["origin_not_allowed", false]);
  });

  it("allowRequest CHO PHÉP request không có Origin (client Node/mobile)", async () => {
    new ValkeyIoAdapter(APP).createIOServer(0);
    await expect(ask(undefined)).resolves.toEqual([undefined, true]);
  });
});
