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

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);

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
