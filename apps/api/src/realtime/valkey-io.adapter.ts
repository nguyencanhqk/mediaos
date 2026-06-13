import { Logger, type INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server, ServerOptions } from "socket.io";
import { loadEnv } from "../config/env.schema";

/**
 * ValkeyIoAdapter — IoAdapter có gắn Valkey pub/sub để Socket.IO chạy ĐA INSTANCE (room `co:{companyId}:…`
 * broadcast xuyên tiến trình). Cùng triết lý ValkeyService: VALKEY_URL vắng / kết nối lỗi → FAIL-SOFT về
 * adapter in-memory (single instance dev), log WARN — KHÔNG chặn boot.
 *
 * ioredis của adapter là client RIÊNG (pub/sub dedicated) — KHÔNG đụng directPool/pool DB (ADR-0003).
 *
 * ⚠️ prod multi-instance BẮT BUỘC có VALKEY_URL (in-memory không broadcast chéo instance — ghi handoff).
 */
export class ValkeyIoAdapter extends IoAdapter {
  private readonly logger = new Logger(ValkeyIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  /**
   * Thử kết nối Valkey. Trả về true nếu gắn được redis-adapter, false nếu fail-soft in-memory.
   * KHÔNG throw — lỗi kết nối log WARN rồi tiếp tục (FE còn poll REST fallback nếu realtime hỏng).
   */
  async connectToValkey(url: string): Promise<boolean> {
    try {
      const pubClient = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });
      const subClient = pubClient.duplicate();
      // lazyConnect → connect tường minh để bắt lỗi NGAY (không để treo tới lần publish đầu).
      await Promise.all([pubClient.connect(), subClient.connect()]);
      pubClient.on("error", (err: Error) =>
        this.logger.warn("Valkey pub client error", { message: err.message }),
      );
      subClient.on("error", (err: Error) =>
        this.logger.warn("Valkey sub client error", { message: err.message }),
      );
      this.clients = [pubClient, subClient];
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log("Socket.IO Valkey adapter connected (multi-instance broadcast enabled)");
      return true;
    } catch (err) {
      this.logger.warn(
        "Valkey adapter connect failed — fallback in-memory (single instance only)",
        { error: err instanceof Error ? err.message : String(err) },
      );
      this.adapterConstructor = null;
      return false;
    }
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const env = loadEnv();
    const cors = {
      origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
      credentials: true,
    };
    const server = super.createIOServer(port, { ...options, cors }) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }

  /** Đóng client Valkey khi app shutdown (gọi từ main.ts nếu cần). Tên KHÔNG trùng base `close(server)`. */
  async disconnectValkey(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => undefined)));
    this.clients = [];
  }
}
