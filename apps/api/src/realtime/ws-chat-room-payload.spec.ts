import { describe, expect, it } from "vitest";
import { chatRoomSchema, wsChatRoomEventSchema } from "@mediaos/contracts";

/**
 * S8-CHAT-UX-BE-2 — payload `chat:room` phải HẸP HƠN DTO REST (memory `ws-payload-narrower-than-rest-dto`).
 *
 * ┌─ VÌ SAO CÓ FILE NÀY ──────────────────────────────────────────────────────────────────────────┐
 * │ `wsChatRoomEventSchema` strip `unreadCount` từ wave S7 vì nó PER-MEMBER — nhưng chưa có ca nào  │
 * │ CANH danh sách strip. `S8-CHAT-UX-BE-1` thêm ba cột per-member nữa (`pinnedAt`/`mutedUntil`/    │
 * │ `markedUnreadAt`) vào `chatRoomSchema` và **quên** thêm vào `.omit()` ⇒ mỗi lần quản trị viên   │
 * │ đổi tên/lưu trữ phòng, cả phòng nhận trạng thái ghim-và-tắt-thông-báo CỦA RIÊNG người đó.       │
 * │ Rò đó ship thật ở #360 và sống được vì KHÔNG có test nào so hai schema với nhau.                 │
 * │                                                                                                 │
 * │ Ca dưới không kiểm "có đúng 4 khoá bị bỏ" (một danh sách chép tay sẽ trôi y như cái nó canh) mà  │
 * │ kiểm **BẤT BIẾN**: mọi khoá PER-USER đã biết đều KHÔNG được có mặt trong payload broadcast.      │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────┘
 */

/** Khoá chỉ đúng với MỘT người — phát cho cả phòng là rò trạng thái riêng của actor. */
const PER_USER_KEYS = ["unreadCount", "pinnedAt", "mutedUntil", "markedUnreadAt"] as const;

/** Khoá có vòng đời NGẮN HƠN sự kiện mang nó (URL ký TTL ngắn) — client cache lại sẽ hỏng. */
const EPHEMERAL_KEYS = ["avatarUrl"] as const;

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const COMPANY_ID = "c0000000-0000-4000-8000-00000000000a";

function fullRoomDto(): Record<string, unknown> {
  return {
    id: ROOM_ID,
    companyId: COMPANY_ID,
    refId: null,
    roomType: "group",
    name: "Phòng A",
    roomCode: "ROOM-0001",
    description: null,
    lastMessageAt: null,
    lastMessageSeq: 7,
    isArchived: false,
    unreadCount: 5,
    createdAt: new Date(0).toISOString(),
    pinnedAt: new Date(0).toISOString(),
    mutedUntil: new Date(0).toISOString(),
    markedUnreadAt: new Date(0).toISOString(),
    avatarUrl: "https://storage.example/signed?exp=123",
  };
}

describe("chat:room — payload broadcast HẸP HƠN DTO REST", () => {
  it("ĐỐI CHỨNG: DTO đầu vào là DTO REST HỢP LỆ và CÓ ĐỦ các khoá nhạy cảm", () => {
    // Không có ca này thì một fixture gõ sai tên khoá sẽ làm mọi assert dưới xanh vì lý do SAI.
    const parsedRest = chatRoomSchema.parse(fullRoomDto());
    for (const k of [...PER_USER_KEYS, ...EPHEMERAL_KEYS]) {
      expect(Object.keys(parsedRest), `DTO REST thiếu khoá ${k} — fixture đã trôi`).toContain(k);
    }
  });

  it("mọi khoá PER-USER bị strip khỏi payload — không rò trạng thái của actor cho cả phòng", () => {
    const parsed = wsChatRoomEventSchema.parse({
      roomId: ROOM_ID,
      action: "updated",
      room: fullRoomDto(),
    });

    const leaked = PER_USER_KEYS.filter((k) => k in (parsed.room ?? {}));
    expect(
      leaked,
      "khoá per-user lọt vào payload chat:room — cả phòng sẽ nhận trạng thái riêng của người vừa thao tác",
    ).toEqual([]);
  });

  it("khoá vòng-đời-ngắn (URL ký) bị strip — client không cache một đường tải sắp hết hạn", () => {
    const parsed = wsChatRoomEventSchema.parse({
      roomId: ROOM_ID,
      action: "updated",
      room: fullRoomDto(),
    });

    const leaked = EPHEMERAL_KEYS.filter((k) => k in (parsed.room ?? {}));
    expect(leaked, "URL ký TTL ngắn không được đi qua sự kiện WS").toEqual([]);
  });

  it("phần siêu dữ liệu DÙNG CHUNG vẫn còn — strip không được cắt nhầm sang dữ liệu phòng", () => {
    const parsed = wsChatRoomEventSchema.parse({
      roomId: ROOM_ID,
      action: "updated",
      room: fullRoomDto(),
    });

    expect(parsed.room?.id).toBe(ROOM_ID);
    expect(parsed.room?.name).toBe("Phòng A");
    expect(parsed.room?.isArchived).toBe(false);
    expect(parsed.room?.lastMessageSeq).toBe(7);
  });

  it("BẤT BIẾN CHỐNG TRÔI: khoá MỚI thêm vào chatRoomSchema phải được xét lại ở đây", () => {
    // Chốt chặn cuối. Thêm một cột per-user thứ năm vào `chatRoomSchema` mà quên `.omit()` sẽ làm ca
    // này ĐỎ kèm đúng tên khoá — thay vì lặng lẽ phát nó cho cả phòng như đã xảy ra với ba cột của BE-1.
    const restKeys = Object.keys(chatRoomSchema.shape).sort();
    const wsKeys = Object.keys(
      (wsChatRoomEventSchema.shape.room as unknown as { unwrap: () => { shape: object } }).unwrap()
        .shape,
    ).sort();
    const stripped = restKeys.filter((k) => !wsKeys.includes(k)).sort();

    expect(
      stripped,
      "danh sách khoá bị strip đã đổi — nếu là khoá MỚI thì phải quyết định nó per-user hay dùng chung, rồi cập nhật cả hằng trong file này",
    ).toEqual([...PER_USER_KEYS, ...EPHEMERAL_KEYS].sort());
  });
});
