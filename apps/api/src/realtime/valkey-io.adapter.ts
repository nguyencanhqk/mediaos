import type { IncomingMessage } from "node:http";
import { Logger, type INestApplicationContext } from "@nestjs/common";
import { IoAdapter } from "@nestjs/platform-socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import type { Server, ServerOptions } from "socket.io";
import { loadEnv } from "../config/env.schema";
import { isOriginAllowed, parseCorsOrigins } from "./ws-adapter-config";

/**
 * ValkeyIoAdapter — IoAdapter có gắn Valkey pub/sub để Socket.IO chạy ĐA INSTANCE (room `co:{companyId}:…`
 * broadcast xuyên tiến trình), VÀ là nơi DUY NHẤT cấu hình biên cross-origin cho namespace `/ws`
 * (`app.enableCors()` ở main.ts chỉ áp cho HTTP, KHÔNG chạm engine.io).
 *
 * ioredis của adapter là client RIÊNG (pub/sub dedicated) — KHÔNG đụng directPool/pool DB (ADR-0003).
 *
 * S7-CHAT-RT-0 đổi 3 điểm so với bản gốc:
 *  1. FAIL-LOUD thay fail-soft ÂM THẦM: `logger.error` (không phải `warn`) + trạng thái đọc được qua
 *     `isMultiInstanceReady()`. Ở chế độ in-memory mọi ràng buộc join/leave chỉ đúng trên 1 instance —
 *     im lặng nghĩa là tin nhắn có thể tới người vừa bị gỡ khỏi phòng ở instance khác.
 *  2. `createAdapter` LUÔN nhận `opts.key` (xem `resolveValkeyChannelKey`) — 4 môi trường dùng chung một
 *     Valkey, không tiền tố là nối tiến trình test vào cụm PROD.
 *  3. `allowRequest` cưỡng chế allowlist origin THẬT ở handshake — option `cors` một mình KHÔNG từ chối
 *     ai cả (lý do đầy đủ ở `ws-adapter-config.ts#isOriginAllowed`).
 *
 * ⚠️ prod multi-instance BẮT BUỘC có VALKEY_URL (in-memory không broadcast chéo instance).
 */
export class ValkeyIoAdapter extends IoAdapter {
  private readonly logger = new Logger(ValkeyIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private clients: Redis[] = [];

  constructor(app: INestApplicationContext) {
    super(app);
  }

  /**
   * Thử kết nối Valkey. Trả về true nếu gắn được redis-adapter, false nếu rơi về in-memory.
   * KHÔNG throw: CORS (bản vá chính của WO) độc lập hoàn toàn với Valkey, và chặn boot vì một phụ thuộc
   * phụ trợ sẽ kéo 100% API (auth/HR/chấm công…) xuống theo — thiệt hại vượt xa lỗ đang vá.
   * Nhưng thất bại được log ở mức ERROR và ghi vào trạng thái, KHÔNG nuốt im lặng.
   *
   * @param channelKey tiền tố kênh pub/sub — BẮT BUỘC, xem `resolveValkeyChannelKey`.
   */
  async connectToValkey(url: string, channelKey: string): Promise<boolean> {
    let pubClient: Redis | undefined;
    let subClient: Redis | undefined;
    try {
      pubClient = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
      });
      subClient = pubClient.duplicate();
      // Gắn listener 'error' TRƯỚC connect: ioredis phát 'error' ngay khi kết nối hỏng, và một
      // EventEmitter không có listener 'error' làm CRASH tiến trình (unhandled 'error' event).
      // Bản gốc gắn SAU `await connect()` ⇒ đúng nhánh hỏng lại là nhánh không có listener.
      pubClient.on("error", (err: Error) =>
        this.logger.warn("Valkey pub client error", { message: err.message }),
      );
      subClient.on("error", (err: Error) =>
        this.logger.warn("Valkey sub client error", { message: err.message }),
      );
      // lazyConnect → connect tường minh để bắt lỗi NGAY (không để treo tới lần publish đầu).
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.clients = [pubClient, subClient];
      this.adapterConstructor = createAdapter(pubClient, subClient, { key: channelKey });
      this.logger.log(
        `Socket.IO Valkey adapter connected (multi-instance broadcast enabled, channel="${channelKey}")`,
      );
      return true;
    } catch (err) {
      // Rò client: nếu pub connect XONG rồi sub connect HỎNG, bản gốc bỏ rơi pubClient đang mở —
      // nó tiếp tục retry nền suốt vòng đời tiến trình. Đóng cả hai, bất kể cái nào hỏng.
      await Promise.all([pubClient, subClient].map((c) => c?.quit().catch(() => c?.disconnect())));
      this.logger.error(
        "Valkey adapter connect failed — BROADCAST ĐA INSTANCE TẮT (in-memory, chỉ đúng trên 1 tiến trình)",
        {
          error: err instanceof Error ? err.message : String(err),
        },
      );
      this.adapterConstructor = null;
      this.clients = [];
      return false;
    }
  }

  /**
   * Adapter Valkey đã gắn được chưa. `false` ⇒ join/leave và mọi broadcast CHỈ đúng trong tiến trình này.
   *
   * ⚠️ Đây là ẢNH CHỤP LÚC BOOT, không phải health-check trực tiếp: nếu Valkey chết SAU khi boot thành
   * công, hàm vẫn trả `true` (ioredis tự retry nền, các lỗi phát ra qua listener 'error' ở trên). Dùng để
   * quan sát cấu hình lúc khởi động, KHÔNG dùng làm tín hiệu liveness.
   */
  isMultiInstanceReady(): boolean {
    return this.adapterConstructor !== null;
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const env = loadEnv();
    const allowlist = parseCorsOrigins(env.CORS_ORIGIN);
    const server = super.createIOServer(port, {
      ...options,
      // `cors` = để TRÌNH DUYỆT nhận đúng Access-Control-Allow-Origin ở đường hợp lệ.
      cors: { origin: allowlist, credentials: true },
      // `allowRequest` = cưỡng chế THẬT (engine.io trả FORBIDDEN). Không có nó, origin ngoài allowlist
      // vẫn bắt tay thành công ở tầng server — xem ws-adapter-config.ts#isOriginAllowed.
      allowRequest: (
        req: IncomingMessage,
        callback: (err: string | undefined, success: boolean) => void,
      ) => {
        const origin = req.headers.origin;
        if (isOriginAllowed(origin, allowlist)) return callback(undefined, true);
        this.logger.warn(`WS handshake bị từ chối — origin ngoài CORS_ORIGIN: ${String(origin)}`);
        callback("origin_not_allowed", false);
      },
    }) as Server;
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
