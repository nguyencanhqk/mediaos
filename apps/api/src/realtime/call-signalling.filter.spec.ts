import { Logger } from "@nestjs/common";
import type { ArgumentsHost } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CallSignallingExceptionFilter } from "./call-signalling.filter";

/**
 * S7-CALL-QA-1 nhóm A — `call-signalling.filter.ts` **21.73% stmts / 50% funcs** trước WO này: toàn bộ
 * thân `catch()` (dòng 25-46) CHƯA TỪNG CHẠY. Gỡ `@UseFilters` khỏi gateway hôm nay không làm đỏ bài nào
 * — tức hai tính chất mà filter tồn tại để giữ đều **không có gì canh**:
 *
 *   1. **0 khung về client.** `BaseWsExceptionFilter` mặc định `includeCause: true` echo lại tên sự kiện
 *      + CHÍNH payload client vừa gửi ⇒ (a) oracle phân biệt "handler ném" với "bỏ im lặng", phá đúng
 *      tính không-phân-biệt-được mà lớp A/B/C dựng ra; (b) khung echo mang chính `sdp`/`candidate` =
 *      **vi phạm R3** (`DECISIONS-07`).
 *   2. **Ngắt, không giữ sống.** Một handler ném nghĩa là server không còn khẳng định được gì về phiên.
 *
 * Vế "0 khung" đo ở int-spec (ca A1, `chat-s7-call-rt1-signalling.int-spec.ts`) vì chỉ ở đó mới có một
 * client thật để chứng minh nó **không nhận được gì**. Ở đây đo phần int KHÔNG dựng nổi: đường `disconnect()`
 * ném — không có cách nào bắt một `Socket` thật của socket.io ném từ `disconnect()`.
 *
 * Colocated trong `src/` để LUÔN chạy (`vitest.config.ts:45-50` chỉ nhận `src/**\/*.spec.ts`).
 */

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  disconnect: ReturnType<typeof vi.fn>;
}

function makeSocket(overrides: Partial<FakeSocket> = {}): FakeSocket {
  return {
    id: "sock-1",
    data: { user: { id: "user-1" } },
    disconnect: vi.fn(),
    ...overrides,
  };
}

/** `ArgumentsHost` tối thiểu — filter chỉ dùng đúng `switchToWs().getClient()`. */
const hostFor = (socket: FakeSocket): ArgumentsHost =>
  ({ switchToWs: () => ({ getClient: () => socket }) }) as unknown as ArgumentsHost;

