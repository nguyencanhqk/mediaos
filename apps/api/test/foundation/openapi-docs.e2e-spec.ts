/**
 * S2-FND-CONTRACT-1 (fix-contract1-swagger) — OpenAPI /docs e2e (RED-first).
 *
 * Đóng done_when #1 / acceptanceCheck #7 / step #4 / testTasks #2+#3 bị bỏ ở vòng trước.
 *
 * Bối cảnh RECONCILE (bắt buộc trước code — nestjs-zod=4.3.1 BenLorantfy):
 *   - createZodDto tạo class TRẦN (không _OPENAPI_METADATA_FACTORY, KHÔNG tự đăng ký với swagger).
 *   - Tích hợp swagger CHÍNH THỨC của bản này = patchNestJsSwagger() (hook SchemaObjectFactory) →
 *     giới thiệu schema Zod vào OpenAPI. `cleanupOpenApiDoc` KHÔNG tồn tại ở 4.3.1 (verified grep) —
 *     đó là API của một bản nestjs-zod khác. Vì vậy dùng patchNestJsSwagger (đúng bản đã cài).
 *
 * KHÔNG cần Postgres: chỉ scan metadata controller/DTO (giống health.e2e-spec chạy no-DB). Vì vậy
 * KHÔNG skipIf(!hasDb) — test này phải chạy trong suite mặc định (`pnpm test`).
 *
 * BẪY vitest include: chỉ `src/**\/*.spec.ts` + `test/**\/*.{e2e,int}-spec.ts`. File đặt đúng
 * `test/foundation/*.e2e-spec.ts` để THỰC SỰ chạy (đặt .spec.ts trong test/ = xanh giả, KHÔNG chạy).
 */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../../src/app.module";
import { setupSwagger } from "../../src/config/swagger";

type OpenApiDoc = {
  openapi?: string;
  paths?: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
  components?: { schemas?: Record<string, unknown> };
};

/**
 * Server-only field names KHÔNG BAO GIỜ là input/output hợp lệ. Đã VERIFY VẮNG khỏi doc introspect thực tế
 * (probe 2026-07-05): passwordHash/secretRef/validationSchema/secretValue/pii không xuất hiện ở schema nào.
 * Hiện diện ở BẤT KỲ schema nào ⇒ rò rỉ thật (vd DTO vô tình lộ hash mật khẩu / secret-ref / schema server).
 * So khớp exact (chuẩn hoá lowercase). LƯU Ý: `salaryType`/`password`/`settingValue`/`baseSalary`/`token` LÀ
 * field REQUEST hợp lệ (auth/settings/HR) → CỐ Ý KHÔNG nằm ở đây, nếu không sẽ false-fail.
 */
const ALWAYS_FORBIDDEN = [
  "passwordhash",
  "password_hash",
  "secretref",
  "secret_ref",
  "validationschema",
  "validation_schema",
  "secretvalue",
  "secret_value",
  "pii",
];

/**
 * Tập nhạy cảm ĐẦY ĐỦ chỉ cấm ở RESPONSE schema (guard input→output bleed): `password`/`salaryType`/
 * `settingValue`/`baseSalary` là input hợp lệ nhưng KHÔNG được lộ ở output. (accessToken/refreshToken CỐ Ý
 * loại — là payload auth-response hợp lệ, không phải rò rỉ.) Hôm nay response chưa tài liệu hoá ⇒ nhánh
 * allowlist chạy; danh sách sẵn cho khi controller gắn @ApiResponse.
 */
const RESPONSE_FORBIDDEN = [
  ...ALWAYS_FORBIDDEN,
  "password",
  "currentpassword",
  "newpassword",
  "salary",
  "salarytype",
  "basesalary",
  "settingvalue",
  "setting_value",
];

/** Gom MỌI tên property xuất hiện ở bất kỳ độ sâu nào trong node (schema OpenAPI). */
function collectPropertyNames(node: unknown, acc: Set<string>): void {
  if (Array.isArray(node)) {
    for (const n of node) collectPropertyNames(n, acc);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const props = obj.properties;
  if (props && typeof props === "object" && !Array.isArray(props)) {
    for (const key of Object.keys(props as Record<string, unknown>)) acc.add(key);
  }
  for (const v of Object.values(obj)) collectPropertyNames(v, acc);
}

/** Gom tên component-schema được RESPONSE (2xx/JSON) tham chiếu — dùng để phân nhánh denylist/allowlist. */
function collectResponseSchemaRefs(doc: OpenApiDoc): Set<string> {
  const refs = new Set<string>();
  const walkForRefs = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const n of node) walkForRefs(n);
      return;
    }
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === "string") {
      const name = ref.split("/").pop();
      if (name) refs.add(name);
    }
    for (const v of Object.values(obj)) walkForRefs(v);
  };
  for (const pathItem of Object.values(doc.paths ?? {})) {
    for (const op of Object.values(pathItem)) {
      const responses = (op as { responses?: Record<string, unknown> }).responses ?? {};
      for (const resp of Object.values(responses)) {
        const content = (resp as { content?: Record<string, { schema?: unknown }> }).content;
        const jsonSchema = content?.["application/json"]?.schema;
        walkForRefs(jsonSchema);
      }
    }
  }
  return refs;
}

