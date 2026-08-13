import { ConsoleLogger, type ConsoleLoggerOptions, type LogLevel } from "@nestjs/common";
import { redactValue } from "./log-redaction";
import { getRequestId } from "./request-context";

interface JsonLogObjectOptions {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: "stdout" | "stderr";
  errorStack?: unknown;
}

interface JsonLogObject {
  level: LogLevel;
  pid: number;
  timestamp: number;
  message: unknown;
  context?: string;
  stack?: unknown;
  request_id?: string;
}

/**
 * json-console-logger.ts — S10-FND-JSONLOG-1 (KI-009). Log JSON có cấu trúc thay `Logger` văn xuôi
 * mặc định của Nest, tối thiểu: `timestamp` (epoch ms) · `level` · `context` · `request_id` (nếu có)
 * · `message`.
 *
 * ═══ VÌ SAO CHỈ CẦN MỘT FILE NÀY MÀ ĐỔI ĐƯỢC LOG CỦA 100+ SERVICE ═══
 * `NestFactory.create(AppModule, { logger })` gọi `Logger.overrideLogger(logger)` bên trong
 * (`@nestjs/core/nest-factory.js`), gán `Logger.staticInstanceRef = logger`. MỌI `new Logger(ctx)`
 * rải khắp service/repository (không qua DI) đều đọc lại đúng `staticInstanceRef` này ở getter
 * `localInstance` — nên đăng ký MỘT LẦN ở `main.ts` là đủ, KHÔNG cần sửa từng file gọi log.
 *
 * ═══ REDACTION LÀ BẮT BUỘC, KHÔNG PHẢI TÙY CHỌN (BẤT BIẾN #3) ═══
 * Kế thừa `getJsonLogObject` (protected, đúng điểm mở rộng mà NestJS 11 dành cho JSON logger tùy
 * biến) rồi áp `redactValue` lên CẢ `message` LẪN `errorStack` trước khi gọi `super()` — không có
 * đường nào bỏ qua bước này để in thẳng object gốc.
 *
 * `errorStack` đi qua `redactValue` VÔ ĐIỀU KIỆN, KHÔNG lọc `typeof === "string"` trước. Chữ ký của
 * Nest là `errorStack?: unknown`, `super.getJsonLogObject` gán `logObject.stack = options.errorStack`
 * NGUYÊN SI, còn `stringifyReplacer` lại `util.inspect` mọi `instanceof Error` ⇒ một `Error`/object
 * mang connection-string hay `x-internal-key` sẽ in đủ ra log nếu ta bỏ qua nhánh không-phải-chuỗi.
 *
 * ═══ VÌ SAO ÉP `compact: true` (KHÔNG CHỈ `json: true`) ═══
 * `printAsJson` của Nest chỉ dùng `JSON.stringify` khi `!options.colors && inspectOptions.compact
 * === true`; lệch MỘT trong hai là rơi sang `util.inspect` in NHIỀU DÒNG. `getInspectOptions()` lấy
 * `this.options.compact ?? (json ? true : false)` — nên caller truyền `compact: false` đủ để bẻ hợp
 * đồng một-dòng, khiến `scripts/lib/ops-log-window.mjs` parse hỏng và đếm 0 lỗi VĨNH VIỄN (cảnh báo
 * mù, không ai biết). Cả `colors` lẫn `compact` vì thế là hằng số của lớp này, không phải tuỳ chọn.
 */
export class JsonConsoleLogger extends ConsoleLogger {
  constructor(options: ConsoleLoggerOptions = {}) {
    super({ ...options, json: true, colors: false, compact: true });
  }

  protected override getJsonLogObject(
    message: unknown,
    options: JsonLogObjectOptions,
  ): JsonLogObject {
    const safeOptions: JsonLogObjectOptions = {
      ...options,
      errorStack: redactValue(options.errorStack),
    };
    const base = super.getJsonLogObject(redactValue(message), safeOptions) as JsonLogObject;
    const requestId = getRequestId();
    return requestId ? { ...base, request_id: requestId } : base;
  }
}
