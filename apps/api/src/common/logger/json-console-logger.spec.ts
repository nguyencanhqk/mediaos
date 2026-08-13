import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonConsoleLogger } from "./json-console-logger";
import { runWithRequestId } from "./request-context";

// Fixture giống-secret PHẢI ghép chuỗi (KHÔNG literal high-entropy) — xem log-redaction.spec.ts.
const FAKE_INTERNAL_KEY = ["test", "jcl", "internal-key", "w".repeat(20)].join("-");
const FAKE_TOKEN = ["test", "jcl", "token", "v".repeat(24)].join("-");
const FAKE_DB_PASSWORD = ["example", "jcl", "dbpass", "q".repeat(18)].join("-");

/**
 * Nest gọi `getJsonLogObject` qua `printMessages(messages, context, level, stream, errorStack)` —
 * chữ ký của Nest khai `errorStack?: unknown`, KHÔNG phải `string`. Probe này đi ĐÚNG đường gọi đó
 * để chứng minh nhánh errorStack không-phải-chuỗi cũng bị redact (không gọi tắt vào hàm protected).
 */
class ProbeLogger extends JsonConsoleLogger {
  emitErrorWithStack(message: unknown, errorStack: unknown): void {
    this.printMessages([message], "ProbeCtx", "error", "stderr", errorStack);
  }
}

/** Spy KHÔNG cho ghi thật ra stream, giữ nguyên type cụ thể (tránh generic mặc định của `vi.spyOn`). */
function spyOnWrite(stream: NodeJS.WriteStream) {
  return vi.spyOn(stream, "write").mockImplementation(() => true);
}

function lastJsonWrite(spy: ReturnType<typeof spyOnWrite>): Record<string, unknown> {
  expect(spy).toHaveBeenCalled();
  const calls = spy.mock.calls;
  const raw = String(calls[calls.length - 1]?.[0]).trim();
  return JSON.parse(raw) as Record<string, unknown>;
}

