import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ZodTypeAny } from "zod";
import { envSchema } from "../../src/config/env.schema";

/**
 * S16-SOCIAL-PERMMEMO-1 — S1 (plan §4.1/§4.4 X11, DECISIONS-15).
 *
 * Int-spec dựng app bằng `createNestApplication` KHÔNG chạy `main.ts` (plan M6) ⇒ gỡ
 * `app.use(grantMemoMiddleware)` khỏi `main.ts` làm memo biến mất ở PROD mà KHÔNG một int-spec nào
 * đỏ. Ca này là lưới duy nhất cho dây nối đó. Đọc MÃ (đã bỏ comment) chứ không đọc chuỗi thô: một
 * câu comment nhắc tên middleware không được tính là «đã đăng ký».
 */
const MAIN_TS = path.join(__dirname, "..", "..", "src", "main.ts");

function code(): string {
  return readFileSync(MAIN_TS, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("S1 — main.ts đăng ký grantMemoMiddleware (DECISIONS-15)", () => {
  it("app.use(grantMemoMiddleware) NGAY SAU requestIdMiddleware, dưới cờ env", () => {
    const src = code();
    const reqId = src.indexOf("app.use(requestIdMiddleware)");
    const memo = src.indexOf("app.use(grantMemoMiddleware)");
    expect(reqId, "main.ts phải còn app.use(requestIdMiddleware)").toBeGreaterThan(-1);
    expect(memo, "main.ts PHẢI đăng ký grantMemoMiddleware").toBeGreaterThan(-1);
    expect(memo, "grantMemoMiddleware PHẢI đứng SAU requestIdMiddleware").toBeGreaterThan(reqId);

    // Giữa hai lần đăng ký KHÔNG có app.use/route nào khác — «ngay sau» là chủ đích (plan D-1).
    const between = src.slice(reqId + "app.use(requestIdMiddleware)".length, memo);
    expect(between, "không app.use nào khác chen giữa").not.toMatch(/app\.use\(/);
    expect(between, "đăng ký PHẢI nằm dưới cờ PERMISSION_GRANT_MEMO_ENABLED").toMatch(
      /if\s*\(\s*env\.PERMISSION_GRANT_MEMO_ENABLED\s*===\s*"true"\s*\)\s*\{?\s*$/,
    );
  });

  it("cờ PERMISSION_GRANT_MEMO_ENABLED mặc định 'true', nhận đúng 'true'|'false'", () => {
    // `envSchema` là ZodEffects (superRefine) ⇒ đọc shape của object bên trong.
    const shape: Record<string, ZodTypeAny> = envSchema.innerType().shape;
    const flag = shape.PERMISSION_GRANT_MEMO_ENABLED;
    expect(flag, "env.schema PHẢI khai PERMISSION_GRANT_MEMO_ENABLED").toBeDefined();
    expect(flag.safeParse(undefined).data).toBe("true");
    expect(flag.safeParse("false").data).toBe("false");
    expect(flag.safeParse("1").success, "KHÔNG coerce boolean ('false'→true bẫy)").toBe(false);
  });
});