describe("CallSignallingExceptionFilter — filter CÂM của /ws-call", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("handler ném ⇒ log ĐẦY ĐỦ phía server + NGẮT hẳn (fail-LOUD server, câm với client)", () => {
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = makeSocket();

    new CallSignallingExceptionFilter().catch(new Error("boom-từ-handler"), hostFor(socket));

    expect(
      socket.disconnect,
      "ngắt CỨNG — không giữ một phiên server không mô tả được",
    ).toHaveBeenCalledWith(true);
    expect(errors).toHaveBeenCalledTimes(1);
    const [message, stack] = errors.mock.calls[0];
    // Đủ để điều tra: AI, socket NÀO, lỗi GÌ. Thiếu một trong ba thì dòng log không tra được về người.
    expect(message).toContain("user-1");
    expect(message).toContain("sock-1");
    expect(message).toContain("boom-từ-handler");
    expect(stack, "stack phải được giữ — nếu không thì lỗi hạ tầng không truy được").toBeTruthy();
  });

  it("R3 — dòng log KHÔNG mang payload khung (nó có thể chứa SDP/ICE; log tập trung cũng là một nơi lưu)", () => {
    // ⚠️ Đây là vế R3 của filter, và nó KHÁC vế "không ghi DB" mà CA 5b/V3 đã canh. `AuditMaskerService`
    // không cứu được đường này: nó mask theo TÊN KHOÁ (`password`/`token`/`secret`/`*_hash`) — `sdp` và
    // `candidate` không nằm trong danh sách đó, và log của Nest không đi qua masker.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const marker = "MARKER-SDP-DO-NOT-LOG";
    const socket = makeSocket();
    // Lỗi mang theo payload y như một `ZodError` thật sẽ mang: nếu filter in `exception` bằng cách khác
    // (vd `JSON.stringify(exception)`), marker sẽ lọt vào log.
    const err = Object.assign(new Error("relay thất bại"), {
      payload: { sdp: marker, candidate: marker },
    });

    new CallSignallingExceptionFilter().catch(err, hostFor(socket));

    for (const call of errors.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(marker);
    }
  });

  it("ngoại lệ KHÔNG phải Error (chuỗi/số ném thô) ⇒ vẫn log + vẫn ngắt, không tự ném", () => {
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = makeSocket();

    // `String(exception)` là nhánh else của `exception instanceof Error` — một filter chỉ đọc
    // `exception.message` sẽ in "undefined" ở đây và mất luôn dấu vết.
    expect(() =>
      new CallSignallingExceptionFilter().catch("lỗi-thô-không-phải-Error", hostFor(socket)),
    ).not.toThrow();

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(errors.mock.calls[0][0]).toContain("lỗi-thô-không-phải-Error");
    expect(errors.mock.calls[0][1], "không phải Error ⇒ không có stack để giữ").toBeUndefined();
  });

  it("A2 — `disconnect()` CŨNG ném ⇒ log lỗi THỨ HAI, không nuốt, và KHÔNG ném ra ngoài filter", () => {
    // ⚠️ Vì sao ca này phải là unit: không có cách nào làm `Socket` thật của socket.io ném từ
    // `disconnect()`. Và vì sao nó đáng đo: filter là **lớp cuối** — nó chạy vì một handler đã ném. Nếu
    // chính nó ném tiếp thì Nest không còn ai bắt, promise của `screenFrame` (`onAny`, KHÔNG await) trở
    // thành `unhandledRejection` = **giết cả tiến trình** (memory `vitest-unhandled-rejection-after-teardown`).
    //
    // Tính chất thứ hai, quan trọng ngang: KHÔNG được nuốt im lặng. Ngắt thất bại nghĩa là một phiên
    // signalling ở trạng thái không xác định VẪN ĐANG SỐNG — đúng thứ người vận hành phải biết.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = makeSocket({
      disconnect: vi.fn(() => {
        throw new Error("socket đã hỏng");
      }),
    });

    expect(() =>
      new CallSignallingExceptionFilter().catch(new Error("boom"), hostFor(socket)),
    ).not.toThrow();

    expect(errors, "hai dòng: lỗi handler + lỗi ngắt").toHaveBeenCalledTimes(2);
    expect(errors.mock.calls[1][0]).toContain("ngắt kết nối THẤT BẠI");
    expect(errors.mock.calls[1][0]).toContain("socket đã hỏng");
    // "phiên có thể còn sống" là phần đắt nhất của dòng log này: nó nói cho người trực biết phải đi tìm
    // gì. Ghim chuỗi để bản refactor sau không rút nó thành "disconnect failed".
    expect(errors.mock.calls[1][0]).toContain("phiên có thể còn sống");
  });

  it("A2b — `disconnect()` ném thứ KHÔNG phải Error ⇒ vẫn log được (nhánh `String(err)`)", () => {
    // Nhánh còn lại của cùng dòng: một filter chỉ đọc `err.message` sẽ in "undefined" ở đây — tức dòng
    // log duy nhất nói "phiên có thể còn sống" mất luôn lý do.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = makeSocket({
      disconnect: vi.fn(() => {
        throw "ngắt-hỏng-thô";
      }),
    });

    expect(() =>
      new CallSignallingExceptionFilter().catch(new Error("boom"), hostFor(socket)),
    ).not.toThrow();

    expect(errors.mock.calls[1][0]).toContain("ngắt-hỏng-thô");
  });

  it("socket CHƯA có `data.user` (ném ngay ở handshake) ⇒ log `userId=?`, KHÔNG sập filter", () => {
    // Nhánh `?? "?"`: filter chạy được cả khi middleware chưa kịp đặt `client.data.user`. Một filter đọc
    // thẳng `client.data.user.id` sẽ ném `TypeError` ở đúng lúc hệ đang hỏng.
    const errors = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const socket = makeSocket({ data: {} });

    new CallSignallingExceptionFilter().catch(new Error("boom"), hostFor(socket));

    expect(errors.mock.calls[0][0]).toContain("userId=?");
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
