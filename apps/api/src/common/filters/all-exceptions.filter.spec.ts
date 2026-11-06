import {
  type ArgumentsHost,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from "@nestjs/common";
import { validate, ZodValidationException, ZodValidationPipe } from "nestjs-zod";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z, ZodError, type ZodIssue } from "zod";
import { httpStatusToCode } from "../errors/error-codes";
import { AllExceptionsFilter } from "./all-exceptions.filter";
import { TOO_MANY_REQUESTS_MESSAGE, tooManyRequests } from "./retry-after";

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
  // `setHeader` PHẢI có mặt trong mock: S18-AUTH-RETRYAFTER-1 cho filter đặt `Retry-After` trên
  // response của ngoại lệ. Thiếu nó thì MỌI ca ở file này ném TypeError vì một lý do không liên quan
  // tới điều đang đo. Filter vẫn gọi setHeader CÓ ĐIỀU KIỆN (429 + detail hợp lệ) — hình dạng response
  // không được biến thành phụ thuộc bắt buộc của mọi nhánh lỗi.
  const setHeader = vi.fn();
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, setHeader }),
      getRequest: () => req,
    }),
  } as unknown as ArgumentsHost;

  const filter = new AllExceptionsFilter();
  filter.catch(exception, host);

  return {
    statusCode: status.mock.calls[0]?.[0] as number,
    body: json.mock.calls[0]?.[0] as Record<string, unknown>,
    setHeader,
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

  it("ZodValidationException KHÔNG có issues ⇒ 400 không details, KHÔNG BAO GIỜ 500 (nestjs-zod 5: getZodError() là unknown)", () => {
    vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { statusCode, body } = invoke(new ZodValidationException({ lạ: true }));
    expect(statusCode).toBe(400);
    expect((body.error as { code: string; details: unknown }).code).toBe("VALIDATION-ERR-001");
    expect((body.error as { details: unknown }).details).toBeNull();
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

// ── S18-AUTH-RETRYAFTER-1 — header `Retry-After` suy TỪ `details` của 429 ────────────────────────
describe("AllExceptionsFilter — lỗi ném từ transform bị nestjs-zod 5 gói (vá FULL gate S19-OPS-ZOD4-1 §10.8)", () => {
  const meta = { type: "body" } as const;
  /** Chạy đúng đường production: pipe/validate của nestjs-zod 5 → ném → filter. */
  function thrownBy(run: () => unknown): unknown {
    try {
      run();
    } catch (e) {
      return e;
    }
    throw new Error("không ném");
  }
  const forbid = z.string().transform((): string => {
    throw new ForbiddenException("Không có quyền");
  });
  const typeErr = z.string().transform((s): string => {
    throw new TypeError(`hỏng khi xử lý (${s.length})`);
  });

  it("tiền đề: nestjs-zod 5 gói lỗi của transform thành ZodValidationException (pipe lẫn validate)", () => {
    expect(thrownBy(() => new ZodValidationPipe(forbid).transform("x", meta))).toBeInstanceOf(
      ZodValidationException,
    );
    expect(thrownBy(() => validate("x", typeErr))).toBeInstanceOf(ZodValidationException);
  });

  it("transform ném ForbiddenException ⇒ 403 với mã của chính nó (không phải 400 không details)", () => {
    for (const run of [
      () => new ZodValidationPipe(forbid).transform("x", meta),
      () => validate("x", forbid),
    ]) {
      const { statusCode, body } = invoke(thrownBy(run));
      expect(statusCode).toBe(403);
      expect((body.error as { code: string }).code).toBe(httpStatusToCode(403));
      expect((body.error as { type: string }).type).toBe("ForbiddenException");
      expect(body.message).toBe("Không có quyền");
    }
  });

  it("transform ném TypeError ⇒ 500 generic + log mức error có stack của TypeError (không lộ ra client)", () => {
    const logSpy = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const { statusCode, body } = invoke(
      thrownBy(() => new ZodValidationPipe(typeErr).transform("x", meta)),
    );
    expect(statusCode).toBe(500);
    expect(body.message).toBe("Lỗi hệ thống");
    expect((body.error as { type: string }).type).toBe("TypeError");
    expect(JSON.stringify(body)).not.toContain("hỏng khi xử lý");
    expect(logSpy).toHaveBeenCalledTimes(1);
    const [line, stack] = logSpy.mock.calls[0] as [string, string];
    expect(line).toContain("transform/refine");
    expect(stack).toContain("TypeError: hỏng khi xử lý (1)");
  });

  it("lỗi ZodError THẬT ném lồng trong transform vẫn là 400 + details (không bị bóc)", () => {
    const nested = z.string().transform((s) => z.number().parse(s));
    const { statusCode, body } = invoke(thrownBy(() => validate("x", nested)));
    expect(statusCode).toBe(400);
    expect(Array.isArray((body.error as { details: unknown }).details)).toBe(true);
  });
});

describe("AllExceptionsFilter — header Retry-After (429 mang retryAfterSec)", () => {
  const retryDetail = { field: "retryAfterSec", message: "900", rule: "retry-after" };

  it("429 + detail hợp lệ ⇒ setHeader('Retry-After','900') và body VẪN mang details", () => {
    const { statusCode, body, setHeader } = invoke(tooManyRequests(900));

    expect(statusCode).toBe(429);
    expect(setHeader).toHaveBeenCalledWith("Retry-After", "900");
    expect(setHeader).toHaveBeenCalledTimes(1);
    expect((body.error as { details: unknown }).details).toEqual([retryDetail]);
  });

  it("429 KHÔNG detail (Valkey rớt) ⇒ 0 lần setHeader, body details = null, KHÔNG ném", () => {
    const { statusCode, body, setHeader } = invoke(tooManyRequests(null));

    expect(statusCode).toBe(429);
    expect(setHeader).not.toHaveBeenCalled();
    expect((body.error as { details: unknown }).details).toBeNull();
    expect(body.message).toBe(TOO_MANY_REQUESTS_MESSAGE);
  });

  it("403 mang detail Y HỆT ⇒ 0 lần setHeader (header CHỈ thuộc về 429)", () => {
    const { statusCode, setHeader } = invoke(
      new ForbiddenException({ message: "Không có quyền", details: [retryDetail] }),
    );

    expect(statusCode).toBe(403);
    expect(setHeader).not.toHaveBeenCalled();
  });

  it("`code` của 429 VẪN là SYSTEM-ERR-RATE-LIMIT ở CẢ hai nhánh (payload không khai `code`)", () => {
    for (const err of [tooManyRequests(900), tooManyRequests(null)]) {
      const { body } = invoke(err);
      // Ghim CẢ literal: `toBe(httpStatusToCode(429))` một mình là so implementation với chính nó —
      // đổi bảng mã thì ca vẫn xanh. Literal được ghim ở int-spec, nhưng file đó SKIP khi không có
      // LANE_DB ⇒ ở lượt CI không-DB sẽ KHÔNG ai canh hợp đồng mã lỗi 429.
      expect((body.error as { code: string }).code).toBe("SYSTEM-ERR-RATE-LIMIT");
      expect((body.error as { code: string }).code).toBe(httpStatusToCode(429));
      expect((body.error as { type: string }).type).toBe("HttpException");
    }
  });
});
