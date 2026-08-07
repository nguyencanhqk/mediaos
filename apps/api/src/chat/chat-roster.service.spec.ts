/**
 * S8-CHAT-UX-FE-3 — ROSTER phòng (`CHAT-API-007a` · `CHAT-DEC-019` · `API-13 §5.1`).
 *
 * Bốn lời khẳng định đắt nhất của phần BE trong WO này:
 *  (a) **`assertMember` chạy TRƯỚC mọi thứ** — người ngoài phòng không được ký một URL nào, không được
 *      đọc một cái tên nào. Test khẳng định THỨ TỰ, không chỉ khẳng định ném lỗi.
 *  (b) **Ký MỘT LÔ cho cả phòng** (CHAT-DEC-019) — đếm số lần gọi presign, không phải "có URL là được".
 *      Một hiện thực ký-theo-từng-người vẫn cho ra DTO đúng y hệt và vẫn xanh nếu chỉ kiểm kết quả.
 *  (c) **`avatar_url` THÔ không bao giờ lên DTO** — cột đó đa-người-ghi và có thể bị đầu độc; chỉ URL đã
 *      qua `resolveEmployeeAvatars` mới được ra ngoài.
 *  (d) **Người đã rời VẪN có trong roster** kèm `leftAt`.
 */
import { describe, expect, it, vi } from "vitest";
import { ChatMembersService } from "./chat-members.service";
import type { ChatRosterRow } from "./chat-rooms.repository";

const CO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROOM = "11111111-1111-4111-8111-111111111111";
const ACTOR = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", companyId: CO };
const GONE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EMP_ACTOR = "e1111111-1111-4111-8111-111111111111";
const EMP_GONE = "e2222222-2222-4222-8222-222222222222";

function rosterRows(): ChatRosterRow[] {
  return [
    {
      id: "m1",
      roomId: ROOM,
      userId: ACTOR.id,
      userName: "An",
      role: "admin",
      joinedAt: new Date("2026-08-01T00:00:00.000Z"),
      lastReadSeq: 9,
      leftAt: null,
      employeeId: EMP_ACTOR,
      // Giá trị THÔ — fileId chưa qua xác minh. Nó KHÔNG được xuất hiện trong DTO ở bất kỳ dạng nào.
      avatarRaw: "f0000000-0000-4000-8000-000000000001",
    },
    {
      id: "m2",
      roomId: ROOM,
      userId: GONE,
      userName: "Bình",
      role: "member",
      joinedAt: new Date("2026-08-02T00:00:00.000Z"),
      lastReadSeq: 3,
      leftAt: new Date("2026-08-05T00:00:00.000Z"),
      employeeId: EMP_GONE,
      avatarRaw: null,
    },
  ];
}

function build(
  opts: {
    rows?: ChatRosterRow[];
    assertMemberThrows?: boolean;
    signed?: Map<string, string>;
    online?: string[];
  } = {},
) {
  const calls: string[] = [];
  const listRosterMembers = vi.fn(async () => {
    calls.push("listRosterMembers");
    return opts.rows ?? rosterRows();
  });
  const assertMember = vi.fn(async () => {
    calls.push("assertMember");
    if (opts.assertMemberThrows) throw new Error("CHAT-ERR-001");
    return {};
  });
  // ⚠️ Khai THAM SỐ tường minh (dù không dùng): `vi.fn(async () => …)` suy ra chữ ký 0 đối số, nên
  // `mock.calls[0]` mang kiểu `[]` và mọi phép đọc đối số bên dưới không typecheck được. Bài test này
  // ĐO chính các đối số đó (lô subject + `callerTx`), nên chữ ký phải đúng.
  const resolveEmployeeAvatars = vi.fn(
    async (
      _companyId: string,
      _subjects: Array<{ employeeId: string; avatarUrl: string | null }>,
      _callerTx?: unknown,
    ) => {
      calls.push("resolveEmployeeAvatars");
      return opts.signed ?? new Map([[EMP_ACTOR, "https://r2.local/signed/an.png"]]);
    },
  );
  const getOnlineUserIds = vi.fn(async (_companyId: string, _userIds: readonly string[]) => {
    calls.push("getOnlineUserIds");
    return opts.online ?? [ACTOR.id];
  });

  const db = {
    withTenant: vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
  };

  const svc = new ChatMembersService(
    db as never,
    { listRosterMembers } as never,
    { assertMember } as never,
    {} as never,
    {} as never,
    { resolveEmployeeAvatars } as never,
    { getOnlineUserIds } as never,
  );
  return { svc, calls, listRosterMembers, resolveEmployeeAvatars, getOnlineUserIds, db };
}

