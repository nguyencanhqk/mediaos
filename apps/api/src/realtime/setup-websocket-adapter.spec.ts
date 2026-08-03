import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Env } from "../config/env.schema";
import { setupWebSocketAdapter } from "./setup-websocket-adapter";
import { ValkeyIoAdapter } from "./valkey-io.adapter";

/**
 * S7-CHAT-RT-0 — wiring adapter (điểm gốc của WO: class đúng nhưng KHÔNG AI GỌI).
 */

const envWith = (over: Partial<Env>): Env =>
  ({ NODE_ENV: "test", DATABASE_URL: "postgres://u:p@h:5432/mediaos_chatrt0", ...over }) as Env;

function fakeApp(): { useWebSocketAdapter: ReturnType<typeof vi.fn> } {
  return { useWebSocketAdapter: vi.fn() };
}

describe("setupWebSocketAdapter", () => {
  let connectSpy: MockInstance<ValkeyIoAdapter["connectToValkey"]>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    connectSpy = vi.spyOn(ValkeyIoAdapter.prototype, "connectToValkey").mockResolvedValue(true);
    errorSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.LANE_DB;
  });

  it("gọi ĐÚNG MỘT LẦN app.useWebSocketAdapter với instance ValkeyIoAdapter", async () => {
    const app = fakeApp();
    const adapter = await setupWebSocketAdapter(
      app as never,
      envWith({ VALKEY_URL: "redis://x:6379" }),
    );
    expect(app.useWebSocketAdapter).toHaveBeenCalledTimes(1);
    expect(app.useWebSocketAdapter).toHaveBeenCalledWith(adapter);
    expect(adapter).toBeInstanceOf(ValkeyIoAdapter);
  });

  it("có VALKEY_URL → connectToValkey nhận url + khoá kênh suy từ env (KHÔNG phải mặc định 'socket.io')", async () => {
    process.env.LANE_DB = "mediaos_chatrt0";
    await setupWebSocketAdapter(fakeApp() as never, envWith({ VALKEY_URL: "redis://x:6379" }));
    expect(connectSpy).toHaveBeenCalledWith("redis://x:6379", "socket.io:test:mediaos_chatrt0");
  });

  it("THIẾU VALKEY_URL → log ERROR, KHÔNG gọi connectToValkey, NHƯNG VẪN gắn adapter (app vẫn boot)", async () => {
    const app = fakeApp();
    await setupWebSocketAdapter(app as never, envWith({ VALKEY_URL: undefined }));
    expect(connectSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("BROADCAST ĐA INSTANCE TẮT");
    expect(app.useWebSocketAdapter).toHaveBeenCalledTimes(1);
  });

  it("Valkey kết nối HỎNG → VẪN gắn adapter (CORS/`allowRequest` sống ở đây, không được rơi theo Valkey)", async () => {
    connectSpy.mockResolvedValue(false as never);
    const app = fakeApp();
    await setupWebSocketAdapter(app as never, envWith({ VALKEY_URL: "redis://x:6379" }));
    expect(app.useWebSocketAdapter).toHaveBeenCalledTimes(1);
  });
});

/**
 * Thứ tự bootstrap trong `main.ts` — KHÔNG import được `main.ts` (nó có side-effect top-level
 * `void bootstrap()`, memory `script-with-toplevel-main-runs-on-import`) nên đọc SOURCE TEXT.
 * `useWebSocketAdapter` gọi SAU `app.listen()` là VÔ HIỆU (@nestjs/core nest-application.js:256-262).
 */
describe("main.ts — thứ tự bootstrap", () => {
  /**
   * Bỏ comment TRƯỚC khi so vị trí: chính comment giải thích thứ tự cũng chứa chuỗi `app.listen()`,
   * và một assert quét thô sẽ đo nhầm vị trí văn xuôi thay vì lời gọi thật (memory
   * `guard-immutability-matches-comments`).
   */
  const source = readFileSync(join(__dirname, "..", "main.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("gọi setupWebSocketAdapter TRƯỚC app.listen(", () => {
    const setupAt = source.indexOf("setupWebSocketAdapter(app");
    const listenAt = source.indexOf("app.listen(");
    expect(setupAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(-1);
    expect(setupAt).toBeLessThan(listenAt);
  });

  it("lời gọi được AWAIT (adapter gắn xong trước khi bootstrap đi tiếp)", () => {
    expect(source).toMatch(/await\s+setupWebSocketAdapter\(app/);
  });

  it("regression: app.enableCors( (CORS đường HTTP) vẫn còn — không xoá nhầm khi thêm CORS cho WS", () => {
    expect(source).toContain("app.enableCors(");
  });
});
