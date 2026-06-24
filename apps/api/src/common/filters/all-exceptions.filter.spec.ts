import {
  type ArgumentsHost,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { ZodValidationException } from "nestjs-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZodError, type ZodIssue } from "zod";
import { AllExceptionsFilter } from "./all-exceptions.filter";

interface MockRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  requestId?: string;
}

function invoke(exception: unknown, request: Partial<MockRequest> = {}) {
  const req: MockRequest = {
    method: request.method ?? "GET",
    url: request.url ?? "/api/v1/x",
    headers: request.headers ?? {},
    requestId: request.requestId ?? "req-1",
  };
  const json = vi.fn();
  const status = vi.fn((_statusCode: number) => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;

  const filter = new AllExceptionsFilter();
  filter.catch(exception, host);

  return {
    statusCode: status.mock.calls[0]?.[0] as number,
    body: json.mock.calls[0]?.[0] as Record<string, unknown>,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("AllExceptionsFilter — deny-path (BẤT BIẾN #3)", () => {
  it("DENY #1 — KHÔNG log giá trị secret (Authorization/Cookie header + token trong query-string)", () => {
    const logSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

    invoke(new InternalServerErrorException("boom"), {
      method: "POST",
      url: "/api/v1/login?token=secret123",
      headers: { authorization: "Bearer secret123", cookie: "mediaos_rt=xyz" },
    });

    const logged = logSpy.mock.calls.map((c) => JSON.stringify(c)).join(" | ");
    expect(logged).not.toContain("secret123");
    expect(logged).not.toContain("xyz");
  });

  it("DENY #2 — body 5xx KHÔNG lộ stack/đường dẫn file", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const exception = new InternalServerErrorException("boom");
    exception.stack = "Error: boom\n    at STACKLEAKMARKER (/app/src/secret/file.ts:10:5)";

    const { statusCode, body } = invoke(exception);

    expect(statusCode).toBe(500);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("STACKLEAKMARKER");
    expect(serialized).not.toContain("file.ts");
    expect(serialized).not.toContain("stack");
    expect((body.error as { code: string }).code).toBe("SYSTEM-ERR-001");
    expect((body.meta as { request_id: string }).request_id).toBe("req-1");
  });
});

describe("AllExceptionsFilter — error mapping (API-01 §12)", () => {
  it("ZodValidationException THẬT → VALIDATION-ERR-001 + details[] (branch chạy TRƯỚC httpStatusToCode 400)", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const issues: ZodIssue[] = [
      {
        code: "invalid_type",
        expected: "string",
        received: "undefined",
        path: ["email"],
        message: "Required",
      },
    ];
    const exception = new ZodValidationException(new ZodError(issues));

    const { statusCode, body } = invoke(exception);

    expect(statusCode).toBe(400);
    const error = body.error as {
      code: string;
      details?: Array<{ field: string; message: string; rule?: string }>;
    };
    expect(error.code).toBe("VALIDATION-ERR-001");
    expect(error.details?.[0]?.field).toBe("email");
    expect(error.details?.[0]?.message).toBe("Required");
  });

  it("ForbiddenException → AUTH-ERR-FORBIDDEN, status 403", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { statusCode, body } = invoke(new ForbiddenException("nope"));
    expect(statusCode).toBe(403);
    expect((body.error as { code: string }).code).toBe("AUTH-ERR-FORBIDDEN");
  });

  it("envelope lỗi có shape {success:false,message,data:null,error,meta}", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { body } = invoke(new ForbiddenException("nope"));
    expect(body.success).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(body.data).toBeNull();
    expect(body.error).toBeTypeOf("object");
    expect(body.meta).toBeTypeOf("object");
  });
});
