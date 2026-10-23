/**
 * S20-CHAT-DRAFT-1 — luật thuần của store nháp (US-CHAT-NV-06). Tầng component: `MessageComposer.draft.spec.tsx`
 * và `ChatDrawer.spec.tsx`.
 *
 * Phép đo «không rơi xuống storage trình duyệt» CÀI MÁY GHI trước khi import store (`vi.hoisted`): một
 * `persist` hay IndexedDB khởi tạo ngay lúc tạo store sẽ ghi lúc IMPORT, trước mọi `beforeEach`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recorder = vi.hoisted(() => {
  const writes: string[] = [];
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function setItem(this: Storage, key: string, value: string): void {
    writes.push(`${key}=${value}`);
    originalSetItem.call(this, key, value);
  };
  // jsdom không có IndexedDB: cài một bản giả ghi lại mọi lần mở — không ai được mở cả.
  const idbOpen = vi.fn();
  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open: idbOpen,
    deleteDatabase: vi.fn(),
    databases: vi.fn(async () => []),
  };
  return { writes, idbOpen };
});

import { useAuthStore } from "@mediaos/web-core";
import type { StoredChatMessage } from "@/stores/chat.store";
import { EMPTY_CHAT_DRAFT, useChatDraftStore } from "./chat-draft.store";

const ROOM_A = "aaaaaaaa-1111-4111-8111-111111111111";
const LAN_ID = "00000003-1111-4111-8111-111111111113";
const REPLY_ID = "00000009-1111-4111-8111-111111111119";
const DRAFT_TEXT = "Anh xem giúp @Lan báo cáo";

const store = () => useChatDraftStore.getState();

function signIn(userId: string, companyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"): void {
  useAuthStore
    .getState()
    .setUser(
      { id: userId, companyId, email: "u@example.test", fullName: null, status: "active" },
      {},
    );
}

function replyTarget(): StoredChatMessage {
  return { id: REPLY_ID, senderName: "Trần B", body: "xin chào" } as unknown as StoredChatMessage;
}

function seedFullDraft(): string {
  store().setText(ROOM_A, DRAFT_TEXT);
  store().addMention(ROOM_A, { userId: LAN_ID, label: "@Lan" });
  store().setReplyTo(ROOM_A, replyTarget());
  return store().ensureClientMessageId(ROOM_A, () => "client-key-1");
}

beforeEach(() => {
  useAuthStore.getState().logout();
  store().resetChatDrafts();
});

describe("chat-draft.store · giữ nháp theo phòng", () => {
  it("giữ chữ + mention + tin đang trả lời + khoá idempotency của ĐÚNG phòng đó", () => {
    const key = seedFullDraft();

    const draft = store().drafts[ROOM_A];
    expect(draft.text).toBe(DRAFT_TEXT);
    expect(draft.mentions).toEqual([{ userId: LAN_ID, label: "@Lan" }]);
    expect(draft.replyTo?.id).toBe(REPLY_ID);
    expect(draft.clientMessageId).toBe(key);
    expect(store().drafts["phong-khac"]).toBeUndefined();
  });

  it("khoá idempotency cấp MỘT lần — gọi lại trả đúng khoá cũ, không gọi bộ sinh lần hai", () => {
    const create = vi.fn(() => "client-key-1");
    store().ensureClientMessageId(ROOM_A, create);
    expect(store().ensureClientMessageId(ROOM_A, create)).toBe("client-key-1");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("nháp về rỗng hoàn toàn ⇒ GỠ khoá phòng (không tích rác theo số phòng đã ghé)", () => {
    store().setText(ROOM_A, "x");
    store().setText(ROOM_A, "");
    expect(ROOM_A in store().drafts).toBe(false);
  });

  it("gửi thành công ⇒ xoá cả nháp; khoá KHÔNG khớp (nháp đã là tin khác) ⇒ giữ nguyên", () => {
    const key = seedFullDraft();

    store().clearSentDraft(ROOM_A, "khoa-cua-tin-khac");
    expect(store().drafts[ROOM_A].text).toBe(DRAFT_TEXT);

    store().clearSentDraft(ROOM_A, key);
    expect(store().drafts[ROOM_A]).toBeUndefined();
  });
});

describe("chat-draft.store · tệp chờ bị bỏ", () => {
  it("ghi số tệp bị bỏ khi epoch khớp; dọn được", () => {
    const epoch = store().sessionEpoch;
    store().noteFilesNotKept(ROOM_A, 2, epoch);
    expect(store().drafts[ROOM_A].droppedFileCount).toBe(2);

    store().clearFilesNotKept(ROOM_A);
    expect(store().drafts[ROOM_A]).toBeUndefined();
  });

  it("ô soạn dựng TRƯỚC lần reset (đăng xuất) tháo SAU đó ⇒ lần ghi trễ bị bỏ", () => {
    const epochAtMount = store().sessionEpoch;
    store().resetChatDrafts();

    store().noteFilesNotKept(ROOM_A, 1, epochAtMount);
    expect(store().drafts).toEqual({});
  });
});

describe("chat-draft.store · reset khi đổi phiên", () => {
  it("đăng xuất ⇒ store rỗng", () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    seedFullDraft();

    useAuthStore.getState().logout();
    expect(store().drafts).toEqual({});
  });

  it("đổi người TẠI CHỖ (setUser người khác, không qua logout) ⇒ store rỗng", () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    seedFullDraft();

    signIn("22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(store().drafts).toEqual({});
  });

  it("cùng người nhưng đổi CÔNG TY ⇒ store rỗng", () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    seedFullDraft();

    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(store().drafts).toEqual({});
  });

  it("ĐỐI CHỨNG: /me làm mới cùng người cùng công ty ⇒ GIỮ nháp", () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    seedFullDraft();

    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(store().drafts[ROOM_A].text).toBe(DRAFT_TEXT);
  });
});

describe("chat-draft.store · KHÔNG rơi xuống storage trình duyệt", () => {
  const SECRETS = [DRAFT_TEXT, "báo cáo", LAN_ID, REPLY_ID, "client-key-1"];

  function storageDump(storage: Storage): string {
    const parts: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i) ?? "";
      parts.push(`${key}=${storage.getItem(key) ?? ""}`);
    }
    return parts.join("\n");
  }

  it("không khoá nào trong localStorage/sessionStorage chứa nháp, mention hay replyToMessageId; IndexedDB không được mở", () => {
    signIn("11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    seedFullDraft();
    store().noteFilesNotKept(ROOM_A, 1, store().sessionEpoch);

    const everything = [
      storageDump(window.localStorage),
      storageDump(window.sessionStorage),
      ...recorder.writes,
    ].join("\n");
    for (const secret of SECRETS) expect(everything).not.toContain(secret);
    expect(recorder.idbOpen).not.toHaveBeenCalled();
    // ĐỐI CHỨNG cho phép đo: nháp THẬT SỰ có trong bộ nhớ — một store không giữ gì cũng qua vế trên.
    expect(store().drafts[ROOM_A]).not.toBe(EMPTY_CHAT_DRAFT);
    expect(store().drafts[ROOM_A].text).toBe(DRAFT_TEXT);
  });
});