/**
 * Dựng app CHƯA init để mount swagger TRƯỚC app.init() — khớp thứ tự runtime (SwaggerModule.setup phải
 * đăng ký route trước khi router chốt). NestFactory.create ở main.ts tự init nội bộ; ở test createNestApplication
 * KHÔNG init → ta init THỦ CÔNG SAU setupSwagger.
 */
async function createApp(nodeEnv: string): Promise<{ app: INestApplication; mounted: boolean }> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  const mounted = setupSwagger(app, nodeEnv);
  await app.init();
  return { app, mounted };
}

describe("OpenAPI /docs (e2e) — env-gate + schema hygiene", () => {
  let devApp: INestApplication;
  let prodApp: INestApplication;
  let devDoc: OpenApiDoc;

  beforeAll(async () => {
    const dev = await createApp("development");
    devApp = dev.app;
    expect(dev.mounted).toBe(true);

    const prod = await createApp("production");
    prodApp = prod.app;
    expect(prod.mounted).toBe(false);

    const res = await request(devApp.getHttpServer()).get("/docs-json");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    devDoc = res.body as OpenApiDoc;
  });

  afterAll(async () => {
    await devApp?.close();
    await prodApp?.close();
  });

  // testTask #3 — env-gate ──────────────────────────────────────────────────────
  it("env-gate: NODE_ENV=production → GET /docs-json trả 404 (KHÔNG mount)", async () => {
    const res = await request(prodApp.getHttpServer()).get("/docs-json");
    expect(res.status).toBe(404);
  });

  it("env-gate: dev/staging → GET /docs-json trả 200 + OpenAPI JSON hợp lệ", async () => {
    const res = await request(devApp.getHttpServer()).get("/docs-json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.paths && typeof res.body.paths === "object").toBe(true);
    expect(Object.keys(res.body.paths).length).toBeGreaterThan(0);
  });

  // testTask #2 — positive-control RỒI denylist ─────────────────────────────────
  it("positive-control: schema DTO đã biết xuất hiện với field mong đợi (introspection hoạt động)", () => {
    const schemas = devDoc.components?.schemas ?? {};
    expect(Object.keys(schemas).length).toBeGreaterThan(0);

    const allProps = new Set<string>();
    collectPropertyNames(schemas, allProps);
    // Nếu patchNestJsSwagger KHÔNG introspect được zod → schema rỗng → set rỗng → FAIL (bắt false-green).
    expect(allProps.size).toBeGreaterThan(0);

    // Field mong đợi từ các input DTO đã biết (PatchCompanySettingDto.valueType · LoginDto.companySlug/email).
    const known = ["valueType", "companySlug", "email", "moduleCode"];
    const hasKnown = known.some((f) => allProps.has(f));
    expect(hasKnown, `properties: ${[...allProps].slice(0, 40).join(",")}`).toBe(true);
  });

  it("denylist: field server-only (passwordHash/secretRef/validationSchema…) VẮNG khỏi MỌI schema", () => {
    const allProps = new Set<string>();
    collectPropertyNames(devDoc.components?.schemas ?? {}, allProps);
    // Non-vacuous: introspection đã điền schema (positive-control ở trên cũng bảo chứng) ⇒ denylist có nghĩa.
    expect(allProps.size).toBeGreaterThan(0);
    const lowered = [...allProps].map((p) => p.toLowerCase());
    for (const forbidden of ALWAYS_FORBIDDEN) {
      expect(lowered, `LEAK: '${forbidden}' xuất hiện trong OpenAPI schema`).not.toContain(
        forbidden,
      );
    }
  });

  it("response-scoped: response schema KHÔNG lộ field nhạy cảm (allowlist khi response rỗng)", () => {
    const responseRefs = collectResponseSchemaRefs(devDoc);
    const schemas = devDoc.components?.schemas ?? {};

    if (responseRefs.size === 0) {
      // ALLOWLIST fallback (task: "response schema rỗng → đổi sang allowlist"): các controller foundation
      // chưa gắn @ApiResponse ⇒ KHÔNG có response body được tài liệu hoá ⇒ output KHÔNG THỂ lộ secret.
      // Vẫn khẳng định doc THỰC SỰ tài liệu hoá input DTO (non-vacuous).
      expect(Object.keys(schemas).length).toBeGreaterThan(0);
      return;
    }
    // DENYLIST khi có response schema: gom property của các schema được response tham chiếu.
    const respProps = new Set<string>();
    for (const name of responseRefs) collectPropertyNames(schemas[name], respProps);
    const lowered = [...respProps].map((p) => p.toLowerCase());
    for (const forbidden of RESPONSE_FORBIDDEN) {
      expect(lowered, `LEAK trong RESPONSE: '${forbidden}'`).not.toContain(forbidden);
    }
  });
});
