import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { cleanupOpenApiDoc } from "nestjs-zod";
import { loadEnv } from "./env.schema";
import { API_DESCRIPTION, enrichOpenApiDocument } from "./openapi-enrich";
import { collectRouteAuthMeta } from "./openapi-route-meta";

/**
 * S2-FND-CONTRACT-1 — OpenAPI/Swagger setup (env-gated).
 *
 * S19-OPS-ZOD4-1 (C3a) — nestjs-zod 5.5 + zod 4: tích hợp swagger = `cleanupOpenApiDoc(document)` gọi SAU
 * `SwaggerModule.createDocument` (createZodDto tự gắn metadata `toJSONSchema`). `patchNestJsSwagger` KHÔNG còn
 * ⇒ bỏ luôn đoạn nạp SchemaObjectFactory theo đường tuyệt đối bằng createRequire (không còn cần).
 *
 * BẤT BIẾN #3: OpenAPI CHỈ tài liệu hoá shape input/output đã khai ở DTO — KHÔNG nội suy giá trị secret.
 * Deny-path test (openapi-docs.e2e-spec) khẳng định VẮNG field server-only trong schema.
 */

/** Đường mount tài liệu (NGOÀI global prefix `api/v1`): GET /docs (UI) · GET /docs-json (OpenAPI JSON). */
export const SWAGGER_PATH = "docs";

/**
 * Dựng OpenAPI document từ app đã compile. `cleanupOpenApiDoc` (nestjs-zod 5) hậu xử lý schema Zod.
 * Dùng chung cho mount runtime (setupSwagger) lẫn script sinh openapi.json (gen-openapi).
 *
 * S5-BE-CONTRACT-1 (WS-D §13) — thêm `enrichOpenApiDocument`: bơm security/permission-note/phản hồi
 * lỗi/tag theo module, suy từ chính metadata guard lúc chạy. Xem ghi chú đầu `openapi-enrich.ts`
 * (kèm baseline đo được).
 *
 * GLOBAL PREFIX: `createDocument` áp prefix của app (mặc định `ignoreGlobalPrefix:false`), nên document
 * CHỈ có `/api/v1/...` khi app ĐÃ `setGlobalPrefix` trước lúc dựng. main.ts làm đúng thứ tự đó; script
 * `gen-openapi` trước đây thì KHÔNG ⇒ artifact ghi `/auth/login` còn server phục vụ `/api/v1/auth/login`
 * (client sinh từ spec gọi sai đường). Đã vá ở gen-openapi.ts — xem ghi chú tại đó.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const env = loadEnv();
  const globalPrefix = `${env.API_PREFIX}/${env.API_VERSION}`;
  const config = new DocumentBuilder()
    .setTitle("MediaOS API")
    .setDescription(API_DESCRIPTION)
    .setVersion(env.API_VERSION)
    .addBearerAuth({ type: "http", scheme: "bearer", bearerFormat: "JWT" }, "bearer")
    .build();
  const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
  enrichOpenApiDocument(document, collectRouteAuthMeta(app), globalPrefix);
  return document;
}

/**
 * Env-gate mount: CHỈ mount khi NODE_ENV != 'production'. Production KHÔNG mount ⇒ GET /docs(-json) → 404.
 * Trả `true` nếu đã mount (dev/staging/test), `false` nếu bị chặn (production).
 */
export function setupSwagger(app: INestApplication, nodeEnv: string | undefined): boolean {
  if (nodeEnv === "production") return false;
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(SWAGGER_PATH, app, document);
  return true;
}
