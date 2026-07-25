import { HttpCode, HttpException } from "@nestjs/common";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IDEMPOTENCY_ERROR_CODES } from "@mediaos/contracts";
import { Observable, firstValueFrom, of, throwError } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IdempotencyStore } from "./idempotency-store.service";
import { Idempotent } from "./idempotency.decorator";
import { IdempotencyInterceptor } from "./idempotency.interceptor";

/**
 * S5-BE-CONTRACT-1 — hành vi interceptor. Dùng Reflector THẬT + decorator THẬT trên controller giả để
 * kiểm đúng đường metadata mà runtime đi (không mock reflector → không thể xanh-giả vì mock sai).
 */

class FakeController {
  @Idempotent()
  create(): void {}

  @Idempotent()
  @HttpCode(200)
  approve(): void {}

  /** KHÔNG @Idempotent — phải đi thẳng qua interceptor. */
  plain(): void {}
}

interface FakeReq {
  headers: Record<string, string>;
  method: string;
  originalUrl: string;
  body: unknown;
  user?: { id: string; companyId: string };
}

function makeContext(
  handler: (...args: unknown[]) => unknown,
  req: Partial<FakeReq>,
): { ctx: ExecutionContext; res: { status: ReturnType<typeof vi.fn>; setHeader: ReturnType<typeof vi.fn> } } {
  const request: FakeReq = {
    headers: {},
    method: "POST",
    originalUrl: "/api/v1/leave/requests",
    body: { note: "nghỉ" },
    user: { id: "u1", companyId: "c1" },
    ...req,
  };
  const res = { status: vi.fn(), setHeader: vi.fn() };
  const ctx = {
    getType: () => "http",
    getHandler: () => handler,
    getClass: () => FakeController,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => res }),
  } as unknown as ExecutionContext;
  return { ctx, res };
}

const nextOf = (value: unknown): CallHandler => ({ handle: () => of(value) });

