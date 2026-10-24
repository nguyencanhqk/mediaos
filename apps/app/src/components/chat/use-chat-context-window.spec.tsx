/**
 * S20-CHAT-FEDEBT-1 — luật của cửa sổ ngữ cảnh quanh một tin (`useChatContextWindow`).
 *
 * Việc hai nơi gọi (trang · thanh tin ghim) cùng đi qua hook này đo ở `use-chat-context-window.wiring.spec.tsx`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ChatMessageDto } from "@mediaos/contracts";

const getMessages = vi.fn();
vi.mock("@mediaos/web-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mediaos/web-core")>();
  return {
    ...actual,
    chatApi: { ...actual.chatApi, getMessages: (...a: unknown[]) => getMessages(...a) },
  };
});

import { CONTEXT_AFTER, CONTEXT_BEFORE } from "@/routes/chat/constants";
import { useChatStore } from "@/stores/chat.store";
import { useChatContextWindow } from "./use-chat-context-window";

const ROOM = "11111111-1111-4111-8111-111111111111";

function msg(seq: number): ChatMessageDto {
  return {
    id: `0000${String(seq).padStart(4, "0")}-1111-4111-8111-111111111111`,
    companyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    roomId: ROOM,
    senderId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    senderName: "Bình",
    body: `tin ${seq}`,
    messageType: "text",
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    replyToMessageId: null,
    recalledAt: null,
    attachmentCount: 0,
    attachments: [],
    roomSeq: seq,
    createdAt: "2026-10-23T07:00:00.000Z",
  };
}

function open(messageId: string, seq: number): Promise<boolean> {
  const { result } = renderHook(() => useChatContextWindow());
  let outcome: Promise<boolean> = Promise.resolve(false);
  act(() => {
    outcome = result.current(ROOM, messageId, seq);
  });
  return outcome;
}

beforeEach(() => {
  getMessages.mockReset();
  useChatStore.getState().resetChatStore();
});

describe("useChatContextWindow", () => {
  it("ĐÚNG hai lời gọi: beforeSeq = seq + 1 (gồm tin đích) · afterSeq = seq", async () => {
    getMessages.mockImplementation(async (_room: string, q: { beforeSeq?: number }) =>
      q.beforeSeq !== undefined ? [msg(41), msg(42)] : [msg(43)],
    );

    await expect(open(msg(42).id, 42)).resolves.toBe(true);

    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(getMessages).toHaveBeenCalledWith(ROOM, { beforeSeq: 43, limit: CONTEXT_BEFORE });
    expect(getMessages).toHaveBeenCalledWith(ROOM, { afterSeq: 42, limit: CONTEXT_AFTER });
    const state = useChatStore.getState();
    expect(state.contextByRoom[ROOM]).toBeDefined();
    expect(state.messagesByRoom[ROOM]?.map((m) => m.roomSeq)).toEqual([41, 42, 43]);
  });

  it("tin đích VẮNG khỏi cửa sổ ⇒ `false`, KHÔNG vào chế độ ngữ cảnh", async () => {
    getMessages.mockResolvedValue([msg(41)]);

    await expect(open(msg(42).id, 42)).resolves.toBe(false);

    expect(useChatStore.getState().contextByRoom[ROOM]).toBeUndefined();
  });

  it("lời gọi lỗi ⇒ `false` (không ném), không vào chế độ ngữ cảnh", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getMessages.mockRejectedValue(new Error("mạng chập"));

    await expect(open(msg(42).id, 42)).resolves.toBe(false);

    expect(useChatStore.getState().contextByRoom[ROOM]).toBeUndefined();
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
