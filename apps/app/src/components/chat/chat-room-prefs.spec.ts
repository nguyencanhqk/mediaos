/**
 * S8-CHAT-UX-FE-2 — vị từ tuỳ chọn phòng. Ba ca ở đây đều là loại hỏng IM LẶNG:
 *  (a) `isRoomMuted` chỉ kiểm khác-null ⇒ chuông-gạch trên phòng đang gửi thông báo bình thường;
 *  (b) `isRoomUnreadLooking` chỉ nhìn badge ⇒ "đánh dấu chưa đọc" không để lại dấu vết nào;
 *  (c) `roomAvatarTone` không tất định ⇒ mỗi lần render một màu, mắt không neo được vào phòng nào.
 */
import { describe, expect, it } from "vitest";
import type { ChatRoomDto } from "@mediaos/contracts";
import {
  MUTE_PRESETS,
  ROOM_PIN_LIMIT,
  isRoomMarkedUnread,
  isRoomMuted,
  isRoomPinned,
  isRoomUnreadLooking,
  mutedUntilFrom,
  roomAvatarTone,
} from "./chat-room-prefs";

const NOW = Date.parse("2026-08-07T10:00:00.000Z");

function room(over: Partial<ChatRoomDto> = {}): ChatRoomDto {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    refId: null,
    roomType: "group",
    name: "Phòng A",
    roomCode: "CHAT-A",
    description: null,
    lastMessageAt: "2026-08-07T09:00:00.000Z",
    lastMessageSeq: 5,
    isArchived: false,
    unreadCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("isRoomPinned — ghim HỘI THOẠI (per-user)", () => {
  it("có mốc ⇒ ghim; null hoặc vắng khoá ⇒ không ghim", () => {
    expect(isRoomPinned(room({ pinnedAt: "2026-08-07T09:00:00.000Z" }))).toBe(true);
    expect(isRoomPinned(room({ pinnedAt: null }))).toBe(false);
    expect(isRoomPinned(room())).toBe(false); // server cũ: khoá vắng mặt
  });
});

describe("isRoomMuted — phải so với NOW, không chỉ khác null", () => {
  it("mốc còn ở tương lai ⇒ đang tắt", () => {
    expect(isRoomMuted(room({ mutedUntil: "2026-08-07T11:00:00.000Z" }), NOW)).toBe(true);
  });

  /**
   * Ca CHÍNH của test file này. Server chuẩn hoá mốc đã qua về `null` ở ĐƯỜNG GHI, nhưng một phòng nằm
   * trong store từ 09:00 với mốc 09:30 thì tới 10:00 giá trị cũ vẫn còn trong RAM — không có sự kiện nào
   * phát ra khi một mốc hết hạn.
   */
  it("mốc ĐÃ QUA trong lúc dữ liệu nằm trong cache ⇒ KHÔNG còn tắt", () => {
    expect(isRoomMuted(room({ mutedUntil: "2026-08-07T09:30:00.000Z" }), NOW)).toBe(false);
  });

  it("null / vắng khoá / mốc rác ⇒ không tắt (fail về phía CÓ thông báo)", () => {
    expect(isRoomMuted(room({ mutedUntil: null }), NOW)).toBe(false);
    expect(isRoomMuted(room(), NOW)).toBe(false);
    expect(isRoomMuted(room({ mutedUntil: "không-phải-ngày" }), NOW)).toBe(false);
  });
});

describe("đánh dấu chưa đọc — cột RIÊNG, không kéo theo badge", () => {
  it("markedUnreadAt làm dòng hiện ĐẬM dù unreadCount = 0", () => {
    const marked = room({ unreadCount: 0, markedUnreadAt: "2026-08-07T09:59:00.000Z" });

    expect(isRoomMarkedUnread(marked)).toBe(true);
    expect(isRoomUnreadLooking(marked)).toBe(true);
  });

  it("có badge nhưng không đánh dấu tay ⇒ vẫn đậm", () => {
    expect(isRoomUnreadLooking(room({ unreadCount: 3 }))).toBe(true);
  });

  it("không badge, không đánh dấu ⇒ không đậm", () => {
    expect(isRoomUnreadLooking(room({ unreadCount: 0, markedUnreadAt: null }))).toBe(false);
  });
});

describe("mutedUntilFrom — mốc của preset", () => {
  it("cộng đúng khoảng của từng preset tính từ `now`", () => {
    expect(mutedUntilFrom("1h", NOW)).toBe(new Date(NOW + 3_600_000).toISOString());
    expect(mutedUntilFrom("8h", NOW)).toBe(new Date(NOW + 8 * 3_600_000).toISOString());
    expect(mutedUntilFrom("1w", NOW)).toBe(new Date(NOW + 7 * 24 * 3_600_000).toISOString());
  });

  it("preset lạ ⇒ NÉM, không rơi về mốc mặc định (tắt nhầm khoảng là lỗi không truy được)", () => {
    expect(() => mutedUntilFrom("99h" as never, NOW)).toThrow();
  });

  it("mọi mốc sinh ra đều ở TƯƠNG LAI ⇒ server không chuẩn hoá về null", () => {
    for (const preset of MUTE_PRESETS) {
      expect(Date.parse(mutedUntilFrom(preset.key, NOW))).toBeGreaterThan(NOW);
    }
  });
});

describe("roomAvatarTone — màu tất định theo id", () => {
  it("cùng id ⇒ cùng màu (ổn định qua mọi phiên/thiết bị)", () => {
    const id = "11111111-1111-4111-8111-111111111111";

    expect(roomAvatarTone(id)).toBe(roomAvatarTone(id));
  });

  it("phân bố ra nhiều tông, không dồn hết vào một màu", () => {
    const tones = new Set(
      Array.from({ length: 40 }, (_, i) => roomAvatarTone(`room-${i}-uuid-like`)),
    );

    expect(tones.size).toBeGreaterThan(1);
  });

  it("chuỗi rỗng vẫn ra một class hợp lệ, không ném", () => {
    expect(roomAvatarTone("")).toMatch(/^bg-/);
  });
});

describe("ROOM_PIN_LIMIT", () => {
  it("khớp trần server ép cho CHAT-ERR-021 — số này đi thẳng vào thông điệp người dùng đọc", () => {
    expect(ROOM_PIN_LIMIT).toBe(10);
  });
});