describe("IdempotencyInterceptor", () => {
  let store: IdempotencyStore;
  let interceptor: IdempotencyInterceptor;
  const KEY = "11111111-2222-3333-4444-555555555555";

  beforeEach(() => {
    store = new IdempotencyStore();
    interceptor = new IdempotencyInterceptor(new Reflector(), store);
  });

  it("route KHÔNG @Idempotent → đi thẳng, KHÔNG đụng kho", async () => {
    const begin = vi.spyOn(store, "begin");
    const { ctx } = makeContext(FakeController.prototype.plain, {
      headers: { "idempotency-key": KEY },
    });
    await expect(firstValueFrom(interceptor.intercept(ctx, nextOf("ok")))).resolves.toBe("ok");
    expect(begin).not.toHaveBeenCalled();
  });

  it("có @Idempotent nhưng KHÔNG gửi header → chạy bình thường (BACK-COMPAT client cũ)", async () => {
    const begin = vi.spyOn(store, "begin");
    const { ctx } = makeContext(FakeController.prototype.create, { headers: {} });
    await expect(firstValueFrom(interceptor.intercept(ctx, nextOf("ok")))).resolves.toBe("ok");
    expect(begin).not.toHaveBeenCalled();
  });

  it("khoá vượt độ dài cho phép → 409 INVALID_KEY", async () => {
    const { ctx } = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": "x".repeat(201) },
    });
    await expect(firstValueFrom(interceptor.intercept(ctx, nextOf("ok")))).rejects.toMatchObject({
      response: { code: IDEMPOTENCY_ERROR_CODES.INVALID_KEY },
    });
  });

  it("request CHƯA xác thực → KHÔNG cache (không có phạm vi công ty/người dùng để khoá an toàn)", async () => {
    const begin = vi.spyOn(store, "begin");
    const { ctx } = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      user: undefined,
    });
    await expect(firstValueFrom(interceptor.intercept(ctx, nextOf("ok")))).resolves.toBe("ok");
    expect(begin).not.toHaveBeenCalled();
  });

  it("lần đầu chạy handler; lần hai PHÁT LẠI mà KHÔNG chạy handler", async () => {
    const handler = vi.fn(() => of({ id: "leave-1" }));
    const first = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
    });
    await firstValueFrom(interceptor.intercept(first.ctx, { handle: handler }));
    expect(handler).toHaveBeenCalledTimes(1);

    const second = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
    });
    const body = await firstValueFrom(interceptor.intercept(second.ctx, { handle: handler }));
    expect(handler).toHaveBeenCalledTimes(1); // KHÔNG gọi lại nghiệp vụ
    expect(body).toEqual({ id: "leave-1" });
    expect(second.res.setHeader).toHaveBeenCalledWith("Idempotency-Replayed", "true");
    expect(second.res.status).toHaveBeenCalledWith(201); // POST mặc định 201
  });

  it("phát lại giữ đúng status của @HttpCode(200)", async () => {
    const first = makeContext(FakeController.prototype.approve, {
      headers: { "idempotency-key": KEY },
      originalUrl: "/api/v1/leave/requests/1/approve",
    });
    await firstValueFrom(interceptor.intercept(first.ctx, nextOf({ ok: true })));
    const second = makeContext(FakeController.prototype.approve, {
      headers: { "idempotency-key": KEY },
      originalUrl: "/api/v1/leave/requests/1/approve",
    });
    await firstValueFrom(interceptor.intercept(second.ctx, nextOf({ ok: true })));
    expect(second.res.status).toHaveBeenCalledWith(200);
  });

  it("request trước còn ĐANG chạy → 409 IN_PROGRESS (bấm-đúp thật sự song song)", async () => {
    // Handler không bao giờ hoàn tất → mô phỏng request thứ nhất còn đang bay.
    const pending: CallHandler = { handle: () => new Observable<never>(() => undefined) };
    const a = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": "k-song-song" },
    });
    const b = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": "k-song-song" },
    });

    void firstValueFrom(interceptor.intercept(a.ctx, pending)).catch(() => undefined);
    // Nhường 1 vòng microtask để lời gọi thứ nhất kịp GIÀNH khoá (store.begin là async).
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(firstValueFrom(interceptor.intercept(b.ctx, nextOf("x")))).rejects.toMatchObject({
      response: { code: IDEMPOTENCY_ERROR_CODES.IN_PROGRESS },
    });
  });

  it("cùng khoá nhưng NỘI DUNG khác → 409 KEY_REUSED", async () => {
    const first = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      body: { note: "A" },
    });
    await firstValueFrom(interceptor.intercept(first.ctx, nextOf({ id: 1 })));

    const second = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      body: { note: "B" },
    });
    await expect(firstValueFrom(interceptor.intercept(second.ctx, nextOf({ id: 2 })))).rejects.toMatchObject(
      { response: { code: IDEMPOTENCY_ERROR_CODES.KEY_REUSED } },
    );
  });

  it("handler NÉM lỗi → nhả khoá + lỗi nguyên vẹn; retry cùng khoá vẫn chạy THẬT", async () => {
    const boom = new HttpException("hỏng", 500);
    const failing: CallHandler = { handle: () => throwError(() => boom) };
    const first = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
    });
    await expect(firstValueFrom(interceptor.intercept(first.ctx, failing))).rejects.toBe(boom);

    const handler = vi.fn(() => of({ id: "sau-khi-retry" }));
    const second = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
    });
    await expect(
      firstValueFrom(interceptor.intercept(second.ctx, { handle: handler })),
    ).resolves.toEqual({ id: "sau-khi-retry" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // ── BẤT BIẾN #1 — khoá phải gắn công ty + người gọi ─────────────────────────

  it("KHÔNG phát lại chéo NGƯỜI DÙNG dù trùng chuỗi khoá", async () => {
    const a = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      user: { id: "u1", companyId: "c1" },
    });
    await firstValueFrom(interceptor.intercept(a.ctx, nextOf({ owner: "u1" })));

    const handler = vi.fn(() => of({ owner: "u2" }));
    const b = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      user: { id: "u2", companyId: "c1" },
    });
    await expect(firstValueFrom(interceptor.intercept(b.ctx, { handle: handler }))).resolves.toEqual({
      owner: "u2",
    });
    expect(handler).toHaveBeenCalledTimes(1); // chạy THẬT, không nhận phản hồi của u1
  });

  it("KHÔNG phát lại chéo CÔNG TY dù trùng chuỗi khoá + trùng userId", async () => {
    const a = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      user: { id: "u1", companyId: "c1" },
    });
    await firstValueFrom(interceptor.intercept(a.ctx, nextOf({ tenant: "c1" })));

    const handler = vi.fn(() => of({ tenant: "c2" }));
    const b = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      user: { id: "u1", companyId: "c2" },
    });
    await expect(firstValueFrom(interceptor.intercept(b.ctx, { handle: handler }))).resolves.toEqual({
      tenant: "c2",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("KHÔNG phát lại chéo ENDPOINT dù trùng chuỗi khoá", async () => {
    const a = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      originalUrl: "/api/v1/leave/requests",
    });
    await firstValueFrom(interceptor.intercept(a.ctx, nextOf({ from: "leave" })));

    const handler = vi.fn(() => of({ from: "tasks" }));
    const b = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      originalUrl: "/api/v1/tasks",
    });
    await expect(firstValueFrom(interceptor.intercept(b.ctx, { handle: handler }))).resolves.toEqual({
      from: "tasks",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("query-string KHÔNG làm đổi khoá (cùng path + cùng body = cùng ý định)", async () => {
    const a = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      originalUrl: "/api/v1/leave/requests?trace=1",
    });
    await firstValueFrom(interceptor.intercept(a.ctx, nextOf({ id: "x" })));

    const handler = vi.fn(() => of({ id: "y" }));
    const b = makeContext(FakeController.prototype.create, {
      headers: { "idempotency-key": KEY },
      originalUrl: "/api/v1/leave/requests?trace=2",
    });
    await expect(firstValueFrom(interceptor.intercept(b.ctx, { handle: handler }))).resolves.toEqual({
      id: "x",
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
