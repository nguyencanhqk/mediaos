/**
 * S20-CHAT-DRAFT-1 — nháp đang soạn theo TỪNG PHÒNG (US-CHAT-NV-06 · SPEC-15 §14).
 *
 * Ô soạn của phòng cũ luôn bị THÁO khi đổi phòng (`ChatPage` gắn `key` cho `ConversationPanel`, drawer
 * gắn `key={roomId}`), nên state cục bộ của `MessageComposer` mất sạch mỗi lần liếc sang phòng khác.
 * Store này giữ phần nháp cần sống qua lần tháo đó: chữ, bảng mention đã chèn, tin đang trả lời và khoá
 * idempotency. Dùng chung một store cho `/chat` lẫn drawer nên nháp đi theo khi bấm ⤢.
 *
 * BA BẤT BIẾN:
 *
 * 1. **CHỈ trong bộ nhớ** — KHÔNG `persist`, KHÔNG sessionStorage/localStorage/IndexedDB (S20 §3.2
 *    nguyên tắc 4). sessionStorage sống qua đăng xuất trong cùng tab: người đăng nhập sau sẽ đọc được.
 * 2. **Reset tường minh khi đổi người** — đăng xuất (`logout()` từ mọi đường: nút, idle, /me hỏng) hoặc
 *    đổi phiên tại chỗ (`setUser` với người/công ty khác). Móc vào `useAuthStore.subscribe` ở cuối file
 *    chứ không rải lời gọi reset ra từng nút đăng xuất: một đường đăng xuất mới sẽ không ai nhớ thêm.
 * 3. **Tệp chờ KHÔNG được giữ** — tệp đã upload chỉ sống cùng blob URL xem trước của ô soạn đã tháo.
 *    Store chỉ nhớ «có N tệp bị bỏ» để ô soạn cảnh báo khi người dùng quay lại.
 */
import { create } from "zustand";
import { useAuthStore } from "@mediaos/web-core";
import type { StoredChatMessage } from "@/stores/chat.store";
import type { MentionEntry } from "./use-mention-autocomplete";

export interface ChatDraft {
  readonly text: string;
  /** Bảng tra `label → userId` của những lượt chèn mention. Payload gửi đi vẫn SUY từ `text`. */
  readonly mentions: readonly MentionEntry[];
  /** Tin đang trả lời (ảnh chụp lúc bấm «Trả lời») — `id` của nó là `replyToMessageId` khi gửi. */
  readonly replyTo: StoredChatMessage | null;
  /** Khoá idempotency của nháp — giữ qua lần tháo để «gửi lại» sau khi đổi phòng không thành tin trùng. */
  readonly clientMessageId: string | null;
  /** Số tệp chờ bị bỏ khi ô soạn bị tháo. > 0 ⇒ ô soạn hiện cảnh báo nhẹ. */
  readonly droppedFileCount: number;
}

/** Hằng ĐÓNG BĂNG: selector trả object mới mỗi lần sẽ làm `useSyncExternalStore` render lặp vô hạn. */
export const EMPTY_CHAT_DRAFT: ChatDraft = Object.freeze({
  text: "",
  mentions: Object.freeze([]) as readonly MentionEntry[],
  replyTo: null,
  clientMessageId: null,
  droppedFileCount: 0,
});

interface ChatDraftState {
  drafts: Readonly<Record<string, ChatDraft>>;
  /** Tăng mỗi lần reset. Ghi trễ từ một ô soạn dựng TRƯỚC lần reset bị bỏ (xem `noteFilesNotKept`). */
  sessionEpoch: number;
  setText: (roomId: string, next: string | ((prev: string) => string)) => void;
  addMention: (roomId: string, entry: MentionEntry) => void;
  setReplyTo: (roomId: string, replyTo: StoredChatMessage | null) => void;
  /** Trả khoá hiện có, hoặc cấp MỘT lần bằng `create` khi nháp mới bắt đầu. */
  ensureClientMessageId: (roomId: string, create: () => string) => string;
  /**
   * Ô soạn bị tháo khi còn `count` tệp chờ. `epoch` = epoch lúc ô soạn dựng — lệch thì bỏ qua.
   * Trả `true` khi ĐÃ ghi (ô soạn dựa vào đó để cảnh báo ngay lúc rời — S20-CHAT-FEDEBT-1).
   */
  noteFilesNotKept: (roomId: string, count: number, epoch: number) => boolean;
  clearFilesNotKept: (roomId: string) => void;
  /** Server đã nhận ⇒ xoá nháp, NHƯNG chỉ khi nháp vẫn là nháp vừa gửi (cùng `clientMessageId`). */
  clearSentDraft: (roomId: string, clientMessageId: string) => void;
  resetChatDrafts: () => void;
}

