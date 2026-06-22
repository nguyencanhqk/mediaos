import { describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import { WS_EVENTS, type ChatMessageDto, type NotificationDto } from "@mediaos/contracts";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { chatRoomName, userRoomName } from "./rooms";

// CLEAN-DECOUPLE-1: gateway chat handlers đã gỡ, nhưng emitChatMessage GIỮ (ChatService consume tới
// khi cụm chat gỡ ở CLEAN-BE-1). Spec phủ cả emitChatMessage + emitNotification masking/routing.

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const ROOM = "11111111-1111-1111-1111-111111111111";
const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function baseMessage(seq: number): ChatMessageDto {
  return {
    id: "11111111-0000-0000-0000-000000000001",
    companyId: COMPANY,
    roomId: ROOM,
    senderId: USER,
    senderName: "Alice",
    body: "hello",
    messageType: "text",
    fileUrl: null,
    fileName: null,
    mentions: [],
    pinnedAt: null,
    pinnedBy: null,
    seq,
    createdAt: "2026-06-18T00:00:00.000Z",
  };
}

function baseNotification(): NotificationDto {
  return {
    id: "22222222-0000-0000-0000-000000000001",
    companyId: COMPANY,
    userId: USER,
    type: "mentioned",
    refId: null,
    refType: null,
    body: "you were mentioned",
    isRead: false,
    createdAt: "2026-06-18T00:00:00.000Z",
  };
}

/** A server whose `to(room)` returns a shared emit spy, recording the room each call targets. */
function makeServer() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { server: { to } as unknown as Server, to, emit };
}

describe("RealtimeEmitterService", () => {
  describe("emitChatMessage — masking + routing", () => {
    it("emits the parsed DTO to the company-scoped chat room", () => {
      const { server, to, emit } = makeServer();
      const svc = new RealtimeEmitterService();
      svc.setServer(server);

      svc.emitChatMessage(COMPANY, ROOM, baseMessage(1));

      expect(to).toHaveBeenCalledWith(chatRoomName(COMPANY, ROOM));
      expect(emit).toHaveBeenCalledWith(WS_EVENTS.CHAT_MESSAGE, baseMessage(1));
    });

    it("STRIPS unknown fields before emitting (masking layer — never leaks raw rows)", () => {
      const { server, emit } = makeServer();
      const svc = new RealtimeEmitterService();
      svc.setServer(server);

      const dirty = {
        ...baseMessage(1),
        internalSecret: "DO NOT LEAK",
        passwordHash: "$2b$...",
      } as unknown as ChatMessageDto;
      svc.emitChatMessage(COMPANY, ROOM, dirty);

      const payload = emit.mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty("internalSecret");
      expect(payload).not.toHaveProperty("passwordHash");
      expect(payload).toEqual(baseMessage(1));
    });

    it("preserves emit order across successive messages (ordering by seq)", () => {
      const { server, emit } = makeServer();
      const svc = new RealtimeEmitterService();
      svc.setServer(server);

      svc.emitChatMessage(COMPANY, ROOM, baseMessage(1));
      svc.emitChatMessage(COMPANY, ROOM, baseMessage(2));
      svc.emitChatMessage(COMPANY, ROOM, baseMessage(3));

      const seqs = emit.mock.calls.map((c) => (c[1] as ChatMessageDto).seq);
      expect(seqs).toEqual([1, 2, 3]);
    });

    it("no server wired (REALTIME_ENABLED=false / pre-init) → no-op, never throws", () => {
      const svc = new RealtimeEmitterService();
      expect(() => svc.emitChatMessage(COMPANY, ROOM, baseMessage(1))).not.toThrow();
    });

    it("invalid payload → swallowed (best-effort), no throw, no emit (does not break committed txn)", () => {
      const { server, emit } = makeServer();
      const svc = new RealtimeEmitterService();
      svc.setServer(server);

      const broken = { id: "not-a-uuid" } as unknown as ChatMessageDto;
      expect(() => svc.emitChatMessage(COMPANY, ROOM, broken)).not.toThrow();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe("emitNotification — masking + routing", () => {
    it("emits the parsed DTO to the user's own private room", () => {
      const { server, to, emit } = makeServer();
      const svc = new RealtimeEmitterService();
      svc.setServer(server);

      svc.emitNotification(COMPANY, USER, baseNotification());

      expect(to).toHaveBeenCalledWith(userRoomName(COMPANY, USER));
      expect(emit).toHaveBeenCalledWith(WS_EVENTS.NOTIFICATION_NEW, baseNotification());
    });

    it("strips unknown fields before emitting", () => {
      const { server, emit } = makeServer();
      const svc = new RealtimeEmitterService();
      svc.setServer(server);

      const dirty = { ...baseNotification(), secret: "leak" } as unknown as NotificationDto;
      svc.emitNotification(COMPANY, USER, dirty);

      expect(emit.mock.calls[0][1]).not.toHaveProperty("secret");
    });

    it("no server wired → no-op, never throws", () => {
      const svc = new RealtimeEmitterService();
      expect(() => svc.emitNotification(COMPANY, USER, baseNotification())).not.toThrow();
    });

    it("invalid payload → swallowed, no throw, no emit", () => {
      const { server, emit } = makeServer();
      const svc = new RealtimeEmitterService();
      svc.setServer(server);
      expect(() =>
        svc.emitNotification(COMPANY, USER, {} as unknown as NotificationDto),
      ).not.toThrow();
      expect(emit).not.toHaveBeenCalled();
    });
  });
});
