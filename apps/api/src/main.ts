import "reflect-metadata";
// PHẢI đứng trước MỌI import kéo theo `db/index.ts` (qua AppModule) — nạp .env vào process.env
// trước khi pool DB đọc env ở top-level. Xem giải thích chi tiết trong load-env.ts.
import "./config/load-env";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ZodValidationPipe } from "nestjs-zod";
import { AppModule } from "./app.module";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { JsonConsoleLogger } from "./common/logger/json-console-logger";
import { requestIdMiddleware } from "./common/middleware/request-id.middleware";
import { loadEnv } from "./config/env.schema";
import { SWAGGER_PATH, setupSwagger } from "./config/swagger";
import { parseTrustProxy } from "./config/trust-proxy";
import { setupWebSocketAdapter } from "./realtime/setup-websocket-adapter";

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  // S10-FND-JSONLOG-1 (KI-009): `logger` ở đây override `Logger.staticInstanceRef` TOÀN CỤC (Nest
  // gọi `Logger.overrideLogger` bên trong `NestFactory.create`) — mọi `new Logger(context)` rải khắp
  // service/repository tự động in JSON có cấu trúc + redaction, KHÔNG cần sửa từng file gọi log.
  const app = await NestFactory.create(AppModule, { logger: new JsonConsoleLogger() });

  // SỚM NHẤT: gán req.requestId (Express middleware chạy trước routing/guard) để interceptor + filter
  // luôn có request_id cho meta — kể cả request bị guard từ chối sớm. KHÔNG dùng class middleware qua app.use.
  app.use(requestIdMiddleware);

  // CS-9: thiết lập biên tin cậy cho `req.ip` — giá trị này quyết định NỘI DUNG `login_logs.ip_address`,
  // khoá bucket rate-limit per-IP, và vế so sánh của IP-allowlist. Mặc định "false" ⇒ KHÔNG tin
  // X-Forwarded-For (req.ip = socket peer, chống spoof ở dev/no-proxy). Sau proxy, ops PHẢI đặt giá trị
  // khớp topology THẬT — S10-AUTH-IPTRUST-1: PROD (cloudflared cùng máy) dùng "loopback", chọn dựa trên
  // số đo header chứ không suy từ tài liệu. Lý do đầy đủ + điều kiện an toàn: config/trust-proxy.ts.
  app.getHttpAdapter().getInstance().set("trust proxy", parseTrustProxy(env.TRUST_PROXY));

  app.setGlobalPrefix(`${env.API_PREFIX}/${env.API_VERSION}`);
  app.enableCors({
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  });

  // S7-CHAT-RT-0: `enableCors` ở trên CHỈ áp cho HTTP — engine.io/Socket.IO không đọc nó. Biên cross-origin
  // của namespace `/ws` (và adapter Valkey cho broadcast đa instance) sống trong ValkeyIoAdapter. PHẢI gọi
  // TRƯỚC `app.listen()` — gắn sau khi gateway đã khởi tạo là vô hiệu (xem setup-websocket-adapter.ts).
  await setupWebSocketAdapter(app, env);

  // Zod = nguồn sự thật cho validate input (nestjs-zod). Envelope + filter chuẩn hoá output.
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // S2-FND-CONTRACT-1: OpenAPI /docs — env-gate, CHỈ mount ngoài production (dev/staging/test). Mount
  // TRƯỚC listen; đường /docs nằm NGOÀI global prefix. Production KHÔNG mount ⇒ GET /docs → 404.
  const swaggerMounted = setupSwagger(app, env.NODE_ENV);

  await app.listen(env.API_PORT);
  const logger = new Logger("Bootstrap");
  logger.log(`MediaOS API → http://localhost:${env.API_PORT}/${env.API_PREFIX}/${env.API_VERSION}`);
  if (swaggerMounted) {
    logger.log(`OpenAPI docs → http://localhost:${env.API_PORT}/${SWAGGER_PATH}`);
  }
}

void bootstrap();