function isEmptyDraft(d: ChatDraft): boolean {
  return (
    d.text === "" &&
    d.mentions.length === 0 &&
    d.replyTo === null &&
    d.clientMessageId === null &&
    d.droppedFileCount === 0
  );
}

/** Bản ghi mới (bất biến) với nháp của `roomId` đã đổi; nháp rỗng thì GỠ khoá luôn. */
function patchDraft(
  drafts: Readonly<Record<string, ChatDraft>>,
  roomId: string,
  update: (prev: ChatDraft) => ChatDraft,
): Readonly<Record<string, ChatDraft>> {
  const next = update(drafts[roomId] ?? EMPTY_CHAT_DRAFT);
  if (!isEmptyDraft(next)) return { ...drafts, [roomId]: next };
  if (!(roomId in drafts)) return drafts;
  const { [roomId]: _gone, ...rest } = drafts;
  return rest;
}

export const useChatDraftStore = create<ChatDraftState>((set, get) => ({
  drafts: {},
  sessionEpoch: 0,

  setText: (roomId, next) =>
    set((s) => ({
      drafts: patchDraft(s.drafts, roomId, (d) => ({
        ...d,
        text: typeof next === "function" ? next(d.text) : next,
      })),
    })),

  addMention: (roomId, entry) =>
    set((s) => ({
      drafts: patchDraft(s.drafts, roomId, (d) => ({ ...d, mentions: [...d.mentions, entry] })),
    })),

  setReplyTo: (roomId, replyTo) =>
    set((s) => ({ drafts: patchDraft(s.drafts, roomId, (d) => ({ ...d, replyTo })) })),

  ensureClientMessageId: (roomId, create) => {
    const existing = get().drafts[roomId]?.clientMessageId;
    if (existing) return existing;
    const clientMessageId = create();
    set((s) => ({ drafts: patchDraft(s.drafts, roomId, (d) => ({ ...d, clientMessageId })) }));
    return clientMessageId;
  },

  noteFilesNotKept: (roomId, count, epoch) => {
    // Ô soạn dựng trước lần reset (đăng xuất) rồi mới tháo sau đó: ghi vào là để lại dấu vết của phiên
    // trước cho người đăng nhập sau.
    if (epoch !== get().sessionEpoch || count <= 0) return false;
    set((s) => ({
      drafts: patchDraft(s.drafts, roomId, (d) => ({ ...d, droppedFileCount: count })),
    }));
    return true;
  },

  clearFilesNotKept: (roomId) =>
    set((s) => ({
      drafts: patchDraft(s.drafts, roomId, (d) => ({ ...d, droppedFileCount: 0 })),
    })),

  clearSentDraft: (roomId, clientMessageId) =>
    set((s) => {
      if (s.drafts[roomId]?.clientMessageId !== clientMessageId) return s;
      return { drafts: patchDraft(s.drafts, roomId, () => EMPTY_CHAT_DRAFT) };
    }),

  resetChatDrafts: () => set((s) => ({ drafts: {}, sessionEpoch: s.sessionEpoch + 1 })),
}));

/** Danh tính phiên: đổi người HOẶC đổi công ty đều là phiên khác. `null` = chưa/không đăng nhập. */
function sessionKeyOf(user: { id: string; companyId: string } | null): string | null {
  return user === null ? null : `${user.companyId}:${user.id}`;
}

// Bất biến 2 — chốt reset DUY NHẤT. `/me` làm mới cùng người (setUser lặp lại) KHÔNG đổi khoá ⇒ giữ nháp.
useAuthStore.subscribe((state, prev) => {
  if (sessionKeyOf(state.user) !== sessionKeyOf(prev.user)) {
    useChatDraftStore.getState().resetChatDrafts();
  }
});
