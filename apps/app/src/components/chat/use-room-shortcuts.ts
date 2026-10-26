/**
 * S20-CHAT-UNREADNAV-1 (US-CHAT-NV-13) — phím tắt chuyển phòng và nhảy sang phòng chưa đọc kế tiếp, cấp
 * `/chat` và drawer chat.
 *
 * ┌─ Tổ hợp phím — KHÔNG trùng thao tác soạn ───────────────────────────────────────────────────────────┐
 * │ Windows/Linux  Alt+↑ phòng trên · Alt+↓ phòng dưới · Alt+Shift+↓ phòng chưa đọc kế tiếp             │
 * │ macOS          ⌘⌥↑ · ⌘⌥↓ · ⌘⌥⇧↓ — KHÔNG Option+↑/↓: đó là phím di con trỏ về đầu/cuối đoạn trong ô  │
 * │                soạn, bắt nó là cướp thao tác soạn của người dùng Mac.                                │
 * │ KHÔNG Ctrl/⌘+K: phím tắt toàn cục của App Switcher (docblock phím tắt ở `ConversationPanel`).       │
 * └─────────────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Phím của ta ⇒ `preventDefault` NGAY (kể cả khi không có phòng đích): ô soạn có chữ không bị chèn ký tự,
 * con trỏ không di. Nháp phòng cũ giữ nguyên vì nó sống ở `chat-draft.store` (S20-CHAT-DRAFT-1), không ở
 * ô soạn bị tháo. Lớp nổi đang mở (popover @/emoji — `data-floating-layer="open"`) hoặc dialog modal NẰM
 * NGOÀI vùng của ta (hộp tạo phòng, bảng thông tin dạng Sheet, chính bảng gợi ý phím) ⇒ phím thuộc về
 * chúng, ta không đụng. Drawer là một Sheet modal CHỨA vùng của ta nên không tính.
 *
 * Đích luôn lấy từ danh sách ĐANG HIỂN THỊ (rổ → chip → ô tìm, cùng `selectVisibleRooms` của
 * `RoomListPanel`, «Tất cả» theo thứ tự mục): phòng bị lọc ẩn không bao giờ là đích.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { ChatRoomDto } from "@mediaos/contracts";
import { useChatStore } from "@/stores/chat.store";
import { isRoomUnreadLooking } from "./chat-room-prefs";
import {
  chipUsesSections,
  effectiveRoomChip,
  roomsSupportMentionCount,
  selectVisibleRooms,
  type RoomFilterChip,
} from "./room-list-filter";
import { buildRoomSections } from "./room-list-sections";

export type ShortcutPlatform = "mac" | "other";
export type RoomShortcutAction = "prev" | "next" | "nextUnread";

/** Phần tối thiểu của `navigator` mà phép phát hiện cần — để test truyền vào, không giả cả `window`. */
export interface NavigatorLike {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
}

const APPLE_PLATFORM = /mac|iphone|ipad|ipod/i;

/** macOS/iPadOS ⇒ `mac`; còn lại (Windows, Linux, không rõ) ⇒ `other`. */
export function detectShortcutPlatform(nav: NavigatorLike | undefined): ShortcutPlatform {
  if (nav === undefined) return "other";
  const hint = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return APPLE_PLATFORM.test(hint) ? "mac" : "other";
}

type KeyLike = Pick<KeyboardEvent, "key" | "altKey" | "metaKey" | "ctrlKey" | "shiftKey">;

/** Tổ hợp của ta ⇒ hành động; mọi phím khác ⇒ `null` (để ô soạn / trình duyệt xử lý như thường). */
export function matchRoomShortcut(
  e: KeyLike,
  platform: ShortcutPlatform,
): RoomShortcutAction | null {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return null;
  if (!e.altKey || e.ctrlKey) return null;
  if (platform === "mac" ? !e.metaKey : e.metaKey) return null;
  if (e.key === "ArrowUp") return e.shiftKey ? null : "prev";
  return e.shiftKey ? "nextUnread" : "next";
}

/**
 * Phòng đích trong `order` (thứ tự đang hiển thị).
 *
 * - `prev`/`next`: liền kề, KHÔNG vòng (ở mép ⇒ `null`). Chưa chọn phòng (hoặc phòng đang mở bị lọc ẩn)
 *   ⇒ `next` = phòng đầu, `prev` = phòng cuối.
 * - `nextUnread`: phòng trông-chưa-đọc đầu tiên SAU phòng hiện tại, vòng về đầu, bỏ qua chính nó (phòng
 *   đang mở chưa kịp báo đọc vẫn là chỗ người dùng đang đứng). Không còn ⇒ `null` («Đã đọc hết»).
 */