describe("listMembers — cổng membership chạy TRƯỚC (a)", () => {
  it("người ngoài phòng ⇒ ném, và KHÔNG đọc roster, KHÔNG ký URL, KHÔNG đọc presence", async () => {
    const t = build({ assertMemberThrows: true });
    await expect(t.svc.listMembers(ACTOR, ROOM)).rejects.toThrow(/CHAT-ERR-001/);
    expect(t.listRosterMembers).not.toHaveBeenCalled();
    expect(t.resolveEmployeeAvatars).not.toHaveBeenCalled();
    expect(t.getOnlineUserIds).not.toHaveBeenCalled();
  });

  it("thành viên hợp lệ ⇒ THỨ TỰ là assertMember → roster → ký → presence", async () => {
    const t = build();
    await t.svc.listMembers(ACTOR, ROOM);
    expect(t.calls).toEqual([
      "assertMember",
      "listRosterMembers",
      "resolveEmployeeAvatars",
      "getOnlineUserIds",
    ]);
  });
});

describe("ký avatar MỘT LÔ cho cả phòng (b · CHAT-DEC-019)", () => {
  it("roster 2 người ⇒ ĐÚNG 1 lần gọi presign, không phải 1 lần mỗi người", async () => {
    const t = build();
    await t.svc.listMembers(ACTOR, ROOM);
    expect(t.resolveEmployeeAvatars).toHaveBeenCalledTimes(1);
  });

  it("presign nhận cả LÔ subject và ĐI TRONG tx của caller (không mở withTenant lồng nhau)", async () => {
    const t = build();
    await t.svc.listMembers(ACTOR, ROOM);
    const [companyId, subjects, callerTx] = t.resolveEmployeeAvatars.mock.calls[0];
    expect(companyId).toBe(CO);
    expect(subjects).toEqual([
      { employeeId: EMP_ACTOR, avatarUrl: "f0000000-0000-4000-8000-000000000001" },
      { employeeId: EMP_GONE, avatarUrl: null },
    ]);
    expect(callerTx).toBeDefined();
    // Một `withTenant` duy nhất cho cả đọc lẫn ký — hai lần là hai transaction cho một lần đọc.
    expect(t.db.withTenant).toHaveBeenCalledTimes(1);
  });

  it("user KHÔNG có hồ sơ nhân viên ⇒ không vào lô ký, DTO trả `avatarUrl: null`", async () => {
    const rows = rosterRows();
    rows[1] = { ...rows[1], employeeId: null, avatarRaw: null };
    const t = build({ rows });
    const out = await t.svc.listMembers(ACTOR, ROOM);
    const subjects = t.resolveEmployeeAvatars.mock.calls[0][1];
    expect(subjects).toHaveLength(1);
    expect(out[1].avatarUrl).toBeNull();
  });
});

describe("giá trị THÔ không bao giờ ra DTO (c)", () => {
  it("presign KHÔNG ký được ⇒ `avatarUrl: null`, TUYỆT ĐỐI không rơi về `avatarRaw`", async () => {
    // Map rỗng = fail-soft của `AvatarPresignService` (ký lỗi / cặp (employeeId,fileId) không xác minh
    // được vì bị đầu độc). Rơi về `avatarRaw` ở đây là bỏ qua toàn bộ lớp xác minh.
    const t = build({ signed: new Map() });
    const out = await t.svc.listMembers(ACTOR, ROOM);
    expect(out[0].avatarUrl).toBeNull();
    expect(JSON.stringify(out)).not.toContain("f0000000-0000-4000-8000-000000000001");
  });

  it("ký được ⇒ DTO mang URL ĐÃ KÝ", async () => {
    const t = build();
    const out = await t.svc.listMembers(ACTOR, ROOM);
    expect(out[0].avatarUrl).toBe("https://r2.local/signed/an.png");
  });
});

describe("người đã rời vẫn trong roster (d · CHAT-DEC-019)", () => {
  it("trả CẢ người đã rời, kèm `leftAt` dạng ISO", async () => {
    const t = build();
    const out = await t.svc.listMembers(ACTOR, ROOM);
    expect(out).toHaveLength(2);
    expect(out[0].leftAt).toBeNull();
    expect(out[1].userId).toBe(GONE);
    expect(out[1].leftAt).toBe("2026-08-05T00:00:00.000Z");
    // Tên phải còn: thiếu nó thì mọi tin CŨ của người này mất người gửi.
    expect(out[1].userName).toBe("Bình");
  });
});

describe("ảnh chụp đang online", () => {
  it("`isOnline` LUÔN là boolean — Valkey tắt (trả []) ⇒ `false`, không phải `undefined`", async () => {
    const t = build({ online: [] });
    const out = await t.svc.listMembers(ACTOR, ROOM);
    expect(out.every((m) => m.isOnline === false)).toBe(true);
  });

  it("chỉ người có trong danh sách online mới được đánh dấu", async () => {
    const t = build({ online: [GONE] });
    const out = await t.svc.listMembers(ACTOR, ROOM);
    expect(out[0].isOnline).toBe(false);
    expect(out[1].isOnline).toBe(true);
  });
});
