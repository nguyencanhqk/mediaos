import type { ExecutionContext } from "@nestjs/common";
import { of, lastValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { ResponseEnvelopeInterceptor } from "./response-envelope.interceptor";

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
