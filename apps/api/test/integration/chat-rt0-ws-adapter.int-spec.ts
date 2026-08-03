/**
 * S7-CHAT-RT-0 — `ValkeyIoAdapter` gắn THẬT vào đường bootstrap production.
 *
 * Vì sao phải là int-spec chứ không chỉ unit: gốc rễ của WO là *"class đúng nhưng KHÔNG AI GỌI, và
 * không test nào phát hiện được vì không test nào chạm đường thật"*. Bộ này boot `AppModule` thật, gọi
 * CHÍNH `setupWebSocketAdapter` mà `main.ts` gọi, `app.listen(0)` mở cổng TCP thật, rồi nối bằng
 * `socket.io-client` thật qua network — cross-origin THẬT (origin khác host:port của server test).
 *
 * ⚠️ GIỚI HẠN ĐÃ BIẾT: client Node KHÔNG thực thi Same-Origin Policy. Bộ này chứng minh **server cưỡng
 * chế allowlist** (qua `allowRequest` → engine.io FORBIDDEN) và **server phát đúng header CORS** — đó là
 * hai thứ trình duyệt cần. Nó KHÔNG thay được smoke bằng trình duyệt thật (done_when #4, bước NGƯỜI).
 *
 * GATE CỨNG `hasDb && LANE_DB` (AppModule cần DB để boot đủ provider).
 */

import "reflect-metadata";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { WS_NAMESPACE } from "@mediaos/contracts";
import { AppModule } from "../../src/app.module";
import { TokenService } from "../../src/auth/token.service";
import { loadEnv } from "../../src/config/env.schema";
import { RealtimeEmitterService } from "../../src/realtime/realtime-emitter.service";
import { setupWebSocketAdapter } from "../../src/realtime/setup-websocket-adapter";
import { hasDb } from "../helpers/integration-db";

const hasLaneDb = hasDb && !!process.env.LANE_DB;

const ALLOWED_ORIGIN = "http://localhost:5273";
const OTHER_ALLOWED_ORIGIN = "http://web.localhost:5273";
const DENIED_ORIGIN = "http://evil.test";

const USER_ID = "e1e1e1e1-1111-4111-8111-111111111111";
const COMPANY_ID = "c1c1c1c1-1111-4111-8111-111111111111";

type Transports = ("polling" | "websocket")[];

/**
 * Đường HTTP của engine.io = `path` mặc định `/socket.io`, KHÔNG phải namespace: `/ws` được thương lượng
 * Ở TẦNG GIAO THỨC sau handshake nên không xuất hiện trong URL. Dùng cho 2 ca dò header thô bằng `fetch`.
 */
const ENGINE_IO_PATH = "/socket.io/";

