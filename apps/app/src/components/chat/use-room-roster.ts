/**
 * S8-CHAT-UX-FE-3 — **ROSTER** của phòng đang mở (CHAT-API-007a · CHAT-DEC-019).
 *
 * Đây là nguồn DUY NHẤT để khung chat vẽ avatar + tên người gửi. Vì sao không lấy từ chính tin nhắn:
 * `chatMessageSchema` chỉ mang `senderName`, và thêm `senderAvatarUrl` vào đó nghĩa là **ký URL cho mỗi
 * tin** — 50 tin = 50 lần ký + 50 hạn lệch nhau (`CHAT-DEC-019` chốt là không). Roster ký MỘT lô cho cả
 * phòng, FE tra theo `userId`.
 *
 * ⚠️ Roster GỒM CẢ người ĐÃ RỜI phòng (`leftAt !== null`) — đó là lý do nó tồn tại tách khỏi
 * `getRoom().members` (chỉ ACTIVE, dùng cho quản trị thành viên). Thiếu người đã rời thì mọi tin cũ của
 * họ mất cả avatar lẫn tên hiển thị.
 */
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { chatApi, chatKeys } from "@mediaos/web-core";
import type { ChatRoomMemberDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";

/**
 * URL trong roster là URL ký **TTL ngắn** (300 s ở `StorageAdapter`). `staleTime` phải NHỎ HƠN hạn đó,
 * nếu không react-query phục vụ lại một URL đã chết từ cache và người dùng thấy avatar vỡ hàng loạt mà
 * không có gì gợi ý vì sao. 2 phút để lại biên an toàn rộng.
 */
const ROSTER_STALE_MS = 2 * 60 * 1000;

export interface RoomRoster {
  /** Toàn bộ roster, GỒM cả người đã rời. */
  members: readonly ChatRoomMemberDto[];
  /** `userId → URL ảnh đã ký`. Vắng khoá / `null` ⇒ hiện chữ cái đầu. */
  avatarByUser: ReadonlyMap<string, string | null>;
  /**
   * `userId → tên hiển thị`. Dự phòng cho `message.senderName` — tin CŨ của một người đã rời vẫn có
   * `senderName` từ server, nhưng bản đồ này là đường duy nhất còn lại nếu join tên ở đường tin hụt.
   */
  nameByUser: ReadonlyMap<string, string>;
  /** Những người ĐANG ở trong phòng (`leftAt === null`) — dùng cho danh sách thành viên. */
  activeUserIds: ReadonlySet<string>;
  isLoading: boolean;
}

export function useRoomRoster(roomId: string | null): RoomRoster {
  const hydratePresence = useChatStore((s) => s.hydratePresence);

  const query = useQuery({
    queryKey: chatKeys.rooms.members(roomId ?? "none"),
    queryFn: () => chatApi.listMembers(roomId as string),
    enabled: roomId !== null,
    staleTime: ROSTER_STALE_MS,
    // Lấy lại tiêu điểm cửa sổ là lúc VỪA ĐÚNG để làm hai việc cùng lúc: làm tươi URL ký sắp hết hạn, và
    // làm mới ảnh chụp "đang online" (phòng không phải `direct` không nhận sự kiện presence — xem store).
    refetchOnWindowFocus: true,
  });

  const members = useMemo(() => query.data ?? [], [query.data]);

  /**
   * Đổ ảnh chụp presence vào store.
   *
   * Ở EFFECT chứ không trong `select`/thân render: `hydratePresence` ghi vào một store khác, và ghi state
   * trong lúc render là đúng thứ React gọi là side-effect trong pha render — nó chạy lại ở
   * `<StrictMode>`, và ở đây còn có thể tạo vòng render vô hạn.
   */
  useEffect(() => {
    if (members.length === 0) return;
    hydratePresence(members.map((m) => ({ userId: m.userId, isOnline: m.isOnline ?? false })));
  }, [members, hydratePresence]);

  return useMemo(() => {
    const avatarByUser = new Map<string, string | null>();
    const nameByUser = new Map<string, string>();
    const activeUserIds = new Set<string>();
    for (const m of members) {
      avatarByUser.set(m.userId, m.avatarUrl ?? null);
      if (m.userName) nameByUser.set(m.userId, m.userName);
      if (!m.leftAt) activeUserIds.add(m.userId);
    }
    return { members, avatarByUser, nameByUser, activeUserIds, isLoading: query.isLoading };
  }, [members, query.isLoading]);
}
