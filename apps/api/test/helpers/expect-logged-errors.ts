/**
 * withExpectedLoggerErrors — biến ERROR log ĐÚNG-nhưng-ồn THÀNH BẰNG CHỨNG có thể assert, TẠI ĐÚNG NƠI
 * PHÁT (S10-QA-LOGNOISE-1-FIX-A — vòng 2 của KI-015, sau khi vòng 1 chỉ ghi bằng chứng vào docblock mà
 * KHÔNG chạm tới điểm phát nhiễu thật: `test/integration/chat-noti-e2e.int-spec.ts` ca 14).
 *
 * ══ VÌ SAO KHÔNG DÙNG `vi.spyOn(Logger.prototype,'error').mockImplementation(() => undefined)` TRẦN ══
 * Cách đó đã dùng ở ~15 spec khác trong repo (secret-encryption, all-exceptions.filter, realtime/*, …) —
 * nhưng NUỐT MỌI DÒNG bất kể nội dung, không phân biệt "lỗi mình cố ý gieo" với "lỗi thật vừa xảy ra
 * trong đúng cửa sổ đó". Helper này khác ở CHỖ THEN CHỐT: chỉ nuốt dòng KHỚP mẫu đã khai trước — dòng
 * lạ (kể cả lỗi thật) vẫn kêu to y hệt không có helper.
 *
 * ══ HỢP ĐỒNG ══
 * • `expected`: danh sách mẫu, mỗi mẫu khớp arg ĐẦU TIÊN (message) của `logger.error(message, trace?)`.
 * • Dòng KHỚP một mẫu → NUỐT (không in ra console), đếm vào bộ đếm của đúng mẫu đó.
 * • Dòng KHÔNG khớp mẫu nào → FORWARD NGUYÊN VẸN (cùng `this`, cùng toàn bộ args) tới implementation
 *   THẬT của `Logger.prototype.error` đã bind TRƯỚC khi spy thay thế nó.
 * • Sau khi `fn()` CHẠY XONG KHÔNG NÉM: mỗi mẫu trong `expected` phải khớp đúng [min..max] lần (mặc định
 *   min=1, max=+∞) — lệch (kể cả 0 lần) ⇒ `throw`, làm spec đỏ. Đây LÀ cái "assert" mà WO đòi: hành vi
 *   đúng-nhưng-ồn phải được KHẲNG ĐỊNH, không được lặng lẽ biến mất hay lặng lẽ nhân lên mà không ai hay.
 * • `expected` RỖNG bị chặn NGAY LẬP TỨC (ném trước khi gọi `fn()`) — rỗng nghĩa là "nuốt hết, không assert
 *   gì cả", đúng thứ bị CẤM (bịt miệng toàn cục trá hình thành helper "có điều kiện").
 * • `fn()` NÉM lỗi → spy vẫn được khôi phục ở `finally`, nhưng KHÔNG chạy assert min/max: lỗi GỐC của test
 *   phải nổi lên nguyên vẹn, không bị một lỗi "thiếu mẫu kỳ vọng" đè lên che mất nguyên nhân thật.
 * • PHẠM VI HẸP THEO THỜI GIAN: patch/un-patch quanh ĐÚNG lệnh gọi `fn()` — không phải setupFile, không
 *   sống sót qua ranh giới `it()` khác. `Logger.prototype` là thuộc tính CHUNG một process (Nest không có
 *   scope theo instance) ⇒ KHÔNG gọi lồng hai `withExpectedLoggerErrors` song song trong CÙNG một worker
 *   vitest (mỗi file `*.int-spec.ts` chạy trong fork riêng nên khác file thì an toàn).
 */
import { Logger } from "@nestjs/common";
import { vi } from "vitest";

export interface ExpectedLoggerError {
  /** Mô tả ngắn, chỉ dùng để hiển thị khi assert thất bại — không ảnh hưởng logic khớp. */
  readonly label: string;
  /** Mẫu khớp arg ĐẦU TIÊN (message) của `logger.error(message, trace?, context?)`. */
  readonly match: RegExp;
  /** Số lần khớp TỐI THIỂU chấp nhận được. Mặc định 1. */
  readonly min?: number;
  /** Số lần khớp TỐI ĐA chấp nhận được. Mặc định không giới hạn. */
  readonly max?: number;
}

