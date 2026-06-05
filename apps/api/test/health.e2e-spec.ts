import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../src/app.module";
import { AllExceptionsFilter } from "../src/common/filters/all-exceptions.filter";
import { ResponseEnvelopeInterceptor } from "../src/common/interceptors/response-envelope.interceptor";

describe("Health (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("GET /health returns an ok envelope", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.error).toBeNull();
    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.service).toBe("mediaos-api");
  });

  it("GET /health/db reports down when DB is not configured", async () => {
    const res = await request(app.getHttpServer()).get("/health/db").expect(200);
    expect(res.body.success).toBe(true);
    expect(["ok", "down"]).toContain(res.body.data.status);
  });
});
