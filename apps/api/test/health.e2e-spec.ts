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

  /**
   * S6-REL-1 · D1 — CHỐT HỢP ĐỒNG CANARY.
   *
   * `scripts/canary-watch.sh` phân biệt liveness/readiness bằng cách đọc `data.status` của /health.
   * Thêm `build` là additive; test này tồn tại để lần sau ai đó đổi hình dạng /health thì ĐỎ ở đây
   * chứ không đỏ ở giữa một lần deploy PROD.
   */
  it("GET /health giữ nguyên hợp đồng canary + kèm định danh build đủ 4 trường", async () => {
    const res = await request(app.getHttpServer()).get("/health").expect(200);

    expect(res.body.data.status).toBe("ok");
    expect(res.body.data.service).toBe("mediaos-api");
    expect(typeof res.body.data.time).toBe("string");

    // Chạy từ mã nguồn (chưa stamp) ⇒ 4 trường đều "unknown" — có mặt, không thiếu khoá.
    expect(Object.keys(res.body.data.build).sort()).toEqual([
      "builtAt",
      "commit",
      "migrationHead",
      "version",
    ]);
    for (const value of Object.values(res.body.data.build)) {
      expect(typeof value).toBe("string");
    }
  });

  it("GET /health/db reports down when DB is not configured", async () => {
    const res = await request(app.getHttpServer()).get("/health/db").expect(200);
    expect(res.body.success).toBe(true);
    expect(["ok", "down"]).toContain(res.body.data.status);
  });
});
