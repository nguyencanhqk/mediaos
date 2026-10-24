/**
 * S20-CHAT-DEEPLINK-1 (US-CHAT-NV-02) — «Nhắn riêng» một chạm: `POST /chat/rooms/direct` rồi mở phòng
 * trả về trong khung đang đứng (`ChatRoomOpenerContext`).
 *
 * - Server đã idempotent: có DM cũ ⇒ trả lại phòng đó, không tạo trùng.
 * - Người nhận đã khoá/nghỉ và chưa có DM ⇒ server từ chối (CHAT-ERR-003) ⇒ thông báo dễ hiểu qua hệ
 *   thông báo chung, không mở gì; `isPending` tắt ⇒ nút bấm lại được (không treo).
 * - Phòng vừa nhận vào store TRƯỚC khi mở: trang chỉ mở phòng có trong danh sách phòng của tôi.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, chatApi, chatKeys } from "@mediaos/web-core";
import { toast } from "@mediaos/ui";
import { useChatStore } from "@/stores/chat.store";
import { useChatRoomOpener } from "./chat-room-opener";

const PEER_INVALID_CODE = "CHAT-ERR-003";
const OPEN_DIRECT_TOAST_KEY = "chat-open-direct";

/**
 * Đọc mã từ `message`, KHÔNG từ `ApiError.code`: CHAT ném `UnprocessableEntityException(CHAT_ERR.…)` với
 * chuỗi, nên `AllExceptionsFilter` đặt `code = httpStatusToCode(422)` (mã VALIDATION chung) — mã nghiệp vụ
 * chỉ nằm ở tiền tố `CHAT-ERR-003:` của thông điệp (quy ước `chat.errors.ts`). Hợp đồng được ghim hai
 * đầu: int-spec server đòi thân phản hồi DM chứa `CHAT-ERR-003`; spec FE dựng đúng hình 422 đó.
 */
function isPeerUnavailable(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 422 && error.message.includes(PEER_INVALID_CODE)
  );
}

export interface OpenDirectControls {
  openDirect: (peerUserId: string) => void;
  /** Người đang chờ server trả phòng — nút của đúng người đó tạm khoá. */
  pendingPeerId: string | null;
}

export function useOpenDirect(): OpenDirectControls {
  const { t } = useTranslation("chat");
  const openRoom = useChatRoomOpener();
  const hydrateRooms = useChatStore((s) => s.hydrateRooms);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (peerUserId: string) => chatApi.openDirect({ peerUserId }),
    onSuccess: (room) => {
      hydrateRooms([room]);
      // `POST /chat/rooms/direct` trả `peer: null` — xin lại danh sách thay vì bịa `peer` (xem ChatPage).
      void queryClient.invalidateQueries({ queryKey: chatKeys.rooms.list() });
      openRoom?.(room.id);
    },
    onError: (error: unknown) => {
      toast.error(isPeerUnavailable(error) ? t("direct.peerUnavailable") : t("direct.failed"), {
        key: OPEN_DIRECT_TOAST_KEY,
      });
    },
  });

  return {
    openDirect: (peerUserId) => {
      if (mutation.isPending) return;
      mutation.mutate(peerUserId);
    },
    pendingPeerId: mutation.isPending ? (mutation.variables ?? null) : null,
  };
}
