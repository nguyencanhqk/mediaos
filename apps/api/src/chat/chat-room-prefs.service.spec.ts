// `reflect-metadata` PHẢI nạp TRƯỚC mọi import có decorator: ratchet cuối file đọc `design:paramtypes`,
// và không có polyfill này thì `Reflect.getMetadata` không tồn tại ⇒ ratchet mù (ca fail-closed bắt).
import "reflect-metadata";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHAT_ROOM_PIN_MAX, ChatRoomPrefsService } from "./chat-room-prefs.service";
import type { ChatAccessService } from "./chat-access.service";
import type { ChatRoomsRepository } from "./chat-rooms.repository";
import type { DatabaseService } from "../db/db.service";
import { CHAT_ERR } from "./chat.errors";

/**
 * S8-CHAT-UX-BE-1 — ghim (CHAT-API-024a/b) · tắt thông báo (025) · đánh dấu chưa đọc (020).
 *
 * Bốn bất biến đóng đinh ở đây:
 *   1. membership là cổng ⇒ **404**, không 403 (CHAT-ERR-001 — 403 xác nhận phòng có thật);
 *   2. trần 10 ghim **có khoá advisory TRƯỚC khi đếm** — thứ tự đó là toàn bộ nội dung của luật;
 *   3. đánh dấu chưa đọc **KHÔNG** chạm `last_read_seq` (SPEC-15 §13.2);
 *   4. **0 audit · 0 emit WS** — service không được inject `AuditService`/`RealtimeEmitterService`,
 *      nên vi phạm là lỗi biên dịch chứ không phải một ca test có thể quên.
 */

const CO = "11111111-1111-4111-8111-111111111111";
const ROOM = "33333333-3333-4333-8333-333333333333";
const USER = "22222222-2222-4222-8222-222222222222";
const MEMBER_ROW = "44444444-4444-4444-8444-444444444444";
const ACTOR = { id: USER, companyId: CO };

interface Prefs {
  pinnedAt: Date | null;
  mutedUntil: Date | null;
  markedUnreadAt: Date | null;
}

function makeService(prefs: Partial<Prefs> = {}) {
  const calls: string[] = [];

  const assertMember = vi.fn(async () => ({
    room: {
      id: ROOM,
      companyId: CO,
      refId: null,
      roomType: "group",
      name: "Phòng thử",
      roomCode: "CH-0001",
      description: null,
      isArchived: false,
      lastMessageAt: null,
      lastMessageSeq: 7,
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
    },
    membership: {
      id: MEMBER_ROW,
      userId: USER,
      role: "member",
      lastReadSeq: 5,
      visibleFromSeq: null,
      joinedAt: new Date("2026-08-01T00:00:00.000Z"),
      pinnedAt: prefs.pinnedAt ?? null,
      mutedUntil: prefs.mutedUntil ?? null,
      markedUnreadAt: prefs.markedUnreadAt ?? null,
    },
  }));
  const access = { assertMember } as unknown as ChatAccessService;

  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  } as unknown as DatabaseService;

  const lockUserPrefs = vi.fn(async () => {
    calls.push("lock");
  });
  const countPinnedRooms = vi.fn(async () => {
    calls.push("count");
    return 0;
  });
  const setRoomPinned = vi.fn(async (_t: unknown, _c: string, _m: string, v: Date | null) => v);
  const setRoomMuted = vi.fn(async (_t: unknown, _c: string, _m: string, v: Date | null) => v);
  const setRoomMarkedUnread = vi.fn(
    async (_t: unknown, _c: string, _m: string, v: Date | null) => v,
  );
  const repo = {
    lockUserPrefs,
    countPinnedRooms,
    setRoomPinned,
    setRoomMuted,
    setRoomMarkedUnread,
  } as unknown as ChatRoomsRepository;

  // S8-CHAT-UX-BE-2 — `ChatRoomAvatarPresignService`. Map RỖNG ⇒ `avatarUrl: null` trong DTO, đúng
  // hiện trạng của một phòng chưa đặt ảnh. Ca "ký lại avatar" là việc của int-spec (cần storage thật).
  const avatarPresign = {
    resolveRoomAvatars: vi.fn(async () => new Map<string, string>()),
  } as never;

  const svc = new ChatRoomPrefsService(db, repo, access, avatarPresign);
  return {
    svc,
    db,
    calls,
    assertMember,
    lockUserPrefs,
    countPinnedRooms,
    setRoomPinned,
    setRoomMuted,
    setRoomMarkedUnread,
  };
}

