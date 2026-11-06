/**
 * S19-OPS-ZOD4-1 (C3, plan §9.2-2) — ca BOOT theo đường `setupSwagger`.
 *
 * Vì sao: ở `main.ts`, `setupSwagger(app, NODE_ENV)` chạy `buildOpenApiDocument` NGAY LÚC BOOT khi NODE_ENV khác
 * production ⇒ `cleanupOpenApiDoc` (nestjs-zod 5) duyệt MỌI DTO. Một DTO không biểu diễn được thành JSON Schema
 * (vd `z.coerce.date()`, `z.object({})` làm `@Query`) làm boot dev-online/dev SẬP, trong khi PROD (production ⇒ không
 * mount) vẫn xanh — lỗi chỉ lộ ở môi trường dev. Ca này dựng AppModule THẬT, đi đúng đường main.ts, và khẳng định
 * không ném + tài liệu có paths + schema ngày của `coerceDate()` ra `string | number`.
 *
 * KHÔNG cần Postgres (chỉ quét metadata) ⇒ chạy trong suite mặc định.
 */
import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";
import { SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { applyMainPipeline } from "../helpers/bootstrap-app";
import { loadEnv } from "../../src/config/env.schema";
import { buildOpenApiDocument, setupSwagger } from "../../src/config/swagger";

const MIN_PATHS = 300;

describe("S19-OPS-ZOD4-1 — boot swagger với NODE_ENV khác production", () => {
  let app: INestApplication;
  // Dựng document MỘT lần rồi dùng lại (vá FULL gate §10.8): mỗi lần build duyệt mọi DTO, chặn worker nhiều giây —
  // gọi lặp làm tinypool đứt IPC (ERR_IPC_CHANNEL_CLOSED, KI-014) khi chạy cả thư mục.
  let doc: OpenAPIObject;

  beforeAll(async () => {
    const env = loadEnv();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = applyMainPipeline(moduleRef.createNestApplication());
    app.setGlobalPrefix(`${env.API_PREFIX}/${env.API_VERSION}`);
    doc = buildOpenApiDocument(app);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  for (const nodeEnv of ["development", "test", undefined]) {
    it(`setupSwagger(NODE_ENV=${String(nodeEnv)}) KHÔNG ném và mount tài liệu`, () => {
      let mounted: boolean | undefined;
      expect(() => {
        mounted = setupSwagger(app, nodeEnv);
      }).not.toThrow();
      expect(mounted).toBe(true);
    });
  }

  it("buildOpenApiDocument: có paths (chống tài liệu rỗng) và không còn $ref treo", () => {
    const paths = Object.keys(doc.paths ?? {});
    expect(paths.length, "tài liệu rỗng/hụt ⇒ boot xanh giả").toBeGreaterThan(MIN_PATHS);
    expect(paths.every((p) => p.startsWith("/api/v1/"))).toBe(true);
    const schemas = new Set(Object.keys(doc.components?.schemas ?? {}));
    const refs = [
      ...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
    ].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(100);
    expect(refs.filter((r) => !schemas.has(r))).toEqual([]);
  });

  it("đường mount runtime: SwaggerModule.setup chấp nhận document đã dựng", () => {
    expect(() => SwaggerModule.setup("docs-boot-check", app, doc)).not.toThrow();
  });

  it("tham số query ngày của coerceDate() có kiểu string/date-time (không mất kiểu như {items} trơ)", () => {
    const params = Object.values(doc.paths ?? {})
      .flatMap((item) => Object.values(item as Record<string, { parameters?: unknown[] }>))
      .flatMap((op) => op.parameters ?? []) as {
      name: string;
      in: string;
      schema?: { type?: string; format?: string };
    }[];
    const created = params.filter((p) => p.in === "query" && p.name === "created_from");
    expect(created.length, "không thấy tham số created_from ⇒ ca mù").toBeGreaterThan(0);
    for (const p of created)
      expect(p.schema).toMatchObject({ type: "string", format: "date-time" });
  });
});