describe.skipIf(!hasLaneDb)("S7-CHAT-RT-0 — WS adapter gắn thật (CORS + bootstrap)", () => {
  let app: INestApplication;
  let port: number;
  let token: string;
  const openClients: ClientSocket[] = [];

  beforeAll(async () => {
    // Allowlist tất định cho bộ test — `createIOServer` đọc `loadEnv()` lúc `listen`, nên set TRƯỚC.
    process.env.CORS_ORIGIN = `${ALLOWED_ORIGIN},${OTHER_ALLOWED_ORIGIN}`;
    process.env.REALTIME_ENABLED = "true";

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();

    // ĐÚNG lời gọi mà main.ts dùng — không mirror bằng tay.
    await setupWebSocketAdapter(app as never, loadEnv());
    await app.listen(0);

    port = (app.getHttpServer().address() as AddressInfo).port;
    token = app.get(TokenService).signAccessToken({
      sub: USER_ID,
      companyId: COMPANY_ID,
      email: "rt0@demo.local",
    });
  }, 60_000);

  afterEach(() => {
    while (openClients.length) openClients.pop()?.disconnect();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** Nối tới `/ws` với header Origin cụ thể. Resolve khi `connect`, reject khi `connect_error`. */
  function connect(origin: string | undefined, transports: Transports): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}/${WS_NAMESPACE}`, {
        auth: { token },
        transports,
        reconnection: false,
        forceNew: true,
        ...(origin ? { extraHeaders: { Origin: origin } } : {}),
      });
      openClients.push(client);
      client.on("connect", () => resolve(client));
      client.on("connect_error", (err) => reject(err));
    });
  }

  // ─── CORS: cưỡng chế THẬT ở handshake, cả hai transport ────────────────────────────
  // Vì sao phải chạy cả 2: `socket.io-client` mặc định thử `polling` TRƯỚC rồi mới upgrade. RT-0 KHÔNG
  // chốt thay FE-1 việc bỏ polling — server phải đúng với mọi lựa chọn transport của FE.
  for (const transports of [["polling", "websocket"], ["websocket"]] as Transports[]) {
    const label = transports.join("+");

    it(`[${label}] origin TRONG allowlist → connect THÀNH CÔNG (cross-origin thật)`, async () => {
      const client = await connect(ALLOWED_ORIGIN, transports);
      expect(client.connected).toBe(true);
    });

    it(`[${label}] origin NGOÀI allowlist → BỊ TỪ CHỐI ngay ở handshake`, async () => {
      await expect(connect(DENIED_ORIGIN, transports)).rejects.toThrow();
    });
  }

  it("origin thứ HAI trong danh sách phân tách bởi dấu phẩy cũng được chấp nhận (trim đúng)", async () => {
    const client = await connect(OTHER_ALLOWED_ORIGIN, ["websocket"]);
    expect(client.connected).toBe(true);
  });

  it("từ chối vì ORIGIN phân biệt được với từ chối vì THIẾU TOKEN (không nhầm hai biên)", async () => {
    // Biên CORS → FORBIDDEN từ engine.io; biên auth → middleware gateway trả 'unauthorized'.
    const corsErr = await connect(DENIED_ORIGIN, ["websocket"]).catch((e: Error) => e);
    expect(String((corsErr as Error).message)).not.toMatch(/unauthorized/);

    const authErr = await new Promise<Error>((resolve) => {
      const c = ioClient(`http://127.0.0.1:${port}/${WS_NAMESPACE}`, {
        auth: {},
        transports: ["websocket"],
        reconnection: false,
        forceNew: true,
        extraHeaders: { Origin: ALLOWED_ORIGIN },
      });
      openClients.push(c);
      c.on("connect_error", (err) => resolve(err as Error));
    });
    expect(String(authErr.message)).toMatch(/unauthorized/);
  });

  it("client KHÔNG gửi Origin (không phải trình duyệt) vẫn nối được — CORS không phải cổng xác thực", async () => {
    const client = await connect(undefined, ["websocket"]);
    expect(client.connected).toBe(true);
  });

  // ─── Header CORS cho trình duyệt ───────────────────────────────────────────────────
  it("handshake polling từ origin hợp lệ trả về Access-Control-Allow-Origin ĐÚNG origin đó", async () => {
    const res = await fetch(`http://127.0.0.1:${port}${ENGINE_IO_PATH}?EIO=4&transport=polling`, {
      headers: { Origin: ALLOWED_ORIGIN },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("origin lạ: KHÔNG có header ACAO *và* bị chặn (403) — không chỉ thiếu header", async () => {
    const res = await fetch(`http://127.0.0.1:${port}${ENGINE_IO_PATH}?EIO=4&transport=polling`, {
      headers: { Origin: DENIED_ORIGIN },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.status).toBe(403);
  });

  // ─── Regression: gắn adapter KHÔNG phá đường NOTI đang sống ─────────────────────────
  it("emitNotification vẫn tới đúng user-room sau khi adapter được gắn", async () => {
    const client = await connect(ALLOWED_ORIGIN, ["websocket"]);
    const received = new Promise<Record<string, unknown>>((resolve) =>
      client.on("notification:new", (p: Record<string, unknown>) => resolve(p)),
    );

    const notification = {
      id: "aaaaaaaa-0000-4000-8000-000000000001",
      companyId: COMPANY_ID,
      userId: USER_ID,
      type: "general" as const,
      refId: "aaaaaaaa-0000-4000-8000-000000000002",
      refType: "system",
      body: "rt0 regression",
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    // Chờ socket join xong user-room (handleConnection chạy bất đồng bộ với `connect` phía client).
    await new Promise((r) => setTimeout(r, 150));
    app.get(RealtimeEmitterService).emitNotification(COMPANY_ID, USER_ID, notification as never);

    await expect(received).resolves.toMatchObject({ id: notification.id, body: "rt0 regression" });
  });
});
