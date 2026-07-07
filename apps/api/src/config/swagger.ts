import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from "@nestjs/swagger";
import { patchNestJsSwagger } from "nestjs-zod";

/**
 * S2-FND-CONTRACT-1 — OpenAPI/Swagger setup (env-gated).
 *
 * RECONCILE (nestjs-zod=4.3.1, BenLorantfy · @nestjs/swagger=11.4.5):
 *   - Tích hợp swagger của bản nestjs-zod này = `patchNestJsSwagger()` (hook
 *     `SchemaObjectFactory.exploreModelSchema`) để introspect schema Zod của DTO tạo bởi createZodDto.
 *     `cleanupOpenApiDoc` KHÔNG tồn tại ở 4.3.1 (verified) và createZodDto tạo class TRẦN (KHÔNG auto-register)
 *     ⇒ patchNestJsSwagger là con đường ĐÚNG cho bản đã cài.
 *   - BẪY tương thích: patchNestJsSwagger() mặc định require('@nestjs/swagger/dist/services/schema-object-factory'),
 *     nhưng exports-map của @nestjs/swagger@11 CHẶN deep-subpath đó (ERR_PACKAGE_PATH_NOT_EXPORTED) và
 *     SchemaObjectFactory KHÔNG re-export ở top-level. Vì '@nestjs/swagger/package.json' LÀ export hợp lệ,
 *     ta tìm gốc gói qua nó rồi nạp file .js theo ĐƯỜNG TUYỆT ĐỐI (bypass exports) và TRUYỀN factory vào
 *     patchNestJsSwagger(factory). Cùng đường dẫn nội bộ mà nestjs-zod vốn dựa vào — KHÔNG thêm coupling mới.
 *
 * BẤT BIẾN #3: OpenAPI CHỈ tài liệu hoá shape input/output đã khai ở DTO — KHÔNG nội suy giá trị secret.
 * Deny-path test (openapi-docs.e2e-spec) khẳng định VẮNG field server-only trong schema.
 */

/** Đường mount tài liệu (NGOÀI global prefix `api/v1`): GET /docs (UI) · GET /docs-json (OpenAPI JSON). */
export const SWAGGER_PATH = "docs";

// __filename có sẵn ở CJS (nest build + vitest/SWC + tsx đều emit CJS theo tsconfig module=commonjs).
// Đặt tên KHÁC `require` để không kích hoạt @typescript-eslint/no-require-imports.
const loadCjs = createRequire(__filename);

type SchemaObjectFactoryType = NonNullable<Parameters<typeof patchNestJsSwagger>[0]>;

/** Nạp SchemaObjectFactory theo đường tuyệt đối (bypass exports-map chặn deep-subpath ở swagger v11). */
function resolveSchemaObjectFactory(): SchemaObjectFactoryType {
  const pkgJsonPath = loadCjs.resolve("@nestjs/swagger/package.json");
  const factoryPath = join(dirname(pkgJsonPath), "dist/services/schema-object-factory.js");
  const mod = loadCjs(factoryPath) as { SchemaObjectFactory: SchemaObjectFactoryType };
  return mod.SchemaObjectFactory;
}

/**
 * Dựng OpenAPI document từ app đã compile. Patch nestjs-zod TRƯỚC createDocument để schema Zod hiện đủ.
 * Dùng chung cho mount runtime (setupSwagger) lẫn script sinh openapi.json (gen-openapi).
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  patchNestJsSwagger(resolveSchemaObjectFactory());
  const config = new DocumentBuilder()
    .setTitle("MediaOS API")
    .setDescription("Hệ thống quản lý doanh nghiệp nội bộ — API nội bộ (chỉ dev/staging).")
    .setVersion("v1")
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
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
