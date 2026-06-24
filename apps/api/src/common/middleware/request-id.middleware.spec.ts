import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { REQUEST_ID_HEADER, requestIdMiddleware } from "./request-id.middleware";

function run(headerValue: string | undefined) {
  const req = {
    headers: headerValue === undefined ? {} : { "x-request-id": headerValue },
  } as Request;
  const setHeader = vi.fn();
  const res = { setHeader } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  requestIdMiddleware(req, res, next);
  return { req, setHeader, next };
}

describe("requestIdMiddleware", () => {
  it("echoes a safe client-supplied X-Request-Id", () => {
    const { req, setHeader, next } = run("abc-123.req");
    expect(req.requestId).toBe("abc-123.req");
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, "abc-123.req");
    expect(next).toHaveBeenCalledOnce();
  });

  it("generates a UUID when no header is provided", () => {
    const { req } = run(undefined);
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a CRLF-injection value and generates a fresh UUID instead", () => {
    const { req, setHeader } = run("a\r\nSet-Cookie: evil=1");
    expect(req.requestId).not.toContain("\n");
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
  });

  it("rejects an over-long value (>128 chars)", () => {
    const { req } = run("x".repeat(200));
    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
