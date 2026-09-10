/**
 * S8-CHAT-UX-FE-2 — ảnh đại diện của MỘT phòng trong danh sách (SPEC-15 §10 CHAT-FUNC-018).
 *
 * Bọc `Avatar` của `packages/ui` thay vì gọi thẳng, vì có đúng ba luật riêng của CHAT phải ở một chỗ:
 *
 *  1. **`avatarUrl` là URL ký TTL ngắn** (`ChatRoomAvatarPresignService`, CHAT-DEC-016/019) — render
 *     thẳng, **không** cache, không đưa vào `localStorage`, không tự dựng lại từ `fileId`. Giữ nó lâu hơn
 *     một lần render là dựng một đường tải sống lâu hơn quyết định quyền đã cấp ra nó.
 *  2. **Phòng `direct` luôn `room.avatarUrl === null`** — CHECK `chk_chat_rooms_direct_no_avatar`
 *     (mig `0543`) ép ở DB, không phải quy ước. Avatar DM là dẫn xuất từ NGƯỜI ĐỐI THOẠI.
 *  3. **S17-CHAT-UX2-FE-1 — ảnh peer đến từ `room.peer.avatarUrl`** (CHAT-DEC-023), ký MỘT lô cho cả
 *     danh sách qua `AvatarPresignService.resolveEmployeeAvatars`. Nợ ghi ở S8 («DM chỉ hiện chữ cái
 *     đầu») **trả ở đây** — và trả bằng đúng lô ký đã có, không mở đường ký thứ hai theo từng người.
 *
 * ⚠️ Chấm ONLINE chỉ có nghĩa ở phòng `direct`: `chat:presence` fan-out tới peer của DM, không tới
 * phòng nhóm (`wsChatPresenceEventSchema`). Caller quyết định truyền `isOnline` hay không — component
 * này không tự đoán, vì `presenceByUser` là state của store chứ không phải của phòng.
 */
import { useTranslation } from "react-i18next";
import { Avatar, cn } from "@mediaos/ui";
import type { ChatRoomDto } from "@mediaos/contracts";
import { roomAvatarTone } from "./chat-room-prefs";

interface RoomAvatarProps {
  room: ChatRoomDto;
  /** Nhãn ĐÃ dựng của phòng — nguồn của chữ cái đầu (phòng `direct` không có `name`). */
  label: string;
  size?: "sm" | "md" | "lg";
  /** `true` ⇒ vẽ chấm xanh góc dưới-phải. Chỉ truyền cho phòng `direct` (xem docblock đầu file). */
  isOnline?: boolean;
  className?: string;
}

export function RoomAvatar({
  room,
  label,
  size = "md",
  isOnline = false,
  className,
}: RoomAvatarProps): React.ReactElement {
  const { t } = useTranslation("chat");
  // Phòng `direct`: ảnh của người đối thoại. Loại khác: ảnh của chính phòng. KHÔNG `??` nối hai nguồn —
  // một phòng nhóm không bao giờ có `peer`, và một DM không bao giờ có `avatarUrl` (CHECK ở DB).
  const src = (room.roomType === "direct" ? room.peer?.avatarUrl : room.avatarUrl) ?? null;

  const avatar = (
    <Avatar
      name={label}
      src={src}
      size={size}
      data-testid="chat-room-avatar"
      // Màu theo id CHỈ áp khi không có ảnh: dưới một `<img>` phủ kín thì nền là màu vô nghĩa, và ghi đè
      // `bg-*` của `Avatar` lúc đó chỉ làm khó người đọc CSS sau này.
      className={cn(src === null && roomAvatarTone(room.id), isOnline ? undefined : className)}
    />
  );

  if (!isOnline) return avatar;

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {avatar}
      {/* `role="img"` + `aria-label` bắt buộc: một chấm màu thuần tuý CSS không tồn tại với trình đọc
          màn hình, và "đang online" là thông tin, không phải trang trí. `ring-background` để chấm tách
          khỏi ảnh ở CẢ light lẫn dark — không hard-code màu nền. */}
      <span
        role="img"
        aria-label={t("rooms.onlineAria")}
        data-testid="chat-room-online-dot"
        className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
      />
    </span>
  );
}
