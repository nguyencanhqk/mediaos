import { describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import { WS_EVENTS, type NotificationDto } from "@mediaos/contracts";
import { RealtimeEmitterService } from "./realtime-emitter.service";
import { userRoomName } from "./rooms";

// CLEAN-BE-1 (de-media-fy): emitChatMessage đã gỡ cùng cụm chat. Spec phủ đường NOTI còn lại:
// emitNotification masking + routing tới user-room.

const COMPANY = "c0000000-0000-0000-0000-00000000000a";
const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

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
