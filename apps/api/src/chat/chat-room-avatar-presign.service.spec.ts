import { describe, expect, it, vi } from "vitest";
import type { DatabaseService, TenantTx } from "../db/db.service";
import type { FileRepository } from "../foundation/files/file.repository";
import type { StorageAdapter } from "../storage/storage-adapter.port";
import { ChatRoomAvatarPresignService } from "./chat-room-avatar-presign.service";

/**
 * S8-CHAT-UX-QA-1 — `ChatRoomAvatarPresignService` (nghiệm thu BE-2).
 *
 * Đo coverage 07/08 trên cụm S8: **76% dòng · 58.33% nhánh** — toàn bộ nhánh **degrade** (storage ký lỗi)
 * chưa từng chạy. Đó là nhánh đáng ngờ nhất của service này: nó biến một lỗi thành "phòng không có ảnh",
 * và nếu nó nuốt im lặng thì một bug thật (vd `assertKeyInTenant` ném vì lệch tenant) sẽ lẩn sau đúng
 * chỗ đó — cả danh sách phòng vẫn 200, chỉ là không ảnh, mãi mãi.
 */

const COMPANY = "11111111-1111-4111-8111-111111111111";
const ROOM_A = "22222222-2222-4222-8222-222222222222";
const ROOM_B = "33333333-3333-4333-8333-333333333333";

function build(opts?: {
  verified?: { roomId: string; storagePath: string }[];
  failFor?: string[];
}) {
  const withTenant = vi.fn(async (_c: string, fn: (tx: unknown) => Promise<unknown>) => fn({}));
  const db = { withTenant } as unknown as DatabaseService;

  // Khai ĐỦ ba tham số (dù thân không dùng): `mock.calls[i][1]`/`[2]` là thứ hai ca dưới đây assert —
  // mock không tham số cho ra tuple rỗng, và TS chặn ngay việc đọc phần tử không tồn tại.
  const findVerifiedRoomAvatarsTx = vi.fn(
    async (_companyId: string, _roomIds: string[], _tx: unknown) => opts?.verified ?? [],
  );
  const fileRepo = { findVerifiedRoomAvatarsTx } as unknown as FileRepository;

  const get = vi.fn(async ({ key }: { key: string; companyId: string }) => {
    if (opts?.failFor?.includes(key)) throw new Error(`storage down: ${key}`);
    return { url: `https://signed.test/${key}`, expiresAt: new Date() };
  });
  const storage = { get } as unknown as StorageAdapter;

  return {
    svc: new ChatRoomAvatarPresignService(db, fileRepo, storage),
    withTenant,
    findVerifiedRoomAvatarsTx,
    get,
  };
}

