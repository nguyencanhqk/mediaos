import pg from "pg";

/**
 * S17-CHAT-UX2-BE-1 — bắt/đếm câu SQL THẬT ở tầng driver `pg`, cho các ca "không N+1".
 *
 * ┌─ VÌ SAO KHÔNG ĐẾM BUILDER, VÀ KHÔNG ĐO THỜI GIAN ─────────────────────────────────────────────┐
 * │ • Đếm số lần `tx.select` được DỰNG (khuôn cũ của `chat-be1-rooms` ca 11 và `chat-qa1-scale`    │
 * │   §19) ngầm coi "1 builder = 1 round-trip". Hai thứ đó KHÔNG bằng nhau: một `LEFT JOIN         │
 * │   LATERAL` phải dựng builder cho subquery nhưng vẫn đi trong CÙNG MỘT câu SQL. Con số đó vì    │
 * │   thế là chi tiết THI CÔNG, và mọi WO thêm một lateral sẽ phải hoặc bỏ lateral, hoặc sửa hằng  │
 * │   số thành 3 → 4 → 5 mà không ai còn biết nó nghĩa là gì.                                      │
 * │ • Đo THỜI GIAN thì một bản N+1 vẫn nhanh trên DB rỗng của lane (xanh GIẢ), còn máy CI chậm     │
 * │   biến ca đó thành đỏ ngẫu nhiên (memory `slow-probe-manufactures-timeout-red`).               │
 * │ • Số CÂU SQL là đại lượng RỜI RẠC, đúng thứ mệnh đề "không N+1" nói tới, và không phụ thuộc    │
 * │   máy chạy.                                                                                    │
 * └────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ Vá `pg.Client.prototype.query` là toàn cục trong tiến trình test. Luôn gọi `stop()` trong `finally`
 * — bỏ sót là mọi ca sau trong cùng worker chạy qua bản vá (rò bộ nhớ + nhiễu số đếm).
 */
export interface CapturedQuery {
  text: string;
  values: unknown[];
}

export interface QueryCapture {
  /** Gỡ bản vá và trả về mọi câu SQL đã đi qua driver trong lúc bắt. */
  stop: () => CapturedQuery[];
}

export function captureQueries(): QueryCapture {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const original = proto.query;
  const seen: CapturedQuery[] = [];

  proto.query = function patched(this: unknown, ...args: unknown[]) {
    const first = args[0];
    const text =
      typeof first === "string"
        ? first
        : typeof (first as { text?: unknown } | null)?.text === "string"
          ? (first as { text: string }).text
          : "";
    const values = Array.isArray(args[1])
      ? (args[1] as unknown[])
      : ((first as { values?: unknown[] } | null)?.values ?? []);
    if (text) seen.push({ text, values });
    return original.apply(this, args as never);
  } as typeof original;

  return {
    stop: () => {
      proto.query = original;
      return seen;
    },
  };
}

/** Câu SQL đọc một bảng cụ thể (`from "ten_bang"`), không tính các câu phụ trợ của transaction. */
export function queriesFromTable(
  queries: readonly CapturedQuery[],
  table: string,
): CapturedQuery[] {
  const re = new RegExp(`from\\s+"${table}"`, "i");
  return queries.filter((q) => re.test(q.text));
}
