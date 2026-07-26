import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException, HttpException, HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LmsServiceIntakeGuard, type LmsServiceRequest } from "./lms-service-intake.guard";

/**
 * S5-LMS-NOTI-1 — deny-path đơn vị cho hàng rào DUY NHẤT của route máy (`@Public()` ⇒ không có guard nào
 * khác đứng trước). Mọi ca ở đây là "phải TỪ CHỐI"; ca cho phép đứng cuối cùng.
 *
 * Fixture giống-secret ghép chuỗi (CLAUDE.md §5) — literal high-entropy trip gitleaks generic-api-key.
 */
const TOKEN = ["lms", "noti", "token"].join("-").padEnd(40, "x");
const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function ctxWithAuth(header?: string): { ctx: ExecutionContext; req: LmsServiceRequest } {
  const req = {
    headers: header === undefined ? {} : { authorization: header },
  } as LmsServiceRequest;
  const ctx = {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { ctx, req };
}

describe("LmsServiceIntakeGuard", () => {
  let guard: LmsServiceIntakeGuard;

  beforeEach(() => {
    guard = new LmsServiceIntakeGuard();
    process.env.LMS_NOTI_TOKEN = TOKEN;
    process.env.LMS_COMPANY_ID = COMPANY_ID;
  });

  afterEach(() => {
    delete process.env.LMS_NOTI_TOKEN;
    delete process.env.LMS_COMPANY_ID;
  });

  it("từ chối 403 khi LMS_NOTI_TOKEN chưa cấu hình (fail-closed, KHÔNG fail-open)", () => {
    delete process.env.LMS_NOTI_TOKEN;
    const { ctx, req } = ctxWithAuth(`Bearer ${TOKEN}`);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(req.lmsService).toBeUndefined();
  });

  it("từ chối 403 khi LMS_COMPANY_ID chưa cấu hình — không có tenant thì không đoán", () => {
    delete process.env.LMS_COMPANY_ID;
    const { ctx, req } = ctxWithAuth(`Bearer ${TOKEN}`);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    expect(req.lmsService).toBeUndefined();
  });

  it("từ chối 403 khi thiếu header Authorization", () => {
    const { ctx } = ctxWithAuth(undefined);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("từ chối 403 khi scheme không phải Bearer", () => {
    const { ctx } = ctxWithAuth(`Basic ${TOKEN}`);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("từ chối 403 khi token sai NHƯNG cùng độ dài (nhánh so sánh nội dung)", () => {
    const wrong = "y".repeat(TOKEN.length);
    expect(wrong.length).toBe(TOKEN.length);
    const { ctx } = ctxWithAuth(`Bearer ${wrong}`);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("từ chối 403 khi token là TIỀN TỐ đúng nhưng khác độ dài — KHÔNG để timingSafeEqual ném ra ngoài", () => {
    const { ctx } = ctxWithAuth(`Bearer ${TOKEN.slice(0, 10)}`);
    // Nếu bỏ bước so độ dài, timingSafeEqual ném RangeError → 500 thay vì 403.
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("chấp nhận scheme bearer viết thường (RFC 7235 §2.1 — tên scheme không phân biệt hoa/thường)", () => {
    const { ctx, req } = ctxWithAuth(`bearer ${TOKEN}`);
    expect(guard.canActivate(ctx)).toBe(true);
    expect(req.lmsService).toEqual({ companyId: COMPANY_ID });
  });

  it("gắn companyId TỪ ENV chứ không phải từ request (BẤT BIẾN #1)", () => {
    const { ctx, req } = ctxWithAuth(`Bearer ${TOKEN}`);
    guard.canActivate(ctx);
    expect(req.lmsService?.companyId).toBe(COMPANY_ID);
    // Không có đường nào để client tác động: guard chỉ đọc header authorization.
    expect(Object.keys(req.headers)).toEqual(["authorization"]);
  });

  it("trả 429 khi vượt hạn mức cửa sổ, và token SAI không đốt được hạn mức của caller hợp lệ", () => {
    const wrong = "y".repeat(TOKEN.length);
    for (let i = 0; i < 200; i++) {
      expect(() => guard.canActivate(ctxWithAuth(`Bearer ${wrong}`).ctx)).toThrow(
        ForbiddenException,
      );
    }
    // 120 lần đầu của caller hợp lệ vẫn PASS (hạn mức chưa bị request sai token tiêu tốn).
    for (let i = 0; i < 120; i++) {
      expect(guard.canActivate(ctxWithAuth(`Bearer ${TOKEN}`).ctx)).toBe(true);
    }
    try {
      guard.canActivate(ctxWithAuth(`Bearer ${TOKEN}`).ctx);
      expect.unreachable("lần 121 phải bị chặn");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });
});
