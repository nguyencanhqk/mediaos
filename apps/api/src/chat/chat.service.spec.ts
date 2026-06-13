import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChatService } from "./chat.service";
import type { ChatRepository } from "./chat.repository";
import type { RealtimeEmitterService } from "../realtime/realtime-emitter.service";

/**
 * G10-2 unit — ensureChannelRoom / ensureOrgUnitRoom: idempotent + best-effort.
 *
 * Mock ChatRepository (KHÔNG cần Postgres). Mục tiêu kiểm hành vi thuần service:
 *   1. Idempotent: findRoom* trả sẵn ⇒ KHÔNG createRoom lần 2.
 *   2. Tạo mới: createRoom → addMembers(creator + memberIds), dedupe.
 *   3. Best-effort: repo ném ⇒ catch, log, return null (KHÔNG throw lên caller — parity ensureProjectRoom).
 *   4. Race TOCTOU: createRoom onConflict trả [] ⇒ re-select findRoom* lấy phòng đối thủ.
 */
describe("ChatService — G10-2 auto-room (unit, mocked repo)", () => {
  let repo: {
    findRoomByChannel: ReturnType<typeof vi.fn>;
    findRoomByOrgUnit: ReturnType<typeof vi.fn>;
    createRoom: ReturnType<typeof vi.fn>;
    addMembers: ReturnType<typeof vi.fn>;
  };
  let service: ChatService;

  const existingRoom = { id: "room-existing", name: "Existing" };
  const newRoom = { id: "room-new", name: "New" };

  beforeEach(() => {
    repo = {
      findRoomByChannel: vi.fn(),
      findRoomByOrgUnit: vi.fn(),
      createRoom: vi.fn(),
      addMembers: vi.fn().mockResolvedValue([]),
    };
    const emitter = {} as unknown as RealtimeEmitterService;
    service = new ChatService(repo as unknown as ChatRepository, emitter);
  });

  // ─── ensureChannelRoom ───────────────────────────────────────────────────────

  it("ensureChannelRoom idempotent: findRoomByChannel trả sẵn ⇒ KHÔNG createRoom", async () => {
    repo.findRoomByChannel.mockResolvedValue([existingRoom]);

    const result = await service.ensureChannelRoom("co", "ch-1", "Channel", "creator", ["u1"]);

    expect(result).toBe(existingRoom);
    expect(repo.createRoom).not.toHaveBeenCalled();
    expect(repo.addMembers).not.toHaveBeenCalled();
  });

  it("ensureChannelRoom tạo mới: createRoom roomType=channel + addMembers(creator+members) dedupe", async () => {
    repo.findRoomByChannel.mockResolvedValue([]);
    repo.createRoom.mockResolvedValue([newRoom]);

    const result = await service.ensureChannelRoom("co", "ch-1", "Channel", "creator", [
      "u1",
      "creator", // trùng creator → phải dedupe
    ]);

    expect(result).toBe(newRoom);
    expect(repo.createRoom).toHaveBeenCalledWith("co", {
      name: "Channel",
      roomType: "channel",
      channelId: "ch-1",
      createdBy: "creator",
    });
    expect(repo.addMembers).toHaveBeenCalledWith("co", newRoom.id, ["creator", "u1", "creator"]);
  });

  it("ensureChannelRoom best-effort: repo ném ⇒ return null, KHÔNG throw", async () => {
    repo.findRoomByChannel.mockRejectedValue(new Error("db down"));

    await expect(
      service.ensureChannelRoom("co", "ch-1", "Channel", "creator", []),
    ).resolves.toBeNull();
  });

  it("ensureChannelRoom race TOCTOU: createRoom onConflict trả [] ⇒ re-select lấy phòng đối thủ", async () => {
    // lần 1 (check) rỗng → tạo; createRoom onConflict trả [] → lần 2 (re-select) thấy phòng race.
    repo.findRoomByChannel.mockResolvedValueOnce([]).mockResolvedValueOnce([existingRoom]);
    repo.createRoom.mockResolvedValue([]);

    const result = await service.ensureChannelRoom("co", "ch-1", "Channel", "creator", []);

    expect(result).toBe(existingRoom);
    expect(repo.addMembers).toHaveBeenCalledWith("co", existingRoom.id, ["creator"]);
  });

  // ─── ensureOrgUnitRoom ───────────────────────────────────────────────────────

  it("ensureOrgUnitRoom idempotent: findRoomByOrgUnit trả sẵn ⇒ KHÔNG createRoom", async () => {
    repo.findRoomByOrgUnit.mockResolvedValue([existingRoom]);

    const result = await service.ensureOrgUnitRoom("co", "ou-1", "Dept", ["head"]);

    expect(result).toBe(existingRoom);
    expect(repo.createRoom).not.toHaveBeenCalled();
  });

  it("ensureOrgUnitRoom tạo mới: createRoom roomType=department + addMembers(memberIds)", async () => {
    repo.findRoomByOrgUnit.mockResolvedValue([]);
    repo.createRoom.mockResolvedValue([newRoom]);

    const result = await service.ensureOrgUnitRoom("co", "ou-1", "Dept", ["head", "emp1"]);

    expect(result).toBe(newRoom);
    expect(repo.createRoom).toHaveBeenCalledWith("co", {
      name: "Dept",
      roomType: "department",
      orgUnitId: "ou-1",
    });
    expect(repo.addMembers).toHaveBeenCalledWith("co", newRoom.id, ["head", "emp1"]);
  });

  it("ensureOrgUnitRoom best-effort: repo ném ⇒ return null, KHÔNG throw", async () => {
    repo.findRoomByOrgUnit.mockRejectedValue(new Error("db down"));

    await expect(service.ensureOrgUnitRoom("co", "ou-1", "Dept", [])).resolves.toBeNull();
  });
});
