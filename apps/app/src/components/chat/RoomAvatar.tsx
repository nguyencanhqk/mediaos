/**
 * S8-CHAT-UX-FE-2 — ảnh đại diện của MỘT phòng trong danh sách (SPEC-15 §10 CHAT-FUNC-018).
 *
 * Bọc `Avatar` của `packages/ui` thay vì gọi thẳng, vì có đúng hai luật riêng của CHAT phải ở một chỗ:
 *
 *  1. **`avatarUrl` là URL ký TTL ngắn** (`ChatRoomAvatarPresignService`, CHAT-DEC-016/019) — render
 *     thẳng, **không** cache, không đưa vào `localStorage`, không tự dựng lại từ `fileId`. Giữ nó lâu hơn
 *     một lần render là dựng một đường tải sống lâu hơn quyết định quyền đã cấp ra nó.
 *  2. **Phòng `direct` luôn `avatarUrl === null`** — CHECK `chk_chat_rooms_direct_no_avatar` (mig `0543`)
 *     ép ở DB, không phải quy ước. Avatar DM là dẫn xuất từ người đối thoại.
 *
 * ⚠️ **NỢ ĐÃ BIẾT — ảnh THẬT của người đối thoại (phòng `direct`) chưa lấy được.** `chatRoomMemberSchema`
 * không có `avatarUrl` và `GET /chat/rooms` không kèm `members`, nên hôm nay DM hiện chữ cái đầu của tên
 * đã dựng. Nguồn đúng là **roster phòng** (CHAT-DEC-019 — ký MỘT lần cho cả phòng), thứ `S8-CHAT-UX-FE-3`
 * mới dựng. Ở đây CỐ Ý không mở một đường ký thứ hai (ký lẻ theo từng người trong danh sách = N lần ký,
 * N hạn lệch nhau) chỉ để lấp chỗ trống đó sớm hơn một WO.
 */
import { Avatar, cn } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { roomAvatarTone } from "./chat-room-prefs";

interface RoomAvatarProps {
  room: ChatRoomDto;
  /** Nhãn ĐÃ dựng của phòng — nguồn của chữ cái đầu (phòng `direct` không có `name`). */
  label: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function RoomAvatar({
  room,
  label,
  size = "md",
  className,
}: RoomAvatarProps): React.ReactElement {
  const src = room.avatarUrl ?? null;
  return (
    <Avatar
      name={label}
      src={src}
      size={size}
      data-testid="chat-room-avatar"
      // Màu theo id CHỈ áp khi không có ảnh: dưới một `<img>` phủ kín thì nền là màu vô nghĩa, và ghi đè
      // `bg-*` của `Avatar` lúc đó chỉ làm khó người đọc CSS sau này.
      className={cn(src === null && roomAvatarTone(room.id), className)}
    />
  );
}