export function roomShortcutTarget(
  order: readonly ChatRoomDto[],
  currentRoomId: string | null,
  action: RoomShortcutAction,
): string | null {
  if (order.length === 0) return null;
  const at = currentRoomId === null ? -1 : order.findIndex((r) => r.id === currentRoomId);
  if (action === "next") return at === -1 ? order[0].id : (order[at + 1]?.id ?? null);
  if (action === "prev")
    return at === -1 ? order[order.length - 1].id : (order[at - 1]?.id ?? null);
  for (let step = 1; step <= order.length; step += 1) {
    const candidate = order[(at + step) % order.length];
    if (candidate.id !== currentRoomId && isRoomUnreadLooking(candidate)) return candidate.id;
  }
  return null;
}

/** Danh sách phòng theo đúng thứ tự người dùng đang THẤY (cùng luật với `RoomListPanel`). */
export function useRoomNavOrder(
  chip: RoomFilterChip,
  query: string,
  labelOf: (room: ChatRoomDto) => string,
): ChatRoomDto[] {
  const roomOrder = useChatStore((s) => s.roomOrder);
  const roomsById = useChatStore((s) => s.roomsById);
  return useMemo(() => {
    const effective = effectiveRoomChip(chip, roomsSupportMentionCount(Object.values(roomsById)));
    const visible = selectVisibleRooms({ roomOrder, roomsById, chip: effective, query, labelOf });
    return chipUsesSections(effective)
      ? buildRoomSections(visible).flatMap((section) => section.rooms)
      : visible;
  }, [chip, labelOf, query, roomOrder, roomsById]);
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || EDITABLE_TAGS.has(target.tagName);
}

/** Lớp nổi đang mở, hoặc dialog modal không chứa vùng của ta ⇒ phím thuộc về chúng. */
function isClaimedByLayer(host: HTMLElement | null): boolean {
  if (document.querySelector('[data-floating-layer="open"]') !== null) return true;
  const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
  return Array.from(dialogs).some((dialog) => host === null || !dialog.contains(host));
}

export interface UseRoomShortcutsOptions {
  /** Thứ tự đang hiển thị (`useRoomNavOrder`). */
  order: readonly ChatRoomDto[];
  currentRoomId: string | null;
  platform: ShortcutPlatform;
  /** Nút neo NẰM TRONG vùng của ta (vùng `aria-live`) — để phân biệt dialog bao ngoài với dialog chồng lên. */
  hostRef: RefObject<HTMLElement | null>;
  onOpenRoom: (room: ChatRoomDto) => void;
  /** Hết phòng chưa đọc (lần nhấn «chưa đọc kế tiếp» không còn đích). */
  onAllRead: () => void;
  onOpenHelp: () => void;
}

/** Gắn MỘT listener `keydown` trên `document`. Giá trị mới nhất đọc qua ref — không gỡ/gắn lại mỗi render. */
export function useRoomShortcuts(options: UseRoomShortcutsOptions): void {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return;
      const opts = latest.current;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (isEditableTarget(e.target) || isClaimedByLayer(opts.hostRef.current)) return;
        e.preventDefault();
        opts.onOpenHelp();
        return;
      }
      const action = matchRoomShortcut(e, opts.platform);
      if (action === null || isClaimedByLayer(opts.hostRef.current)) return;
      e.preventDefault();
      const targetId = roomShortcutTarget(opts.order, opts.currentRoomId, action);
      const target = targetId === null ? undefined : opts.order.find((r) => r.id === targetId);
      if (target !== undefined) opts.onOpenRoom(target);
      else if (action === "nextUnread") opts.onAllRead();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
}

/** Nền tảng của trình duyệt đang chạy — đọc MỘT lần. */
export function useShortcutPlatform(override?: ShortcutPlatform): ShortcutPlatform {
  const [detected] = useState<ShortcutPlatform>(() =>
    detectShortcutPlatform(typeof navigator === "undefined" ? undefined : navigator),
  );
  return override ?? detected;
}

/** Thông điệp `aria-live` — đổi chuỗi mỗi lần để cùng một câu (mở lại cùng phòng) vẫn được đọc lại. */
export function useLiveAnnouncement(): { message: string; announce: (text: string) => void } {
  const [message, setMessage] = useState("");
  const toggle = useRef(false);
  const announce = useCallback((text: string) => {
    toggle.current = !toggle.current;
    // Thêm/bớt một khoảng trắng không ngắt ⇒ chuỗi khác ⇒ vùng live đọc lại, chữ hiển thị như nhau.
    setMessage(toggle.current ? text : `${text}\u00a0`);
  }, []);
  return { message, announce };
}
