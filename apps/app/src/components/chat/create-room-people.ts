/**
 * S20-CHAT-NEWROOM-1 — logic THUẦN của `CreateRoomDialog` (US-CHAT-NV-12): «Gần đây» và tên nhóm gợi ý.
 *
 * Tách khỏi component để đo được từng luật mà không dựng cây React, và để file `.tsx` chỉ export
 * component (react-refresh).
 */
import type { ChatRoomDto } from "@mediaos/contracts";

/** Một người được chọn — đủ để gửi (`userId`) và để hiện/gợi ý tên (`fullName`). */
export interface PersonPick {
  userId: string;
  fullName: string;
}

/** Một chip «Gần đây» — `isActive=false` ⇒ chip khoá kèm lý do (server sẽ từ chối CHAT-ERR-003). */
export interface RecentPeer extends PersonPick {
  isActive: boolean;
}

/** Trần số chip «Gần đây» — dải chip là lối tắt, không phải danh bạ thứ hai. */
export const MAX_RECENT_PEERS = 12;

/** Khớp `createChatRoomSchema.name.max(200)` — tên gợi ý không bao giờ vượt trần của server. */
export const MAX_GROUP_NAME_LENGTH = 200;

/** Số tên hiện thẳng trong tên gợi ý; phần còn lại thành «+N». */
const SUGGESTED_NAMES_SHOWN = 3;

/**
 * «Gần đây» = người đối thoại (`peer`) của các phòng DM ĐÃ NẠP SẴN ở `chat.store`, theo thứ tự danh sách
 * phòng (mới nhắn lên trước).
 *
 * KHÔNG suy từ roster các phòng nhóm: roster chỉ có theo TỪNG phòng, dựng gợi ý từ đó là N lời gọi API
 * mỗi lần mở dialog. Peer thiếu tên bị bỏ — một chip không tên không chọn được một cách có ý thức.
 */
export function deriveRecentPeers(
  roomOrder: readonly string[],
  roomsById: Readonly<Record<string, ChatRoomDto>>,
  myUserId: string | null,
): RecentPeer[] {
  const seen = new Set<string>();
  const peers: RecentPeer[] = [];
  for (const roomId of roomOrder) {
    const room = roomsById[roomId];
    const peer = room?.roomType === "direct" && room.isArchived !== true ? room.peer : null;
    if (peer == null || peer.name == null || peer.name.trim().length === 0) continue;
    if (peer.userId === myUserId || seen.has(peer.userId)) continue;
    seen.add(peer.userId);
    peers.push({ userId: peer.userId, fullName: peer.name, isActive: peer.isActive });
    if (peers.length >= MAX_RECENT_PEERS) break;
  }
  return peers;
}

/** Tên gọi = từ CUỐI của họ tên tiếng Việt («Trần Thị Lan» ⇒ «Lan»). */
function givenName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

/**
 * Tên nhóm gợi ý khi người dùng CHƯA gõ: «Lan, Minh, Hà +1». Chuỗi rỗng khi chưa chọn ai — lúc đó ô tên
 * trống và bấm «Tạo nhóm» báo «Cần tên nhóm» như thường.
 */
export function suggestGroupName(people: readonly PersonPick[]): string {
  const names = people.map((p) => givenName(p.fullName)).filter((n) => n.length > 0);
  if (names.length === 0) return "";
  const shown = names.slice(0, SUGGESTED_NAMES_SHOWN);
  const rest = people.length - shown.length;
  const label = rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
  return label.slice(0, MAX_GROUP_NAME_LENGTH);
}