describe("JsonConsoleLogger", () => {
  let stdoutSpy: ReturnType<typeof spyOnWrite>;
  let stderrSpy: ReturnType<typeof spyOnWrite>;

  beforeEach(() => {
    stdoutSpy = spyOnWrite(process.stdout);
    stderrSpy = spyOnWrite(process.stderr);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("in ra JSON có tối thiểu: timestamp · level · context · message", () => {
    const logger = new JsonConsoleLogger();
    logger.log("boot ok", "Bootstrap");

    const obj = lastJsonWrite(stdoutSpy);
    expect(typeof obj.timestamp).toBe("number");
    expect(obj.level).toBe("log");
    expect(obj.context).toBe("Bootstrap");
    expect(obj.message).toBe("boot ok");
  });

  it("error level ghi ra stderr với field level=error", () => {
    const logger = new JsonConsoleLogger();
    logger.error("something broke", undefined, "SomeService");

    const obj = lastJsonWrite(stderrSpy);
    expect(obj.level).toBe("error");
    expect(obj.message).toBe("something broke");
  });

  it("KHÔNG có request_id ngoài ngữ cảnh request (job nền/bootstrap)", () => {
    const logger = new JsonConsoleLogger();
    logger.log("outside a request", "JobRunner");

    const obj = lastJsonWrite(stdoutSpy);
    expect(obj.request_id).toBeUndefined();
  });

  it("gắn request_id khi log phát sinh TRONG một request đã mở AsyncLocalStorage context", () => {
    const logger = new JsonConsoleLogger();
    runWithRequestId("req-abc-123", () => {
      logger.log("handling request", "SomeController");
    });

    const obj = lastJsonWrite(stdoutSpy);
    expect(obj.request_id).toBe("req-abc-123");
  });

  it("hai request chạy đồng thời KHÔNG lẫn request_id của nhau", async () => {
    const logger = new JsonConsoleLogger();
    const seen: Record<string, unknown>[] = [];
    stdoutSpy.mockImplementation((chunk: unknown) => {
      seen.push(JSON.parse(String(chunk).trim()) as Record<string, unknown>);
      return true;
    });

    await Promise.all([
      runWithRequestId("req-A", async () => {
        await new Promise((r) => setTimeout(r, 5));
        logger.log("work A", "Svc");
      }),
      runWithRequestId("req-B", async () => {
        logger.log("work B", "Svc");
      }),
    ]);

    const a = seen.find((s) => s.message === "work A");
    const b = seen.find((s) => s.message === "work B");
    expect(a?.request_id).toBe("req-A");
    expect(b?.request_id).toBe("req-B");
  });

  it("BẤT BIẾN #3 — redact secret trong message trước khi ghi ra JSON", () => {
    const logger = new JsonConsoleLogger();
    logger.error(`auth failed — x-internal-key=${FAKE_INTERNAL_KEY} token=${FAKE_TOKEN}`);

    const calls = stderrSpy.mock.calls.map((c) => String(c[0]));
    const combined = calls.join("\n");
    expect(combined).not.toContain(FAKE_INTERNAL_KEY);
    expect(combined).not.toContain(FAKE_TOKEN);
  });

  it("BẤT BIẾN #3 — redact secret trong object message (field password/token/x-internal-key)", () => {
    const logger = new JsonConsoleLogger();
    logger.log({
      msg: "config loaded",
      headers: { "x-internal-key": FAKE_INTERNAL_KEY },
      password: "example-not-a-real-secret",
    });

    const obj = lastJsonWrite(stdoutSpy);
    const message = obj.message as { headers: Record<string, unknown>; password: unknown };
    expect(message.headers["x-internal-key"]).toBe("[REDACTED]");
    expect(message.password).toBe("[REDACTED]");
  });

  it("BẤT BIẾN #3 — redact connection string trong error.stack", () => {
    const logger = new JsonConsoleLogger();
    const dbPassword = ["s3cr3t", "jcl", "db"].join("-");
    const err = new Error("connect failed");
    err.stack = `Error: connect failed\n    at postgres://app:${dbPassword}@host:5432/db`;

    logger.error("db connect error", err.stack, "DbService");

    const obj = lastJsonWrite(stderrSpy);
    expect(JSON.stringify(obj)).not.toContain(dbPassword);
  });

  /**
   * DENY-PATH. `ConsoleLogger.getJsonLogObject` gán `logObject.stack = options.errorStack` NGUYÊN SI,
   * còn `stringifyReplacer` của Nest lại `util.inspect` mọi `instanceof Error` ⇒ stack đầy đủ (kèm
   * connection-string) đi thẳng ra JSON. Redact chỉ-khi-là-chuỗi để hở đúng nhánh này.
   */
  it("BẤT BIẾN #3 — errorStack KHÔNG phải chuỗi (Error) vẫn bị redact trước khi ra JSON", () => {
    const logger = new ProbeLogger();
    const err = new Error(`connect failed token=${FAKE_TOKEN}`);
    err.stack = `Error: connect failed\n    at connect (postgres://app:${FAKE_DB_PASSWORD}@host:5432/db)`;

    logger.emitErrorWithStack("db connect error", err);

    const raw = stderrSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(raw).not.toContain(FAKE_DB_PASSWORD);
    expect(raw).not.toContain(FAKE_TOKEN);
  });

  it("BẤT BIẾN #3 — errorStack là object thường mang secret cũng bị redact", () => {
    const logger = new ProbeLogger();

    logger.emitErrorWithStack("upstream rejected", {
      headers: { "x-internal-key": FAKE_INTERNAL_KEY },
      detail: `dsn=postgres://app:${FAKE_DB_PASSWORD}@host:5432/db`,
    });

    const obj = lastJsonWrite(stderrSpy);
    const serialized = JSON.stringify(obj);
    expect(serialized).not.toContain(FAKE_INTERNAL_KEY);
    expect(serialized).not.toContain(FAKE_DB_PASSWORD);
  });

  /**
   * DENY-PATH ĐỊNH DẠNG. `printAsJson` chỉ dùng `JSON.stringify` khi `!colors && inspectOptions.compact
   * === true`; lệch một trong hai là rơi sang `util.inspect` nhiều dòng ⇒ `ops-log-window.mjs` parse
   * hỏng, đếm 0 lỗi VĨNH VIỄN = cảnh báo mù. Caller truyền `compact:false`/`colors:true` KHÔNG được
   * phép bẻ hợp đồng một-dòng.
   */
  it("ghim MỘT DÒNG JSON dù caller truyền compact:false + colors:true", () => {
    const logger = new JsonConsoleLogger({ compact: false, colors: true });
    logger.log("one line please", "FormatCtx");

    expect(stdoutSpy).toHaveBeenCalledTimes(1);
    const raw = String(stdoutSpy.mock.calls[0]?.[0]);
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);

    const obj = JSON.parse(lines[0] as string) as Record<string, unknown>;
    expect(obj.message).toBe("one line please");
    expect(obj.context).toBe("FormatCtx");
    expect(obj.level).toBe("log");
    expect(typeof obj.timestamp).toBe("number");
  });
});