describe("ChatRoomAvatarPresignService — một lô, không N+1", () => {
  it("ký cho cả danh sách bằng ĐÚNG MỘT truy vấn, khử trùng roomId trước khi hỏi DB", async () => {
    const { svc, findVerifiedRoomAvatarsTx } = build({
      verified: [
        { roomId: ROOM_A, storagePath: "co/a.png" },
        { roomId: ROOM_B, storagePath: "co/b.png" },
      ],
    });

    const map = await svc.resolveRoomAvatars(COMPANY, [ROOM_A, ROOM_B, ROOM_A]);

    expect(findVerifiedRoomAvatarsTx).toHaveBeenCalledTimes(1);
    expect(findVerifiedRoomAvatarsTx.mock.calls[0][1], "id trùng phải bị khử").toEqual([
      ROOM_A,
      ROOM_B,
    ]);
    expect(map.get(ROOM_A)).toBe("https://signed.test/co/a.png");
    expect(map.get(ROOM_B)).toBe("https://signed.test/co/b.png");
  });

  it("danh sách rỗng ⇒ map rỗng, KHÔNG chạm DB và KHÔNG chạm storage", async () => {
    const { svc, findVerifiedRoomAvatarsTx, get } = build();

    expect((await svc.resolveRoomAvatars(COMPANY, [])).size).toBe(0);
    expect(findVerifiedRoomAvatarsTx).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("0 phòng có ảnh hợp lệ ⇒ dừng sớm, không gọi ký lần nào", async () => {
    const { svc, get } = build({ verified: [] });

    expect((await svc.resolveRoomAvatars(COMPANY, [ROOM_A])).size).toBe(0);
    expect(get).not.toHaveBeenCalled();
  });
});

describe("ChatRoomAvatarPresignService — transaction của caller", () => {
  it("có `callerTx` ⇒ dùng ĐÚNG tx đó, KHÔNG mở `withTenant` lồng nhau (PgBouncer sẽ treo)", async () => {
    const { svc, withTenant, findVerifiedRoomAvatarsTx } = build({
      verified: [{ roomId: ROOM_A, storagePath: "co/a.png" }],
    });
    const callerTx = { marker: "caller" } as unknown as TenantTx;

    await svc.resolveRoomAvatars(COMPANY, [ROOM_A], callerTx);

    expect(
      withTenant,
      "mở tx lồng trong tx = treo trên pool transaction-mode",
    ).not.toHaveBeenCalled();
    expect(findVerifiedRoomAvatarsTx.mock.calls[0][2]).toBe(callerTx);
  });

  it("không có `callerTx` ⇒ tự mở `withTenant` (đường của caller ngoài transaction)", async () => {
    const { svc, withTenant } = build({ verified: [{ roomId: ROOM_A, storagePath: "co/a.png" }] });

    await svc.resolveRoomAvatars(COMPANY, [ROOM_A]);

    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(withTenant.mock.calls[0][0]).toBe(COMPANY);
  });
});

describe("ChatRoomAvatarPresignService — FAIL-SOFT nhưng CÓ KÊU", () => {
  it("🔒 một ảnh ký lỗi ⇒ CHỈ phòng đó vắng mặt; phòng còn lại vẫn có URL (không 500 cả danh sách)", async () => {
    const { svc } = build({
      verified: [
        { roomId: ROOM_A, storagePath: "co/a.png" },
        { roomId: ROOM_B, storagePath: "co/b.png" },
      ],
      failFor: ["co/a.png"],
    });

    const map = await svc.resolveRoomAvatars(COMPANY, [ROOM_A, ROOM_B]);

    expect(map.has(ROOM_A), "phòng ký lỗi ⇒ caller trả avatarUrl: null").toBe(false);
    expect(map.get(ROOM_B), "một lỗi KHÔNG được kéo theo phòng khác").toBe(
      "https://signed.test/co/b.png",
    );
  });

  it("🔒 degrade phải để lại DẤU: log cảnh báo mang số lỗi + companyId + reason mẫu", async () => {
    const { svc } = build({
      verified: [{ roomId: ROOM_A, storagePath: "co/a.png" }],
      failFor: ["co/a.png"],
    });
    const warn = vi
      .spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, "warn")
      .mockImplementation(() => undefined);

    await svc.resolveRoomAvatars(COMPANY, [ROOM_A]);

    // Im lặng ở đây = tính năng chết dần mà không ai biết: FE chỉ thấy "chưa đặt ảnh".
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = warn.mock.calls[0][0] as string;
    expect(msg).toContain(COMPANY);
    expect(msg).toContain("1/1");
    expect(msg, "thiếu reason mẫu thì log không lần ra được nguyên nhân").toContain("storage down");
    warn.mockRestore();
  });

  it("mọi ảnh ký được ⇒ KHÔNG log cảnh báo (log nhiễu làm cảnh báo thật mất giá)", async () => {
    const { svc } = build({ verified: [{ roomId: ROOM_A, storagePath: "co/a.png" }] });
    const warn = vi
      .spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, "warn")
      .mockImplementation(() => undefined);

    await svc.resolveRoomAvatars(COMPANY, [ROOM_A]);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
