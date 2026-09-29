/**
 * S16-SOCIAL-BE-3C (D6) — `RecycleBinRegistry`: hai chế độ hỏng đều phải ỒN ÀO.
 *
 * Trùng loại ⇒ ném lúc đăng ký (tức lúc BOOT — `onModuleInit`), thiếu loại ⇒ ném lúc đọc (500 fail-closed,
 * KHÔNG thùng rác rỗng im lặng). Ca đúng handler là neo dương: không có nó, hai ca ném ở trên xanh cả khi
 * registry không bao giờ trả gì.
 */
import { describe, expect, it, vi } from "vitest";
import { RecycleBinRegistry } from "./recycle-bin.registry";
import type { FeedPostRecycleBinHandler } from "./recycle-bin.types";

function fakeHandler(): FeedPostRecycleBinHandler {
  return {
    list: vi.fn(async () => ({ data: [], page: 1, limit: 20, total: 0 })),
    restore: vi.fn(async (_actor, id: string) => ({ id, status: "hidden" as const })),
  };
}

describe("S16-SOCIAL-BE-3C · RecycleBinRegistry", () => {
  it("trả ĐÚNG handler đã đăng ký cho loại (neo dương — cùng tham chiếu, không bản sao)", () => {
    const registry = new RecycleBinRegistry();
    const handler = fakeHandler();
    registry.register("feed_post", handler);
    expect(registry.get("feed_post")).toBe(handler);
  });

  it("đăng ký TRÙNG loại ⇒ ném (hai bản luật quyền/che cho cùng dữ liệu), handler đầu GIỮ NGUYÊN", () => {
    const registry = new RecycleBinRegistry();
    const first = fakeHandler();
    registry.register("feed_post", first);
    expect(() => registry.register("feed_post", fakeHandler())).toThrow(/feed_post.*đã có handler/);
    // Lượt ném KHÔNG được đè handler cũ — «handler sau thắng» là một quyết định phân quyền không ai viết.
    expect(registry.get("feed_post")).toBe(first);
  });

  it("đọc loại CHƯA đăng ký ⇒ ném (fail-closed ⇒ 500), KHÔNG trả undefined", () => {
    const registry = new RecycleBinRegistry();
    expect(() => registry.get("feed_post")).toThrow(/chưa có handler cho loại 'feed_post'/);
  });
});
