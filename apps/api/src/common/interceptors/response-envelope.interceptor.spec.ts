import type { ExecutionContext } from "@nestjs/common";
import { of, lastValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { ResponseEnvelopeInterceptor } from "./response-envelope.interceptor";
import { paginated, toPagination } from "../pagination";

function contextWithRequestId(requestId: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ requestId }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
  } as unknown as ExecutionContext;
}

function run(value: unknown, requestId = "req-1") {
  const interceptor = new ResponseEnvelopeInterceptor();
  const result$ = interceptor.intercept(contextWithRequestId(requestId), {
    handle: () => of(value),
  });
  return lastValueFrom(result$);
}

describe("ResponseEnvelopeInterceptor", () => {
  it("wraps a payload into a success envelope with message + meta", async () => {
    const out = (await run({ id: "1" }, "req-1")) as Record<string, unknown>;
    expect(out.success).toBe(true);
    expect(out.message).toBe("OK");
    expect(out.data).toEqual({ id: "1" });
    expect(out.error).toBeNull();
    const meta = out.meta as { request_id: string; timestamp: string };
    expect(meta.request_id).toBe("req-1");
    // timestamp must be a parseable ISO-8601 string
    expect(Number.isNaN(Date.parse(meta.timestamp))).toBe(false);
  });

  it("maps undefined to null data", async () => {
    const out = (await run(undefined)) as Record<string, unknown>;
    expect(out.data).toBeNull();
    expect(out.success).toBe(true);
  });

  it("hoists a paginated() result → top-level `pagination` block (API-01 §16.1), data un-nested", async () => {
    const out = (await run(paginated([{ id: "1" }], toPagination(1, 1, 20)), "req-1")) as Record<
      string,
      unknown
    >;
    expect(out.success).toBe(true);
    expect(out.data).toEqual([{ id: "1" }]); // data is the rows, NOT { data, pagination }
    expect(out.pagination).toMatchObject({ total: 1, page: 1, per_page: 20, total_pages: 1 });
    // pagination must NOT be folded into meta
    expect((out.meta as Record<string, unknown>).total).toBeUndefined();
  });

  it("non-paginated payload has no `pagination` key (additive — không ảnh hưởng response thường)", async () => {
    const out = (await run({ id: "1" })) as Record<string, unknown>;
    expect("pagination" in out).toBe(false);
  });

  it("falls back to empty request_id string when middleware did not set one", async () => {
    // Gọi thẳng (KHÔNG qua run): default param của run sẽ thay undefined → "req-1", che mất nhánh thiếu id.
    const interceptor = new ResponseEnvelopeInterceptor();
    const out = (await lastValueFrom(
      interceptor.intercept(contextWithRequestId(undefined), { handle: () => of({ ok: true }) }),
    )) as Record<string, unknown>;
    const meta = out.meta as { request_id: string };
    expect(meta.request_id).toBe("");
  });
});
