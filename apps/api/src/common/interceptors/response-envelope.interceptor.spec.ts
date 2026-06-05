import { of, lastValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { ResponseEnvelopeInterceptor } from "./response-envelope.interceptor";

function run(value: unknown) {
  const interceptor = new ResponseEnvelopeInterceptor();
  const result$ = interceptor.intercept({} as never, { handle: () => of(value) });
  return lastValueFrom(result$);
}

describe("ResponseEnvelopeInterceptor", () => {
  it("wraps a payload into a success envelope", async () => {
    const out = await run({ id: "1" });
    expect(out).toEqual({ success: true, data: { id: "1" }, error: null });
  });

  it("maps undefined to null data", async () => {
    const out = await run(undefined);
    expect(out).toEqual({ success: true, data: null, error: null });
  });
});
