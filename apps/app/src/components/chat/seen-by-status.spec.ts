/**
 * S20-CHAT-SEENBY-1 (US-CHAT-QL-03) — hàm THUẦN suy «Đã xem · Chưa xem» cho MỘT tin của tôi.
 *
 * Nguồn duy nhất: `members[].lastReadSeq` + `joinedAt` đã có ở FE (không endpoint mới). Bảng ca đo đúng
 * từng luật loại trừ: chính tôi · người vào SAU lúc gửi · người đã rời — và hai biên dễ lệch: vào ĐÚNG lúc
 * gửi (vẫn tính) và `joinedAt` không đọc được (không tự loại người, thiếu dữ liệu không phải bằng chứng).
 */
import { describe, expect, it } from "vitest";
import type { ChatRoomMemberDto } from "@mediaos/contracts";
import { rosterStatusOf, seenByStatusOf } from "./seen-by-status";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SENT_AT = "2026-10-20T09:00:00.000Z";
const BEFORE = "2026-10-01T08:00:00.000Z";
const AFTER = "2026-10-20T09:30:00.000Z";
const MESSAGE = { roomSeq: 50, createdAt: SENT_AT };

function member(userId: string, over: Partial<ChatRoomMemberDto> = {}): ChatRoomMemberDto {
  return {
    id: `m-${userId}`,
    roomId: ROOM_ID,
    userId,
    role: "member",
    joinedAt: BEFORE,
    userName: `Người ${userId}`,
    lastReadSeq: 0,
    ...over,
  } as ChatRoomMemberDto;
}

const ids = (list: readonly { userId: string }[]): string[] => list.map((v) => v.userId);

describe("seenByStatusOf · bảng ca", () => {
  it("phòng 10 người, 7 người đã đọc ⇒ Đã xem 7 · Chưa xem 2 (không tính tôi)", () => {
    const others = Array.from({ length: 9 }, (_, i) =>
      member(`u${i}`, { lastReadSeq: i < 7 ? 50 + i : 49 }),
    );
    const status = seenByStatusOf({
      members: [member(ME, { lastReadSeq: 99 }), ...others],
      myUserId: ME,
      message: MESSAGE,
    });
    expect(status.seen).toHaveLength(7);
    expect(status.unseen).toHaveLength(2);
    expect(ids(status.unseen)).toEqual(["u7", "u8"]);
    expect(ids([...status.seen, ...status.unseen])).not.toContain(ME);
  });

  it("tôi CHƯA đọc tới tin của chính mình vẫn không lọt vào «Chưa xem»", () => {
    const status = seenByStatusOf({
      members: [member(ME, { lastReadSeq: 3 }), member("u1", { lastReadSeq: 50 })],
      myUserId: ME,
      message: MESSAGE,
    });
    expect(ids(status.unseen)).toEqual([]);
    expect(ids(status.seen)).toEqual(["u1"]);
  });

  it("người vào phòng SAU lúc gửi không nằm ở tab nào (kể cả khi con trỏ đọc đã vượt tin)", () => {
    const status = seenByStatusOf({
      members: [
        member("late-read", { joinedAt: AFTER, lastReadSeq: 80 }),
        member("late-unread", { joinedAt: AFTER, lastReadSeq: 0 }),
        member("u1", { lastReadSeq: 10 }),
      ],
      myUserId: ME,
      message: MESSAGE,
    });
    expect(ids(status.seen)).toEqual([]);
    expect(ids(status.unseen)).toEqual(["u1"]);
  });

  it("vào ĐÚNG thời điểm gửi ⇒ vẫn là người nhận (luật là `joinedAt > createdAt`, không phải ≥)", () => {
    const status = seenByStatusOf({
      members: [member("u1", { joinedAt: SENT_AT, lastReadSeq: 0 })],
      myUserId: ME,
      message: MESSAGE,
    });
    expect(ids(status.unseen)).toEqual(["u1"]);
  });

  it("`joinedAt` không đọc được ⇒ KHÔNG tự loại (thiếu dữ liệu không phải bằng chứng vào sau)", () => {
    const status = seenByStatusOf({
      members: [member("u1", { joinedAt: "", lastReadSeq: 50 })],
      myUserId: ME,
      message: MESSAGE,
    });
    expect(ids(status.seen)).toEqual(["u1"]);
  });

  it("người đã rời phòng (`leftAt`) không nằm ở tab nào", () => {
    const status = seenByStatusOf({
      members: [
        member("gone", { leftAt: AFTER, lastReadSeq: 0 }),
        member("gone-read", { leftAt: AFTER, lastReadSeq: 60 }),
      ],
      myUserId: ME,
      message: MESSAGE,
    });
    expect(status.seen).toEqual([]);
    expect(status.unseen).toEqual([]);
  });

  it("thiếu `lastReadSeq` ⇒ «Chưa xem»; đọc tới ĐÚNG `roomSeq` ⇒ «Đã xem»", () => {
    const noCursor = member("u1");
    delete (noCursor as { lastReadSeq?: number }).lastReadSeq;
    const status = seenByStatusOf({
      members: [noCursor, member("u2", { lastReadSeq: 50 })],
      myUserId: ME,
      message: MESSAGE,
    });
    expect(ids(status.unseen)).toEqual(["u1"]);
    expect(ids(status.seen)).toEqual(["u2"]);
  });

  it("người không có tên vẫn được ĐẾM (tên `null`), ảnh lấy từ roster", () => {
    const status = seenByStatusOf({
      members: [member("u1", { userName: null, lastReadSeq: 0 })],
      myUserId: ME,
      message: MESSAGE,
      avatarByUser: new Map([["u1", "https://r2.local/signed/u1.png"]]),
    });
    expect(status.unseen).toEqual([
      { userId: "u1", name: null, avatarUrl: "https://r2.local/signed/u1.png" },
    ]);
  });

  it("chưa biết tôi là ai (`myUserId` null) ⇒ rỗng cả hai, không đoán", () => {
    const status = seenByStatusOf({
      members: [member("u1", { lastReadSeq: 50 })],
      myUserId: null,
      message: MESSAGE,
    });
    expect(status).toEqual({ seen: [], unseen: [] });
  });
});

describe("rosterStatusOf · trạng thái nguồn `members`", () => {
  it.each([
    ["chưa có dữ liệu, chưa lỗi", { data: undefined, isError: false }, "loading"],
    ["có dữ liệu", { data: { members: [] }, isError: false }, "ready"],
    ["lỗi, chưa có dữ liệu", { data: undefined, isError: true }, "error"],
    [
      "lỗi khi làm tươi, còn dữ liệu CŨ (vd. 404 sau khi rời phòng)",
      { data: {}, isError: true },
      "error",
    ],
  ])("%s ⇒ %s", (_label, query, expected) => {
    expect(rosterStatusOf(query)).toBe(expected);
  });
});
