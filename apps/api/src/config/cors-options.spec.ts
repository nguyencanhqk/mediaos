import { Controller, Get, Header, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { buildCorsOptions } from "./cors-options";

/**
 * S1-FND-CORS-EXPOSE-1 — `buildCorsOptions` là ĐÚNG đối số `main.ts` truyền vào `app.enableCors`.
 *
 * Hai lớp ca:
 *  1. Giá trị trả về: `exposedHeaders` có `Content-Disposition`; `origin`/`credentials` GIỮ nguyên
 *     ngữ nghĩa cũ (danh sách cố định tách dấu phẩy + trim, credentials bật) — WO cấm nới.
 *  2. Trên dây (app tối giản, không DB): trình duyệt chỉ cho JS đọc header liệt kê trong
 *     `Access-Control-Expose-Headers` ⇒ đo header đó thật, không chỉ so object. Ca trên route xuất tệp
 *     THẬT của AppModule nằm ở `test/integration/cors-expose-headers.int-spec.ts` (cần lane DB).
 */

const ALLOWED = "http://app.cors.test";
const OTHER_ALLOWED = "http://console.cors.test";
const FOREIGN = "http://evil.cors.test";
const RAW_ORIGINS = ` ${ALLOWED} ,${OTHER_ALLOWED}`;

@Controller()
class FileEchoController {
  @Get("file")
  @Header("Content-Type", "text/csv; charset=utf-8")
  @Header("Content-Disposition", 'attachment; filename="bao-cao.csv"')
  file(): string {
    return "a,b\n1,2\n";
  }
}

let app: INestApplication | undefined;

/** App tối giản với ĐÚNG dòng `enableCors` của `main.ts`. */
async function boot(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ controllers: [FileEchoController] }).compile();
  const created = mod.createNestApplication();
  created.enableCors(buildCorsOptions(RAW_ORIGINS));
  await created.init();
  app = created;
  return created;
}

function exposedList(header: string | undefined): string[] {
  return (header ?? "").split(",").map((h) => h.trim().toLowerCase());
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("buildCorsOptions — giá trị", () => {
  it("exposedHeaders chứa Content-Disposition", () => {
    const opts = buildCorsOptions(RAW_ORIGINS);
    expect(opts.exposedHeaders).toEqual(expect.arrayContaining(["Content-Disposition"]));
  });

  it("origin = danh sách cố định (tách dấu phẩy + trim) và credentials = true — KHÔNG nới", () => {
    const opts = buildCorsOptions(RAW_ORIGINS);
    expect(opts.origin).toEqual([ALLOWED, OTHER_ALLOWED]);
    expect(opts.credentials).toBe(true);
  });
});

describe("buildCorsOptions — trên dây", () => {
  it("Origin thuộc danh sách ⇒ Access-Control-Expose-Headers có Content-Disposition", async () => {
    const a = await boot();
    const res = await request(a.getHttpServer()).get("/file").set("Origin", OTHER_ALLOWED);
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("bao-cao.csv");
    expect(res.headers["access-control-allow-origin"]).toBe(OTHER_ALLOWED);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(exposedList(res.headers["access-control-expose-headers"])).toContain(
      "content-disposition",
    );
  });

  it("Origin NGOÀI danh sách ⇒ không có Access-Control-Allow-Origin (origin không bị nới)", async () => {
    const a = await boot();
    const res = await request(a.getHttpServer()).get("/file").set("Origin", FOREIGN);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
