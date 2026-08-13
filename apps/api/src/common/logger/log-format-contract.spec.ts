import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JsonConsoleLogger } from "./json-console-logger";

/**
 * log-format-contract.spec.ts — S10-FND-JSONLOG-1-FIX-2.
 *
 * ═══ LỖ HỔNG ĐANG VÁ: HAI SUITE HIỆN CÓ KHÔNG BUỘC ĐƯỢC HỢP ĐỒNG ═══
 * `json-console-logger.spec.ts` đo OBJECT do logger phát ra (đúng, nhưng không chạm bộ đếm
 * `ops-log-window.mjs`). `ops-log-window.test.mjs` đo bộ đếm THẬT nhưng qua fixture `jsonLine()`
 * VIẾT TAY — chuỗi `JSON.stringify({ ..., timestamp: ms, ... })` gõ lại field `timestamp` bằng tay,
 * KHÔNG đọc từ logger thật.
 *
 * Hệ quả: nếu ai đó đổi tên field trong `getJsonLogObject` (vd. `timestamp` → `time`) VÀ sửa luôn
 * assertion trong `json-console-logger.spec.ts` cho khớp (đổi `obj.timestamp` → `obj.time`), CẢ HAI
 * suite trên vẫn XANH — suite logger khớp vì tự đổi theo, suite counter khớp vì fixture tay không hề
 * đụng tới code emitter thật. Log PROD thật (field mới) thì `parseJsonLogLine` (đọc `obj.timestamp`,
 * không đổi) không parse được nữa ⇒ `ERROR_SPIKE` câm lặng vĩnh viễn — đúng kiểu "cảnh báo mù" mà
 * `ops-log-window.mjs` từng dính với `mtime` (xem docblock đầu file đó).
 *
 * File này khâu HAI ĐẦU bằng BYTE THẬT: stub `process.stdout/stderr.write` để bắt đúng chuỗi mà
 * `JsonConsoleLogger` ghi ra khi gọi `.error()/.log()/.warn()` thật, đưa THẲNG chuỗi đó (không qua
 * fixture trung gian) vào `countErrorLinesInWindow` THẬT import từ `scripts/lib/ops-log-window.mjs`.
 * Đổi tên field ở `getJsonLogObject` mà không sửa `parseJsonLogLine` ⇒ spec này ĐỎ vì đếm sai số
 * dòng đã bơm (đã xác minh tay: xem ghi chú bàn giao).
 *
 * `nowMs` được TIÊM (không dùng đồng hồ hệ thống thật) — đóng băng `Date.now()` bằng
 * `vi.setSystemTime` để cả logger (gọi `Date.now()` bên trong `getJsonLogObject` của Nest) LẪN
 * `countErrorLinesInWindow` (nhận `nowMs`) cùng nhìn một mốc giờ, cho kết quả tất định.
 */

// Dynamic import với đường dẫn qua BIẾN (không phải string literal) — TS chỉ cố phân giải type cho
// `import()` khi tham số là literal; qua biến thì trả `Promise<any>`, tránh phải đổi
// `tsconfig`/`allowJs` chỉ để nạp một file `.mjs` ngoài `apps/api` (script Node thuần, không phải
// package có type). Ép kiểu tường minh ngay sau đó để không rơi tự do về `any`.
const OPS_LOG_WINDOW_PATH = "../../../../../scripts/lib/ops-log-window.mjs";

type CountErrorLinesInWindow = (
  text: string,
  opts?: { nowMs?: number; windowMin?: number; dropFirstLine?: boolean },
) => number;

let countErrorLinesInWindow: CountErrorLinesInWindow;

beforeEach(async () => {
  const mod = (await import(OPS_LOG_WINDOW_PATH)) as {
    countErrorLinesInWindow: CountErrorLinesInWindow;
  };
  countErrorLinesInWindow = mod.countErrorLinesInWindow;
});

/** Mốc "bây giờ" cố định — tiêm cho cả logger (qua `vi.setSystemTime`) lẫn bộ đếm (qua `nowMs`). */
const FIXED_NOW = new Date(2026, 6, 15, 14, 30, 0).getTime();
const WINDOW_MIN = 60;

/** Spy KHÔNG cho ghi thật ra stream, gom chuỗi đã ghi vào `sink` dùng chung cho cả hai stream. */
function spyOnWrite(stream: NodeJS.WriteStream, sink: string[]) {
  return vi.spyOn(stream, "write").mockImplementation((chunk: unknown) => {
    sink.push(String(chunk));
    return true;
  });
}

describe("log-format-contract — buộc hợp đồng EMITTER (JsonConsoleLogger) ⇄ COUNTER (countErrorLinesInWindow) bằng BYTE THẬT", () => {
  let written: string[];
  let stdoutSpy: ReturnType<typeof spyOnWrite>;
  let stderrSpy: ReturnType<typeof spyOnWrite>;

  beforeEach(() => {
    written = [];
    stdoutSpy = spyOnWrite(process.stdout, written);
    stderrSpy = spyOnWrite(process.stderr, written);
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it("bơm N lỗi THẬT qua .error() lặp lại → countErrorLinesInWindow(THẬT) đếm đúng N", () => {
    const logger = new JsonConsoleLogger();
    const errorCount = 5;
    for (let i = 0; i < errorCount; i++) {
      logger.error(`lỗi thật bơm qua logger #${i}`, undefined, "ContractProbe");
    }

    const text = written.join("");
    const counted = countErrorLinesInWindow(text, { nowMs: FIXED_NOW, windowMin: WINDOW_MIN });
    expect(counted).toBe(errorCount);
  });

  it("CA NGƯỢC — .log() ghi byte THẬT nhưng KHÔNG được bộ đếm tính là lỗi", () => {
    const logger = new JsonConsoleLogger();
    for (let i = 0; i < 4; i++) {
      logger.log(`chuyện bình thường #${i}`, "ContractProbe");
    }

    const text = written.join("");
    const counted = countErrorLinesInWindow(text, { nowMs: FIXED_NOW, windowMin: WINDOW_MIN });
    expect(counted).toBe(0);
  });

  it("CA NGƯỢC — .warn() ghi byte THẬT nhưng KHÔNG được bộ đếm tính là lỗi", () => {
    const logger = new JsonConsoleLogger();
    for (let i = 0; i < 3; i++) {
      logger.warn(`cảnh báo nhẹ #${i}`, "ContractProbe");
    }

    const text = written.join("");
    const counted = countErrorLinesInWindow(text, { nowMs: FIXED_NOW, windowMin: WINDOW_MIN });
    expect(counted).toBe(0);
  });

  it("trộn .log()/.warn()/.error() THẬT — chỉ đúng số dòng .error() được đếm, KHÔNG lẫn dòng khác", () => {
    const logger = new JsonConsoleLogger();
    logger.log("a", "ContractProbe");
    logger.error("lỗi 1", undefined, "ContractProbe");
    logger.warn("b", "ContractProbe");
    logger.error("lỗi 2", undefined, "ContractProbe");
    logger.log("c", "ContractProbe");
    logger.error("lỗi 3", undefined, "ContractProbe");

    const text = written.join("");
    const counted = countErrorLinesInWindow(text, { nowMs: FIXED_NOW, windowMin: WINDOW_MIN });
    expect(counted).toBe(3);
  });
});