describe("ChatRoomPrefsService — membership là cổng, 404 KHÔNG phải 403", () => {
  // Bốn hành động, một luật. Bảng thay vì 4 khối chép tay: quên một hành động ở đây là quên một lỗ.
  const actions: readonly [string, (s: ChatRoomPrefsService) => Promise<unknown>][] = [
    ["pin", (s) => s.pin(ACTOR, ROOM)],
    ["unpin", (s) => s.unpin(ACTOR, ROOM)],
    ["mute", (s) => s.mute(ACTOR, ROOM, { mutedUntil: null })],
    ["markUnread", (s) => s.markUnread(ACTOR, ROOM)],
  ];

  it.each(actions)("%s: phòng không thuộc ⇒ 404, KHÔNG ghi gì", async (_name, run) => {
    const { svc, assertMember, setRoomPinned, setRoomMuted, setRoomMarkedUnread } = makeService();
    assertMember.mockRejectedValue(new NotFoundException(CHAT_ERR.ROOM_NOT_FOUND) as never);

    await expect(run(svc)).rejects.toBeInstanceOf(NotFoundException);
    expect(setRoomPinned).not.toHaveBeenCalled();
    expect(setRoomMuted).not.toHaveBeenCalled();
    expect(setRoomMarkedUnread).not.toHaveBeenCalled();
  });

  it.each(actions)(
    "%s: khẳng định membership TRONG withTenant của đúng tenant",
    async (_n, run) => {
      const { svc, db, assertMember } = makeService();

      await run(svc);

      expect(db.withTenant).toHaveBeenCalledWith(CO, expect.any(Function));
      expect(assertMember).toHaveBeenCalledWith(expect.anything(), CO, ROOM, USER);
    },
  );
});

describe("CHAT-API-024a — ghim: trần 10/người + khoá TRƯỚC khi đếm", () => {
  it("khoá advisory chạy TRƯỚC countPinnedRooms — đếm-rồi-khoá là đường đua", async () => {
    const { svc, calls } = makeService();

    await svc.pin(ACTOR, ROOM);

    // Thứ tự, không phải chỉ sự hiện diện: khoá SAU khi đếm để lại đúng cửa sổ đua cần bịt.
    expect(calls).toEqual(["lock", "count"]);
  });

  it(`đã ghim đủ ${CHAT_ROOM_PIN_MAX} ⇒ 409 CHAT-ERR-021, KHÔNG ghi`, async () => {
    const { svc, countPinnedRooms, setRoomPinned } = makeService();
    countPinnedRooms.mockResolvedValue(CHAT_ROOM_PIN_MAX);

    await expect(svc.pin(ACTOR, ROOM)).rejects.toBeInstanceOf(ConflictException);
    await expect(svc.pin(ACTOR, ROOM)).rejects.toThrow(/CHAT-ERR-021/);
    expect(setRoomPinned).not.toHaveBeenCalled();
  });

  it(`${CHAT_ROOM_PIN_MAX - 1} phòng đang ghim ⇒ VẪN ghim được phòng thứ ${CHAT_ROOM_PIN_MAX}`, async () => {
    const { svc, countPinnedRooms, setRoomPinned } = makeService();
    countPinnedRooms.mockResolvedValue(CHAT_ROOM_PIN_MAX - 1);

    const room = await svc.pin(ACTOR, ROOM);

    expect(setRoomPinned).toHaveBeenCalledTimes(1);
    expect(room.pinnedAt).not.toBeNull();
  });

  it("ghim lại phòng ĐANG ghim ⇒ idempotent: không đếm, không khoá, không ghi", async () => {
    const pinnedAt = new Date("2026-08-05T10:00:00.000Z");
    const { svc, calls, setRoomPinned, countPinnedRooms } = makeService({ pinnedAt });

    const room = await svc.pin(ACTOR, ROOM);

    // Vế QUAN TRỌNG: không đi qua nhánh đếm ⇒ phòng đã ghim KHÔNG tiêu thêm một suất của trần 10.
    expect(calls).toEqual([]);
    expect(countPinnedRooms).not.toHaveBeenCalled();
    expect(setRoomPinned).not.toHaveBeenCalled();
    expect(room.pinnedAt).toBe(pinnedAt.toISOString());
  });

  it("bỏ ghim KHÔNG lấy khoá (số đếm giảm — không có trần nào để phá)", async () => {
    const { svc, calls, setRoomPinned } = makeService({ pinnedAt: new Date() });

    const room = await svc.unpin(ACTOR, ROOM);

    expect(calls).toEqual([]);
    expect(setRoomPinned).toHaveBeenCalledWith(expect.anything(), CO, MEMBER_ROW, null);
    expect(room.pinnedAt).toBeNull();
  });
});

