/**
 * S8-CHAT-UX-FE-2 — bốn thao tác của menu ngữ cảnh mỗi hội thoại (CHAT-API-024a/b · 025 · 020 · 006).
 *
 * ┌─ MỘT bộ mutation cho CẢ danh sách, không phải một bộ mỗi dòng ────────────────────────────────────┐
 * │ Hook này gắn ở `RoomListPanel` và nhận `roomId` qua tham số của `mutate`. Gắn trong `RoomRow` thì  │
 * │ 40 phòng = 160 `useMutation` sống song song, mỗi cái một cache entry — và trạng thái `isPending`   │
 * │ của dòng này không nói gì về dòng kia, nên UI vẫn phải tự theo dõi "dòng nào đang chạy" bằng tay.  │
 * └───────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ⚠️ **Payload dựng ở `onClick`, KHÔNG đọc state trong `mutationFn`** (memory
 * `react-query-v5-stale-mutationfn-closure`): `mutationFn` giữ closure của lần render TẠO RA nó, nên đọc
 * `roomsById` trong đó là đọc ảnh chụp cũ — sẽ hoàn nguyên về một giá trị đã lỗi thời.
 *
 * ⚠️ **KHÔNG có cổng quyền quanh ghim/tắt thông báo/đánh dấu chưa đọc.** Ba thứ đó là TUỲ CHỌN CÁ NHÂN;
 * server gate chúng bằng đúng cặp của đường đọc phòng (`view:chat-room`), và SPEC-15 §11 cảnh báo riêng
 * rằng gate mạnh hơn sẽ đẻ ra role "đọc được phòng mà không tắt được thông báo của chính mình"
 * (memory `personal-prefs-must-not-sit-behind-permission-gate`). Chỉ **Lưu trữ phòng** hỏi cặp quản trị,
 * và cổng đó nằm ở component (`archive:chat-room`), không ở đây.
 */
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ApiError, chatApi } from "@mediaos/web-core";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { ROOM_PIN_LIMIT, mutedUntilFrom, type MutePresetKey } from "./chat-room-prefs";

/** Ảnh chụp giá trị TRƯỚC — thứ duy nhất cho phép hoàn nguyên chính xác khi API lỗi. */
type PrefsSnapshot = Partial<Pick<ChatRoomDto, "pinnedAt" | "mutedUntil" | "markedUnreadAt">>;

interface PinVars {
  roomId: string;
  /** `true` = ghim, `false` = bỏ ghim. Quyết ở `onClick` theo trạng thái ĐANG THẤY, không đoán lại sau. */
  pin: boolean;
  before: PrefsSnapshot;
}

interface MuteVars {
  roomId: string;
  /** `null` = bật lại thông báo (hợp đồng `chatMuteRoomSchema`). */
  preset: MutePresetKey | null;
  before: PrefsSnapshot;
}

interface MarkUnreadVars {
  roomId: string;
  before: PrefsSnapshot;
}

export interface RoomPrefsActions {
  pin: (vars: PinVars) => void;
  mute: (vars: MuteVars) => void;
  markUnread: (vars: MarkUnreadVars) => void;
  archive: (vars: { roomId: string }) => void;
  /** Có thao tác nào đang chạy không — dùng để khoá mục menu, tránh bấm chồng. */
  isBusy: boolean;
}

export function useRoomPrefs(onError: (message: string) => void): RoomPrefsActions {
  const { t } = useTranslation("chat");
  const patchRoomPrefs = useChatStore((s) => s.patchRoomPrefs);
  const hydrateRooms = useChatStore((s) => s.hydrateRooms);

  /**
   * Thành công ⇒ thay phòng bằng NGUYÊN bản server trả, không giữ giá trị lạc quan.
   *
   * Cần thật, không phải cho gọn: `muteRoom` **chuẩn hoá mốc đã qua về `null`** ở server, nên giá trị
   * client vừa đoán có thể khác thứ được lưu. Giữ bản đoán là để UI nói dối cho tới lần tải lại sau.
   */
  const commit = (room: ChatRoomDto) => hydrateRooms([room]);

  const revert = (roomId: string, before: PrefsSnapshot, message: string) => {
    patchRoomPrefs(roomId, before);
    onError(message);
  };

  const pinMutation = useMutation({
    mutationFn: (vars: PinVars) =>
      vars.pin ? chatApi.pinRoom(vars.roomId) : chatApi.unpinRoom(vars.roomId),
    onMutate: (vars) =>
      // Lạc quan: mốc chỉ để mục "Đã ghim" nhận phòng NGAY. Trị thật do server trả ở `onSuccess`.
      patchRoomPrefs(vars.roomId, { pinnedAt: vars.pin ? new Date().toISOString() : null }),
    onSuccess: commit,
    onError: (err: unknown, vars) =>
      revert(
        vars.roomId,
        vars.before,
        // 409 = CHAT-ERR-021 (vượt trần ghim). Nuốt nó thành "không ghim được" là bỏ đúng phần người
        // dùng cần biết: họ phải bỏ ghim bớt, chứ không phải thử lại.
        err instanceof ApiError && err.status === 409
          ? t("rooms.menu.pinLimitReached", { count: ROOM_PIN_LIMIT })
          : t("rooms.menu.pinFailed"),
      ),
  });

  const muteMutation = useMutation({
    mutationFn: (vars: MuteVars) =>
      chatApi.muteRoom(vars.roomId, {
        mutedUntil: vars.preset === null ? null : mutedUntilFrom(vars.preset),
      }),
    onMutate: (vars) =>
      patchRoomPrefs(vars.roomId, {
        mutedUntil: vars.preset === null ? null : mutedUntilFrom(vars.preset),
      }),
    onSuccess: commit,
    onError: (_err: unknown, vars) => revert(vars.roomId, vars.before, t("rooms.menu.muteFailed")),
  });

  const markUnreadMutation = useMutation({
    mutationFn: (vars: MarkUnreadVars) => chatApi.markRoomUnread(vars.roomId),
    // ⚠️ CHỈ vá `markedUnreadAt`. KHÔNG cộng vào `unreadCount`: server cố ý không đổi badge (con trỏ
    // `last_read_seq` chỉ tiến — SPEC-15 §13.2), nên cộng ở client là một con số sẽ biến mất ở lần đồng
    // bộ kế tiếp mà không ai giải thích được.
    onMutate: (vars) => patchRoomPrefs(vars.roomId, { markedUnreadAt: new Date().toISOString() }),
    onSuccess: commit,
    onError: (_err: unknown, vars) =>
      revert(vars.roomId, vars.before, t("rooms.menu.markUnreadFailed")),
  });

  /**
   * Lưu trữ KHÔNG cập nhật lạc quan: nó chuyển phòng sang rổ khác (biến mất khỏi danh sách đang xem), và
   * đoán trước một thay đổi cả-rổ rồi phải hoàn nguyên là cảnh phòng nhấp nháy ra-vào danh sách. Chờ
   * server rồi mới đổi — thao tác này hiếm và có hộp xác nhận riêng ở `RoomInfoPanel`.
   */
  const archiveMutation = useMutation({
    mutationFn: (vars: { roomId: string }) => chatApi.archiveRoom(vars.roomId),
    onSuccess: commit,
    onError: () => onError(t("rooms.menu.archiveFailed")),
  });

  return {
    pin: pinMutation.mutate,
    mute: muteMutation.mutate,
    markUnread: markUnreadMutation.mutate,
    archive: archiveMutation.mutate,
    isBusy:
      pinMutation.isPending ||
      muteMutation.isPending ||
      markUnreadMutation.isPending ||
      archiveMutation.isPending,
  };
}
