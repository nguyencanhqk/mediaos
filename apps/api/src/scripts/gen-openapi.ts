import "reflect-metadata";
// PHẢI nạp .env trước mọi import kéo theo db/index.ts (qua AppModule) — xem main.ts / load-env.ts.
import "../config/load-env";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { buildOpenApiDocument } from "../config/swagger";

/**
 * S2-FND-CONTRACT-1 — sinh openapi.json (artifact, KHÔNG commit — xem .gitignore).
 *
 * Dùng `buildOpenApiDocument` (patchNestJsSwagger + createDocument) như đường mount runtime để artifact
 * KHỚP đúng document phục vụ /docs-json. Chạy: `pnpm --filter @mediaos/api gen:openapi`.
 * KHÔNG env-gate ở đây (đây là công cụ dev sinh tài liệu, KHÔNG phải endpoint mạng).
 *
 * LƯU Ý runner: script phải chạy qua BUILD (nest build → tsc) rồi `node dist/...` — KHÔNG chạy tsx trực
 * tiếp: esbuild của tsx KHÔNG emit `emitDecoratorMetadata` nên Nest DI của AppModule (guard/service) hỏng.
 * package.json `gen:openapi` = `nest build && node dist/scripts/gen-openapi.js` (tsc emit metadata đầy đủ).
 */
async function main(): Promise<void> {
  const logger = new Logger("gen-openapi");
  const app = await NestFactory.create(AppModule, { logger: false });
  try {
    const document = buildOpenApiDocument(app);
    const outPath = resolve(process.cwd(), "openapi.json");
    writeFileSync(outPath, JSON.stringify(document, null, 2), "utf8");
    logger.log(`OpenAPI document → ${outPath}`);
  } finally {
    await app.close();
  }
}

void main();
