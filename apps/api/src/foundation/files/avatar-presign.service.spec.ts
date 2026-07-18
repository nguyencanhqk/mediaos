import "reflect-metadata";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvatarPresignService, isUuid } from "./avatar-presign.service";

/**
 * S5-ME-BE-5 — AvatarPresignService UNIT (không DB/storage thật). Chốt (security-review):
 *   - CHỈ ký khi cặp (employeeId, fileId) khớp 1 avatar ĐÃ XÁC MINH (findVerifiedAvatarsTx trả link+image).
 *   - DENY đầu độc CHÉO: employee B mượn fileId avatar của A (avatar_url B bị đặt = fileId của A) → link
 *     entity_id=A ≠ B ⇒ B KHÔNG được ký (chống IDOR đọc file nội-tenant qua avatar_url đa-người-ghi).
 *   - DENY không-xác-minh: fileId không có link/không image (findVerifiedAvatarsTx rỗng) → KHÔNG ký.
 *   - http passthrough (legacy admin-set); null/rác → bỏ; storage lỗi → fail-soft (bỏ + warn).
 * Gate SQL (image/* + link ME/avatar SỐNG) test THẬT ở avatar-presign.int-spec.ts (Postgres).
 */

const E1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const E2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const F1 = "11111111-1111-4111-8111-111111111111";
const F2 = "22222222-2222-4222-8222-222222222222";

type Verified = { employeeId: string; fileId: string; storagePath: string };

function makeService(verified: Verified[], getImpl?: (key: string) => Promise<{ url: string }>) {
  const findVerifiedAvatarsTx = vi.fn().mockResolvedValue(verified);
  const db = { withTenant: vi.fn((_c: string, fn: (tx: unknown) => unknown) => fn({})) };
  const fileRepo = { findVerifiedAvatarsTx };
  const storage = {
    get: vi.fn(async ({ key }: { key: string }) => {
      if (getImpl) return getImpl(key);
      return { url: `https://signed/${key}`, expiresAt: new Date(0) };
    }),
  };
  const svc = new AvatarPresignService(db as never, fileRepo as never, storage as never);
  return { svc, findVerifiedAvatarsTx, storage };
}

beforeEach(() => vi.clearAllMocks());

describe("resolveEmployeeAvatars", () => {
  it("subjects rỗng → Map rỗng, KHÔNG chạm DB", async () => {
    const { svc, findVerifiedAvatarsTx } = makeService([]);
    const map = await svc.resolveEmployeeAvatars("c1", []);
    expect(map.size).toBe(0);
    expect(findVerifiedAvatarsTx).not.toHaveBeenCalled();
  });

  it("toàn null / giá trị rác → Map rỗng, KHÔNG chạm DB", async () => {
    const { svc, findVerifiedAvatarsTx } = makeService([]);
    const map = await svc.resolveEmployeeAvatars("c1", [
      { employeeId: E1, avatarUrl: null },
      { employeeId: E2, avatarUrl: "garbage" },
    ]);
    expect(map.size).toBe(0);
    expect(findVerifiedAvatarsTx).not.toHaveBeenCalled();
  });

  it("http(s) URL → passthrough (legacy admin-set), KHÔNG chạm DB", async () => {
    const { svc, findVerifiedAvatarsTx } = makeService([]);
    const map = await svc.resolveEmployeeAvatars("c1", [
      { employeeId: E1, avatarUrl: "https://cdn/x.png" },
    ]);
    expect(map.get(E1)).toBe("https://cdn/x.png");
    expect(findVerifiedAvatarsTx).not.toHaveBeenCalled();
  });

  it("avatar ĐÃ XÁC MINH (cặp khớp) → ký; dedupe fileId", async () => {
    const { svc, findVerifiedAvatarsTx, storage } = makeService([
      { employeeId: E1, fileId: F1, storagePath: "c1/files/f1" },
    ]);
    const map = await svc.resolveEmployeeAvatars("c1", [{ employeeId: E1, avatarUrl: F1 }]);
    expect(findVerifiedAvatarsTx).toHaveBeenCalledWith("c1", [F1], {});
    expect(storage.get).toHaveBeenCalledTimes(1);
    expect(map.get(E1)).toBe("https://signed/c1/files/f1");
  });

  it("DENY đầu độc CHÉO — B đặt avatar_url = fileId avatar của A → B KHÔNG được ký (link entity=A≠B)", async () => {
    // avatar_url của B bị đặt = F1 (avatar THẬT của A). findVerifiedAvatarsTx trả link (A, F1).
    const { svc, storage } = makeService([
      { employeeId: E1, fileId: F1, storagePath: "c1/files/f1" },
    ]);
    const map = await svc.resolveEmployeeAvatars("c1", [
      { employeeId: E1, avatarUrl: F1 }, // A: hợp lệ
      { employeeId: E2, avatarUrl: F1 }, // B: đầu độc (mượn fileId của A)
    ]);
    expect(map.get(E1)).toBe("https://signed/c1/files/f1"); // A vẫn hiện
    expect(map.has(E2)).toBe(false); // B KHÔNG được ký (chống IDOR)
    expect(storage.get).toHaveBeenCalledTimes(1); // chỉ ký 1 lần cho A
  });

  it("DENY không-xác-minh — fileId không có link/không image (findVerified rỗng) → KHÔNG ký", async () => {
    const { svc, storage } = makeService([]); // SQL gate loại hết (không image / không link)
    const map = await svc.resolveEmployeeAvatars("c1", [{ employeeId: E1, avatarUrl: F1 }]);
    expect(map.has(E1)).toBe(false);
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("storage.get lỗi → FAIL-SOFT: bỏ employee đó (initials), employee khác vẫn có", async () => {
    const { svc } = makeService(
      [
        { employeeId: E1, fileId: F1, storagePath: "c1/files/f1" },
        { employeeId: E2, fileId: F2, storagePath: "c1/files/f2" },
      ],
      async (key) => {
        if (key.endsWith("/f1")) throw new Error("storage down");
        return { url: `https://signed/${key}` };
      },
    );
    const map = await svc.resolveEmployeeAvatars("c1", [
      { employeeId: E1, avatarUrl: F1 },
      { employeeId: E2, avatarUrl: F2 },
    ]);
    expect(map.has(E1)).toBe(false); // ký lỗi → bỏ
    expect(map.get(E2)).toBe("https://signed/c1/files/f2");
  });

  it("hỗn hợp — http passthrough + fileId xác minh cùng response", async () => {
    const { svc } = makeService([{ employeeId: E2, fileId: F2, storagePath: "c1/files/f2" }]);
    const map = await svc.resolveEmployeeAvatars("c1", [
      { employeeId: E1, avatarUrl: "https://cdn/a.png" },
      { employeeId: E2, avatarUrl: F2 },
    ]);
    expect(map.get(E1)).toBe("https://cdn/a.png");
    expect(map.get(E2)).toBe("https://signed/c1/files/f2");
  });
});

describe("isUuid", () => {
  it("nhận UUID hợp lệ, loại chuỗi khác", () => {
    expect(isUuid(F1)).toBe(true);
    expect(isUuid("https://x")).toBe(false);
    expect(isUuid("123")).toBe(false);
  });
});
