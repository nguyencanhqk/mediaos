import { NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ChatReactionsService } from "./chat-reactions.service";
import type { ChatAccessService } from "./chat-access.service";
import type {
  ChatReactionAggregateRow,
  ChatReactionsRepository,
} from "./chat-reactions.repository";
import type { DatabaseService } from "../db/db.service";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";
import { CHAT_ERR } from "./chat.errors";

/**
 * S8-CHAT-UX-BE-3 — CHAT-API-022a/022b (CHAT-FUNC-019 · CHAT-DEC-018).
 *
 * Bốn bất biến đóng đinh ở đây:
 *   1. membership là cổng ⇒ **404** cho tin ở phòng không thuộc (CHAT-ERR-001 trục TIN);
 *   2. tin đã thu hồi / phòng đã lưu trữ ⇒ chặn đường GHI, nhưng **KHÔNG** chặn đường GỠ;
 *   3. payload WS **hẹp hơn** DTO REST — không `mine`, không `userIds`, không `actorUserId`;
 *   4. emit CHỈ khi số đếm thật sự đổi (thả lại emoji đang thả = no-op).
 */

const CO = "11111111-1111-4111-8111-111111111111";
const ROOM = "33333333-3333-4333-8333-333333333333";
const MSG = "55555555-5555-4555-8555-555555555555";
const USER = "22222222-2222-4222-8222-222222222222";
const ACTOR = { id: USER, companyId: CO };

function makeService(over: { recalledAt?: Date | null; isArchived?: boolean } = {}) {
  const assertMessageAccess = vi.fn(async () => ({
    message: {
      id: MSG,
      companyId: CO,
      roomId: ROOM,
      senderId: USER,
      messageType: "text",
      roomSeq: 3,
      pinnedAt: null,
      recalledAt: over.recalledAt ?? null,
      createdAt: new Date("2026-08-06T00:00:00.000Z"),
    },
    room: { id: ROOM, roomType: "group", isArchived: over.isArchived ?? false },
    membership: { id: "m1", userId: USER, role: "member", lastReadSeq: 0, visibleFromSeq: null },
  }));
  const access = { assertMessageAccess } as unknown as ChatAccessService;

  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const add = vi.fn(async () => true);
  const remove = vi.fn(async () => true);
  // Khai kiểu TƯỜNG MINH thay vì để suy từ giá trị khởi tạo: suy kiểu cho ra `emoji: "like"` (literal
  // hẹp) và `calls: []` (không tham số), khiến ca kiểm `mock.calls[0][2]` và `mockResolvedValue` với
  // emoji khác đều vỡ typecheck — mock phải mang đúng chữ ký của thứ nó thay thế.
  const aggregateForMessages =
    vi.fn<
      (
        tx: unknown,
        companyId: string,
        messageIds: readonly string[],
        actorUserId: string,
      ) => Promise<ChatReactionAggregateRow[]>
    >();
  aggregateForMessages.mockResolvedValue([{ messageId: MSG, emoji: "like", count: 2, mine: true }]);
  const repo = { add, remove, aggregateForMessages } as unknown as ChatReactionsRepository;

  const emitChatReaction = vi.fn();
  const realtime = { emitChatReaction } as unknown as RealtimeEmitterService;

  const svc = new ChatReactionsService(db, access, repo, realtime);
  return { svc, db, assertMessageAccess, add, remove, aggregateForMessages, emitChatReaction };
}

describe("ChatReactionsService — membership là cổng, 404 KHÔNG phải 403", () => {
  it("react: tin ở phòng không thuộc ⇒ 404, KHÔNG ghi, KHÔNG emit", async () => {
    const { svc, assertMessageAccess, add, emitChatReaction } = makeService();
    assertMessageAccess.mockRejectedValue(
      new NotFoundException(CHAT_ERR.MESSAGE_NOT_FOUND) as never,
    );

    await expect(svc.react(ACTOR, MSG, "like")).rejects.toBeInstanceOf(NotFoundException);
    expect(add).not.toHaveBeenCalled();
    expect(emitChatReaction).not.toHaveBeenCalled();
  });

  it("unreact: tin ở phòng không thuộc ⇒ 404 — đường GỠ vẫn qua đúng cổng dữ liệu", async () => {
    const { svc, assertMessageAccess, remove } = makeService();
    assertMessageAccess.mockRejectedValue(
      new NotFoundException(CHAT_ERR.MESSAGE_NOT_FOUND) as never,
    );

    await expect(svc.unreact(ACTOR, MSG, "like")).rejects.toBeInstanceOf(NotFoundException);
    expect(remove).not.toHaveBeenCalled();
  });

  it("khẳng định TRONG withTenant của đúng tenant", async () => {
    const { svc, db, assertMessageAccess } = makeService();
    await svc.react(ACTOR, MSG, "like");

    expect(db.withTenant).toHaveBeenCalledWith(CO, expect.any(Function));
    expect(assertMessageAccess).toHaveBeenCalledWith(expect.anything(), CO, MSG, USER);
  });
});