export interface LoggedErrorCall {
  /** `this.context` của logger instance đã gọi `.error()` (vd "OutboxNotificationBridge", "DeadLetterAlert"). */
  readonly context: string | undefined;
  /** arg đầu (message), ép về string để so khớp/hiển thị trong thông điệp lỗi. */
  readonly message: string;
  /** args nguyên vẹn — phòng khi caller cần soi thêm (vd stack ở arg[1]). */
  readonly args: readonly unknown[];
}

export interface WithExpectedLoggerErrorsResult<T> {
  readonly result: T;
  /** Các lần khớp, theo `label`, ĐÚNG thứ tự log thật đã xảy ra. */
  readonly matched: ReadonlyMap<string, LoggedErrorCall[]>;
}

export async function withExpectedLoggerErrors<T>(
  expected: readonly ExpectedLoggerError[],
  fn: () => Promise<T> | T,
): Promise<WithExpectedLoggerErrorsResult<T>> {
  if (expected.length === 0) {
    throw new Error(
      "withExpectedLoggerErrors: 'expected' rỗng nghĩa là nuốt MỌI dòng ERROR mà không assert gì cả — " +
        "đây chính là kiểu bịt-miệng-toàn-cục bị CẤM. Khai ít nhất 1 mẫu kỳ vọng.",
    );
  }

  // Bind SỚM — trước khi spyOn thay thế `Logger.prototype.error` — để giữ implementation THẬT dùng
  // FORWARD dòng không khớp (nếu bind sau, `originalError` sẽ chính là hàm mock của lượt trước).
  const originalError = Logger.prototype.error;
  const matched = new Map<string, LoggedErrorCall[]>(expected.map((e) => [e.label, []]));

  const spy = vi.spyOn(Logger.prototype, "error").mockImplementation(function (
    this: Logger,
    ...args: unknown[]
  ) {
    const rawMessage = args[0];
    const message = typeof rawMessage === "string" ? rawMessage : String(rawMessage);
    // `lastIndex = 0` phòng thủ: nếu caller lỡ khai regex có flag `g`/`y`, `.test()` mang trạng thái giữa
    // các lần gọi (RegExp stateful) ⇒ khớp/trượt tuỳ thứ tự gọi trước đó — lỗi ẩn rất khó tái lập.
    const hit = expected.find((e) => {
      e.match.lastIndex = 0;
      return e.match.test(message);
    });
    if (hit) {
      const context = (this as unknown as { context?: string }).context;
      matched.get(hit.label)!.push({ context, message, args });
      return undefined; // NUỐT — thay bằng assert min/max NGAY SAU KHI fn() xong (không im lặng vĩnh viễn).
    }
    // KHÔNG khớp mẫu nào ⇒ lỗi thật (hoặc nằm ngoài kịch bản đã khai) — kêu to y hệt không có helper.
    return originalError.apply(this, args as Parameters<typeof originalError>);
  });

  let result: T;
  try {
    result = await fn();
  } finally {
    spy.mockRestore();
  }

  for (const e of expected) {
    const calls = matched.get(e.label)!;
    const min = e.min ?? 1;
    const max = e.max ?? Number.POSITIVE_INFINITY;
    if (calls.length < min || calls.length > max) {
      throw new Error(
        `withExpectedLoggerErrors: mẫu "${e.label}" kỳ vọng khớp [${min}..${max}] lần nhưng đo được ` +
          `${calls.length} lần (regex: ${e.match}). Nếu đo được 0: hành vi ĐÚNG-nhưng-ồn mà mẫu này canh ` +
          `đã KHÔNG CÒN XẢY RA NỮA — kiểm lại code trước khi coi đây là 'sửa xong', đừng chỉnh regex cho ` +
          `khớp lại rồi bỏ qua.`,
      );
    }
  }

  return { result, matched };
}