describe("CHAT-API-025 — tắt thông báo", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("mốc TƯƠNG LAI ⇒ lưu nguyên", async () => {
    const { svc, setRoomMuted } = makeService();
    const until = new Date(Date.now() + 3_600_000);

    const room = await svc.mute(ACTOR, ROOM, { mutedUntil: until.toISOString() });

    expect(setRoomMuted).toHaveBeenCalledWith(expect.anything(), CO, MEMBER_ROW, until);
    expect(room.mutedUntil).toBe(until.toISOString());
  });

  it("`null` ⇒ BẬT LẠI thông báo (đường quay lại phải tồn tại)", async () => {
    const { svc, setRoomMuted } = makeService({ mutedUntil: new Date(Date.now() + 3_600_000) });

    const room = await svc.mute(ACTOR, ROOM, { mutedUntil: null });

    expect(setRoomMuted).toHaveBeenCalledWith(expect.anything(), CO, MEMBER_ROW, null);
    expect(room.mutedUntil).toBeNull();
  });

  it("mốc ĐÃ QUA ⇒ chuẩn hoá về null, KHÔNG lưu một giá trị mà đường đọc coi là 'không tắt'", async () => {
    // Đường đọc (`ChatAudienceReader.stillReceiving`) coi `muted_until <= now()` là KHÔNG tắt. Lưu
    // nguyên mốc quá khứ ⇒ DTO trả `mutedUntil !== null` cho một phòng vẫn gửi thông báo bình thường,
    // và FE nào kiểm khác-null sẽ vẽ chuông-gạch sai (lớp `ui-promises-backend-never-reads`, đảo chiều).
    const { svc, setRoomMuted } = makeService();
    const past = new Date(Date.now() - 60_000);

    const room = await svc.mute(ACTOR, ROOM, { mutedUntil: past.toISOString() });

    expect(setRoomMuted).toHaveBeenCalledWith(expect.anything(), CO, MEMBER_ROW, null);
    expect(room.mutedUntil).toBeNull();
  });
});

describe("CHAT-API-020 — đánh dấu chưa đọc: cột RIÊNG, con trỏ đọc BẤT ĐỘNG", () => {
  it("chỉ ghi marked_unread_at — KHÔNG có đường nào chạm last_read_seq", async () => {
    const { svc, setRoomMarkedUnread, setRoomPinned, setRoomMuted } = makeService();

    await svc.markUnread(ACTOR, ROOM);

    expect(setRoomMarkedUnread).toHaveBeenCalledTimes(1);
    expect(setRoomPinned).not.toHaveBeenCalled();
    expect(setRoomMuted).not.toHaveBeenCalled();
  });

  it("unreadCount KHÔNG đổi theo cờ — badge vẫn là phép trừ seq (SPEC-15 §13.2)", async () => {
    const { svc } = makeService();

    const room = await svc.markUnread(ACTOR, ROOM);

    // lastMessageSeq 7 − lastReadSeq 5 = 2, cả trước lẫn sau khi bật cờ.
    expect(room.unreadCount).toBe(2);
    expect(room.markedUnreadAt).not.toBeNull();
  });
});

describe("0 audit · 0 emit WS — ép bằng HÌNH DẠNG constructor, không bằng lời hứa", () => {
  /**
   * ⟲ **S8-CHAT-UX-BE-2 — ratchet ĐỔI TỪ ĐẾM SANG DANH SÁCH TÊN.**
   *
   * Bản cũ là `ChatRoomPrefsService.length === 3`. Nó đúng ý nhưng ghim SAI THỨ: con số không nói
   * phụ thuộc nào được phép. Ai thêm `AuditService` rồi sửa `3` → `4` là ratchet **vẫn xanh** trong
   * khi chính điều nó canh đã bị phá — đúng lớp `index-ratchet-must-pin-definition-not-name`.
   * (WO này phải nâng lên 4 vì `ChatRoomAvatarPresignService` là phụ thuộc hợp lệ: nó chỉ KÝ URL
   * đọc, không ghi audit, không phát WS. Chính lúc phải sửa con số là lúc lộ ra nó ghim sai thứ.)
   *
   * Bản mới đọc `design:paramtypes` — danh sách kiểu THẬT mà Nest sẽ tiêm — nên nó ĐỎ khi một phụ
   * thuộc bị cấm xuất hiện, bất kể tổng số là bao nhiêu.
   */
  it("KHÔNG tiêm AuditService / RealtimeEmitterService — bất kể có bao nhiêu phụ thuộc", () => {
    const deps: unknown[] =
      (Reflect.getMetadata("design:paramtypes", ChatRoomPrefsService) as unknown[]) ?? [];
    // Rỗng = metadata không được phát ⇒ ratchet mù. Fail-closed thay vì xanh giả.
    expect(deps.length, "design:paramtypes rỗng — ratchet sẽ không canh được gì").toBeGreaterThan(
      0,
    );

    const names = deps.map((d) => (typeof d === "function" ? d.name : String(d)));
    const BANNED = ["AuditService", "RealtimeEmitterService"];
    expect(
      names.filter((n) => BANNED.includes(n)),
      "ba tuỳ chọn CÁ NHÂN không được ghi vào bảng điều tra dùng chung, cũng không được phát cho cả phòng (rò “ai tắt thông báo của ai”) — xem docblock đầu `chat-room-prefs.service.ts`",
    ).toEqual([]);
  });

  it("ĐỐI CHỨNG: ratchet ĐỎ được — danh sách cấm thật sự được so khớp", () => {
    // Không có ca này thì một `BANNED` gõ sai (hoặc `names` luôn rỗng) sẽ làm ca trên xanh vĩnh viễn.
    const names = ["DatabaseService", "AuditService"];
    expect(names.filter((n) => ["AuditService", "RealtimeEmitterService"].includes(n))).toEqual([
      "AuditService",
    ]);
  });
});