describe("CHAT-API-022a — đường GHI chặt", () => {
  it("tin ĐÃ THU HỒI ⇒ 422 CHAT-ERR-024, KHÔNG ghi", async () => {
    const { svc, add } = makeService({ recalledAt: new Date() });

    await expect(svc.react(ACTOR, MSG, "like")).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(svc.react(ACTOR, MSG, "like")).rejects.toThrow(/CHAT-ERR-024/);
    expect(add).not.toHaveBeenCalled();
  });

  it("phòng ĐÃ LƯU TRỮ ⇒ 422 CHAT-ERR-005 (phòng lưu trữ CHỈ ĐỌC, cùng luật sendMessage)", async () => {
    const { svc, add } = makeService({ isArchived: true });

    await expect(svc.react(ACTOR, MSG, "like")).rejects.toThrow(/CHAT-ERR-005/);
    expect(add).not.toHaveBeenCalled();
  });

  it("emoji NGOÀI bộ đóng ⇒ 422 CHAT-ERR-025, và chặn TRƯỚC khi chạm DB", async () => {
    const { svc, assertMessageAccess, add } = makeService();

    await expect(svc.react(ACTOR, MSG, "🔥")).rejects.toThrow(/CHAT-ERR-025/);
    // Không mở cả transaction cho một giá trị đã biết là sai.
    expect(assertMessageAccess).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("trả TỔNG HỢP của tin, không phải 204 — FE hoà lại cập-nhật-lạc-quan", async () => {
    const { svc } = makeService();

    const out = await svc.react(ACTOR, MSG, "like");

    expect(out).toEqual([{ emoji: "like", count: 2, mine: true }]);
  });
});

describe("CHAT-API-022b — đường GỠ nới đúng vế cần nới", () => {
  it("bỏ thả trên tin ĐÃ THU HỒI vẫn CHẠY — không nhốt một cảm xúc lỡ tay vĩnh viễn", async () => {
    const { svc, remove } = makeService({ recalledAt: new Date() });

    await expect(svc.unreact(ACTOR, MSG, "like")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("bỏ thả trong phòng ĐÃ LƯU TRỮ vẫn CHẠY — cùng lý do", async () => {
    const { svc, remove } = makeService({ isArchived: true });

    await expect(svc.unreact(ACTOR, MSG, "like")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("chưa từng thả ⇒ KHÔNG ném, KHÔNG emit (204 ở controller)", async () => {
    const { svc, remove, emitChatReaction } = makeService();
    remove.mockResolvedValue(false);

    await expect(svc.unreact(ACTOR, MSG, "like")).resolves.toBeUndefined();
    expect(emitChatReaction).not.toHaveBeenCalled();
  });
});

describe("chat:reaction — payload HẸP HƠN DTO REST", () => {
  it("KHÔNG có `mine`, KHÔNG có `userIds`, KHÔNG có `actorUserId`", async () => {
    const { svc, emitChatReaction } = makeService();

    await svc.react(ACTOR, MSG, "like");

    expect(emitChatReaction).toHaveBeenCalledTimes(1);
    const [companyId, roomId, payload] = emitChatReaction.mock.calls[0];
    expect(companyId).toBe(CO);
    expect(roomId).toBe(ROOM);
    // So sánh SÂU bằng `toEqual` trên cả object: `not.toHaveProperty('mine')` sẽ bỏ lọt một khoá mới
    // nào đó thêm sau này. Ở đây, hình dạng payload được ĐÓNG ĐINH.
    expect(payload).toEqual({
      roomId: ROOM,
      messageId: MSG,
      reactions: [{ emoji: "like", count: 2 }],
    });
  });

  it("thả LẠI emoji đang thả (không đổi số đếm) ⇒ KHÔNG emit lần hai", async () => {
    const { svc, add, emitChatReaction } = makeService();
    add.mockResolvedValue(false); // ON CONFLICT DO NOTHING → 0 hàng mới

    const out = await svc.react(ACTOR, MSG, "like");

    expect(out).toEqual([{ emoji: "like", count: 2, mine: true }]);
    expect(emitChatReaction).not.toHaveBeenCalled();
  });
});

describe("tổng hợp theo LÔ — 1 truy vấn cho cả trang tin", () => {
  it("lô rỗng ⇒ KHÔNG chạm DB", async () => {
    const { svc, db, aggregateForMessages } = makeService();

    const out = await svc.aggregateForMessages(ACTOR, []);

    expect(out.size).toBe(0);
    expect(db.withTenant).not.toHaveBeenCalled();
    expect(aggregateForMessages).not.toHaveBeenCalled();
  });

  it("20 tin ⇒ ĐÚNG MỘT lần gọi repo (không N+1)", async () => {
    const { svc, aggregateForMessages } = makeService();
    const ids = Array.from({ length: 20 }, (_, i) => `${i}`);

    await svc.aggregateForMessages(ACTOR, ids);

    expect(aggregateForMessages).toHaveBeenCalledTimes(1);
    expect(aggregateForMessages.mock.calls[0][2]).toHaveLength(20);
  });

  it("gom theo messageId — nhiều emoji trên cùng một tin về chung một mảng", async () => {
    const { svc, aggregateForMessages } = makeService();
    aggregateForMessages.mockResolvedValue([
      { messageId: MSG, emoji: "like" as const, count: 2, mine: true },
      { messageId: MSG, emoji: "love" as const, count: 1, mine: false },
    ]);

    const out = await svc.aggregateForMessages(ACTOR, [MSG]);

    expect(out.get(MSG)).toEqual([
      { emoji: "like", count: 2, mine: true },
      { emoji: "love", count: 1, mine: false },
    ]);
  });
});
