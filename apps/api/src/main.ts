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
import { loadEnv } from "./config/env.schema";

/**
 * CS-9: diễn giải env TRUST_PROXY sang giá trị Express `trust proxy`.
 * "false"→false (tắt, req.ip=peer); chuỗi toàn số→số hop; còn lại→giữ nguyên (preset "loopback" / CIDR proxy).
 */
function parseTrustProxy(raw: string): boolean | number | string {
  const v = raw.trim();
  if (v === "" || v.toLowerCase() === "false") return false;
  if (v.toLowerCase() === "true") return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);

  // CS-9: thiết lập biên tin cậy cho `req.ip` (IP-allowlist của security policy đọc giá trị này).
  // Mặc định "false" ⇒ KHÔNG tin X-Forwarded-For (req.ip = socket peer, chống spoof ở dev/no-proxy).
  // Sau proxy/LB, ops đặt TRUST_PROXY = số hop tin cậy (vd "1") hoặc CIDR proxy. KHÔNG đoán topology ở đây.
  app.getHttpAdapter().getInstance().set("trust proxy", parseTrustProxy(env.TRUST_PROXY));

  app.setGlobalPrefix(`${env.API_PREFIX}/${env.API_VERSION}`);
  app.enableCors({
    origin: env.CORS_ORIGIN.split(",").map((o) => o.trim()),
    credentials: true,
  });

  // Zod = nguồn sự thật cho validate input (nestjs-zod). Envelope + filter chuẩn hoá output.
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.listen(env.API_PORT);
  new Logger("Bootstrap").log(
    `MediaOS API → http://localhost:${env.API_PORT}/${env.API_PREFIX}/${env.API_VERSION}`,
  );
}

void bootstrap();
